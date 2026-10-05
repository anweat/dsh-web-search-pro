/**
 * The model-facing definitions of the two `indexed` tools (L0): name, description and parameter schema.
 *
 * Kept apart from `tools.ts` so the plugin registers them and the budget check measures them from one definition.
 * @module web-search-pro/tool-defs
 */
export declare const INDEX_DESCRIPTION = "Web search and reading index. No args: groups. {group}: its actions. {action}: one schema. {query}: keyword search.";
export declare const CALL_DESCRIPTION = "Run one web action (search.run, read.fetch ...); web_index lists them. INVALID_ARGS replies carry the schema.";
export declare const INDEX_PARAMETERS: {
    readonly group: {
        readonly type: "string";
        readonly description: "Group, e.g. read.";
    };
    readonly action: {
        readonly type: "string";
        readonly description: "Action, e.g. search.run.";
    };
    readonly query: {
        readonly type: "string";
        readonly description: "Keywords.";
    };
};
export declare const CALL_PARAMETERS: {
    readonly action: {
        readonly type: "string";
        readonly required: true;
        readonly description: "Action, e.g. search.run.";
    };
    readonly args: {
        readonly type: "object";
        readonly additionalProperties: true;
        readonly description: "Action arguments.";
    };
};
/** What the host sends to the model for the two indexed tools (name + description + parameters). */
export declare function indexedToolDefinitions(): {
    name: string;
    description: string;
    parameters: unknown;
}[];
