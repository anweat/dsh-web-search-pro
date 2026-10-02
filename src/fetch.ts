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
  /** Output cap in characters (clamped to 1000..500000). */
  maxChars: number
  fresh: boolean
  persist: boolean
  /** Continue reading the page text from this character offset (served from the stored snapshot, no refetch). */
  offset?: number
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
  /** True when `text` stops before the end of the page (cut at maxChars, or the page exceeds the read cap). */
  truncated?: boolean
  /** Character offset to pass as `offset` to read on; absent when nothing more can be read. */
  nextOffset?: number
  /** Length of the whole page text; absent when the page was cut at the read cap and the true length is unknown. */
  totalChars?: number
}

/** Pages are read and stored up to this many characters even when the caller wants less, so `offset` can continue from the snapshot. */
export const FETCH_STORE_CHARS = 100_000
/** Largest page text read from a backend. */
export const FETCH_HARD_MAX_CHARS = 500_000

/** True when `text` ends with capText()'s truncation marker. */
export function isTruncatedText(text: string): boolean {
  return /\(Content truncated at \d+ characters\.\)$/.test(text)
}

const TRUNCATION_MARKER = /(?:\n\n)?\(Content truncated at (\d+) characters\.\)$/

/** Split a stored page text into its body and the read cap it was cut at (undefined = the page was read whole). */
function splitStored(text: string): { body: string; cutAt?: number } {
  const m = TRUNCATION_MARKER.exec(text)
  return m ? { body: text.slice(0, m.index), cutAt: Number(m[1]) } : { body: text }
}

/**
 * Whether a stored/in-memory page text can answer a read that needs characters up to `needEnd`:
 * yes when it is whole, covers `needEnd`, or was already read at the hard maximum.
 */
function covers(text: string, needEnd: number): boolean {
  const { body, cutAt } = splitStored(text)
  return cutAt === undefined || needEnd <= body.length || cutAt >= FETCH_HARD_MAX_CHARS
}

/**
 * The window `[offset, offset + maxChars)` of a whole stored page result: `text` is that slice, with the
 * truncation marker and `truncated` / `nextOffset` / `totalChars` set only when something lies beyond it.
 */
export function sliceFetchResult(full: FetchResult, offset: number, maxChars: number): FetchResult {
  const { body, cutAt } = splitStored(full.text)
  const total = body.length
  const start = Math.min(Math.max(Math.floor(offset), 0), total)
  const end = Math.min(start + maxChars, total)
  const more = end < total
  const truncated = more || cutAt !== undefined
  const { truncated: _t, nextOffset: _n, totalChars: _c, ...rest } = full
  if (!truncated && start === 0) return { ...rest, text: body, totalChars: total }
  return {
    ...rest,
    text: body.slice(start, end) + (truncated ? '\n\n(Content truncated at ' + end + ' characters.)' : ''),
    ...truncated ? { truncated: true } : {},
    // A read that stopped at the hard maximum cannot go further; anything else can continue with this offset.
    ...more || (cutAt !== undefined && cutAt < FETCH_HARD_MAX_CHARS) ? { nextOffset: end } : {},
    ...cutAt === undefined ? { totalChars: total } : {},
  }
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
    const maxChars = Math.min(Math.max(opts.maxChars, 1_000), FETCH_HARD_MAX_CHARS)
    const offset = Math.max(Math.floor(opts.offset ?? 0), 0)
    // Backends read at least FETCH_STORE_CHARS (the snapshot `offset` continues from), more when the window needs it.
    const readCap = Math.min(Math.max(offset + maxChars, FETCH_STORE_CHARS), FETCH_HARD_MAX_CHARS)
    const memoryKey = ['page', normalized, opts.mode, opts.persist ? 'persist' : 'ephemeral'].join('|')
    const run = (signal: AbortSignal | undefined): Promise<FetchResult> => this.runFetch(normalized, readCap, offset + maxChars, memoryKey, opts, signal)
    const full = opts.fresh ? await run(opts.signal) : await this.flights.do(memoryKey + '|' + readCap, run, opts.signal)
    return sliceFetchResult(full, offset, maxChars)
  }

  /** Fetch (or serve from cache) the WHOLE page text up to `readCap`; callers slice their window out of it. */
  private async runFetch(normalized: string, maxChars: number, needEnd: number, memoryKey: string, callerOpts: FetchOptions, signal: AbortSignal | undefined): Promise<FetchResult> {
    // Backends see the shared flight signal, not one waiter's own.
    const opts: FetchOptions = { ...callerOpts, signal }

    if (!opts.fresh) {
      const ttlMs = this.cfg().ttlSeconds * 1000
      const hot = this.memory.get(memoryKey, ttlMs)
      if (hot && covers(hot.text, needEnd)) return { ...hot, fromCache: true }
      // Auto mode may reuse the freshest successful representation. An explicit
      // backend is a caller contract and must not silently replay another mode.
      const cached = this.store.bestEffort('page cache read', () => this.store.getPage(normalized, this.cfg().ttlSeconds, opts.mode === 'auto' ? undefined : opts.mode))
      if (cached && cached.text && covers(cached.text, needEnd)) {
        const page: FetchResult = {
          url: normalized,
          ...cached.title ? { title: cached.title } : {},
          text: cached.text,
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
