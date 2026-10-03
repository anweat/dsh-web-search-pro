/**
 * Error mapping: thrown values to the structured codes of the result
 * envelope. The original message is always preserved; the code and hint only
 * add what the model should do next.
 * @module web-search-pro/actions/errors
 */
import { ActionArgError, ActionNotFoundError } from "./types.js";
import { BrowserUnavailableError } from "../browser-access.js";
import { NoBackendError } from "../backend-registry.js";
export const DEFAULT_ERROR_HINTS = {
    INVALID_ARGS: 'Fix the arguments to match the schema and call again.',
    CAPABILITY_UNAVAILABLE: 'Not available in the current setup. web_index({action:"sources.status"}) explains how; read.snapshot and browser-only platforms need the dsh-browser plugin.',
    NOT_FOUND: 'The referenced item does not exist. history.list shows valid ids.',
    DEADLINE: 'The action ran out of time. Retry with a narrower request, or use fewer engines.',
    CANCELLED: 'The call was cancelled before it finished.',
    POLICY_DENIED: 'Blocked by the approval policy; ask the user instead of retrying.',
};
export function hintFor(code) {
    return DEFAULT_ERROR_HINTS[code];
}
/** The abort reason of an action whose overall deadline expired, so a stop can be told apart from a user cancel. */
export class DeadlineError extends Error {
    constructor(message = 'deadline') {
        super(message);
        this.name = 'DeadlineError';
    }
}
/** True when the signal was aborted because the overall deadline expired. */
export function abortedByDeadline(signal) {
    return signal?.aborted === true && signal.reason?.name === 'DeadlineError';
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
// Messages raised below the action layer (registry, task parsing, store lookups) that are about the call itself.
const INVALID = /(must be|must contain|is required|not valid JSON|unknown engine|unsupported platform|unknown installer|unknown backend|is not a valid)/i;
const NOT_FOUND = /(id not found|not found:|no saved page|no rule found)/i;
/** Map any thrown value to a structured error body. */
export function mapError(error, opts = {}) {
    if (error instanceof ActionArgError)
        return { code: 'INVALID_ARGS', message: error.message, ...error.hint ? { hint: error.hint } : {} };
    if (error instanceof ActionNotFoundError)
        return { code: 'NOT_FOUND', message: error.message, hint: error.hint ?? hintFor('NOT_FOUND') };
    const message = messageOf(error);
    const name = error instanceof Error ? error.name : '';
    const result = (code, hint = hintFor(code)) => ({ code, message, ...hint ? { hint } : {} });
    if (error instanceof BrowserUnavailableError)
        return result('CAPABILITY_UNAVAILABLE');
    if (abortedByDeadline(opts.signal))
        return result('DEADLINE');
    if (opts.signal?.aborted || name === 'AbortError' || /\baborted\b/i.test(message))
        return result('CANCELLED');
    if (NOT_FOUND.test(message))
        return result('NOT_FOUND');
    if (INVALID.test(message))
        return result('INVALID_ARGS');
    if (error instanceof NoBackendError)
        return result('ACTION_FAILED', 'Every engine failed or returned nothing: read the message, change the query or engines, or check sources.status.');
    return result('ACTION_FAILED', 'The action failed; read the message and adjust the arguments or try another source.');
}
//# sourceMappingURL=errors.js.map