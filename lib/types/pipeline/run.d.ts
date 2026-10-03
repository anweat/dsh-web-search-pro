/**
 * The evidence pipeline (dev-plan §4.3): S1 plan -> S2 recall -> S3/S4 merge,
 * fuse, gate -> S5 read and split -> S6 score -> S7 select -> S8 coverage ->
 * EvidencePack. One round, plus (S8) at most one follow-up round for critical
 * gaps while the round, query and time budgets allow.
 *
 * Every side effect is injected (`PipelineDeps`), so the same stages run
 * against live engines and fetchers (service.ts), against test doubles, and
 * offline over frozen snapshots (bench/src/eval-pack.ts calls
 * `runEvidenceStages` directly with the snapshot's candidates and pages).
 *
 * Cancellation: the caller's signal aborts everything and is rethrown. The
 * run's own deadline is different: when it passes, in-flight work is cut, the
 * stages that need no network still run on what exists, and the pack comes
 * back with `partial: true`.
 * @module web-search-pro/pipeline/run
 */
import { type ProviderOutput, type ProviderSource } from './candidates.ts';
import { type SplitOptions } from './blocks.ts';
import { type CompiledQuery } from './compile.ts';
import { type FusionOptions } from './fusion.ts';
import { type ProviderStatus, type SourcePlan } from './plan.ts';
import { type ProviderDescriptor } from '../providers/registry.ts';
import { type ScoreJob, type Scorer } from './score.ts';
import { type SelectOptions } from './select.ts';
import type { Block, EvidencePack, Need, ScoredBlock, TaskSpec } from './types.ts';
/** Per-call provider options of the caller (not of the query): the platform's feed URL and browser auth profile / rule pack. */
export interface CallOptions {
    url?: string;
    browser?: {
        authProfile?: string;
        rulePack?: string;
    };
}
export interface ProviderCall {
    id: string;
    query: string;
    count: number;
    options?: CompiledQuery['options'] & CallOptions;
    signal: AbortSignal;
}
export type ProviderOutcome = {
    state: 'ok';
    sources: readonly ProviderSource[];
} | {
    state: 'empty';
} | {
    state: 'skipped';
    reason: string;
} | {
    state: 'error';
    message: string;
};
/** A page as S5 needs it: text, plus ready-made blocks when the caller already split it. */
export interface PageInput {
    url: string;
    title?: string;
    text: string;
    shellPage?: boolean;
    source?: string;
    blocks?: readonly Block[];
}
export interface PipelineDeps {
    /** Availability of providers (registry probe + cooldown); omitted = all ready. */
    providerStatus?: (ids: readonly string[]) => Promise<ReadonlyMap<string, ProviderStatus>>;
    /** S2: run one provider with a compiled query. */
    searchProvider?: (call: ProviderCall) => Promise<ProviderOutcome>;
    /**
     * S5: read a page. Throws on failure (the candidate stays navigation-only).
     * `undefined` = no page exists for it (offline snapshots): the candidate does not use up a fetch slot.
     */
    fetchPage: (url: string, signal: AbortSignal) => Promise<PageInput | undefined>;
    scorers: {
        /** Decides S6 (defaults to the rule scorer). A failure falls back to the rule scorer. */
        control?: Scorer;
        /** Runs in parallel to the decision for later comparison; never changes the pack. */
        shadow?: Scorer;
    };
    configuredEngines: readonly string[];
    /** Registry descriptors of the search providers: S1 prefers providers strong in the task's language (plan.ts). Omitted = the profile tables only. */
    descriptors?: readonly ProviderDescriptor[];
    /** `evidence.autoProviders` (default true). */
    autoProviders?: boolean;
    /** Per-provider query compilation (registry adapters may bring their own); default the core compiler. */
    compiler?: (task: TaskSpec, providerId: string, now: Date) => CompiledQuery;
    fusion: Omit<FusionOptions, 'nProviders' | 'now'>;
    now?: () => Date;
    newId?: () => string;
}
export interface PipelineOptions {
    /** The tool's AbortSignal: aborts everything, rethrown. */
    signal?: AbortSignal | undefined;
    /** Overall deadline (default: `task.budget.deadlineMs`, else 60 s). */
    deadlineMs?: number;
    /** Explicit engine ids (override the profile table). */
    engines?: readonly string[];
    /** Results requested per provider (default 10). */
    perProviderCount?: number;
    /** Options added to every call of a provider, by provider id (the platform's `url`, `authProfile`, `rulePack`). */
    providerOptions?: Readonly<Record<string, CallOptions>>;
    /** Kept candidates whose pages are read (default `task.budget.fetchTopK`, else 4). */
    fetchTopK?: number;
    fetchConcurrency?: number;
    /** Per-page character cap handed to the fetcher (default 60,000). */
    maxPageChars?: number;
    /** Blocks per need that reach S6. Default: adaptive, 12 up to 24 for pages with more than 80 blocks. */
    blocksPerNeed?: number;
    /** Upper bound of (need, block) questions handed to a remote scorer (default 64). */
    maxScoreQuestions?: number;
    /** `sources` entries in the pack (default 8). */
    sourcesCount?: number;
    select?: Partial<SelectOptions>;
    blocks?: SplitOptions;
    /** Retrieval rounds per task; 1 = no follow-up round (default 2). */
    maxRounds?: number;
    /**
     * Search queries per task over all rounds, round 1 included (default 4). One query = one provider call: the broader
     * fallback retries of a provider (GitHub keyword relaxation) count once together. While a follow-up round is allowed
     * (`maxRounds` > 1), round 1 runs at most `maxQueries - 1` of the planned providers (the last ones in plan order wait
     * for round 2) so that one query is left for it; explicit `engines` are never trimmed.
     */
    maxQueries?: number;
    /** The S4 gate keeps at least this many candidates (best-fused, flagged low-confidence) when it would leave fewer (default 3; 0 = no floor). */
    minKeep?: number;
    /** Pages the follow-up round reads at most (default 2, never more than `fetchTopK`). */
    refineFetchTopK?: number;
    /** A follow-up round needs at least this long before the deadline (default 15 s). */
    refineMinRemainingMs?: number;
}
export declare const DEFAULT_DEADLINE_MS = 60000;
export declare const DEFAULT_MAX_ROUNDS = 2;
export declare const DEFAULT_MAX_QUERIES = 4;
/** `provider|protocol|model[|calibration]`: what an evidence row records about the judge behind its grade. */
export declare const judgeKey: (scorer: Scorer) => string | undefined;
export declare function verificationOf(task: Pick<TaskSpec, 'constraints'>, compiled: readonly CompiledQuery[]): EvidencePack['verification'];
export interface PipelineResult {
    pack: EvidencePack;
    task: TaskSpec;
    /** Canonical URLs of the candidates whose pages were read and split into blocks. */
    pagesRead: string[];
    /** Every block that got an S6 grade (the selection pool). */
    scored: ScoredBlock[];
    /** Full text of every selected block (for storage and `history.expand`). */
    evidenceBlocks: {
        evidenceId: string;
        url: string;
        blockId: string;
        heading?: string;
        text: string;
        hash: string;
        grade: number;
        scorer: string;
        rubric?: string;
        judge?: string;
    }[];
    /** Shadow scorer output for later comparison (Jev mode `shadow`). */
    shadow?: {
        scorer: string;
        model: string;
        rubric?: string;
        judge?: string;
        rows: {
            needId: string;
            blockId: string;
            shadow: number;
            control: number;
        }[];
    };
}
export declare function runPipeline(task: TaskSpec, deps: PipelineDeps, options?: PipelineOptions): Promise<PipelineResult>;
/** What a follow-up search round needs: the gap needs and the request budget of the whole task. */
export interface RefineRequest {
    needs: readonly Need[];
    maxQueries: number;
}
export type RefineOutcome = {
    state: 'ok';
    outputs: ProviderOutput[];
    providers: string[];
    queries: number;
    notes: string[];
    cut: boolean;
} | {
    state: 'skipped';
    reason: string;
};
export interface StageContext {
    plan: Pick<SourcePlan, 'profile' | 'profileInferred'> & {
        providers: readonly {
            id: string;
        }[];
    };
    notes: string[];
    partial: boolean;
    signal?: AbortSignal | undefined;
    /** Aborts on the caller's signal or the deadline. */
    stage: AbortSignal;
    deadlineSignal: AbortSignal;
    deadline?: number;
    now: Date;
    verification: EvidencePack['verification'];
    /** S2 of a follow-up round (supplied by `runPipeline`; absent over frozen snapshots, where no second round can run). */
    refine?: (request: RefineRequest) => Promise<RefineOutcome>;
    /** Search requests made so far over all rounds (default: the number of provider outputs). */
    queryCount?: () => number;
}
/** S3–S8 over provider outputs that already exist (live S2, or frozen snapshot results). */
export declare function runEvidenceStages(task: TaskSpec, outputs: readonly ProviderOutput[], deps: PipelineDeps, options: PipelineOptions, ctx: StageContext): Promise<PipelineResult>;
/** Cap the number of (need, block) questions for a paid scorer: round-robin over the needs, keeping each need's pre-rank order. */
export declare function limitQuestions(jobs: readonly ScoreJob[], max: number): ScoreJob[];
