/**
 * The runner of CLI adapter specs (dev-plan M12): spawns the tool without a shell, decodes its output as UTF-8, caps
 * time and size, maps the output to search sources and every failure to a structured error. It never logs or echoes
 * environment values (error text is scrubbed of any value of a variable the spec names) and never runs a login.
 * @module web-search-pro/cli/runner
 */
import type { WebSearchSource } from '@deepseek-ai/dsh-web';
import { runCli } from '../util.ts';
import { EngineError } from '../engine-error.ts';
import { type CliAdapterSpec, type CliErrorCode, type CliOutputSpec, type CliSearchSpec, type FieldSource } from './spec.ts';
/** A structured failure of a CLI adapter: `code` is one of {@link CliErrorCode}; `hint` says what the user can do. */
export declare class CliAdapterError extends EngineError {
    readonly hint?: string | undefined;
    constructor(message: string, code: CliErrorCode, hint?: string | undefined, retryable?: boolean);
}
/** The environment a spec's command runs with: the base set, what the spec lists, and the fixed UTF-8 / `env.set` values. */
export declare function buildCliEnv(spec: Pick<CliAdapterSpec, 'env'>, source?: NodeJS.ProcessEnv): Record<string, string>;
/** Names of the credential variables a spec relies on that are not set. */
export declare function missingEnv(spec: Pick<CliAdapterSpec, 'env'>, source?: NodeJS.ProcessEnv): string[];
/** The home-relative saved-login files of a spec that exist (existence only; the content is never read). */
export declare function savedLoginPresent(spec: Pick<CliAdapterSpec, 'login'>, opts?: {
    home?: string;
    exists?: (file: string) => boolean;
}): boolean | undefined;
/** What the user must do to log in: the tool's own command run by them, or the environment variables they set. Never run by the plugin. */
export declare function loginHint(spec: Pick<CliAdapterSpec, 'bins' | 'login' | 'env'>): string;
export declare function getPath(root: unknown, dotted: string): unknown;
export declare function resolveField(source: FieldSource | undefined, item: unknown, empty?: ReadonlySet<string>): string | undefined;
/**
 * Parse a tool's stdout into the items its output spec describes. A broken payload is CLI_CONTRACT_MISMATCH (the tool is not
 * what the spec says); a payload that says it failed (`expect` not met) is CLI_FAILED with the tool's own message.
 */
export declare function parseCliItems(spec: Pick<CliAdapterSpec, 'bins'>, output: CliOutputSpec, stdout: string): unknown[];
/** The tool's own error text from a parsed json / yaml payload (`errorPaths`), when it carries one. */
export declare function payloadError(output: CliOutputSpec, stdout: string): string | undefined;
/**
 * Strip markup from a field. Highlight tags (`<em>备案</em>`) vanish without leaving a space (Chinese words must not be split),
 * block-level tags become a space, entities are decoded.
 */
export declare function stripMarkup(input: string): string;
/** Map parsed items to sources by the output spec: http(s) URLs only, snippets and titles capped, tags stripped when asked. */
export declare function mapCliItems(output: CliOutputSpec, items: readonly unknown[], count: number): WebSearchSource[];
/** Parse and map in one go (what the fixtures tests call). */
export declare function parseCliOutput(spec: Pick<CliAdapterSpec, 'bins'>, search: CliSearchSpec, stdout: string, count?: number): WebSearchSource[];
/** Fill the placeholders of an argv template. A value that would read as a flag gets a leading space (the tool then takes it as the query). */
export declare function buildArgv(search: Pick<CliSearchSpec, 'argv' | 'maxCount'>, input: {
    query: string;
    count: number;
}): string[];
export interface CliRunInput {
    query: string;
    count: number;
    signal?: AbortSignal | undefined;
}
export interface CliRunOptions {
    /** Platform being searched (selects `spec.searches[platform]`). */
    platform?: string;
    /** `search` (default) or `read`. */
    operation?: 'search' | 'read';
    /** Resolved command (a path or the bin name); default `spec.bins[0]`. */
    bin?: string;
    /** Test seams. */
    run?: typeof runCli;
    env?: NodeJS.ProcessEnv;
    home?: string;
    exists?: (file: string) => boolean;
    /** The caller checks the credentials itself (the legacy twitter engine): skip the pre-run credential gate. */
    skipCredentialGate?: boolean;
}
/**
 * Run one spec command for a query and return its sources. Throws {@link CliAdapterError} (CLI_NOT_FOUND,
 * CLI_CONTRACT_MISMATCH, CLI_NOT_LOGGED_IN, CLI_FAILED), ENGINE_EMPTY for a valid empty answer, ENGINE_TIMEOUT, or the
 * abort reason when the caller's signal fires. Nothing is run when the spec's credentials are missing.
 */
export declare function runCliSearch(spec: CliAdapterSpec, input: CliRunInput, options?: CliRunOptions): Promise<WebSearchSource[]>;
