/**
 * The action registry: the single definition of every model-visible capability.
 * Tool surfaces, approval policy and the index views are all derived from this list.
 * @module web-search-pro/actions/registry
 */
import { type ActionDef, type ActionGroup } from './types.ts';
export declare const ACTIONS: readonly ActionDef[];
export declare const GROUP_SUMMARIES: Record<ActionGroup, string>;
export declare function isActionGroup(value: unknown): value is ActionGroup;
export declare function findAction(name: unknown): ActionDef | undefined;
export declare function actionsInGroup(group: ActionGroup): ActionDef[];
/** The two tools of the indexed surface. */
export declare const INDEX_TOOL = "web_index";
export declare const CALL_TOOL = "web_call";
/** Tool name of an action on the flat surface: `web_<group>_<action>` (a debugging projection, not the old tool names). */
export declare function flatToolName(action: ActionDef): string;
export declare function findActionByFlatTool(toolName: string): ActionDef | undefined;
/** The nearest action names for an unknown one: same group, same verb, or sharing a word. */
export declare function similarActions(name: string, limit?: number): string[];
