/**
 * TaskSpec assembly from `search.run` parameters (dev-plan §4.2).
 * Needs come as `;`-separated text or a JSON array, constraints as a JSON
 * array; everything is validated here so the pipeline only sees a clean spec.
 * @module web-search-pro/pipeline/task
 */

import { CONSTRAINT_KINDS, PROFILES, type BudgetProfile, type Constraint, type ConstraintKind, type Need, type Profile, type TaskSpec } from './types.ts'

/** More needs than this are cut (each need costs S6 scoring calls). */
export const MAX_NEEDS = 6
export const MAX_CONSTRAINTS = 12
const MAX_TEXT = 300

export interface TaskInput {
  query: string
  /** Short goal; defaults to the query. */
  task?: string | undefined
  profile?: string | undefined
  needs?: unknown
  constraints?: unknown
  /** Evidence excerpt budget in characters. */
  budget?: number | undefined
}

export interface BuiltTask { spec: TaskSpec; notes: string[] }

const clip = (value: string): string => value.trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT)

function asJson(raw: unknown, what: string): unknown {
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) } catch { throw new Error(what + ' is not valid JSON') }
}

export function parseProfile(value: string | undefined): Profile | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const profile = value.trim().toLowerCase()
  if (!(PROFILES as readonly string[]).includes(profile)) throw new Error('profile must be one of ' + PROFILES.join(', '))
  return profile as Profile
}

/** `a;b;c`, a JSON array of strings, or a JSON array of `{text, critical?}`. Needs are critical unless stated otherwise. */
export function parseNeeds(raw: unknown, fallbackGoal: string): { needs: Need[]; truncated: boolean } {
  let entries: { text: string; critical: boolean }[] = []
  if (Array.isArray(raw) || (typeof raw === 'string' && raw.trim().startsWith('['))) {
    const list = asJson(raw, 'needs')
    if (!Array.isArray(list)) throw new Error('needs must be a JSON array or a ";"-separated string')
    entries = list.map((item): { text: string; critical: boolean } => {
      if (typeof item === 'string') return { text: clip(item), critical: true }
      if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
        const { text, critical } = item as { text: string; critical?: unknown }
        return { text: clip(text), critical: critical !== false }
      }
      throw new Error('each need must be a string or {text, critical?}')
    })
  } else if (typeof raw === 'string') {
    entries = raw.split(/[;；\n]/).map(part => ({ text: clip(part), critical: true }))
  }
  entries = entries.filter(entry => entry.text)
  if (!entries.length) entries = [{ text: clip(fallbackGoal), critical: true }]
  const truncated = entries.length > MAX_NEEDS
  return { needs: entries.slice(0, MAX_NEEDS).map((entry, i) => ({ id: 'n' + (i + 1), text: entry.text, critical: entry.critical })), truncated }
}

/** JSON array of `{kind, value, strength?}`; strength defaults to soft (a preference never shrinks recall). */
export function parseConstraints(raw: unknown): Constraint[] {
  if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) return []
  const list = asJson(raw, 'constraints')
  if (!Array.isArray(list)) throw new Error('constraints must be a JSON array of {kind, value, strength}')
  return list.slice(0, MAX_CONSTRAINTS).map((item, i): Constraint => {
    if (!item || typeof item !== 'object') throw new Error('each constraint must be an object {kind, value, strength}')
    const { kind, value, strength } = item as { kind?: unknown; value?: unknown; strength?: unknown }
    if (typeof kind !== 'string' || !(CONSTRAINT_KINDS as readonly string[]).includes(kind)) throw new Error('constraint kind must be one of ' + CONSTRAINT_KINDS.join(', '))
    if (typeof value !== 'string' || !value.trim()) throw new Error('constraint ' + kind + ' needs a non-empty value')
    if (strength !== undefined && strength !== 'hard' && strength !== 'soft') throw new Error('constraint strength must be hard or soft')
    return { id: 'c' + (i + 1), kind: kind as ConstraintKind, value: clip(value), strength: strength ?? 'soft', origin: 'param' }
  })
}

export function buildTaskSpec(input: TaskInput): BuiltTask {
  const query = input.query.trim()
  if (!query) throw new Error('query must be a non-empty string')
  const goal = clip(input.task ?? '') || clip(query)
  const notes: string[] = []
  const profile = parseProfile(input.profile)
  const { needs, truncated } = parseNeeds(input.needs, goal)
  if (truncated) notes.push('only the first ' + MAX_NEEDS + ' needs were used')
  const budget: BudgetProfile = {}
  if (input.budget !== undefined) {
    if (!Number.isFinite(input.budget) || input.budget < 500) throw new Error('budget must be a number of characters (at least 500)')
    budget.chars = Math.min(Math.floor(input.budget), 30_000)
  }
  return { spec: { goal, query, ...profile ? { profile } : {}, needs, constraints: parseConstraints(input.constraints), budget }, notes }
}
