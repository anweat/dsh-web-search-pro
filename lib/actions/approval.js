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
import { CALL_TOOL, INDEX_TOOL, findAction, findActionByFlatTool } from "./registry.js";
export const AUTOMATION_MODES = ['read-only', 'standard', 'autonomous', 'unrestricted'];
/** Maps a model-visible tool call to the action it will run; undefined for tools that are not ours. */
export function resolveWebCall(toolName, rawArgs) {
    if (toolName === INDEX_TOOL)
        return { kind: 'index' };
    if (toolName === CALL_TOOL) {
        const input = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {});
        return findAction(input.action) ? { kind: 'action', action: input.action, args: input.args ?? {} } : { kind: 'unresolved' };
    }
    const flat = findActionByFlatTool(toolName);
    return flat ? { kind: 'action', action: flat.name, args: rawArgs ?? {} } : undefined;
}
const clip = (text, max = 80) => text.length > max ? text.slice(0, max) + '…' : text;
/** Short, human-readable description of the key arguments for the approval prompt. */
function describe(action, args) {
    const input = (args && typeof args === 'object' ? args : {});
    const parts = [];
    for (const key of ['backend', 'installer', 'hostname', 'id', 'engine', 'olderThanDays', 'platform', 'scope']) {
        if (input[key] !== undefined)
            parts.push(`${key}=${clip(String(input[key]))}`);
    }
    if (typeof input.rulesJson === 'string')
        parts.push(`rulesJson (${input.rulesJson.length} chars)`);
    return parts.length ? `${action} ${parts.join(' ')}` : action;
}
/** The command and argument templates of a custom CLI spec, for the prompt the user answers: what the plugin would be allowed to run. */
export function describeCliSpec(spec) {
    const input = (spec && typeof spec === 'object' ? spec : {});
    const tokens = (value) => (Array.isArray(value) ? value.filter((token) => typeof token === 'string') : []).join(' ');
    const search = input.search && typeof input.search === 'object' ? input.search : {};
    const bins = Array.isArray(input.bins) ? input.bins.filter((bin) => typeof bin === 'string') : [];
    const probe = input.probe && typeof input.probe === 'object' ? input.probe : {};
    const env = input.env && typeof input.env === 'object' ? input.env : {};
    const names = [...Array.isArray(env.required) ? env.required : [], ...Array.isArray(env.passthrough) ? env.passthrough : []].filter((name) => typeof name === 'string');
    const parts = [
        `command ${bins.join(' or ') || '(none)'}`,
        `search: ${clip(tokens(search.argv), 160)}`,
        `probe: ${clip(tokens(probe.versionArgs), 60)} ; ${clip(tokens(probe.helpArgs), 60)}`,
        ...names.length ? [`reads environment variables ${clip(names.join(', '), 100)}`] : [],
    ];
    return parts.join('; ');
}
export function webPolicyDecision(actionName, args, mode) {
    const action = findAction(actionName);
    if (!action || action.approval === 'none')
        return { kind: 'allow' };
    const label = describe(action.name, args);
    if (action.approval === 'install') {
        if (mode === 'read-only')
            return { kind: 'deny', reason: `Dependency installation is disabled by automationMode=${mode}` };
        if (mode === 'unrestricted')
            return { kind: 'allow' };
        return { kind: 'ask', reason: `${label}: Install an external Web Search Pro backend dependency` };
    }
    if (action.approval === 'run-program') {
        // Whoever the automation mode trusts, a new program is the user's decision: asked in every mode but read-only, which refuses.
        if (mode === 'read-only')
            return { kind: 'deny', reason: `Adding a custom CLI is disabled by automationMode=${mode}` };
        const input = (args && typeof args === 'object' ? args : {});
        return { kind: 'ask', reason: `${label}: Let Web Search Pro run a local program as a search source — ${describeCliSpec(input.spec)}` };
    }
    if (action.approval === 'config') {
        if (mode === 'read-only')
            return { kind: 'deny', reason: `Changing the Web Search Pro search order is disabled by automationMode=${mode}` };
        return { kind: 'allow' };
    }
    // local-write
    if (mode === 'read-only')
        return { kind: 'deny', reason: `Web Search Pro mutations are disabled by automationMode=${mode}` };
    if (mode === 'autonomous' || mode === 'unrestricted')
        return { kind: 'allow' };
    return { kind: 'ask', reason: `${label}: Modify Web Search Pro local state (cache, history or extraction rules)` };
}
/** The dsh-browser automationMode, when the optional service is present and reports one. */
export async function automationModeOf(browser) {
    const status = browser?.status;
    if (typeof status !== 'function')
        return undefined;
    try {
        const value = (await status.call(browser))?.automationMode;
        return AUTOMATION_MODES.includes(value) ? value : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=approval.js.map