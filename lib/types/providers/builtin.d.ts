/**
 * The built-in search providers as registry entries (dev-plan M6): descriptors plus the factories that
 * already existed in engines.ts, so behaviour is unchanged. Adding a source = one descriptor + adapter
 * (see bocha.ts) registered here or, later, by an external plugin; nothing in the router or planner names it.
 * @module web-search-pro/providers/builtin
 */
import { ProviderRegistry, type ProviderAdapter } from './registry.ts';
export declare function builtinAdapters(): ProviderAdapter[];
/** A fresh registry holding the built-in providers (tests and the process-wide default start from this). */
export declare function createBuiltinRegistry(): ProviderRegistry;
