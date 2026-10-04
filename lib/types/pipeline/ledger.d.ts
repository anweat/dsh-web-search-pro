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
import type { Store, UsageTotals } from '../store.ts';
import type { ProviderConfig, UsageMeter } from './judges/types.ts';
import { DEFAULT_BUDGET, resolveBudget, type BudgetCaps, type BudgetInput, type ProviderBudgetInput } from './budget-spec.ts';
import type { SourceBudgetInput } from './sources-spec.ts';
export { DEFAULT_BUDGET, resolveBudget };
export type { BudgetCaps, BudgetInput, ProviderBudgetInput };
/** Calendar day `YYYY-MM-DD` of `ts` in `timezone` (the system zone when absent). */
export declare function dayKey(ts: number, timezone?: string): string;
/** The ledger provider name of a source's request rows: Bocha books them as `bocha-search`, every other source under its route id. */
export declare function usageProviderOf(route: string): string;
/** One axis of a request budget: the cap, what is booked, what is left. */
export interface RequestAxis {
    limit: number;
    used: number;
    remaining: number;
}
/** Used and remaining requests of one budgeted source (`sources.budget.<id>`), read from the ledger. */
export interface RequestBudgetState {
    /** Route id of the source. */
    source: string;
    total?: RequestAxis;
    daily?: RequestAxis;
    /** The calendar day `daily` counts. */
    day: string;
    exhausted: boolean;
    /** Words for a skip note (`request budget used up: 1000/1000 total`); only when exhausted. */
    reason?: string;
}
/** A reserved request of a capped source: settled when the service answered, released when it did not. */
export declare class RequestTicket {
    private readonly store;
    private readonly id;
    private open;
    constructor(store: Store, id: string);
    get closed(): boolean;
    /** The request reached the service and is booked (`requests` normally 1). */
    settle(requests?: number, note?: string): void;
    /** The request did not reach the service (or was refused before billing): the reservation is given back. */
    release(note?: string): void;
}
export interface UsageSnapshot {
    day: string;
    timezone?: string;
    caps: {
        perSearchInputTokens: number;
        dailyInputTokens: number;
        providers: Record<string, ProviderBudgetInput>;
    };
    totals: UsageTotals;
    providers: (UsageTotals & {
        provider: string;
        protocol: string;
    })[];
}
export declare class UsageLedger {
    private readonly store;
    readonly caps: BudgetCaps;
    private readonly now;
    constructor(store: Store, caps: BudgetCaps, now?: () => number);
    /** Today's day key in the budget time zone. */
    day(): string;
    /** A per-search budget (one `search.run` evidence call, all its rounds). */
    forSearch(searchId?: string): SearchBudget;
    /**
     * Count requests of a metered NON-model provider (Bocha search): one settled row with `requests`, tokens 0 (n/a)
     * and amount null (price unknown, never 0). Not capped: the caps are input-token caps of model calls.
     */
    recordRequests(entry: {
        provider: string;
        protocol: string;
        requests: number;
        model?: string;
        searchId?: string;
        note?: string;
    }): void;
    /** Used and remaining requests of a budgeted source: the ledger's persistent counters (all time and today). Read-only. */
    requestBudget(route: string, budget: SourceBudgetInput): RequestBudgetState;
    /**
     * Reserve one request of a capped source before it is sent, atomically (immediate transaction) so two searches or two
     * processes cannot both spend the last one. Refused when the total or today's cap would be passed.
     */
    reserveRequest(route: string, budget: SourceBudgetInput, searchId?: string): RequestTicket | {
        refused: string;
    };
    /**
     * Today's usage over reserved and settled MODEL calls, with the caps (read-only). Request-counted providers
     * (protocol `search`) are listed in `providers` but kept out of `totals`, so their unknown price does not blank the model cost.
     */
    today(): UsageSnapshot;
    /** @internal */
    dailyUsed(provider?: string): number;
    /** @internal */
    reserve(searchId: string, provider: ProviderConfig, inputTokens: number): string | {
        refused: string;
    };
    /** @internal */
    close(id: string, provider: ProviderConfig, final: {
        status: 'settled' | 'released';
        requests: number;
        inputTokens: number;
        outputTokens: number;
        estimated: boolean;
        note?: string;
    }): void;
}
/** Counts one search's reservations against the per-search caps; hands out a meter per provider. */
export declare class SearchBudget {
    private readonly ledger;
    readonly searchId: string;
    /** Input tokens reserved or settled by this search, all providers. */
    used: number;
    private readonly byProvider;
    constructor(ledger: UsageLedger, searchId: string);
    providerUsed(id: string): number;
    /** @internal */
    add(provider: string, delta: number): void;
    /** @internal */
    get caps(): BudgetCaps;
    meterFor(provider: ProviderConfig): UsageMeter;
}
