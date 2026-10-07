/**
 * Platform backend chains (dev-plan M12): every platform provider resolves an ORDERED chain of backends - a standalone CLI
 * spec (xhs, rdt, zhihu, twitter, bili, yt-dlp, omnireach, gh, ...), the standalone OpenCLI (`opencli`), the dsh-browser
 * OpenCLI bridge (`browser-opencli`), dsh-browser's rendered search page (`browser-search`), or the plugin's REST client
 * (`rest`). The order is configurable (`platformBackends`). A backend that is missing, incompatible or not logged in is
 * skipped with its reason; the provider is unavailable only when the whole chain is, and its error names what to install
 * or run. Readiness is local: no search, no login.
 * @module web-search-pro/cli/chain
 */
import { type Engine, type EngineDeps } from '../engines.ts';
import type { ResolvedConfig } from '../config.ts';
import { CHAIN_PLATFORMS, DEFAULT_CHAINS } from './chains-spec.ts';
import { type CliAdapterSpec } from './spec.ts';
export type BackendKind = 'cli' | 'opencli' | 'browser-opencli' | 'browser-search' | 'rest' | 'custom-cli';
export { DEFAULT_CHAINS, CHAIN_PLATFORMS };
export interface LegReadiness {
    ready: boolean;
    installation: 'missing' | 'detected' | 'incompatible' | 'not_required';
    version?: string;
    credential?: 'not_required' | 'missing' | 'configured';
    reason?: string;
    /** Why it is skipped (absent when ready). */
    code?: 'disabled' | 'cli_missing' | 'cli_incompatible' | 'not_logged_in' | 'browser_missing' | 'unsupported';
}
export interface ChainLeg {
    /** Backend id as written in `platformBackends`. */
    id: string;
    kind: BackendKind;
    label: string;
    engine: Engine;
    readiness(): Promise<LegReadiness>;
    /** How far this backend's contract was checked (`live`, `contract-only`, `docs-only`, `unverified`). */
    verification: string;
}
export interface ChainResolution {
    legs: ChainLeg[];
    /** Problems of the configuration (an unknown or foreign backend id), for `sources.status`. */
    diagnostics: string[];
}
export interface ChainContext {
    deps: EngineDeps;
    config: ResolvedConfig;
}
/** All specs a chain may use: the built-ins by id and the user's `cliAdapters` as `custom-cli:<id>`. */
export declare function allSpecs(config: Pick<ResolvedConfig, 'cliAdapters'>): {
    specs: Map<string, CliAdapterSpec>;
    diagnostics: string[];
};
/** The chain of one platform: the configured (`platformBackends`) or default order, each id turned into a leg or into a diagnostic. */
export declare function resolveChain(platform: string, ctx: ChainContext): ChainResolution;
export interface ChainEntryReport {
    id: string;
    kind: BackendKind;
    label: string;
    order: number;
    state: 'ready' | 'skipped';
    installation?: string;
    version?: string;
    credential?: string;
    reason?: string;
    verification: string;
}
/**
 * What a chain can do right now, one word for the text and the structured fields alike:
 * `ready` (a backend can run and its login is satisfied or not needed), `login_unverified` (a backend can run but its login
 * cannot be checked locally: a browser session, a keyring), `needs_login` (nothing can run and at least one backend lacks its
 * login or credential), `unavailable` (nothing can run: not installed, incompatible, disabled).
 */
export type ChainState = 'ready' | 'login_unverified' | 'needs_login' | 'unavailable';
export interface ChainReport {
    entries: ChainEntryReport[];
    available: boolean;
    state: ChainState;
    /** The first ready leg, or the best state among the skipped ones. */
    installation: 'missing' | 'detected' | 'incompatible' | 'not_required';
    credential?: 'not_required' | 'missing' | 'configured';
    /** Why nothing can run: every skip reason in chain order. */
    reason?: string;
    diagnosticCode?: string;
    diagnostics: string[];
}
/** Local readiness of a whole chain (one probe per leg, cached). */
export declare function chainReport(platform: string, ctx: ChainContext): Promise<ChainReport>;
