/**
 * Shared client for the Jev-compatible `POST /v1/systemone` shape (hosted Bocha
 * Jev and the local Laya sidecar). One question per item; requests are chunked
 * to the documented limits (<=32 questions, <=1024 candidates with noul = 2,
 * bounded body size) and cached per item.
 * @module bench/judges/systemone
 */

import crypto from 'node:crypto'
import { sleep as realSleep } from '../cli.ts'
import { evaluateCached, type JudgeCache } from './cache.ts'
import { bindCandidate } from './rubrics.ts'
import {
  RequestCapError,
  type Judge, type JudgeItem, type JudgeQuestion, type JudgeResult, type Readiness,
} from './types.ts'

export interface SystemOneConfig {
  id: string
  model: string
  url: string
  headers?: Record<string, string>
  healthUrl?: string
  maxQuestions?: number
  maxCandidates?: number
  maxBodyBytes?: number
  maxRetries?: number
  /** Hard cap on HTTP attempts (retries included). */
  requestCap?: number
  /** Candidate text is cut to this many characters before sending. */
  candidateChars?: number
  extraBody?: Record<string, unknown>
  timeoutMs?: number
  cache?: JudgeCache
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export class SystemOneError extends Error {
  constructor(message: string, public readonly status?: number, public readonly fatal = false) {
    super(message)
    this.name = 'SystemOneError'
  }
}

const RETRY_STATUSES = new Set([429, 503, 529])
const MAX_RETRY_WAIT_MS = 60_000

export function candidatesFor(q: Pick<JudgeQuestion, 'kind' | 'criteria' | 'options'>): number {
  if (q.kind === 'noul') return 2
  if (q.kind === 'score') return q.criteria?.length ?? 4
  return Object.keys(q.options ?? {}).length
}

/** Split items into request-sized groups: question count, candidate total and body size bounds. */
export function chunkItems(
  items: readonly JudgeItem[], q: JudgeQuestion, size: (item: JudgeItem) => number,
  limits: { maxQuestions: number; maxCandidates: number; maxBodyBytes: number; baseBytes: number },
): JudgeItem[][] {
  const perQuestion = candidatesFor(q)
  const chunks: JudgeItem[][] = []
  let cur: JudgeItem[] = []
  let bytes = limits.baseBytes
  for (const item of items) {
    const itemBytes = size(item)
    const full = cur.length >= limits.maxQuestions
      || (cur.length + 1) * perQuestion > limits.maxCandidates
      || bytes + itemBytes > limits.maxBodyBytes
    if (cur.length && full) { chunks.push(cur); cur = []; bytes = limits.baseBytes }
    cur.push(item)
    bytes += itemBytes
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…'
}

export class SystemOneJudge implements Judge {
  readonly id: string
  readonly model: string
  /** HTTP attempts made so far (retries included). */
  requests = 0
  capReached = false
  protected readonly cfg: Required<Pick<SystemOneConfig, 'maxQuestions' | 'maxCandidates' | 'maxBodyBytes' | 'maxRetries' | 'candidateChars' | 'timeoutMs'>> & SystemOneConfig
  private readonly doFetch: typeof fetch
  private readonly sleeper: (ms: number) => Promise<void>

  constructor(cfg: SystemOneConfig) {
    this.cfg = {
      maxQuestions: 32, maxCandidates: 1024, maxBodyBytes: 200_000, maxRetries: 2,
      candidateChars: 1200, timeoutMs: 120_000, ...cfg,
    }
    this.id = cfg.id
    this.model = cfg.model
    this.doFetch = cfg.fetchImpl ?? globalThis.fetch
    this.sleeper = cfg.sleep ?? realSleep
  }

  async ready(): Promise<Readiness> {
    if (!this.cfg.healthUrl) return { ready: true }
    try {
      const res = await this.doFetch(this.cfg.healthUrl, { signal: AbortSignal.timeout(5_000) })
      return { ready: res.ok, detail: 'HTTP ' + res.status }
    } catch (error) {
      return { ready: false, detail: (error as Error).message }
    }
  }

  async evaluate(state: string, q: JudgeQuestion, items: readonly JudgeItem[]): Promise<JudgeResult[]> {
    return evaluateCached({
      judge: this, cache: this.cfg.cache, state, question: q, items,
      extraKey: JSON.stringify(this.cfg.extraBody ?? {}) + '|' + this.cfg.candidateChars,
      runMisses: misses => this.runMisses(state, q, misses),
    })
  }

  protected questionBody(q: JudgeQuestion, item: JudgeItem): Record<string, unknown> {
    const body: Record<string, unknown> = {
      type: q.kind,
      instructions: bindCandidate(q.instructions, cut(item.text, this.cfg.candidateChars)),
    }
    if (q.kind === 'score') body.criteria = q.criteria
    if (q.kind === 'choice') body.criteria = q.options
    return body
  }

  private async runMisses(state: string, q: JudgeQuestion, items: JudgeItem[]): Promise<JudgeResult[]> {
    const base = Buffer.byteLength(JSON.stringify({ model: this.model, state, questions: {}, ...this.cfg.extraBody }))
    const chunks = chunkItems(
      items, q, item => Buffer.byteLength(JSON.stringify(this.questionBody(q, item))) + 16,
      { maxQuestions: this.cfg.maxQuestions, maxCandidates: this.cfg.maxCandidates, maxBodyBytes: this.cfg.maxBodyBytes, baseBytes: base },
    )
    const out: JudgeResult[] = []
    for (const chunk of chunks) {
      if (this.capReached) { out.push(...chunk.map(item => this.failed(q, item, 'request-cap')) ); continue }
      try {
        out.push(...await this.runChunk(state, q, chunk))
      } catch (error) {
        if (error instanceof RequestCapError) {
          this.capReached = true
          out.push(...chunk.map(item => this.failed(q, item, 'request-cap')))
        } else if (error instanceof SystemOneError && error.fatal) {
          throw error
        } else {
          out.push(...chunk.map(item => this.failed(q, item, (error as Error).message)))
        }
      }
    }
    return out
  }

  private failed(q: JudgeQuestion, item: JudgeItem, error: string): JudgeResult {
    return { id: item.id, judge: this.id, model: this.model, rubricId: q.rubricId, rubricVersion: q.rubricVersion, latencyMs: 0, error }
  }

  private async runChunk(state: string, q: JudgeQuestion, chunk: JudgeItem[]): Promise<JudgeResult[]> {
    const questions: Record<string, unknown> = {}
    chunk.forEach((item, i) => { questions['q' + i] = this.questionBody(q, item) })
    const body = JSON.stringify({ model: this.model, state, questions, ...this.cfg.extraBody })
    const { json, latencyMs } = await this.post(body)
    const requestId = this.id + '-' + crypto.randomUUID().slice(0, 8)
    const usage = json.usage
      ? { inputTokens: Number(json.usage.input_tokens ?? 0), outputTokens: Number(json.usage.output_tokens ?? 0) }
      : undefined
    return chunk.map((item, i): JudgeResult => {
      const answer = json.answers?.['q' + i]
      const common = {
        id: item.id, judge: this.id, model: this.model, rubricId: q.rubricId, rubricVersion: q.rubricVersion,
        latencyMs, requestId, batchSize: chunk.length, usage: i === 0 ? usage : undefined,
        ...(json.usage?.truncated ? { truncated: true } : {}),
      }
      if (!answer) return { ...common, error: 'missing answer' }
      if (q.kind === 'noul') {
        const p = Number(answer.noul)
        if (!Number.isFinite(p)) return { ...common, error: 'bad noul answer' }
        return { ...common, prob: p, decision: p >= 0.5 ? 'true' : 'false' }
      }
      if (q.kind === 'score') {
        const g = Number(answer.score)
        if (!Number.isFinite(g)) return { ...common, error: 'bad score answer' }
        return { ...common, grade: g, decision: String(Math.round(g)), probabilities: answer.probabilities }
      }
      const probs = (answer.probabilities ?? {}) as Record<string, number>
      const choice = String(answer.choice ?? '')
      if (!choice) return { ...common, error: 'bad choice answer' }
      return { ...common, decision: choice, prob: probs[choice] ?? Number(answer.answer_confidence ?? answer.confidence), probabilities: probs }
    })
  }

  /** POST with Retry-After aware retries on 429/503/529 (no retry on 401/413/422). */
  private async post(body: string): Promise<{ json: any; latencyMs: number }> {
    for (let attempt = 0; ; attempt++) {
      if (this.cfg.requestCap !== undefined && this.requests >= this.cfg.requestCap) {
        throw new RequestCapError(this.id, this.cfg.requestCap)
      }
      this.requests++
      const started = Date.now()
      let res: Response
      try {
        res = await this.doFetch(this.cfg.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...this.cfg.headers },
          body,
          signal: AbortSignal.timeout(this.cfg.timeoutMs),
        })
      } catch (error) {
        throw new SystemOneError(this.id + ': network error: ' + (error as Error).message)
      }
      if (res.ok) {
        // Headers can arrive long before the body: measure the whole exchange.
        const json = await res.json()
        return { json, latencyMs: Date.now() - started }
      }
      const text = (await res.text().catch(() => '')).slice(0, 300)
      if (RETRY_STATUSES.has(res.status) && attempt < this.cfg.maxRetries) {
        const wait = parseRetryAfter(res.headers.get('retry-after')) ?? 1_000 * 2 ** attempt
        await this.sleeper(Math.min(wait, MAX_RETRY_WAIT_MS))
        continue
      }
      throw new SystemOneError(this.id + ': HTTP ' + res.status + ' ' + text, res.status, res.status === 401)
    }
  }
}
