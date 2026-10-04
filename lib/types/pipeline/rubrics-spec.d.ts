/**
 * The pure part of the judge rubrics (dev-plan M10): the variable whitelist, limits, the built-in definitions and the
 * validation rules of an override. No Node imports, so the settings panel (client bundle) and the server validate a
 * rubric override with the very same code; hashing and resolution live in ./rubrics.ts.
 * @module web-search-pro/pipeline/rubrics-spec
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
export declare const BUILTIN_RUBRIC_IDS: readonly string[];
export declare const variablesOf: (template: string) => string[];
/** Problems of a candidate rubric content; empty = valid. `base` supplies the kind and the allowed variables. */
export declare function rubricProblems(base: RubricDef, fields: {
    version?: unknown;
    instructions?: unknown;
    criteria?: unknown;
    maxStateChars?: unknown;
    maxCandidateChars?: unknown;
}): string[];
/** The built-in definition of a rubric id, if it is one. */
export declare const builtinDef: (id: string) => RubricDef | undefined;
/** Keys an override may carry. */
export declare const RUBRIC_OVERRIDE_KEYS: readonly ["version", "instructions", "criteria", "maxStateChars", "maxCandidateChars"];
/**
 * Every reason an override entry of rubric `id` would be ignored; empty = it takes effect. The one rule set behind
 * `resolveRubric` (server) and the settings panel's rubric editor.
 */
export declare function overrideProblems(id: string, raw: unknown): string[];
