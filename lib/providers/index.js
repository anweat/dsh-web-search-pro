/**
 * Provider registry entry point: the process-wide registry (built-ins registered) and the ids derived from it.
 * @module web-search-pro/providers
 */
import { createBuiltinRegistry } from "./builtin.js";
export { ProviderRegistry, routeIdOf, costTierOf, COST_TIERS } from "./registry.js";
export { createBuiltinRegistry, builtinAdapters } from "./builtin.js";
/**
 * The registry every SearchRouter uses unless given another. External adapters (a later milestone) register here;
 * nothing is discovered or loaded dynamically.
 */
export const defaultProviderRegistry = createBuiltinRegistry();
/** Route ids of the BUILT-IN search providers (a snapshot of the default registry at load; tool validation reads the live registry). */
export const SEARCH_ENGINE_IDS = Object.freeze(defaultProviderRegistry.searchIds());
/** Route ids of the BUILT-IN platforms (a snapshot like {@link SEARCH_ENGINE_IDS}; `customPlatforms` keys are added to the live registry). */
export const PLATFORM_IDS = Object.freeze(defaultProviderRegistry.platformIds());
//# sourceMappingURL=index.js.map