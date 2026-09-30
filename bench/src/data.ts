/**
 * Bench data access shared by the labeler, the judge runner and the report:
 * directory layout, candidate de-duplication, label IO.
 * @module bench/data
 */

import fs from 'node:fs'
import path from 'node:path'
import { canonicalUrl } from './harvest-lib.ts'
import { BENCH_ROOT } from './tasks.ts'
import type { Block, CandidateSnapshot, Label, PageSnapshot } from './types.ts'

export const DATA_DIR = path.join(BENCH_ROOT, 'data')
export const CANDIDATES_DIR = path.join(DATA_DIR, 'candidates.v1')
export const LABELS_DIR = path.join(DATA_DIR, 'labels.v1')
export const RUNS_DIR = path.join(DATA_DIR, 'runs')
export const JUDGE_CACHE_ROOT = path.join(DATA_DIR, 'judge-cache')

export interface Candidate {
  /** First-seen raw URL. */
  url: string
  key: string
  title: string
  snippet: string
  publishedAt?: string
  /** `engine#rank` provenance. */
  from: string[]
}

/** Unique candidates of a snapshot in first-seen order (engine runs in file order). */
export function candidatesOf(snapshot: CandidateSnapshot): Candidate[] {
  const byKey = new Map<string, Candidate>()
  for (const run of snapshot.engineRuns) {
    for (const r of run.results) {
      const key = canonicalUrl(r.url)
      const tag = run.engine + '#' + r.rank
      const existing = byKey.get(key)
      if (existing) {
        existing.from.push(tag)
        if (!existing.title && r.title) existing.title = r.title
        if (!existing.snippet && r.snippet) existing.snippet = r.snippet
        if (!existing.publishedAt && r.publishedAt) existing.publishedAt = r.publishedAt
      } else {
        byKey.set(key, { url: r.url, key, title: r.title ?? '', snippet: r.snippet ?? '', publishedAt: r.publishedAt, from: [tag] })
      }
    }
  }
  return [...byKey.values()]
}

export function candidateText(c: Pick<Candidate, 'title' | 'snippet'>): string {
  return [c.title, c.snippet].filter(Boolean).join('\n')
}

export interface FetchedBlock { page: PageSnapshot; block: Block }

/** Blocks of successfully fetched pages. */
export function fetchedBlocks(snapshot: CandidateSnapshot): FetchedBlock[] {
  return snapshot.pages.filter(p => p.status === 'ok').flatMap(page => page.blocks.map(block => ({ page, block })))
}

export function labelPath(dir: string, taskId: string): string {
  return path.join(dir, taskId + '.json')
}

export function readLabel(dir: string, taskId: string): Label | undefined {
  try {
    return JSON.parse(fs.readFileSync(labelPath(dir, taskId), 'utf8')) as Label
  } catch {
    return undefined
  }
}

export function writeLabel(dir: string, label: Label): void {
  fs.mkdirSync(dir, { recursive: true })
  const file = labelPath(dir, label.taskId)
  const tmp = file + '.tmp-' + process.pid
  fs.writeFileSync(tmp, JSON.stringify(label, null, 1) + '\n')
  fs.renameSync(tmp, file)
}

export function readSnapshotFile(dir: string, taskId: string): CandidateSnapshot | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, taskId + '.json'), 'utf8')) as CandidateSnapshot
  } catch {
    return undefined
  }
}
