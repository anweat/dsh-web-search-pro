/**
 * `rerank` protocol: the query-documents relevance API of Jina, Cohere and the
 * local bge / Qwen reranker servers that copy them:
 *
 *   POST {model, query, documents: [text...], top_n}
 *   ->   {results: [{index, relevance_score}, ...], usage?: {total_tokens}}
 *
 * S6 sends one request per need: the need text is the query, the blocks of that
 * need are the documents. A relevance score is NOT a grade (its scale differs per
 * model, per language and sometimes per request), so a calibration (monotone
 * piecewise-linear map onto 0..3, see calibration.ts) is mandatory: without one the
 * scorer cannot be built, and raw scores are never thresholded or mixed.
 * @module web-search-pro/pipeline/judges/protocols/rerank
 */

import { blockScoringText } from '../../blocks.ts'
import type { BlockGrade } from '../../types.ts'
import { ModelScorerBase, type ModelScorerOptions } from '../model-scorer.ts'
import { cut, estimatePlainTokens, squash } from '../tokens.ts'
import type { JudgeProbe, ScoreContext, ScoreJob, ScoreOutcome, ScoreTask, ScoreUsage } from '../types.ts'

export const RERANK_PATH = '/rerank'

export function encodeRerankRequest(model: string, query: string, documents: readonly string[], extraBody?: Record<string, unknown>): string {
  return JSON.stringify({ model, query, documents, top_n: documents.length, ...extraBody })
}

/** `index -> raw relevance score` of the answered documents; malformed, out-of-range and duplicate rows are dropped. */
export function decodeRerankResults(json: any, documentCount: number): Map<number, number> {
  const out = new Map<number, number>()
  const rows = Array.isArray(json?.results) ? json.results : Array.isArray(json?.data) ? json.data : []
  for (const row of rows) {
    const index = Number(row?.index)
    const score = Number(row?.relevance_score ?? row?.score)
    if (!Number.isInteger(index) || index < 0 || index >= documentCount || !Number.isFinite(score) || out.has(index)) continue
    out.set(index, score)
  }
  return out
}

const numeric = (v: unknown): number | undefined => {
  if (v === undefined || v === null) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** Jina: `usage.total_tokens`; Cohere v2: `meta.tokens.input_tokens`; OpenAI-style servers: `usage.prompt_tokens`. Search units (Cohere billing) are not tokens. */
export const usageOfRerank = (json: any): { input?: number | undefined; output?: number | undefined } => ({
  input: numeric(json?.usage?.total_tokens ?? json?.usage?.prompt_tokens ?? json?.meta?.tokens?.input_tokens),
})

export interface RerankScorerOptions extends ModelScorerOptions {
  maxDocumentsPerRequest?: number | undefined
  requestTokenBudget?: number | undefined
  blockChars?: number | undefined
  maxNeedChars?: number | undefined
}

/** One document of a request; every document of one request carries the same `need` (the query). */
interface Doc { need: string; needId: string; blockId: string; probe: JudgeProbe; text: string; tokens: number }

export class RerankScorer extends ModelScorerBase {
  readonly rubricRef = undefined
  private readonly lim: Required<Pick<RerankScorerOptions, 'maxDocumentsPerRequest' | 'requestTokenBudget' | 'blockChars' | 'maxNeedChars'>>

  constructor(options: RerankScorerOptions) {
    super(options)
    if (!options.calibration) throw new Error(options.label + ' is a rerank provider: its scores are not grades, set calibration.points ([raw score, grade 0..3] pairs) first')
    this.lim = {
      maxDocumentsPerRequest: options.maxDocumentsPerRequest ?? 100, requestTokenBudget: options.requestTokenBudget ?? 40_000,
      blockChars: options.blockChars ?? 1200, maxNeedChars: options.maxNeedChars ?? 200,
    }
  }

  async score(_task: ScoreTask, jobs: readonly ScoreJob[], ctx: ScoreContext = {}): Promise<ScoreOutcome> {
    const usage: ScoreUsage = { requests: 0, questions: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0 }
    const grades = new Map<string, Map<string, BlockGrade>>()
    for (const job of jobs) grades.set(job.need.id, new Map())
    const put = (needId: string, blockId: string, raw: number): void => { const g = Math.min(Math.max(this.shape(raw), 0), 3); grades.get(needId)!.set(blockId, { grade: g, rank: g }) }

    const tokenBudget = Math.min(this.lim.requestTokenBudget, Math.max(this.http.headroom(), 1))
    const batches: Doc[][] = []
    let total = 0
    let asked = 0
    for (const job of jobs) {
      const need = squash(job.need.text, this.lim.maxNeedChars)
      const misses: Doc[] = []
      for (const block of job.blocks) {
        total++
        const full = blockScoringText(block)
        const probe: JudgeProbe = { state: '', need, candidate: full, ...this.providerKey ? { provider: this.providerKey } : {} }
        const hit = this.cache?.get(probe)
        if (hit) { put(job.need.id, block.blockId, hit.grade); usage.cacheHits++; continue }
        const text = cut(full, this.lim.blockChars)
        misses.push({ need, needId: job.need.id, blockId: block.blockId, probe, text, tokens: estimatePlainTokens(text) + 8 })
      }
      asked += misses.length
      // One request per need (the need is the query), split by document count and estimated tokens.
      const queryTokens = estimatePlainTokens(need) + 16
      let cur: Doc[] = []
      let tokens = queryTokens
      for (const doc of misses) {
        if (cur.length && (cur.length >= this.lim.maxDocumentsPerRequest || tokens + doc.tokens > tokenBudget)) {
          batches.push(cur)
          cur = []
          tokens = queryTokens
        }
        cur.push(doc)
        tokens += doc.tokens
      }
      if (cur.length) batches.push(cur)
    }

    const requestsBefore = this.requests
    const dispatched = await this.dispatch(batches, chunk => this.run(chunk, ctx, usage, put), ctx)
    const notes = this.conclude(dispatched, usage, { total, asked, requestsBefore })
    return { grades, usage, notes }
  }

  /** One request; returns the number of documents without a usable score. */
  private async run(docs: Doc[], ctx: ScoreContext, usage: ScoreUsage, put: (needId: string, blockId: string, raw: number) => void): Promise<number> {
    const query = docs[0]!.need
    const result = await this.http.post(
      encodeRerankRequest(this.model, query, docs.map(d => d.text), this.extraBody), ctx,
      { estimatedInputTokens: estimatePlainTokens(query) + 16 + docs.reduce((n, d) => n + d.tokens, 0), usageOf: usageOfRerank },
    )
    usage.inputTokens += result.inputTokens
    usage.outputTokens += result.outputTokens
    if (result.estimated) usage.estimated = true
    const scores = decodeRerankResults(result.json, docs.length)
    let missing = 0
    docs.forEach((doc, i) => {
      const raw = scores.get(i)
      if (raw === undefined) { missing++; return }
      put(doc.needId, doc.blockId, raw)
      this.cache?.set(doc.probe, { grade: raw })
    })
    return missing
  }
}
