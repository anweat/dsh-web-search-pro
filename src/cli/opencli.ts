/**
 * Standalone OpenCLI (dev-plan M12): the `opencli` command the user installed themselves, which drives their own Chrome
 * through its Browser Bridge, independent of the dsh-browser plugin. It has one command per site and the plugin only
 * calls `<site> search`, and only for sites that `opencli list -f json` itself reports with a read-access `search`
 * command taking a positional query (the catalog is the tool's own, so a site without search, such as douyin or v2ex,
 * is never assumed to have one). The list is a local call: no browser, no login.
 * @module web-search-pro/cli/opencli
 */

import { runCli } from '../util.ts'
import { buildCliEnv } from './runner.ts'
import { probeCli, resolveBin, type ProbeSubject } from './probe.ts'
import { withPathPrefix } from './opencli-locate.ts'
import { validateCliAdapterSpec, type CliAdapterSpec, type CliErrorCodesSpec } from './spec.ts'
import { GENERIC_OUTPUT, opencliSiteVerification, SITE_OUTPUT } from './opencli-sites.ts'
export { OPENCLI_SITE_OF } from './chains-spec.ts'
export { opencliSiteVerification }

/**
 * The OpenCLI versions this adapter supports: 1.8.0 up to, not including, 3.0.0 (1.8 and 2.x). The tested surfaces are 1.8.8 (searches
 * run on the user's Chrome for twitter and zhihu, the failure shapes measured) and 2.0.3 (the `list`, `<site> search --help -f json`,
 * `--version` and pre-browser failure shapes run for real, 2026-11-25; NO site command was run: a 2.x CLI stops the running 1.8.8
 * daemon, so the success and login-failure shapes of 2.x are pinned by constructed fixtures that follow its source). A 3.x was never
 * looked at, so it is reported `incompatible` with the command that installs a supported version, and the chain moves on.
 */
export const OPENCLI_MIN_VERSION = '1.8.0'
export const OPENCLI_MAX_VERSION = '3.0.0'
export const OPENCLI_SUPPORTED_INSTALL = 'npm i -g @jackwener/opencli@2'
export const OPENCLI_TESTED_VERSIONS = { '1.8': '1.8.8', '2.x': '2.0.3' } as const

/** The command that proves this is the OpenCLI the adapter understands (`list --help` offers `--format` with json): the same on 1.8.8 and 2.0.3. */
export const OPENCLI_PROBE: ProbeSubject = {
  id: 'opencli',
  bins: ['opencli'],
  packageNote: 'OpenCLI (npm i -g @jackwener/opencli@2, or 1.8.x; needs its Browser Bridge extension in your own Chrome)',
  probe: { versionArgs: ['--version'], minVersion: OPENCLI_MIN_VERSION, maxVersion: OPENCLI_MAX_VERSION, maxVersionHint: OPENCLI_SUPPORTED_INSTALL, helpArgs: ['list', '--help'], mustContain: ['--format', 'json'] },
  env: {},
}

/**
 * The browser options every browser-backed site command of OpenCLI accepts (read from `opencli <site> search --help` and
 * dist/src/execution.js of 1.8.8): the command runs in a background window (no focus is taken from the user's Chrome), with an
 * ephemeral site session whose tab is released when it finishes. These are also its defaults; the plugin passes them
 * explicitly so a changed `OPENCLI_WINDOW` / `OPENCLI_SITE_SESSION` environment cannot bring a window to the front, and only
 * when the command itself lists the three options (a command without a browser rejects unknown options).
 */
export const OPENCLI_SILENT_ARGS: readonly string[] = ['--window', 'background', '--site-session', 'ephemeral', '--keep-tab', 'false']
const SILENT_OPTIONS = ['--window', '--site-session', '--keep-tab'] as const

/**
 * The text probe of one site's search command: it must list the three silent browser options (`opencli <site> search --help`).
 * Only the FALLBACK for an OpenCLI whose `search --help -f json` is not JSON (an older 1.8.x); the JSON help carries the same
 * options and replaces this probe ({@link discoverOpencliSite}). Local, cached, no browser.
 */
export function opencliSiteProbe(site: string): ProbeSubject {
  return {
    id: 'opencli:' + site,
    bins: ['opencli'],
    packageNote: OPENCLI_PROBE.packageNote,
    probe: { versionArgs: ['--version'], minVersion: OPENCLI_MIN_VERSION, maxVersion: OPENCLI_MAX_VERSION, maxVersionHint: OPENCLI_SUPPORTED_INSTALL, helpArgs: [site, 'search', '--help'], mustContain: [...SILENT_OPTIONS] },
    env: {},
  }
}

export interface OpencliSite {
  site: string
  /** `cookie` sites use the user's logged-in Chrome; `public` sites need no login. */
  strategy: string
  /** Whether the command drives the browser at all. */
  browser: boolean
  hasLimit: boolean
  /** The site's domain as the command table gives it (`www.zhihu.com`), for the "log in to ..." hint. */
  domain?: string
  /** Whether the command lists `--window`, `--site-session` and `--keep-tab` (known from the JSON help; unset when it came from `list`, which does not say). */
  silent?: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

interface ListEntry { site?: unknown; name?: unknown; access?: unknown; strategy?: unknown; browser?: unknown; args?: unknown; domain?: unknown }

/**
 * Sites with a read `search` command taking a positional query, from the JSON of `opencli list -f json`. Pure.
 *
 * Only a 1.8.x list says enough: a bare array whose rows carry `args`, `strategy`, `browser`. A 2.x list is a paged object
 * (`{ ok, data: { commands, total, nextOffset } }`, 25 rows a page, rows with only command / description / access): it is read
 * without error but yields NO site, because without the argument details a positional query cannot be told from a flag. So the list
 * is the fallback for an old 1.8.x only; {@link discoverOpencliSite} (the JSON `search --help`) is the path that works on both.
 */
export function parseOpencliList(json: string): Map<string, OpencliSite> {
  let rows = JSON.parse(json) as unknown
  if (isRecord(rows) && rows.ok === true && isRecord(rows.data) && Array.isArray(rows.data.commands)) rows = rows.data.commands
  if (!Array.isArray(rows)) throw new Error('opencli list did not return an array')
  const sites = new Map<string, OpencliSite>()
  for (const row of rows as ListEntry[]) {
    if (!row || typeof row.site !== 'string' || row.name !== 'search' || row.access !== 'read' || !Array.isArray(row.args)) continue
    const args = row.args as { name?: unknown; positional?: unknown }[]
    if (!args.some(a => a.positional === true && a.name === 'query') && !args.some(a => a.positional === true)) continue
    sites.set(row.site, {
      site: row.site,
      strategy: typeof row.strategy === 'string' ? row.strategy : 'cookie',
      browser: row.browser === true,
      hasLimit: args.some(a => a.name === 'limit'),
      ...typeof row.domain === 'string' && row.domain ? { domain: row.domain } : {},
    })
  }
  return sites
}

const cache = new Map<string, { at: number; sites: Map<string, OpencliSite> }>()
export function clearOpencliCache(): void { cache.clear(); siteCache.clear(); siteFlights.clear() }

/** The searchable sites of the installed OpenCLI (cached 5 minutes); `undefined` when the command cannot be listed. */
export async function listOpencliSites(options: { run?: typeof runCli; ttlMs?: number; now?: () => number; force?: boolean } = {}): Promise<{ sites?: Map<string, OpencliSite>; problem?: string }> {
  // The same resolution as the probe and the search: PATH, then the usual global install places.
  const resolved = resolveBin('opencli')
  const found = resolved.path
  if (!found) return { problem: resolved.problem ?? 'opencli not found on PATH or in the usual global install folders' }
  const now = options.now ?? Date.now
  const key = found + '\u0000' + (process.env.PATH ?? '')
  const hit = cache.get(key)
  if (!options.force && hit && now() - hit.at <= (options.ttlMs ?? 300_000)) return { sites: hit.sites }
  const run = options.run ?? runCli
  const res = await run(found, ['list', '-f', 'json'], { timeoutMs: 20_000, signal: undefined, env: withPathPrefix(buildCliEnv({ env: {} }), resolved.pathPrefix), cleanEnv: true, maxOutput: 16 * 1024 * 1024, outputEncoding: 'utf-8' })
  if (res.code !== 0 || res.truncated) return { problem: res.truncated ? 'opencli list output exceeded the size cap' : 'opencli list failed with exit ' + res.code }
  try {
    const sites = parseOpencliList(res.stdout)
    cache.set(key, { at: now(), sites })
    return { sites }
  } catch (error) {
    return { problem: 'opencli list returned an unexpected payload: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

// ── discovery of one site, without `list` ──────────────────────────────────

/** `opencli <site> search --help -f json` carries no strategy: these sites need no login (the 1.8.8 command table lists `weixin` and `hackernews` as `public`, every other site the plugin knows as `cookie`). */
export const OPENCLI_PUBLIC_SITES: readonly string[] = ['weixin', 'hackernews']

export interface SiteDiscovery {
  entry?: OpencliSite
  /** Why the site cannot be used (no search command, not a read command, no launcher). */
  problem?: string
  /** `unsupported`: the OpenCLI answered and has no usable search command for the site (as opposed to not being runnable at all). */
  unsupported?: boolean
  /** The help call itself failed (it did not start, timed out, printed too much): asked again next time instead of being cached. */
  transient?: boolean
  hint?: string
}

/**
 * Read one site's `search --help -f json` (the same fields on 1.8.8 and 2.0.3: access, browser, domain, positionals, command_options,
 * browser_common_options, columns). `notJson` is an OpenCLI that does not print JSON help (an older 1.8.x): the caller falls back to `list`.
 * A site without a search command prints a site overview (`{ site, commands: [...] }`), an unknown site the top-level help or a failure
 * envelope: all of them are `unsupported`. Pure.
 */
export function parseSiteSearchHelp(output: string, site: string): SiteDiscovery & { notJson?: true } {
  let value: unknown
  try { value = JSON.parse(output.trim()) } catch { return { notJson: true } }
  if (!isRecord(value)) return { notJson: true }
  const none = (why: string): SiteDiscovery => ({ unsupported: true, problem: 'opencli has no usable `search` command for the site ' + site + ' (' + why + ')', hint: 'run `opencli ' + site + ' --help` to see what that site offers in your version' })
  if (value.ok === false) return none(isRecord(value.error) && typeof value.error.message === 'string' ? value.error.message.slice(0, 120) : 'unknown site')
  if (Array.isArray(value.commands) && value.access === undefined) return none('the site lists no search command')
  if (value.access !== 'read') return none('its search command is `' + String(value.access) + '`, not a read command')
  const positionals = Array.isArray(value.positionals) ? value.positionals as { positional?: unknown }[] : []
  if (!positionals.some(p => p?.positional === true)) return none('it takes no positional query')
  const options = Array.isArray(value.command_options) ? value.command_options as { name?: unknown }[] : []
  const common = Array.isArray(value.browser_common_options) ? (value.browser_common_options as { name?: unknown }[]).map(o => o?.name) : []
  return {
    entry: {
      site,
      strategy: OPENCLI_PUBLIC_SITES.includes(site) ? 'public' : 'cookie',
      browser: value.browser === true,
      hasLimit: options.some(o => o?.name === 'limit'),
      silent: ['window', 'site-session', 'keep-tab'].every(name => common.includes(name)),
      ...typeof value.domain === 'string' && value.domain ? { domain: value.domain } : {},
    },
  }
}

const SITE_TTL_MS = 300_000
const MAX_DISCOVERY_PROCESSES = 3
const siteCache = new Map<string, { at: number; result: SiteDiscovery }>()
const siteFlights = new Map<string, Promise<SiteDiscovery>>()
let discoveryActive = 0
const discoveryQueue: (() => void)[] = []

/** At most a few `opencli` help processes at once (sources.status asks about a dozen sites in one go). */
async function boundedDiscovery<T>(task: () => Promise<T>): Promise<T> {
  if (discoveryActive >= MAX_DISCOVERY_PROCESSES) await new Promise<void>(resolve => discoveryQueue.push(resolve))
  discoveryActive++
  try { return await task() } finally {
    discoveryActive--
    discoveryQueue.shift()?.()
  }
}

export interface DiscoverOptions { run?: typeof runCli; now?: () => number; force?: boolean; version?: string | undefined }

/**
 * Whether the installed OpenCLI can search one site, and how: ONE local help call (no browser, no login), cached 5 minutes per
 * (launcher, version, site), concurrent calls share the run, at most {@link MAX_DISCOVERY_PROCESSES} run at a time. An OpenCLI whose
 * help is not JSON falls back to the `list` table and the text probe of the site's `--help`.
 */
export async function discoverOpencliSite(site: string, options: DiscoverOptions = {}): Promise<SiteDiscovery> {
  const resolved = resolveBin('opencli')
  if (!resolved.path) return { problem: resolved.problem ?? 'opencli not found on PATH or in the usual global install folders' }
  const now = options.now ?? Date.now
  const key = [resolved.path, options.version ?? '', site, process.env.PATH ?? ''].join('\u0000')
  if (!options.force) {
    const hit = siteCache.get(key)
    if (hit && now() - hit.at <= SITE_TTL_MS) return hit.result
    const flight = siteFlights.get(key)
    if (flight) return flight
  }
  const run = options.run ?? runCli
  const launcher = resolved.path
  const env = withPathPrefix(buildCliEnv({ env: {} }), resolved.pathPrefix)
  const flight = boundedDiscovery(async (): Promise<SiteDiscovery> => {
    const res = await run(launcher, [site, 'search', '--help', '-f', 'json'], { timeoutMs: 20_000, signal: undefined, env, cleanEnv: true, maxOutput: 2 * 1024 * 1024, outputEncoding: 'utf-8' })
    // The call itself did not work (start, time, size): that says nothing about the site. Not a verdict, not cached, and no `list` fallback (a 2.x list names no site).
    if (res.spawnFailed || res.timedOut || res.truncated) return { problem: 'opencli ' + site + ' search --help ' + (res.timedOut ? 'timed out' : res.truncated ? 'printed too much' : 'could not be started'), transient: true }
    const parsed = parseSiteSearchHelp(res.stdout, site)
    if (!parsed.notJson) return parsed
    // Not JSON: an older 1.8.x. Its `list` table has what the JSON help would say; the silent options come from the text help.
    const listed = await listOpencliSites({ run, force: options.force })
    const entry = listed.sites?.get(site)
    if (!entry) return { unsupported: !!listed.sites, problem: listed.problem ?? 'opencli has no read `search` command for the site ' + site + ' (opencli list)', hint: 'run `opencli list` to see the sites your version supports' }
    const silent = entry.browser && (await probeCli(opencliSiteProbe(site), { ...options.run ? { run: options.run } : {} })).state === 'detected'
    return { entry: { ...entry, silent } }
  }).then(result => { if (!result.transient) siteCache.set(key, { at: now(), result }); return result }).finally(() => { if (siteFlights.get(key) === flight) siteFlights.delete(key) })
  siteFlights.set(key, flight)
  return flight
}

/**
 * The failure format of OpenCLI: 1.8.8 prints `ok: false` / `error: { code, message, help?, exitCode }` as YAML on stderr whatever `-f`
 * says (dist/src/errors.js `toEnvelope`); 2.x prints the same envelope as ONE JSON line on stdout (measured on 2.0.3 for the failures that
 * happen before any browser work; the others follow its source). The runner reads both, and an `ok: false` envelope on stdout counts as a
 * failure even with exit code 0. Codes, from that file and the site adapters:
 *  - AUTH_REQUIRED (exit 77): the Chrome has no login for the site -> not logged in (measured on xiaohongshu);
 *  - SECURITY_BLOCK (2.x gives Reddit's block its own code and says it is not an expired login; xiaohongshu uses it for request-frequency
 *    controls): the site's risk control -> CLI_FAILED, not retryable, kept apart from the login wall below;
 *  - LOGIN_WALL (77), RATE_LIMITED, FORBIDDEN: an HTML page where JSON was expected, a block -> blocked;
 *    UNKNOWN with a JSON parse error on an HTML body (`Unexpected token '<'`) is the same thing from an adapter that does not
 *    check (measured on reddit through a proxy);
 *  - EMPTY_RESULT (66), NO_DATA, EMPTY_RESPONSE: nothing found; NOT_FOUND: the same from adapters that throw it for zero results (weibo
 *    search; read from the 1.8.8 source, so an unlogged weibo page, which shows no cards either, reads as empty too); BROWSER_CONNECT (69): no
 *    Chrome / bridge; TIMEOUT (75); SESSION_BUSY (also 75, errors.js `SessionBusyError`): another opencli process holds the site's browser
 *    session. The two share an exit code, so they are told apart by their code only: a busy session is retryable and says it is not a login problem;
 *  - ARGUMENT, INVALID_ARGUMENT, ... and, in 2.x, `usage_error`, `unknown_command` and every `commander.*` (the argument parser's own failures):
 *    the arguments of this adapter are not accepted by that version -> CLI_CONTRACT_MISMATCH, not retryable.
 * Anything else (COMMAND_EXEC, FETCH_ERROR, HTTP_ERROR, ...) keeps OpenCLI's own message.
 */
export const OPENCLI_ERROR_CODES: CliErrorCodesSpec = {
  codePath: 'error.code',
  messagePath: 'error.message',
  notLoggedIn: ['AUTH_REQUIRED'],
  notLoggedInExit: [77],
  usageExit: [2],
  riskControl: ['SECURITY_BLOCK'],
  blocked: ['LOGIN_WALL', 'RATE_LIMITED', 'FORBIDDEN'],
  blockedPatterns: ["unexpected token '<'", 'is not valid json', '<!doctype', '<html', '<body'],
  empty: ['EMPTY_RESULT', 'NO_DATA', 'EMPTY_RESPONSE', 'NOT_FOUND'],
  unavailable: ['BROWSER_CONNECT'],
  busy: ['SESSION_BUSY'],
  timeout: ['TIMEOUT'],
  usage: ['ARGUMENT', 'INVALID_ARGUMENT', 'INVALID_ARG', 'INVALID_ARGS', 'INVALID_INPUT', 'usage_error', 'unknown_command'],
  usagePrefixes: ['commander.'],
}

const NOT_LOGGED_IN = ['not logged in', 'login required', 'please log in', 'please login', 'sign in', 'auth_required', 'requires login', '未登录', '请先登录']

/** The spec that runs `opencli <site> search` for one platform, or undefined when the generated spec is invalid (a site named like a write command). */
export function opencliSearchSpec(platform: string, entry: OpencliSite, options: { silent?: boolean } = {}): CliAdapterSpec | undefined {
  const spec: CliAdapterSpec = {
    id: 'opencli',
    bins: ['opencli'],
    packageNote: OPENCLI_PROBE.packageNote,
    platforms: [platform],
    probe: OPENCLI_PROBE.probe,
    allowedSubcommands: ['list', entry.site, 'search'],
    search: {
      argv: [entry.site, 'search', '{query}', ...entry.hasLimit ? ['--limit', '{count}'] : [], '-f', 'json', ...entry.browser && options.silent ? OPENCLI_SILENT_ARGS : []],
      maxCount: 20,
      output: SITE_OUTPUT[entry.site] ?? GENERIC_OUTPUT,
      notLoggedInPatterns: NOT_LOGGED_IN,
      errorCodes: OPENCLI_ERROR_CODES,
    },
    env: {},
    needsLogin: entry.strategy !== 'public',
    // The login is the one of the user's own Chrome; the plugin never suggests a login command for it.
    ...entry.strategy !== 'public' ? { login: { hint: '在你的 Chrome 里登录 ' + (entry.domain ?? entry.site) + ' 后重试（opencli 使用 Chrome 的登录态）' } } : {},
    timeoutMs: 60_000,
    maxOutputBytes: 8 * 1024 * 1024,
    verification: opencliSiteVerification(entry.site),
  }
  return validateCliAdapterSpec(spec, 'builtin').ok ? spec : undefined
}

export interface OpencliSearchPlan { spec?: CliAdapterSpec; entry?: OpencliSite; problem?: string; hint?: string; silent: boolean }

/**
 * Everything a search of one platform through the standalone OpenCLI needs, checked locally (the command table and the site's
 * `--help -f json`, never a search): the site's entry, whether its command takes the silent browser options, and the generated spec.
 */
export async function planOpencliSearch(platform: string, site: string, version?: string): Promise<OpencliSearchPlan> {
  const found = await discoverOpencliSite(site, { version })
  const entry = found.entry
  if (!entry) return { silent: false, problem: found.problem ?? 'opencli has no read `search` command for the site ' + site, ...found.hint ? { hint: found.hint } : {} }
  const silent = entry.browser && entry.silent === true
  const spec = opencliSearchSpec(platform, entry, { silent })
  return spec ? { spec, entry, silent } : { entry, silent, problem: 'opencli site ' + site + ' cannot be used by this adapter' }
}
