/**
 * Declarative CLI adapter spec (dev-plan M12): what a standalone command-line tool is, which of its commands the plugin
 * may run, and how its output maps to search sources. Pure data plus validation, no Node imports, so the settings card
 * (client bundle) validates `cliAdapters` with the very function the server uses.
 *
 * The read-only guarantee lives here and applies to built-in and user-defined specs alike:
 *  - argv is an array of tokens, never a shell string (the runner spawns without a shell);
 *  - a spec declares `allowedSubcommands`, and every command word its argv uses (the leading literal tokens before the
 *    first flag or placeholder) must be in that list;
 *  - no command word, declared subcommand or flag may match the global deny-list (login, post, delete*, like, ...,
 *    and the flags that make a CLI read browser cookies or carry secrets in argv).
 * @module web-search-pro/cli/spec
 */
export declare const OUTPUT_FORMATS: readonly ["json", "ndjson", "yaml", "text"];
export type OutputFormat = typeof OUTPUT_FORMATS[number];
/** How far a spec has been checked against the real tool (recorded in the spec and shown in `sources.status`). */
export declare const CLI_VERIFICATIONS: readonly ["live", "contract-only", "docs-only"];
export type CliVerification = typeof CLI_VERIFICATIONS[number];
export declare const CLI_ERROR_CODES: readonly ["CLI_NOT_FOUND", "CLI_CONTRACT_MISMATCH", "CLI_NOT_LOGGED_IN", "ENGINE_EMPTY", "CLI_FAILED"];
export type CliErrorCode = typeof CLI_ERROR_CODES[number];
/** One piece of a joined field: a path, optionally with text put before / after the value. */
export type JoinPart = string | {
    path: string;
    prefix?: string;
    suffix?: string;
};
/** `{ template }` fills `{path}` placeholders from the item and yields nothing when one is empty; `when` makes it apply to one kind of item. */
export interface TemplateSource {
    template: string;
    when?: {
        path: string;
        equals: string | number | boolean;
    };
}
/**
 * Where a field of a source comes from, for one parsed item:
 *  - a dotted path (`data.title`, `items.0.url`);
 *  - a list of paths and templates: the first non-empty one wins;
 *  - `{ template }`: `{path}` placeholders over the item, dropped when any of them is empty;
 *  - `{ join }`: the non-empty parts joined with `sep` (default ` | `);
 *  - `{ epoch }`: a Unix timestamp (seconds) as an ISO date; `{ date }`: the date part (first 10 characters) of an ISO timestamp.
 */
export type FieldSource = string | readonly (string | TemplateSource)[] | TemplateSource | {
    join: readonly JoinPart[];
    sep?: string;
} | {
    epoch: string;
} | {
    date: string;
};
export interface CliOutputSpec {
    format: OutputFormat;
    /** json / yaml: dotted path of the item array; absent = the root array, else the first array-valued property. */
    itemsPath?: string;
    /** json / yaml: every entry must hold, else the output is a failure (a versioned envelope's `ok` and `schema_version`). */
    expect?: readonly {
        path: string;
        equals: string | number | boolean;
    }[];
    /** Paths of the tool's own error text, read when `expect` fails (first non-empty one). */
    errorPaths?: readonly string[];
    /** text: how a line becomes an item (`tsv`: tab separated columns; `url-lines`: lines holding a URL, `url` + `title`). */
    lines?: {
        mode: 'tsv';
        columns: readonly string[];
    } | {
        mode: 'url-lines';
    };
    fields: {
        url: FieldSource;
        title?: FieldSource;
        snippet?: FieldSource;
        publishedAt?: FieldSource;
    };
    /** Strip HTML tags from title and snippet. */
    stripTags?: boolean;
    /** Values read as "empty" (`None`). */
    emptyValues?: readonly string[];
    /** Longest snippet kept (default 400). */
    snippetMax?: number;
    /** Longest title kept (default 300). */
    titleMax?: number;
    /** Drop items without a title (a line that is not a result). */
    requireTitle?: boolean;
}
export interface CliSearchSpec {
    /** Arguments after the binary. `{query}` and `{count}` are the placeholders; a token may embed one (`ytsearch{count}:{query}`). */
    argv: readonly string[];
    /** Largest `{count}` sent (the search call's count is clamped to 1..maxCount). */
    maxCount?: number;
    output: CliOutputSpec;
    /** Case-insensitive fragments of the tool's output that mean "no results" rather than a failure. */
    emptyWhen?: readonly string[];
    /** Case-insensitive fragments of the tool's output that mean "not logged in" (maps to CLI_NOT_LOGGED_IN). */
    notLoggedInPatterns?: readonly string[];
}
export interface CliProbeSpec {
    versionArgs: readonly string[];
    /** `X.Y.Z` the detected version must reach. */
    minVersion?: string;
    helpArgs: readonly string[];
    /** Fragments the help output must contain: the subcommands and flags that prove this is the tool the spec describes. */
    mustContain: readonly string[];
}
export interface CliLoginSpec {
    /** What the user runs themselves (`xhs login`); never run by the plugin. */
    command: string;
    /** Home-relative files that exist once the user has logged in. Only their existence is checked, never their content. */
    savedCredentialPaths?: readonly string[];
    /** The tool reads the browser's cookies by itself when it has no saved login: then it is never run without one. */
    readsBrowserCookiesWithoutLogin?: boolean;
}
export interface CliAdapterSpec {
    id: string;
    /** Command names tried in order on PATH. */
    bins: readonly string[];
    /** What the package is called, which can differ from the command (`pip install pyzhihu-cli` runs `zhihu`). */
    packageNote: string;
    /** Platform ids the spec can serve (`search.run platform=`); a user spec's platform is `custom-cli:<id>`. */
    platforms: readonly string[];
    probe: CliProbeSpec;
    /** Every command word the argv templates use. */
    allowedSubcommands: readonly string[];
    search: CliSearchSpec;
    /** Per-platform overrides of `search` (gh serves github, github-issues and github-code with different commands). */
    searches?: Readonly<Record<string, CliSearchSpec>>;
    read?: CliSearchSpec;
    env: {
        required?: readonly string[];
        passthrough?: readonly string[];
        set?: Readonly<Record<string, string>>;
    };
    needsLogin: boolean;
    login?: CliLoginSpec;
    timeoutMs: number;
    maxOutputBytes: number;
    /** Built-ins only: how far the spec was checked. User-defined specs carry none (they are unverified by definition). */
    verification?: {
        status: CliVerification;
        version?: string;
        date?: string;
        note?: string;
    };
}
/** Command words that write, log in, or change local or remote state. Matched exactly, or as `<word>-...` / `<word>_...`. */
export declare const DENIED_SUBCOMMANDS: readonly string[];
/** Command words denied by prefix alone (`delete`, `delete-note`, `deleteNote`, `remove...`). */
export declare const DENIED_PREFIXES: readonly string[];
/** Flags (without leading dashes) that read browser cookies or carry credentials in argv. */
export declare const DENIED_FLAGS: readonly string[];
/** The command words of an argv: leading literal tokens before the first flag or placeholder token. */
export declare function commandWords(argv: readonly string[]): string[];
/** Problems of one argv template with respect to the read-only guard (empty = fine). */
export declare function argvProblems(argv: readonly string[], allowed: readonly string[], where: string): string[];
export interface CliSpecValidation {
    ok: boolean;
    errors: string[];
    spec?: CliAdapterSpec;
}
/**
 * Validate one adapter spec (built-in or user-defined). Never throws. A user-defined spec (`origin: 'user'`) may not carry a
 * `verification` (it is unverified by definition) and its `platforms` are ignored: it is registered as `custom-cli:<id>`.
 */
export declare function validateCliAdapterSpec(raw: unknown, origin?: 'builtin' | 'user'): CliSpecValidation;
/** Validate the `cliAdapters` setting: the valid specs by id and the problems of the rest (an invalid entry is ignored, never fatal). */
export declare function resolveCliAdapters(input: unknown): {
    specs: Map<string, CliAdapterSpec>;
    diagnostics: string[];
};
/** Search spec of one platform: the platform's override, else the default. */
export declare function searchSpecFor(spec: CliAdapterSpec, platform: string): CliSearchSpec;
export declare function compareVersions(left: string, right: string): number;
/** The first `X.Y.Z` (or `X.Y`) in a tool's version output. */
export declare function parseVersion(output: string): string | undefined;
/** `platformBackends`: ordered backend ids per platform. Pure shape check; ids are checked against the known backends by the caller. */
export declare function platformBackendProblems(input: unknown): string[];
