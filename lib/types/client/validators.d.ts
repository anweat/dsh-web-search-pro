/**
 * Validation behind the settings card. Every rule that has a server counterpart is the server's own function
 * (providers-spec, rubrics-spec, coverage, budget-spec): the card calls it, it does not restate it. Pure and free of
 * Node imports, so it ships in the client bundle.
 * @module web-search-pro/client/validators
 */
import { type Json, type SettingField } from './form-specs.ts';
/** A problem found in the (draft) evidence settings, attached to the control it concerns. */
export interface Issue {
    field: SettingField;
    message: string;
    /** `error`: the server would ignore the value. `warning`: accepted, but probably not what was meant. */
    level: 'error' | 'warning';
    /** Other controls whose editing can cause this (an error blocks the save while any of them has a pending change). */
    related?: SettingField[];
}
export interface CustomProviders {
    /** Why entries are ignored by the server (it keeps going with the others). */
    problems: string[];
    /** Ids of the custom entries that are usable (presets that were overridden validly are included). */
    ids: string[];
}
/**
 * `evidence.judge.providers`: the server's own `resolveProviders` over the draft, plus a refusal to carry secrets in a
 * definition (the card never shows or stores a key value: `keyRef` names the environment variable / credentials entry).
 */
export declare function customProviders(providers: unknown): CustomProviders;
/** Ids the judge provider selects can name: the presets and the valid custom entries. */
export declare function providerChoices(providers: unknown): string[];
/** The version a new override of a rubric starts with: the built-in label counted up (`v1` -> `v2`). */
export declare function nextVersion(version: string): string;
/**
 * Problems of one rubric override entry: the server's `overrideProblems`, plus the card's stricter rule that the version
 * label must differ from the built-in one (an override on the shipped label is indistinguishable from the default in logs).
 */
export declare function rubricEntryProblems(id: string, entry: unknown): string[];
/** The rubric entries of an evidence object that carry any problem, by rubric id. */
export declare function rubricIssues(rubrics: unknown): Record<string, string[]>;
/**
 * Everything wrong or doubtful in an effective `evidence` object, per control. Errors are values the server would
 * ignore; warnings are accepted values that cannot do what the mode asks (a placeholder provider, no thresholds).
 */
export declare function evidenceIssues(ev: Json): Issue[];
/**
 * Problems of the effective `sources` object (priority / disabled / budget), from the server's own `resolveSources`. A source that is
 * both prioritised and disabled is accepted (disabled wins) but is probably not what was meant.
 */
export declare function sourcesIssues(sources: Json): Issue[];
/** Rubric override ids in a settings object that name no built-in rubric (the server ignores them). */
export declare function unknownRubricIds(rubrics: unknown): string[];
