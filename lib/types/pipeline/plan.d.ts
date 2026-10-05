/**
 * S1 source planning (dev-plan §4.3): profile -> provider table, explicit
 * `engines` first, availability / cooldown filtering, one compiled query per
 * provider. Pure: availability comes in through a callback so the router
 * registry (or a test double) supplies it.
 * @module web-search-pro/pipeline/plan
 */
import type { SourcePolicy } from '../config-enums.ts';
import { type CompiledQuery } from './compile.ts';
import { type CostTier, type CredentialState, type ProviderDescriptor } from '../providers/registry.ts';
import type { Profile, TaskSpec } from './types.ts';
/** Provider ids per profile (`general` uses the configured `engines`). */
export declare const PROFILE_PROVIDERS: Readonly<Record<Exclude<Profile, 'general'>, readonly string[]>>;
/**
 * Supplementary sources per profile (registered ones only): candidates for the second round and for recommendations, never
 * part of round 1 and never a replacement for web search (Wikipedia for facts and background, Stack Overflow for code questions).
 */
export declare const PROFILE_SUPPLEMENTS: Readonly<Record<Profile, readonly string[]>>;
/** Default cap on providers of one plan (general profile with a long engine list). */
export declare const DEFAULT_MAX_PROVIDERS = 4;
export type ProviderState = 'ready' | 'unavailable' | 'cooldown';
export interface ProviderStatus {
    state: ProviderState;
    reason?: string;
    /** Local credential dimension from the registry probe; `missing` keeps a provider out of automatic promotion (it still runs when asked for). */
    credential?: CredentialState;
    /** Tier of the route that would run now (Exa without a key: `anonymous`); absent = the descriptor's. */
    costTier?: CostTier;
    /** The provider can run through a route that needs no credential (Exa over MCP): promotable although `credential` is `missing`. */
    keyless?: boolean;
    /** Unavailable because its request budget (`sources.budget`) is used up: the plan says so and falls back to other sources. */
    budgetExhausted?: boolean;
}
export interface PlannedProvider {
    id: string;
    compiled: CompiledQuery;
}
export interface SourcePlan {
    profile: Profile;
    /** The profile came from rule inference, not from the caller. */
    profileInferred: boolean;
    providers: PlannedProvider[];
    /** Task language the plan was made for (`zh`, `en`); absent when the text has no letters. */
    language?: 'zh' | 'en';
    /** The ordered provider ids the plan drew from before availability filtering and caps (the follow-up round reuses it). */
    wanted: string[];
    /** Providers dropped by the availability filter, with the reason. */
    skipped: {
        id: string;
        reason: string;
    }[];
    notes: string[];
}
export interface PlanOptions {
    /** Explicit engine ids (tool `engines` param): override the profile table. */
    engines?: readonly string[];
    /** Configured engine list, used by the general profile. */
    configured: readonly string[];
    /** Availability lookup; undefined = the registry does not know the id. Omitted = everything is ready. */
    status?: (id: string) => ProviderStatus | undefined;
    maxProviders?: number;
    now?: Date;
    /**
     * Registry descriptors (search providers). With them S1 is language-aware: a provider that is strong in the
     * task's language (`languages` names `zh` / `en`), serves the profile (`taskProfiles`), returns `web` results and is
     * ready with a configured key is PROMOTED ahead of the profile table (by `priority`), and the other web engines
     * behind it shrink to `webFallbacks` (vertical sources such as GitHub or arXiv are untouched). Nothing names a provider: a new adapter's descriptor is enough.
     */
    descriptors?: readonly ProviderDescriptor[];
    /** false = no promotion (the profile table / configured engines as they are). Default true. */
    autoProviders?: boolean;
    /** Other web engines kept behind promoted providers, in table order (default 1). */
    webFallbacks?: number;
    /** Most providers promoted for the task language (default {@link DEFAULT_MAX_PROMOTED}); providers of one `sourceFamily` count once. */
    maxPromoted?: number;
    /**
     * The user's own say (dev-plan M11a), below an explicit `engines` and above the automatic promotion: `priority` ids that are
     * ready and fit the task's profile and language go first, in that order; `disabled` ids are never planned. Route ids.
     */
    priority?: readonly string[];
    disabled?: readonly string[];
    /** `anonymous-only`: no source that needs a key, account or login is planned automatically, configured or not. Default `default`. */
    policy?: SourcePolicy;
    /** Per-provider compilation; defaults to the core compiler (adapters may supply their own). */
    compiler?: (task: TaskSpec, providerId: string, now: Date) => CompiledQuery;
}
export declare const DEFAULT_WEB_FALLBACKS = 1;
/**
 * Most providers promoted ahead of the profile table for one task (dev-plan M7c). With the round-1 cap of three, two
 * specialists leave one slot for a free fallback engine, so configuring every keyed source never crowds out the keyless ones.
 * The surplus stays in `wanted` (second round).
 */
export declare const DEFAULT_MAX_PROMOTED = 2;
/** `zh` / `en` from the task text (goal + query); undefined when there is no letter to tell. */
export declare function taskLanguage(task: Pick<TaskSpec, 'goal' | 'query'>): 'zh' | 'en' | undefined;
/** Keyword hit counts per profile (general has no keywords). */
export declare function profileHits(text: string): Record<Exclude<Profile, 'general'>, number>;
/** Softmax over keyword hits with a fixed prior for `general` (the r1 bench rule judge's choice scores). */
export declare function profileScores(text: string): Record<string, number>;
/** Conservative rule inference: the profile with strictly the most keyword hits, else general (r1: 60% accurate, hence only a fallback). */
export declare function inferProfile(text: string): Profile;
export declare function planSources(task: TaskSpec, options: PlanOptions): SourcePlan;
