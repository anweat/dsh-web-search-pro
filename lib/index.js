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
import { isLegacyBrowser, usableBrowser } from "./browser-access.js";
import { SearchRouter } from "./router.js";
import { FetchService } from "./fetch.js";
import { registerTools } from "./tools.js";
import { createFetchProvider, createSearchProvider, readProviderState } from "./provider.js";
import { EvidenceService } from "./pipeline/service.js";
import { buildPromptText } from "./prompt.js";
import { registerSkillWhenAvailable } from "./skill.js";
import { ACTIONS, findAction, flatToolName } from "./actions/registry.js";
import { automationModeOf, resolveWebCall, webPolicyDecision } from "./actions/approval.js";
export const name = 'web-search-pro';
// `browser` (dsh-browser) is deliberately NOT injected: Cordis 4.0.4 treats every
// `inject` entry as required (the fiber stays PENDING until it exists) and has no
// optional form. It is read per call with `ctx.get('browser')` instead.
export const inject = ['tools', 'systemPrompt'];
export { Config };
export { ExaClient } from "./exa-client.js";
export { BackendRegistry } from "./backend-registry.js";
export function apply(ctx, config) {
    const resolved = resolveConfig(config);
    const dbPath = resolved.dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    // 1. Persistent store (closed on plugin unload). On startup, purge search
    //    rows minted with an older cache-key version so stale titles-only ddg
    //    results saved before the snippet-regex fix are never replayed.
    const store = new Store(dbPath, { onDiagnostic: message => { try {
            ctx.logger(name).warn(message);
        }
        catch { /* logging is best-effort */ } } });
    try {
        const purged = store.cleanupLegacySearchCache('search:v' + SEARCH_CACHE_VERSION + ':');
        if (purged.queries > 0)
            ctx.logger(name).info('web-search-pro: purged ' + purged.queries + ' legacy search rows (' + purged.results + ' results) from cache-key v<=' + (SEARCH_CACHE_VERSION - 1));
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
    //    every consumer.
    const dynamic = () => resolveConfig(ctx.fiber.config);
    // 4. Services.
    const router = new SearchRouter(ctx, resolved, store, dynamic, getBrowser);
    ctx.effect(() => () => router.dispose());
    const fetchSvc = new FetchService(store, dynamic, getBrowser);
    // 5. Tools: `web_index` + `web_call` (or one tool per action with toolSurface=flat). The bundled
    //    `dsh-web-search-pro` skill is registered only when the Host has a skill registry. It must not be
    //    a declared `inject` (Cordis 4.0.4 would hang the plugin without it); without it the web_index
    //    root carries a compact guide instead.
    const skill = registerSkillWhenAvailable(ctx);
    //    One evidence service serves search.run and the ctx.web provider (it keeps no per-call state).
    const evidence = new EvidenceService({ router, fetch: fetchSvc, store, dynamic });
    const providerState = () => readProviderState({ web: ctx.get('web'), registered: providerRegistered, id: dynamic().providerId, evidence: dynamic().provider.evidence });
    registerTools({ ctx, config: resolved, dynamic, store, router, fetch: fetchSvc, browser: getBrowser, evidence, providerState, skillAvailable: skill.isAvailable });
    //    Approval is decided per ACTION: web_call (and each flat tool) is resolved to its action first, so the user
    //    is asked about `cache.clear` or `sources.install bili`, not about a generic dispatcher. The old tools were
    //    gated by name from dsh-browser's hook; that hook cannot see inside web_call, so the rules live here and
    //    read dsh-browser's automationMode when the service is present (see actions/approval.ts).
    ctx.on('tools/pre-execute', async (exec, next) => {
        const downstream = await next();
        if (downstream.kind !== 'allow')
            return downstream;
        const call = resolveWebCall(exec.name, exec.arguments);
        if (call?.kind !== 'action')
            return downstream;
        const action = findAction(call.action);
        if (!action || action.approval === 'none')
            return downstream;
        return webPolicyDecision(call.action, call.args, await automationModeOf(usableBrowser(getBrowser())));
    });
    // 5. Optional ctx.web provider registration (opt-in: `registerProvider`). The Host picks a provider only when the `web`
    //    entry pins its id (`searchProvider` / `fetchProvider`, or DSH_WEB_SEARCH_PROVIDER / DSH_WEB_FETCH_PROVIDER), or when it
    //    is the only usable one; two usable providers without a pin make every built-in web_search fail (WEB_PROVIDER_AMBIGUOUS),
    //    which is why registering is never the default. Once selected, the built-in web_search returns this plugin's evidence
    //    pack (`provider.evidence`) and web_fetch its budgeted pages. Registration is effect-scoped per fiber.
    const web = ctx.get('web');
    let providerRegistered = false;
    if (web && resolved.registerProvider) {
        web.registerSearchProvider(createSearchProvider({ router, evidence: () => evidence, dynamic, id: () => dynamic().providerId, surface: resolved.toolSurface }));
        web.registerFetchProvider(createFetchProvider({ fetch: fetchSvc, dynamic, id: () => dynamic().providerId, surface: resolved.toolSurface }));
        providerRegistered = true;
    }
    // 6. System prompt guidance; the text thunk runs at assembly time so the
    //    browser_* paragraph tracks the browser service's current presence.
    ctx.systemPrompt.section({
        name: 'tool:web-search-pro',
        order: 112,
        text: () => buildPromptText(usableBrowser(getBrowser()) !== undefined),
    });
    // 7. Apply marker for diagnostics (proves live registration).
    if (resolved.verbose) {
        try {
            const markerPath = path.join(path.dirname(dbPath), 'apply.log');
            fs.appendFileSync(markerPath, JSON.stringify({
                ts: new Date().toISOString(),
                plugin: name,
                dbPath,
                toolSurface: resolved.toolSurface,
                tools: resolved.toolSurface === 'flat' ? ACTIONS.map(flatToolName) : ['web_index', 'web_call'],
                provider: resolved.registerProvider ? resolved.providerId : undefined,
                engines: resolved.engines,
                browser: getBrowser() === undefined ? 'absent' : isLegacyBrowser(getBrowser()) ? 'legacy' : 'present',
            }) + '\n', 'utf8');
        }
        catch { /* marker is best-effort */ }
    }
    ctx.logger(name).info('web-search-pro loaded: db=' + dbPath + ' engines=[' + resolved.engines.join(',') + ']');
}
// The loader unwraps `default` before reading Config. A named export alone
// leaves the rc.2 entry without a schema-derived configuration form.
export default { name, inject, Config, apply };
//# sourceMappingURL=index.js.map