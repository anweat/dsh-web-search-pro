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

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SearchRouter } from './router.ts'
import type { FetchService } from './fetch.ts'
import type { Store } from './store.ts'
import { browserState, toBrowserGetter, type BrowserGetter } from './browser-access.ts'
import type { BrowserService } from './browser-service.ts'
import type { ResolvedConfig, ToolSurface } from './config.ts'
import { EvidenceService } from './pipeline/service.ts'
import { ACTIONS, findAction, flatToolName } from './actions/registry.ts'
import { renderIndex, type IndexEnvironment } from './actions/index-view.ts'
import { renderEnvelope, runAction } from './actions/run.ts'
import { DEFAULT_FETCH_CHARS } from './actions/format.ts'
import { CALL_DESCRIPTION, CALL_PARAMETERS, INDEX_DESCRIPTION, INDEX_PARAMETERS } from './tool-defs.ts'
import type { ActionDef, ActionEnvelope, ActionServices } from './actions/types.ts'
import { CALL_TOOL, INDEX_TOOL } from './actions/registry.ts'

export interface ToolDeps {
  ctx: Context
  config: ResolvedConfig
  /** Hot-reloadable config source (settings.yaml overlay). */
  dynamic: () => ResolvedConfig
  store: Store
  router: SearchRouter
  fetch: FetchService
  /** Optional dsh-browser service, read lazily at call time (fixed service accepted for tests). */
  browser?: BrowserService | BrowserGetter
  /** Evidence pipeline (built lazily from the other deps when omitted; tests inject doubles). */
  evidence?: Pick<EvidenceService, 'search'>
  /** Overrides `config.toolSurface`. */
  toolSurface?: ToolSurface
  /** Whether the `dsh-web-search-pro` skill is currently registered; read at call time. */
  skillAvailable?: () => boolean
}

const ENVELOPE_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' as const, required: true as const },
    action: { type: 'string' as const, required: true as const },
    // The result is the active action's own closed output schema (see ActionDef.output), which varies per action.
    result: { type: 'object' as const, additionalProperties: true },
    error: {
      type: 'object' as const, additionalProperties: false,
      properties: {
        code: { type: 'string' as const, required: true as const },
        message: { type: 'string' as const, required: true as const },
        hint: { type: 'string' as const },
        schema: { type: 'string' as const },
      },
    },
    truncation: {
      type: 'object' as const, additionalProperties: false,
      properties: { omitted: { type: 'number' as const, required: true as const }, reason: { type: 'string' as const, required: true as const } },
    },
  },
}

/** The call card the Host shows for a search; other actions use the Host's default. */
const presentSearch = (args: { query?: string } | undefined) => args?.query ? { card: 'generic' as const, kind: 'search' as const, title: args.query, rawInput: args.query } : undefined

export function registerTools(deps: ToolDeps): void {
  const { ctx, config, dynamic, store, router, fetch: fetchSvc } = deps
  const getBrowser = toBrowserGetter(deps.browser)
  let evidenceService = deps.evidence
  const services: ActionServices = {
    config, dynamic, store, router, fetch: fetchSvc, browser: getBrowser,
    evidence: () => (evidenceService ??= new EvidenceService({ router, fetch: fetchSvc, store, dynamic })),
    /** Default characters one text exit may return (config `fetchDefaultChars`). */
    outputCap: () => dynamic().fetchDefaultChars ?? DEFAULT_FETCH_CHARS,
  }
  const register = (tool: unknown): void => { ctx.tools.register(tool as never) }
  const signalOf = (exec: unknown): AbortSignal => (exec as { signal?: AbortSignal } | undefined)?.signal ?? new AbortController().signal
  const surface = deps.toolSurface ?? config.toolSurface ?? 'indexed'
  const render = (args: { args?: Record<string, unknown> } | undefined, value: unknown): { type: 'text'; text: string }[] => [{ type: 'text', text: renderEnvelope(value as ActionEnvelope, args?.args ?? {}) }]

  if (surface === 'flat') {
    for (const action of ACTIONS) register(flatTool(action, services, config, signalOf))
    return
  }

  register(defineTool({
    name: INDEX_TOOL,
    description: INDEX_DESCRIPTION,
    parameters: { ...INDEX_PARAMETERS },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { level: { type: 'string', required: true }, text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: (value as { text: string }).text }],
    },
    timeoutMs: 15_000,
    isConcurrencySafe: () => true,
    async execute(args: { group?: string; action?: string; query?: string }) {
      const env: IndexEnvironment = { skillAvailable: deps.skillAvailable?.() ?? false, browserReady: browserState(getBrowser()).state === 'ready' }
      return renderIndex(args, env)
    },
  } as never))

  // The host ceiling is the longest action deadline; each action still runs under its own deadline.
  const ceiling = Math.max(...ACTIONS.map(action => action.timeoutMs(config))) + 5_000
  register(defineTool({
    name: CALL_TOOL,
    description: CALL_DESCRIPTION,
    parameters: { ...CALL_PARAMETERS },
    output: { schema: ENVELOPE_SCHEMA, render: render as never },
    timeoutMs: ceiling,
    // The Host passes the call's arguments: sibling calls overlap only when this action says so.
    isConcurrencySafe: (args: { action?: string }) => findAction(args?.action)?.concurrencySafe ?? false,
    presentCall: (args: { action?: string; args?: { query?: string } }) => args?.action === 'search.run' ? presentSearch(args.args) : undefined,
    async execute(args: { action: string; args?: Record<string, unknown> }, exec: unknown) {
      return runAction(args.action, args.args, { ...services, signal: signalOf(exec) }) as Promise<ActionEnvelope> as never
    },
  } as never))
}

/** One flat tool for one action: the same registry entry, projected as a native tool. */
function flatTool(action: ActionDef, services: ActionServices, config: ResolvedConfig, signalOf: (exec: unknown) => AbortSignal): unknown {
  return defineTool({
    name: flatToolName(action),
    description: action.summary + (action.notes ? ' ' + action.notes : ''),
    parameters: action.params as never,
    output: { schema: ENVELOPE_SCHEMA, render: ((args: unknown, value: unknown) => [{ type: 'text', text: renderEnvelope(value as ActionEnvelope, (args ?? {}) as Record<string, unknown>) }]) as never },
    timeoutMs: action.timeoutMs(config) + 5_000,
    isConcurrencySafe: () => action.concurrencySafe,
    ...action.name === 'search.run' ? { presentCall: presentSearch } : {},
    async execute(args: Record<string, unknown>, exec: unknown) {
      return runAction(action.name, args, { ...services, signal: signalOf(exec) }) as never
    },
  } as never)
}
