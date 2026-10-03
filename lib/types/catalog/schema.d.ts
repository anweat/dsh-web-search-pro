/**
 * Source catalog schema (design §4.1 CatalogEntry, dev-plan M7): pure, versioned data about KNOWN search
 * sources. A catalog entry is not a provider: it never executes anything, and only an adapter registered
 * in the provider registry can run. `provider` / `platform` link an entry to the engine id / platform id
 * this plugin already implements; every other entry is "catalog only" and explains what to set up.
 * @module web-search-pro/catalog/schema
 */
export declare const CATALOG_VERSION = 1;
export declare const SOURCE_KINDS: readonly ["api", "cli", "mcp", "browser"];
export declare const SOURCE_AUTH: readonly ["anonymous", "key", "login"];
export declare const SOURCE_OPERATIONS: readonly ["search", "read", "fetch", "transcript", "comments", "extract", "answer", "trending"];
export declare const VERIFICATION_STATUSES: readonly ["verified", "unverified"];
export type SourceKind = typeof SOURCE_KINDS[number];
export type SourceAuth = typeof SOURCE_AUTH[number];
export type SourceOperation = typeof SOURCE_OPERATIONS[number];
export interface CatalogRequires {
    /** A command that must be on PATH (matches a `sources.deps` id where this plugin probes it). */
    cli?: string;
    /** The optional dsh-browser plugin (OpenCLI bridge, Playwright, saved logins). */
    browser?: boolean;
    /** A host service (`ctx.web`). */
    service?: string;
    /** A plugin setting that must be set (`searxngUrl`). */
    config?: string;
}
export interface CatalogVerification {
    status: typeof VERIFICATION_STATUSES[number];
    /** `YYYY-MM-DD` of the check that earned `verified`. */
    date?: string;
    /** Version of the service or tool that was checked. */
    version?: string;
    note?: string;
}
export interface CatalogEntry {
    /** Stable lowercase id (`wikipedia`, `opencli-zhihu`). */
    id: string;
    label: string;
    kind: SourceKind;
    operations: SourceOperation[];
    /** `zh`, `en` or `*` (language-agnostic). */
    languages: string[];
    /** `cn`, `global`. */
    regions: string[];
    /** Task profiles the source suits (docs_code, news_fact, academic, experience, compare, general); empty = none. */
    profiles: string[];
    /** What it returns: web, code, paper, video, forum, qa, reference, social, listing, audio, files. */
    resultKinds?: string[];
    auth: SourceAuth;
    /** Environment variables / credentials refs of the key (or login session). Names this plugin reads, or plans to read once an adapter exists. */
    keyEnv?: string[];
    requires?: CatalogRequires;
    /** Route id of the registry provider (`search.run engines=<id>`) when this plugin implements the source. */
    provider?: string;
    /** Platform id of `search.run platform=` when it implements the source. */
    platform?: string;
    /** How to call it when neither `provider` nor `platform` applies (e.g. through the dsh-browser OpenCLI tools). */
    invoke?: string;
    /** Curation order among equals (lower first, default 50). */
    rank?: number;
    /** Short install or configuration text. */
    install: string;
    license: string;
    /** Short cost note. */
    cost: string;
    /** Shared upstream index; entries with the same family are not independent evidence. */
    sourceFamily?: string;
    url?: string;
    verification: CatalogVerification;
    recommendedFor: string[];
    /** Counter-examples: what the source must NOT be used for. */
    notFor: string[];
}
export interface SourceCatalog {
    $schema?: string;
    version: number;
    updated: string;
    description?: string;
    entries: CatalogEntry[];
}
export interface CatalogValidation {
    ok: boolean;
    errors: string[];
    catalog?: SourceCatalog;
}
/** Validate parsed catalog JSON. Closed schema: unknown fields are errors; ids are unique. Never throws. */
export declare function validateCatalog(data: unknown): CatalogValidation;
