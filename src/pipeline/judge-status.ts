/**
 * Read-only description of the judge layer for `web_backend_status`: which provider is
 * configured and whether it is usable, plus today's model usage against the caps.
 * Makes no network request and never shows a credential.
 * @module web-search-pro/pipeline/judge-status
 */

import type { EvidenceConfig } from '../config.ts'
import type { Store } from '../store.ts'
import { calibrationKey } from './judges/calibration.ts'
import { resolveProviders, selectProvider, unusableReason, DEFAULT_PROVIDER_ID } from './judges/providers.ts'
import { resolveBudget, UsageLedger } from './ledger.ts'

export interface JudgeStatus {
  provider: { id: string; protocol?: string; model?: string; usable: boolean; reason?: string; unverified?: boolean; calibration?: string; keyConfigured?: boolean }
  /** Ids of every defined provider (presets and custom). */
  providers: string[]
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
    byProvider: { provider: string; requests: number; inputTokens: number; outputTokens: number; estimated: boolean }[]
  }
  diagnostics: string[]
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
  return {
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
      byProvider: snapshot.providers.map(p => ({ provider: p.provider, requests: p.requests, inputTokens: p.inputTokens, outputTokens: p.outputTokens, estimated: p.estimated })),
    } } : {},
    diagnostics: [...catalog.diagnostics, ...budget.diagnostics],
  }
}
