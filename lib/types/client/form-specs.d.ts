/**
 * Field specs of the settings card: how each control converts between the stored value and the draft text, and where
 * the value lives in the plugin config.
 *
 * The Host writes TOP-LEVEL config fields, so a nested option (`evidence.maxRounds`, `keyedSources.tavily.baseUrl`) is
 * a "path field": a view of one entry inside the staged object of its root (`evidence`, `provider`, `keyedSources`).
 * The controller applies the path ops of every staged field of a root to the raw user layer of that root and writes the
 * root once, so siblings the card knows nothing about (a literal `apiKey`, an unknown key) are carried through.
 *
 * Pure: no Host, no DOM, no Node, and only shared pure modules, so the client bundle stays free of server code.
 * @module web-search-pro/client/form-specs
 */
export type Json = Record<string, unknown>;
/** Top-level config fields (one Host write each). */
export type TopField = 'engines' | 'parallelEngines' | 'searchMaxResults' | 'timeoutMs' | 'fetchDefaultChars' | 'exaContentsPerUrlChars' | 'exaContentsTotalChars' | 'exaApiKeyEnv' | 'jinaApiKeyEnv' | 'githubTokenEnv' | 'bochaApiKeyEnv' | 'bochaBaseUrl' | 'bochaSummary' | 'searxngUrl' | 'openalexMailto' | 'enableCliBackends' | 'opencliEnabled' | 'agentReachEnabled' | 'providerId' | 'registerProvider' | 'toolSurface' | 'playwright' | 'ttlSeconds' | 'memoryCacheEntries' | 'rrfConstant' | 'freshnessBoost' | 'freshnessDays' | 'authorityBoost' | 'authorityDomains' | 'dbPath' | 'allowProxyFakeIp' | 'platformRules' | 'customPlatforms' | 'browserBindings' | 'verbose';
/** Options inside `evidence` / `provider`, addressed by their dotted config path. */
export type PathField = 'evidence.autoProviders' | 'evidence.maxRounds' | 'evidence.maxQueries' | 'evidence.judge.mode' | 'evidence.hybridBorderline' | 'evidence.judge.provider' | 'evidence.maxJevQuestions' | 'evidence.judge.allowLlm' | 'evidence.judge.providers' | 'evidence.coverage.mode' | 'evidence.coverage.provider' | 'evidence.coverage.thresholds.weak' | 'evidence.coverage.thresholds.covered' | 'evidence.budget.perSearchInputTokens' | 'evidence.budget.dailyInputTokens' | 'evidence.budget.timezone' | 'evidence.budget.providers' | 'provider.evidence' | 'provider.deadlineMs';
/** One rubric override entry (`evidence.rubrics.<id>`) and one keyed-source field. */
export type RubricField = `evidence.rubrics.${string}`;
export type KeyedField = `keyedSources.${string}.apiKeyEnv` | `keyedSources.${string}.baseUrl`;
export type SettingField = TopField | PathField | RubricField | KeyedField;
export type RootKey = 'evidence' | 'provider' | 'keyedSources';
export type FieldWrite = {
    kind: 'set';
    value: unknown;
} | {
    kind: 'clear';
};
export type PathOp = {
    op: 'set';
    path: string[];
    value: unknown;
} | {
    op: 'unset';
    path: string[];
};
export interface FieldSpec {
    field: SettingField;
    format(value: unknown): string;
    parse(text: string): FieldWrite | undefined;
}
/** A field that lives inside a root object of the config. */
export interface PathSpec extends FieldSpec {
    root: RootKey;
    path: readonly string[];
    /** What to show when nothing is stored: read from the resolved root (default: the value at `path`). */
    read?: (resolved: Json) => unknown;
    /** The ops a write applies to the user layer of the root (default: set / unset at `path`). */
    ops?: (write: FieldWrite, ctx: {
        resolved: Json;
    }) => PathOp[];
    /** Whether anything of this field is in the user layer of the root (default: `path` is present). */
    stored?: (user: Json) => boolean;
}
export declare const isPathSpec: (spec: FieldSpec) => spec is PathSpec;
export declare const isRecord: (value: unknown) => value is Json;
export declare function getAt(root: unknown, path: readonly string[]): unknown;
export declare function hasAt(root: unknown, path: readonly string[]): boolean;
/** Apply ops to `root` in place; an `unset` also removes the parents it leaves empty. */
export declare function applyOps(root: Json, ops: readonly PathOp[]): void;
/** Recursive merge, `over` winning; arrays and scalars are replaced (how a user layer sits on its base). */
export declare function deepMerge(base: unknown, over: unknown): unknown;
export declare const DEFAULTS: {
    readonly evidence: {
        readonly autoProviders: true;
        readonly maxRounds: 2;
        readonly maxQueries: 4;
        readonly hybridBorderline: false;
        readonly maxJevQuestions: 64;
        readonly scorer: "rule";
        readonly jevMode: "off";
    };
    readonly judge: {
        readonly allowLlm: false;
    };
    readonly coverage: {
        readonly mode: "off";
    };
    readonly provider: {
        readonly evidence: "auto";
        readonly deadlineMs: 25000;
    };
    readonly budget: {
        readonly perSearchInputTokens: 60000;
        readonly dailyInputTokens: 1000000;
    };
    readonly toolSurface: "indexed";
    readonly bochaApiKeyEnv: "BOCHA_SEARCH_API_KEY";
    readonly bochaBaseUrl: "https://api.bochaai.com";
    readonly bochaSummary: true;
};
/** Top-level fields, in display order. */
export declare const FIELD_SPECS: readonly FieldSpec[];
/** Fields inside `evidence` and `provider`, in display order. */
export declare const PATH_SPECS: readonly PathSpec[];
/** The keyed sources the card has controls for: route id and the environment variable its key is read from by default. */
export declare const KEYED_SOURCES: readonly {
    id: string;
    defaultEnv: string;
}[];
export declare const KEYED_SPECS: readonly PathSpec[];
/** The spec of a rubric override entry: the whole object as one JSON draft, which the rubric editor builds field by field. */
export declare const rubricSpec: (id: string) => PathSpec;
export declare const rubricField: (id: string) => RubricField;
/** Fields that a Host write can never take as text (credentials go through the credentials remote). */
export declare const CREDENTIAL_IDS: readonly ["exa", "jina", "github", "bocha", ...`keyed:${string}`[]];
export type CredentialId = typeof CREDENTIAL_IDS[number];
/** The settings field holding the credentials ref / environment variable name of each credential, and its default name. */
export declare function credentialRef(id: CredentialId): {
    field: SettingField;
    default: string;
};
