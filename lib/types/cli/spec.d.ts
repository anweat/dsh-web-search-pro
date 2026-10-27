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
/**
 * The short honest tag shown next to a backend that was not verified with a real search ("detected and configured" is not "works"),
 * or undefined for `live` and for backends that are not CLI specs.
 */
export declare function verificationTag(status: string): string | undefined;
/** The verification word of a user-defined spec: it is unverified by definition and says so in every result it returns. */
export declare const USER_DEFINED = "user-defined";
/** The honest label a custom CLI's results and chain entries carry. */
export declare const USER_DEFINED_TAG = "user-defined, not verified by the plugin (\u7528\u6237\u81EA\u5B9A\u4E49\uFF0C\u672A\u7ECF\u63D2\u4EF6\u9A8C\u8BC1)";
/** Confidence of a custom CLI whose spec gives none: below the built-in sources (1), because nothing here checked its output. */
export declare const DEFAULT_CUSTOM_CONFIDENCE = 0.5;
/** Default and largest size of a whole-output result's text, in characters (`output.lines.maxChars`). */
export declare const WHOLE_OUTPUT_DEFAULT_CHARS = 2000;
export declare const WHOLE_OUTPUT_MAX_CHARS = 8000;
/** Scheme of the stand-in link of a whole-output result (`cli://<id>?q=<query>`): not a web page, so nothing fetches it. */
export declare const WHOLE_OUTPUT_SCHEME = "cli://";
export declare const CLI_ERROR_CODES: readonly ["CLI_NOT_FOUND", "CLI_CONTRACT_MISMATCH", "CLI_NOT_LOGGED_IN", "ENGINE_EMPTY", "CLI_FAILED"];
export type CliErrorCode = typeof CLI_ERROR_CODES[number];
/**
 * One piece of a joined field: a path, optionally with text put before / after the value, a `{ template }` over the item (dropped
 * when a placeholder is empty), or a `{ time }` path whose text is read as a time (see {@link FieldSource}) and dropped when it is not one.
 */
export type JoinPart = string | {
    path: string;
    prefix?: string;
    suffix?: string;
} | {
    template: string;
} | {
    time: string;
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
 *  - `{ epoch }`: a Unix timestamp (seconds) as an ISO date; `{ date }`: the date part (first 10 characters) of an ISO timestamp;
 *  - `{ time }`: a time text the tool prints (ISO, the X API's `created_at`, `2026-10-27`, `08-26`, `3小时前`, `昨天 10:20`, ...) as an
 *    ISO date or timestamp, and nothing when the text is none of the exactly known formats (see cli/time-text.ts).
 * A dotted path may hold a `key=value` segment that picks the first element of an array with that field value
 * (`note_card.corner_tag_info.type=publish_time.text`).
 */
export type FieldSource = string | readonly (string | TemplateSource)[] | TemplateSource | {
    join: readonly JoinPart[];
    sep?: string;
} | {
    epoch: string;
} | {
    date: string;
} | {
    time: string;
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
    /**
     * text: how a line becomes an item (`tsv`: tab separated columns; `url-lines`: lines holding a URL, `url` + `title`; `whole`: the
     * whole stdout is ONE result, for a tool that prints just a block of text: its text capped at `maxChars` (default
     * {@link WHOLE_OUTPUT_DEFAULT_CHARS}) with a note when it was cut, the title "<id>: <query>" and the link `cli://<id>?q=<query>`).
     */
    lines?: {
        mode: 'tsv';
        columns: readonly string[];
    } | {
        mode: 'url-lines';
    } | {
        mode: 'whole';
        maxChars?: number;
    };
    /** Required (with `url`) for every mode except `whole`, which maps nothing. */
    fields?: {
        url?: FieldSource;
        title?: FieldSource;
        snippet?: FieldSource;
        publishedAt?: FieldSource;
    };
    /** Items whose `path` equals the value are not results at all and are not counted as skipped (xhs: `model_type` is `hot_query` for the suggestion cards its result list also carries). */
    skipWhen?: {
        path: string;
        equals: string | number | boolean;
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
/**
 * How a tool reports a failed command in its machine-readable format (a YAML / JSON payload on stderr, else stdout), and what
 * each of its error codes means. A listed code is mapped to a structured plugin error; a code that is not listed keeps the
 * tool's own message (`<tool> search failed: [CODE] message`).
 */
export interface CliErrorCodesSpec {
    /** Dotted path of the tool's error code in the failure payload (`error.code`). */
    codePath: string;
    /** Dotted path of its message (`error.message`). */
    messagePath?: string;
    /** Codes that mean "not logged in" (CLI_NOT_LOGGED_IN). */
    notLoggedIn?: readonly string[];
    /** Exit codes that mean "not logged in" when the output carries no readable code. */
    notLoggedInExit?: readonly number[];
    /** Codes that mean "no results" (ENGINE_EMPTY). */
    empty?: readonly string[];
    /** Codes that mean the site answered with a web page or blocked the request: risk control, IP block, login wall (CLI_FAILED, said so). */
    blocked?: readonly string[];
    /** Case-insensitive fragments of the tool's message that mean the same (a JSON parse error on an HTML page: `Unexpected token '<'`). */
    blockedPatterns?: readonly string[];
    /** Codes that mean the tool cannot reach its browser (CLI_FAILED, not retryable). */
    unavailable?: readonly string[];
    /** Codes that mean a timeout (ENGINE_TIMEOUT). */
    timeout?: readonly string[];
    /** Codes that mean the tool rejected its arguments (CLI_CONTRACT_MISMATCH: the adapter does not match this version). */
    usage?: readonly string[];
}
export interface CliSearchSpec {
    /**
     * Arguments after the binary. `{query}` and `{count}` are the placeholders; a token may embed one (`ytsearch{count}:{query}`).
     * A token that is exactly `{terms}` expands to the query split into one argv token per word (double quotes keep a phrase together):
     * for tools that join their positional arguments themselves and would otherwise quote a one-token query as an exact phrase (`gh search`).
     */
    argv: readonly string[];
    /** Largest `{count}` sent (the search call's count is clamped to 1..maxCount). */
    maxCount?: number;
    /**
     * Extra results asked of the tool beyond the count (`{count}` becomes count + overfetch), for tools whose list can hold entries the
     * mapper must drop (bili: courses and series without a link). The mapper still returns at most `count`.
     */
    overfetch?: number;
    output: CliOutputSpec;
    /** Case-insensitive fragments of the tool's output that mean "no results" rather than a failure. */
    emptyWhen?: readonly string[];
    /** Case-insensitive fragments of the tool's output that mean "not logged in" (maps to CLI_NOT_LOGGED_IN). */
    notLoggedInPatterns?: readonly string[];
    /** The tool's structured error codes (checked before the fragments above). */
    errorCodes?: CliErrorCodesSpec;
}
export interface CliProbeSpec {
    versionArgs: readonly string[];
    /** `X.Y.Z` the detected version must reach. */
    minVersion?: string;
    helpArgs: readonly string[];
    /** Fragments the help output must contain: the subcommands and flags that prove this is the tool the spec describes. */
    mustContain: readonly string[];
    /** Appended to the reason when `mustContain` is not met (which version is known to have the contract, for example). */
    contractHint?: string;
}
export interface CliLoginSpec {
    /** What the user runs themselves (`xhs login`); never run by the plugin. */
    command?: string;
    /** What the user does, in words, when the tool takes its login from somewhere the plugin cannot run (the login of the user's own Chrome): shown instead of a command. One of `command` / `hint` is required. */
    hint?: string;
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
    /**
     * Platform ids the spec serves: the platforms whose backend chain it may sit in (`platformBackends.<platform>`). A user spec is
     * also a platform of its own, `custom-cli:<id>`, and may list none when it is a general `engine`.
     */
    platforms: readonly string[];
    /** User specs only: also a general search engine, listed in `engines` as `custom-cli:<id>` (fused and de-duplicated with the others). */
    engine?: boolean;
    /** User specs only: 0..1, default {@link DEFAULT_CUSTOM_CONFIDENCE}. `sources.confidence.custom-cli:<id>` overrides it. */
    confidence?: number;
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
