/**
 * The pure part of the judge provider registry (dev-plan M10): built-in presets, the validation of a provider
 * definition and the catalog resolution. No Node imports and no protocol code, so the settings panel (client bundle)
 * runs the very validation the server runs; the scorer factories live in ./providers.ts.
 * @module web-search-pro/pipeline/judges/providers-spec
 */
import { type ProviderConfig } from './types.ts';
/** Credentials ref / environment variable holding the Bocha Jev key. */
export declare const JEV_KEY_REF = "BOCHA_JEV_API_KEY";
export declare const JEV_BASE_URL = "https://jev.bocha.cn";
export declare const JEV_MODEL = "bocha-jev-v1";
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
export declare const PROVIDER_ID_PATTERN: RegExp;
/** Scorer ids the pipeline gives meaning to. */
export declare const RESERVED_PROVIDER_IDS: string[];
export declare const KEY_REF_PATTERN: RegExp;
export declare const PROVIDER_LIMIT_KEYS: readonly ["maxQuestionsPerRequest", "requestTokenBudget", "blockChars", "maxNeedChars", "maxStateChars", "maxBodyBytes", "maxDocumentsPerRequest", "maxRetries", "timeoutMs", "requestCap"];
export declare const PROVIDER_FIELDS: readonly ["protocol", "baseUrl", "model", "keyRef", "path", "limits", "calibration", "rubricId", "extraBody", "price", "tokenModel", "label"];
/** Problems of a complete provider definition; empty = usable. */
export declare function providerProblems(p: Record<string, unknown>): string[];
export interface ProviderCatalog {
    providers: Map<string, ProviderConfig>;
    /** Problems of custom entries (those providers are left out). */
    diagnostics: string[];
}
/** Every usable provider: the presets, overridden / extended by `settings.providers`. */
export declare function resolveProviders(settings?: JudgeSettings | undefined): ProviderCatalog;
export declare function unusableReason(p: ProviderConfig, settings?: JudgeSettings | undefined): string | undefined;
