/**
 * Provider registry entry point: the process-wide registry (built-ins registered) and the ids derived from it.
 * @module web-search-pro/providers
 */

import { createBuiltinRegistry } from './builtin.ts'
import type { ProviderRegistry } from './registry.ts'

export { ProviderRegistry, routeIdOf } from './registry.ts'
export type { ProviderAdapter, ProviderDescriptor, Readiness, ProbeEnv, Requirement, CostDescriptor, Operation, CredentialState, InstallationState, Health } from './registry.ts'
export { createBuiltinRegistry, builtinAdapters } from './builtin.ts'

/**
 * The registry every SearchRouter uses unless given another. External adapters (a later milestone) register here;
 * nothing is discovered or loaded dynamically.
 */
export const defaultProviderRegistry: ProviderRegistry = createBuiltinRegistry()

/** Route ids of the BUILT-IN search providers (a snapshot of the default registry at load; tool validation reads the live registry). */
export const SEARCH_ENGINE_IDS: readonly string[] = Object.freeze(defaultProviderRegistry.searchIds())

/** Route ids of the BUILT-IN platforms (a snapshot like {@link SEARCH_ENGINE_IDS}; `customPlatforms` keys are added to the live registry). */
export const PLATFORM_IDS: readonly string[] = Object.freeze(defaultProviderRegistry.platformIds())
