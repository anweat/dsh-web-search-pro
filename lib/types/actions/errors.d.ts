/**
 * Error mapping: thrown values to the structured codes of the result
 * envelope. The original message is always preserved; the code and hint only
 * add what the model should do next.
 * @module web-search-pro/actions/errors
 */
import { type ActionErrorBody, type ErrorCode } from './types.ts';
export declare const DEFAULT_ERROR_HINTS: Readonly<Partial<Record<ErrorCode, string>>>;
export declare function hintFor(code: ErrorCode): string | undefined;
/** The abort reason of an action whose overall deadline expired, so a stop can be told apart from a user cancel. */
export declare class DeadlineError extends Error {
    constructor(message?: string);
}
/** True when the signal was aborted because the overall deadline expired. */
export declare function abortedByDeadline(signal: AbortSignal | undefined): boolean;
/** Map any thrown value to a structured error body. */
export declare function mapError(error: unknown, opts?: {
    signal?: AbortSignal;
}): ActionErrorBody;
