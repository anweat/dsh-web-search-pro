/**
 * web-search-pro — 增强型、可持久化的扩展网页搜索插件 for DeepSeek Harness.
 *
 * - Multi-backend search routing with automatic fallback (agent-reach style):
 *   ctx.web seam / Exa / DuckDuckGo / Bing / Jina + platform backends
 *   (bili-cli, yt-dlp, sov2ex, opencli, agent-reach).
 * - Persistent SQLite store (MediaCrawler style): search queries + results,
 *   page snapshots, and user-extended per-site extraction rules survive
 *   restarts and are reused within a configurable TTL.
 * - Userscript-style per-site extraction rules ("脚本猫/油猴" style) applied
 *   by the fetch pipeline (Jina Reader → HTTP+extraction → Playwright).
 * - Optional ctx.web provider registration so the built-in web_search /
 *   web_fetch tools can route through this plugin.
 *
 * @module web-search-pro
 */

import type { Context } from '@deepseek-ai/cordis'
import fs from 'node:fs'
import path from 'node:path'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-web'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { Config, resolveConfig, type ResolvedConfig } from './config.ts'
import { Store } from './store.ts'
import type { BrowserService } from './browser-service.ts'
import { SearchRouter } from './router.ts'
import { FetchService } from './fetch.ts'
import { registerTools } from './tools.ts'

export const name = 'web-search-pro'
export const inject = ['tools', 'systemPrompt', 'browser']

export { Config }
export type { Config as WebSearchProConfig } from './config.ts'
export { ExaClient } from './exa-client.ts'
export type { ExaSearchRequest, ExaSearchType, ExaResult } from './exa-client.ts'
export { BackendRegistry } from './backend-registry.ts'
export type { Backend, BackendDiagnostic, BackendProbe } from './backend-registry.ts'

const TOOL_NAMES = [
  'web_search_pro', 'web_exa_contents', 'web_fetch_pro', 'web_platform_search', 'web_snapshot',
  'web_history', 'web_cache_clear', 'web_rule', 'web_search_stats', 'web_backend_status', 'web_deps',
]

export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = resolveConfig(config)
  const dbPath = resolved.dbPath
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  // 1. Persistent store (closed on plugin unload).
  const store = new Store(dbPath)
  ctx.effect(() => () => store.close())

  // 2. Browser service (provided by dsh-browser; inject: ['browser']).
  const browser = ctx.get('browser') as BrowserService

  // 3. Hot-reloadable config source: while a settings service exists, the
  //    $DSH_HOME/settings.yaml `web-search-pro:` section (validated against the
  //    same schema) overlays this composition entry and every operation re-reads
  //    it — edit keys/engines in the file without touching cordis.yml.
  //    installSettingsSection: 官方可选 settings 消费者接线（base=插件配置，
  //    用户段落热重载；settings 服务缺席时回退到插件配置）。
  // Stable accessor over a mutable source ref: installSettingsSection swaps
  // the source thunk on settings attach/detach, while router/fetch/tools all
  // hold the SAME stable `dynamic` closure that dereferences it per call —
  // so hot-reloaded sections reach every consumer.
  let resolveSource: () => ResolvedConfig = () => resolved
  const dynamic = (): ResolvedConfig => resolveSource()
  installSettingsSection(ctx, settingsNamespace('web-search-pro'), Config, resolved, {
    setSource: (current) => { resolveSource = () => current() as ResolvedConfig },
    onChange: () => {},
  })

  // 4. Services.
  const router = new SearchRouter(ctx, resolved, store, dynamic, browser)
  const fetchSvc = new FetchService(store, dynamic, browser)

  // 5. Tools.
  registerTools({ ctx, config: resolved, dynamic, store, router, fetch: fetchSvc, browser })

  // 5. Optional ctx.web provider registration: the built-in web_search /
  //    web_fetch tools route through this plugin when configured via
  //    DSH_WEB_SEARCH_PROVIDER=web-search-pro (or the web row's
  //    searchProvider). Registration is idempotent per fiber (effect-scoped).
  const web = ctx.get('web')
  if (web && resolved.registerProvider) {
    web.registerSearchProvider({
      id: resolved.providerId,
      available: () => router.anyEngineAvailable(),
      search: (request, signal) => router.searchAsProvider(request, signal),
    })
    web.registerFetchProvider({
      id: resolved.providerId,
      available: () => true,
      fetch: async (request, signal) => {
        const out = await fetchSvc.fetchPage(request.url, {
          mode: 'auto',
          signal,
          maxChars: 200_000,
          fresh: false,
          persist: true,
        })
        return {
          url: out.url,
          statusCode: out.statusCode ?? 200,
          body: { kind: 'text', content: out.text },
          truncated: false,
        }
      },
    })
  }

  // 6. System prompt guidance.
  ctx.systemPrompt.section({
    name: 'tool:web-search-pro',
    order: 112,
    text: 'For web research prefer the persistent enhanced tools: web_search_pro (multi-engine search with caching and history), web_platform_search (GitHub/B站/YouTube/V2EX/小红书/Twitter/Reddit/RSS/知乎/微博/豆瓣/贴吧/抖音/快手…), web_fetch_pro (readable extraction with per-site rules), and web_snapshot (headless-browser capture). Cite relevant URLs as markdown links. The browser runtime bundles Playwright + Chromium and OpenCLI. Use browser_open/browser_click/browser_type/browser_scroll/browser_read/browser_screenshot for interactive browsing; use browser_recipe_run for bounded model-generated multi-step operations; inspect browser_script_catalog before a built-in extractor; validate external UserScripts with browser_script_validate before browser_userscript_run. External UserScripts, mutating recipes, and general browser_opencli_run commands require native one-shot approval. Prefer OpenCLI site adapters, then browser network/extract primitives, then DOM interaction; browser_opencli_status diagnoses the Chrome bridge. Before relying on remaining external CLI backends (bili/yt-dlp/agent-reach), run web_deps action=check. Chinese communities need a named, domain-scoped dsh-browser AuthProfile created from scripts/save-login.mjs and bound through browserBindings.',
  })

  // 7. Apply marker for diagnostics (proves live registration).
  if (resolved.verbose) {
    try {
      const markerPath = path.join(path.dirname(dbPath), 'apply.log')
      fs.appendFileSync(markerPath, JSON.stringify({
        ts: new Date().toISOString(),
        plugin: name,
        dbPath,
        tools: TOOL_NAMES,
        provider: resolved.registerProvider ? resolved.providerId : undefined,
        engines: resolved.engines,
        browser: 'injected',
      }) + '\n', 'utf8')
    } catch { /* marker is best-effort */ }
  }

  ctx.logger?.(name).info('web-search-pro loaded: db=' + dbPath + ' engines=[' + resolved.engines.join(',') + ']')
}
