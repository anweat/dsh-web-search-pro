/**
 * Versioned judge rubrics (dev-plan §4.4, design §7): the wording, the ordered
 * levels and the length caps of the questions the plugin puts to Jev, as data.
 *
 * Built-in rubrics reproduce the wording the offline evaluation was calibrated
 * with (bench/rubrics/*.v1.json; a bench test pins the two together). A user can
 * override one in `evidence.rubrics` (settings.yaml) without a code change:
 *
 *   evidence:
 *     rubrics:
 *       score.support: { version: v2, instructions: "...{need}...{candidate}" }
 *
 * An override must carry its own `version`; the rubric's id, version and a hash
 * of its full content go into every Jev result record and into the judge cache
 * keys, so a changed prompt never reuses an old answer. An override that fails
 * validation is ignored (the built-in is used) and the reason is reported.
 * Online models never rewrite rubrics: they only change through the settings.
 * @module web-search-pro/pipeline/rubrics
 */
/** Variables a template may use; anything else rejects the rubric. */
export declare const RUBRIC_VARIABLES: readonly ["task", "need", "constraint", "candidate"];
export type RubricVariable = typeof RUBRIC_VARIABLES[number];
export type RubricKind = 'noul' | 'score' | 'choice';
export declare const RUBRIC_LIMITS: {
    readonly versionPattern: RegExp;
    readonly instructionsChars: 2000;
    readonly criteriaMin: 2;
    readonly criteriaMax: 10;
    readonly criterionChars: 200;
    readonly stateChars: readonly [20, 2000];
    readonly candidateChars: readonly [100, 8000];
};
export interface RubricDef {
    /** Stable id without the version, e.g. `score.support`. */
    id: string;
    version: string;
    lang: 'zh';
    kind: RubricKind;
    description: string;
    /** Template; `{candidate}` is bound per item. */
    instructions: string;
    /** score / noul: template of the shared state (billed again inside every question). */
    state?: string;
    /** score: ordered level descriptions, lowest first (index = grade). */
    criteria?: readonly string[];
    /** choice: label -> description. */
    options?: Readonly<Record<string, string>>;
    /** The task description inside the shared state / `{task}` is cut to this many characters. */
    maxStateChars: number;
    /** The candidate (heading + block) is cut to this many characters. */
    maxCandidateChars: number;
    /** Variables this rubric's template may use (a subset of the whitelist). */
    allowed: readonly RubricVariable[];
    /** Variables the template must contain. */
    required: readonly RubricVariable[];
}
/** What a user may set per rubric. */
export interface RubricOverride {
    version: string;
    instructions?: string;
    criteria?: string[];
    maxStateChars?: number;
    maxCandidateChars?: number;
}
export interface ResolvedRubric extends RubricDef {
    /** The content differs from the built-in (new version or changed text). */
    overridden: boolean;
    /** First 12 hex of a SHA-256 over everything that shapes the question. */
    hash: string;
    /** `id@version#hash`: the key recorded with results and mixed into cache keys. */
    key: string;
}
/** Compact reference stored with scorer output. */
export interface RubricRef {
    id: string;
    version: string;
    overridden: boolean;
    hash: string;
    key: string;
}
export declare const refOf: (r: ResolvedRubric) => RubricRef;
export declare const BUILTIN_RUBRIC_IDS: readonly string[];
export declare const variablesOf: (template: string) => string[];
/** Fill the variables in ONE pass (inserted text is never rescanned); variables not in `vars` stay open. */
export declare function renderTemplate(template: string, vars: Partial<Record<RubricVariable, string>>): string;
/** The built-in rubric as shipped. */
export declare function builtinRubric(id: string): ResolvedRubric;
/** Problems of a candidate rubric content; empty = valid. `base` supplies the kind and the allowed variables. */
export declare function rubricProblems(base: RubricDef, fields: {
    version?: unknown;
    instructions?: unknown;
    criteria?: unknown;
    maxStateChars?: unknown;
    maxCandidateChars?: unknown;
}): string[];
/** Build a rubric from a built-in plus new content; throws nothing, returns the problems instead. */
export declare function buildRubric(id: string, fields: {
    version: string;
    instructions?: string;
    criteria?: readonly string[];
    maxStateChars?: number;
    maxCandidateChars?: number;
}): {
    rubric: ResolvedRubric;
    problems?: undefined;
} | {
    rubric?: undefined;
    problems: string[];
};
export interface RubricResolution {
    rubric: ResolvedRubric;
    /** Why an override was ignored (empty when none was given or it is valid). */
    diagnostics: string[];
}
/** The active rubric for `id`: the valid override from `overrides`, else the built-in. */
export declare function resolveRubric(id: string, overrides?: Readonly<Record<string, unknown>> | undefined): RubricResolution;
/** Every built-in rubric resolved against the overrides, plus override ids that name no rubric. */
export declare function resolveAllRubrics(overrides?: Readonly<Record<string, unknown>> | undefined): {
    rubrics: ResolvedRubric[];
    diagnostics: string[];
};
