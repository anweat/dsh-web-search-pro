/**
 * The model-facing definitions of the two `indexed` tools (L0): name, description and parameter schema.
 *
 * Kept apart from `tools.ts` so the plugin registers them and the budget check measures them from one definition.
 * @module web-search-pro/tool-defs
 */
import { CALL_TOOL, INDEX_TOOL } from "./actions/registry.js";
export const INDEX_DESCRIPTION = 'Web search and reading index. No args: groups. {group}: its actions. {action}: one schema. {query}: keyword search.';
export const CALL_DESCRIPTION = 'Run one web action (search.run, read.fetch ...); web_index lists them. INVALID_ARGS replies carry the schema.';
export const INDEX_PARAMETERS = {
    group: { type: 'string', description: 'Group, e.g. read.' },
    action: { type: 'string', description: 'Action, e.g. search.run.' },
    query: { type: 'string', description: 'Keywords.' },
};
export const CALL_PARAMETERS = {
    action: { type: 'string', required: true, description: 'Action, e.g. search.run.' },
    args: { type: 'object', additionalProperties: true, description: 'Action arguments.' },
};
/** What the host sends to the model for the two indexed tools (name + description + parameters). */
export function indexedToolDefinitions() {
    return [
        { name: INDEX_TOOL, description: INDEX_DESCRIPTION, parameters: INDEX_PARAMETERS },
        { name: CALL_TOOL, description: CALL_DESCRIPTION, parameters: CALL_PARAMETERS },
    ];
}
//# sourceMappingURL=tool-defs.js.map