import { createHash } from 'node:crypto'
import type { ApiEntry, Cors, ParseResult, SkippedRow } from './types.ts'

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Split a markdown table row on unescaped pipes; `\|` becomes a literal pipe. */
export function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map(cell => cell.replace(/\\\|/g, '|').trim())
}

/** Remove utm_* query parameters without otherwise rewriting the URL. */
export function stripUtm(url: string): string {
  const hashAt = url.indexOf('#')
  const hash = hashAt >= 0 ? url.slice(hashAt) : ''
  const rest = hashAt >= 0 ? url.slice(0, hashAt) : url
  const q = rest.indexOf('?')
  if (q < 0) return url
  const params = rest.slice(q + 1).split('&').filter(p => p !== '' && !/^utm_/i.test(p.split('=')[0]!))
  return rest.slice(0, q) + (params.length ? '?' + params.join('&') : '') + hash
}

const isSeparatorRow = (cells: string[]) => cells.length > 0 && cells.every(c => /^:?-{2,}:?$/.test(c))

interface Columns {
  api: number
  description: number
  auth: number
  https: number
  cors: number
}

function readHeader(cells: string[]): Columns | null {
  const names = cells.map(c => c.replace(/[*_`]/g, '').trim().toLowerCase())
  const api = names.indexOf('api')
  const auth = names.indexOf('auth')
  const https = names.indexOf('https')
  const cors = names.indexOf('cors')
  if (api < 0 || auth < 0 || https < 0 || cors < 0) return null
  const description = names.indexOf('description')
  return { api, description: description < 0 ? 1 : description, auth, https, cors }
}

export function normalizeAuth(raw: string): string {
  const v = raw.replace(/`/g, '').trim()
  const l = v.toLowerCase()
  if (l === '' || l === 'no' || l === 'none' || l === '-' || l === 'n/a') return 'none'
  if (l === 'apikey' || l === 'api key' || l === 'api-key') return 'apiKey'
  if (l === 'oauth') return 'OAuth'
  return v
}

function normalizeYesNo(raw: string): boolean {
  return /^(yes|true|y)$/i.test(raw.replace(/[`*]/g, '').trim())
}

export function normalizeCors(raw: string): Cors {
  const l = raw.replace(/[`*]/g, '').trim().toLowerCase()
  if (l === 'yes' || l === 'true') return 'yes'
  if (l === 'no' || l === 'false') return 'no'
  return 'unknown'
}

function makeId(categorySlug: string, url: string): string {
  return createHash('sha1').update(categorySlug + '\n' + url).digest('hex').slice(0, 10)
}

const LINK = /^\[(.+)\]\(\s*(\S+?)(?:\s+"[^"]*")?\s*\)$/

/**
 * Parse the public-apis README. Only tables whose header has Auth/HTTPS/CORS columns are indexed;
 * malformed rows inside such tables are skipped and reported, never thrown.
 */
export function parseReadmeDetailed(md: string): ParseResult {
  const entries: ApiEntry[] = []
  const skipped: SkippedRow[] = []
  const seen = new Map<string, number>()
  let category: string | null = null
  let columns: Columns | null = null
  let tables = 0

  const lines = md.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      columns = null
      category = heading[1]!.length === 3 ? heading[2]!.trim() : null
      continue
    }
    if (!line.includes('|')) {
      columns = null
      continue
    }
    const cells = splitRow(line)
    if (isSeparatorRow(cells)) continue
    const header = readHeader(cells)
    if (header) {
      columns = category ? header : null
      if (columns) tables++
      continue
    }
    // A different table header (e.g. the sponsored "Call this API" table) ends curated parsing.
    if (!columns) continue
    if (!category) continue

    const skip = (reason: string) => skipped.push({ line: i + 1, category, reason, text: line.trim().slice(0, 200) })
    const need = Math.max(columns.api, columns.auth, columns.https, columns.cors, columns.description)
    if (cells.length <= need) {
      skip(`expected at least ${need + 1} columns, got ${cells.length}`)
      continue
    }
    const link = LINK.exec(cells[columns.api]!)
    if (!link) {
      skip('first column is not a [name](url) link')
      continue
    }
    const name = link[1]!.replace(/\s+/g, ' ').trim()
    const url = stripUtm(link[2]!)
    if (!name || !/^https?:\/\//i.test(url)) {
      skip('empty name or non-http url')
      continue
    }
    const categorySlug = slugify(category)
    const base = makeId(categorySlug, url)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    entries.push({
      id: n === 1 ? base : `${base}-${n}`,
      name,
      url,
      description: cells[columns.description]!.replace(/\s+/g, ' ').trim(),
      category,
      categorySlug,
      auth: normalizeAuth(cells[columns.auth]!),
      https: normalizeYesNo(cells[columns.https]!),
      cors: normalizeCors(cells[columns.cors]!),
    })
  }
  return { entries, skipped, tables }
}

export function parseReadme(md: string): ApiEntry[] {
  return parseReadmeDetailed(md).entries
}
