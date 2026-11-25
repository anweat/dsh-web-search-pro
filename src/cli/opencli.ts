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
 * The OpenCLI versions this adapter was checked against: 1.8.0 up to, not including, 2.0.0. Verified on 1.8.8. A 2.x changes the
 * command surface, so it is reported `incompatible` (with the command that installs the tested version) and the chain falls
 * through to its next backend; the adapter is not adapted to it.
 */
export const OPENCLI_MIN_VERSION = '1.8.0'
export const OPENCLI_MAX_VERSION = '2.0.0'
export const OPENCLI_TESTED_INSTALL = 'npm i -g @jackwener/opencli@1.8.8'

/** The command that proves this is the OpenCLI whose `list` output the adapter understands. Verified on 1.8.8. */
export const OPENCLI_PROBE: ProbeSubject = {
  id: 'opencli',
  bins: ['opencli'],
  packageNote: 'OpenCLI (npm i -g @jackwener/opencli@1.8.8; needs its Browser Bridge extension in your own Chrome)',
  probe: { versionArgs: ['--version'], minVersion: OPENCLI_MIN_VERSION, maxVersion: OPENCLI_MAX_VERSION, maxVersionHint: OPENCLI_TESTED_INSTALL, helpArgs: ['list', '--help'], mustContain: ['--format', 'json'] },
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

/** The probe of one site's search command: it must list the three silent browser options (`opencli <site> search --help`). Local, cached, no browser. */
export function opencliSiteProbe(site: string): ProbeSubject {
  return {
    id: 'opencli:' + site,
    bins: ['opencli'],
    packageNote: OPENCLI_PROBE.packageNote,
    probe: { versionArgs: ['--version'], minVersion: OPENCLI_MIN_VERSION, maxVersion: OPENCLI_MAX_VERSION, maxVersionHint: OPENCLI_TESTED_INSTALL, helpArgs: [site, 'search', '--help'], mustContain: [...SILENT_OPTIONS] },
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
}

interface ListEntry { site?: unknown; name?: unknown; access?: unknown; strategy?: unknown; browser?: unknown; args?: unknown; domain?: unknown }

/** Sites with a read `search` command taking a positional query, from the JSON of `opencli list -f json`. Pure. */
export function parseOpencliList(json: string): Map<string, OpencliSite> {
  const rows = JSON.parse(json) as unknown
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
export function clearOpencliCache(): void { cache.clear() }

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

/**
 * The failure format of OpenCLI 1.8.8 (dist/src/errors.js `toEnvelope`, printed as YAML on stderr whatever `-f` says):
 * `ok: false` / `error: { code, message, help?, exitCode }`. Codes, from that file and the site adapters:
 *  - AUTH_REQUIRED (exit 77): the Chrome has no login for the site -> not logged in (measured on xiaohongshu);
 *  - LOGIN_WALL (77), SECURITY_BLOCK, RATE_LIMITED, FORBIDDEN: an HTML page where JSON was expected, a risk-control block -> blocked;
 *    UNKNOWN with a JSON parse error on an HTML body (`Unexpected token '<'`) is the same thing from an adapter that does not
 *    check (measured on reddit through a proxy);
 *  - EMPTY_RESULT (66), NO_DATA, EMPTY_RESPONSE: nothing found; NOT_FOUND: the same from adapters that throw it for zero results (weibo
 *    search; read from the 1.8.8 source, so an unlogged weibo page, which shows no cards either, reads as empty too); BROWSER_CONNECT (69): no
 *    Chrome / bridge; TIMEOUT (75); SESSION_BUSY (also 75, errors.js `SessionBusyError`): another opencli process holds the site's browser
 *    session. The two share an exit code, so they are told apart by their code only: a busy session is retryable and says it is not a login problem;
 *  - ARGUMENT, INVALID_ARGUMENT, ...: the arguments of this adapter are not accepted by that version.
 * Anything else (COMMAND_EXEC, FETCH_ERROR, HTTP_ERROR, ...) keeps OpenCLI's own message.
 */
export const OPENCLI_ERROR_CODES: CliErrorCodesSpec = {
  codePath: 'error.code',
  messagePath: 'error.message',
  notLoggedIn: ['AUTH_REQUIRED'],
  notLoggedInExit: [77],
  blocked: ['LOGIN_WALL', 'SECURITY_BLOCK', 'RATE_LIMITED', 'FORBIDDEN'],
  blockedPatterns: ["unexpected token '<'", 'is not valid json', '<!doctype', '<html', '<body'],
  empty: ['EMPTY_RESULT', 'NO_DATA', 'EMPTY_RESPONSE', 'NOT_FOUND'],
  unavailable: ['BROWSER_CONNECT'],
  busy: ['SESSION_BUSY'],
  timeout: ['TIMEOUT'],
  usage: ['ARGUMENT', 'INVALID_ARGUMENT', 'INVALID_ARG', 'INVALID_ARGS', 'INVALID_INPUT'],
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
 * `--help`, never a search): the site's entry, whether its command takes the silent browser options, and the generated spec.
 */
export async function planOpencliSearch(platform: string, site: string): Promise<OpencliSearchPlan> {
  const listed = await listOpencliSites()
  const entry = listed.sites?.get(site)
  if (!entry) return { silent: false, problem: listed.problem ?? 'opencli has no read `search` command for the site ' + site + ' (opencli list)', hint: 'run `opencli list` to see the sites your version supports' }
  const silent = entry.browser && (await probeCli(opencliSiteProbe(site))).state === 'detected'
  const spec = opencliSearchSpec(platform, entry, { silent })
  return spec ? { spec, entry, silent } : { entry, silent, problem: 'opencli site ' + site + ' cannot be used by this adapter' }
}
