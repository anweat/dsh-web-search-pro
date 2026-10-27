/**
 * The pure side of the "Search order" group: the lists it edits (engines, the backend chain of a platform), the sources one can
 * add to them, what a source is called and whether the card can tell it is ready, and the edits as text patches. No Host, no DOM:
 * the editors call these and stage the resulting text into the form model, the tests call the same functions.
 * @module web-search-pro/client/order
 */

import { BUILTIN_CLI_SPECS } from '../cli/builtin-specs.ts'
import { backendServes, CHAIN_PLATFORMS, DEFAULT_CHAINS, FIXED_BACKENDS, specPlatformsOf } from '../cli/chains-spec.ts'
import { DEFAULT_CUSTOM_CONFIDENCE, validateCliAdapterSpec } from '../cli/spec.ts'
import { SOURCE_DEFS, type SourceDef } from './field-keys.ts'
import { ANONYMOUS_SOURCES } from './sources-table.ts'

/** Dictionary-independent facts the list rows show; the names are proper names, the same in every language. */
export type SourceKind = 'keyed' | 'anonymous' | 'seam' | 'custom' | 'unknown'

export interface SourceInfo {
  id: string
  name: string
  kind: SourceKind
  /** The row of the sources list this source is (key reference, request budget), when it has one. */
  def?: SourceDef
}

/** The ctx.web engine of the Host: the default `engines` list names it (`seam`). */
export const SEAM_SOURCE = { id: 'seam', name: 'ctx.web (seam)' } as const

/** The route ids a general engine list may name: every keyed and anonymous source of the card, plus the ctx.web engine. */
export const BUILTIN_ENGINE_IDS: readonly string[] = [
  ...SOURCE_DEFS.map(def => def.id),
  ...ANONYMOUS_SOURCES.map(source => source.id).filter(id => !SOURCE_DEFS.some(def => def.id === id)),
  SEAM_SOURCE.id,
]

/** Id of a custom CLI as `engines` and `platformBackends` write it. */
export const customId = (id: string): string => 'custom-cli:' + id
export const isCustomId = (id: string): boolean => id.startsWith('custom-cli:')

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The custom CLI entries of the (staged) `cliAdapters` value, by id, in the order they were written. */
export function customEntries(cliAdapters: unknown): [string, Record<string, unknown>][] {
  return isRecord(cliAdapters) ? Object.entries(cliAdapters).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])) : []
}

/** What the list needs to know of a source id: its name and what kind it is. `cliAdapters` is the staged value (custom ids are looked up in it). */
export function sourceInfo(id: string, cliAdapters?: unknown): SourceInfo {
  const def = SOURCE_DEFS.find(entry => entry.id === id)
  if (def) return { id, name: def.name, kind: 'keyed', def }
  const anonymous = ANONYMOUS_SOURCES.find(source => source.id === id)
  if (anonymous) return { id, name: anonymous.name, kind: 'anonymous' }
  if (id === SEAM_SOURCE.id) return { id, name: SEAM_SOURCE.name, kind: 'seam' }
  if (isCustomId(id)) return { id, name: id.slice('custom-cli:'.length), kind: customEntries(cliAdapters).some(([key]) => key === id.slice('custom-cli:'.length)) ? 'custom' : 'unknown' }
  return { id, name: id, kind: 'unknown' }
}

// ── lists ────────────────────────────────────────────────────────────────────

/** The ids of a list value written as comma-separated text (`engines`), de-duplicated, in order. */
export const idsOf = (text: string): string[] => [...new Set(text.split(',').map(item => item.trim()).filter(Boolean))]
/** The text form of a list of ids. */
export const textOf = (ids: readonly string[]): string => ids.join(', ')

export function addId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? [...ids] : [...ids, id]
}

export function removeId(ids: readonly string[], id: string): string[] {
  return ids.filter(entry => entry !== id)
}

/** Move `id` one place towards the front (`-1`) or the back (`1`); at an end, or when absent, the list comes back unchanged. */
export function moveId(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const index = ids.indexOf(id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= ids.length) return [...ids]
  const out = [...ids]
  out.splice(index, 1)
  out.splice(target, 0, id)
  return out
}

/**
 * The sources that can be added to the general engine list: the built-in ones and the custom CLIs marked `engine`, those already in
 * the list left out. A custom CLI whose spec is invalid is not offered (the server would not register it).
 */
export function engineChoices(current: readonly string[], cliAdapters: unknown): string[] {
  const custom = customEntries(cliAdapters).filter(([key, raw]) => raw.engine === true && validateCliAdapterSpec({ ...raw, id: key }, 'user').ok).map(([key]) => customId(key))
  return [...BUILTIN_ENGINE_IDS, ...custom].filter(id => !current.includes(id))
}

// ── platform backend chains ─────────────────────────────────────────────────

/** Display names of the platforms that have a backend chain (proper names; the ids are what `platformBackends` is keyed by). */
export const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  xiaohongshu: '小红书', reddit: 'Reddit', twitter: 'Twitter / X', zhihu: '知乎', bilibili: 'Bilibili', youtube: 'YouTube', github: 'GitHub', 'github-issues': 'GitHub Issues',
  'github-code': 'GitHub Code', wechat: '微信公众号', omnireach: 'OmniReach', tanso: 'Tanso', instagram: 'Instagram', facebook: 'Facebook', weibo: '微博', douban: '豆瓣',
  tieba: '百度贴吧', douyin: '抖音', kuaishou: '快手',
}

/** Display names of the fixed (non-CLI) backends. */
export const BACKEND_NAMES: Readonly<Record<string, string>> = {
  opencli: 'OpenCLI', 'browser-opencli': 'dsh-browser OpenCLI', 'browser-search': 'dsh-browser search page', rest: 'REST API',
}

/** The platforms the card lists: every one with a backend chain. */
export const ORDER_PLATFORMS: readonly string[] = CHAIN_PLATFORMS

/** The built-in default chain of a platform. */
export const defaultChainOf = (platform: string): readonly string[] => DEFAULT_CHAINS[platform] ?? []

/**
 * The backends that can sit in the chain of `platform`: the built-in ones that serve it (CLI specs and the fixed backends) and the
 * custom CLIs whose spec declares the platform; those already in `current` are left out.
 */
export function backendChoices(platform: string, current: readonly string[], cliAdapters: unknown): string[] {
  const { platforms } = specPlatformsOf(cliAdapters)
  const candidates = [...BUILTIN_CLI_SPECS.map(spec => spec.id), ...FIXED_BACKENDS, ...[...platforms.keys()].filter(isCustomId)]
  return candidates.filter(id => !current.includes(id) && backendServes(id, platform, platforms).ok)
}

/** The name a backend row shows: the fixed backends and custom CLIs by name, a CLI spec by its command. */
export function backendName(id: string): string {
  if (BACKEND_NAMES[id]) return BACKEND_NAMES[id]!
  if (isCustomId(id)) return id.slice('custom-cli:'.length)
  return BUILTIN_CLI_SPECS.find(spec => spec.id === id)?.bins[0] ?? id
}

/** The `platformBackends` value of the staged text as an object (undefined when it is empty or not an object). */
export function chainsOf(text: string): Record<string, string[]> | undefined {
  if (text.trim() === '') return {}
  try {
    const value = JSON.parse(text) as unknown
    if (!isRecord(value)) return undefined
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string[]] => Array.isArray(entry[1])))
  } catch { return undefined }
}

/**
 * `platformBackends` text with the chain of `platform` set to `ids`, or the platform's key removed (`ids` undefined: back to the
 * default chain). Other platforms, and keys this card does not know, are kept as they were. The empty object comes back as
 * the empty text, which the form model stores as "not set".
 */
export function withChain(text: string, platform: string, ids: readonly string[] | undefined): string | undefined {
  let value: Record<string, unknown>
  if (text.trim() === '') value = {}
  else {
    try {
      const parsed = JSON.parse(text) as unknown
      if (!isRecord(parsed)) return undefined
      value = { ...parsed }
    } catch { return undefined }
  }
  if (ids === undefined) delete value[platform]
  else value[platform] = [...ids]
  return Object.keys(value).length === 0 ? '' : JSON.stringify(value, null, 2)
}

// ── custom CLI rows ─────────────────────────────────────────────────────────

export interface CustomRow {
  id: string
  bin: string
  engine: boolean
  platforms: string[]
  confidence: number
  /** The validation problems of the entry (empty = the spec is valid and the server registers it). */
  problems: string[]
}

/** One row per custom CLI of the staged `cliAdapters` value: what the list shows, with the server's own validation. */
export function customRows(cliAdapters: unknown): CustomRow[] {
  return customEntries(cliAdapters).map(([id, raw]) => {
    const checked = validateCliAdapterSpec({ ...raw, id }, 'user')
    const bins = Array.isArray(raw.bins) ? raw.bins.filter((bin): bin is string => typeof bin === 'string') : []
    return {
      id,
      bin: bins[0] ?? '',
      engine: raw.engine === true,
      platforms: Array.isArray(raw.platforms) ? raw.platforms.filter((p): p is string => typeof p === 'string') : [],
      confidence: typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? raw.confidence : DEFAULT_CUSTOM_CONFIDENCE,
      problems: checked.errors,
    }
  })
}

// ── which platforms the list shows ───────────────────────────────────────────

/** The platforms people reach for most: listed even when nothing was changed for them. */
export const COMMON_PLATFORMS: readonly string[] = ['xiaohongshu', 'zhihu', 'reddit', 'twitter', 'bilibili', 'youtube', 'github', 'wechat']

/**
 * Which platforms the list shows up front, and which fold into "show the rest": a platform is shown when its chain was changed
 * (`platformBackends` has its key), when a valid custom CLI declares it, or when it is one of the common ones. Both halves keep the
 * order of `platforms`. `platformBackends` is the staged text; when it is not valid JSON nothing counts as changed.
 */
export function splitPlatforms(platforms: readonly string[], platformBackends: string, cliAdapters: unknown): { shown: string[]; rest: string[] } {
  const changed = new Set(Object.keys(chainsOf(platformBackends) ?? {}))
  const declared = new Set(customRows(cliAdapters).filter(row => row.problems.length === 0).flatMap(row => row.platforms))
  const shown: string[] = []
  const rest: string[] = []
  for (const platform of platforms) (changed.has(platform) || declared.has(platform) || COMMON_PLATFORMS.includes(platform) ? shown : rest).push(platform)
  return { shown, rest }
}

/** The platforms whose display name or id contains `query` (case-insensitive, surrounding spaces ignored); an empty query keeps all. */
export function filterPlatforms(platforms: readonly string[], query: string): string[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...platforms]
  return platforms.filter(platform => platform.toLowerCase().includes(needle) || (PLATFORM_NAMES[platform] ?? '').toLowerCase().includes(needle))
}

// ── the confidence box of a row ──────────────────────────────────────────────

export interface ConfidenceView {
  /** The value the row runs with: the typed override when it is a number, else the source's default. */
  effective: number
  /** The text is not a number in 0-1. */
  invalid: boolean
  /** Whether the row has its own value in the draft (the box is not empty). */
  typed: boolean
  /** The value changes nothing (it is 1) and is not wrong: the row shows it as a quiet "default" until someone opens it. */
  quiet: boolean
}

/** What the confidence box of a row shows, from the staged text of `sources.confidence.<id>` and the default of the source. */
export function confidenceView(text: string, defaultValue: number): ConfidenceView {
  const trimmed = text.trim()
  const typed = trimmed !== ''
  const number = typed ? Number(trimmed) : NaN
  const invalid = typed && !(Number.isFinite(number) && number >= 0 && number <= 1)
  const effective = typed && !invalid ? number : defaultValue
  return { effective, invalid, typed, quiet: !invalid && effective === 1 }
}
