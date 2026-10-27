/**
 * The runner of CLI adapter specs (dev-plan M12): spawns the tool without a shell, decodes its output as UTF-8, caps
 * time and size, maps the output to search sources and every failure to a structured error. It never logs or echoes
 * environment values (error text is scrubbed of any value of a variable the spec names) and never runs a login.
 * @module web-search-pro/cli/runner
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import { capText, htmlDecode, jsYaml, runCli, stripTags, type CliResult } from '../util.ts'
import { EngineError } from '../engine-error.ts'
import { normalizeTimeText } from './time-text.ts'
import {
  searchSpecFor, WHOLE_OUTPUT_DEFAULT_CHARS, WHOLE_OUTPUT_SCHEME, type CliAdapterSpec, type CliErrorCode, type CliErrorCodesSpec, type CliOutputSpec, type CliSearchSpec, type FieldSource, type JoinPart, type TemplateSource,
} from './spec.ts'

/** A structured failure of a CLI adapter: `code` is one of {@link CliErrorCode}; `hint` says what the user can do. */
export class CliAdapterError extends EngineError {
  constructor(message: string, code: CliErrorCode, readonly hint?: string, retryable = false) {
    super(message, code, retryable)
    this.name = 'CliAdapterError'
  }
}

/** Variables every tool needs to start and reach the network; nothing else of the process environment is handed over. */
const BASE_ENV = [
  'PATH', 'PATHEXT', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'SYSTEMROOT', 'SystemRoot', 'COMSPEC', 'WINDIR',
  'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE', 'NODE_EXTRA_CA_CERTS',
] as const

/** UTF-8 for Python tools (the Windows console otherwise answers in the system code page; dev issue #28). */
const UTF8_ENV = { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } as const

/**
 * A NO_PROXY list with its IPv6 entries written without brackets (`[::1]` / `[::1]:8080` -> `::1`). Python's httpx (omnireach, and
 * any tool built on it) refuses a bracketed entry with "Invalid port: ':1]'" and the whole search fails; the DSH Host sets
 * `NO_PROXY` with `[::1]`, which a plain terminal does not (found live 2026-10-26). Every tool that takes NO_PROXY accepts the bare form.
 */
export function normalizeNoProxy(list: string): string {
  return list.split(',').map(entry => entry.trim().replace(/^\[([0-9a-fA-F:.]+)\](?::\d+)?$/, '$1')).filter(entry => entry.length > 0).join(',')
}

/** The environment a spec's command runs with: the base set, what the spec lists, and the fixed UTF-8 / `env.set` values. */
export function buildCliEnv(spec: Pick<CliAdapterSpec, 'env'>, source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {}
  const take = (name: string): void => { const value = source[name]; if (value !== undefined) out[name] = name === 'NO_PROXY' || name === 'no_proxy' ? normalizeNoProxy(value) : value }
  for (const name of BASE_ENV) take(name)
  for (const name of spec.env.required ?? []) take(name)
  for (const name of spec.env.passthrough ?? []) take(name)
  return { ...out, ...UTF8_ENV, ...spec.env.set }
}

/** Names of the credential variables a spec relies on that are not set. */
export function missingEnv(spec: Pick<CliAdapterSpec, 'env'>, source: NodeJS.ProcessEnv = process.env): string[] {
  return (spec.env.required ?? []).filter(name => !source[name])
}

/** The home-relative saved-login files of a spec that exist (existence only; the content is never read). */
export function savedLoginPresent(spec: Pick<CliAdapterSpec, 'login'>, opts: { home?: string; exists?: (file: string) => boolean } = {}): boolean | undefined {
  const files = spec.login?.savedCredentialPaths
  if (!files?.length) return undefined
  const home = opts.home ?? os.homedir()
  const exists = opts.exists ?? ((file: string) => { try { return fs.existsSync(file) } catch { return false } })
  return files.some(file => exists(path.join(home, file.replace(/^~\//, ''))))
}

/** Credential variables the plugin also resolves from its own settings / DSH credentials (config literal -> credentials ref -> environment). */
export const SETTINGS_BACKED_ENV: Readonly<Record<string, string>> = { TWITTER_AUTH_TOKEN: 'twitterAuthToken', TWITTER_CT0: 'twitterCt0' }

/** What the user must do to log in: the tool's own command run by them, or the environment variables they set. Never run by the plugin. */
export function loginHint(spec: Pick<CliAdapterSpec, 'bins' | 'login' | 'env'>): string {
  const required = spec.env.required ?? []
  // A Host process does not read a shell profile, so say where the values are looked up.
  const where = required.length && required.every(name => SETTINGS_BACKED_ENV[name])
    ? 'in DSH credentials (plugin settings ' + required.map(name => SETTINGS_BACKED_ENV[name]).join(' / ') + ') or in the Host process environment; a shell profile alone is not enough'
    : 'in the Host process environment (a shell profile alone is not enough)'
  if (spec.login?.hint) return spec.login.hint + (required.length ? ' (or set ' + required.join(' / ') + ' ' + where + ')' : '')
  if (spec.login?.command) return 'run `' + spec.login.command + '` yourself' + (required.length ? ' (or set ' + required.join(' / ') + ' ' + where + ')' : '')
  if (required.length) return 'set ' + required.join(' / ') + ' ' + where
  return 'run `' + spec.bins[0] + ' login` yourself'
}

// ── output → sources ────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

export function getPath(root: unknown, dotted: string): unknown {
  let node: unknown = root
  for (const key of dotted.split('.')) {
    // `field=value` picks the first element of an array whose field is that value (compared as text).
    const pick = /^([^=]+)=(.+)$/.exec(key)
    if (pick && Array.isArray(node)) node = node.find(entry => isObject(entry) && String(entry[pick[1]!]) === pick[2])
    else if (Array.isArray(node)) node = node[Number(key)]
    else if (isObject(node)) node = node[key]
    else return undefined
  }
  return node
}

function asText(value: unknown, empty: ReadonlySet<string>): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim()
    return text.length === 0 || empty.has(text) ? undefined : text
  }
  return undefined
}

function joinPart(part: JoinPart, item: unknown, empty: ReadonlySet<string>, now: number): string | undefined {
  if (typeof part === 'object' && 'template' in part) return fillTemplate(part, item, empty)
  if (typeof part === 'object' && 'time' in part) {
    const raw = asText(getPath(item, part.time), empty)
    const text = raw === undefined ? undefined : normalizeTimeText(raw, now)
    return text === undefined ? undefined : (part.prefix ?? '') + text + (part.suffix ?? '')
  }
  const p = typeof part === 'string' ? { path: part } as { path: string; prefix?: string; suffix?: string } : part
  const text = asText(getPath(item, p.path), empty)
  return text === undefined ? undefined : (p.prefix ?? '') + text + (p.suffix ?? '')
}

function fillTemplate(source: TemplateSource, item: unknown, empty: ReadonlySet<string>): string | undefined {
  if (source.when && getPath(item, source.when.path) !== source.when.equals) return undefined
  let missing = false
  const text = source.template.replace(/\{([^}]+)\}/g, (_m, p: string) => { const v = asText(getPath(item, p), empty); if (v === undefined) missing = true; return v ?? '' })
  return missing ? undefined : text
}

export function resolveField(source: FieldSource | undefined, item: unknown, empty: ReadonlySet<string> = new Set(), now: number = Date.now()): string | undefined {
  if (source === undefined) return undefined
  if (typeof source === 'string') return asText(getPath(item, source), empty)
  if (Array.isArray(source)) {
    for (const entry of source as (string | TemplateSource)[]) {
      const text = typeof entry === 'string' ? asText(getPath(item, entry), empty) : fillTemplate(entry, item, empty)
      if (text !== undefined) return text
    }
    return undefined
  }
  if ('template' in source) return fillTemplate(source, item, empty)
  if ('epoch' in source) {
    const raw = Number(getPath(item, source.epoch))
    const date = Number.isFinite(raw) && raw > 0 ? new Date(raw * 1000) : undefined
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined
  }
  if ('date' in source) return asText(getPath(item, source.date), empty)?.slice(0, 10)
  if ('time' in source) { const raw = asText(getPath(item, source.time), empty); return raw === undefined ? undefined : normalizeTimeText(raw, now) }
  const joined = source as { join: readonly JoinPart[]; sep?: string }
  const parts = joined.join.map(part => joinPart(part, item, empty, now)).filter((v): v is string => v !== undefined)
  return parts.length ? parts.join(joined.sep ?? ' | ') : undefined
}

function firstArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value
  if (!isObject(value)) return undefined
  for (const entry of Object.values(value)) if (Array.isArray(entry)) return entry
  const data = value.data
  if (isObject(data)) for (const entry of Object.values(data)) if (Array.isArray(entry)) return entry
  return undefined
}

/** The label of a spec in messages (`bili`). */
const labelOf = (spec: Pick<CliAdapterSpec, 'bins'>): string => spec.bins[0]!

/** A title that is only a YAML-style field name (`profileImageUrl:`). */
const KEY_LABEL = /^[A-Za-z_][\w.-]*:$/
const YAML_LINE = /^\s*(- )?[A-Za-z_][\w.-]*:(\s|$)/

/**
 * Whether the whole stdout of a text-mode command is a JSON object / array or a YAML mapping / sequence document: the tool then
 * printed a structured format the text parsers must not guess at (twitter-cli prints YAML when piped, issue #38).
 */
export function structuredKind(text: string): 'JSON' | 'YAML' | undefined {
  const trimmed = text.trim()
  if (/^[[{]/.test(trimmed)) {
    try { const value: unknown = JSON.parse(trimmed); if (value !== null && typeof value === 'object') return 'JSON' } catch { /* not JSON */ }
  }
  const lines = trimmed.split(/\r?\n/).filter(line => line.trim() && !/^\s*#/.test(line))
  if (lines.length >= 3 && lines.filter(line => YAML_LINE.test(line)).length * 2 > lines.length) return 'YAML'
  return undefined
}

/**
 * Parse a tool's stdout into the items its output spec describes. A broken payload is CLI_CONTRACT_MISMATCH (the tool is not
 * what the spec says); a payload that says it failed (`expect` not met) is CLI_FAILED with the tool's own message.
 */
export function parseCliItems(spec: Pick<CliAdapterSpec, 'bins'>, output: CliOutputSpec, stdout: string): unknown[] {
  const label = labelOf(spec)
  const text = stdout.replace(/^﻿/, '')
  if (output.format === 'text') {
    const structured = structuredKind(text)
    if (structured) {
      throw new CliAdapterError(label + ' printed ' + structured + ' output, but this adapter reads plain text lines: use format json / yaml with the tool\'s explicit output flag instead', 'CLI_CONTRACT_MISMATCH', 'the tool\'s default output differs from what the adapter parses (a tool often prints YAML or JSON when piped): ask it for json explicitly, e.g. --json')
    }
    const lines = text.split(/\r?\n/)
    if (output.lines?.mode === 'url-lines') {
      const items: unknown[] = []
      for (const line of lines) {
        const m = /(https?:\/\/[^\s]+)/.exec(line)
        if (!m) continue
        const title = stripTags(line).replace(m[1]!, '').trim()
        // A bare `key:` label is a field name of a structured dump, not a result.
        if (title && !KEY_LABEL.test(title)) items.push({ url: m[1], title })
      }
      return items
    }
    const columns = output.lines?.mode === 'tsv' ? output.lines.columns : []
    // A record has at least two cells; a notice or progress line on stdout (no tab) is not one.
    return lines.filter(line => line.includes('\t')).map(line => Object.fromEntries(line.split('\t').map((cell, index) => [columns[index] ?? 'c' + index, cell])))
  }
  // A web page where data was expected (a login wall, a risk-control or captcha page, a proxy error page): the site did not answer with data.
  if ((output.format === 'json' || output.format === 'yaml') && /^\s*<(?:!doctype|html|head|body|\?xml)/i.test(text)) throw blockedPageError(label, 'it printed a web page (HTML)')
  let parsed: unknown
  if (output.format === 'ndjson') {
    const rows: unknown[] = []
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      try { rows.push(JSON.parse(line)) } catch { /* a progress or log line between records */ }
    }
    if (!rows.length && text.trim()) throw new CliAdapterError(label + ' output is not valid UTF-8 NDJSON', 'CLI_CONTRACT_MISMATCH', 'the installed ' + label + ' does not match this adapter: check `sources.deps`')
    return rows
  }
  if (output.format === 'yaml') {
    try { parsed = jsYaml.load(text) } catch { throw new CliAdapterError(label + ' output is not valid YAML', 'CLI_CONTRACT_MISMATCH', 'the installed ' + label + ' does not match this adapter: check `sources.deps`') }
  } else {
    try { parsed = JSON.parse(text) } catch { throw new CliAdapterError(label + ' output is not valid UTF-8 JSON', 'CLI_CONTRACT_MISMATCH', 'the installed ' + label + ' does not match this adapter: check `sources.deps`') }
  }
  for (const rule of output.expect ?? []) {
    if (getPath(parsed, rule.path) !== rule.equals) {
      const detail = (output.errorPaths ?? []).map(p => asText(getPath(parsed, p), new Set())).find(v => v !== undefined)
      if (detail) throw new CliAdapterError(label + ' search failed: ' + capText(detail, 200), 'CLI_FAILED')
      throw new CliAdapterError(label + ' search failed: unexpected response envelope', 'CLI_CONTRACT_MISMATCH', 'the installed ' + label + ' does not match this adapter: check `sources.deps`')
    }
  }
  const items = output.itemsPath !== undefined ? getPath(parsed, output.itemsPath) : firstArray(parsed)
  if (!Array.isArray(items)) throw new CliAdapterError(label + ' output has no result list' + (output.itemsPath ? ' at ' + output.itemsPath : ''), 'CLI_CONTRACT_MISMATCH', 'the installed ' + label + ' does not match this adapter: check `sources.deps`')
  return items
}

const BLOCKED_TEXT = 'the site returned a web page instead of data, or blocked the request (站点返回了网页而不是数据，可能是风控、IP 被拦或需要登录)'
const BLOCKED_HINT = 'open the site in your own Chrome and check that it loads and you are logged in, without a verification page; a proxied or shared IP address is often blocked: try another network exit or retry later, or use the next backend of the chain (platformBackends)'

/** The failure for a web page or a block where data was expected: said as such, with what the user can check. */
function blockedPageError(label: string, detail: string): CliAdapterError {
  return new CliAdapterError(label + ': ' + BLOCKED_TEXT + '; ' + detail, 'CLI_FAILED', BLOCKED_HINT, true)
}

/** The failure payload (`ok: false`, `error: { code, message }`) a tool prints on stderr or stdout: JSON, or a YAML document after any notices. */
export function parseFailurePayload(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('{')) { try { return JSON.parse(trimmed) as unknown } catch { return undefined } }
  const start = /^ok:\s*false\s*$/m.exec(trimmed)
  if (!start) return undefined
  // The document ends at the first blank line (an update notice or a hint can follow it).
  const block = trimmed.slice(start.index).split(/\r?\n\s*\r?\n/)[0]!
  try { const parsed: unknown = jsYaml.load(block); return isObject(parsed) ? parsed : undefined } catch { return undefined }
}

/**
 * A failed command run (non-zero exit) as the structured error its own code and message call for, or undefined when the
 * spec lists no codes or the output carries nothing readable (the generic handling then applies).
 */
export function mapToolFailure(codes: CliErrorCodesSpec | undefined, result: Pick<CliResult, 'code' | 'stdout' | 'stderr'>, spec: Pick<CliAdapterSpec, 'bins' | 'login' | 'env'>, redact: (text: string) => string = text => text): CliAdapterError | EngineError | undefined {
  if (!codes) return undefined
  const label = labelOf(spec)
  const payload = parseFailurePayload(result.stderr) ?? parseFailurePayload(result.stdout)
  const code = payload === undefined ? undefined : asText(getPath(payload, codes.codePath), new Set())
  const message = payload === undefined || !codes.messagePath ? undefined : asText(getPath(payload, codes.messagePath), new Set())
  const shown = message ? redact(capText(message, 200)) : undefined
  const has = (list: readonly string[] | undefined): boolean => code !== undefined && !!list?.includes(code)
  const notLoggedIn = (): CliAdapterError => new CliAdapterError(label + ' is not logged in' + (shown ? ': ' + shown : ''), 'CLI_NOT_LOGGED_IN', loginHint(spec))
  if (has(codes.notLoggedIn)) return notLoggedIn()
  if (has(codes.empty)) return new EngineError(label + ' returned no results', 'ENGINE_EMPTY', false)
  if (has(codes.blocked) || (message !== undefined && includesAny(message, codes.blockedPatterns))) return blockedPageError(label, (code ? code + ': ' : '') + (shown ?? 'no message'))
  if (has(codes.unavailable)) return new CliAdapterError(label + ' could not reach its browser: ' + (shown ?? code), 'CLI_FAILED', 'check that the browser the tool drives is running and its bridge / extension is connected (opencli: OpenCLI Browser Bridge in your own Chrome; `opencli doctor` checks it)', false)
  if (has(codes.timeout)) return new EngineError(label + ' timed out' + (shown ? ': ' + shown : ''), 'ENGINE_TIMEOUT', true)
  if (has(codes.usage)) return new CliAdapterError(label + ' rejected the command arguments of this adapter: ' + (shown ?? code), 'CLI_CONTRACT_MISMATCH', 'the installed ' + label + ' does not match this adapter: check `sources.deps`')
  if (code === undefined && codes.notLoggedInExit?.includes(result.code)) return notLoggedIn()
  if (code !== undefined || shown !== undefined) return new CliAdapterError(label + ' search failed: ' + (code ? '[' + code + '] ' : '') + (shown ?? 'no message'), 'CLI_FAILED', undefined, true)
  return undefined
}

/** The tool's own error text from a parsed json / yaml payload (`errorPaths`), when it carries one. */
export function payloadError(output: CliOutputSpec, stdout: string): string | undefined {
  if (!output.errorPaths?.length || (output.format !== 'json' && output.format !== 'yaml')) return undefined
  try {
    const parsed: unknown = output.format === 'json' ? JSON.parse(stdout.replace(/^\uFEFF/, '')) : jsYaml.load(stdout)
    return output.errorPaths.map(p => asText(getPath(parsed, p), new Set())).find(v => v !== undefined)
  } catch { return undefined }
}

/**
 * Strip markup from a field. Highlight tags (`<em>备案</em>`) vanish without leaving a space (Chinese words must not be split),
 * block-level tags become a space, entities are decoded.
 */
export function stripMarkup(input: string): string {
  return htmlDecode(input.replace(/<\/?(?:p|div|br|li|ul|ol|tr|td|th|h[1-6]|section|article|blockquote)\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

/**
 * Map parsed items to sources by the output spec: http(s) URLs only, snippets and titles capped, tags stripped when asked.
 * `skipped` counts the items (objects) that had no usable link, so the caller can say so instead of silently returning fewer.
 */
export function mapCliItemsDetailed(output: CliOutputSpec, items: readonly unknown[], count: number, now: number = Date.now()): { sources: WebSearchSource[]; skipped: number } {
  const empty = new Set(output.emptyValues ?? [])
  const clean = (text: string | undefined): string | undefined => (text === undefined ? undefined : output.stripTags ? stripMarkup(text) : text)
  const sources: WebSearchSource[] = []
  let skipped = 0
  for (const item of items) {
    if (!isObject(item)) continue
    if (output.skipWhen && getPath(item, output.skipWhen.path) === output.skipWhen.equals) continue
    const fields = output.fields ?? {}
    const url = resolveField(fields.url, item, empty, now)
    if (!url || !/^https?:\/\//i.test(url)) { skipped++; continue }
    // A title is one line: a multi-line body (a tweet) is folded.
    const rawTitle = clean(resolveField(fields.title, item, empty, now))?.replace(/\s+/g, ' ').trim()
    const title = rawTitle ? capText(rawTitle, output.titleMax ?? 300) : undefined
    if (output.requireTitle && !title) continue
    const snippet = clean(resolveField(fields.snippet, item, empty, now))
    const publishedAt = resolveField(fields.publishedAt, item, empty, now)
    sources.push({
      url,
      ...title ? { title } : {},
      ...snippet ? { snippet: capText(snippet, output.snippetMax ?? 400) } : {},
      ...publishedAt ? { publishedAt } : {},
    })
    if (sources.length >= count) break
  }
  return { sources, skipped }
}

export function mapCliItems(output: CliOutputSpec, items: readonly unknown[], count: number, now?: number): WebSearchSource[] {
  return mapCliItemsDetailed(output, items, count, now).sources
}

/**
 * The result of a `lines: { mode: 'whole' }` command: the whole stdout as ONE source. The text is cut at `maxChars` with a note that
 * says how much was shown; the title is "<id>: <query>"; the link is the stand-in `cli://<id>?q=<query>` (it is no web page, so the
 * evidence pipeline lists it but never fetches it). Undefined when the tool printed nothing.
 */
export function wholeOutputSource(spec: Pick<CliAdapterSpec, 'id'>, output: CliOutputSpec, query: string, stdout: string): WebSearchSource | undefined {
  const text = stdout.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  if (!text) return undefined
  const max = output.lines?.mode === 'whole' ? output.lines.maxChars ?? WHOLE_OUTPUT_DEFAULT_CHARS : WHOLE_OUTPUT_DEFAULT_CHARS
  const shown = text.length > max ? text.slice(0, max).trimEnd() + '\n… [truncated: ' + max + ' of ' + text.length + ' characters shown]' : text
  const shortQuery = query.replace(/\s+/g, ' ').trim()
  return { url: WHOLE_OUTPUT_SCHEME + spec.id + '?q=' + encodeURIComponent(shortQuery.slice(0, 200)), title: capText(spec.id + ': ' + shortQuery, 300), snippet: shown }
}

/** Parse and map in one go (what the fixtures tests call). */
export function parseCliOutput(spec: Pick<CliAdapterSpec, 'bins'>, search: CliSearchSpec, stdout: string, count = 20, now?: number): WebSearchSource[] {
  return mapCliItems(search.output, parseCliItems(spec, search.output, stdout), count, now)
}

// ── argv ────────────────────────────────────────────────────────────────────

/** Largest number of words `{terms}` expands to (more are folded into the last one). */
const MAX_TERMS = 16

/** Split a query into words; double quotes keep a phrase in one word (`a "b c" d` -> `a`, `b c`, `d`) and are dropped. */
export function splitTerms(query: string): string[] {
  const terms: string[] = []
  let current = ''
  let quoted = false
  for (const ch of query) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && /\s/.test(ch)) { if (current) terms.push(current); current = '' }
    else current += ch
  }
  if (current) terms.push(current)
  return terms.length > MAX_TERMS ? [...terms.slice(0, MAX_TERMS - 1), terms.slice(MAX_TERMS - 1).join(' ')] : terms
}

/**
 * Fill the placeholders of an argv template. A value that would read as a flag gets a leading space (the tool then takes it as the query)
 * unless a `--` precedes it. A `{terms}` token becomes one token per word of the query.
 */
export function buildArgv(search: Pick<CliSearchSpec, 'argv' | 'maxCount' | 'overfetch'>, input: { query: string; count: number }): string[] {
  // The tool is asked for `overfetch` more than the count; the mapper cuts back to the count.
  const count = Math.min(Math.max(Math.trunc(input.count) || 1, 1), search.maxCount ?? 50) + (search.overfetch ?? 0)
  const dashdash = (index: number): boolean => search.argv.slice(0, index).includes('--')
  const guard = (value: string, index: number): string => (value.startsWith('-') && !dashdash(index) ? ' ' + value : value)
  return search.argv.flatMap((token, index) => {
    const withCount = token.replace(/\{count\}/g, () => String(count))
    if (withCount === '{terms}') {
      const terms = splitTerms(input.query)
      return (terms.length ? terms : [input.query]).map(term => guard(term, index))
    }
    if (withCount === '{query}' || withCount === '{url}') return [guard(input.query, index)]
    return [withCount.replace(/\{(?:query|url)\}/g, () => input.query)]
  })
}

// ── the run ─────────────────────────────────────────────────────────────────

export interface CliRunInput {
  query: string
  count: number
  signal?: AbortSignal | undefined
}

export interface CliRunOptions {
  /** Platform being searched (selects `spec.searches[platform]`). */
  platform?: string
  /** `search` (default) or `read`. */
  operation?: 'search' | 'read'
  /** Resolved command (a path or the bin name); default `spec.bins[0]`. */
  bin?: string
  /** Test seams. */
  run?: typeof runCli
  env?: NodeJS.ProcessEnv
  home?: string
  exists?: (file: string) => boolean
  /** The caller checks the credentials itself (the legacy twitter engine): skip the pre-run credential gate. */
  skipCredentialGate?: boolean
  /** Test seam: the clock `{ time }` fields read relative texts (`3小时前`) against. */
  now?: number
  /** Sees what the command printed (secrets redacted) before it is interpreted: the settings card's trial shows the tool's own words. */
  observe?: (result: { code: number; stdout: string; stderr: string }) => void
}

function redactor(spec: CliAdapterSpec, source: NodeJS.ProcessEnv): (text: string) => string {
  const secrets = [...spec.env.required ?? [], ...spec.env.passthrough ?? []].map(name => source[name]).filter((v): v is string => typeof v === 'string' && v.length >= 6)
  return text => secrets.reduce((acc, secret) => acc.split(secret).join('[redacted]'), text)
}

const includesAny = (text: string, fragments: readonly string[] | undefined): boolean => {
  const lower = text.toLowerCase()
  return !!fragments?.some(fragment => lower.includes(fragment.toLowerCase()))
}

/**
 * Run one spec command for a query and return its sources. Throws {@link CliAdapterError} (CLI_NOT_FOUND,
 * CLI_CONTRACT_MISMATCH, CLI_NOT_LOGGED_IN, CLI_FAILED), ENGINE_EMPTY for a valid empty answer, ENGINE_TIMEOUT, or the
 * abort reason when the caller's signal fires. Nothing is run when the spec's credentials are missing.
 */
export async function runCliSearch(spec: CliAdapterSpec, input: CliRunInput, options: CliRunOptions = {}): Promise<WebSearchSource[]> {
  return (await runCliSearchDetailed(spec, input, options)).sources
}

/** {@link runCliSearch} that also reports how many results had no usable link and were skipped. */
export async function runCliSearchDetailed(spec: CliAdapterSpec, input: CliRunInput, options: CliRunOptions = {}): Promise<{ sources: WebSearchSource[]; skipped: number }> {
  const operation = options.operation ?? 'search'
  const search = operation === 'read' ? spec.read : searchSpecFor(spec, options.platform ?? spec.platforms[0] ?? '')
  const label = labelOf(spec)
  if (!search) throw new CliAdapterError(label + ' has no ' + operation + ' command in this adapter', 'CLI_CONTRACT_MISMATCH')
  const source = options.env ?? process.env
  const redact = redactor(spec, source)

  if (!options.skipCredentialGate) {
    const missing = missingEnv(spec, source)
    if (missing.length) throw new CliAdapterError(label + ' is not logged in: ' + missing.join(' / ') + ' not set', 'CLI_NOT_LOGGED_IN', loginHint(spec))
    if (savedLoginPresent(spec, options) === false) {
      throw new CliAdapterError(label + ' has no saved login' + (spec.login?.readsBrowserCookiesWithoutLogin ? ' (it would read your browser cookies by itself, so it is not run)' : ''), 'CLI_NOT_LOGGED_IN', loginHint(spec))
    }
  }

  const argv = buildArgv(search, input)
  const run = options.run ?? runCli
  const result: CliResult = await run(options.bin ?? spec.bins[0]!, argv, {
    timeoutMs: spec.timeoutMs,
    signal: input.signal,
    env: buildCliEnv(spec, source),
    cleanEnv: true,
    maxOutput: spec.maxOutputBytes,
    outputEncoding: 'utf-8',
  })

  if (input.signal?.aborted) throw input.signal.reason ?? new DOMException('This operation was aborted', 'AbortError')
  options.observe?.({ code: result.code, stdout: redact(result.stdout), stderr: redact(result.stderr) })
  if (result.spawnFailed || (result.code === -1 && !result.timedOut && !result.stderr.trim() && !result.stdout.trim())) {
    throw new CliAdapterError('the ' + label + ' command could not be started: install it (' + spec.packageNote + ')', 'CLI_NOT_FOUND', 'install: ' + spec.packageNote)
  }
  if (result.timedOut) throw new EngineError(label + ' timed out after ' + Math.round(spec.timeoutMs / 1000) + 's', 'ENGINE_TIMEOUT', true)
  if (result.truncated) throw new CliAdapterError(label + ' output exceeded the ' + spec.maxOutputBytes + ' byte cap', 'CLI_FAILED', 'raise maxOutputBytes of the adapter or ask for fewer results')

  const combined = result.stderr + '\n' + result.stdout
  const notLoggedIn = (): CliAdapterError => new CliAdapterError(label + ' is not logged in', 'CLI_NOT_LOGGED_IN', loginHint(spec))
  if (result.code !== 0) {
    // The tool's own error code, when the spec knows its failure format.
    const mapped = mapToolFailure(search.errorCodes, result, spec, redact)
    if (mapped) throw mapped
    if (includesAny(combined, search.notLoggedInPatterns)) throw notLoggedIn()
    if (includesAny(combined, search.emptyWhen)) throw new EngineError(label + ' returned no results', 'ENGINE_EMPTY', false)
    // A tool that answers failures in its machine-readable format (`{ ok: false, error: { message } }`) is quoted by that message, not by the raw payload.
    const own = payloadError(search.output, result.stdout)
    throw new CliAdapterError(label + ' ' + operation + ' failed: ' + redact(capText((own ?? (result.stderr.trim() || result.stdout.trim() || 'exit ' + result.code)), 200)), 'CLI_FAILED', undefined, true)
  }

  let sources: WebSearchSource[]
  let skipped = 0
  if (search.output.lines?.mode === 'whole') {
    const whole = wholeOutputSource(spec, search.output, input.query, redact(result.stdout))
    if (!whole || includesAny(result.stdout, search.emptyWhen)) throw new EngineError(label + ' returned no results' + (whole ? '' : ' (it printed nothing)'), 'ENGINE_EMPTY', false)
    return { sources: [whole], skipped: 0 }
  }
  try {
    const items = parseCliItems(spec, search.output, result.stdout)
    ;({ sources, skipped } = mapCliItemsDetailed(search.output, items, Math.min(Math.max(Math.trunc(input.count) || 1, 1), search.maxCount ?? input.count), options.now))
  } catch (error) {
    if (error instanceof CliAdapterError && error.code === 'CLI_FAILED' && includesAny(combined, search.notLoggedInPatterns)) throw notLoggedIn()
    if (error instanceof CliAdapterError) throw new CliAdapterError(redact(error.message), error.code as CliErrorCode, error.hint, error.retryable)
    throw error
  }
  if (!sources.length) {
    if (includesAny(combined, search.notLoggedInPatterns)) throw notLoggedIn()
    if (includesAny(combined, search.emptyWhen)) throw new EngineError(label + ' returned no results', 'ENGINE_EMPTY', false)
    // A payload that carries the tool's own error list (omnireach `errors`) and no results is a failure, not an empty answer.
    const detail = payloadError(search.output, result.stdout)
    if (detail) throw new CliAdapterError(label + ' ' + operation + ' failed: ' + redact(capText(detail, 200)), 'CLI_FAILED', undefined, true)
    throw new EngineError(label + ' returned no results', 'ENGINE_EMPTY', false)
  }
  return { sources, skipped }
}
