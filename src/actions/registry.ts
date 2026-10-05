/**
 * The action registry: the single definition of every model-visible capability.
 * Tool surfaces, approval policy and the index views are all derived from this list.
 * @module web-search-pro/actions/registry
 */

import { ACTION_GROUPS, type ActionDef, type ActionGroup } from './types.ts'
import { SEARCH_ACTIONS } from './search.ts'
import { READ_ACTIONS } from './read.ts'
import { HISTORY_ACTIONS } from './history.ts'
import { SOURCES_ACTIONS } from './sources.ts'
import { RULES_ACTIONS } from './rules.ts'
import { CACHE_ACTIONS } from './cache.ts'

export const ACTIONS: readonly ActionDef[] = [
  ...SEARCH_ACTIONS, ...READ_ACTIONS, ...HISTORY_ACTIONS, ...SOURCES_ACTIONS, ...RULES_ACTIONS, ...CACHE_ACTIONS,
]

const BY_NAME = new Map(ACTIONS.map(action => [action.name, action]))

export const GROUP_SUMMARIES: Record<ActionGroup, string> = {
  search: 'search the web (evidence pack or source list, one platform) and recommend sources',
  read: 'fetch a page, read many URLs, render a page in the browser',
  history: 'list, replay, expand evidence, export, delete stored records',
  sources: 'source and dependency status, install CLI dependencies',
  rules: 'per-site extraction rules: list, upsert, remove, import, export',
  cache: 'clear the cache, store statistics',
}

export function isActionGroup(value: unknown): value is ActionGroup {
  return typeof value === 'string' && (ACTION_GROUPS as readonly string[]).includes(value)
}

export function findAction(name: unknown): ActionDef | undefined {
  return typeof name === 'string' ? BY_NAME.get(name) : undefined
}

export function actionsInGroup(group: ActionGroup): ActionDef[] {
  return ACTIONS.filter(action => action.group === group)
}

/** The two tools of the indexed surface. */
export const INDEX_TOOL = 'web_index'
export const CALL_TOOL = 'web_call'

/** Tool name of an action on the flat surface: `web_<group>_<action>` (a debugging projection, not the old tool names). */
export function flatToolName(action: ActionDef): string {
  return 'web_' + action.name.replace('.', '_')
}

const BY_FLAT_NAME = new Map(ACTIONS.map(action => [flatToolName(action), action]))

export function findActionByFlatTool(toolName: string): ActionDef | undefined {
  return BY_FLAT_NAME.get(toolName)
}

/** The nearest action names for an unknown one: same group, same verb, or sharing a word. */
export function similarActions(name: string, limit = 5): string[] {
  const text = name.toLowerCase()
  const parts = text.split(/[^a-z0-9]+/).filter(Boolean)
  const scored = ACTIONS.map(action => {
    const [group, verb] = action.name.split('.') as [string, string]
    let score = 0
    if (text === action.name) score += 10
    if (parts.includes(group)) score += 3
    if (parts.includes(verb)) score += 3
    if (text.includes(verb) || verb.includes(text)) score += 2
    if (text.includes(group)) score += 1
    return { name: action.name, score }
  }).filter(entry => entry.score > 0)
  return scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit).map(entry => entry.name)
}
