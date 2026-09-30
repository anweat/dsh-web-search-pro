/**
 * DeepSeek as a reference (LLM) judge: batches numbered candidates into one
 * chat request and asks for strict JSON. Also the labeler's model family, so
 * enable it in run-judges only knowingly (leakage).
 * @module bench/judges/deepseek
 */

import { evaluateCached, type JudgeCache } from './cache.ts'
import type { BudgetGuard } from './budget.ts'
import { DEEPSEEK_MODEL, parseJsonLoose, type DeepSeekClient, type Effort } from './deepseek-client.ts'
import { bindCandidate } from './rubrics.ts'
import type { Judge, JudgeItem, JudgeQuestion, JudgeResult, Readiness } from './types.ts'

export interface DeepSeekJudgeOptions {
  client: DeepSeekClient
  model?: string
  effort?: Effort
  cache?: JudgeCache
  guard?: BudgetGuard
  /** Items per request. */
  chunkSize?: number
  candidateChars?: number
}

export class DeepSeekJudge implements Judge {
  readonly id = 'deepseek'
  readonly model: string
  private readonly o: DeepSeekJudgeOptions & { chunkSize: number; candidateChars: number }

  constructor(options: DeepSeekJudgeOptions) {
    this.o = { chunkSize: 20, candidateChars: 700, ...options }
    this.model = options.model ?? DEEPSEEK_MODEL
  }

  async ready(): Promise<Readiness> {
    return { ready: true }
  }

  async evaluate(state: string, q: JudgeQuestion, items: readonly JudgeItem[]): Promise<JudgeResult[]> {
    return evaluateCached({
      judge: this, cache: this.o.cache, state, question: q, items,
      extraKey: String(this.o.effort ?? '') + '|' + this.o.candidateChars,
      runMisses: async misses => {
        const out: JudgeResult[] = []
        for (let i = 0; i < misses.length; i += this.o.chunkSize) {
          out.push(...await this.runChunk(state, q, misses.slice(i, i + this.o.chunkSize)))
        }
        return out
      },
    })
  }

  private async runChunk(state: string, q: JudgeQuestion, chunk: JudgeItem[]): Promise<JudgeResult[]> {
    const fail = (item: JudgeItem, error: string): JudgeResult => ({
      id: item.id, judge: this.id, model: this.model, rubricId: q.rubricId, rubricVersion: q.rubricVersion, latencyMs: 0, error,
    })
    await this.o.guard?.assertOk()
    let response
    try {
      response = await this.o.client.chat({
        model: this.model, effort: this.o.effort, json: true, maxTokens: 4000,
        messages: buildMessages(state, q, chunk, this.o.candidateChars),
      })
    } catch (error) {
      return chunk.map(item => fail(item, (error as Error).message))
    }
    await this.o.guard?.check()
    const parsed = parseAnswers(parseJsonLoose(response.content), q, chunk.length)
    const requestId = 'deepseek-' + this.o.client.requests
    return chunk.map((item, i): JudgeResult => {
      const answer = parsed.get(i + 1)
      const common = {
        id: item.id, judge: this.id, model: this.model, rubricId: q.rubricId, rubricVersion: q.rubricVersion,
        latencyMs: response.latencyMs, requestId, batchSize: chunk.length,
        usage: i === 0 ? { inputTokens: response.inputTokens, outputTokens: response.outputTokens } : undefined,
      }
      if (!answer) return { ...common, error: 'no valid answer for item ' + (i + 1) }
      return { ...common, ...answer }
    })
  }
}

export function buildMessages(state: string, q: JudgeQuestion, chunk: readonly JudgeItem[], candidateChars: number) {
  const numbered = chunk.map((item, i) => '[' + (i + 1) + '] ' + (item.text.length > candidateChars ? item.text.slice(0, candidateChars) + '…' : item.text)).join('\n')
  const question = bindCandidate(q.instructions, '（见下方编号候选）')
  let format: string
  if (q.kind === 'noul') {
    format = '对每个候选给出该问题答案为“是”的概率 p（0 到 1 的小数）。输出 JSON：{"results":[{"i":1,"p":0.93}, ...]}'
  } else if (q.kind === 'score') {
    const levels = (q.criteria ?? []).map((c, i) => i + '：' + c).join('；')
    format = '对每个候选给出等级 grade（整数，' + levels + '）。输出 JSON：{"results":[{"i":1,"grade":2}, ...]}'
  } else {
    const opts = Object.entries(q.options ?? {}).map(([k, v]) => k + '：' + v).join('；')
    format = '对每个候选从下列选项中选一个 choice（' + opts + '）。输出 JSON：{"results":[{"i":1,"choice":"general"}, ...]}'
  }
  return [
    { role: 'system' as const, content: '你是严格、保守的评判器。只输出 JSON，不要任何解释。必须覆盖每个编号。' },
    { role: 'user' as const, content: [state, '', question, '', '候选：', numbered, '', format].join('\n') },
  ]
}

type Parsed = Pick<JudgeResult, 'prob' | 'grade' | 'decision' | 'probabilities'>

export function parseAnswers(json: unknown, q: JudgeQuestion, n: number): Map<number, Parsed> {
  const out = new Map<number, Parsed>()
  const list = Array.isArray(json) ? json : (json as { results?: unknown } | undefined)?.results
  if (!Array.isArray(list)) return out
  for (const row of list as Record<string, unknown>[]) {
    const i = Number(row?.i)
    if (!Number.isInteger(i) || i < 1 || i > n || out.has(i)) continue
    if (q.kind === 'noul') {
      const p = Number(row.p)
      if (Number.isFinite(p) && p >= 0 && p <= 1) out.set(i, { prob: p, decision: p >= 0.5 ? 'true' : 'false' })
    } else if (q.kind === 'score') {
      const g = Number(row.grade)
      const max = (q.criteria?.length ?? 4) - 1
      if (Number.isFinite(g) && g >= 0 && g <= max) out.set(i, { grade: g, decision: String(Math.round(g)) })
    } else if (typeof row.choice === 'string' && q.options && row.choice in q.options) {
      out.set(i, { decision: row.choice, prob: 1, probabilities: { [row.choice]: 1 } })
    }
  }
  return out
}
