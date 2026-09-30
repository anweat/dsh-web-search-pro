/**
 * Candidate harvesting (dev-plan §6.2 step 2): run the free search engines
 * from src/engines.ts once per task, fetch the top-K unique pages over plain
 * HTTP, cut them into blocks and produce a CandidateSnapshot.
 *
 * Deliberately NOT used: Jina reader, Playwright, Exa/DeepSeek/seam, any
 * API key (GitHub runs anonymously; GITHUB_TOKEN is ignored so snapshots are
 * reproducible and never depend on a personal token).
 * @module bench/harvest-lib
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  arxivEngine, bingEngine, ddgEngine, githubEngine, v2exEngine, EngineError,
  type Engine, type EngineDeps,
} from '../../src/engines.ts'
import { BUILTIN_RULES, extractText } from '../../src/extract.ts'
import { detectShellPage, isTruncatedText, normalizeUrl } from '../../src/fetch.ts'
import { capText, httpGet } from '../../src/util.ts'
import { splitBlocks } from '../../src/pipeline/blocks.ts'
import {
  SNAPSHOT_VERSION,
  type BenchTask, type CandidateSnapshot, type EngineRun, type PageSnapshot, type Profile,
} from './types.ts'

// ── Politeness ──────────────────────────────────────────────────────────────

/** Minimum gap between two requests to the same host, unless overridden below. */
export const DEFAULT_HOST_GAP_MS = 1_500
/** Per-host overrides: GitHub's anonymous search limit is 10/min; arXiv asks for 3 s; DDG throttles aggressively. */
export const HOST_GAP_MS: Record<string, number> = {
  'api.github.com': 6_500,
  'export.arxiv.org': 3_100,
  'html.duckduckgo.com': 3_000,
}
export const REQUEST_TIMEOUT_MS = 20_000
export const DDG_RETRY_BACKOFF_MS = 10_000
const MAX_PAGE_BYTES = 3 * 1024 * 1024
const MAX_PAGE_CHARS = 200_000

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'))
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = (): void => { clearTimeout(timer); reject(signal?.reason ?? new Error('aborted')) }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Serializes requests per host with a minimum gap measured from the end of the previous request. */
export class HostGate {
  private readonly last = new Map<string, number>()
  private readonly gaps = new Map<string, number>()
  constructor(
    private readonly baseGaps: Record<string, number> = HOST_GAP_MS,
    private readonly defaultGap = DEFAULT_HOST_GAP_MS,
    private readonly now: () => number = Date.now,
    private readonly sleeper: (ms: number, signal?: AbortSignal) => Promise<void> = sleep,
  ) {}

  gapFor(host: string): number {
    return this.gaps.get(host) ?? this.baseGaps[host] ?? this.defaultGap
  }

  /** Wait until a request to `host` is allowed. */
  async wait(host: string, signal?: AbortSignal): Promise<void> {
    const last = this.last.get(host)
    if (last !== undefined) {
      const remaining = last + this.gapFor(host) - this.now()
      if (remaining > 0) await this.sleeper(remaining, signal)
    }
  }

  /** Mark a request to `host` as finished. */
  done(host: string): void {
    this.last.set(host, this.now())
  }

  /** Double the gap for a host (capped at 30 s) after rate-limit symptoms. */
  penalize(host: string): number {
    const next = Math.min(this.gapFor(host) * 2, 30_000)
    this.gaps.set(host, next)
    return next
  }
}

// ── Engine plan ─────────────────────────────────────────────────────────────

export const ENGINE_HOSTS: Record<string, string> = {
  ddg: 'html.duckduckgo.com',
  bing: 'www.bing.com',
  github: 'api.github.com',
  arxiv: 'export.arxiv.org',
  v2ex: 'www.sov2ex.com',
}
export const ENGINE_ORDER = ['ddg', 'bing', 'github', 'arxiv', 'v2ex'] as const
export const RESULTS_PER_ENGINE = 10

/** Engines to run for a task: ddg + bing always; github for docs_code/compare; arxiv for academic; v2ex for Chinese experience tasks. */
export function enginesFor(task: Pick<BenchTask, 'profile' | 'lang'>, override?: readonly string[]): string[] {
  if (override?.length) return ENGINE_ORDER.filter(id => override.includes(id))
  const ids = new Set<string>(['ddg', 'bing'])
  const profile: Profile = task.profile
  if (profile === 'docs_code' || profile === 'compare') ids.add('github')
  if (profile === 'academic') ids.add('arxiv')
  if (profile === 'experience' && task.lang !== 'en') ids.add('v2ex')
  return ENGINE_ORDER.filter(id => ids.has(id))
}

/** Queries for one engine: the task query, plus `site:` variants for ddg/bing when the task has `site` constraints. */
export function queriesFor(task: Pick<BenchTask, 'query' | 'constraints'>, engineId: string): string[] {
  const queries = [task.query]
  if (engineId === 'ddg' || engineId === 'bing') {
    for (const c of task.constraints) {
      if (c.kind !== 'site') continue
      const variant = 'site:' + c.value + ' ' + task.query
      if (!queries.includes(variant)) queries.push(variant)
    }
  }
  return queries
}

export function makeEngine(id: string, allowProxyFakeIp: boolean): Engine {
  const deps: EngineDeps = {
    enableCli: false, opencliEnabled: false, agentReachEnabled: false,
    allowProxyFakeIp, skipSeam: true,
  }
  switch (id) {
    case 'ddg': return ddgEngine(allowProxyFakeIp)
    case 'bing': return bingEngine(allowProxyFakeIp)
    case 'github': return githubEngine(deps)
    case 'arxiv': return arxivEngine(allowProxyFakeIp)
    case 'v2ex': return v2exEngine(allowProxyFakeIp)
    default: throw new Error('unknown engine: ' + id)
  }
}

// ── Running one engine query ────────────────────────────────────────────────

export interface RunContext {
  gate: HostGate
  signal: AbortSignal
  allowProxyFakeIp: boolean
  log: (line: string) => void
}

function describeError(error: unknown, timedOut: boolean): string {
  if (timedOut) return 'TIMEOUT: request exceeded ' + REQUEST_TIMEOUT_MS / 1000 + 's'
  const e = error as { code?: string; name?: string; message?: string; cause?: { message?: string; code?: string } }
  const code = e.code ?? e.cause?.code ?? e.name ?? 'Error'
  const cause = e.cause?.message && e.cause.message !== e.message ? ' (' + e.cause.message + ')' : ''
  return code + ': ' + (e.message ?? String(error)) + cause
}

async function attempt(engine: Engine, query: string, ctx: RunContext): Promise<Omit<EngineRun, 'attempts'>> {
  const host = ENGINE_HOSTS[engine.id] ?? engine.id
  await ctx.gate.wait(host, ctx.signal)
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = AbortSignal.any([ctx.signal, timeout])
  const started = Date.now()
  try {
    const outcome = await engine.search(query, RESULTS_PER_ENGINE, signal)
    const results = outcome.sources.slice(0, RESULTS_PER_ENGINE).map((s, i) => ({
      rank: i + 1,
      url: s.url,
      ...s.title ? { title: s.title } : {},
      ...s.snippet ? { snippet: s.snippet } : {},
      ...s.publishedAt ? { publishedAt: s.publishedAt } : {},
    }))
    return { engine: engine.id, query, status: results.length ? 'ok' : 'empty', ms: Date.now() - started, results }
  } catch (error) {
    if (ctx.signal.aborted) throw error
    const ms = Date.now() - started
    if (error instanceof EngineError && error.code === 'ENGINE_EMPTY') {
      return { engine: engine.id, query, status: 'empty', error: describeError(error, false), ms, results: [] }
    }
    return { engine: engine.id, query, status: 'error', error: describeError(error, timeout.aborted), ms, results: [] }
  } finally {
    ctx.gate.done(host)
  }
}

/** Run one engine query; DuckDuckGo gets one back-off retry when it comes back empty/failed (rate limiting). */
export async function runEngine(engine: Engine, query: string, ctx: RunContext): Promise<EngineRun> {
  let run = await attempt(engine, query, ctx)
  let attempts = 1
  if (engine.id === 'ddg' && run.status !== 'ok') {
    const host = ENGINE_HOSTS.ddg!
    const gap = ctx.gate.penalize(host)
    ctx.log('    ddg ' + run.status + ' (' + (run.error ?? '') + '); backing off ' + DDG_RETRY_BACKOFF_MS / 1000 + 's, host gap now ' + gap / 1000 + 's')
    await sleep(DDG_RETRY_BACKOFF_MS, ctx.signal)
    run = await attempt(engine, query, ctx)
    attempts = 2
  }
  return { ...run, ...attempts > 1 ? { attempts } : {} }
}

// ── Choosing pages to fetch ─────────────────────────────────────────────────

const BINARY_EXT = /\.(pdf|zip|gz|tgz|tar|png|jpe?g|gif|webp|svg|mp4|mov|mp3|exe|dmg|pkg)(?:[?#]|$)/i
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|ref$|ref_src$|spm$|from$)/i

/** Canonical form used to merge duplicate URLs: no fragment, no tracking params, no trailing slash, lowercase host. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw)
    u.hash = ''
    u.hostname = u.hostname.toLowerCase()
    for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(key)) u.searchParams.delete(key)
    let out = u.href
    if (u.pathname !== '/' && out.endsWith('/') && !u.search) out = out.slice(0, -1)
    return out
  } catch {
    return raw
  }
}

export interface FetchTarget { url: string; from: string[] }

/**
 * Top-K unique URLs: round-robin over engine runs by rank (primary-query runs
 * before `site:` variants, engines in fixed order), so each engine's best
 * result is considered before anyone's second. Binary-looking URLs are skipped.
 * `from` lists every `engine#rank` that returned the URL, not only the picked one.
 */
export function selectFetchUrls(runs: readonly EngineRun[], k: number): FetchTarget[] {
  const provenance = new Map<string, string[]>()
  for (const run of runs) {
    for (const r of run.results) {
      const key = canonicalUrl(r.url)
      const tag = run.engine + '#' + r.rank + (run.query.startsWith('site:') ? '(site)' : '')
      provenance.set(key, [...provenance.get(key) ?? [], tag])
    }
  }
  const ordered = [...runs.filter(r => !r.query.startsWith('site:')), ...runs.filter(r => r.query.startsWith('site:'))]
  const picked: FetchTarget[] = []
  const seen = new Set<string>()
  const maxRank = Math.max(0, ...runs.map(r => r.results.length))
  for (let i = 0; i < maxRank && picked.length < k; i++) {
    for (const run of ordered) {
      const r = run.results[i]
      if (!r || picked.length >= k) continue
      const key = canonicalUrl(r.url)
      if (seen.has(key) || !/^https?:\/\//i.test(r.url) || BINARY_EXT.test(r.url)) continue
      seen.add(key)
      picked.push({ url: r.url, from: provenance.get(key) ?? [] })
    }
  }
  return picked
}

// ── Fetching one page (plain HTTP path only) ────────────────────────────────

/**
 * Plain HTTP + extractText, mirroring FetchService.fetchHttp with the
 * built-in rules only (no user rules, no Jina, no Playwright).
 */
export async function fetchPageSnapshot(target: FetchTarget, ctx: RunContext): Promise<PageSnapshot> {
  const base = { url: target.url, source: 'http', from: target.from, text: '', blocks: [] as PageSnapshot['blocks'] }
  let normalized: string
  try {
    normalized = normalizeUrl(target.url)
  } catch (error) {
    return { ...base, fetchedAt: new Date().toISOString(), status: 'error', error: 'INVALID_URL: ' + (error as Error).message }
  }
  const host = new URL(normalized).host
  await ctx.gate.wait(host, ctx.signal)
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  try {
    const res = await httpGet(normalized, {
      signal: AbortSignal.any([ctx.signal, timeout]),
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxBytes: MAX_PAGE_BYTES,
      allowProxyFakeIp: ctx.allowProxyFakeIp,
    })
    const fetchedAt = new Date().toISOString()
    const common = {
      ...base, fetchedAt, httpStatus: res.status, finalUrl: res.finalUrl,
      ...res.contentType ? { contentType: res.contentType } : {},
    }
    if (!res.ok) return { ...common, status: 'error', error: 'HTTP ' + res.status }
    const contentType = res.contentType ?? ''
    const isHtml = /html|xml/i.test(contentType) || /<\s*!doctype|<!DOCTYPE|(<html[\s>])/i.test(res.text.slice(0, 2000))
    if (!isHtml && contentType && !/^(text\/|application\/(json|xml|x-yaml|yaml|javascript))/i.test(contentType)) {
      return { ...common, status: 'skipped', error: 'non-text content-type: ' + contentType }
    }
    let title: string | undefined
    let text: string
    let hitCap = false
    if (isHtml) {
      const extracted = extractText(res.text, res.finalUrl, BUILTIN_RULES, MAX_PAGE_CHARS)
      title = extracted.title || undefined
      hitCap = extracted.text.length >= MAX_PAGE_CHARS
      text = extracted.text || capText(res.text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(), MAX_PAGE_CHARS)
    } else {
      text = capText(res.text, MAX_PAGE_CHARS)
    }
    text = text.replace(/\r\n/g, '\n')
    return {
      ...common,
      status: 'ok',
      ...title ? { title } : {},
      text,
      ...detectShellPage(text) ? { shellPage: true } : {},
      ...hitCap || isTruncatedText(text) ? { truncated: true } : {},
      blocks: splitBlocks(text, res.finalUrl),
    }
  } catch (error) {
    if (ctx.signal.aborted) throw error
    return { ...base, fetchedAt: new Date().toISOString(), status: 'error', error: describeError(error, timeout.aborted) }
  } finally {
    ctx.gate.done(host)
  }
}

// ── One task ────────────────────────────────────────────────────────────────

export interface HarvestOptions {
  fetchTop: number
  engines?: readonly string[]
}

export async function harvestTask(task: BenchTask, options: HarvestOptions, ctx: RunContext): Promise<CandidateSnapshot> {
  const engineRuns: EngineRun[] = []
  for (const id of enginesFor(task, options.engines)) {
    const engine = makeEngine(id, ctx.allowProxyFakeIp)
    for (const query of queriesFor(task, id)) {
      const run = await runEngine(engine, query, ctx)
      engineRuns.push(run)
      ctx.log('  ' + id.padEnd(6) + run.status.padEnd(6) + String(run.results.length).padStart(3) + ' results  ' + run.ms + 'ms  ' + (query === task.query ? '' : '[' + query.split(' ')[0] + '] ') + (run.status === 'error' ? run.error : ''))
    }
  }
  const pages: PageSnapshot[] = []
  for (const target of selectFetchUrls(engineRuns, options.fetchTop)) {
    const page = await fetchPageSnapshot(target, ctx)
    pages.push(page)
    ctx.log('  page ' + page.status.padEnd(7) + String(page.blocks.length).padStart(3) + ' blocks  ' + target.url.slice(0, 90) + (page.error ? '  ' + page.error : '') + (page.shellPage ? '  [shell]' : ''))
  }
  return { version: SNAPSHOT_VERSION, taskId: task.id, harvestedAt: new Date().toISOString(), engineRuns, pages }
}

// ── Persistence and summaries ───────────────────────────────────────────────

export function snapshotPath(dir: string, taskId: string): string {
  return path.join(dir, taskId + '.json')
}

export function writeSnapshot(dir: string, snapshot: CandidateSnapshot): void {
  fs.mkdirSync(dir, { recursive: true })
  const file = snapshotPath(dir, snapshot.taskId)
  const tmp = file + '.tmp-' + process.pid
  fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 1) + '\n')
  fs.renameSync(tmp, file)
}

export function readSnapshot(dir: string, taskId: string): CandidateSnapshot | undefined {
  try {
    return JSON.parse(fs.readFileSync(snapshotPath(dir, taskId), 'utf8')) as CandidateSnapshot
  } catch {
    return undefined
  }
}

export interface SnapshotStats {
  taskId: string
  engines: { engine: string; query: string; status: string; n: number }[]
  empty: number
  error: number
  pagesOk: number
  pagesFailed: number
  shell: number
  blocks: number
}

export function summarize(s: CandidateSnapshot): SnapshotStats {
  return {
    taskId: s.taskId,
    engines: s.engineRuns.map(r => ({ engine: r.engine, query: r.query.startsWith('site:') ? r.query.split(' ')[0]! : '', status: r.status, n: r.results.length })),
    empty: s.engineRuns.filter(r => r.status === 'empty').length,
    error: s.engineRuns.filter(r => r.status === 'error').length,
    pagesOk: s.pages.filter(p => p.status === 'ok').length,
    pagesFailed: s.pages.filter(p => p.status !== 'ok').length,
    shell: s.pages.filter(p => p.shellPage).length,
    blocks: s.pages.reduce((n, p) => n + p.blocks.length, 0),
  }
}

export function formatSummary(stats: readonly SnapshotStats[]): string {
  const lines = ['task     engine results (status)                              pages ok/fail  shell  blocks']
  for (const s of stats) {
    const eng = s.engines.map(e => e.engine + (e.query ? '[' + e.query + ']' : '') + '=' + e.n + (e.status === 'ok' ? '' : '(' + e.status + ')')).join(' ')
    lines.push(s.taskId.padEnd(8) + ' ' + eng.padEnd(52) + ' ' + (s.pagesOk + '/' + s.pagesFailed).padEnd(14) + ' ' + String(s.shell).padEnd(6) + ' ' + s.blocks)
  }
  return lines.join('\n')
}
