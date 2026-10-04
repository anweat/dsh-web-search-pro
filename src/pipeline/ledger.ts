/**
 * Model usage ledger with caps (design §9, dev-plan M5).
 *
 * Every call to a model judge (hosted or local) is RESERVED before it is sent and
 * SETTLED after: a reservation that would pass a cap is refused and the optional
 * model stage falls back to the rule scorer. Reservations are rows of the
 * `usage_ledger` table written in an immediate transaction, so two searches (or two
 * DSH processes sharing the store) cannot both spend the same headroom, reserved rows
 * count until settled (a crash never frees them), and today's total survives a restart.
 *
 *  - Caps are input tokens: `perSearchInputTokens` (one search, all rounds),
 *    `dailyInputTokens` (a calendar day in `timezone`), each with per-provider
 *    overrides; the stricter of every applicable cap wins.
 *  - Actual tokens come from the service's `usage`; when it reports none the
 *    conservative estimate is booked and flagged `estimated`.
 *  - Money: only when the provider declares a price; otherwise `amount` is null (never 0).
 * @module web-search-pro/pipeline/ledger
 */

import crypto from 'node:crypto'
import type { Store, UsageTotals } from '../store.ts'
import { BudgetExceededError } from './judges/errors.ts'
import type { ProviderConfig, UsageMeter, UsageSettled, UsageTicket } from './judges/types.ts'
import { DEFAULT_BUDGET, resolveBudget, type BudgetCaps, type BudgetInput, type ProviderBudgetInput } from './budget-spec.ts'

export { DEFAULT_BUDGET, resolveBudget }
export type { BudgetCaps, BudgetInput, ProviderBudgetInput }


/** Calendar day `YYYY-MM-DD` of `ts` in `timezone` (the system zone when absent). */
export function dayKey(ts: number, timezone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { ...timezone ? { timeZone: timezone } : {}, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts))
}

export interface UsageSnapshot {
  day: string
  timezone?: string
  caps: { perSearchInputTokens: number; dailyInputTokens: number; providers: Record<string, ProviderBudgetInput> }
  totals: UsageTotals
  providers: (UsageTotals & { provider: string; protocol: string })[]
}

const amountOf = (provider: ProviderConfig, input: number, output: number): { amount: number | null; currency?: string } => {
  const price = provider.price
  if (!price) return { amount: null }
  if (output > 0 && price.outputPerMTokens === undefined) return { amount: null }
  return { amount: (input * price.inputPerMTokens + output * (price.outputPerMTokens ?? 0)) / 1_000_000, currency: price.currency }
}

export class UsageLedger {
  constructor(private readonly store: Store, readonly caps: BudgetCaps, private readonly now: () => number = Date.now) {}

  /** Today's day key in the budget time zone. */
  day(): string { return dayKey(this.now(), this.caps.timezone) }

  /** A per-search budget (one `search.run` evidence call, all its rounds). */
  forSearch(searchId: string = 's_' + crypto.randomUUID().slice(0, 8)): SearchBudget { return new SearchBudget(this, searchId) }

  /**
   * Count requests of a metered NON-model provider (Bocha search): one settled row with `requests`, tokens 0 (n/a)
   * and amount null (price unknown, never 0). Not capped: the caps are input-token caps of model calls.
   */
  recordRequests(entry: { provider: string; protocol: string; requests: number; model?: string; searchId?: string; note?: string }): void {
    const ts = this.now()
    const id = 'u_' + crypto.randomUUID().slice(0, 12)
    const res = this.store.reserveUsage({ id, ts: new Date(ts).toISOString(), day: dayKey(ts, this.caps.timezone), ...entry.searchId ? { searchId: entry.searchId } : {}, provider: entry.provider, protocol: entry.protocol, ...entry.model ? { model: entry.model } : {}, inputTokens: 0 })
    if (!res.ok) return
    this.store.settleUsage(id, { status: 'settled', requests: Math.max(Math.floor(entry.requests), 0), inputTokens: 0, outputTokens: 0, estimated: false, amount: null, ...entry.note ? { note: entry.note } : {} })
  }

  /**
   * Today's usage over reserved and settled MODEL calls, with the caps (read-only). Request-counted providers
   * (protocol `search`) are listed in `providers` but kept out of `totals`, so their unknown price does not blank the model cost.
   */
  today(): UsageSnapshot {
    const day = this.day()
    const providers = this.store.usageByProvider(day)
    const totals = providers.filter(p => p.protocol !== 'search').reduce<UsageTotals>((t, p) => ({
      requests: t.requests + p.requests, inputTokens: t.inputTokens + p.inputTokens, outputTokens: t.outputTokens + p.outputTokens,
      estimated: t.estimated || p.estimated, calls: t.calls + p.calls, amount: t.amount !== null && p.amount !== null ? t.amount + p.amount : null,
      ...p.currency ? { currency: p.currency } : t.currency ? { currency: t.currency } : {},
    }), { requests: 0, inputTokens: 0, outputTokens: 0, estimated: false, calls: 0, amount: 0 })
    return { day, ...this.caps.timezone ? { timezone: this.caps.timezone } : {}, caps: { perSearchInputTokens: this.caps.perSearchInputTokens, dailyInputTokens: this.caps.dailyInputTokens, providers: this.caps.providers }, totals, providers }
  }

  /** @internal */
  dailyUsed(provider?: string): number {
    return this.store.usageByProvider(this.day()).filter(p => !provider || p.provider === provider).reduce((n, p) => n + p.inputTokens, 0)
  }

  /** @internal */
  reserve(searchId: string, provider: ProviderConfig, inputTokens: number): string | { refused: string } {
    const id = 'u_' + crypto.randomUUID().slice(0, 12)
    const ts = this.now()
    const own = this.caps.providers[provider.id]
    const res = this.store.reserveUsage({
      id, ts: new Date(ts).toISOString(), day: dayKey(ts, this.caps.timezone), searchId, provider: provider.id, protocol: provider.protocol, model: provider.model, inputTokens,
      dailyCap: this.caps.dailyInputTokens, ...own?.dailyInputTokens !== undefined ? { providerDailyCap: own.dailyInputTokens } : {},
    })
    if (res.ok) return id
    if (res.scope === 'unavailable') return { refused: 'usage ledger unavailable' }
    return { refused: (res.scope === 'daily' ? 'daily cap ' : provider.id + ' daily cap ') + res.cap + ' input tokens (' + res.used + ' used today, ' + inputTokens + ' requested)' }
  }

  /** @internal */
  close(id: string, provider: ProviderConfig, final: { status: 'settled' | 'released'; requests: number; inputTokens: number; outputTokens: number; estimated: boolean; note?: string }): void {
    this.store.settleUsage(id, { ...final, ...amountOf(provider, final.inputTokens, final.outputTokens) })
  }
}

/** Counts one search's reservations against the per-search caps; hands out a meter per provider. */
export class SearchBudget {
  /** Input tokens reserved or settled by this search, all providers. */
  used = 0
  private readonly byProvider = new Map<string, number>()
  constructor(private readonly ledger: UsageLedger, readonly searchId: string) {}

  providerUsed(id: string): number { return this.byProvider.get(id) ?? 0 }
  /** @internal */
  add(provider: string, delta: number): void { this.used += delta; this.byProvider.set(provider, this.providerUsed(provider) + delta) }
  /** @internal */
  get caps(): BudgetCaps { return this.ledger.caps }

  meterFor(provider: ProviderConfig): UsageMeter { return new ProviderMeter(this.ledger, this, provider) }
}

class ProviderMeter implements UsageMeter {
  constructor(private readonly ledger: UsageLedger, private readonly search: SearchBudget, private readonly provider: ProviderConfig) {}

  headroom(): number {
    const caps = this.search.caps
    const own = caps.providers[this.provider.id]
    const room = [caps.perSearchInputTokens - this.search.used, caps.dailyInputTokens - this.ledger.dailyUsed()]
    if (own?.perSearchInputTokens !== undefined) room.push(own.perSearchInputTokens - this.search.providerUsed(this.provider.id))
    if (own?.dailyInputTokens !== undefined) room.push(own.dailyInputTokens - this.ledger.dailyUsed(this.provider.id))
    return Math.max(Math.min(...room), 0)
  }

  reserve(estimate: { inputTokens: number }): UsageTicket {
    const est = Math.max(Math.ceil(estimate.inputTokens), 0)
    const caps = this.search.caps
    if (this.search.used + est > caps.perSearchInputTokens) throw new BudgetExceededError('per-search cap ' + caps.perSearchInputTokens + ' input tokens (' + this.search.used + ' used, ' + est + ' requested)')
    const own = caps.providers[this.provider.id]?.perSearchInputTokens
    if (own !== undefined && this.search.providerUsed(this.provider.id) + est > own) throw new BudgetExceededError(this.provider.id + ' per-search cap ' + own + ' input tokens (' + this.search.providerUsed(this.provider.id) + ' used, ' + est + ' requested)')
    const reserved = this.ledger.reserve(this.search.searchId, this.provider, est)
    if (typeof reserved !== 'string') throw new BudgetExceededError(reserved.refused)
    this.search.add(this.provider.id, est)
    return new Ticket(this.ledger, this.search, this.provider, reserved, est)
  }
}

class Ticket implements UsageTicket {
  private closed = false
  constructor(private readonly ledger: UsageLedger, private readonly search: SearchBudget, private readonly provider: ProviderConfig, private readonly id: string, private readonly estimate: number) {}

  private finish(status: 'settled' | 'released', input: number, output: number, estimated: boolean, note?: string): void {
    if (this.closed) return
    this.closed = true
    this.search.add(this.provider.id, input - this.estimate)
    this.ledger.close(this.id, this.provider, { status, requests: 1, inputTokens: input, outputTokens: output, estimated, ...note ? { note } : {} })
  }

  settle(actual: { inputTokens?: number | undefined; outputTokens?: number | undefined }): UsageSettled {
    const known = typeof actual.inputTokens === 'number' && Number.isFinite(actual.inputTokens) && actual.inputTokens >= 0
    const inputTokens = known ? Math.round(actual.inputTokens!) : this.estimate
    const outputTokens = typeof actual.outputTokens === 'number' && Number.isFinite(actual.outputTokens) && actual.outputTokens >= 0 ? Math.round(actual.outputTokens) : 0
    this.finish('settled', inputTokens, outputTokens, !known, known ? undefined : 'service reported no usage: estimate booked')
    return { inputTokens, outputTokens, estimated: !known }
  }

  unknown(): UsageSettled {
    this.finish('settled', this.estimate, 0, true, 'outcome unknown (network error, timeout or abort): estimate booked')
    return { inputTokens: this.estimate, outputTokens: 0, estimated: true }
  }

  refused(): void { this.finish('released', 0, 0, false, 'refused by the service') }
}
