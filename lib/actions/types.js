/**
 * Action registry types.
 *
 * Every model-visible capability is one {@link ActionDef}: a name of the form
 * `group.action`, a one-line summary, a parameter schema, an output schema, an
 * approval class, concurrency safety, the function that runs it and the
 * function that renders its result as text. The `indexed` and `flat` tool
 * surfaces are both projections of this one registry, so a capability is
 * defined, validated, approved and executed in exactly one place.
 * @module web-search-pro/actions/types
 */
export const ACTION_GROUPS = ['search', 'read', 'history', 'sources', 'rules', 'cache'];
/** Raised by an executor for a malformed call that schema validation cannot express. */
export class ActionArgError extends Error {
    hint;
    constructor(message, hint) {
        super(message);
        this.hint = hint;
        this.name = 'ActionArgError';
    }
}
/** Raised when a referenced stored item does not exist. */
export class ActionNotFoundError extends Error {
    hint;
    constructor(message, hint) {
        super(message);
        this.hint = hint;
        this.name = 'ActionNotFoundError';
    }
}
export const ERROR_CODES = [
    'INVALID_ARGS', 'UNKNOWN_ACTION', 'CAPABILITY_UNAVAILABLE', 'POLICY_DENIED',
    'DEADLINE', 'CANCELLED', 'NOT_FOUND', 'ACTION_FAILED',
];
//# sourceMappingURL=types.js.map