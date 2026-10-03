/**
 * Old tool names and parameters -> the action that now carries the capability.
 *
 * There are no compatibility wrappers: the old tools are not registered. This table is only used to tell a
 * model (and a reader) where a capability went: the index root lists it, and an unknown action that is an
 * old tool name is answered with the new action. Tests walk it to prove every capability stays reachable.
 * @module web-search-pro/actions/legacy
 */

import { findAction } from './registry.ts'

export interface LegacyRoute {
  /** The action that replaces the old tool (or the old tool call with these parameters). */
  action: string
  /** Old parameter names that moved under another name (old -> new); unlisted ones keep their name (and are dropped when the action does not take them). */
  rename?: Record<string, string>
}

export interface LegacyTool {
  /** One line for the index root: `old -> new`. */
  summary: string
  /** Pick the route for one call's arguments. */
  route(args: Record<string, unknown>): LegacyRoute
}

const direct = (action: string, summary = action): LegacyTool => ({ summary, route: () => ({ action }) })

export const LEGACY_TOOLS: Record<string, LegacyTool> = {
  web_search_pro: direct('search.run'),
  web_platform_search: direct('search.run', 'search.run {platform}'),
  web_fetch_pro: direct('read.fetch'),
  web_exa_contents: direct('read.contents'),
  web_snapshot: direct('read.snapshot'),
  web_search_stats: direct('cache.stats'),
  web_history: {
    summary: 'history.list|replay|expand|export',
    route(args) {
      if (args.action === 'expand') return { action: 'history.expand' }
      if (args.replay !== undefined) return { action: 'history.replay', rename: { replay: 'id' } }
      if (args.export === true) return { action: 'history.export' }
      return { action: 'history.list' }
    },
  },
  web_cache_clear: {
    summary: 'cache.clear | history.delete {id}',
    route: args => args.queryId !== undefined ? { action: 'history.delete', rename: { queryId: 'id' } } : { action: 'cache.clear' },
  },
  web_rule: {
    summary: 'rules.list|upsert|remove|import|export',
    route: args => ({ action: 'rules.' + String(args.action ?? 'list') }),
  },
  web_backend_status: {
    summary: 'sources.status | search.recommend',
    route: args => ({ action: args.action === 'recommend' ? 'search.recommend' : 'sources.status' }),
  },
  web_deps: {
    summary: 'sources.deps | sources.install',
    route: args => ({ action: args.action === 'install' ? 'sources.install' : 'sources.deps' }),
  },
}

export const LEGACY_TOOL_NAMES: readonly string[] = Object.keys(LEGACY_TOOLS)

export function isLegacyToolName(name: unknown): name is string {
  return typeof name === 'string' && Object.hasOwn(LEGACY_TOOLS, name)
}

/** Translate one old call into the new action and arguments. */
export function mapLegacyCall(tool: string, args: Record<string, unknown> = {}): { action: string; args: Record<string, unknown> } {
  const entry = LEGACY_TOOLS[tool]
  if (!entry) throw new Error('not an old tool name: ' + tool)
  const route = entry.route(args)
  const params = findAction(route.action)?.params ?? {}
  const mapped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    const target = route.rename && Object.hasOwn(route.rename, key) ? route.rename[key]! : key
    // Parameters the target action does not take (the old tools combined several operations) are left behind.
    if (Object.hasOwn(params, target)) mapped[target] = value
  }
  return { action: route.action, args: mapped }
}

/** The root line listing every old name and where it went. */
export function legacyLine(): string {
  return Object.entries(LEGACY_TOOLS).map(([old, entry]) => `${old} -> ${entry.summary}`).join('; ')
}
