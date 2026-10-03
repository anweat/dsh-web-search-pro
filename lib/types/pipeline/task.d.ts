/**
 * TaskSpec assembly from `search.run` parameters (dev-plan §4.2).
 * Needs come as `;`-separated text or a JSON array, constraints as a JSON
 * array; everything is validated here so the pipeline only sees a clean spec.
 * @module web-search-pro/pipeline/task
 */
import { type Constraint, type Need, type Profile, type TaskSpec } from './types.ts';
/** More needs than this are cut (each need costs S6 scoring calls). */
export declare const MAX_NEEDS = 6;
export declare const MAX_CONSTRAINTS = 12;
export interface TaskInput {
    query: string;
    /** Short goal; defaults to the query. */
    task?: string | undefined;
    profile?: string | undefined;
    needs?: unknown;
    constraints?: unknown;
    /** Evidence excerpt budget in characters. */
    budget?: number | undefined;
}
export interface BuiltTask {
    spec: TaskSpec;
    notes: string[];
}
export declare function parseProfile(value: string | undefined): Profile | undefined;
/** `a;b;c`, a JSON array of strings, or a JSON array of `{text, critical?}`. Needs are critical unless stated otherwise. */
export declare function parseNeeds(raw: unknown, fallbackGoal: string): {
    needs: Need[];
    truncated: boolean;
};
/** JSON array of `{kind, value, strength?}`; strength defaults to soft (a preference never shrinks recall). */
export declare function parseConstraints(raw: unknown): Constraint[];
export declare function buildTaskSpec(input: TaskInput): BuiltTask;
