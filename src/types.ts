export type Cors = 'yes' | 'no' | 'unknown'

export interface ApiEntry {
  id: string
  name: string
  url: string
  description: string
  category: string
  categorySlug: string
  /** 'none' | 'apiKey' | 'OAuth' | any other raw value (e.g. 'X-Mashape-Key'). */
  auth: string
  https: boolean
  cors: Cors
}

export interface SnapshotSource {
  repo: string
  sha: string | null
  commitDate: string | null
  fetchedAt: string
  url: string
}

export interface Snapshot {
  schemaVersion: 1
  source: SnapshotSource
  entries: ApiEntry[]
}

export interface SkippedRow {
  line: number
  category: string | null
  reason: string
  text: string
}

export interface ParseResult {
  entries: ApiEntry[]
  skipped: SkippedRow[]
  /** Number of curated tables found (tables with Auth/HTTPS/CORS columns). */
  tables: number
}

export type AuthFilter = 'none' | 'apikey' | 'oauth' | 'other'

export interface SearchOptions {
  limit?: number
  category?: string
  auth?: string
  https?: boolean
  cors?: string
}

export interface SearchItem {
  id: string
  name: string
  url: string
  description: string
  category: string
  auth: string
  https: boolean
  cors: Cors
  score: number
  title: string
  snippet: string
  /** One-line hint for an agent: how (and whether) to call this API. */
  how_to_call: string
}

export interface SearchResponse {
  query: string
  /** English terms actually searched (after Chinese expansion and stopword removal). */
  terms: string[]
  total: number
  notes: string[]
  items: SearchItem[]
}

export interface CategoryInfo {
  name: string
  slug: string
  zh: string | null
  count: number
}

export interface Searcher {
  search(query: string, opts?: SearchOptions): SearchResponse
  categories(): CategoryInfo[]
  /** One entry by id, or null. */
  get(id: string): SearchItem | null
}

/** Thrown for bad user input (unknown filter value etc.): CLI exit 2, HTTP 400. */
export class InputError extends Error {
  code: string
  constructor(message: string, code = 'bad_argument') {
    super(message)
    this.name = 'InputError'
    this.code = code
  }
}
