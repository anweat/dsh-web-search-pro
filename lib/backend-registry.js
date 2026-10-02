/**
 * Thrown when no backend produced a usable result. Carries the per-engine
 * attempts so callers can tell "every engine answered with nothing" (all
 * `empty`) from real failures (any `error`).
 */
export class NoBackendError extends Error {
    attempts;
    constructor(message, attempts) {
        super(message);
        this.attempts = attempts;
        this.name = 'NoBackendError';
    }
}
/** True when engines were tried and every one of them answered with a legitimate empty result. */
export function allAttemptsEmpty(attempts) {
    return attempts.length > 0 && attempts.every(a => a.outcome === 'empty');
}
/**
 * True when no engine failed at runtime: every attempt was an empty answer or
 * a skip (unavailable / cooldown / unknown). Such a search has nothing to
 * report but no error either (dev-plan M2b decision).
 */
export function allAttemptsBenign(attempts) {
    return attempts.length > 0 && attempts.every(a => a.outcome === 'empty' || a.outcome === 'skipped');
}
/** ENGINE_EMPTY is a legitimate empty answer, not a fault. */
function isEmptyError(error) {
    return error instanceof Error && error.code === 'ENGINE_EMPTY';
}
/**
 * Only transient faults (network, timeout, 429, 5xx) cool an engine down.
 * Coded engine errors flagged non-retryable (misconfiguration, auth) are
 * deterministic, so a cooldown would not help; unknown errors are assumed transient.
 */
function isCooldownWorthy(error) {
    if (!(error instanceof Error))
        return true;
    const { code, retryable } = error;
    if (typeof code === 'string' && code.length > 0)
        return retryable === true;
    return true;
}
/** The service's own wait hint (EngineError.retryAfterMs), bounded so a hostile header cannot park an engine for hours. */
const MAX_RETRY_AFTER_MS = 10 * 60_000;
function retryAfterMsOf(error) {
    const value = error?.retryAfterMs;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(value, MAX_RETRY_AFTER_MS) : undefined;
}
export class BackendRegistry {
    options;
    entries = new Map();
    failures = new Map();
    constructor(options = {}) {
        this.options = options;
    }
    register(backend) {
        if (this.entries.has(backend.id))
            throw new Error('duplicate backend: ' + backend.id);
        this.entries.set(backend.id, backend);
        return this;
    }
    has(id) { return this.entries.has(id); }
    /** Remove a backend (and its cooldown). Returns whether it existed. */
    unregister(id) {
        this.failures.delete(id);
        return this.entries.delete(id);
    }
    async run(input, options) {
        return (await this.runSelected(input, options)).value;
    }
    /**
     * Try engines in order. A successful engine wins by default, but when its
     * `assess()` verdict is `lowQuality` and there are more engines to try, the
     * router keeps probing; a later *ok* engine replaces it. If no later engine
     * does better, the best low-quality result (first one) is still returned.
     */
    async runSelected(input, options) {
        const signal = options.signal;
        const ids = options.override ? [options.override] : options.preferred;
        const errors = [];
        const attempts = [];
        let fallback;
        for (const id of ids) {
            if (signal?.aborted)
                throw signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
            const backend = this.entries.get(id);
            if (!backend) {
                errors.push(id + ': unknown');
                attempts.push({ id, outcome: 'skipped', detail: 'unknown' });
                continue;
            }
            const failed = this.failures.get(id);
            if (failed && failed.until > Date.now()) {
                errors.push(id + ': cooldown');
                attempts.push({ id, outcome: 'skipped', detail: 'cooldown' });
                continue;
            }
            const probe = await backend.probe();
            if (!probe.available) {
                errors.push(id + ': ' + (probe.reason ?? 'unavailable'));
                attempts.push({ id, outcome: 'skipped', detail: probe.reason ?? 'unavailable' });
                continue;
            }
            try {
                const result = await backend.run(input);
                this.failures.delete(id);
                const verdict = backend.assess ? backend.assess(result) : { ok: true };
                if (verdict.ok && !verdict.lowQuality) {
                    attempts.push({ id, outcome: 'ok' });
                    return { id, value: result, attempts };
                }
                // Low-quality: usable but thin — remember it and keep probing.
                if (!fallback)
                    fallback = { id, value: result, detail: verdict.detail };
                attempts.push({ id, outcome: 'low-quality', detail: verdict.detail });
            }
            catch (error) {
                // A cancelled caller is not an engine fault: never cool down, never fall through.
                if (signal?.aborted)
                    throw error;
                const message = error instanceof Error ? error.message : String(error);
                errors.push(id + ': ' + message);
                if (isEmptyError(error)) {
                    // The engine answered (with nothing): try the next one, keep this one hot.
                    this.failures.delete(id);
                    attempts.push({ id, outcome: 'empty', detail: message });
                    continue;
                }
                if (isCooldownWorthy(error))
                    this.failures.set(id, { message, until: Date.now() + (retryAfterMsOf(error) ?? this.options.cooldownMs ?? 30_000) });
                attempts.push({ id, outcome: 'error', detail: message });
            }
        }
        if (fallback)
            return { id: fallback.id, value: fallback.value, attempts };
        throw new NoBackendError('no backend succeeded: ' + errors.join('; '), attempts);
    }
    diagnostics() {
        return [...this.entries.values()].map(backend => {
            const probe = backend.probe();
            if (probe instanceof Promise)
                return { id: backend.id, available: false, state: 'unavailable', reason: 'asynchronous probe requires diagnosticsAsync()' };
            const failed = this.failures.get(backend.id);
            if (failed && failed.until > Date.now())
                return { id: backend.id, available: probe.available, state: 'cooldown', lastError: failed.message, cooldownUntil: new Date(failed.until).toISOString() };
            return { id: backend.id, available: probe.available, state: probe.available ? 'ready' : 'unavailable', ...probe.reason ? { reason: probe.reason } : {} };
        });
    }
    async diagnosticsAsync() {
        return Promise.all([...this.entries.values()].map(async (backend) => {
            const probe = await backend.probe();
            const failed = this.failures.get(backend.id);
            if (failed && failed.until > Date.now())
                return { id: backend.id, available: probe.available, state: 'cooldown', lastError: failed.message, cooldownUntil: new Date(failed.until).toISOString() };
            return { id: backend.id, available: probe.available, state: probe.available ? 'ready' : 'unavailable', ...probe.reason ? { reason: probe.reason } : {} };
        }));
    }
}
//# sourceMappingURL=backend-registry.js.map