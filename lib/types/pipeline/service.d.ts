/**
 * Wiring of the evidence pipeline to the plugin: registry-backed providers,
 * FetchService pages, the configured scorers, and persistence of the run.
 * `search.run` calls {@link EvidenceService.search} when `task` or
 * `profile` is given.
 * @module web-search-pro/pipeline/service
 */
import type { FetchService } from '../fetch.ts';
import type { ResolvedConfig } from '../config.ts';
import type { SearchRouter } from '../router.ts';
import type { Store } from '../store.ts';
import { shapeSources } from '../util.ts';
import { type TaskInput } from './task.ts';
import type { EvidencePack } from './types.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
export interface EvidenceRequest extends TaskInput {
    /** Explicit engine ids (tool `engines`). */
    engines?: string[] | undefined;
    /**
     * One platform provider as the explicit source set of S1 / S2 (`search.run platform=` with `task`): it wins over the
     * profile's table, and `url` / `authProfile` / `rulePack` go to its calls (`browserBindings` fill the rest). S3-S8 run as usual.
     */
    platform?: {
        id: string;
        url?: string | undefined;
        authProfile?: string | undefined;
        rulePack?: string | undefined;
    } | undefined;
    /**
     * An explicit platform source that cannot run (missing browser / login / CLI / token, cooling down) is an error naming
     * what is missing. With `allowFallback` the profile's web engines are searched instead and the pack says so.
     */
    allowFallback?: boolean | undefined;
    /** `sources` entries to return. */
    count: number;
    signal?: AbortSignal | undefined;
    /** Overall deadline in ms (default: `timeoutMs` + 30 s). The ctx.web provider route passes a shorter one. */
    deadlineMs?: number | undefined;
    /** The caller is the ctx.web provider: keep the ctx.web engine out of the run (it would call back into this plugin). */
    skipSeam?: boolean | undefined;
}
export interface EvidenceServiceDeps {
    router: Pick<SearchRouter, 'providerStatuses' | 'resolveSecret'> & {
        runProvider: SearchRouter['runProvider'];
    } & {
        registry?: ProviderRegistry;
    };
    fetch: Pick<FetchService, 'fetchPage'>;
    store: Store;
    dynamic: () => ResolvedConfig;
    /** Test seam for the judge HTTP client. */
    fetchImpl?: typeof fetch;
    /** Test seam for the usage ledger's clock (epoch ms). */
    now?: () => number;
}
/** Pack as returned by the tool: `sources` shaped like every other exit. */
export type EvidenceOutput = Omit<EvidencePack, 'sources'> & {
    sources: ReturnType<typeof shapeSources>;
    fromCache: false;
};
export declare const PAGE_MAX_CHARS = 60000;
export declare class EvidenceService {
    private readonly deps;
    constructor(deps: EvidenceServiceDeps);
    /**
     * Which scorer decides and which (if any) only observes. The mode is `evidence.judge.mode`, or its legacy alias
     * `evidence.jevMode`; the model behind it is `evidence.judge.provider` (default `bocha-jev`). Whatever cannot be set
     * up (unknown provider, missing key, uncalibrated reranker, ...) leaves the rule scorer in charge and says why.
     */
    private scorers;
    search(request: EvidenceRequest): Promise<EvidenceOutput>;
    /** Best-effort: the pack already exists, a storage failure must not lose it. */
    private persist;
}
