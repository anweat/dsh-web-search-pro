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
import { BUILTIN_RUBRIC_IDS, RUBRIC_LIMITS, RUBRIC_VARIABLES, overrideProblems, rubricProblems, variablesOf, type RubricDef, type RubricKind, type RubricOverride, type RubricVariable } from './rubrics-spec.ts';
export { BUILTIN_RUBRIC_IDS, RUBRIC_LIMITS, RUBRIC_VARIABLES, overrideProblems, rubricProblems, variablesOf };
export type { RubricDef, RubricKind, RubricOverride, RubricVariable };
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
/** Fill the variables in ONE pass (inserted text is never rescanned); variables not in `vars` stay open. */
export declare function renderTemplate(template: string, vars: Partial<Record<RubricVariable, string>>): string;
/** The built-in rubric as shipped. */
export declare function builtinRubric(id: string): ResolvedRubric;
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
