/**
 * Old tool names and parameters -> the action that now carries the capability.
 *
 * There are no compatibility wrappers: the old tools are not registered. This table is only used to tell a
 * model (and a reader) where a capability went: the index root lists it, and an unknown action that is an
 * old tool name is answered with the new action. Tests walk it to prove every capability stays reachable.
 * @module web-search-pro/actions/legacy
 */
export interface LegacyRoute {
    /** The action that replaces the old tool (or the old tool call with these parameters). */
    action: string;
    /** Old parameter names that moved under another name (old -> new); unlisted ones keep their name (and are dropped when the action does not take them). */
    rename?: Record<string, string>;
}
export interface LegacyTool {
    /** One line for the index root: `old -> new`. */
    summary: string;
    /** Pick the route for one call's arguments. */
    route(args: Record<string, unknown>): LegacyRoute;
}
export declare const LEGACY_TOOLS: Record<string, LegacyTool>;
export declare const LEGACY_TOOL_NAMES: readonly string[];
export declare function isLegacyToolName(name: unknown): name is string;
/** Translate one old call into the new action and arguments. */
export declare function mapLegacyCall(tool: string, args?: Record<string, unknown>): {
    action: string;
    args: Record<string, unknown>;
};
/** The root line listing every old name and where it went. */
export declare function legacyLine(): string;
