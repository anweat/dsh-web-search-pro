/**
 * Enhanced page fetch pipeline (agent-reach Jina reader + userscript-style
 * extraction + playwright fallback), with page snapshot persistence.
 * @module web-search-pro/fetch
 */

import type { Store } from './store.ts'
import type { ResolvedConfig } from './config.ts'
import type { BrowserService } from './browser-service.ts'
import { BrowserUnavailableError, browserGap, toBrowserGetter, type BrowserGetter } from './browser-access.ts'
import type { ExtractRule } from './extract.ts'
import { extractText, BUILTIN_RULES } from './extract.ts'
import { httpGet, capText } from './util.ts'
import { LruCache } from './memory-cache.ts'
import { assertSafePublicUrl } from './safe-http.ts'
import { SingleFlight } from './singleflight.ts'

export type FetchMode = 'auto' | 'jina' | 'http' | 'playwright'

export interface FetchOptions {
  mode: FetchMode
  signal: AbortSignal | undefined
  maxChars: number
  fresh: boolean
  persist: boolean
}

export interface FetchResult {
  url: string
  title?: string
  text: string
  source: string
  fromCache: boolean
  statusCode?: number
  usedRule?: string
  /** True when the page is a navigation/JS/form shell with no extractable data. */
  shellPage?: boolean
  /** True when `text` was cut at maxChars (internal: reported by the ctx.web provider, not a tool output field). */
  truncated?: boolean
}

/** True when `text` ends with capText()'s truncation marker. */
export function isTruncatedText(text: string): boolean {
  return /\(Content truncated at \d+ characters\.\)$/.test(text)
}

const CJK_CHAR = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/g
const CJK_SHELL_PHRASES = /(请输入关键词|没有找到相关结果|请登录)/
const LATIN_SHELL_PHRASES = /\b(search for|search by|look here|try searching|no results found|please (use|go to|visit)|enter (a |your )?(query|keyword)|data is (available|located) at|enable javascript)\b/i

/**
 * Heuristic: a "shell" page looks like text but is really navigation — search
 * forms, "look elsewhere" pointers, JS-only stubs. Signals: very little prose,
 * a high link-to-text ratio, or explicit form/redirect phrasing. Returning true
 * lets the tool tell the model to fetch one of the pointed-at URLs instead of
 * re-fetching the same kind of page in a loop (P1-3).
 */
export function detectShellPage(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true
  const linkCount = (trimmed.match(/\[[^\]]*\]\([^)]*\)/g) ?? []).length
  // CJK has no spaces: a run of N ideographs is roughly N/2 words.
  const cjkChars = trimmed.match(CJK_CHAR)?.length ?? 0
  const latinWords = trimmed.replace(CJK_CHAR, ' ').split(/\s+/).filter(Boolean).length
  const words = Math.round(cjkChars / 2) + latinWords
  // Link-dense: more than one markdown link per ~15 words is navigation, not prose.
  const linkDense = words > 0 && linkCount / words > 1 / 15
  // Explicit form/redirect phrasing with almost no other content.
  const shellPhrase = (LATIN_SHELL_PHRASES.test(trimmed) || CJK_SHELL_PHRASES.test(trimmed)) && words < 250
  // A short page is only a shell when it also looks like navigation; a short
  // factual answer is still data.
  return linkDense || shellPhrase
}

/** Validate and normalize a URL for fetching. */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('url must be an http(s) URL')
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('url is not a valid URL')
  }
  return assertSafePublicUrl(parsed).href
}

/** All rules: user (DB) first, then built-ins; user rules win on ties. */
export function mergedRules(store: Store): ExtractRule[] {
  const dbRules: ExtractRule[] = store.listRules().map(r => ({
    hostname: r.hostname,
    contentSelectors: r.content.split(/[,\n]/).map(s => s.trim()).filter(Boolean),
    ...r.remove ? { removeSelectors: r.remove.split(/[,\n]/).map(s => s.trim()).filter(Boolean) } : {},
  }))
  return [...dbRules, ...BUILTIN_RULES]
}

export class FetchService {
  private readonly memory = new LruCache<FetchResult>(128)
  /** In-flight de-duplication of identical non-fresh fetches (C3). */
  private readonly flights = new SingleFlight<FetchResult>()

  private readonly getBrowser: BrowserGetter

  constructor(
    private readonly store: Store,
    private readonly config: ResolvedConfig | (() => ResolvedConfig),
    browser?: BrowserService | BrowserGetter,
  ) {
    this.getBrowser = toBrowserGetter(browser)
  }

  private cfg(): ResolvedConfig {
    return typeof this.config === 'function' ? this.config() : this.config
  }

  async fetchPage(url: string, opts: FetchOptions): Promise<FetchResult> {
    const normalized = normalizeUrl(url)
    const maxChars = Math.min(Math.max(opts.maxChars, 1_000), 500_000)
    const memoryKey = ['page', normalized, opts.mode, maxChars, opts.persist ? 'persist' : 'ephemeral'].join('|')
    const run = (signal: AbortSignal | undefined): Promise<FetchResult> => this.runFetch(normalized, maxChars, memoryKey, opts, signal)
    if (opts.fresh) return run(opts.signal)
    return this.flights.do(memoryKey, run, opts.signal)
  }

  private async runFetch(normalized: string, maxChars: number, memoryKey: string, callerOpts: FetchOptions, signal: AbortSignal | undefined): Promise<FetchResult> {
    // Backends see the shared flight signal, not one waiter's own.
    const opts: FetchOptions = { ...callerOpts, signal }

    if (!opts.fresh) {
      const ttlMs = this.cfg().ttlSeconds * 1000
      const hot = this.memory.get(memoryKey, ttlMs)
      if (hot) return { ...hot, fromCache: true }
      // Auto mode may reuse the freshest successful representation. An explicit
      // backend is a caller contract and must not silently replay another mode.
      const cached = this.store.bestEffort('page cache read', () => this.store.getPage(normalized, this.cfg().ttlSeconds, opts.mode === 'auto' ? undefined : opts.mode))
      if (cached && cached.text) {
        const page: FetchResult = {
          url: normalized,
          ...cached.title ? { title: cached.title } : {},
          text: capText(cached.text, maxChars),
          ...cached.text.length > maxChars || isTruncatedText(cached.text) ? { truncated: true } : {},
          source: 'cache:' + (cached.source ?? 'unknown'),
          fromCache: true,
          ...typeof cached.status === 'number' ? { statusCode: cached.status } : {},
        }
        // Only re-warm the memory layer for auto mode: the key encodes the mode,
        // so a stale-mode entry would shadow later explicit-mode hits.
        if (opts.mode === 'auto') this.memory.set(memoryKey, page)
        return page
      }
    }

    const rules = mergedRules(this.store)
    let result: FetchResult | undefined

    if (opts.mode === 'auto' || opts.mode === 'jina') {
      try {
        result = await this.fetchJina(normalized, opts, maxChars)
      } catch (error) {
        if (opts.mode === 'jina') throw error
        if (opts.signal?.aborted) throw error
      }
    }
    if (!result && (opts.mode === 'auto' || opts.mode === 'http')) {
      try {
        result = await this.fetchHttp(normalized, opts, maxChars, rules)
      } catch (error) {
        if (opts.mode === 'http') throw error
        if (opts.signal?.aborted) throw error
      }
    }
    let browserNote = ''
    if (!result && (opts.mode === 'auto' || opts.mode === 'playwright')) {
      if (!this.cfg().playwright.enabled) {
        if (opts.mode === 'playwright') throw new Error('playwright backend is disabled in config')
      } else {
        // Browser is optional: auto skips the render step when it is absent;
        // an explicit playwright request must say why it cannot run.
        const browser = this.getBrowser()
        const gap = browserGap(browser, 'render', 'web_fetch_pro mode=playwright')
        if (!gap) result = await this.fetchPlaywright(browser!, normalized, opts, maxChars, rules)
        else if (opts.mode === 'playwright') throw new BrowserUnavailableError(gap)
        else browserNote = ' (browser render fallback unavailable: dsh-browser not installed or not enabled)'
      }
    }
    if (!result) {
      throw new Error('all fetch backends failed for ' + normalized + browserNote)
    }

    // P1-3: flag navigation/JS/form shells so the model knows there is no data
    // here and should follow the pointers instead of re-fetching the same page.
    if (detectShellPage(result.text)) result.shellPage = true
    if (isTruncatedText(result.text)) result.truncated = true

    this.memory.set(memoryKey, result)
    if (opts.persist) {
      // Atomic query + page rows; a storage failure must not lose the fetched page.
      const saved = result
      this.store.bestEffort('recordFetch', () => this.store.recordFetch({
        kind: 'fetch',
        url: normalized,
        query: saved.title ?? normalized,
        engine: saved.source,
        status: 'ok',
        detail: JSON.stringify({ textLength: saved.text.length, usedRule: saved.usedRule }),
      }, {
        url: normalized,
        ...saved.title ? { title: saved.title } : {},
        text: saved.text,
        ...saved.statusCode !== undefined ? { status: saved.statusCode } : {},
        source: saved.source,
      }))
    }
    return result
  }

  private async fetchJina(url: string, opts: FetchOptions, maxChars: number): Promise<FetchResult> {
    const cfg = this.cfg()
    const headers: Record<string, string> = {}
    const key = cfg.jinaApiKey || process.env[cfg.jinaApiKeyEnv]
    if (key) headers['authorization'] = 'Bearer ' + key
    headers['x-respond-with'] = 'markdown'
    const res = await httpGet('https://r.jina.ai/' + url, { headers, signal: opts.signal, timeoutMs: 30_000, allowProxyFakeIp: cfg.allowProxyFakeIp })
    if (res.status === 401 && !key) throw new Error('jina reader requires an API key (set jinaApiKey or $JINA_API_KEY)')
    if (!res.ok) throw new Error('jina reader HTTP ' + res.status)
    const text = res.text
    // Jina returns "# Title\n\ncontent"; peel the first H1 as title when present.
    let title: string | undefined
    let body = text
    const m = /^#\s+(.+?)\s*\n/.exec(text)
    if (m) {
      title = m[1]!.trim()
      body = text.slice(m[0]!.length)
    }
    return { url, ...title ? { title } : {}, text: capText(body.trim(), maxChars), source: 'jina', fromCache: false }
  }

  private async fetchHttp(url: string, opts: FetchOptions, maxChars: number, rules: ExtractRule[]): Promise<FetchResult> {
    const res = await httpGet(url, { signal: opts.signal, timeoutMs: 30_000, allowProxyFakeIp: this.cfg().allowProxyFakeIp })
    const contentType = res.contentType ?? ''
    const isHtml = /html|xml/i.test(contentType) || /<\s*!doctype|<!DOCTYPE|(<html[\s>])/i.test(res.text.slice(0, 2000))
    if (isHtml) {
      const extracted = extractText(res.text, res.finalUrl, rules, maxChars)
      return {
        url: res.finalUrl,
        ...extracted.title ? { title: extracted.title } : {},
        text: extracted.text || capText(res.text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(), maxChars),
        source: 'http',
        fromCache: false,
        statusCode: res.status,
        ...extracted.usedRule ? { usedRule: extracted.usedRule } : {},
      }
    }
    return { url: res.finalUrl, text: capText(res.text, maxChars), source: 'http', fromCache: false, statusCode: res.status }
  }

  private async fetchPlaywright(browser: BrowserService, url: string, opts: FetchOptions, maxChars: number, rules: ExtractRule[]): Promise<FetchResult> {
    const rendered = await browser.render(url, rules, { signal: opts.signal, maxChars })
    return {
      url,
      ...rendered.title ? { title: rendered.title } : {},
      text: rendered.text,
      source: 'playwright',
      fromCache: false,
      ...rendered.usedRule ? { usedRule: rendered.usedRule } : {},
    }
  }
}
