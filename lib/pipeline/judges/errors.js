/**
 * Errors of the judge layer.
 * @module web-search-pro/pipeline/judges/errors
 */
export class JudgeError extends Error {
    status;
    fatal;
    constructor(message, status, fatal = false) {
        super(message);
        this.status = status;
        this.fatal = fatal;
        this.name = 'JevError';
    }
}
/** A model call was refused because a usage cap would be exceeded (the stage falls back to the rule scorer). */
export class BudgetExceededError extends JudgeError {
    reason;
    constructor(reason) {
        super('model budget exceeded: ' + reason);
        this.reason = reason;
        this.name = 'BudgetExceededError';
    }
}
//# sourceMappingURL=errors.js.map