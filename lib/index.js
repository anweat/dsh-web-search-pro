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
import fs from 'node:fs';
import path from 'node:path';
import { Config, resolveConfig } from "./config.js";
import { SEARCH_CACHE_VERSION } from "./cache-key.js";
import { Store } from "./store.js";
import { SearchRouter } from "./router.js";
import { FetchService } from "./fetch.js";
import { registerTools } from "./tools.js";
import { buildPromptText } from "./prompt.js";
export const name = 'web-search-pro';
// `browser` (dsh-browser) is deliberately NOT injected: Cordis 4.0.4 treats every
// `inject` entry as required (the fiber stays PENDING until it exists) and has no
// optional form. It is read per call with `ctx.get('browser')` instead.
export const inject = ['tools', 'systemPrompt'];
export { Config };
export { ExaClient } from "./exa-client.js";
export { BackendRegistry } from "./backend-registry.js";
const TOOL_NAMES = [
    'web_search_pro', 'web_exa_contents', 'web_fetch_pro', 'web_platform_search', 'web_snapshot',
    'web_history', 'web_cache_clear', 'web_rule', 'web_search_stats', 'web_backend_status', 'web_deps',
];
export function apply(ctx, config) {
    const resolved = resolveConfig(config);
    const dbPath = resolved.dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    // 1. Persistent store (closed on plugin unload). On startup, purge search
    //    rows minted with an older cache-key version so stale titles-only ddg
    //    results saved before the snippet-regex fix are never replayed.
    const store = new Store(dbPath, { onDiagnostic: message => { try {
            ctx.logger?.(name).warn(message);
        }
        catch { /* logging is best-effort */ } } });
    try {
        const purged = store.cleanupLegacySearchCache('search:v' + SEARCH_CACHE_VERSION + ':');
        if (purged.queries > 0)
            ctx.logger?.(name).info('web-search-pro: purged ' + purged.queries + ' legacy search rows (' + purged.results + ' results) from cache-key v<=' + (SEARCH_CACHE_VERSION - 1));
    }
    catch { /* non-fatal */ }
    ctx.effect(() => () => store.close());
    // 2. Browser service (provided by dsh-browser) is OPTIONAL and resolved lazily
    //    on every call: enabling/disabling dsh-browser after load is picked up
    //    (a host may still need a restart to load a newly installed plugin), and
    //    a removed service is never held on to. `ctx.get` returns undefined unless
    //    the providing fiber is active.
    const getBrowser = () => ctx.get('browser');
    // 3. Hot-reloadable config source. The plugin's Config schema marks live
    //    fields `volatile()` (schemastery), so the Host re-resolves this entry's
    //    config in place on every profile-patch edit and the fiber's `config`
    //    object reflects the new values without a remount. Every operation
    //    therefore reads through the SAME stable `dynamic` closure that
    //    dereferences the live config per call — hot-reloaded sections reach
    //    every consumer. (Hosts without volatile support keep the startup value.)
    const dynamic = () => resolveConfig(ctx.fiber.config);
    // 4. Services.
    const router = new SearchRouter(ctx, resolved, store, dynamic, getBrowser);
    const fetchSvc = new FetchService(store, dynamic, getBrowser);
    // 5. Tools.
    registerTools({ ctx, config: resolved, dynamic, store, router, fetch: fetchSvc, browser: getBrowser });
    // 5. Optional ctx.web provider registration: the built-in web_search /
    //    web_fetch tools route through this plugin when configured via
    //    DSH_WEB_SEARCH_PROVIDER=web-search-pro (or the web row's
    //    searchProvider). Registration is idempotent per fiber (effect-scoped).
    const web = ctx.get('web');
    if (web && resolved.registerProvider) {
        web.registerSearchProvider({
            id: resolved.providerId,
            available: () => router.anyEngineAvailable(),
            search: (request, signal) => router.searchAsProvider(request, signal),
        });
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
                });
                return {
                    url: out.url,
                    statusCode: out.statusCode ?? 200,
                    body: { kind: 'text', content: out.text },
                    truncated: out.truncated ?? false,
                };
            },
        });
    }
    // 6. System prompt guidance; the text thunk runs at assembly time so the
    //    browser_* paragraph tracks the browser service's current presence.
    ctx.systemPrompt.section({
        name: 'tool:web-search-pro',
        order: 112,
        text: () => buildPromptText(getBrowser() !== undefined),
    });
    // 7. Apply marker for diagnostics (proves live registration).
    if (resolved.verbose) {
        try {
            const markerPath = path.join(path.dirname(dbPath), 'apply.log');
            fs.appendFileSync(markerPath, JSON.stringify({
                ts: new Date().toISOString(),
                plugin: name,
                dbPath,
                tools: TOOL_NAMES,
                provider: resolved.registerProvider ? resolved.providerId : undefined,
                engines: resolved.engines,
                browser: getBrowser() ? 'present' : 'absent',
            }) + '\n', 'utf8');
        }
        catch { /* marker is best-effort */ }
    }
    ctx.logger?.(name).info('web-search-pro loaded: db=' + dbPath + ' engines=[' + resolved.engines.join(',') + ']');
}
// The loader unwraps `default` before reading Config. A named export alone
// leaves the rc.2 entry without a schema-derived configuration form.
export default { name, inject, Config, apply };
//# sourceMappingURL=index.js.map