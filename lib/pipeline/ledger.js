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
import crypto from 'node:crypto';
import { BudgetExceededError } from "./judges/errors.js";
export const DEFAULT_BUDGET = { perSearchInputTokens: 60_000, dailyInputTokens: 1_000_000 };
const isCap = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
/** Validate the budget settings; invalid values fall back to the defaults and are reported. */
export function resolveBudget(input) {
    const diagnostics = [];
    const pick = (value, fallback, name) => {
        if (value === undefined || value === null)
            return fallback;
        if (isCap(value))
            return Math.floor(value);
        diagnostics.push('evidence.budget.' + name + ' ignored: must be a number >= 0');
        return fallback;
    };
    let timezone;
    if (input?.timezone !== undefined && input.timezone !== null && input.timezone !== '') {
        try {
            new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone });
            timezone = input.timezone;
        }
        catch {
            diagnostics.push('evidence.budget.timezone "' + input.timezone + '" is not a time zone: the system zone is used');
        }
    }
    const providers = {};
    for (const [id, raw] of Object.entries(input?.providers ?? {})) {
        if (raw === null || typeof raw !== 'object') {
            diagnostics.push('evidence.budget.providers.' + id + ' ignored: not an object');
            continue;
        }
        const perSearch = pick(raw.perSearchInputTokens, undefined, 'providers.' + id + '.perSearchInputTokens');
        const daily = pick(raw.dailyInputTokens, undefined, 'providers.' + id + '.dailyInputTokens');
        providers[id] = { ...perSearch !== undefined ? { perSearchInputTokens: perSearch } : {}, ...daily !== undefined ? { dailyInputTokens: daily } : {} };
    }
    return {
        caps: {
            perSearchInputTokens: pick(input?.perSearchInputTokens, DEFAULT_BUDGET.perSearchInputTokens, 'perSearchInputTokens'),
            dailyInputTokens: pick(input?.dailyInputTokens, DEFAULT_BUDGET.dailyInputTokens, 'dailyInputTokens'),
            ...timezone ? { timezone } : {},
            providers,
        },
        diagnostics,
    };
}
/** Calendar day `YYYY-MM-DD` of `ts` in `timezone` (the system zone when absent). */
export function dayKey(ts, timezone) {
    return new Intl.DateTimeFormat('en-CA', { ...timezone ? { timeZone: timezone } : {}, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
}
const amountOf = (provider, input, output) => {
    const price = provider.price;
    if (!price)
        return { amount: null };
    if (output > 0 && price.outputPerMTokens === undefined)
        return { amount: null };
    return { amount: (input * price.inputPerMTokens + output * (price.outputPerMTokens ?? 0)) / 1_000_000, currency: price.currency };
};
export class UsageLedger {
    store;
    caps;
    now;
    constructor(store, caps, now = Date.now) {
        this.store = store;
        this.caps = caps;
        this.now = now;
    }
    /** Today's day key in the budget time zone. */
    day() { return dayKey(this.now(), this.caps.timezone); }
    /** A per-search budget (one `web_search_pro` evidence call, all its rounds). */
    forSearch(searchId = 's_' + crypto.randomUUID().slice(0, 8)) { return new SearchBudget(this, searchId); }
    /**
     * Count requests of a metered NON-model provider (Bocha search): one settled row with `requests`, tokens 0 (n/a)
     * and amount null (price unknown, never 0). Not capped: the caps are input-token caps of model calls.
     */
    recordRequests(entry) {
        const ts = this.now();
        const id = 'u_' + crypto.randomUUID().slice(0, 12);
        const res = this.store.reserveUsage({ id, ts: new Date(ts).toISOString(), day: dayKey(ts, this.caps.timezone), ...entry.searchId ? { searchId: entry.searchId } : {}, provider: entry.provider, protocol: entry.protocol, ...entry.model ? { model: entry.model } : {}, inputTokens: 0 });
        if (!res.ok)
            return;
        this.store.settleUsage(id, { status: 'settled', requests: Math.max(Math.floor(entry.requests), 0), inputTokens: 0, outputTokens: 0, estimated: false, amount: null, ...entry.note ? { note: entry.note } : {} });
    }
    /**
     * Today's usage over reserved and settled MODEL calls, with the caps (read-only). Request-counted providers
     * (protocol `search`) are listed in `providers` but kept out of `totals`, so their unknown price does not blank the model cost.
     */
    today() {
        const day = this.day();
        const providers = this.store.usageByProvider(day);
        const totals = providers.filter(p => p.protocol !== 'search').reduce((t, p) => ({
            requests: t.requests + p.requests, inputTokens: t.inputTokens + p.inputTokens, outputTokens: t.outputTokens + p.outputTokens,
            estimated: t.estimated || p.estimated, calls: t.calls + p.calls, amount: t.amount !== null && p.amount !== null ? t.amount + p.amount : null,
            ...p.currency ? { currency: p.currency } : t.currency ? { currency: t.currency } : {},
        }), { requests: 0, inputTokens: 0, outputTokens: 0, estimated: false, calls: 0, amount: 0 });
        return { day, ...this.caps.timezone ? { timezone: this.caps.timezone } : {}, caps: { perSearchInputTokens: this.caps.perSearchInputTokens, dailyInputTokens: this.caps.dailyInputTokens, providers: this.caps.providers }, totals, providers };
    }
    /** @internal */
    dailyUsed(provider) {
        return this.store.usageByProvider(this.day()).filter(p => !provider || p.provider === provider).reduce((n, p) => n + p.inputTokens, 0);
    }
    /** @internal */
    reserve(searchId, provider, inputTokens) {
        const id = 'u_' + crypto.randomUUID().slice(0, 12);
        const ts = this.now();
        const own = this.caps.providers[provider.id];
        const res = this.store.reserveUsage({
            id, ts: new Date(ts).toISOString(), day: dayKey(ts, this.caps.timezone), searchId, provider: provider.id, protocol: provider.protocol, model: provider.model, inputTokens,
            dailyCap: this.caps.dailyInputTokens, ...own?.dailyInputTokens !== undefined ? { providerDailyCap: own.dailyInputTokens } : {},
        });
        if (res.ok)
            return id;
        if (res.scope === 'unavailable')
            return { refused: 'usage ledger unavailable' };
        return { refused: (res.scope === 'daily' ? 'daily cap ' : provider.id + ' daily cap ') + res.cap + ' input tokens (' + res.used + ' used today, ' + inputTokens + ' requested)' };
    }
    /** @internal */
    close(id, provider, final) {
        this.store.settleUsage(id, { ...final, ...amountOf(provider, final.inputTokens, final.outputTokens) });
    }
}
/** Counts one search's reservations against the per-search caps; hands out a meter per provider. */
export class SearchBudget {
    ledger;
    searchId;
    /** Input tokens reserved or settled by this search, all providers. */
    used = 0;
    byProvider = new Map();
    constructor(ledger, searchId) {
        this.ledger = ledger;
        this.searchId = searchId;
    }
    providerUsed(id) { return this.byProvider.get(id) ?? 0; }
    /** @internal */
    add(provider, delta) { this.used += delta; this.byProvider.set(provider, this.providerUsed(provider) + delta); }
    /** @internal */
    get caps() { return this.ledger.caps; }
    meterFor(provider) { return new ProviderMeter(this.ledger, this, provider); }
}
class ProviderMeter {
    ledger;
    search;
    provider;
    constructor(ledger, search, provider) {
        this.ledger = ledger;
        this.search = search;
        this.provider = provider;
    }
    headroom() {
        const caps = this.search.caps;
        const own = caps.providers[this.provider.id];
        const room = [caps.perSearchInputTokens - this.search.used, caps.dailyInputTokens - this.ledger.dailyUsed()];
        if (own?.perSearchInputTokens !== undefined)
            room.push(own.perSearchInputTokens - this.search.providerUsed(this.provider.id));
        if (own?.dailyInputTokens !== undefined)
            room.push(own.dailyInputTokens - this.ledger.dailyUsed(this.provider.id));
        return Math.max(Math.min(...room), 0);
    }
    reserve(estimate) {
        const est = Math.max(Math.ceil(estimate.inputTokens), 0);
        const caps = this.search.caps;
        if (this.search.used + est > caps.perSearchInputTokens)
            throw new BudgetExceededError('per-search cap ' + caps.perSearchInputTokens + ' input tokens (' + this.search.used + ' used, ' + est + ' requested)');
        const own = caps.providers[this.provider.id]?.perSearchInputTokens;
        if (own !== undefined && this.search.providerUsed(this.provider.id) + est > own)
            throw new BudgetExceededError(this.provider.id + ' per-search cap ' + own + ' input tokens (' + this.search.providerUsed(this.provider.id) + ' used, ' + est + ' requested)');
        const reserved = this.ledger.reserve(this.search.searchId, this.provider, est);
        if (typeof reserved !== 'string')
            throw new BudgetExceededError(reserved.refused);
        this.search.add(this.provider.id, est);
        return new Ticket(this.ledger, this.search, this.provider, reserved, est);
    }
}
class Ticket {
    ledger;
    search;
    provider;
    id;
    estimate;
    closed = false;
    constructor(ledger, search, provider, id, estimate) {
        this.ledger = ledger;
        this.search = search;
        this.provider = provider;
        this.id = id;
        this.estimate = estimate;
    }
    finish(status, input, output, estimated, note) {
        if (this.closed)
            return;
        this.closed = true;
        this.search.add(this.provider.id, input - this.estimate);
        this.ledger.close(this.id, this.provider, { status, requests: 1, inputTokens: input, outputTokens: output, estimated, ...note ? { note } : {} });
    }
    settle(actual) {
        const known = typeof actual.inputTokens === 'number' && Number.isFinite(actual.inputTokens) && actual.inputTokens >= 0;
        const inputTokens = known ? Math.round(actual.inputTokens) : this.estimate;
        const outputTokens = typeof actual.outputTokens === 'number' && Number.isFinite(actual.outputTokens) && actual.outputTokens >= 0 ? Math.round(actual.outputTokens) : 0;
        this.finish('settled', inputTokens, outputTokens, !known, known ? undefined : 'service reported no usage: estimate booked');
        return { inputTokens, outputTokens, estimated: !known };
    }
    unknown() {
        this.finish('settled', this.estimate, 0, true, 'outcome unknown (network error, timeout or abort): estimate booked');
        return { inputTokens: this.estimate, outputTokens: 0, estimated: true };
    }
    refused() { this.finish('released', 0, 0, false, 'refused by the service'); }
}
//# sourceMappingURL=ledger.js.map