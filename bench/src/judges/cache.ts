/**
 * On-disk judge cache: bench/data/judge-cache/<judge>/<sha256>.json, so reruns
 * never re-bill. The key covers judge, model, rubric id+version, shared state,
 * the bound instructions (which include the candidate) and scoring options.
 * @module bench/judges/cache
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { BENCH_ROOT } from '../tasks.ts'
import { bindCandidate } from './rubrics.ts'
import type { Judge, JudgeItem, JudgeQuestion, JudgeResult } from './types.ts'

export const JUDGE_CACHE_DIR = path.join(BENCH_ROOT, 'data', 'judge-cache')

export function cacheKey(
  judge: Pick<Judge, 'id' | 'model'>, state: string, q: JudgeQuestion, item: JudgeItem, extra = '',
): string {
  const material = JSON.stringify([
    judge.id, judge.model, q.rubricId, q.rubricVersion, state,
    bindCandidate(q.instructions, item.text), q.criteria ?? null, q.options ?? null, extra,
  ])
  return crypto.createHash('sha256').update(material).digest('hex')
}

export type CachedResult = Omit<JudgeResult, 'id' | 'cached'>

export class JudgeCache {
  readonly dir: string
  constructor(root: string, judgeId: string) {
    this.dir = path.join(root, judgeId.replace(/[^a-zA-Z0-9._-]/g, '_'))
  }

  get(key: string): CachedResult | undefined {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, key + '.json'), 'utf8')) as CachedResult
    } catch {
      return undefined
    }
  }

  set(key: string, value: CachedResult): void {
    fs.mkdirSync(this.dir, { recursive: true })
    const file = path.join(this.dir, key + '.json')
    const tmp = file + '.tmp-' + process.pid
    fs.writeFileSync(tmp, JSON.stringify(value) + '\n')
    fs.renameSync(tmp, file)
  }
}

export interface CachedEvalOptions {
  judge: Pick<Judge, 'id' | 'model'>
  cache?: JudgeCache
  extraKey?: string
  state: string
  question: JudgeQuestion
  items: readonly JudgeItem[]
  /** Answer the missing items (in order) with remote calls; must return one result per item, in order. */
  runMisses: (items: JudgeItem[]) => Promise<JudgeResult[]>
}

/** Serve hits from the cache, send only the misses, cache successful answers, return in input order. */
export async function evaluateCached(opts: CachedEvalOptions): Promise<JudgeResult[]> {
  const { judge, cache, state, question, items } = opts
  const out: (JudgeResult | undefined)[] = new Array(items.length)
  const misses: { index: number; item: JudgeItem; key: string }[] = []
  items.forEach((item, index) => {
    const key = cacheKey(judge, state, question, item, opts.extraKey)
    const hit = cache?.get(key)
    if (hit && !hit.error) out[index] = { ...hit, id: item.id, cached: true }
    else misses.push({ index, item, key })
  })
  if (misses.length) {
    const fresh = await opts.runMisses(misses.map(m => m.item))
    misses.forEach((m, i) => {
      const result = fresh[i]!
      out[m.index] = result
      if (cache && !result.error) {
        const { id: _id, cached: _cached, ...rest } = result
        cache.set(m.key, rest)
      }
    })
  }
  return out as JudgeResult[]
}
