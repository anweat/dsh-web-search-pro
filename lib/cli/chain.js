/**
 * Platform backend chains (dev-plan M12): every platform provider resolves an ORDERED chain of backends - a standalone CLI
 * spec (xhs, rdt, zhihu, twitter, bili, yt-dlp, omnireach, gh, ...), the standalone OpenCLI (`opencli`), the dsh-browser
 * OpenCLI bridge (`browser-opencli`), dsh-browser's rendered search page (`browser-search`), or the plugin's REST client
 * (`rest`). The order is configurable (`platformBackends`). A backend that is missing, incompatible or not logged in is
 * skipped with its reason; the provider is unavailable only when the whole chain is, and its error names what to install
 * or run. Readiness is local: no search, no login.
 * @module web-search-pro/cli/chain
 */
import { githubCodeEngine, githubEngine, githubIssuesEngine, opencliEngine, playwrightPlatformEngine, } from "../engines.js";
import { browserGap } from "../browser-access.js";
import { BUILTIN_CLI_SPECS } from "./builtin-specs.js";
import { backendServes, CHAIN_PLATFORMS, DEFAULT_CHAINS, OPENCLI_SITE_OF } from "./chains-spec.js";
import { cliSpecEngine, disabledBySettings, probeError, specReadiness } from "./engine.js";
import { listOpencliSites, OPENCLI_PROBE, opencliSearchSpec } from "./opencli.js";
import { cachedProbe, probeCli } from "./probe.js";
import { CliAdapterError, runCliSearchDetailed } from "./runner.js";
import { resolveCliAdapters } from "./spec.js";
export { DEFAULT_CHAINS, CHAIN_PLATFORMS };
/** All specs a chain may use: the built-ins by id and the user's `cliAdapters` as `custom-cli:<id>`. */
export function allSpecs(config) {
    const specs = new Map(BUILTIN_CLI_SPECS.map(spec => [spec.id, spec]));
    const user = resolveCliAdapters(config.cliAdapters);
    for (const [id, spec] of user.specs)
        specs.set('custom-cli:' + id, spec);
    return { specs, diagnostics: user.diagnostics };
}
const fromSpec = (r) => ({
    ready: r.ready, installation: r.installation, ...r.version ? { version: r.version } : {}, ...r.credential ? { credential: r.credential } : {}, ...r.reason ? { reason: r.reason } : {},
    ...r.code !== 'ok' ? { code: r.code } : {},
});
function specLeg(id, spec, platform, ctx) {
    return {
        id, kind: id.startsWith('custom-cli:') ? 'custom-cli' : 'cli', label: spec.bins[0],
        engine: cliSpecEngine(spec, platform, ctx.deps, { id, label: spec.bins[0] }),
        readiness: async () => fromSpec(await specReadiness(spec, ctx.deps)),
        verification: spec.verification?.status ?? 'unverified',
    };
}
function opencliLeg(platform, ctx) {
    const site = OPENCLI_SITE_OF[platform];
    const engine = {
        id: 'opencli',
        backend: 'opencli',
        label: 'OpenCLI (standalone)',
        available: () => !disabledBySettings({ id: 'opencli' }, ctx.deps) && (cachedProbe(OPENCLI_PROBE)?.state ?? 'detected') === 'detected',
        async search(query, count, signal) {
            const off = disabledBySettings({ id: 'opencli' }, ctx.deps);
            if (off)
                throw new CliAdapterError(off, 'CLI_NOT_FOUND');
            const probe = await probeCli(OPENCLI_PROBE);
            const failure = probe.state === 'detected' ? undefined : probeError(OPENCLI_PROBE, probe);
            if (failure)
                throw failure;
            const listed = await listOpencliSites();
            const entry = listed.sites?.get(site);
            if (!entry)
                throw new CliAdapterError(listed.problem ?? 'opencli has no read `search` command for the site ' + site + ' (opencli list)', 'CLI_CONTRACT_MISMATCH', 'run `opencli list` to see the sites your version supports');
            const spec = opencliSearchSpec(platform, entry);
            if (!spec)
                throw new CliAdapterError('opencli site ' + site + ' cannot be used by this adapter', 'CLI_CONTRACT_MISMATCH');
            const { sources, skipped } = await runCliSearchDetailed(spec, { query, count, signal }, { platform, bin: probe.path ?? 'opencli' });
            return { sources, via: 'opencli', backend: 'opencli', ...skipped ? { notes: [skipped + ' result' + (skipped === 1 ? '' : 's') + ' without a link skipped'] } : {} };
        },
    };
    return {
        id: 'opencli', kind: 'opencli', label: 'OpenCLI (standalone)', engine, verification: 'contract-only',
        async readiness() {
            const off = disabledBySettings({ id: 'opencli' }, ctx.deps);
            if (off)
                return { ready: false, installation: 'missing', reason: 'opencli: ' + off, code: 'disabled' };
            const probe = await probeCli(OPENCLI_PROBE);
            if (probe.state !== 'detected')
                return { ready: false, installation: probe.state, ...probe.version ? { version: probe.version } : {}, reason: 'opencli: ' + (probe.reason ?? 'not installed') + (probe.state === 'missing' ? '' : ''), code: probe.state === 'missing' ? 'cli_missing' : 'cli_incompatible' };
            const listed = await listOpencliSites();
            const entry = listed.sites?.get(site);
            if (!entry)
                return { ready: false, installation: 'detected', ...probe.version ? { version: probe.version } : {}, reason: 'opencli: ' + (listed.problem ?? 'no read `search` command for the site ' + site + ' in `opencli list`'), code: 'unsupported' };
            return { ready: true, installation: 'detected', ...probe.version ? { version: probe.version } : {}, ...entry.strategy === 'public' ? { credential: 'not_required' } : {} };
        },
    };
}
function browserOpencliLeg(platform, ctx) {
    const engine = { ...opencliEngine(platform, ctx.deps), backend: 'browser-opencli' };
    return {
        id: 'browser-opencli', kind: 'browser-opencli', label: 'dsh-browser OpenCLI', engine, verification: 'unverified',
        async readiness() {
            const gap = browserGap(ctx.deps.browser, 'opencli', 'platform ' + platform);
            const off = !ctx.deps.enableCli ? 'CLI backends are disabled in settings (enableCliBackends)' : !ctx.deps.opencliEnabled ? 'the OpenCLI backend is disabled in settings (opencliEnabled)' : undefined;
            const reason = gap ?? off;
            const installation = !ctx.deps.browser ? 'missing' : gap ? 'incompatible' : 'detected';
            return reason ? { ready: false, installation, reason: 'browser-opencli: ' + reason, code: gap ? 'browser_missing' : 'disabled' } : { ready: true, installation };
        },
    };
}
function browserSearchLeg(platform, ctx) {
    const engine = { ...playwrightPlatformEngine(platform, ctx.deps), backend: 'browser-search' };
    return {
        id: 'browser-search', kind: 'browser-search', label: 'dsh-browser search page', engine, verification: 'unverified',
        async readiness() {
            const gap = browserGap(ctx.deps.browser, 'searchResults', 'platform ' + platform);
            const bound = ctx.config.browserBindings?.[platform]?.authProfile;
            return gap
                ? { ready: false, installation: !ctx.deps.browser ? 'missing' : 'incompatible', ...bound ? { credential: 'configured' } : {}, reason: 'browser-search: ' + gap, code: 'browser_missing' }
                : { ready: true, installation: 'detected', ...bound ? { credential: 'configured' } : {} };
        },
    };
}
const REST_ENGINES = { github: githubEngine, 'github-issues': githubIssuesEngine, 'github-code': githubCodeEngine };
function restLeg(platform, ctx) {
    const engine = { ...REST_ENGINES[platform](ctx.deps), backend: 'rest' };
    return {
        id: 'rest', kind: 'rest', label: 'GitHub REST API', engine, verification: 'live',
        async readiness() {
            const ready = engine.available();
            return ready
                ? { ready, installation: 'not_required', credential: (ctx.deps.githubToken?.length ?? 0) > 0 ? 'configured' : 'not_required' }
                : { ready, installation: 'not_required', credential: 'missing', reason: 'rest: GitHub code search requires authentication: set $GITHUB_TOKEN (or config githubToken)', code: 'not_logged_in' };
        },
    };
}
/** The chain of one platform: the configured (`platformBackends`) or default order, each id turned into a leg or into a diagnostic. */
export function resolveChain(platform, ctx) {
    const { specs } = allSpecs(ctx.config);
    const configured = ctx.config.platformBackends?.[platform];
    const ids = configured ?? DEFAULT_CHAINS[platform] ?? (platform.startsWith('custom-cli:') ? [platform] : []);
    const legs = [];
    const diagnostics = [];
    const skip = (id, why) => { diagnostics.push('platformBackends.' + platform + ': "' + id + '" ' + why); };
    const serving = new Map([...specs].map(([id, spec]) => [id, spec.platforms]));
    for (const id of ids) {
        if (legs.some(leg => leg.id === id))
            continue;
        const served = backendServes(id, platform, serving);
        if (!served.ok) {
            skip(id, served.why ?? 'cannot serve this platform');
            continue;
        }
        if (id === 'opencli')
            legs.push(opencliLeg(platform, ctx));
        else if (id === 'browser-opencli')
            legs.push(browserOpencliLeg(platform, ctx));
        else if (id === 'browser-search')
            legs.push(browserSearchLeg(platform, ctx));
        else if (id === 'rest')
            legs.push(restLeg(platform, ctx));
        else
            legs.push(specLeg(id, specs.get(id), platform, ctx));
    }
    return { legs, diagnostics };
}
/** The credential state a chain reports: its first ready leg's; else `configured` when any leg has one (a binding counts), else `missing` when a leg lacks one. */
function credentialOf(ready, all) {
    if (ready)
        return ready;
    return all.includes('configured') ? 'configured' : all.includes('missing') ? 'missing' : undefined;
}
/** Local readiness of a whole chain (one probe per leg, cached). */
export async function chainReport(platform, ctx) {
    const { legs, diagnostics } = resolveChain(platform, ctx);
    const checked = await Promise.all(legs.map(async (leg) => ({ leg, r: await leg.readiness().catch((error) => ({ ready: false, installation: 'missing', reason: leg.id + ': ' + (error instanceof Error ? error.message : String(error)), code: 'unsupported' })) })));
    const entries = checked.map(({ leg, r }, index) => ({
        id: leg.id, kind: leg.kind, label: leg.label, order: index + 1, state: r.ready ? 'ready' : 'skipped', installation: r.installation,
        ...r.version ? { version: r.version } : {}, ...r.credential ? { credential: r.credential } : {}, ...r.reason ? { reason: r.reason } : {}, verification: leg.verification,
    }));
    const firstReady = checked.find(c => c.r.ready);
    const rank = { detected: 3, incompatible: 2, not_required: 3, missing: 1 };
    const best = checked.map(c => c.r).sort((a, b) => rank[b.installation] - rank[a.installation])[0];
    const credentials = checked.map(c => c.r.credential);
    const skipped = checked.filter(c => !c.r.ready);
    const confirmed = checked.find(c => c.r.ready && (c.r.credential === 'configured' || c.r.credential === 'not_required'));
    const state = confirmed ? 'ready' : firstReady ? 'login_unverified' : skipped.some(c => c.r.credential === 'missing') ? 'needs_login' : 'unavailable';
    const unverified = checked.filter(c => c.r.ready && c.r.credential === undefined);
    return {
        entries,
        available: !!firstReady,
        state,
        installation: firstReady ? firstReady.r.installation : best?.installation ?? 'missing',
        ...credentialOf(firstReady?.r.credential, credentials) ? { credential: credentialOf(firstReady?.r.credential, credentials) } : {},
        ...!firstReady ? {
            reason: legs.length
                ? 'no usable backend: ' + skipped.map(c => c.r.reason ?? c.leg.id + ' unavailable').join('; ')
                : 'no usable backend: ' + (diagnostics.join('; ') || 'the chain is empty'),
            diagnosticCode: skipped[0]?.r.code ?? 'no_backend',
        } : {
            ...state === 'login_unverified' ? { reason: 'login not verified: ' + unverified.map(c => c.leg.id).join(', ') + ' will use your own session, which cannot be checked locally' + (skipped.length ? '; skipped: ' + skipped.map(c => c.r.reason ?? c.leg.id + ' unavailable').join('; ') : '') } : {},
            diagnosticCode: ['browser-opencli', 'browser-search', 'opencli'].includes(firstReady.leg.kind) || (firstReady.r.credential === undefined && firstReady.leg.kind !== 'rest') ? 'login_unverified' : 'ok',
        },
        diagnostics,
    };
}
//# sourceMappingURL=chain.js.map