/**
 * S1 source planning (dev-plan §4.3): profile -> provider table, explicit
 * `engines` first, availability / cooldown filtering, one compiled query per
 * provider. Pure: availability comes in through a callback so the router
 * registry (or a test double) supplies it.
 * @module web-search-pro/pipeline/plan
 */
import { type CompiledQuery } from './compile.ts';
import type { Profile, TaskSpec } from './types.ts';
/** Provider ids per profile (`general` uses the configured `engines`). */
export declare const PROFILE_PROVIDERS: Readonly<Record<Exclude<Profile, 'general'>, readonly string[]>>;
/** Default cap on providers of one plan (general profile with a long engine list). */
export declare const DEFAULT_MAX_PROVIDERS = 4;
export type ProviderState = 'ready' | 'unavailable' | 'cooldown';
export interface ProviderStatus {
    state: ProviderState;
    reason?: string;
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
}
/** Keyword hit counts per profile (general has no keywords). */
export declare function profileHits(text: string): Record<Exclude<Profile, 'general'>, number>;
/** Softmax over keyword hits with a fixed prior for `general` (the r1 bench rule judge's choice scores). */
export declare function profileScores(text: string): Record<string, number>;
/** Conservative rule inference: the profile with strictly the most keyword hits, else general (r1: 60% accurate, hence only a fallback). */
export declare function inferProfile(text: string): Profile;
export declare function planSources(task: TaskSpec, options: PlanOptions): SourcePlan;
