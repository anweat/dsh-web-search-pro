/**
 * `read` group: fetch a page, read many URLs through Exa, render a page in the browser.
 * @module web-search-pro/actions/read
 */

import { requireBrowser } from '../browser-access.ts'
import { mergedRules } from '../fetch.ts'
import { capText } from '../util.ts'
import { ActionArgError, type ActionDef } from './types.ts'
import { DEFAULT_FETCH_CHARS, fairShareLimit } from './format.ts'

/** One-line explanation per non-content page class (read.fetch render). */
const PAGE_CLASS_NOTE: Record<string, string> = {
  shell: 'This page contains no extractable data (navigation/JS shell).',
  js_shell: 'This page needs JavaScript to show its content and no browser render was available or helpful.',
  login_wall: 'This page is a login wall; the content is not available without signing in.',
  captcha: 'This page is a captcha / bot check, not the requested content.',
  error: 'This page is an error response, not the requested content.',
}

export const READ_ACTIONS: ActionDef[] = [
  {
    name: 'read.fetch',
    group: 'read',
    summary: 'Fetch a page as readable text: Jina, then HTTP with per-site rules, then a browser render when the result is a shell or login wall and dsh-browser is ready. Output is capped; a truncated result gives nextOffset.',
    notes: 'Read on with offset (served from the stored snapshot). A shell/login-wall reply lists links worth fetching instead.',
    params: {
      url: { type: 'string', required: true, description: 'The HTTP(S) URL to fetch.' },
      mode: { type: 'string', enum: ['auto', 'jina', 'http', 'playwright'], description: 'auto (default), jina, http or playwright (needs dsh-browser; auto skips it when absent).' },
      maxChars: { type: 'number', description: 'Output cap in chars (1000-500000); default from settings (20000).' },
      offset: { type: 'number', description: 'Continue from this character offset (a truncated result gives nextOffset).' },
      fresh: { type: 'boolean', description: 'Bypass the cached snapshot.' },
      persist: { type: 'boolean', description: 'Store the snapshot (default true).' },
    },
    output: {
      type: 'object', additionalProperties: false,
      properties: {
        url: { type: 'string', required: true },
        title: { type: 'string' },
        text: { type: 'string', required: true },
        source: { type: 'string', required: true },
        fromCache: { type: 'boolean', required: true },
        statusCode: { type: 'number' },
        usedRule: { type: 'string' },
        shellPage: { type: 'boolean' },
        pageClass: { type: 'string' },
        attempts: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { source: { type: 'string', required: true }, class: { type: 'string', required: true }, chars: { type: 'number' }, detail: { type: 'string' } } } },
        truncated: { type: 'boolean' },
        nextOffset: { type: 'number' },
        totalChars: { type: 'number' },
      },
    },
    approval: 'none', mutating: false, concurrencySafe: true,
    timeoutMs: config => config.timeoutMs + 30_000,
    examples: [
      { args: { url: 'https://nodejs.org/api/sqlite.html' } },
      { args: { url: 'https://nodejs.org/api/sqlite.html', offset: 20000 }, note: 'continue a truncated page' },
    ],
    async execute(args, ctx) {
      const mode = (args.mode ?? 'auto') as 'auto' | 'jina' | 'http' | 'playwright'
      if (!['auto', 'jina', 'http', 'playwright'].includes(mode)) throw new ActionArgError('mode must be auto, jina, http, or playwright')
      if (args.offset !== undefined && (!Number.isFinite(args.offset) || args.offset < 0)) throw new ActionArgError('offset must be a non-negative number of characters')
      const page = await ctx.fetch.fetchPage(args.url, {
        mode,
        signal: ctx.signal,
        maxChars: args.maxChars ?? ctx.dynamic().fetchDefaultChars ?? DEFAULT_FETCH_CHARS,
        ...args.offset !== undefined ? { offset: args.offset } : {},
        fresh: args.fresh ?? false,
        persist: args.persist ?? true,
      })
      return {
        url: page.url,
        ...page.title ? { title: page.title } : {},
        text: page.text,
        source: page.source,
        fromCache: page.fromCache,
        ...page.statusCode !== undefined ? { statusCode: page.statusCode } : {},
        ...page.usedRule ? { usedRule: page.usedRule } : {},
        ...page.shellPage ? { shellPage: true } : {},
        ...page.pageClass ? { pageClass: page.pageClass } : {},
        ...page.attempts?.length ? { attempts: page.attempts } : {},
        ...page.truncated ? { truncated: true } : {},
        ...page.nextOffset !== undefined ? { nextOffset: page.nextOffset } : {},
        ...page.totalChars !== undefined ? { totalChars: page.totalChars } : {},
      }
    },
    render(value) {
      const v = value as { url: string; title?: string; text: string; source: string; fromCache: boolean; shellPage?: boolean; pageClass?: string; attempts?: { source: string; class: string }[]; truncated?: boolean; nextOffset?: number; totalChars?: number }
      const parts: string[] = []
      if (v.title) parts.push('Title: ' + v.title)
      // A navigation/JS/form shell has no data: say so and point the model at the links it contains instead of re-fetching the same page.
      if (v.shellPage) {
        const pointed = (v.text.match(/\[[^\]]*\]\((https?:[^)]+)\)/g) ?? []).map(s => s.slice(s.indexOf('(') + 1, -1)).slice(0, 5)
        parts.push(PAGE_CLASS_NOTE[v.pageClass ?? 'shell'] ?? PAGE_CLASS_NOTE['shell']!)
        if (pointed.length) parts.push('It points to: ' + pointed.join(', ') + '. Consider fetching one of those instead.')
      }
      parts.push(v.text)
      parts.push('— Source: ' + v.source + (v.fromCache ? ' (cached snapshot)' : '') + ' · ' + v.url + (v.attempts && v.attempts.length > 1 ? ' · tried ' + v.attempts.map(a => a.source + ':' + a.class).join(' → ') : ''))
      if (v.nextOffset !== undefined) parts.push('more: call read.fetch with offset=' + v.nextOffset + (v.totalChars !== undefined ? ' (page has ' + v.totalChars + ' chars)' : ''))
      return parts.join('\n\n')
    },
  },
  {
    name: 'read.contents',
    group: 'read',
    summary: 'Full text of up to 100 URLs via Exa /contents (needs the Exa key). Capped per URL and in total; read.fetch with offset reads the rest.',
    params: {
      urls: { type: 'array', required: true, items: { type: 'string' }, description: 'HTTP(S) URLs, at most 100.' },
    },
    output: {
      type: 'object', additionalProperties: false,
      properties: {
        results: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', required: true }, title: { type: 'string' }, text: { type: 'string' }, publishedDate: { type: 'string' }, truncated: { type: 'boolean' }, totalChars: { type: 'number' } } } },
        note: { type: 'string' },
      },
    },
    approval: 'none', mutating: false, concurrencySafe: true,
    timeoutMs: config => config.timeoutMs + 30_000,
    examples: [{ args: { urls: ['https://example.com/a', 'https://example.com/b'] } }],
    async execute(args, ctx) {
      if (!args.urls.length || args.urls.length > 100) throw new ActionArgError('urls must contain 1-100 entries')
      const cfg = ctx.dynamic()
      const rows = await ctx.router.exaContents(args.urls, ctx.signal)
      const perUrl = cfg.exaContentsPerUrlChars ?? 8_000
      const total = cfg.exaContentsTotalChars ?? 30_000
      const limit = fairShareLimit(rows.map(row => row.text?.length ?? 0), perUrl, total)
      let cut = 0
      const results = rows.map(row => {
        const text = row.text
        const over = text !== undefined && text.length > limit
        if (over) cut++
        return {
          url: row.url,
          ...row.title ? { title: row.title } : {},
          ...text ? { text: over ? capText(text, limit) : text } : {},
          ...row.publishedDate ? { publishedDate: row.publishedDate } : {},
          ...over ? { truncated: true, totalChars: text.length } : {},
        }
      })
      return {
        results,
        ...cut ? { note: cut + ' of ' + results.length + ' text(s) cut to ' + limit + ' chars (caps: ' + perUrl + ' per URL, ' + total + ' total). Read the rest with read.fetch url=<url> offset=' + limit + '.' } : {},
      }
    },
    render(value) {
      const v = value as { results: { url: string; title?: string; text?: string }[]; note?: string }
      const body = v.results.map(row => (row.title ? '# ' + row.title + '\n' : '') + row.url + '\n\n' + (row.text ?? '')).join('\n\n---\n\n')
      return v.note ? body + '\n\n' + v.note : body
    },
  },
  {
    name: 'read.snapshot',
    group: 'read',
    summary: 'Render a page in headless Playwright (optional saved login): text via per-site rules plus saved HTML and optional PNG; returns file paths. For JS-heavy pages or visual capture. Needs the dsh-browser plugin.',
    notes: 'Text is capped like read.fetch; the full text is stored and read.fetch offset reads on from it.',
    params: {
      url: { type: 'string', required: true, description: 'The HTTP(S) URL.' },
      screenshot: { type: 'boolean', description: 'Save a full-page PNG (default true).' },
    },
    output: {
      type: 'object', additionalProperties: false,
      properties: {
        url: { type: 'string', required: true },
        title: { type: 'string' },
        text: { type: 'string', required: true },
        screenshotPath: { type: 'string' },
        htmlPath: { type: 'string' },
      },
    },
    approval: 'none', mutating: false, concurrencySafe: true,
    timeoutMs: config => config.timeoutMs + 60_000,
    errors: ['CAPABILITY_UNAVAILABLE'],
    unavailable: env => env.browserReady ? undefined : 'needs the dsh-browser plugin, which is not installed or not ready',
    examples: [{ args: { url: 'https://example.com/app', screenshot: false } }],
    async execute(args, ctx) {
      const browser = requireBrowser(ctx.browser(), 'snapshot', 'read.snapshot')
      const rules = mergedRules(ctx.store)
      const shot = await browser.snapshot(args.url, rules, {
        signal: ctx.signal,
        outDir: ctx.config.playwright.snapshotDir,
        screenshot: args.screenshot ?? true,
      })
      const out: { url: string; title?: string; text: string; screenshotPath?: string; htmlPath?: string } = {
        url: args.url,
        ...shot.title ? { title: shot.title } : {},
        // Same exit budget as read.fetch; the full text is stored (read.fetch offset reads on from it).
        text: capText(shot.text, ctx.outputCap()),
        htmlPath: shot.htmlPath,
      }
      if (args.screenshot !== false && shot.screenshotPath) out.screenshotPath = shot.screenshotPath
      // Atomic query + page rows; a storage failure must not lose the captured snapshot.
      ctx.store.bestEffort('recordFetch', () => ctx.store.recordFetch(
        { kind: 'snapshot', url: args.url, query: shot.title ?? args.url, engine: 'playwright', status: 'ok', detail: JSON.stringify({ screenshotPath: out.screenshotPath, htmlPath: shot.htmlPath }) },
        {
          url: args.url,
          ...shot.title ? { title: shot.title } : {},
          text: shot.text,
          htmlPath: shot.htmlPath,
          ...out.screenshotPath ? { screenshotPath: out.screenshotPath } : {},
          source: 'playwright',
        },
      ))
      return out
    },
    render(value) {
      const v = value as { url: string; title?: string; text: string; screenshotPath?: string; htmlPath?: string }
      const parts: string[] = []
      if (v.title) parts.push('Title: ' + v.title)
      parts.push(v.text)
      if (v.screenshotPath) parts.push('Screenshot: ' + v.screenshotPath)
      if (v.htmlPath) parts.push('HTML: ' + v.htmlPath)
      return parts.join('\n\n')
    },
  },
]
