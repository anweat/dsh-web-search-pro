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
import { findOnPath, type ProbeSubject } from './probe.ts'
import { validateCliAdapterSpec, type CliAdapterSpec } from './spec.ts'
export { OPENCLI_SITE_OF } from './chains-spec.ts'

/** The command that proves this is the OpenCLI whose `list` output the adapter understands. Verified on 1.8.8. */
export const OPENCLI_PROBE: ProbeSubject = {
  id: 'opencli',
  bins: ['opencli'],
  packageNote: 'OpenCLI (npm i -g @jackwener/opencli; needs its Browser Bridge extension in your own Chrome)',
  probe: { versionArgs: ['--version'], minVersion: '1.8.0', helpArgs: ['list', '--help'], mustContain: ['--format', 'json'] },
  env: {},
}

export interface OpencliSite {
  site: string
  /** `cookie` sites use the user's logged-in Chrome; `public` sites need no login. */
  strategy: string
  /** Whether the command drives the browser at all. */
  browser: boolean
  hasLimit: boolean
  loginCommand?: string
}

interface ListEntry { site?: unknown; name?: unknown; access?: unknown; strategy?: unknown; browser?: unknown; args?: unknown }

/** Sites with a read `search` command taking a positional query, from the JSON of `opencli list -f json`. Pure. */
export function parseOpencliList(json: string): Map<string, OpencliSite> {
  const rows = JSON.parse(json) as unknown
  if (!Array.isArray(rows)) throw new Error('opencli list did not return an array')
  const sites = new Map<string, OpencliSite>()
  const logins = new Set<string>()
  for (const row of rows as ListEntry[]) if (row && typeof row.site === 'string' && row.name === 'login') logins.add(row.site)
  for (const row of rows as ListEntry[]) {
    if (!row || typeof row.site !== 'string' || row.name !== 'search' || row.access !== 'read' || !Array.isArray(row.args)) continue
    const args = row.args as { name?: unknown; positional?: unknown }[]
    if (!args.some(a => a.positional === true && a.name === 'query') && !args.some(a => a.positional === true)) continue
    sites.set(row.site, {
      site: row.site,
      strategy: typeof row.strategy === 'string' ? row.strategy : 'cookie',
      browser: row.browser === true,
      hasLimit: args.some(a => a.name === 'limit'),
      ...logins.has(row.site) ? { loginCommand: 'opencli ' + row.site + ' login' } : {},
    })
  }
  return sites
}

const cache = new Map<string, { at: number; sites: Map<string, OpencliSite> }>()
export function clearOpencliCache(): void { cache.clear() }

/** The searchable sites of the installed OpenCLI (cached 5 minutes); `undefined` when the command cannot be listed. */
export async function listOpencliSites(options: { run?: typeof runCli; ttlMs?: number; now?: () => number; force?: boolean } = {}): Promise<{ sites?: Map<string, OpencliSite>; problem?: string }> {
  const found = findOnPath('opencli')
  if (!found) return { problem: 'opencli not found on PATH' }
  const now = options.now ?? Date.now
  const key = found + '\u0000' + (process.env.PATH ?? '')
  const hit = cache.get(key)
  if (!options.force && hit && now() - hit.at <= (options.ttlMs ?? 300_000)) return { sites: hit.sites }
  const run = options.run ?? runCli
  const res = await run(found, ['list', '-f', 'json'], { timeoutMs: 20_000, signal: undefined, env: buildCliEnv({ env: {} }), cleanEnv: true, maxOutput: 16 * 1024 * 1024, outputEncoding: 'utf-8' })
  if (res.code !== 0 || res.truncated) return { problem: res.truncated ? 'opencli list output exceeded the size cap' : 'opencli list failed with exit ' + res.code }
  try {
    const sites = parseOpencliList(res.stdout)
    cache.set(key, { at: now(), sites })
    return { sites }
  } catch (error) {
    return { problem: 'opencli list returned an unexpected payload: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

/** Generic field mapping over the columns OpenCLI commands emit (rank, title, url, summary, ...). */
const FIELDS = {
  url: ['url', 'link', 'href', 'projectUrl', 'item_url'],
  title: ['title', 'name', 'text', 'desc', 'label'],
  snippet: ['summary', 'snippet', 'description', 'desc', 'content', 'selftext', 'abstract', 'author', 'user'],
  publishedAt: ['published_at', 'publish_time', 'created_at', 'date', 'time', 'published', 'postTime'],
} as const

const NOT_LOGGED_IN = ['not logged in', 'login required', 'please log in', 'please login', 'sign in', 'auth_required', 'requires login', '未登录', '请先登录']

/** The spec that runs `opencli <site> search` for one platform, or undefined when the generated spec is invalid (a site named like a write command). */
export function opencliSearchSpec(platform: string, entry: OpencliSite): CliAdapterSpec | undefined {
  const spec: CliAdapterSpec = {
    id: 'opencli',
    bins: ['opencli'],
    packageNote: OPENCLI_PROBE.packageNote,
    platforms: [platform],
    probe: OPENCLI_PROBE.probe,
    allowedSubcommands: ['list', entry.site, 'search'],
    search: {
      argv: [entry.site, 'search', '{query}', ...entry.hasLimit ? ['--limit', '{count}'] : [], '-f', 'json'],
      maxCount: 20,
      output: { format: 'json', stripTags: true, fields: { url: [...FIELDS.url], title: [...FIELDS.title], snippet: [...FIELDS.snippet], publishedAt: [...FIELDS.publishedAt] } },
      notLoggedInPatterns: NOT_LOGGED_IN,
    },
    env: {},
    needsLogin: entry.strategy !== 'public',
    ...entry.strategy !== 'public' ? { login: { command: entry.loginCommand ?? 'opencli doctor' } } : {},
    timeoutMs: 60_000,
    maxOutputBytes: 8 * 1024 * 1024,
    verification: { status: 'contract-only', version: '1.8.8', date: '2026-10-06', note: 'command table from `opencli list -f json`; -f json is the documented output option; no site search was run (they use your Chrome sessions)' },
  }
  return validateCliAdapterSpec(spec, 'builtin').ok ? spec : undefined
}
