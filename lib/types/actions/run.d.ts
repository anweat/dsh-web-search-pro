/**
 * Action dispatch: validate arguments, run the executor under a deadline, and
 * wrap everything in the result envelope.
 *
 * Both tool surfaces call {@link runAction}, so the envelope and the error
 * codes are identical whether the model reaches an action through `web_call`
 * or through a flat per-action tool.
 * @module web-search-pro/actions/run
 */
import type { ActionEnvelope, ActionServices } from './types.ts';
/** Serialized-result cap; larger results get their longest strings shortened. */
export declare const RESULT_CHAR_LIMIT = 100000;
/**
 * Shorten the longest string fields until the serialized result fits. The
 * result stays valid JSON; the envelope reports how much text was dropped.
 */
export declare function truncateResult(result: Record<string, unknown>, limit?: number): {
    result: Record<string, unknown>;
    truncation?: {
        omitted: number;
        reason: string;
    };
};
/** The reply to a `web_call` whose action is not in the registry. */
export declare function unknownActionFailure(name: unknown, args?: unknown): ActionEnvelope;
/**
 * Run one action and return the envelope. Never throws: every failure is a
 * structured error the model can act on.
 */
export declare function runAction(name: unknown, rawArgs: unknown, services: ActionServices & {
    signal: AbortSignal;
}): Promise<ActionEnvelope>;
/** Text of an envelope for the model: the action's own rendering of a result, or the error as compact JSON. */
export declare function renderEnvelope(envelope: ActionEnvelope, args?: Record<string, unknown>): string;
