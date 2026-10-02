/**
 * Read-only description of the judge layer for `web_backend_status`: which provider is
 * configured and whether it is usable, plus today's model usage against the caps.
 * Makes no network request and never shows a credential.
 * @module web-search-pro/pipeline/judge-status
 */
import { calibrationKey } from "./judges/calibration.js";
import { resolveProviders, selectProvider, unusableReason, DEFAULT_PROVIDER_ID } from "./judges/providers.js";
import { resolveBudget, UsageLedger } from "./ledger.js";
export async function judgeStatus(cfg, store, options = {}) {
    const catalog = resolveProviders(cfg.judge);
    const selection = selectProvider(cfg.judge);
    const id = cfg.judge?.provider ?? DEFAULT_PROVIDER_ID;
    const defined = catalog.providers.get(id);
    const reason = defined ? unusableReason(defined, cfg.judge) : selection.unusable;
    let keyConfigured;
    if (defined?.keyRef && options.hasSecret) {
        try {
            keyConfigured = await options.hasSecret(defined.keyRef);
        }
        catch { /* credentials service unavailable: unknown */ }
    }
    const budget = resolveBudget(cfg.budget);
    let snapshot;
    try {
        snapshot = new UsageLedger(store, budget.caps, options.now).today();
    }
    catch { /* store unreadable: report the rest */ }
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
    };
}
//# sourceMappingURL=judge-status.js.map