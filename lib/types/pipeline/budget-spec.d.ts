/**
 * Validation and defaults of the model usage caps (`evidence.budget`), with no Node imports so the settings panel
 * validates them with the code the server uses; the ledger itself lives in ./ledger.ts.
 * @module web-search-pro/pipeline/budget-spec
 */
export interface ProviderBudgetInput {
    perSearchInputTokens?: number;
    dailyInputTokens?: number;
}
/** `evidence.budget` as the user writes it. */
export interface BudgetInput extends ProviderBudgetInput {
    /** IANA time zone of the day boundary (default: the system's). */
    timezone?: string;
    providers?: Record<string, ProviderBudgetInput>;
}
export interface BudgetCaps {
    perSearchInputTokens: number;
    dailyInputTokens: number;
    timezone?: string;
    providers: Record<string, ProviderBudgetInput>;
}
export declare const DEFAULT_BUDGET: {
    readonly perSearchInputTokens: 60000;
    readonly dailyInputTokens: 1000000;
};
/** Validate the budget settings; invalid values fall back to the defaults and are reported. */
export declare function resolveBudget(input?: BudgetInput | undefined): {
    caps: BudgetCaps;
    diagnostics: string[];
};
