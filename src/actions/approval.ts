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

import { CALL_TOOL, INDEX_TOOL, findAction, findActionByFlatTool } from './registry.ts'

export const AUTOMATION_MODES = ['read-only', 'standard', 'autonomous', 'unrestricted'] as const
export type AutomationMode = typeof AUTOMATION_MODES[number]

export type PolicyDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason: string }

export type ResolvedWebCall =
  /** `web_index`: read-only catalog, no side effects. */
  | { kind: 'index' }
  /** A call that names a known action; `args` are the action's own arguments. */
  | { kind: 'action'; action: string; args: unknown }
  /** `web_call` with a missing or unknown action; execution returns a structured error. */
  | { kind: 'unresolved' }

/** Maps a model-visible tool call to the action it will run; undefined for tools that are not ours. */
export function resolveWebCall(toolName: string, rawArgs: unknown): ResolvedWebCall | undefined {
  if (toolName === INDEX_TOOL) return { kind: 'index' }
  if (toolName === CALL_TOOL) {
    const input = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as { action?: unknown; args?: unknown }
    return findAction(input.action) ? { kind: 'action', action: input.action as string, args: input.args ?? {} } : { kind: 'unresolved' }
  }
  const flat = findActionByFlatTool(toolName)
  return flat ? { kind: 'action', action: flat.name, args: rawArgs ?? {} } : undefined
}

const clip = (text: string, max = 80): string => text.length > max ? text.slice(0, max) + '…' : text

/** Short, human-readable description of the key arguments for the approval prompt. */
function describe(action: string, args: unknown): string {
  const input = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
  const parts: string[] = []
  for (const key of ['backend', 'installer', 'hostname', 'id', 'engine', 'olderThanDays']) {
    if (input[key] !== undefined) parts.push(`${key}=${clip(String(input[key]))}`)
  }
  if (typeof input.rulesJson === 'string') parts.push(`rulesJson (${input.rulesJson.length} chars)`)
  return parts.length ? `${action} ${parts.join(' ')}` : action
}

export function webPolicyDecision(actionName: string, args: unknown, mode: AutomationMode | undefined): PolicyDecision {
  const action = findAction(actionName)
  if (!action || action.approval === 'none') return { kind: 'allow' }
  const label = describe(action.name, args)
  if (action.approval === 'install') {
    if (mode === 'read-only') return { kind: 'deny', reason: `Dependency installation is disabled by automationMode=${mode}` }
    if (mode === 'unrestricted') return { kind: 'allow' }
    return { kind: 'ask', reason: `${label}: Install an external Web Search Pro backend dependency` }
  }
  // local-write
  if (mode === 'read-only') return { kind: 'deny', reason: `Web Search Pro mutations are disabled by automationMode=${mode}` }
  if (mode === 'autonomous' || mode === 'unrestricted') return { kind: 'allow' }
  return { kind: 'ask', reason: `${label}: Modify Web Search Pro local state (cache, history or extraction rules)` }
}

/** The dsh-browser automationMode, when the optional service is present and reports one. */
export async function automationModeOf(browser: unknown): Promise<AutomationMode | undefined> {
  const status = (browser as { status?: unknown } | undefined)?.status
  if (typeof status !== 'function') return undefined
  try {
    const value = (await (status as () => Promise<{ automationMode?: unknown }>).call(browser))?.automationMode
    return (AUTOMATION_MODES as readonly unknown[]).includes(value) ? value as AutomationMode : undefined
  } catch { return undefined }
}
