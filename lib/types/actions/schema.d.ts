/**
 * Validator and renderers for action parameters, plus a checker for closed
 * output schemas (used by tests to hold results to their declared shape).
 * @module web-search-pro/actions/schema
 */
import type { OutputSchema, ParamSchema } from './types.ts';
export interface ValidationResult {
    ok: boolean;
    value: Record<string, unknown>;
    errors: string[];
}
/** Validate call arguments against an action's parameter schema. */
export declare function validateArgs(params: ParamSchema, args: unknown): ValidationResult;
/** One-line parameter summary: `query: string, count?: number`. */
export declare function compactParams(params: ParamSchema): string;
/** Compact schema block attached to INVALID_ARGS replies. */
export declare function compactSchema(action: string, params: ParamSchema): string;
/** Full parameter listing with descriptions. */
export declare function describeParams(params: ParamSchema): string[];
/** Violations of `value` against a closed output schema ([] when it conforms). Unknown fields are violations. */
export declare function checkOutput(schema: OutputSchema, value: unknown): string[];
