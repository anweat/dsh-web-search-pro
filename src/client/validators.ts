/**
 * Validation behind the settings card. Every rule that has a server counterpart is the server's own function
 * (providers-spec, rubrics-spec, coverage, budget-spec): the card calls it, it does not restate it. Pure and free of
 * Node imports, so it ships in the client bundle.
 * @module web-search-pro/client/validators
 */

import { resolveBudget } from '../pipeline/budget-spec.ts'
import { CALIBRATED_THRESHOLDS, thresholdKey, thresholdsProblems } from '../pipeline/coverage.ts'
import { DEFAULT_PROVIDER_ID, PRESETS, resolveProviders, unusableReason, type JudgeSettings } from '../pipeline/judges/providers-spec.ts'
import { BUILTIN_RUBRIC_IDS, builtinDef, overrideProblems } from '../pipeline/rubrics-spec.ts'
import { getAt, isRecord, rubricField, type Json, type SettingField } from './form-specs.ts'

/** A problem found in the (draft) evidence settings, attached to the control it concerns. */
export interface Issue {
  field: SettingField
  message: string
  /** `error`: the server would ignore the value. `warning`: accepted, but probably not what was meant. */
  level: 'error' | 'warning'
  /** Other controls whose editing can cause this (an error blocks the save while any of them has a pending change). */
  related?: SettingField[]
}

/** Key names that mean "a secret lives here": a provider definition carries a `keyRef` name, never the key. */
const SECRET_KEY = /(^|[^a-z])(api[-_]?key|apikey|token|secret|password|passwd|authorization|bearer)([^a-z]|$)/i

function secretPaths(value: unknown, trail: string, out: string[]): void {
  if (Array.isArray(value)) { value.forEach((item, index) => { secretPaths(item, trail + '[' + index + ']', out) }); return }
  if (!isRecord(value)) return
  for (const [key, entry] of Object.entries(value)) {
    const here = trail ? trail + '.' + key : key
    if (key !== 'keyRef' && SECRET_KEY.test(key)) out.push(here)
    else secretPaths(entry, here, out)
  }
}

export interface CustomProviders {
  /** Why entries are ignored by the server (it keeps going with the others). */
  problems: string[]
  /** Ids of the custom entries that are usable (presets that were overridden validly are included). */
  ids: string[]
}

/**
 * `evidence.judge.providers`: the server's own `resolveProviders` over the draft, plus a refusal to carry secrets in a
 * definition (the card never shows or stores a key value: `keyRef` names the environment variable / credentials entry).
 */
export function customProviders(providers: unknown): CustomProviders {
  if (providers === undefined) return { problems: [], ids: [] }
  if (!isRecord(providers)) return { problems: ['evidence.judge.providers must be an object keyed by provider id'], ids: [] }
  const { providers: catalog, diagnostics } = resolveProviders({ providers })
  const problems = [...diagnostics]
  const secret = new Set<string>()
  for (const [id, entry] of Object.entries(providers)) {
    const found: string[] = []
    secretPaths(entry, '', found)
    for (const where of found) problems.push('evidence.judge.providers.' + id + '.' + where + ' looks like a secret: keep the key in the environment or DSH credentials and name it with keyRef')
    if (found.length) secret.add(id)
  }
  // The server's diagnostics read `evidence.judge.providers.<id> ignored...`: an entry named there is not usable.
  const ignored = (id: string): boolean => diagnostics.some(message => message.startsWith('evidence.judge.providers.' + id + ' ignored'))
  return { problems, ids: Object.keys(providers).filter(id => catalog.has(id) && !secret.has(id) && !ignored(id)) }
}

/** Ids the judge provider selects can name: the presets and the valid custom entries. */
export function providerChoices(providers: unknown): string[] {
  return [...new Set([...Object.keys(PRESETS), ...customProviders(providers).ids])]
}

/** The version a new override of a rubric starts with: the built-in label counted up (`v1` -> `v2`). */
export function nextVersion(version: string): string {
  const match = /^(.*?)(\d+)$/.exec(version)
  return match ? match[1] + String(Number(match[2]) + 1) : version + '2'
}

/**
 * Problems of one rubric override entry: the server's `overrideProblems`, plus the card's stricter rule that the version
 * label must differ from the built-in one (an override on the shipped label is indistinguishable from the default in logs).
 */
export function rubricEntryProblems(id: string, entry: unknown): string[] {
  const problems = overrideProblems(id, entry)
  const base = builtinDef(id)
  if (base && isRecord(entry) && entry.version === base.version && !problems.some(p => p.startsWith('changed content'))) problems.push('version must differ from the built-in "' + base.version + '"')
  return problems
}

/** The rubric entries of an evidence object that carry any problem, by rubric id. */
export function rubricIssues(rubrics: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (!isRecord(rubrics)) return out
  for (const [id, entry] of Object.entries(rubrics)) {
    const problems = rubricEntryProblems(id, entry)
    if (problems.length) out[id] = problems
  }
  return out
}

/**
 * Everything wrong or doubtful in an effective `evidence` object, per control. Errors are values the server would
 * ignore; warnings are accepted values that cannot do what the mode asks (a placeholder provider, no thresholds).
 */
export function evidenceIssues(ev: Json): Issue[] {
  const issues: Issue[] = []
  const add = (field: SettingField, message: string, level: Issue['level'] = 'error', related?: SettingField[]): void => { issues.push({ field, message, level, ...related ? { related } : {} }) }

  const judge = isRecord(ev.judge) ? ev.judge : {}
  const custom = customProviders(judge.providers)
  if (custom.problems.length) add('evidence.judge.providers', custom.problems.join('\n'))
  const settings: JudgeSettings = { ...typeof judge.provider === 'string' ? { provider: judge.provider } : {}, allowLlm: judge.allowLlm === true, ...isRecord(judge.providers) ? { providers: judge.providers } : {} }
  const catalog = resolveProviders(settings).providers

  const selected = typeof judge.provider === 'string' && judge.provider ? judge.provider : DEFAULT_PROVIDER_ID
  const mode = typeof getAt(ev, ['judge', 'mode']) === 'string' ? getAt(ev, ['judge', 'mode']) : ev.jevMode
  if (typeof judge.provider === 'string' && judge.provider && !catalog.has(judge.provider)) add('evidence.judge.provider', 'provider "' + judge.provider + '" is not defined (known: ' + [...catalog.keys()].join(', ') + ')', 'error', ['evidence.judge.providers'])
  else if (mode !== undefined && mode !== 'off') {
    const why = unusableReason(catalog.get(selected)!, settings)
    if (why) add('evidence.judge.provider', why, 'warning')
  }

  const coverage = isRecord(ev.coverage) ? ev.coverage : {}
  const thresholds = coverage.thresholds
  if (thresholds !== undefined) {
    const problems = thresholdsProblems(thresholds)
    const both: SettingField[] = ['evidence.coverage.thresholds.weak', 'evidence.coverage.thresholds.covered']
    for (const problem of problems) {
      // Each message names the threshold it is about; the relation between the two (weak above covered) belongs to both.
      const fields: SettingField[] = problem.includes('exceed') ? both : [problem.includes('thresholds.weak') ? both[0]! : both[1]!]
      for (const field of fields) add(field, problem, 'error', both)
    }
  }
  if (coverage.mode === 'shadow' || coverage.mode === 'control') {
    const providerId = typeof coverage.provider === 'string' && coverage.provider ? coverage.provider : selected
    const provider = catalog.get(providerId)
    if (typeof coverage.provider === 'string' && coverage.provider && !provider) add('evidence.coverage.provider', 'provider "' + coverage.provider + '" is not defined (known: ' + [...catalog.keys()].join(', ') + ')', 'error', ['evidence.judge.providers'])
    else if (provider && provider.protocol !== 'systemone') add('evidence.coverage.provider', 'the coverage judge needs a provider speaking the systemone protocol; ' + providerId + ' speaks ' + provider.protocol, 'warning')
    if (thresholds === undefined) {
      const rubric = isRecord(ev.rubrics) && isRecord(ev.rubrics['cover.sufficient']) && rubricEntryProblems('cover.sufficient', ev.rubrics['cover.sufficient']).length === 0
        ? String((ev.rubrics['cover.sufficient'] as Json).version)
        : builtinDef('cover.sufficient')!.version
      const key = thresholdKey(providerId, { id: 'cover.sufficient', version: rubric })
      if (!CALIBRATED_THRESHOLDS[key]) add('evidence.coverage.thresholds.weak', 'no calibrated thresholds for ' + key + ': set both thresholds (fitted on your own labels) or the judge stays off', 'warning')
    }
  }

  if (ev.budget !== undefined) {
    const diagnostics = resolveBudget(isRecord(ev.budget) ? ev.budget : {}).diagnostics
    for (const message of diagnostics) {
      const field: SettingField = message.includes('.timezone') ? 'evidence.budget.timezone'
        : message.includes('.providers') ? 'evidence.budget.providers'
          : message.includes('dailyInputTokens') ? 'evidence.budget.dailyInputTokens' : 'evidence.budget.perSearchInputTokens'
      add(field, message)
    }
  }

  for (const [id, problems] of Object.entries(rubricIssues(ev.rubrics))) add(rubricField(id), problems.join('\n'))
  return issues
}

/** Rubric override ids in a settings object that name no built-in rubric (the server ignores them). */
export function unknownRubricIds(rubrics: unknown): string[] {
  return isRecord(rubrics) ? Object.keys(rubrics).filter(id => !BUILTIN_RUBRIC_IDS.includes(id)) : []
}
