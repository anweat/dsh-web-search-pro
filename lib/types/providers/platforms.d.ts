/**
 * Platform search backends as registry providers (dev-plan M8b): one provider per site or community, with the same
 * descriptor + adapter shape as the web engines, so a platform is planned, probed, cooled down, singleflighted,
 * persisted and reported exactly like any other source. A platform with several backends (twitter: OpenCLI, then
 * twitter-cli) is ONE provider with an internal ordered chain. User `customPlatforms` become providers too
 * ({@link customPlatformAdapter}); the router registers and unregisters them as the settings change.
 * The legacy platform ids that already were web providers (github, bilibili, v2ex, youtube, arxiv, pubmed) are
 * declared in builtin.ts and carry `kind: 'platform'` as well.
 * @module web-search-pro/providers/platforms
 */
import { type Engine } from '../engines.ts';
import type { CustomPlatformSpec } from '../config.ts';
import type { ProviderAdapter } from './registry.ts';
/** Chain `engines` into one provider: the first available leg that answers wins; empty and failing legs fall through in order. */
export declare function chainEngine(id: string, label: string, chain: readonly Engine[]): Engine;
export declare const platformAdapters: readonly ProviderAdapter[];
/** Registry id of a custom platform: its key when that is a valid id, else a stable hash of it (the key stays the route alias). */
export declare function customProviderId(key: string): string;
/** A key the registry cannot take as an alias (whitespace or a comma would break the `engines` list). */
export declare function customKeyProblem(key: string): string | undefined;
/**
 * A custom platform as a provider. The engine reads the spec from the settings it is created with, so a settings edit
 * reaches the next call even before the router re-registers the provider.
 */
export declare function customPlatformAdapter(key: string, spec: CustomPlatformSpec): ProviderAdapter;
