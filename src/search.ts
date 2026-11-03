import MiniSearch from 'minisearch'
import type { Query } from 'minisearch'
import { CATEGORY_ZH, EN_STOPWORDS, dictionaryFor, segmentCjk } from './zh.ts'
import { InputError } from './types.ts'
import type { ApiEntry, CategoryInfo, SearchItem, SearchOptions, SearchResponse, Searcher, Snapshot } from './types.ts'

export const DEFAULT_LIMIT = 10
export const MAX_LIMIT = 50

const KEEP_AS_IS = new Set(['news', 'series', 'species', 'analysis', 'chess', 'class', 'kubernetes', 'lens', 'axes', 'bias', 'canvas', 'atlas'])

/** Lowercase plus a light plural stemmer, applied to both indexed text and queries. */
export function processTerm(term: string): string | null {
  const t = term.toLowerCase()
  if (t.length < 1) return null
  if (t.length <= 3 || KEEP_AS_IS.has(t)) return t
  if (t.endsWith('ies') && t.length > 4) return t.slice(0, -3) + 'y'
  if (t.endsWith('s') && !/(ss|us|is|os)$/.test(t)) return t.slice(0, -1)
  return t
}

const STOP = new Set(EN_STOPWORDS)
const WORD = /[\p{L}\p{N}]+/gu
const NON_CJK = /[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu

type Alt = string[]
type Group = Alt[]

interface ParsedQuery {
  groups: Group[]
  terms: string[]
  notes: string[]
}

export function parseQuery(query: string, dict: Map<string, string>): ParsedQuery {
  const text = query.normalize('NFKC').toLowerCase()
  const notes: string[] = []
  const groups: Group[] = []
  const terms: string[] = []
  const addTerm = (w: string) => { if (!terms.includes(w)) terms.push(w) }

  for (const word of (text.match(NON_CJK) ?? []).join(' ').match(WORD) ?? []) {
    if (STOP.has(word)) continue
    groups.push([[word]])
    addTerm(word)
  }
  const seg = segmentCjk(text, dict)
  for (const g of seg.groups) {
    groups.push(g)
    for (const alt of g) alt.forEach(addTerm)
  }
  if (seg.unknown.length) notes.push(`Chinese term(s) not understood and ignored: ${seg.unknown.join(', ')}`)
  return { groups, terms, notes }
}

const wordQuery = (words: string[]): Query =>
  words.length === 1 ? words[0]! : { combineWith: 'AND', queries: words }

const groupQuery = (group: Group): Query =>
  group.length === 1 ? wordQuery(group[0]!) : { combineWith: 'OR', queries: group.map(wordQuery) }

const norm = (s: string) => s.normalize('NFKC').trim().toLowerCase()

function authKind(auth: string): 'none' | 'apikey' | 'oauth' | 'other' {
  const a = auth.toLowerCase()
  return a === 'none' ? 'none' : a === 'apikey' ? 'apikey' : a === 'oauth' ? 'oauth' : 'other'
}

function toItem(e: ApiEntry, score: number): SearchItem {
  return {
    id: e.id,
    name: e.name,
    url: e.url,
    description: e.description,
    category: e.category,
    auth: e.auth,
    https: e.https,
    cors: e.cors,
    score: Math.round(score * 1000) / 1000,
    title: `${e.name} — ${e.category}`,
    snippet: `${e.description} · Auth: ${e.auth} · HTTPS: ${e.https ? 'yes' : 'no'} · CORS: ${e.cors}`,
  }
}

const byName = (a: ApiEntry, b: ApiEntry) =>
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.url.localeCompare(b.url)

export function createSearcher(snapshot: Snapshot): Searcher {
  const entries = snapshot.entries
  const byId = new Map(entries.map(e => [e.id, e]))

  const catMap = new Map<string, CategoryInfo>()
  for (const e of entries) {
    const c = catMap.get(e.categorySlug)
    if (c) c.count++
    else catMap.set(e.categorySlug, { name: e.category, slug: e.categorySlug, zh: CATEGORY_ZH[e.categorySlug]?.[0] ?? null, count: 1 })
  }
  const categoryList = [...catMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  const dict = dictionaryFor(categoryList)

  const mini = new MiniSearch<ApiEntry>({
    fields: ['name', 'category', 'description'],
    idField: 'id',
    processTerm,
    searchOptions: {
      boost: { name: 3, category: 2, description: 1 },
      prefix: term => term.length >= 3,
      fuzzy: term => (term.length >= 5 ? 0.2 : false),
    },
  })
  mini.addAll(entries)

  function resolveCategory(input: string): string {
    const q = norm(input)
    const exact = categoryList.find(c => norm(c.name) === q || c.slug === q || c.slug === q.replace(/[^a-z0-9]+/g, '-'))
    if (exact) return exact.slug
    for (const c of categoryList) if ((CATEGORY_ZH[c.slug] ?? []).some(a => a === input.trim())) return c.slug
    const prefixed = categoryList.filter(c => c.slug.startsWith(q) || c.slug.split('-').includes(q))
    if (prefixed.length === 1) return prefixed[0]!.slug
    const hint = (prefixed.length ? prefixed : categoryList).map(c => c.slug).join(', ')
    throw new InputError(`unknown or ambiguous category "${input}"; try one of: ${hint}`)
  }

  function search(query: string, opts: SearchOptions = {}): SearchResponse {
    let limit = DEFAULT_LIMIT
    if (opts.limit !== undefined) {
      if (!Number.isFinite(opts.limit) || opts.limit < 1) throw new InputError(`invalid limit: ${opts.limit}`)
      limit = Math.min(MAX_LIMIT, Math.floor(opts.limit))
    }
    const categorySlug = opts.category !== undefined && opts.category.trim() !== '' ? resolveCategory(opts.category) : undefined
    let authWant: ReturnType<typeof authKind> | undefined
    if (opts.auth !== undefined && opts.auth !== '') {
      const a = opts.auth.trim().toLowerCase()
      const map: Record<string, typeof authWant> = { none: 'none', no: 'none', apikey: 'apikey', oauth: 'oauth', other: 'other' }
      authWant = map[a]
      if (!authWant) throw new InputError(`invalid auth filter "${opts.auth}" (expected none|apikey|oauth|other)`)
    }
    let corsWant: string | undefined
    if (opts.cors !== undefined && opts.cors !== '') {
      corsWant = opts.cors.trim().toLowerCase()
      if (!['yes', 'no', 'unknown'].includes(corsWant)) throw new InputError(`invalid cors filter "${opts.cors}" (expected yes|no|unknown)`)
    }
    const passes = (e: ApiEntry) =>
      (!categorySlug || e.categorySlug === categorySlug) &&
      (!authWant || authKind(e.auth) === authWant) &&
      (opts.https === undefined || e.https === opts.https) &&
      (!corsWant || e.cors === corsWant)
    const hasFilter = !!(categorySlug || authWant || corsWant || opts.https !== undefined)

    const parsed = parseQuery(query, dict)
    const notes = [...parsed.notes]
    const respond = (matches: { entry: ApiEntry; score: number }[]): SearchResponse => ({
      query,
      terms: parsed.terms,
      total: matches.length,
      notes,
      items: matches.slice(0, limit).map(m => toItem(m.entry, m.score)),
    })

    if (parsed.groups.length === 0) {
      if (!hasFilter) {
        if (!notes.length) notes.push('empty query: nothing to search for')
        return respond([])
      }
      return respond(entries.filter(passes).sort(byName).map(entry => ({ entry, score: 0 })))
    }

    const run = (combineWith: 'AND' | 'OR') => {
      const queries = parsed.groups.map(groupQuery)
      const q: Query = queries.length === 1 ? queries[0]! : { combineWith, queries }
      const hits = mini.search(q)
      const out: { entry: ApiEntry; score: number }[] = []
      for (const h of hits) {
        const entry = byId.get(String(h.id))
        if (entry && passes(entry)) out.push({ entry, score: h.score })
      }
      return out
    }

    let matches = run('AND')
    if (matches.length === 0 && parsed.groups.length > 1) {
      matches = run('OR')
      if (matches.length) notes.push('no entry matched all terms; showing entries that match any term')
    }
    return respond(matches)
  }

  return { search, categories: () => categoryList.map(c => ({ ...c })) }
}
