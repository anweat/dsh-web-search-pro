/**
 * Search engine backends for web-search-pro. Each engine is a plain object
 * with { id, label, available(), search(query, count, signal) }. Routing,
 * caching, and persistence live in router.ts.
 * @module web-search-pro/engines
 */

import type { WebSearchResult, WebSearchSource, WebRuntime } from '@deepseek-ai/dsh-web'
import { httpGet, runCli, jsYaml, stripTags, capText, decodeRedirectUrl } from './util.ts'
import type { BrowserService } from './browser-service.ts'
import { browserGap, requireBrowser, type BrowserMethod } from './browser-access.ts'
import { PLATFORM_SEARCH_SPECS, parseCookieString, type PlatformSearchSpec } from './platform-search.ts'
import type { CustomPlatformSpec } from './config.ts'
import { ExaClient, type ExaSearchRequest } from './exa-client.ts'
import { EngineError } from './engine-error.ts'
import { cliSpecEngine } from './cli/engine.ts'
import { builtinSpecById } from './cli/builtin-specs.ts'
import { buildArgv, parseCliOutput } from './cli/runner.ts'

export interface SearchOutcome {
  /** Provider-generated answer/summary text, when any. */
  content?: string
  sources: WebSearchSource[]
  /** Id of the concrete backend that answered (a platform provider with a fallback chain names the leg that ran). */
  via?: string
  /** The backend id of the platform chain that answered (`bili`, `browser-opencli`), for display and history. */
  backend?: string
  /** Short notes for the caller: backends skipped on the way, results dropped. */
  notes?: string[]
}

export interface Engine {
  id: string
  label: string
  /** Backend id in a platform chain (`xhs`, `browser-opencli`); absent for plain engines. */
  backend?: string
  /** Cheap local availability check; must not do network I/O. */
  available(): boolean
  /** Browser-service method this engine depends on (dsh-browser is optional). */
  needsBrowser?: BrowserMethod
  search(query: string, count: number, signal?: AbortSignal, options?: EngineSearchOptions): Promise<SearchOutcome>
}

export interface EngineSearchOptions {
  exa?: Omit<ExaSearchRequest, 'query' | 'numResults'>
  /** Bocha native request fields compiled from hard constraints (pipeline/compile.ts). */
  bocha?: { freshness?: string; include?: string[]; exclude?: string[] }
  /** Lower bound of the publication date (ISO 8601), compiled from a hard time_window; the engine maps it to its native filter. */
  since?: string
  /** Domain lists compiled from hard site / exclude_site constraints (keyed sources that take them as request fields). */
  sites?: { include?: string[]; exclude?: string[] }
  /** Task language (`zh` / `en`) for engines with per-language editions or zones (Wikipedia, AnySearch); absent = detect from the query. */
  lang?: 'zh' | 'en'
  browser?: { authProfile?: string; rulePack?: string }
  /** Feed URL of the `rss` platform (it has no fixed endpoint). */
  url?: string
}

export { EngineError }

/** One metered request of a non-model provider (Bocha search): counted in the usage ledger, tokens n/a, price unknown. */
export interface UsageRecorder {
  record(entry: { provider: string; protocol: string; requests: number; note?: string }): void
}

export interface EngineDeps {
  web?: WebRuntime
  exaApiKey?: string
  jinaApiKey?: string
  /** Bocha web-search key (config bochaApiKey / credentials ref / $BOCHA_SEARCH_API_KEY, then the Jev key of the same account). */
  bochaApiKey?: string
  /** Bocha endpoint base, default https://api.bochaai.com. */
  bochaBaseUrl?: string
  /** Ask Bocha for its longer per-page summary (default true). */
  bochaSummary?: boolean
  /** Records requests of metered non-model providers in the usage ledger (best effort, never throws). */
  usage?: UsageRecorder
  /** Test seam: replaces the global fetch of API clients that accept one. */
  fetchImpl?: typeof fetch
  /** Test seam: replaces the DNS lookup of the SSRF check. */
  lookup?: (hostname: string) => Promise<{ address: string; family?: number }[]>
  /** API keys of the keyed sources by route id (`tavily`, `brave`, ...): config literal -> credentials ref -> environment (router). */
  sourceKeys?: Readonly<Record<string, string>>
  /** Base URL overrides of the keyed sources by route id (settings `keyedSources.<id>.baseUrl`). */
  sourceBaseUrls?: Readonly<Record<string, string>>
  /** Self-hosted SearXNG instance (settings `searxngUrl`); no default public instance exists. */
  searxngUrl?: string
  /** Contact address appended to the User-Agent of OpenAlex requests (settings `openalexMailto`). */
  openalexMailto?: string
  /** Optional free keys of the anonymous APIs (credentials / environment); they raise limits, nothing needs them. */
  openalexApiKey?: string
  semanticScholarApiKey?: string
  anysearchApiKey?: string
  /** GitHub API token (config githubToken / $GITHUB_TOKEN / $GH_TOKEN). */
  githubToken?: string
  enableCli: boolean
  opencliEnabled: boolean
  agentReachEnabled: boolean
  allowProxyFakeIp: boolean
  /** Browser service (dsh-browser, optional) for Playwright platform search + bundled opencli; resolved per call. */
  browser?: BrowserService
  /** Per-platform selector overrides (settings.yaml `platformRules`). */
  platformRules?: Record<string, { item: string; title: string; link: string; text?: string }>
  /** User-defined custom platforms (settings.yaml `customPlatforms`). */
  customPlatforms?: Record<string, CustomPlatformSpec>
  /** True when this call originates from the ctx.web provider (avoid seam recursion). */
  skipSeam: boolean
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new EngineError(label + ' timed out', 'ENGINE_TIMEOUT')), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

// ── ctx.web seam (DeepSeek native search) ───────────────────────────────────

export function seamEngine(deps: EngineDeps): Engine {
  return {
    id: 'seam',
    label: 'DeepSeek 原生搜索 (ctx.web)',
    available: () => !!deps.web && !deps.skipSeam,
    async search(query, count, signal, options) {
      if (!deps.web) throw new EngineError('ctx.web seam unavailable', 'ENGINE_UNAVAILABLE')
      const result: WebSearchResult = await withTimeout(
        deps.web.search({ query, maxResults: count }, signal),
        45_000,
        'seam search',
      )
      return { sources: [...result.sources], ...result.content !== undefined ? { content: result.content } : {} }
    },
  }
}

// ── Exa (native API, with connected MCP fallback) ───────────────────────────

/** Parse mcporter's human-readable Exa response into the router's native source shape. */
export function parseMcporterExaSearch(output: string, count: number): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  for (const block of output.split(/\r?\n---\r?\n/g)) {
    const url = /^URL:\s*(https?:\/\/\S+)\s*$/im.exec(block)?.[1]
    if (!url) continue
    const title = /^Title:\s*(.+?)\s*$/im.exec(block)?.[1]?.trim()
    const publishedAt = /^Published:\s*(.+?)\s*$/im.exec(block)?.[1]?.trim()
    const highlights = /(?:^|\r?\n)Highlights:\s*([\s\S]*)$/i.exec(block)?.[1]
      ?.replace(/\r?\n\s*\.\.\.\s*$/g, '')
      .trim()
    sources.push({
      url,
      ...title ? { title } : {},
      ...highlights ? { snippet: capText(stripTags(highlights), 400) } : {},
      ...publishedAt && publishedAt !== 'N/A' ? { publishedAt } : {},
    })
    if (sources.length >= count) break
  }
  return sources
}

export function exaEngine(deps: EngineDeps): Engine {
  const key = () => deps.exaApiKey || process.env.EXA_API_KEY
  return {
    id: 'exa',
    label: 'Exa',
    // A literal key enables the native client. In CLI-enabled profiles,
    // mcporter can use the user's existing Exa MCP connection without copying
    // credentials into this process.
    available: () => (key()?.length ?? 0) > 0 || deps.enableCli,
    async search(query, count, signal, options) {
      const apiKey = key()
      if (apiKey) {
        const data = await new ExaClient({ apiKey }).search({ query, numResults: Math.min(count, 100), type: 'auto', ...options?.exa }, signal)
        const sources: WebSearchSource[] = data.map(r => ({
          url: r.url,
          ...r.title ? { title: r.title } : {},
          ...(r.highlights?.length ? { snippet: capText(r.highlights.join(' '), 400) } : {}),
          ...r.publishedDate ? { publishedAt: r.publishedDate } : {},
        }))
        return { sources }
      }
      if (!deps.enableCli) throw new EngineError('Exa unavailable: configure EXA_API_KEY or enable CLI backends with mcporter', 'ENGINE_UNAVAILABLE', false)
      const advanced = Object.keys(options?.exa ?? {})
      if (advanced.length) {
        throw new EngineError(
          'Exa MCP fallback cannot honor advanced search options (' + advanced.join(', ') + '); configure EXA_API_KEY to use native Exa filtering',
          'ENGINE_UNAVAILABLE',
          false,
        )
      }
      const result = await runCli('mcporter', [
        'call',
        'exa.web_search_exa',
        'query=' + query,
        'numResults=' + String(Math.min(count, 100)),
      ], { timeoutMs: 60_000, signal, maxOutput: 4 * 1024 * 1024 })
      if (result.code !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim() || 'exit ' + result.code
        throw new EngineError('Exa MCP search failed: ' + capText(detail, 300), 'ENGINE_ERROR', true)
      }
      const sources = parseMcporterExaSearch(result.stdout, count)
      if (!sources.length) throw new EngineError('Exa MCP returned no parseable results', 'ENGINE_EMPTY', true)
      return { sources }
    },
  }
}

// ── DuckDuckGo HTML (no key) ────────────────────────────────────────────────

/**
 * Parse DDG html.duckduckgo.com result HTML into sources.
 *
 * Two passes on purpose: a single regex combining the result anchor with an
 * *optional* snippet group behind a lazy bridge silently never captures
 * snippets (the optional group backtracks to an empty match before the lazy
 * bridge is allowed to expand). Slicing each block first, then extracting the
 * snippet inside the block, avoids that trap entirely.
 */
export function parseDdgHtml(html: string, count = 10): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  // 1) Slice blocks: from one result__a anchor up to the next (or end of doc).
  const blockRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class="[^"]*result__a[^"]*"|$)/g
  // 2) Extract the snippet inside each block, independently.
  const snipRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html)) !== null) {
    const url = decodeRedirectUrl(m[1] ?? '')
    const title = stripTags(m[2] ?? '').trim()
    const sm = snipRe.exec(m[3] ?? '')
    const snippet = sm?.[1] ? stripTags(sm[1]).trim() : undefined
    if (!/^https?:\/\//i.test(url) || title.length < 2) continue
    sources.push({ url, ...title ? { title } : {}, ...snippet ? { snippet: capText(snippet, 400) } : {} })
    if (sources.length >= count) break
  }
  return sources
}

export function ddgEngine(allowProxyFakeIp = false): Engine {
  return {
    id: 'ddg',
    label: 'DuckDuckGo',
    available: () => true,
    async search(query, count, signal) {
      const res = await httpGet('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), { signal, timeoutMs: 30_000, allowProxyFakeIp })
      if (!res.ok) throw new EngineError('DuckDuckGo HTTP ' + res.status, 'ENGINE_ERROR', true)
      const sources = parseDdgHtml(res.text, count)
      if (!sources.length) throw new EngineError('DuckDuckGo returned no results (may be rate-limited)', 'ENGINE_EMPTY', true)
      return { sources }
    },
  }
}

// ── Bing RSS (no key) ───────────────────────────────────────────────────────

export function bingEngine(allowProxyFakeIp = false): Engine {
  return {
    id: 'bing',
    label: 'Bing',
    available: () => true,
    async search(query, count, signal) {
      const res = await httpGet(
        'https://www.bing.com/search?q=' + encodeURIComponent(query) + '&format=rss&count=' + Math.min(count, 20),
        { signal, timeoutMs: 30_000, allowProxyFakeIp },
      )
      if (!res.ok) throw new EngineError('Bing HTTP ' + res.status, 'ENGINE_ERROR', true)
      const sources: WebSearchSource[] = parseRss(res.text, count)
      if (!sources.length) throw new EngineError('Bing returned no results', 'ENGINE_EMPTY', true)
      return { sources }
    },
  }
}

/** Parse RSS/Atom XML into sources (used by bing engine and rss platform). */
export function parseRss(xml: string, count = 20): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  const itemRe = /<(item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[2] ?? ''
    const clean = (value: string): string => stripTags(decodeCdata(value)).trim()
    const grab = (tag: string): string | undefined => {
      const t = new RegExp('<' + tag + '(?:[^>]*)>([\\s\\S]*?)<\\/' + tag + '>', 'i').exec(block)
      return t ? clean(t[1]!) : undefined
    }
    const linkMatch = /<link[^>]*href="([^"]+)"/i.exec(block) ?? /<link[^>]*>([\s\S]*?)<\/link>/i.exec(block)
    const title = grab('title')
    // Atom feeds (arXiv) use <id> as the canonical URL.
    const idMatch = /<id[^>]*>([\s\S]*?)<\/id>/i.exec(block)
    const link = linkMatch ? clean(linkMatch[1] ?? linkMatch[2] ?? '') : (idMatch ? clean(idMatch[1] ?? '') : undefined)
    const description = grab('description') ?? grab('summary') ?? grab('content')
    const pubDate = grab('pubDate') ?? grab('published') ?? grab('updated')
    if (!link || !/^https?:\/\//i.test(link)) continue
    sources.push({
      url: link,
      ...title && title.length > 1 ? { title } : {},
      ...description && description.length > 1 ? { snippet: capText(description, 400) } : {},
      ...pubDate ? { publishedAt: pubDate } : {},
    })
    if (sources.length >= count) break
  }
  return sources
}

function decodeCdata(s: string): string {
  const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s)
  return m ? m[1]! : s
}

// ── Jina AI search / reader (optional key) ──────────────────────────────────

export function jinaSearchEngine(deps: EngineDeps): Engine {
  const key = () => deps.jinaApiKey || process.env.JINA_API_KEY
  return {
    id: 'jina',
    label: 'Jina AI',
    available: () => (key()?.length ?? 0) > 0,
    async search(query, count, signal) {
      const headers: Record<string, string> = {}
      const k = key()
      if (k) headers['authorization'] = 'Bearer ' + k
      const res = await httpGet('https://s.jina.ai/?q=' + encodeURIComponent(query), { headers, signal, timeoutMs: 30_000, allowProxyFakeIp: deps.allowProxyFakeIp })
      if (res.status === 401 && !k) throw new EngineError('Jina AI requires an API key (set jinaApiKey or $JINA_API_KEY)', 'ENGINE_UNAVAILABLE', false)
      if (!res.ok) throw new EngineError('Jina search HTTP ' + res.status, 'ENGINE_ERROR', true)
      const sources: WebSearchSource[] = []
      const lineRe = /^\s*(\d+)\.\s*\[([^\]]+)\]\(([^)]+)\)(?:[：:\-—]?\s*([\s\S]*?))?$/gm
      let m: RegExpExecArray | null
      while ((m = lineRe.exec(res.text)) !== null) {
        const url = m[3] ?? ''
        if (!/^https?:\/\//i.test(url)) continue
        sources.push({
          url,
          ...(m[2] ?? '').trim() ? { title: (m[2] ?? '').trim() } : {},
          ...(m[4] ?? '').trim() ? { snippet: capText((m[4] ?? '').trim(), 400) } : {},
        })
        if (sources.length >= count) break
      }
      if (!sources.length) {
        // Jina may return a plain markdown list without numbering.
        throw new EngineError('Jina returned no parseable results', 'ENGINE_EMPTY', true)
      }
      return { sources }
    },
  }
}

// ── GitHub (REST search API; no gh CLI needed) ──────────────────────────────

const GITHUB_API = 'https://api.github.com'

/** Best-effort auth token: deps (config/credentials) → $GITHUB_TOKEN → $GH_TOKEN. */
function githubTokenOf(deps: EngineDeps): string | undefined {
  return deps.githubToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined
}

/**
 * One GitHub REST search call with a UA + optional bearer token. Anonymous
 * rate limit is 10 req/min, authenticated 30 req/min (search API).
 */
async function githubApiGet(path: string, deps: EngineDeps, signal?: AbortSignal, timeoutMs = 30_000): Promise<any> {
  const token = githubTokenOf(deps)
  const headers: Record<string, string> = {
    'accept': 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...token ? { 'authorization': 'Bearer ' + token } : {},
  }
  const res = await httpGet(GITHUB_API + path, { headers, signal, timeoutMs, allowProxyFakeIp: deps.allowProxyFakeIp })
  if (res.status === 401 || res.status === 403) {
    throw new EngineError(
      'GitHub API ' + res.status + (token ? ' (token rejected or rate-limited)' : ' (set $GITHUB_TOKEN for higher limits / authenticated search)'),
      'ENGINE_ERROR',
      false,
    )
  }
  if (!res.ok) throw new EngineError('GitHub API HTTP ' + res.status, 'ENGINE_ERROR', true)
  try {
    return JSON.parse(res.text)
  } catch {
    throw new EngineError('GitHub API returned invalid JSON', 'ENGINE_ERROR', true)
  }
}

export function githubEngine(deps: EngineDeps): Engine {
  return {
    id: 'github',
    label: 'GitHub',
    available: () => true,
    async search(query, count, signal) {
      const q = encodeURIComponent(query)
      const data = await githubApiGet('/search/repositories?q=' + q + '&per_page=' + Math.min(count, 15) + '&sort=stars&order=desc', deps, signal)
      const sources: WebSearchSource[] = (data.items ?? []).map(r => {
        const meta: string[] = []
        if (r.stargazers_count != null) meta.push('⭐' + r.stargazers_count)
        if (r.language) meta.push('[' + r.language + ']')
        if (r.forks_count != null) meta.push('forks ' + r.forks_count)
        return {
          url: r.html_url ?? '',
          ...r.full_name ? { title: r.full_name } : {},
          ...(r.description || meta.length) ? { snippet: capText((r.description ?? '') + (meta.length ? (r.description ? ' — ' : '') + meta.join(' ') : ''), 400) } : {},
          ...r.updated_at ? { publishedAt: String(r.updated_at).slice(0, 10) } : {},
        }
      }).filter(s => /^https?:\/\//i.test(s.url))
      if (!sources.length) throw new EngineError('GitHub returned no results', 'ENGINE_EMPTY', true)
      return { sources }
    },
  }
}

// ── GitHub code / issues search (REST search API) ───────────────────────────

export function githubCodeEngine(deps: EngineDeps): Engine {
  return {
    id: 'github-code', label: 'GitHub 代码',
    available: () => !!githubTokenOf(deps),
    async search(query, count, signal) {
      // Code search requires authentication — surface a clear hint when no token.
      if (!githubTokenOf(deps)) {
        throw new EngineError('GitHub code search requires authentication: set $GITHUB_TOKEN (or config githubToken)', 'ENGINE_UNAVAILABLE', false)
      }
      const q = encodeURIComponent(query)
      const data = await githubApiGet('/search/code?q=' + q + '&per_page=' + Math.min(count, 15), deps, signal)
      const sources: WebSearchSource[] = (data.items ?? []).map(r => ({
        url: r.html_url ?? '',
        ...(r.repository?.full_name && r.path) ? { title: r.repository.full_name + ' / ' + r.path } : { title: r.path ?? 'code match' },
        ...r.repository?.full_name ? { snippet: '仓库: ' + r.repository.full_name } : {},
      })).filter(s => /^https?:\/\//i.test(s.url))
      return { sources }
    },
  }
}

export function githubIssuesEngine(deps: EngineDeps): Engine {
  return {
    id: 'github-issues', label: 'GitHub Issues',
    available: () => true,
    async search(query, count, signal) {
      const q = encodeURIComponent(query)
      const data = await githubApiGet('/search/issues?q=' + q + '&per_page=' + Math.min(count, 15) + '&sort=updated&order=desc', deps, signal)
      const sources: WebSearchSource[] = (data.items ?? []).map(r => {
        const meta: string[] = []
        if (r.state) meta.push('[' + r.state + ']')
        if (r.repository_url) {
          const repo = r.repository_url.replace(/^https?:\/\/api\.github\.com\/repos\//, '')
          if (repo) meta.push(repo)
        }
        if (r.comments != null) meta.push(r.comments + ' comments')
        return {
          url: r.html_url ?? '',
          ...r.title ? { title: r.title } : {},
          ...meta.length ? { snippet: capText(meta.join(' · '), 300) } : {},
          ...r.updated_at ? { publishedAt: String(r.updated_at).slice(0, 10) } : {},
        }
      }).filter(s => /^https?:\/\//i.test(s.url))
      return { sources }
    },
  }
}

// ── Bilibili (bili CLI, through the CLI adapter spec) ──────────────────────

const biliSpec = builtinSpecById('bili')!
const ytDlpSpec = builtinSpecById('yt-dlp')!
const twitterSpec = builtinSpecById('twitter')!

export function bilibiliEngine(deps: EngineDeps): Engine {
  return cliSpecEngine(biliSpec, 'bilibili', deps, { id: 'bilibili', label: 'B站 (bili-cli)' })
}

/** Exact argv contract supported by public-clis/bilibili-cli v0.6.2+ (the `bili` spec). */
export function biliSearchArgs(query: string, count: number): string[] {
  return buildArgv(biliSpec.search, { query, count })
}

/** Parse and validate bili-cli's versioned JSON envelope (the `bili` spec). */
export function parseBilibiliSearchOutput(output: string): WebSearchSource[] {
  return parseCliOutput(biliSpec, biliSpec.search, output, 1_000)
}

// ── V2EX (sov2ex community search API) ──────────────────────────────────────

export function v2exEngine(allowProxyFakeIp = false): Engine {
  return {
    id: 'v2ex',
    label: 'V2EX (sov2ex)',
    available: () => true,
    async search(query, count, signal) {
      const res = await httpGet('https://www.sov2ex.com/api/search?q=' + encodeURIComponent(query) + '&size=' + Math.min(count, 15), { signal, timeoutMs: 25_000, allowProxyFakeIp })
      if (!res.ok) throw new EngineError('sov2ex HTTP ' + res.status, 'ENGINE_ERROR', true)
      let parsed: {
        hits?: { _source?: { id?: string | number; title?: string; content?: string; created?: string | number; node?: { title?: string } } }[] | { hits?: { _source?: { id?: string | number; title?: string; content?: string; created?: string | number; node?: { title?: string } } }[] }
      }
      try {
        parsed = JSON.parse(res.text) as typeof parsed
      } catch {
        throw new EngineError('sov2ex returned invalid JSON', 'ENGINE_ERROR', true)
      }
      // sov2ex returns the hits array at top level; keep a defensive fallback.
      const rawHits = Array.isArray(parsed.hits)
        ? parsed.hits
        : ((parsed.hits as { hits?: unknown[] } | undefined)?.hits ?? [])
      const sources: WebSearchSource[] = (rawHits as { _source?: { id?: string | number; title?: string; content?: string; created?: string | number; node?: { title?: string } } }[]).map(h => {
        const s = h._source
        const url = s?.id != null ? 'https://www.v2ex.com/t/' + s.id : undefined
        const created = typeof s?.created === 'number' ? new Date(s.created * 1000).toISOString().slice(0, 10) : s?.created
        return {
          url: url ?? '',
          ...s?.title ? { title: s.title } : {},
          ...(s?.content || s?.node?.title) ? { snippet: capText((s.content ?? '') + (s.node?.title ? ' [节点: ' + s.node.title + ']' : ''), 400) } : {},
          ...created ? { publishedAt: String(created) } : {},
        }
      }).filter(s => s.url.length > 0)
      return { sources }
    },
  }
}

// ── YouTube (yt-dlp search, through the CLI adapter spec) ───────────────────

export function youtubeEngine(deps: EngineDeps, cli: typeof runCli = runCli): Engine {
  return cliSpecEngine(ytDlpSpec, 'youtube', deps, { id: 'youtube', label: 'YouTube (yt-dlp)', ...cli !== runCli ? { run: cli } : {} })
}

// ── OpenCLI platform search (reuses the user's logged-in browser session) ───

/** Platforms the dsh-browser OpenCLI bridge has a site adapter for (platform -> adapter name). */
export const OPENCLI_PLATFORMS: Record<string, string> = {
  xiaohongshu: 'xiaohongshu',
  twitter: 'twitter',
  reddit: 'reddit',
  instagram: 'instagram',
  facebook: 'facebook',
}

export function opencliEngine(platform: string, deps: EngineDeps): Engine {
  const adapter = OPENCLI_PLATFORMS[platform]
  return {
    id: 'opencli-' + platform,
    label: 'OpenCLI ' + platform,
    needsBrowser: 'opencli',
    available: () => deps.enableCli && deps.opencliEnabled && !!adapter && !browserGap(deps.browser, 'opencli', ''),
    async search(query, count, signal) {
      if (!adapter) throw new EngineError('opencli bundled backend unavailable for ' + platform, 'ENGINE_UNAVAILABLE', false)
      const browser = requireBrowser(deps.browser, 'opencli', 'opencli ' + platform + ' search')
      const res = await browser.opencli([adapter, 'search', query, '-f', 'yaml'], { timeoutMs: 45_000, signal })
      if (res.code !== 0) {
        const msg = res.stderr.trim() || res.stdout.trim() || 'exit ' + res.code
        throw new EngineError('opencli ' + platform + ' search failed (browser session connected?): ' + msg.slice(0, 200), 'ENGINE_UNAVAILABLE', false)
      }
      let rows: any[] = []
      try {
        const parsed = jsYaml.load(res.stdout)
        rows = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? Object.values(parsed as Record<string, unknown>).find(Array.isArray) as any[] ?? [] : [])
      } catch {
        try { rows = JSON.parse(res.stdout) as any[] } catch { /* fallthrough */ }
      }
      const sources: WebSearchSource[] = rows.slice(0, count).map((r: any) => ({
        url: String(r.url ?? r.link ?? r.href ?? ''),
        ...(r.title ?? r.name ?? r.text) ? { title: String(r.title ?? r.name ?? r.text ?? '') } : {},
        ...(r.description ?? r.snippet ?? r.desc ?? r.author ?? r.user) ? { snippet: capText(String(r.description ?? r.snippet ?? r.desc ?? r.author ?? r.user ?? ''), 400) } : {},
      })).filter(s => /^https?:\/\//i.test(s.url))
      if (!sources.length) throw new EngineError('opencli ' + platform + ' returned no parseable results', 'ENGINE_EMPTY', false)
      return { sources }
    },
  }
}

// ── agent-reach CLI backends (twitter etc.) ─────────────────────────────────

/**
 * The legacy `agentreach-twitter` engine, now a thin view of the `twitter` CLI spec (the platform chain uses the spec
 * directly; this keeps the old engine id and its install message). Credentials are checked by `available()`.
 */
export function agentReachEngine(platform: string, deps: EngineDeps): Engine {
  if (platform === 'twitter') {
    const leg = cliSpecEngine(twitterSpec, 'twitter', deps, { id: 'agentreach-twitter', label: 'agent-reach twitter-cli', skipCredentialGate: true })
    return {
      id: 'agentreach-twitter',
      label: 'agent-reach twitter-cli',
      available: () => deps.enableCli && deps.agentReachEnabled && !!process.env.TWITTER_AUTH_TOKEN && !!process.env.TWITTER_CT0,
      async search(query, count, signal, options) {
        try {
          return await leg.search(query, count, signal, options)
        } catch (error) {
          if ((error as { code?: unknown } | null)?.code === 'CLI_NOT_FOUND') throw new EngineError('the twitter command could not be started: install twitter-cli (sources.install backend=twitter); Agent-Reach alone does not provide it', 'ENGINE_UNAVAILABLE', false)
          throw error
        }
      },
    }
  }
  return {
    id: 'agentreach-' + platform,
    label: 'agent-reach ' + platform,
    available: () => false,
    async search() {
      throw new EngineError('agent-reach has no backend for ' + platform, 'ENGINE_UNAVAILABLE', false)
    },
  }
}

// ── Academic verticals (public APIs, no login) ─────────────────────────────

export function arxivEngine(allowProxyFakeIp = false): Engine {
  return {
    id: 'arxiv', label: 'arXiv',
    available: () => true,
    async search(query, count, signal) {
      const res = await httpGet(
        'http://export.arxiv.org/api/query?search_query=all:' + encodeURIComponent(query) + '&start=0&max_results=' + Math.min(count, 20),
        { signal, timeoutMs: 30_000, allowProxyFakeIp },
      )
      if (!res.ok) throw new EngineError('arXiv HTTP ' + res.status, 'ENGINE_ERROR', true)
      const sources = parseRss(res.text, count)
      if (!sources.length) throw new EngineError('arXiv returned no results', 'ENGINE_EMPTY', true)
      return { sources }
    },
  }
}

export function pubmedEngine(allowProxyFakeIp = false): Engine {
  return {
    id: 'pubmed', label: 'PubMed',
    available: () => true,
    async search(query, count, signal) {
      const n = Math.min(Math.max(count, 1), 20)
      const esearch = await httpGet(
        'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=' + encodeURIComponent(query) + '&retmax=' + n + '&retmode=json',
        { signal, timeoutMs: 30_000, allowProxyFakeIp },
      )
      if (!esearch.ok) throw new EngineError('PubMed esearch HTTP ' + esearch.status, 'ENGINE_ERROR', true)
      let ids: string[] = []
      try {
        ids = (JSON.parse(esearch.text) as any)?.esearchresult?.idlist ?? []
      } catch {
        throw new EngineError('PubMed esearch returned invalid JSON', 'ENGINE_ERROR', true)
      }
      if (!ids.length) throw new EngineError('PubMed returned no results', 'ENGINE_EMPTY', true)
      const sources: WebSearchSource[] = ids.map(id => ({ url: 'https://pubmed.ncbi.nlm.nih.gov/' + id + '/', title: 'PubMed ' + id }))
      const esummary = await httpGet(
        'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=' + ids.join(','),
        { signal, timeoutMs: 30_000, allowProxyFakeIp },
      )
      if (esummary.ok) {
        let result: Record<string, { title?: unknown; pubdate?: unknown }> = {}
        try {
          result = (JSON.parse(esummary.text) as any)?.result ?? {}
        } catch { /* keep the id-only sources below */ }
        return {
          sources: ids.map(id => {
            const doc = result[id]
            return {
              url: 'https://pubmed.ncbi.nlm.nih.gov/' + id + '/',
              ...doc?.title ? { title: String(doc.title) } : { title: 'PubMed ' + id },
              ...doc?.pubdate ? { publishedAt: String(doc.pubdate) } : {},
            }
          }),
        }
      }
      return { sources }
    },
  }
}

// ── User-defined custom platform (url template + selectors + cookie) ───────

export function customPlatformEngine(id: string, spec: CustomPlatformSpec, deps: EngineDeps): Engine {
  const searchSpec: PlatformSearchSpec = {
    id: 'custom-' + id,
    label: spec.name,
    url: () => spec.url,
    item: spec.item,
    title: spec.title,
    link: spec.link,
    ...spec.text ? { text: spec.text } : {},
  }
  return {
    id: 'custom-' + id,
    label: spec.name + ' (自定义)',
    needsBrowser: 'searchResults',
    available: () => !browserGap(deps.browser, 'searchResults', ''),
    async search(query, count, signal, options) {
      const browser = requireBrowser(deps.browser, 'searchResults', 'custom platform search')
      const url = spec.url.replace(/{query}/g, encodeURIComponent(query))
      const cookies = spec.cookie ? parseCookieString(spec.cookie, url) : undefined
      const sources = await browser.searchResults(url, searchSpec, { signal, count, cookies, ...options?.browser })
      if (!sources.length) throw new EngineError('自定义平台 ' + spec.name + ' 未取到结果：检查 url 的 {query} 占位、item/title/link 选择器，或补充 cookie。', 'ENGINE_EMPTY', false)
      return { sources }
    },
  }
}

// ── Chinese community search via Playwright (logged-in browser) ────────────

export function playwrightPlatformEngine(platform: string, deps: EngineDeps): Engine {
  const builtin = PLATFORM_SEARCH_SPECS[platform]
  return {
    id: 'playwright-' + platform,
    label: (builtin?.label ?? platform) + ' (Playwright)',
    needsBrowser: 'searchResults',
    available: () => !!builtin && !browserGap(deps.browser, 'searchResults', ''),
    async search(query, count, signal, options) {
      if (!builtin) throw new EngineError('playwright platform search unavailable for ' + platform, 'ENGINE_UNAVAILABLE', false)
      const browser = requireBrowser(deps.browser, 'searchResults', builtin.label + ' search')
      const override = deps.platformRules?.[platform]
      const spec = { ...builtin, ...override ?? {} } as typeof builtin
      const sources = await browser.searchResults(spec.url(query), spec, { signal, count, ...options?.browser })
      if (!sources.length) {
        throw new EngineError(
          builtin.label + ' 未取到结果：该平台需要浏览器登录态。运行 node scripts/save-login.mjs 登录一次，在 dsh-browser 中声明按域名授权的 AuthProfile，并通过 browserBindings.' + platform + ' 绑定；或到 $DSH_HOME/settings.yaml 的 platformRules.' + platform + ' 微调结果选择器。',
          'ENGINE_EMPTY',
          false,
        )
      }
      return { sources }
    },
  }
}

// ── RSS feed (platform tool) ────────────────────────────────────────────────

export function rssEngine(url: string, allowProxyFakeIp = false): Engine {
  return {
    id: 'rss',
    label: 'RSS ' + url,
    available: () => /^https?:\/\//i.test(url),
    async search(query, count, signal) {
      const res = await httpGet(url, { signal, timeoutMs: 25_000, allowProxyFakeIp })
      if (!res.ok) throw new EngineError('RSS HTTP ' + res.status, 'ENGINE_ERROR', true)
      const parsed = parseRss(res.text, 500)
      const needle = query.trim().toLocaleLowerCase()
      const sources = (needle
        ? parsed.filter(source => [source.title, source.snippet, source.url]
          .some(value => value?.toLocaleLowerCase().includes(needle)))
        : parsed).slice(0, count)
      if (!sources.length) {
        throw new EngineError(needle ? 'RSS feed returned no items matching query' : 'RSS feed has no items', 'ENGINE_EMPTY', false)
      }
      return { sources }
    },
  }
}
