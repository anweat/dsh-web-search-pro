/**
 * Validation and defaults of the model usage caps (`evidence.budget`), with no Node imports so the settings panel
 * validates them with the code the server uses; the ledger itself lives in ./ledger.ts.
 * @module web-search-pro/pipeline/budget-spec
 */

export interface ProviderBudgetInput { perSearchInputTokens?: number; dailyInputTokens?: number }
/** `evidence.budget` as the user writes it. */
export interface BudgetInput extends ProviderBudgetInput {
  /** IANA time zone of the day boundary (default: the system's). */
  timezone?: string
  providers?: Record<string, ProviderBudgetInput>
}

export interface BudgetCaps {
  perSearchInputTokens: number
  dailyInputTokens: number
  timezone?: string
  providers: Record<string, ProviderBudgetInput>
}

export const DEFAULT_BUDGET = { perSearchInputTokens: 60_000, dailyInputTokens: 1_000_000 } as const

const isCap = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

/** Validate the budget settings; invalid values fall back to the defaults and are reported. */
export function resolveBudget(input?: BudgetInput | undefined): { caps: BudgetCaps; diagnostics: string[] } {
  const diagnostics: string[] = []
  const pick = (value: unknown, fallback: number | undefined, name: string): number | undefined => {
    if (value === undefined || value === null) return fallback
    if (isCap(value)) return Math.floor(value)
    diagnostics.push('evidence.budget.' + name + ' ignored: must be a number >= 0')
    return fallback
  }
  let timezone: string | undefined
  if (input?.timezone !== undefined && input.timezone !== null && input.timezone !== '') {
    try { new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone }); timezone = input.timezone } catch { diagnostics.push('evidence.budget.timezone "' + input.timezone + '" is not a time zone: the system zone is used') }
  }
  const providers: Record<string, ProviderBudgetInput> = {}
  for (const [id, raw] of Object.entries(input?.providers ?? {})) {
    if (raw === null || typeof raw !== 'object') { diagnostics.push('evidence.budget.providers.' + id + ' ignored: not an object'); continue }
    const perSearch = pick(raw.perSearchInputTokens, undefined, 'providers.' + id + '.perSearchInputTokens')
    const daily = pick(raw.dailyInputTokens, undefined, 'providers.' + id + '.dailyInputTokens')
    providers[id] = { ...perSearch !== undefined ? { perSearchInputTokens: perSearch } : {}, ...daily !== undefined ? { dailyInputTokens: daily } : {} }
  }
  return {
    caps: {
      perSearchInputTokens: pick(input?.perSearchInputTokens, DEFAULT_BUDGET.perSearchInputTokens, 'perSearchInputTokens')!,
      dailyInputTokens: pick(input?.dailyInputTokens, DEFAULT_BUDGET.dailyInputTokens, 'dailyInputTokens')!,
      ...timezone ? { timezone } : {},
      providers,
    },
    diagnostics,
  }
}
