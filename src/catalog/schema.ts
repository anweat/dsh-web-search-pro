/**
 * Source catalog schema (design §4.1 CatalogEntry, dev-plan M7): pure, versioned data about KNOWN search
 * sources. A catalog entry is not a provider: it never executes anything, and only an adapter registered
 * in the provider registry can run. `provider` / `platform` link an entry to the engine id / platform id
 * this plugin already implements; every other entry is "catalog only" and explains what to set up.
 * @module web-search-pro/catalog/schema
 */

import { PROFILES } from '../pipeline/types.ts'

export const CATALOG_VERSION = 1
export const SOURCE_KINDS = ['api', 'cli', 'mcp', 'browser'] as const
export const SOURCE_AUTH = ['anonymous', 'key', 'login'] as const
export const SOURCE_OPERATIONS = ['search', 'read', 'fetch', 'transcript', 'comments', 'extract', 'answer', 'trending'] as const
export const VERIFICATION_STATUSES = ['verified', 'unverified'] as const

export type SourceKind = typeof SOURCE_KINDS[number]
export type SourceAuth = typeof SOURCE_AUTH[number]
export type SourceOperation = typeof SOURCE_OPERATIONS[number]

export interface CatalogRequires {
  /** A command that must be on PATH (matches a `web_deps` id where this plugin probes it). */
  cli?: string
  /** The optional dsh-browser plugin (OpenCLI bridge, Playwright, saved logins). */
  browser?: boolean
  /** A host service (`ctx.web`). */
  service?: string
  /** A plugin setting that must be set (`searxngUrl`). */
  config?: string
}

export interface CatalogVerification {
  status: typeof VERIFICATION_STATUSES[number]
  /** `YYYY-MM-DD` of the check that earned `verified`. */
  date?: string
  /** Version of the service or tool that was checked. */
  version?: string
  note?: string
}

export interface CatalogEntry {
  /** Stable lowercase id (`wikipedia`, `opencli-zhihu`). */
  id: string
  label: string
  kind: SourceKind
  operations: SourceOperation[]
  /** `zh`, `en` or `*` (language-agnostic). */
  languages: string[]
  /** `cn`, `global`. */
  regions: string[]
  /** Task profiles the source suits (docs_code, news_fact, academic, experience, compare, general); empty = none. */
  profiles: string[]
  /** What it returns: web, code, paper, video, forum, qa, reference, social, listing, audio, files. */
  resultKinds?: string[]
  auth: SourceAuth
  /** Environment variables / credentials refs of the key (or login session). Names this plugin reads, or plans to read once an adapter exists. */
  keyEnv?: string[]
  requires?: CatalogRequires
  /** Route id of the registry provider (`web_search_pro engines=<id>`) when this plugin implements the source. */
  provider?: string
  /** Platform id of `web_platform_search` when it implements the source. */
  platform?: string
  /** How to call it when neither `provider` nor `platform` applies (e.g. through the dsh-browser OpenCLI tools). */
  invoke?: string
  /** Curation order among equals (lower first, default 50). */
  rank?: number
  /** Short install or configuration text. */
  install: string
  license: string
  /** Short cost note. */
  cost: string
  /** Shared upstream index; entries with the same family are not independent evidence. */
  sourceFamily?: string
  url?: string
  verification: CatalogVerification
  recommendedFor: string[]
  /** Counter-examples: what the source must NOT be used for. */
  notFor: string[]
}

export interface SourceCatalog {
  $schema?: string
  version: number
  updated: string
  description?: string
  entries: CatalogEntry[]
}

const ENTRY_KEYS = new Set<string>(['id', 'label', 'kind', 'operations', 'languages', 'regions', 'profiles', 'resultKinds', 'auth', 'keyEnv', 'requires', 'provider', 'platform', 'invoke', 'rank', 'install', 'license', 'cost', 'sourceFamily', 'url', 'verification', 'recommendedFor', 'notFor'])
const REQUIRES_KEYS = new Set<string>(['cli', 'browser', 'service', 'config'])
const VERIFICATION_KEYS = new Set<string>(['status', 'date', 'version', 'note'])
const TOP_KEYS = new Set<string>(['$schema', 'version', 'updated', 'description', 'entries'])
const ID_RE = /^[a-z0-9][a-z0-9-]*$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const LANGUAGES = new Set(['zh', 'en', '*'])
const MAX = { label: 80, install: 320, license: 120, cost: 200, note: 240, item: 160, url: 200 } as const

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const isString = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max

export interface CatalogValidation {
  ok: boolean
  errors: string[]
  catalog?: SourceCatalog
}

function stringList(value: unknown, path: string, errors: string[], opts: { allowed?: ReadonlySet<string>; min?: number; max?: number; pattern?: RegExp } = {}): void {
  if (!Array.isArray(value)) { errors.push(path + ' must be an array'); return }
  if (value.length < (opts.min ?? 0)) errors.push(path + ' must have at least ' + (opts.min ?? 0) + ' item(s)')
  for (const item of value) {
    if (!isString(item, opts.max ?? MAX.item)) errors.push(path + ' items must be short non-empty strings')
    else if (opts.allowed && !opts.allowed.has(item)) errors.push(path + ': unknown value "' + item + '"')
    else if (opts.pattern && !opts.pattern.test(item)) errors.push(path + ': invalid value "' + item + '"')
  }
  if (new Set(value).size !== value.length) errors.push(path + ' has duplicates')
}

function checkEntry(entry: unknown, index: number, errors: string[]): void {
  const at = 'entries[' + index + ']'
  if (!isObject(entry)) { errors.push(at + ' must be an object'); return }
  const id = typeof entry.id === 'string' ? entry.id : at
  const p = (field: string): string => id + '.' + field
  for (const key of Object.keys(entry)) if (!ENTRY_KEYS.has(key)) errors.push(p(key) + ' is not a catalog field')
  if (typeof entry.id !== 'string' || !ID_RE.test(entry.id)) errors.push(at + '.id must match ' + String(ID_RE))
  if (!isString(entry.label, MAX.label)) errors.push(p('label') + ' must be a short string')
  if (!(SOURCE_KINDS as readonly unknown[]).includes(entry.kind)) errors.push(p('kind') + ' must be one of ' + SOURCE_KINDS.join('|'))
  if (!(SOURCE_AUTH as readonly unknown[]).includes(entry.auth)) errors.push(p('auth') + ' must be one of ' + SOURCE_AUTH.join('|'))
  stringList(entry.operations, p('operations'), errors, { allowed: new Set(SOURCE_OPERATIONS), min: 1 })
  stringList(entry.languages, p('languages'), errors, { allowed: LANGUAGES, min: 1 })
  stringList(entry.regions, p('regions'), errors, { min: 1 })
  stringList(entry.profiles, p('profiles'), errors, { allowed: new Set(PROFILES) })
  if (entry.resultKinds !== undefined) stringList(entry.resultKinds, p('resultKinds'), errors)
  if (entry.keyEnv !== undefined) stringList(entry.keyEnv, p('keyEnv'), errors, { pattern: ENV_RE, min: 1 })
  if (entry.auth === 'key' && (!Array.isArray(entry.keyEnv) || !entry.keyEnv.length)) errors.push(p('keyEnv') + ' is required when auth is key')
  if (entry.requires !== undefined) {
    if (!isObject(entry.requires)) errors.push(p('requires') + ' must be an object')
    else {
      for (const key of Object.keys(entry.requires)) if (!REQUIRES_KEYS.has(key)) errors.push(p('requires.' + key) + ' is not a catalog field')
      const r = entry.requires
      for (const key of ['cli', 'service', 'config']) if (r[key] !== undefined && !isString(r[key], MAX.item)) errors.push(p('requires.' + key) + ' must be a short string')
      if (r.browser !== undefined && typeof r.browser !== 'boolean') errors.push(p('requires.browser') + ' must be a boolean')
    }
  }
  if (entry.kind === 'browser' && !(isObject(entry.requires) && entry.requires.browser === true)) errors.push(p('requires') + '.browser must be true for kind browser')
  for (const key of ['provider', 'platform']) if (entry[key] !== undefined && !(typeof entry[key] === 'string' && ID_RE.test(entry[key] as string))) errors.push(p(key) + ' must be an id')
  if (entry.invoke !== undefined && !isString(entry.invoke, MAX.install)) errors.push(p('invoke') + ' must be a short string')
  if (entry.rank !== undefined && !(typeof entry.rank === 'number' && Number.isFinite(entry.rank))) errors.push(p('rank') + ' must be a number')
  if (!isString(entry.install, MAX.install)) errors.push(p('install') + ' must be a short non-empty string')
  if (!isString(entry.license, MAX.license)) errors.push(p('license') + ' must be a short non-empty string')
  if (!isString(entry.cost, MAX.cost)) errors.push(p('cost') + ' must be a short non-empty string')
  if (entry.sourceFamily !== undefined && !(typeof entry.sourceFamily === 'string' && ID_RE.test(entry.sourceFamily))) errors.push(p('sourceFamily') + ' must be an id')
  if (entry.url !== undefined && !(isString(entry.url, MAX.url) && /^https:\/\//.test(entry.url))) errors.push(p('url') + ' must be an https URL')
  const v = entry.verification
  if (!isObject(v)) errors.push(p('verification') + ' is required')
  else {
    for (const key of Object.keys(v)) if (!VERIFICATION_KEYS.has(key)) errors.push(p('verification.' + key) + ' is not a catalog field')
    if (!(VERIFICATION_STATUSES as readonly unknown[]).includes(v.status)) errors.push(p('verification.status') + ' must be verified|unverified')
    if (v.date !== undefined && !(typeof v.date === 'string' && DATE_RE.test(v.date))) errors.push(p('verification.date') + ' must be YYYY-MM-DD')
    if (v.version !== undefined && !isString(v.version, MAX.item)) errors.push(p('verification.version') + ' must be a short string')
    if (v.note !== undefined && !isString(v.note, MAX.note)) errors.push(p('verification.note') + ' must be a short string')
    if (v.status === 'verified' && v.date === undefined && v.note === undefined) errors.push(p('verification') + ': verified needs a date or a note saying what was verified')
  }
  stringList(entry.recommendedFor, p('recommendedFor'), errors)
  stringList(entry.notFor, p('notFor'), errors)
}

/** Validate parsed catalog JSON. Closed schema: unknown fields are errors; ids are unique. Never throws. */
export function validateCatalog(data: unknown): CatalogValidation {
  const errors: string[] = []
  if (!isObject(data)) return { ok: false, errors: ['catalog must be an object'] }
  for (const key of Object.keys(data)) if (!TOP_KEYS.has(key)) errors.push('unknown top-level field ' + key)
  if (data.version !== CATALOG_VERSION) errors.push('version must be ' + CATALOG_VERSION)
  if (typeof data.updated !== 'string' || !DATE_RE.test(data.updated)) errors.push('updated must be YYYY-MM-DD')
  if (!Array.isArray(data.entries) || !data.entries.length) errors.push('entries must be a non-empty array')
  else {
    data.entries.forEach((entry, index) => checkEntry(entry, index, errors))
    const ids = data.entries.map(e => (isObject(e) ? e.id : undefined)).filter((id): id is string => typeof id === 'string')
    for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) errors.push('duplicate id ' + id)
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors, catalog: data as unknown as SourceCatalog }
}
