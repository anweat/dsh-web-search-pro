/**
 * Provider registry of the judge layer: built-in presets, user-defined providers
 * (`evidence.judge.providers`), validation and the factory that turns a provider
 * into a Scorer. A provider is `{ id, protocol, baseUrl, model, keyRef, limits,
 * calibration?, rubricId? }`; supporting another decision / rerank model means adding
 * an entry here (or in settings), not code, as long as it speaks a known protocol.
 * @module web-search-pro/pipeline/judges/providers
 */
import { type ResolvedRubric } from '../rubrics.ts';
import { SystemOneCoverageJudge } from './coverage.ts';
import type { ModelScorerBase } from './model-scorer.ts';
import { type JudgeAnswerCache, type ProviderConfig, type UsageMeter } from './types.ts';
/** Credentials ref / environment variable holding the Bocha Jev key. */
export declare const JEV_KEY_REF = "BOCHA_JEV_API_KEY";
export declare const JEV_BASE_URL = "https://jev.bocha.cn";
export declare const JEV_MODEL = "bocha-jev-v1";
export declare const JEV_URL: string;
export declare const DEFAULT_PROVIDER_ID = "bocha-jev";
/** Built-in presets. Only `bocha-jev` is exercised by the plugin's own experiments; the others are unverified starting points. */
export declare const PRESETS: Readonly<Record<string, ProviderConfig>>;
export interface JudgeSettings {
    /** Provider id used when a model scorer is on (default `bocha-jev`). */
    provider?: string | undefined;
    /** Allow providers speaking the `llm` protocol (default false). */
    allowLlm?: boolean | undefined;
    /** Custom providers, or overrides of a preset with the same id. */
    providers?: Record<string, unknown> | undefined;
}
/** Problems of a complete provider definition; empty = usable. */
export declare function providerProblems(p: Record<string, unknown>): string[];
export interface ProviderCatalog {
    providers: Map<string, ProviderConfig>;
    /** Problems of custom entries (those providers are left out). */
    diagnostics: string[];
}
/** Every usable provider: the presets, overridden / extended by `settings.providers`. */
export declare function resolveProviders(settings?: JudgeSettings | undefined): ProviderCatalog;
export interface ProviderSelection {
    provider?: ProviderConfig;
    /** Why no provider could be used (the rule scorer stays in charge). */
    unusable?: string;
    diagnostics: string[];
}
/** The configured provider (default bocha-jev), checked for being usable at all. */
export declare function selectProvider(settings?: JudgeSettings | undefined): ProviderSelection;
export declare function unusableReason(p: ProviderConfig, settings?: JudgeSettings | undefined): string | undefined;
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
