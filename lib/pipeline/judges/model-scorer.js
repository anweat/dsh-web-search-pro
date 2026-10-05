/**
 * Base of the model-backed judges (one subclass per protocol). It owns what is
 * the same whatever the protocol: the transport (retries, cap, metering), the
 * provider record that results carry, and the calibration of raw scores.
 * `ModelClientBase` is that shared part; `ModelScorerBase` adds the S6 scorer
 * contract, and other judges (the M9 coverage judge) build on the client alone.
 * @module web-search-pro/pipeline/judges/model-scorer
 */
import { applyCalibration, calibrationKey } from "./calibration.js";
import { BudgetExceededError, JudgeError } from "./errors.js";
import { JudgeHttp, sleepMs } from "./http.js";
export class ModelClientBase {
    id;
    model;
    provider;
    label;
    http;
    calibration;
    cache;
    extraBody;
    constructor(options) {
        this.id = options.id;
        this.label = options.label;
        this.model = options.model;
        this.calibration = options.calibration;
        this.cache = options.cache;
        this.extraBody = options.extraBody ?? {};
        this.provider = options.provider
            ? { id: options.provider.id, protocol: options.provider.protocol, model: options.model, ...options.calibration ? { calibration: calibrationKey(options.calibration) } : {} }
            : undefined;
        const http = {
            url: options.url, apiKey: options.apiKey, headers: options.headers, label: options.label,
            fetchImpl: options.fetchImpl ?? globalThis.fetch, sleep: options.sleep ?? sleepMs,
            timeoutMs: options.timeoutMs ?? 20_000, maxRetries: options.maxRetries ?? 2, requestCap: options.requestCap, meter: options.meter,
            maxRetryWaitMs: options.maxRetryWaitMs, capError: options.capError,
        };
        this.http = new JudgeHttp(http);
    }
    /** HTTP attempts made so far (retries and splits included). */
    get requests() { return this.http.requests; }
    /** `provider|protocol|model` for cache probes: answers of one provider are never reused for another. */
    get providerKey() {
        return this.provider ? this.provider.id + '|' + this.provider.protocol + '|' + this.provider.model : undefined;
    }
    /** A grade on the 0..3 scale -> the calibrated grade (identity without a calibration). */
    shape(grade) {
        return this.calibration ? applyCalibration(this.calibration, grade) : grade;
    }
    /**
     * Run `run` over the request chunks in order. `run` returns how many of the chunk's questions went unanswered.
     * A failed chunk only loses its own questions; a refused reservation stops the remaining chunks (never asked);
     * an abort or a fatal error (bad key, request cap) propagates.
     */
    async dispatch(chunks, run, ctx) {
        const out = { failed: 0, notes: [] };
        for (const chunk of chunks) {
            if (out.budgetStop) {
                out.failed += chunk.length;
                continue;
            }
            try {
                out.failed += await run(chunk);
            }
            catch (error) {
                if (ctx.signal?.aborted)
                    throw error;
                if (error instanceof BudgetExceededError) {
                    out.budgetStop = error;
                    out.failed += chunk.length;
                    continue;
                }
                if (error instanceof JudgeError && error.fatal)
                    throw error;
                out.failed += chunk.length;
                out.notes.push(error.message);
            }
        }
        return out;
    }
    /**
     * Fill the usage totals and the notes after `dispatch`. Throws when the model stage produced (almost) nothing so the
     * caller falls back to the rule grades: nothing asked because of the budget, or more than half the questions unanswered.
     * @returns the notes
     */
    conclude(d, usage, counts) {
        usage.requests = this.requests - counts.requestsBefore;
        usage.questions = counts.asked - d.failed;
        if (d.budgetStop) {
            if (usage.questions === 0 && usage.cacheHits === 0)
                throw d.budgetStop;
            d.notes.unshift(d.budgetStop.message);
        }
        if (d.failed)
            d.notes.push(d.failed + ' of ' + counts.total + ' ' + this.label + ' questions got no answer');
        if (counts.total && d.failed / counts.total > 0.5)
            throw new JudgeError(this.label + ' answered only ' + (counts.total - d.failed) + ' of ' + counts.total + ' questions' + (d.notes[0] ? ' (' + d.notes[0] + ')' : ''));
        return d.notes;
    }
}
export class ModelScorerBase extends ModelClientBase {
}
//# sourceMappingURL=model-scorer.js.map