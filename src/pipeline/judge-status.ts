/**
 * Read-only description of the judge layer for `sources.status`: which provider is
 * configured and whether it is usable, plus today's model usage against the caps.
 * Makes no network request and never shows a credential.
 * @module web-search-pro/pipeline/judge-status
 */

import type { EvidenceConfig } from '../config.ts'
import type { Store } from '../store.ts'
import { COVERAGE_RUBRIC_ID, resolveCoverageSettings, resolveThresholds, type CoverageMode } from './coverage.ts'
import { calibrationKey } from './judges/calibration.ts'
import { resolveProviders, selectProvider, unusableReason, DEFAULT_PROVIDER_ID } from './judges/providers.ts'
import { resolveBudget, UsageLedger } from './ledger.ts'
import { resolveRubric } from './rubrics.ts'

export type JudgeMode = EvidenceConfig['jevMode']

/** What decides S6 for the configured mode, ignoring whether the provider is usable (service.ts `scorers` makes the same choice). */
export function configuredDecider(cfg: EvidenceConfig): { mode: JudgeMode; decides: 'rule' | 'hybrid' | 'model'; note?: string } {
  const mode = cfg.judge?.mode ?? cfg.jevMode
  if (mode === 'off') return { mode, decides: 'rule', ...cfg.scorer === 'jev' ? { note: 'scorer=jev is ignored while the mode is off' } : {} }
  if (mode === 'shadow') return { mode, decides: 'rule', note: 'the model only observes (scores are recorded, not used)' }
  if (mode === 'hybrid') return { mode, decides: 'hybrid', note: 'rule grades everything; the model re-scores language-mismatched' + (cfg.hybridBorderline ? ' and borderline' : '') + ' pairs' }
  // control: the neutral `judge.mode` is a single explicit switch; the legacy `jevMode` also needs `scorer: jev`.
  if (cfg.judge?.mode === 'control' || cfg.scorer === 'jev') return { mode, decides: 'model' }
  return { mode, decides: 'rule', note: 'control needs scorer=jev (or judge.mode=control): the rule scorer decides' }
}

/** The S8 coverage judge as configured (dev-plan M9); absent while `evidence.coverage.mode` is off. */
export interface CoverageStatus {
  mode: Exclude<CoverageMode, 'off'>
  provider: string
  /** Rubric `id@version`. */
  rubric: string
  /** Whether a run would use the judge now; when not, the rule coverage stays and `reason` says why. */
  usable: boolean
  reason?: string
  thresholds?: { weak: number; covered: number }
  thresholdSource?: 'configured' | 'calibrated'
  keyConfigured?: boolean
}

export interface JudgeStatus {
  /** Effective judge mode (`judge.mode`, else the legacy `jevMode`), not the legacy `scorer` flag. */
  mode: JudgeMode
  /** Who decides S6 right now: the rule scorer, the hybrid rule+model scorer, or the model; a model mode falls back to `rule` when the provider is unusable or its key is missing. */
  decides: 'rule' | 'hybrid' | 'model'
  modeNote?: string
  provider: { id: string; protocol?: string; model?: string; usable: boolean; reason?: string; unverified?: boolean; calibration?: string; keyConfigured?: boolean }
  /** Ids of every defined provider (presets and custom). */
  providers: string[]
  coverage?: CoverageStatus
  /** Absent when the store cannot be read. */
  usage?: {
    day: string
    timezone?: string
    requests: number
    inputTokens: number
    outputTokens: number
    /** Some of today's token figures are estimates. */
    estimated: boolean
    /** Every call of the day has a price (the provider declares one); false = money spent is unknown, not zero. */
    amountKnown: boolean
    amount?: number
    currency?: string
    caps: { perSearchInputTokens: number; dailyInputTokens: number }
    byProvider: { provider: string; protocol?: string; requests: number; inputTokens: number; outputTokens: number; estimated: boolean }[]
  }
  diagnostics: string[]
}

async function coverageStatus(cfg: EvidenceConfig, hasSecret: ((ref: string) => Promise<boolean>) | undefined): Promise<CoverageStatus | undefined> {
  const { settings } = resolveCoverageSettings(cfg.coverage)
  if (settings.mode === 'off') return undefined
  const selection = selectProvider({ ...cfg.judge, ...settings.provider !== undefined ? { provider: settings.provider } : {} })
  const id = settings.provider ?? cfg.judge?.provider ?? DEFAULT_PROVIDER_ID
  const rubric = resolveRubric(COVERAGE_RUBRIC_ID, cfg.rubrics).rubric
  const base = { mode: settings.mode, provider: id, rubric: rubric.id + '@' + rubric.version }
  const provider = selection.provider
  if (!provider) return { ...base, usable: false, reason: selection.unusable ?? 'no judge provider' }
  if (provider.protocol !== 'systemone') return { ...base, usable: false, reason: 'provider ' + id + ' speaks ' + provider.protocol + ', the coverage judge needs the systemone protocol' }
  const fit = resolveThresholds(settings, provider.id, rubric)
  let keyConfigured: boolean | undefined
  if (provider.keyRef && hasSecret) {
    try { keyConfigured = await hasSecret(provider.keyRef) } catch { /* credentials service unavailable: unknown */ }
  }
  const why = !fit.thresholds ? fit.reason : keyConfigured === false ? 'key not found for ' + provider.keyRef : undefined
  return { ...base, usable: !why, ...why ? { reason: why } : {}, ...fit.thresholds ? { thresholds: fit.thresholds, thresholdSource: fit.source! } : {}, ...keyConfigured !== undefined ? { keyConfigured } : {} }
}

export async function judgeStatus(cfg: EvidenceConfig, store: Store, options: { now?: (() => number) | undefined; hasSecret?: ((ref: string) => Promise<boolean>) | undefined } = {}): Promise<JudgeStatus> {
  const catalog = resolveProviders(cfg.judge)
  const selection = selectProvider(cfg.judge)
  const id = cfg.judge?.provider ?? DEFAULT_PROVIDER_ID
  const defined = catalog.providers.get(id)
  const reason = defined ? unusableReason(defined, cfg.judge) : selection.unusable
  let keyConfigured: boolean | undefined
  if (defined?.keyRef && options.hasSecret) {
    try { keyConfigured = await options.hasSecret(defined.keyRef) } catch { /* credentials service unavailable: unknown */ }
  }
  const budget = resolveBudget(cfg.budget)
  let snapshot: ReturnType<UsageLedger['today']> | undefined
  try { snapshot = new UsageLedger(store, budget.caps, options.now).today() } catch { /* store unreadable: report the rest */ }
  const configured = configuredDecider(cfg)
  const coverage = await coverageStatus(cfg, options.hasSecret)
  const fallback = configured.decides !== 'rule' && (reason ? reason : keyConfigured === false ? 'key not found for ' + defined?.keyRef : undefined)
  return {
    mode: configured.mode,
    decides: fallback ? 'rule' : configured.decides,
    ...fallback ? { modeNote: 'the rule scorer decides: ' + fallback } : configured.note ? { modeNote: configured.note } : {},
    provider: {
      id,
      ...defined ? { protocol: defined.protocol, model: defined.model } : {},
      usable: !reason,
      ...reason ? { reason } : {},
      ...defined?.unverified ? { unverified: true } : {},
      ...defined?.calibration ? { calibration: calibrationKey(defined.calibration) } : {},
      ...keyConfigured !== undefined ? { keyConfigured } : {},
    },
    providers: [...catalog.providers.keys()],
    ...coverage ? { coverage } : {},
    ...snapshot ? { usage: {
      day: snapshot.day,
      ...snapshot.timezone ? { timezone: snapshot.timezone } : {},
      requests: snapshot.totals.requests,
      inputTokens: snapshot.totals.inputTokens,
      outputTokens: snapshot.totals.outputTokens,
      estimated: snapshot.totals.estimated,
      amountKnown: snapshot.totals.amount !== null,
      ...snapshot.totals.amount !== null && snapshot.totals.calls > 0 ? { amount: snapshot.totals.amount, ...snapshot.totals.currency ? { currency: snapshot.totals.currency } : {} } : {},
      caps: { perSearchInputTokens: budget.caps.perSearchInputTokens, dailyInputTokens: budget.caps.dailyInputTokens },
      byProvider: snapshot.providers.map(p => ({ provider: p.provider, protocol: p.protocol, requests: p.requests, inputTokens: p.inputTokens, outputTokens: p.outputTokens, estimated: p.estimated })),
    } } : {},
    diagnostics: [...catalog.diagnostics, ...budget.diagnostics],
  }
}
