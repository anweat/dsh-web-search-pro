/**
 * Approval, per action.
 *
 * The old tools were gated by name from inside dsh-browser's `tools/pre-execute` hook (`web_deps install`,
 * `web_cache_clear`, `web_rule` writes), under dsh-browser's `automationMode`. With one dispatcher tool that
 * hook can no longer tell the operations apart, so this plugin resolves `web_call` (or a flat tool) to its
 * action itself and applies the same rules, reading `automationMode` from the browser service when it is
 * present. Without it the mode is unknown and the strictest ordinary rule (`standard`: ask) applies.
 * @module web-search-pro/actions/approval
 */
export declare const AUTOMATION_MODES: readonly ["read-only", "standard", "autonomous", "unrestricted"];
export type AutomationMode = typeof AUTOMATION_MODES[number];
export type PolicyDecision = {
    kind: 'allow';
} | {
    kind: 'deny';
    reason: string;
} | {
    kind: 'ask';
    reason: string;
};
export type ResolvedWebCall = 
/** `web_index`: read-only catalog, no side effects. */
{
    kind: 'index';
}
/** A call that names a known action; `args` are the action's own arguments. */
 | {
    kind: 'action';
    action: string;
    args: unknown;
}
/** `web_call` with a missing or unknown action; execution returns a structured error. */
 | {
    kind: 'unresolved';
};
/** Maps a model-visible tool call to the action it will run; undefined for tools that are not ours. */
export declare function resolveWebCall(toolName: string, rawArgs: unknown): ResolvedWebCall | undefined;
export declare function webPolicyDecision(actionName: string, args: unknown, mode: AutomationMode | undefined): PolicyDecision;
/** The dsh-browser automationMode, when the optional service is present and reports one. */
export declare function automationModeOf(browser: unknown): Promise<AutomationMode | undefined>;
