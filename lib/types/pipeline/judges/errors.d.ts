/**
 * Errors of the judge layer.
 * @module web-search-pro/pipeline/judges/errors
 */
export declare class JudgeError extends Error {
    readonly status?: number | undefined;
    readonly fatal: boolean;
    constructor(message: string, status?: number | undefined, fatal?: boolean);
}
/** A model call was refused because a usage cap would be exceeded (the stage falls back to the rule scorer). */
export declare class BudgetExceededError extends JudgeError {
    readonly reason: string;
    constructor(reason: string);
}
