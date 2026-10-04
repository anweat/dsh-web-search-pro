/**
 * Coverage judge policy (dev-plan M9, S8): which needs the judge is asked about,
 * what it is shown (the "evidence view": the selected excerpts mapped to the
 * need), how its probability is read (bands against thresholds calibrated per
 * provider and rubric) and how a verdict changes the coverage.
 *
 * S8's rule ("a selected block has grade >= 2") is lexical: it cannot tell that
 * the docs do not contain the answer (dev-plan M3b). The judge asks the model
 * whether the excerpts by themselves state the answer. Modes:
 *   off     - nothing is asked (default);
 *   shadow  - asked and recorded in `stats.coverage`, the coverage is unchanged;
 *   control - a weak verdict turns a claimed-covered need into a `weak_support` gap
 *             (a critical one may trigger the bounded second round), an uncertain one
 *             stays covered with a caution marker.
 * A probability is meaningless without thresholds from a calibration on labelled
 * data, so control / shadow only run with thresholds for the provider and rubric
 * in use (configured, or the ones this plugin shipped for that pair).
 * @module web-search-pro/pipeline/coverage
 */

import type { CoverageJudge } from './judges/coverage.ts'
import type { ResolvedRubric } from './rubrics.ts'
import type { Coverage, SelectedBlock } from './select.ts'
import type { CoverageBand, Gap, Need } from './types.ts'

export const COVERAGE_MODES = ['off', 'shadow', 'control'] as const
export type CoverageMode = typeof COVERAGE_MODES[number]

/** `prob < weak` is weak, `prob >= covered` is covered, in between is uncertain. */
export interface CoverageThresholds { weak: number; covered: number }

/** `evidence.coverage` as the user writes it. */
export interface CoverageSettings {
  mode: CoverageMode
  /** Judge provider (default: `evidence.judge.provider`, else bocha-jev). Must speak the systemone protocol. */
  provider?: string | undefined
  /** Absent = the thresholds shipped for the provider + rubric pair, if any. */
  thresholds?: CoverageThresholds | undefined
}

/** The configured judge, ready to ask (built by the service from `evidence.coverage`). */
export interface CoverageStage {
  mode: 'shadow' | 'control'
  judge: CoverageJudge
  thresholds: CoverageThresholds
}

/** `evidence.coverage` validated: an invalid mode means off, an invalid provider is dropped; every problem is reported. */
export function resolveCoverageSettings(raw: unknown): { settings: CoverageSettings; diagnostics: string[] } {
  const off = { settings: { mode: 'off' as const }, diagnostics: [] as string[] }
  if (raw === undefined || raw === null) return off
  if (typeof raw !== 'object' || Array.isArray(raw)) return { settings: { mode: 'off' }, diagnostics: ['evidence.coverage ignored: not an object'] }
  const o = raw as Record<string, unknown>
  const diagnostics: string[] = []
  for (const k of Object.keys(o)) if (!['mode', 'provider', 'thresholds'].includes(k)) diagnostics.push('evidence.coverage: unknown field "' + k + '" ignored')
  let mode: CoverageMode = 'off'
  if (o.mode === undefined) mode = 'off'
  else if (typeof o.mode === 'string' && (COVERAGE_MODES as readonly string[]).includes(o.mode)) mode = o.mode as CoverageMode
  else diagnostics.push('evidence.coverage.mode "' + String(o.mode) + '" ignored (off is used): it must be one of ' + COVERAGE_MODES.join(', '))
  let provider: string | undefined
  if (o.provider !== undefined) {
    if (typeof o.provider === 'string' && o.provider.trim()) provider = o.provider
    else diagnostics.push('evidence.coverage.provider ignored: must be a provider id')
  }
  let thresholds: CoverageThresholds | undefined
  if (o.thresholds !== undefined) {
    const problems = thresholdsProblems(o.thresholds)
    if (problems.length) diagnostics.push('evidence.coverage.thresholds ignored: ' + problems.join('; '))
    else thresholds = { weak: (o.thresholds as CoverageThresholds).weak, covered: (o.thresholds as CoverageThresholds).covered }
  }
  return { settings: { mode, ...provider !== undefined ? { provider } : {}, ...thresholds ? { thresholds } : {} }, diagnostics }
}

export const COVERAGE_RUBRIC_ID = 'cover.sufficient'
/** Characters of the evidence view handed to the judge (the rubric's candidate cap). */
export const DEFAULT_VIEW_CHARS = 2400
/** Needs asked about at most (every claimed-covered need is asked; this only bounds a pathological task). */
export const MAX_COVERAGE_QUESTIONS = 12

/**
 * Thresholds fitted on the v1 CALIBRATION split (bench/README, dev-plan M9: false weak <= 5% of the truly covered claims,
 * then the most false claims removed; `covered` = lowest probability from which the standing claims reach 85% precision),
 * keyed `provider|rubric@version`. Another provider, model or rubric version has no entry: it needs `evidence.coverage.thresholds`.
 * Shipping them does not turn the judge on: `evidence.coverage.mode` stays `off` until set.
 */
export const CALIBRATED_THRESHOLDS: Readonly<Record<string, CoverageThresholds>> = {
  'bocha-jev|cover.sufficient@v1': { weak: 0.0512, covered: 0.313 },
}

export const thresholdKey = (providerId: string, rubric: Pick<ResolvedRubric, 'id' | 'version'>): string => providerId + '|' + rubric.id + '@' + rubric.version

/** Problems of a thresholds object; empty = valid. */
export function thresholdsProblems(raw: unknown): string[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return ['thresholds must be an object { weak, covered }']
  const out: string[] = []
  const t = raw as Record<string, unknown>
  for (const k of Object.keys(t)) if (k !== 'weak' && k !== 'covered') out.push('unknown threshold "' + k + '"')
  const num = (k: 'weak' | 'covered'): number | undefined => {
    const v = t[k]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) { out.push('thresholds.' + k + ' must be a number in 0..1'); return undefined }
    return v
  }
  const weak = num('weak')
  const covered = num('covered')
  if (weak !== undefined && covered !== undefined && weak > covered) out.push('thresholds.weak must not exceed thresholds.covered')
  return out
}

export interface ThresholdResolution { thresholds?: CoverageThresholds; source?: 'configured' | 'calibrated'; reason?: string }

/** The thresholds for this provider + rubric: configured, else the shipped pair calibration, else none (with the reason). */
export function resolveThresholds(settings: Pick<CoverageSettings, 'thresholds'>, providerId: string, rubric: Pick<ResolvedRubric, 'id' | 'version'>): ThresholdResolution {
  if (settings.thresholds !== undefined) {
    const problems = thresholdsProblems(settings.thresholds)
    if (problems.length) return { reason: 'evidence.coverage.thresholds ignored: ' + problems.join('; ') }
    return { thresholds: { weak: settings.thresholds.weak, covered: settings.thresholds.covered }, source: 'configured' }
  }
  const shipped = CALIBRATED_THRESHOLDS[thresholdKey(providerId, rubric)]
  if (shipped) return { thresholds: shipped, source: 'calibrated' }
  return { reason: 'no calibrated thresholds for ' + thresholdKey(providerId, rubric) + ': set evidence.coverage.thresholds { weak, covered } (fit on your own labels)' }
}

export function bandOf(prob: number, t: CoverageThresholds): CoverageBand {
  if (prob < t.weak) return 'weak'
  return prob >= t.covered ? 'covered' : 'uncertain'
}

// ── the evidence view ───────────────────────────────────────────────────────

const hostOf = (url: string): string => { try { return new URL(url).hostname } catch { return url } }

/**
 * What the judge reads for a need: the selected excerpts mapped to it, highest grade first (selection order on ties),
 * numbered, each with its title / host and heading, cut to `budget` characters (the last one is shortened when at
 * least 200 characters remain). Empty when no selected excerpt is mapped to the need.
 */
export function evidenceView(needId: string, selected: readonly SelectedBlock[], budget = DEFAULT_VIEW_CHARS): string {
  const rows = selected
    .map((s, order) => ({ s, order, grade: s.block.grades.get(needId)?.grade ?? 0, rank: s.block.grades.get(needId)?.rank ?? s.block.grades.get(needId)?.grade ?? 0 }))
    .filter(r => r.s.needIds.includes(needId))
    .sort((a, b) => b.grade - a.grade || b.rank - a.rank || a.order - b.order)
  const parts: string[] = []
  let used = 0
  for (const { s } of rows) {
    const head = '[' + (parts.length + 1) + '] ' + (s.block.title ? s.block.title.slice(0, 80) + ' — ' : '') + hostOf(s.block.url) + (s.block.block.heading ? '\n§ ' + s.block.block.heading.slice(0, 120) : '')
    const sep = parts.length ? 2 : 0
    const room = budget - used - sep - head.length - 1
    if (room >= s.excerpt.length) { parts.push(head + '\n' + s.excerpt); used += sep + head.length + 1 + s.excerpt.length; continue }
    if (room >= 200 || !parts.length) parts.push(head + '\n' + s.excerpt.slice(0, Math.max(room - 1, 1)) + '…')
    break
  }
  return parts.join('\n\n')
}

// ── verdicts ────────────────────────────────────────────────────────────────

export interface CoverageVerdict { needId: string; prob: number; band: CoverageBand }

export function verdictsOf(probs: ReadonlyMap<string, number>, thresholds: CoverageThresholds): CoverageVerdict[] {
  return [...probs].map(([needId, prob]) => ({ needId, prob: Number(prob.toFixed(4)), band: bandOf(prob, thresholds) }))
}

export interface JudgedCoverage extends Coverage {
  /** Covered needs the judge was unsure about. */
  uncertain: string[]
}

/** Control mode: weak verdicts leave `covered` and become `weak_support` gaps (needs order kept), uncertain ones stay covered and are listed. */
export function applyVerdicts(needs: readonly Need[], coverage: Coverage, verdicts: readonly CoverageVerdict[]): JudgedCoverage {
  const band = new Map(verdicts.map(v => [v.needId, v.band]))
  const weak = new Set(coverage.covered.filter(id => band.get(id) === 'weak'))
  const covered = coverage.covered.filter(id => !weak.has(id))
  const ruleGap = new Map(coverage.gaps.map(g => [g.needId, g]))
  const gaps: Gap[] = []
  for (const need of needs) {
    if (weak.has(need.id)) gaps.push({ needId: need.id, text: need.text, critical: need.critical, reason: 'weak_support', band: 'weak' })
    else { const gap = ruleGap.get(need.id); if (gap) gaps.push(gap) }
  }
  return { covered, gaps, uncertain: covered.filter(id => band.get(id) === 'uncertain') }
}
