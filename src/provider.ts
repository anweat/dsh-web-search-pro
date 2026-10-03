/**
 * The ctx.web provider route (dev-plan M8c): this plugin as the Host's search and fetch provider, so the built-in
 * `web_search` / `web_fetch` tools the model already prefers return filtered evidence and budgeted pages.
 *
 * Selection is the Host's, not ours (`@deepseek-ai/dsh-web`): a provider is used only when the `web` entry pins its id
 * (`searchProvider` / `fetchProvider`, or `DSH_WEB_SEARCH_PROVIDER` / `DSH_WEB_FETCH_PROVIDER`, which feed the same
 * fields), or when it is the only usable provider registered. With no pinned id and two usable providers the Host fails
 * every call with `WEB_PROVIDER_AMBIGUOUS`. Registering is therefore opt-in (`registerProvider`), never a silent takeover.
 * @module web-search-pro/provider
 */

import type { WebFetchProvider, WebFetchResult, WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import type { ResolvedConfig, ToolSurface } from './config.ts'
import type { FetchService } from './fetch.ts'
import type { SearchRouter } from './router.ts'
import { renderEvidenceOutput } from './pipeline/render.ts'
import type { EvidenceOutput, EvidenceService } from './pipeline/service.ts'
import { flatToolName, findAction } from './actions/registry.ts'

/** How far past the pipeline's own deadline the provider waits before it gives up on the pipeline and returns plain sources. */
export const EVIDENCE_GUARD_MS = 3_000

/** The call a model makes for an action on the active tool surface (`web_call history.expand` / flat `web_history_expand`). */
export function callHint(action: string, surface: ToolSurface): string {
  const def = findAction(action)
  return surface === 'flat' && def ? flatToolName(def) : 'web_call ' + action
}

/** One line under the pack: how to go further from inside the built-in tool. */
export function expandHint(surface: ToolSurface): string {
  return 'To read around an excerpt: ' + callHint('history.expand', surface) + ' evidenceId=<id>; to read a page in full: ' + callHint('read.fetch', surface) + ' url=<url> (offset=N continues).'
}

/** Trailing line of a truncated page: where to continue (the page text already ends with the truncation marker). */
export function continueHint(surface: ToolSurface, url: string, nextOffset: number | undefined): string {
  return '\n\n[Continue with ' + callHint('read.fetch', surface) + ' url=' + url + (nextOffset !== undefined ? ' offset=' + nextOffset : '') + ']'
}

export interface SearchProviderDeps {
  router: Pick<SearchRouter, 'searchAsProvider' | 'anyEngineAvailable'>
  evidence: () => Pick<EvidenceService, 'search'>
  dynamic: () => ResolvedConfig
  id: () => string
  /** The tool surface registered at startup (it decides how the hints name the calls). */
  surface: ToolSurface
  /** Test seam: wait this long past the pipeline's own deadline before giving up on it. */
  guardMs?: number
}

/** The pack as the built-in tool gets it: text in `content`, sources as before, `truncated` only when sources were left out. */
function packResult(out: EvidenceOutput, surface: ToolSurface): WebSearchResult {
  const text = renderEvidenceOutput(out, { omitOtherSources: true, expandLine: expandHint(surface) })
  return {
    content: text,
    sources: out.sources.map(s => ({ url: s.url, ...s.title ? { title: s.title } : {}, ...s.snippet ? { snippet: s.snippet } : {}, ...s.publishedAt ? { publishedAt: s.publishedAt } : {} })),
    truncated: out.stats.kept > out.sources.length,
  }
}

/**
 * Search provider: evidence pack when `provider.evidence` is `auto`, the plain router search otherwise.
 * The evidence run has its own deadline and never fails the built-in tool: any failure returns today's plain sources.
 * Only the caller's own cancellation is rethrown.
 */
export function createSearchProvider(deps: SearchProviderDeps): WebSearchProvider {
  return {
    id: deps.id(),
    available: () => deps.router.anyEngineAvailable(),
    async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
      const cfg = deps.dynamic()
      if (cfg.provider.evidence === 'off') return deps.router.searchAsProvider(request, signal)
      const guard = new AbortController()
      const stage = signal ? AbortSignal.any([signal, guard.signal]) : guard.signal
      const deadlineMs = cfg.provider.deadlineMs
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const run = deps.evidence().search({
          query: request.query,
          count: Math.min(Math.max(request.maxResults ?? cfg.searchMaxResults, 1), 20),
          signal: stage,
          deadlineMs,
          skipSeam: true,
        })
        const waitMs = deadlineMs + (deps.guardMs ?? EVIDENCE_GUARD_MS)
        const watchdog = new Promise<never>((_, reject) => {
          timer = setTimeout(() => { guard.abort(); reject(new Error('evidence run did not finish within ' + waitMs + ' ms')) }, waitMs)
          timer.unref?.()
        })
        return packResult(await Promise.race([run, watchdog]), deps.surface)
      } catch (error) {
        // The caller gave up: nothing to fall back to. Anything else (timeout, pipeline error) must not cost the plain result.
        if (signal?.aborted) throw error
        return deps.router.searchAsProvider(request, signal)
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

export interface FetchProviderDeps {
  fetch: Pick<FetchService, 'fetchPage'>
  dynamic: () => ResolvedConfig
  id: () => string
  surface: ToolSurface
}

/** Fetch provider: the same fetch pipeline as `read.fetch`, under a fixed budget (the request carries no size). */
export function createFetchProvider(deps: FetchProviderDeps): WebFetchProvider {
  return {
    id: deps.id(),
    available: () => true,
    async fetch(request, signal): Promise<WebFetchResult> {
      const cfg = deps.dynamic()
      // WebFetchRequest carries no size, so the cap is fixed: twice the read.fetch default
      // (`truncated` then tells the host the body was cut).
      const out = await deps.fetch.fetchPage(request.url, {
        mode: 'auto',
        signal,
        maxChars: (cfg.fetchDefaultChars ?? 20_000) * 2,
        fresh: false,
        persist: true,
      })
      const truncated = out.truncated ?? false
      return {
        url: out.url,
        statusCode: out.statusCode ?? 200,
        body: { kind: 'text', content: truncated ? out.text + continueHint(deps.surface, out.url, out.nextOffset) : out.text },
        truncated,
      }
    },
  }
}

// ── selection state ─────────────────────────────────────────────────────────

export type SelectionKind = 'search' | 'fetch'

export interface Selection {
  /** The id the Host is pinned to, when one is. */
  pinned?: string
  /** `host`: read from the web runtime (config or env, already merged). `env`: the runtime hides it, so only the environment variable was read. */
  via: 'host' | 'env'
  /** `selected`: this plugin's provider is pinned. `other`: another id is pinned. `unpinned`: nothing is pinned (the Host then needs exactly one usable provider). */
  state: 'selected' | 'other' | 'unpinned'
}

export interface ProviderState {
  id: string
  registered: boolean
  evidence: ResolvedConfig['provider']['evidence']
  search?: Selection
  fetch?: Selection
}

const ENV_NAME: Record<SelectionKind, string> = { search: 'DSH_WEB_SEARCH_PROVIDER', fetch: 'DSH_WEB_FETCH_PROVIDER' }
const FIELD_NAME: Record<SelectionKind, string> = { search: 'searchProviderId', fetch: 'fetchProviderId' }

/**
 * Which provider the Host is pinned to for one capability. `WebRuntime` keeps the pinned id (config merged with the
 * environment) in a private field; it is read defensively, and the environment variable is the fallback.
 */
export function readSelection(web: unknown, kind: SelectionKind, id: string, env: NodeJS.ProcessEnv = process.env): Selection {
  let pinned: unknown
  let via: Selection['via'] = 'env'
  if (web && typeof web === 'object' && FIELD_NAME[kind] in web) {
    pinned = (web as Record<string, unknown>)[FIELD_NAME[kind]]
    via = 'host'
  } else {
    pinned = env[ENV_NAME[kind]]
  }
  const value = typeof pinned === 'string' && pinned.trim() ? pinned.trim() : undefined
  return { ...value ? { pinned: value } : {}, via, state: value === undefined ? 'unpinned' : value === id ? 'selected' : 'other' }
}

export function readProviderState(deps: { web: unknown; registered: boolean; id: string; evidence: ProviderState['evidence']; env?: NodeJS.ProcessEnv }): ProviderState {
  return {
    id: deps.id,
    registered: deps.registered,
    evidence: deps.evidence,
    ...deps.registered ? { search: readSelection(deps.web, 'search', deps.id, deps.env), fetch: readSelection(deps.web, 'fetch', deps.id, deps.env) } : {},
  }
}

/** Setup text for the user, shown by `sources.status` while the route is not fully active. */
export const SELECT_HINT = 'select it in the profile patch: `- id: web` / `config: { searchProvider: <id>, fetchProvider: <id> }` (or env DSH_WEB_SEARCH_PROVIDER / DSH_WEB_FETCH_PROVIDER), then restart'

export function renderProviderState(state: ProviderState): string[] {
  if (!state.registered) return ['ctx.web route: off (registerProvider=false): the built-in web_search / web_fetch do not use this plugin. To route them here set registerProvider=true and ' + SELECT_HINT + '.']
  const part = (kind: SelectionKind, tool: string, sel: Selection | undefined): string => {
    if (!sel) return tool + ': unknown'
    if (sel.state === 'selected') return tool + ': this plugin' + (kind === 'search' ? ' (evidence=' + state.evidence + ')' : '')
    if (sel.state === 'other') return tool + ': NOT this plugin (the Host is pinned to "' + sel.pinned + '")'
    return tool + ': not pinned (the Host auto-selects only when exactly one provider is usable, otherwise WEB_PROVIDER_AMBIGUOUS)'
  }
  const lines = ['ctx.web route: registered as "' + state.id + '"; ' + part('search', 'web_search', state.search) + '; ' + part('fetch', 'web_fetch', state.fetch)]
  if (state.search?.state !== 'selected' || state.fetch?.state !== 'selected') lines.push('  to use it: ' + SELECT_HINT)
  if (state.search?.via === 'env' || state.fetch?.via === 'env') lines.push('  (only the environment variables were readable here; a pin in the web entry config may not show)')
  return lines
}
