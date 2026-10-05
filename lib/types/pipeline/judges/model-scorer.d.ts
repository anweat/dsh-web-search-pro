/**
 * Base of the model-backed judges (one subclass per protocol). It owns what is
 * the same whatever the protocol: the transport (retries, cap, metering), the
 * provider record that results carry, and the calibration of raw scores.
 * `ModelClientBase` is that shared part; `ModelScorerBase` adds the S6 scorer
 * contract, and other judges (the M9 coverage judge) build on the client alone.
 * @module web-search-pro/pipeline/judges/model-scorer
 */
import { BudgetExceededError } from './errors.ts';
import { JudgeHttp } from './http.ts';
import type { Calibration, JudgeAnswerCache, ProtocolId, ProviderRecord, ScoreContext, ScoreJob, ScoreOutcome, ScoreTask, ScoreUsage, Scorer, UsageMeter } from './types.ts';
import type { RubricRef } from '../rubrics.ts';
export interface ModelScorerOptions {
    /** Scorer id recorded in stats / evidence rows. */
    id: string;
    /** Name in messages. */
    label: string;
    model: string;
    /** Full endpoint URL. */
    url: string;
    apiKey?: string | undefined;
    headers?: Record<string, string> | undefined;
    extraBody?: Record<string, unknown> | undefined;
    fetchImpl?: typeof fetch | undefined;
    sleep?: ((ms: number) => Promise<void>) | undefined;
    meter?: UsageMeter | undefined;
    cache?: JudgeAnswerCache | undefined;
    calibration?: Calibration | undefined;
    /** Provider identity recorded with results; absent for a bare scorer built outside the provider layer. */
    provider?: {
        id: string;
        protocol: ProtocolId;
    } | undefined;
    maxRetries?: number | undefined;
    timeoutMs?: number | undefined;
    requestCap?: number | undefined;
    maxRetryWaitMs?: number | undefined;
    capError?: ((cap: number) => Error) | undefined;
}
export declare abstract class ModelClientBase {
    readonly id: string;
    readonly model: string;
    readonly provider: ProviderRecord | undefined;
    protected readonly label: string;
    protected readonly http: JudgeHttp;
    protected readonly calibration: Calibration | undefined;
    protected readonly cache: JudgeAnswerCache | undefined;
    protected readonly extraBody: Record<string, unknown>;
    protected constructor(options: ModelScorerOptions);
    /** HTTP attempts made so far (retries and splits included). */
    get requests(): number;
    /** `provider|protocol|model` for cache probes: answers of one provider are never reused for another. */
    protected get providerKey(): string | undefined;
    /** A grade on the 0..3 scale -> the calibrated grade (identity without a calibration). */
    protected shape(grade: number): number;
    /**
     * Run `run` over the request chunks in order. `run` returns how many of the chunk's questions went unanswered.
     * A failed chunk only loses its own questions; a refused reservation stops the remaining chunks (never asked);
     * an abort or a fatal error (bad key, request cap) propagates.
     */
    protected dispatch<Q>(chunks: readonly Q[][], run: (chunk: Q[]) => Promise<number>, ctx: ScoreContext): Promise<Dispatch>;
    /**
     * Fill the usage totals and the notes after `dispatch`. Throws when the model stage produced (almost) nothing so the
     * caller falls back to the rule grades: nothing asked because of the budget, or more than half the questions unanswered.
     * @returns the notes
     */
    protected conclude(d: Dispatch, usage: ScoreUsage, counts: {
        total: number;
        asked: number;
        requestsBefore: number;
    }): string[];
}
export declare abstract class ModelScorerBase extends ModelClientBase implements Scorer {
    abstract readonly rubricRef: RubricRef | undefined;
    abstract score(task: ScoreTask, jobs: readonly ScoreJob[], ctx?: ScoreContext): Promise<ScoreOutcome>;
}
export interface Dispatch {
    failed: number;
    notes: string[];
    budgetStop?: BudgetExceededError | undefined;
}
