/**
 * Bench client for the Jev-compatible `POST /v1/systemone` shape (hosted Bocha
 * Jev, other Jev deployments, the local Laya sidecar). The wire format, the
 * limits-aware chunking and the transport (Retry-After aware retries, request
 * cap) are the plugin's own (src/pipeline/judges): the bench only adds its Judge
 * interface (noul / score / choice questions over items), per-item results and
 * its on-disk cache.
 * @module bench/judges/systemone
 */

import crypto from 'node:crypto'
import { JudgeError } from '../../../src/pipeline/judges/errors.ts'
import { JudgeHttp, parseRetryAfter, sleepMs } from '../../../src/pipeline/judges/http.ts'
import { candidatesFor, chunkItems, decodeAnswer, encodeQuestion, encodeRequest, usageOfSystemOne } from '../../../src/pipeline/judges/protocols/systemone.ts'
import { evaluateCached, type JudgeCache } from './cache.ts'
import { bindCandidate } from './rubrics.ts'
import {
  RequestCapError,
  type Judge, type JudgeItem, type JudgeQuestion, type JudgeResult, type Readiness,
} from './types.ts'

export { candidatesFor, chunkItems, parseRetryAfter }

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

const MAX_RETRY_WAIT_MS = 60_000

function cut(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…'
}

export class SystemOneJudge implements Judge {
  readonly id: string
  readonly model: string
  capReached = false
  protected readonly cfg: Required<Pick<SystemOneConfig, 'maxQuestions' | 'maxCandidates' | 'maxBodyBytes' | 'maxRetries' | 'candidateChars' | 'timeoutMs'>> & SystemOneConfig
  private readonly doFetch: typeof fetch
  private readonly http: JudgeHttp

  constructor(cfg: SystemOneConfig) {
    this.cfg = {
      maxQuestions: 32, maxCandidates: 1024, maxBodyBytes: 200_000, maxRetries: 2,
      candidateChars: 1200, timeoutMs: 120_000, ...cfg,
    }
    this.id = cfg.id
    this.model = cfg.model
    this.doFetch = cfg.fetchImpl ?? globalThis.fetch
    this.http = new JudgeHttp({
      url: this.cfg.url, headers: { ...this.cfg.headers }, label: this.id + ':', fetchImpl: this.doFetch, sleep: cfg.sleep ?? sleepMs,
      timeoutMs: this.cfg.timeoutMs, maxRetries: this.cfg.maxRetries, requestCap: this.cfg.requestCap, maxRetryWaitMs: MAX_RETRY_WAIT_MS,
      capError: cap => new RequestCapError(this.id, cap),
    })
  }

  /** HTTP attempts made so far (retries included). */
  get requests(): number { return this.http.requests }

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
    return encodeQuestion(q.kind, bindCandidate(q.instructions, cut(item.text, this.cfg.candidateChars)), q.kind === 'choice' ? q.options : q.criteria)
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
    const body = encodeRequest(this.model, state, questions, this.cfg.extraBody)
    let result
    try {
      result = await this.http.post(body, {}, { estimatedInputTokens: 0, usageOf: usageOfSystemOne })
    } catch (error) {
      // The transport's errors become the bench's; a RequestCapError (raised by the transport's capError hook) passes through.
      if (error instanceof JudgeError) throw new SystemOneError(error.message, error.status, error.fatal)
      throw error
    }
    const { json, latencyMs } = result
    const requestId = this.id + '-' + crypto.randomUUID().slice(0, 8)
    const usage = json.usage
      ? { inputTokens: Number(json.usage.input_tokens ?? 0), outputTokens: Number(json.usage.output_tokens ?? 0) }
      : undefined
    return chunk.map((item, i): JudgeResult => {
      const common = {
        id: item.id, judge: this.id, model: this.model, rubricId: q.rubricId, rubricVersion: q.rubricVersion,
        latencyMs, requestId, batchSize: chunk.length, usage: i === 0 ? usage : undefined,
        ...(json.usage?.truncated ? { truncated: true } : {}),
      }
      const d = decodeAnswer(q.kind, json.answers?.['q' + i])
      if ('error' in d) return { ...common, error: d.error }
      if (d.kind === 'noul') return { ...common, prob: d.prob, decision: d.prob >= 0.5 ? 'true' : 'false' }
      if (d.kind === 'score') return { ...common, grade: d.grade, decision: String(Math.round(d.grade)), probabilities: d.probabilities }
      return { ...common, decision: d.choice, prob: d.prob, probabilities: d.probabilities }
    })
  }
}
