/**
 * Playwright integration (MediaCrawler-style): headless browser rendering
 * with optional persistent login state (storageState), used as the last-resort
 * fetch backend and for page snapshots. The browser is launched lazily and
 * reused within the plugin lifetime; the plugin disposes it on unload.
 *
 * The page-side extractor is a raw JS string (not a closure): tsx/esbuild
 * injects a __name helper into compiled closures, which does not exist in the
 * page context. Strings pass through unevaluated.
 * @module web-search-pro/playwright
 */

import fs from 'node:fs'
import path from 'node:path'
import { resolvePlaywright, uid, capText } from './util.ts'
import type { ExtractRule } from './extract.ts'
import { searchPlatformResults, type PlatformSearchSpec } from './platform-search.ts'

export interface PlaywrightConfig {
  enabled: boolean
  headless: boolean
  /** 'chromium' (bundled) or 'msedge' (system Edge). */
  channel: string
  /** Path to a Playwright storageState JSON (persisted login, like MediaCrawler). */
  storageStatePath?: string
  /** Explicit module path override. */
  modulePath?: string
}

export interface RenderResult {
  title: string
  text: string
  html: string
  usedRule: string | undefined
}

/** Page-side extractor: rules-aware content picker + innerText (runs in the page). */
const EXTRACTOR_FN = "(ruleList) => {\n  const doc = document\n  const title = doc.title ? doc.title.trim() : ''\n  let host = ''\n  try { host = location.hostname } catch (e) {}\n  const norm = (h) => h.replace(/^www\\\\./i, '').toLowerCase()\n  let rule = null\n  for (const r of ruleList) {\n    const rh = norm(r.hostname)\n    if (host === rh || host.endsWith('.' + rh)) rule = r\n  }\n  const pick = (selectors) => {\n    for (const sel of selectors) {\n      try {\n        const el = doc.querySelector(sel)\n        if (el && (el.textContent || '').trim().length > 40) return el\n      } catch (e) {}\n    }\n    return null\n  }\n  const content = rule ? pick(rule.contentSelectors) : (pick(['article', 'main', '[role=\"main\"]']) || doc.body)\n  if (content && rule && rule.removeSelectors) {\n    for (const sel of rule.removeSelectors) {\n      try { content.querySelectorAll(sel).forEach((el) => el.remove()) } catch (e) {}\n    }\n  }\n  const text = content ? (content.innerText || content.textContent || '') : ''\n  return { title, text, html: doc.documentElement.outerHTML.slice(0, 2000000), usedRule: rule ? rule.hostname : null }\n}"

/**
 * Evaluate the extractor with the rule list embedded: the raw string is
 * evaluated as an expression by Playwright, so an IIFE form is required —
 * Playwright does not invoke string "functions" with the argument.
 */
function evaluateExtractor(page: any, rules: readonly ExtractRule[]): Promise<any> {
  return page.evaluate('(' + EXTRACTOR_FN + ')(' + JSON.stringify(JSON.parse(JSON.stringify(rules))) + ')')
}
"(ruleList) => {\n  const doc = document\n  const title = doc.title ? doc.title.trim() : ''\n  let host = ''\n  try { host = location.hostname } catch (e) {}\n  const norm = (h) => h.replace(/^www\\\\./i, '').toLowerCase()\n  let rule = null\n  for (const r of ruleList) {\n    const rh = norm(r.hostname)\n    if (host === rh || host.endsWith('.' + rh)) rule = r\n  }\n  const pick = (selectors) => {\n    for (const sel of selectors) {\n      try {\n        const el = doc.querySelector(sel)\n        if (el && (el.textContent || '').trim().length > 40) return el\n      } catch (e) {}\n    }\n    return null\n  }\n  const content = rule ? pick(rule.contentSelectors) : (pick(['article', 'main', '[role=\"main\"]']) || doc.body)\n  if (content && rule && rule.removeSelectors) {\n    for (const sel of rule.removeSelectors) {\n      try { content.querySelectorAll(sel).forEach((el) => el.remove()) } catch (e) {}\n    }\n  }\n  const text = content ? (content.innerText || content.textContent || '') : ''\n  return { title, text, html: doc.documentElement.outerHTML.slice(0, 2000000), usedRule: rule ? rule.hostname : null }\n}"

export class PlaywrightManager {
  private browser: any = undefined
  private launching: Promise<any> | undefined

  constructor(private readonly config: PlaywrightConfig) {}

  private async ensure(): Promise<any> {
    if (this.browser) return this.browser
    if (!this.launching) {
      this.launching = (async () => {
        const pw = resolvePlaywright(this.config.modulePath)
        const launchOptions: Record<string, unknown> = { headless: this.config.headless }
        if (this.config.channel === 'msedge') launchOptions.channel = 'msedge'
        this.browser = await pw.chromium.launch(launchOptions)
        return this.browser
      })().catch((error: unknown) => {
        this.launching = undefined
        throw error
      })
    }
    return this.launching
  }

  async close(): Promise<void> {
    const b = this.browser
    this.browser = undefined
    this.launching = undefined
    if (b) {
      try { await b.close() } catch { /* already closed */ }
    }
  }

  /** Render one page: goto, settle, extract via rules in the page itself. */
  async render(
    url: string,
    rules: readonly ExtractRule[],
    opts: { signal: AbortSignal | undefined; maxChars?: number; waitMs?: number } = { signal: undefined },
  ): Promise<RenderResult> {
    const browser = await this.ensure()
    const context = await browser.newContext(this.config.storageStatePath ? { storageState: this.config.storageStatePath } : {})
    const page = await context.newPage()
    const onAbort = () => void page.close().catch(() => {})
    if (opts.signal?.aborted) onAbort()
    else opts.signal?.addEventListener('abort', onAbort)
    try {
      page.setDefaultTimeout(20_000)
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 })
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
      if (opts.waitMs) await page.waitForTimeout(opts.waitMs)
      const data = await evaluateExtractor(page, rules)
      return {
        title: data.title,
        text: capText(String(data.text ?? '').replace(/\n{3,}/g, '\n\n').trim(), opts.maxChars ?? 200_000),
        html: data.html,
        usedRule: data.usedRule ?? undefined,
      }
    } catch (error) {
      throw new Error('playwright render failed for ' + url + ': ' + String(error).slice(0, 300))
    } finally {
      opts.signal?.removeEventListener('abort', onAbort)
      await context.close().catch(() => {})
    }
  }

  /** Render + save a screenshot and HTML snapshot to disk (web_snapshot tool). */
  async snapshot(
    url: string,
    rules: readonly ExtractRule[],
    opts: { signal: AbortSignal | undefined; outDir: string; maxChars?: number },
  ): Promise<{ title: string; text: string; screenshotPath: string; htmlPath: string; usedRule: string | undefined }> {
    const browser = await this.ensure()
    const context = await browser.newContext(this.config.storageStatePath ? { storageState: this.config.storageStatePath } : {})
    const page = await context.newPage()
    const onAbort = () => void page.close().catch(() => {})
    if (opts.signal?.aborted) onAbort()
    else opts.signal?.addEventListener('abort', onAbort)
    fs.mkdirSync(opts.outDir, { recursive: true })
    const stamp = Date.now() + '-' + uid().slice(0, 8)
    const screenshotPath = path.join(opts.outDir, stamp + '.png')
    const htmlPath = path.join(opts.outDir, stamp + '.html')
    try {
      page.setDefaultTimeout(25_000)
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
      await page.screenshot({ path: screenshotPath, fullPage: true })
      const html = await page.content()
      fs.writeFileSync(htmlPath, html, 'utf8')
      const data = await evaluateExtractor(page, rules)
      return {
        title: data.title,
        text: capText(String(data.text ?? '').replace(/\n{3,}/g, '\n\n').trim(), opts.maxChars ?? 200_000),
        screenshotPath,
        htmlPath,
        usedRule: data.usedRule ?? undefined,
      }
    } catch (error) {
      throw new Error('playwright snapshot failed for ' + url + ': ' + String(error).slice(0, 300))
    } finally {
      opts.signal?.removeEventListener('abort', onAbort)
      await context.close().catch(() => {})
    }
  }

  /** Drive one platform's search page and extract its result list (Chinese communities / custom platforms). */
  async searchResults(
    url: string,
    spec: PlatformSearchSpec,
    opts: { signal: AbortSignal | undefined; count: number; waitMs?: number; cookies?: { name: string; value: string; domain: string; path: string }[] },
  ): Promise<{ url: string; title: string; snippet?: string }[]> {
    const browser = await this.ensure()
    const context = await browser.newContext(this.config.storageStatePath ? { storageState: this.config.storageStatePath } : {})
    if (opts.cookies?.length) await context.addCookies(opts.cookies).catch(() => {})
    const page = await context.newPage()
    const onAbort = () => void page.close().catch(() => {})
    if (opts.signal?.aborted) onAbort()
    else opts.signal?.addEventListener('abort', onAbort)
    try {
      page.setDefaultTimeout(25_000)
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
      if (opts.waitMs) await page.waitForTimeout(opts.waitMs)
      // scroll once to trigger lazy lists, then extract
      await page.mouse?.wheel(0, 2000).catch(() => {})
      await page.waitForTimeout(800)
      return await searchPlatformResults(page, spec, opts.count)
    } catch (error) {
      throw new Error('playwright platform search failed for ' + url + ': ' + String(error).slice(0, 300))
    } finally {
      opts.signal?.removeEventListener('abort', onAbort)
      await context.close().catch(() => {})
    }
  }
}
