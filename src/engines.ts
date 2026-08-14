/**
 * Search engine backends for web-search-pro. Each engine is a plain object
 * with { id, label, available(), search(query, count, signal) }. Routing,
 * caching, and persistence live in router.ts.
 * @module web-search-pro/engines
 */

import type { WebSearchResult, WebSearchSource, WebRuntime } from '@deepseek-ai/dsh-web'
import { httpGet, runCli, jsYaml, stripTags, capText, decodeRedirectUrl } from './util.ts'
import type { BrowserService } from './browser-service.ts'
import { PLATFORM_SEARCH_SPECS, parseCookieString, type PlatformSearchSpec } from './platform-search.ts'
import type { CustomPlatformSpec } from './config.ts'

export interface SearchOutcome {
  /** Provider-generated answer/summary text, when any. */
  content?: string
  sources: WebSearchSource[]
}

export interface Engine {
  id: string
  label: string
  /** Cheap local availability check; must not do network I/O. */
  available(): boolean
  search(query: string, count: number, signal?: AbortSignal): Promise<SearchOutcome>
}

export class EngineError extends Error {
  constructor(message: string, readonly code: string, readonly retryable = true) {
    super(message)
    this.name = 'EngineError'
  }
}

export interface EngineDeps {
  web?: WebRuntime
  exaApiKey?: string
  jinaApiKey?: string
  enableCli: boolean
  opencliEnabled: boolean
  agentReachEnabled: boolean
  /** Browser service (dsh-browser) for Playwright platform search + bundled opencli. */
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
    async search(query, count, signal) {
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

// ── Exa (API key) ────────────────────────────────────────────────────────────

export function exaEngine(deps: EngineDeps): Engine {
  const key = () => deps.exaApiKey || process.env.EXA_API_KEY
  return {
    id: 'exa',
    label: 'Exa',
    available: () => (key()?.length ?? 0) > 0,
    async search(query, count, signal) {
      const res = await httpGet('https://api.exa.ai/search', {
        method: 'POST',
        headers: { 'x-api-key': key()!, 'content-type': 'application/json' },
        body: JSON.stringify({ query, numResults: Math.min(count, 10), type: 'auto', contents: { text: false, highlights: true } }),
        signal,
        timeoutMs: 30_000,
      })
      if (!res.ok) throw new EngineError('Exa API error HTTP ' + res.status, 'ENGINE_ERROR')
      const data = JSON.parse(res.text) as { results?: { title?: string; url?: string; publishedDate?: string; highlights?: string[] }[] }
      const sources: WebSearchSource[] = (data.results ?? []).map(r => ({
        url: r.url ?? '',
        ...r.title ? { title: r.title } : {},
        ...(r.highlights?.length ? { snippet: capText(r.highlights.join(' '), 400) } : {}),
        ...r.publishedDate ? { publishedAt: r.publishedDate } : {},
      })).filter(s => s.url.length > 0)
      return { sources }
    },
  }
}

// ── DuckDuckGo HTML (no key) ────────────────────────────────────────────────

export function ddgEngine(): Engine {
  return {
    id: 'ddg',
    label: 'DuckDuckGo',
    available: () => true,
    async search(query, count, signal) {
      const res = await httpGet('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), { signal, timeoutMs: 30_000 })
      if (!res.ok) throw new EngineError('DuckDuckGo HTTP ' + res.status, 'ENGINE_ERROR')
      const sources: WebSearchSource[] = []
      const blockRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>)?/g
      let m: RegExpExecArray | null
      while ((m = blockRe.exec(res.text)) !== null) {
        const rawHref = m[1] ?? ''
        const url = decodeRedirectUrl(rawHref)
        const title = stripTags(m[2] ?? '').trim()
        const snippet = m[3] ? stripTags(m[3]).trim() : undefined
        if (!/^https?:\/\//i.test(url) || title.length < 2) continue
        sources.push({ url, ...title ? { title } : {}, ...snippet ? { snippet: capText(snippet, 400) } : {} })
        if (sources.length >= count) break
      }
      if (!sources.length) throw new EngineError('DuckDuckGo returned no results (may be rate-limited)', 'ENGINE_EMPTY', true)
      return { sources }
    },
  }
}

// ── Bing RSS (no key) ───────────────────────────────────────────────────────

export function bingEngine(): Engine {
  return {
    id: 'bing',
    label: 'Bing',
    available: () => true,
    async search(query, count, signal) {
      const res = await httpGet(
        'https://www.bing.com/search?q=' + encodeURIComponent(query) + '&format=rss&count=' + Math.min(count, 20),
        { signal, timeoutMs: 30_000 },
      )
      if (!res.ok) throw new EngineError('Bing HTTP ' + res.status, 'ENGINE_ERROR')
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
    const grab = (tag: string): string | undefined => {
      const t = new RegExp('<' + tag + '(?:[^>]*)>([\\s\\S]*?)<\\/' + tag + '>', 'i').exec(block)
      return t ? decodeCdata(stripTags(t[1]!)) : undefined
    }
    const linkMatch = /<link[^>]*href="([^"]+)"/i.exec(block) ?? /<link[^>]*>([\s\S]*?)<\/link>/i.exec(block)
    const title = grab('title')
    // Atom feeds (arXiv) use <id> as the canonical URL.
    const idMatch = /<id[^>]*>([\s\S]*?)<\/id>/i.exec(block)
    const link = linkMatch ? (linkMatch[1] ?? stripTags(linkMatch[2] ?? '')) : (idMatch ? stripTags(idMatch[1] ?? '') : undefined)
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
    available: () => true,
    async search(query, count, signal) {
      const headers: Record<string, string> = {}
      const k = key()
      if (k) headers['authorization'] = 'Bearer ' + k
      const res = await httpGet('https://s.jina.ai/?q=' + encodeURIComponent(query), { headers, signal, timeoutMs: 30_000 })
      if (res.status === 401 && !k) throw new EngineError('Jina AI requires an API key (set jinaApiKey or $JINA_API_KEY)', 'ENGINE_UNAVAILABLE', false)
      if (!res.ok) throw new EngineError('Jina search HTTP ' + res.status, 'ENGINE_ERROR')
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

// ── GitHub (gh CLI) ─────────────────────────────────────────────────────────

export function githubEngine(deps: EngineDeps): Engine {
  return {
    id: 'github',
    label: 'GitHub',
    available: () => deps.enableCli,
    async search(query, count, signal) {
      const res = await runCli('gh', ['search', 'repos', query, '--limit', String(Math.min(count, 15)), '--json', 'fullName,url,description,stargazersCount,language,updatedAt'], { timeoutMs: 30_000, signal })
      if (res.code !== 0) throw new EngineError('gh search failed: ' + res.stderr.trim().slice(0, 200), 'ENGINE_ERROR')
      const rows = JSON.parse(res.stdout) as { fullName?: string; url?: string; description?: string; stargazersCount?: number; language?: string }[]
      const sources: WebSearchSource[] = rows.map(r => {
        const stars = r.stargazersCount != null ? ' ⭐' + r.stargazersCount : ''
        const lang = r.language ? ' [' + r.language + ']' : ''
        return {
          url: r.url ?? 'https://github.com/' + (r.fullName ?? ''),
          ...r.fullName ? { title: r.fullName } : {},
          ...(r.description ?? r.fullName) ? { snippet: capText((r.description ?? '') + stars + lang, 400) } : {},
        }
      })
      return { sources }
    },
  }
}

// ── GitHub code / issues search (gh CLI) ────────────────────────────────────

export function githubCodeEngine(deps: EngineDeps): Engine {
  return {
    id: 'github-code', label: 'GitHub 代码',
    available: () => deps.enableCli,
    async search(query, count, signal) {
      const res = await runCli('gh', ['search', 'code', query, '--limit', String(Math.min(count, 15)), '--json', 'repository,path,url'], { timeoutMs: 30_000, signal })
      if (res.code !== 0) throw new EngineError('gh code search failed: ' + res.stderr.trim().slice(0, 200), 'ENGINE_ERROR')
      const rows = JSON.parse(res.stdout) as { path?: string; repository?: { nameWithOwner?: string }; url?: string }[]
      const sources: WebSearchSource[] = rows.map(r => ({
        url: r.url ?? '',
        ...(r.path && r.repository?.nameWithOwner) ? { title: r.repository.nameWithOwner + ' / ' + r.path } : { title: r.path ?? 'code match' },
        ...r.repository?.nameWithOwner ? { snippet: '仓库: ' + r.repository.nameWithOwner } : {},
      })).filter(s => /^https?:\/\//i.test(s.url))
      return { sources }
    },
  }
}

export function githubIssuesEngine(deps: EngineDeps): Engine {
  return {
    id: 'github-issues', label: 'GitHub Issues',
    available: () => deps.enableCli,
    async search(query, count, signal) {
      const res = await runCli('gh', ['search', 'issues', query, '--limit', String(Math.min(count, 15)), '--json', 'repository,title,url,state,commentsCount'], { timeoutMs: 30_000, signal })
      if (res.code !== 0) throw new EngineError('gh issue search failed: ' + res.stderr.trim().slice(0, 200), 'ENGINE_ERROR')
      const rows = JSON.parse(res.stdout) as { title?: string; url?: string; state?: string; repository?: { nameWithOwner?: string }; commentsCount?: number }[]
      const sources: WebSearchSource[] = rows.map(r => ({
        url: r.url ?? '',
        ...r.title ? { title: r.title } : {},
        ...(r.state || r.repository?.nameWithOwner) ? { snippet: '[' + (r.state ?? '') + ']' + (r.repository?.nameWithOwner ? ' · ' + r.repository.nameWithOwner : '') } : {},
      })).filter(s => /^https?:\/\//i.test(s.url))
      return { sources }
    },
  }
}

// ── Bilibili (bili CLI) ─────────────────────────────────────────────────────

export function bilibiliEngine(deps: EngineDeps): Engine {
  return {
    id: 'bilibili',
    label: 'B站 (bili-cli)',
    available: () => deps.enableCli,
    async search(query, count, signal) {
      const res = await runCli('bili', ['search', query, '--type', 'video', '-n', String(Math.min(count, 10))], { timeoutMs: 30_000, signal })
      if (res.code !== 0) throw new EngineError('bili search failed: ' + res.stderr.trim().slice(0, 200), 'ENGINE_ERROR')
      let data: any
      try {
        data = jsYaml.load(res.stdout) as any
      } catch {
        throw new EngineError('bili output not parseable', 'ENGINE_ERROR')
      }
      const items: { bvid?: string; title?: string; author?: string; play?: number | string; duration?: string }[] = data?.data ?? []
      const sources: WebSearchSource[] = items.filter(i => i.bvid).map(i => ({
        url: 'https://www.bilibili.com/video/' + i.bvid,
        ...i.title ? { title: i.title } : {},
        ...(i.author || i.play != null || i.duration) ? { snippet: capText(['UP: ' + (i.author ?? ''), '播放: ' + i.play, i.duration ?? ''].filter(Boolean).join(' | '), 300) } : {},
      }))
      return { sources }
    },
  }
}

// ── V2EX (sov2ex community search API) ──────────────────────────────────────

export function v2exEngine(): Engine {
  return {
    id: 'v2ex',
    label: 'V2EX (sov2ex)',
    available: () => true,
    async search(query, count, signal) {
      const res = await httpGet('https://www.sov2ex.com/api/search?q=' + encodeURIComponent(query) + '&size=' + Math.min(count, 15), { signal, timeoutMs: 25_000 })
      if (!res.ok) throw new EngineError('sov2ex HTTP ' + res.status, 'ENGINE_ERROR')
      const parsed = JSON.parse(res.text) as {
        hits?: { _source?: { id?: string | number; title?: string; content?: string; created?: string | number; node?: { title?: string } } }[] | { hits?: { _source?: { id?: string | number; title?: string; content?: string; created?: string | number; node?: { title?: string } } }[] }
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

// ── YouTube (yt-dlp search) ─────────────────────────────────────────────────

export function youtubeEngine(deps: EngineDeps): Engine {
  return {
    id: 'youtube',
    label: 'YouTube (yt-dlp)',
    available: () => deps.enableCli,
    async search(query, count, signal) {
      const n = Math.min(count, 10)
      const res = await runCli('yt-dlp', ['ytsearch' + n + ':' + query, '--flat-playlist', '--skip-download', '--no-warnings', '--print', '%(id)s\t%(title)s\t%(channel)s\t%(view_count)s\t%(duration_string)s'], { timeoutMs: 60_000, signal })
      if (res.code !== 0) throw new EngineError('yt-dlp failed: ' + res.stderr.trim().slice(0, 200), 'ENGINE_ERROR')
      const sources: WebSearchSource[] = []
      for (const line of res.stdout.split(/\r?\n/)) {
        const [id, title, channel, views, duration] = line.split('\t')
        if (!id || !title) continue
        const meta: string[] = []
        if (channel) meta.push(channel)
        if (views && views !== 'None') meta.push(views + ' views')
        if (duration) meta.push(duration)
        sources.push({
          url: 'https://www.youtube.com/watch?v=' + id,
          title,
          ...meta.length ? { snippet: meta.join(' | ') } : {},
        })
        if (sources.length >= n) break
      }
      if (!sources.length) throw new EngineError('yt-dlp returned no results', 'ENGINE_EMPTY', true)
      return { sources }
    },
  }
}

// ── OpenCLI platform search (reuses the user's logged-in browser session) ───

const OPENCLI_PLATFORMS: Record<string, string> = {
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
    available: () => deps.enableCli && deps.opencliEnabled && !!adapter && !!deps.browser,
    async search(query, count, signal) {
      if (!adapter || !deps.browser) throw new EngineError('opencli bundled backend unavailable for ' + platform, 'ENGINE_UNAVAILABLE', false)
      const res = await deps.browser.opencli([adapter, 'search', query, '-f', 'yaml'], { timeoutMs: 45_000, signal })
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

export function agentReachEngine(platform: string, deps: EngineDeps): Engine {
  if (platform === 'twitter') {
    return {
      id: 'agentreach-twitter',
      label: 'agent-reach twitter-cli',
      available: () => deps.enableCli && deps.agentReachEnabled && !!process.env.TWITTER_AUTH_TOKEN && !!process.env.TWITTER_CT0,
      async search(query, count, signal) {
        const res = await runCli('twitter', ['search', query, '-n', String(Math.min(count, 10))], { timeoutMs: 45_000, signal })
        if (res.code !== 0) throw new EngineError('twitter search failed: ' + res.stderr.trim().slice(0, 200), 'ENGINE_ERROR')
        const sources: WebSearchSource[] = []
        for (const line of res.stdout.split(/\r?\n/)) {
          const m = /(https?:\/\/[^\s]+)/.exec(line)
          if (!m) continue
          const title = stripTags(line).replace(m[1]!, '').trim()
          if (title) sources.push({ url: m[1]!, title: capText(title, 200) })
          if (sources.length >= count) break
        }
        return { sources }
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

export function arxivEngine(): Engine {
  return {
    id: 'arxiv', label: 'arXiv',
    available: () => true,
    async search(query, count, signal) {
      const res = await httpGet(
        'http://export.arxiv.org/api/query?search_query=all:' + encodeURIComponent(query) + '&start=0&max_results=' + Math.min(count, 20),
        { signal, timeoutMs: 30_000 },
      )
      if (!res.ok) throw new EngineError('arXiv HTTP ' + res.status, 'ENGINE_ERROR')
      const sources = parseRss(res.text, count)
      if (!sources.length) throw new EngineError('arXiv returned no results', 'ENGINE_EMPTY', true)
      return { sources }
    },
  }
}

export function pubmedEngine(): Engine {
  return {
    id: 'pubmed', label: 'PubMed',
    available: () => true,
    async search(query, count, signal) {
      const n = Math.min(Math.max(count, 1), 20)
      const esearch = await httpGet(
        'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=' + encodeURIComponent(query) + '&retmax=' + n + '&retmode=json',
        { signal, timeoutMs: 30_000 },
      )
      if (!esearch.ok) throw new EngineError('PubMed esearch HTTP ' + esearch.status, 'ENGINE_ERROR')
      const ids: string[] = (JSON.parse(esearch.text) as any)?.esearchresult?.idlist ?? []
      if (!ids.length) throw new EngineError('PubMed returned no results', 'ENGINE_EMPTY', true)
      const sources: WebSearchSource[] = ids.map(id => ({ url: 'https://pubmed.ncbi.nlm.nih.gov/' + id + '/', title: 'PubMed ' + id }))
      const esummary = await httpGet(
        'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=' + ids.join(','),
        { signal, timeoutMs: 30_000 },
      )
      if (esummary.ok) {
        const result = (JSON.parse(esummary.text) as any)?.result ?? {}
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
    available: () => !!deps.browser,
    async search(query, count, signal) {
      if (!deps.browser) throw new EngineError('custom platform search unavailable (no browser service)', 'ENGINE_UNAVAILABLE', false)
      const url = spec.url.replace(/{query}/g, encodeURIComponent(query))
      const cookies = spec.cookie ? parseCookieString(spec.cookie, url) : undefined
      const sources = await deps.browser.searchResults(url, searchSpec, { signal, count, cookies })
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
    available: () => !!builtin && !!deps.browser,
    async search(query, count, signal) {
      if (!builtin || !deps.browser) throw new EngineError('playwright platform search unavailable for ' + platform, 'ENGINE_UNAVAILABLE', false)
      const override = deps.platformRules?.[platform]
      const spec = { ...builtin, ...override ?? {} } as typeof builtin
      const sources = await deps.browser.searchResults(spec.url(query), spec, { signal, count })
      if (!sources.length) {
        throw new EngineError(
          builtin.label + ' 未取到结果：该平台需要浏览器登录态（复用你已登录的浏览器）。运行 node scripts/save-login.mjs 登录一次并设置 dsh-browser 的 storageStatePath；或到 $DSH_HOME/settings.yaml 的 platformRules.' + platform + ' 微调结果选择器。',
          'ENGINE_EMPTY',
          false,
        )
      }
      return { sources }
    },
  }
}

// ── RSS feed (platform tool) ────────────────────────────────────────────────

export function rssEngine(url: string): Engine {
  return {
    id: 'rss',
    label: 'RSS ' + url,
    available: () => /^https?:\/\//i.test(url),
    async search(_query, count, signal) {
      const res = await httpGet(url, { signal, timeoutMs: 25_000 })
      if (!res.ok) throw new EngineError('RSS HTTP ' + res.status, 'ENGINE_ERROR')
      const sources = parseRss(res.text, count)
      if (!sources.length) throw new EngineError('RSS feed has no items', 'ENGINE_EMPTY', false)
      return { sources }
    },
  }
}

/** Build the ordered engine list for a platform search. */
export function platformEngines(platform: string, deps: EngineDeps): Engine[] {
  switch (platform) {
    case 'github': return [githubEngine(deps)]
    case 'github-code': return [githubCodeEngine(deps)]
    case 'github-issues': return [githubIssuesEngine(deps)]
    case 'bilibili': return [bilibiliEngine(deps)]
    case 'youtube': return [youtubeEngine(deps)]
    case 'v2ex': return [v2exEngine()]
    case 'xiaohongshu': return [opencliEngine('xiaohongshu', deps)]
    case 'twitter': return [opencliEngine('twitter', deps), agentReachEngine('twitter', deps)]
    case 'reddit': return [opencliEngine('reddit', deps)]
    case 'instagram': return [opencliEngine('instagram', deps)]
    case 'facebook': return [opencliEngine('facebook', deps)]
    // Chinese communities (MediaCrawler-style): Playwright drives the logged-in search page.
    case 'arxiv': return [arxivEngine()]
    case 'pubmed': return [pubmedEngine()]
    case 'zhihu': return [playwrightPlatformEngine('zhihu', deps)]
    case 'weibo': return [playwrightPlatformEngine('weibo', deps)]
    case 'douban': return [playwrightPlatformEngine('douban', deps)]
    case 'tieba': return [playwrightPlatformEngine('tieba', deps)]
    case 'douyin': return [playwrightPlatformEngine('douyin', deps)]
    case 'kuaishou': return [playwrightPlatformEngine('kuaishou', deps)]
    default: return []
  }
}

export const SEARCH_ENGINE_IDS = ['seam', 'exa', 'ddg', 'bing', 'jina', 'github', 'bilibili', 'v2ex', 'youtube', 'arxiv', 'pubmed'] as const
export const PLATFORM_IDS = ['github', 'github-code', 'github-issues', 'bilibili', 'youtube', 'v2ex', 'xiaohongshu', 'twitter', 'reddit', 'instagram', 'facebook', 'rss', 'zhihu', 'weibo', 'douban', 'tieba', 'douyin', 'kuaishou', 'arxiv', 'pubmed'] as const

