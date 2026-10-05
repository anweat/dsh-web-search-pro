/**
 * Provider registry of the judge layer: built-in presets, user-defined providers
 * (`evidence.judge.providers`), validation and the factory that turns a provider
 * into a Scorer. A provider is `{ id, protocol, baseUrl, model, keyRef, limits,
 * calibration?, rubricId? }`; supporting another decision / rerank model means adding
 * an entry here (or in settings), not code, as long as it speaks a known protocol.
 * @module web-search-pro/pipeline/judges/providers
 */
import type { ResolvedRubric } from '../rubrics.ts';
import { SystemOneCoverageJudge } from './coverage.ts';
import type { ModelScorerBase } from './model-scorer.ts';
import { DEFAULT_PROVIDER_ID, PRESETS, providerProblems, resolveProviders, unusableReason, type JudgeSettings } from './providers-spec.ts';
import type { JudgeAnswerCache, ProviderConfig, UsageMeter } from './types.ts';
export { DEFAULT_PROVIDER_ID, PRESETS, providerProblems, resolveProviders, unusableReason };
export { JEV_BASE_URL, JEV_KEY_REF, JEV_MODEL } from './providers-spec.ts';
export type { JudgeSettings, ProviderCatalog } from './providers-spec.ts';
export declare const JEV_URL: string;
export interface ProviderSelection {
    provider?: ProviderConfig;
    /** Why no provider could be used (the rule scorer stays in charge). */
    unusable?: string;
    diagnostics: string[];
}
/** The configured provider (default bocha-jev), checked for being usable at all. */
export declare function selectProvider(settings?: JudgeSettings | undefined): ProviderSelection;
/** Full endpoint URL of a provider. */
export declare function endpointOf(p: ProviderConfig): string;
export interface ScorerDeps {
    /** Resolved from `keyRef`; absent for key-less (local) providers. */
    apiKey?: string | undefined;
    rubric?: ResolvedRubric | undefined;
    fetchImpl?: typeof fetch | undefined;
    sleep?: ((ms: number) => Promise<void>) | undefined;
    meter?: UsageMeter | undefined;
    cache?: JudgeAnswerCache | undefined;
    /** Hard cap on HTTP attempts of this scorer (default: the provider's limits.requestCap). */
    requestCap?: number | undefined;
}
/** The scorer for a provider: ModelScorer over its protocol. Throws when the provider cannot be built (e.g. an uncalibrated reranker). */
export declare function createModelScorer(p: ProviderConfig, deps?: ScorerDeps): ModelScorerBase;
/**
 * The coverage judge (dev-plan M9) of a provider: one `noul` question per need, so only the `systemone` protocol
 * can serve it. Throws for any other protocol and for a provider that needs a key it was not given.
 */
export declare function createCoverageJudge(p: ProviderConfig, deps?: ScorerDeps): SystemOneCoverageJudge;
