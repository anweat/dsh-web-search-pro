/**
 * Task-set loading, validation and the deterministic calibration/test split.
 * @module bench/tasks
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONSTRAINT_KINDS, PROFILES, TASK_LANGS,
  type BenchTask, type Split,
} from './types.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

export const BENCH_ROOT = path.resolve(here, '..')
export const TASKS_FILE = path.join(BENCH_ROOT, 'tasks', 'tasks.v1.jsonl')

/**
 * Task-set versions. v1 is the tuning set (calibration/test split). v2 is the held-out set:
 * its tasks must never be used to choose thresholds, prompts or any other parameter.
 */
export type TaskSet = 'v1' | 'v2'
export const TASK_SETS: readonly TaskSet[] = ['v1', 'v2']

export interface TaskSetPaths { tasksFile: string; candidatesDir: string; labelsDir: string }

export function taskSetPaths(set: TaskSet = 'v1'): TaskSetPaths {
  return {
    tasksFile: path.join(BENCH_ROOT, 'tasks', 'tasks.' + set + '.jsonl'),
    candidatesDir: path.join(BENCH_ROOT, 'data', 'candidates.' + set),
    labelsDir: path.join(BENCH_ROOT, 'data', 'labels.' + set),
  }
}

/** Parse the `--task-set` flag value (default v1). */
export function parseTaskSet(value: string | true | undefined): TaskSet {
  if (value === undefined) return 'v1'
  if (typeof value === 'string' && (TASK_SETS as readonly string[]).includes(value)) return value as TaskSet
  throw new Error('--task-set must be ' + TASK_SETS.join('|'))
}

/** Load the tasks of a task-set version. */
export function loadTaskSet(set: TaskSet = 'v1'): BenchTask[] {
  return loadTasks(taskSetPaths(set).tasksFile)
}

/** Validate one parsed task; returns a list of problems (empty = valid). */
export function validateTask(task: unknown): string[] {
  const errors: string[] = []
  if (!task || typeof task !== 'object') return ['not an object']
  const t = task as Record<string, unknown>
  const str = (key: string): void => {
    if (typeof t[key] !== 'string' || !(t[key] as string).trim()) errors.push(key + ' must be a non-empty string')
  }
  str('id'); str('goal'); str('query'); str('notes')
  if (typeof t.id === 'string' && !/^(v\d+-)?[a-z]{2}-\d{2,3}$/.test(t.id)) errors.push('id must look like dc-01 or v2-dc-01')
  if (!PROFILES.includes(t.profile as never)) errors.push('bad profile: ' + String(t.profile))
  if (!TASK_LANGS.includes(t.lang as never)) errors.push('bad lang: ' + String(t.lang))
  if (!Array.isArray(t.needs) || t.needs.length === 0) errors.push('needs must be a non-empty array')
  else {
    const ids = new Set<string>()
    for (const n of t.needs as Record<string, unknown>[]) {
      if (typeof n?.id !== 'string' || typeof n?.text !== 'string' || typeof n?.critical !== 'boolean') errors.push('bad need: ' + JSON.stringify(n))
      else if (ids.has(n.id)) errors.push('duplicate need id ' + n.id)
      else ids.add(n.id)
    }
    if (!(t.needs as { critical?: boolean }[]).some(n => n?.critical)) errors.push('at least one need must be critical')
  }
  if (!Array.isArray(t.constraints)) errors.push('constraints must be an array')
  else {
    const ids = new Set<string>()
    for (const c of t.constraints as Record<string, unknown>[]) {
      if (typeof c?.id !== 'string' || typeof c?.value !== 'string' || !(c.value as string).trim()) errors.push('bad constraint: ' + JSON.stringify(c))
      else if (ids.has(c.id)) errors.push('duplicate constraint id ' + c.id)
      else ids.add(c.id)
      if (!CONSTRAINT_KINDS.includes(c?.kind as never)) errors.push('bad constraint kind: ' + String(c?.kind))
      if (c?.strength !== 'hard' && c?.strength !== 'soft') errors.push('bad constraint strength: ' + String(c?.strength))
    }
  }
  if (!Array.isArray(t.traps) || t.traps.length === 0 || t.traps.some(x => typeof x !== 'string' || !x)) errors.push('traps must be a non-empty string array')
  return errors
}

/** Parse + validate a JSONL task file. Throws with every problem listed. */
export function loadTasks(file = TASKS_FILE): BenchTask[] {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim())
  const tasks: BenchTask[] = []
  const problems: string[] = []
  const seen = new Set<string>()
  lines.forEach((line, i) => {
    let parsed: unknown
    try { parsed = JSON.parse(line) } catch (error) {
      problems.push('line ' + (i + 1) + ': invalid JSON (' + (error as Error).message + ')')
      return
    }
    const errors = validateTask(parsed)
    const id = (parsed as { id?: string } | null)?.id ?? '?'
    if (seen.has(id)) errors.push('duplicate task id')
    seen.add(id)
    if (errors.length) problems.push('line ' + (i + 1) + ' (' + id + '): ' + errors.join('; '))
    else tasks.push(parsed as BenchTask)
  })
  if (problems.length) throw new Error('invalid task file ' + file + ':\n' + problems.join('\n'))
  return tasks
}

/**
 * Deterministic calibration/test split, stratified by profile: within each
 * profile tasks are ordered by sha1(id) and the first half (rounded up) goes
 * to `calibration`. Adding tasks later can move existing ones, so freeze the
 * result into a file before labeling (see README).
 *
 * For the v2 set every task is `heldout` (no calibration half): v2 is only used
 * to check parameters that were frozen on v1.
 */
export function assignSplits(tasks: readonly BenchTask[], set: TaskSet = 'v1'): Map<string, Split> {
  const out = new Map<string, Split>()
  if (set === 'v2') {
    for (const t of tasks) out.set(t.id, 'heldout')
    return out
  }
  const byProfile = new Map<string, BenchTask[]>()
  for (const t of tasks) byProfile.set(t.profile, [...byProfile.get(t.profile) ?? [], t])
  for (const group of byProfile.values()) {
    const ordered = [...group].sort((a, b) => hashId(a.id).localeCompare(hashId(b.id)))
    const cut = Math.ceil(ordered.length / 2)
    ordered.forEach((t, i) => out.set(t.id, i < cut ? 'calibration' : 'test'))
  }
  return out
}

function hashId(id: string): string {
  return crypto.createHash('sha1').update(id).digest('hex')
}
