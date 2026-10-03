/**
 * Model-facing tool surfaces for web-search-pro.
 *
 * Every capability is an action in the registry (`src/actions/`). This module
 * only projects that registry into tools:
 *
 * - `indexed` (default): two small tools, `web_index` for progressive
 *   disclosure and `web_call` to run an action. Constant, tiny context cost.
 * - `flat`: one tool per action, named `web_<group>_<action>`. Every action
 *   is described up front; for comparison and debugging only.
 *
 * Both surfaces dispatch through the same {@link runAction}, so validation,
 * the result envelope and the error codes are identical.
 * @module web-search-pro/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { browserState, toBrowserGetter } from "./browser-access.js";
import { EvidenceService } from "./pipeline/service.js";
import { ACTIONS, findAction, flatToolName } from "./actions/registry.js";
import { renderIndex } from "./actions/index-view.js";
import { renderEnvelope, runAction } from "./actions/run.js";
import { DEFAULT_FETCH_CHARS } from "./actions/format.js";
import { CALL_DESCRIPTION, CALL_PARAMETERS, INDEX_DESCRIPTION, INDEX_PARAMETERS } from "./tool-defs.js";
import { CALL_TOOL, INDEX_TOOL } from "./actions/registry.js";
const ENVELOPE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        ok: { type: 'boolean', required: true },
        action: { type: 'string', required: true },
        // The result is the active action's own closed output schema (see ActionDef.output), which varies per action.
        result: { type: 'object', additionalProperties: true },
        error: {
            type: 'object', additionalProperties: false,
            properties: {
                code: { type: 'string', required: true },
                message: { type: 'string', required: true },
                hint: { type: 'string' },
                schema: { type: 'string' },
            },
        },
        truncation: {
            type: 'object', additionalProperties: false,
            properties: { omitted: { type: 'number', required: true }, reason: { type: 'string', required: true } },
        },
    },
};
/** The call card the Host shows for a search; other actions use the Host's default. */
const presentSearch = (args) => args?.query ? { card: 'generic', kind: 'search', title: args.query, rawInput: args.query } : undefined;
export function registerTools(deps) {
    const { ctx, config, dynamic, store, router, fetch: fetchSvc } = deps;
    const getBrowser = toBrowserGetter(deps.browser);
    let evidenceService = deps.evidence;
    const services = {
        config, dynamic, store, router, fetch: fetchSvc, browser: getBrowser,
        evidence: () => (evidenceService ??= new EvidenceService({ router, fetch: fetchSvc, store, dynamic })),
        /** Default characters one text exit may return (config `fetchDefaultChars`). */
        outputCap: () => dynamic().fetchDefaultChars ?? DEFAULT_FETCH_CHARS,
    };
    const register = (tool) => { ctx.tools.register(tool); };
    const signalOf = (exec) => exec?.signal ?? new AbortController().signal;
    const surface = deps.toolSurface ?? config.toolSurface ?? 'indexed';
    const render = (args, value) => [{ type: 'text', text: renderEnvelope(value, args?.args ?? {}) }];
    if (surface === 'flat') {
        for (const action of ACTIONS)
            register(flatTool(action, services, config, signalOf));
        return;
    }
    register(defineTool({
        name: INDEX_TOOL,
        description: INDEX_DESCRIPTION,
        parameters: { ...INDEX_PARAMETERS },
        output: {
            schema: { type: 'object', additionalProperties: false, properties: { level: { type: 'string', required: true }, text: { type: 'string', required: true } } },
            render: (_args, value) => [{ type: 'text', text: value.text }],
        },
        timeoutMs: 15_000,
        isConcurrencySafe: () => true,
        async execute(args) {
            const env = { skillAvailable: deps.skillAvailable?.() ?? false, browserReady: browserState(getBrowser()).state === 'ready' };
            return renderIndex(args, env);
        },
    }));
    // The host ceiling is the longest action deadline; each action still runs under its own deadline.
    const ceiling = Math.max(...ACTIONS.map(action => action.timeoutMs(config))) + 5_000;
    register(defineTool({
        name: CALL_TOOL,
        description: CALL_DESCRIPTION,
        parameters: { ...CALL_PARAMETERS },
        output: { schema: ENVELOPE_SCHEMA, render: render },
        timeoutMs: ceiling,
        // The Host passes the call's arguments: sibling calls overlap only when this action says so.
        isConcurrencySafe: (args) => findAction(args?.action)?.concurrencySafe ?? false,
        presentCall: (args) => args?.action === 'search.run' ? presentSearch(args.args) : undefined,
        async execute(args, exec) {
            return runAction(args.action, args.args, { ...services, signal: signalOf(exec) });
        },
    }));
}
/** One flat tool for one action: the same registry entry, projected as a native tool. */
function flatTool(action, services, config, signalOf) {
    return defineTool({
        name: flatToolName(action),
        description: action.summary + (action.notes ? ' ' + action.notes : ''),
        parameters: action.params,
        output: { schema: ENVELOPE_SCHEMA, render: ((args, value) => [{ type: 'text', text: renderEnvelope(value, (args ?? {})) }]) },
        timeoutMs: action.timeoutMs(config) + 5_000,
        isConcurrencySafe: () => action.concurrencySafe,
        ...action.name === 'search.run' ? { presentCall: presentSearch } : {},
        async execute(args, exec) {
            return runAction(action.name, args, { ...services, signal: signalOf(exec) });
        },
    });
}
//# sourceMappingURL=tools.js.map