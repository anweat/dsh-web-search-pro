/**
 * Platform search backends as registry providers (dev-plan M8b): one provider per site or community, with the same
 * descriptor + adapter shape as the web engines, so a platform is planned, probed, cooled down, singleflighted,
 * persisted and reported exactly like any other source. A platform with several backends (twitter: twitter-cli, standalone
 * OpenCLI, dsh-browser OpenCLI) is ONE provider with an internal ordered chain, resolved by src/cli/chain.ts (dev-plan M12). User `customPlatforms` become providers too
 * ({@link customPlatformAdapter}); the router registers and unregisters them as the settings change.
 * The legacy platform ids that already were web providers (github, bilibili, v2ex, youtube, arxiv, pubmed) are
 * declared in builtin.ts and carry `kind: 'platform'` as well.
 * @module web-search-pro/providers/platforms
 */
import { type Engine } from '../engines.ts';
import type { CustomPlatformSpec } from '../config.ts';
import { type CliAdapterSpec } from '../cli/spec.ts';
import type { ProviderAdapter, ProviderDescriptor } from './registry.ts';
/** Chain `engines` into one provider: the first available leg that answers wins; empty and failing legs fall through in order. */
export declare function chainEngine(id: string, label: string, chain: readonly Engine[]): Engine;
/**
 * A platform provider whose backends are an ordered chain (`resolveChain`): the engine is the chain, the local probe is the
 * readiness of every leg (cached contract probes, no search, no login), and `chain` reports each leg for `sources.status`.
 */
export declare function chainProvider(platformId: string, d: ProviderDescriptor): ProviderAdapter;
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
/** Registry id and route id of a user-defined CLI adapter: `custom-cli:<id>` (also its backend id in `platformBackends`). */
export declare const customCliProviderId: (id: string) => string;
/** A user-defined CLI adapter as a platform provider whose chain is the adapter itself (an edit of `platformBackends` can still reorder it). */
export declare function customCliAdapter(id: string, spec: CliAdapterSpec): ProviderAdapter;
/** A user spec as validated for registration: the problem text, or undefined when it can be registered. */
export declare function customCliProblem(id: string, raw: unknown): string | undefined;
