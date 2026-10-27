/**
 * The agent overlay, pure half: the shapes the overlay file, the `config.*` actions and the settings card's RPC channel carry, and
 * the small helpers that name an overlay entry. The store that reads and writes the file is overlay.ts (Node); the card bundle
 * includes only this file. No imports.
 *
 * The overlay is a small managed file next to the plugin's database. It sits on top of the configuration the user owns (the
 * profile) and can hold only the settings an agent may change at run time: the engine order, the source priority and disabled
 * lists, the confidence of a source, the backend chain of a platform, and custom CLI adapter specs. Everything else stays
 * the user's: an agent cannot reach a key, a path, a switch or a budget through it.
 * @module web-search-pro/overlay-types
 */

export const OVERLAY_VERSION = 1
export const OVERLAY_FILE = 'overlay.json'
/** The audit trail is cut to the newest entries, so the file stays small however long it lives. */
export const MAX_AUDIT_ENTRIES = 50
export const MIN_REASON = 3
export const MAX_REASON = 300
/** What `config.reset` can drop. */
export const RESET_SCOPES = ['all', 'order', 'confidence', 'cli', 'platform'] as const
export type ResetScope = typeof RESET_SCOPES[number]

/** The overlaid values, in the shape of the configuration fields they sit on. Absent = the baseline applies. */
export interface OverlayValues {
  /** The whole `engines` list. */
  engines?: string[]
  sources?: {
    priority?: string[]
    disabled?: string[]
    /** Per source or backend id. */
    confidence?: Record<string, number>
  }
  /** Per platform, the whole backend chain. */
  platformBackends?: Record<string, string[]>
  /** Per id, the whole adapter spec (without its `id`, which is the key). */
  cliAdapters?: Record<string, Record<string, unknown>>
}

/** One line of the audit trail: what a key was before and after, as short text. */
export interface AuditChange { key: string; before: string; after: string }

export interface AuditEntry {
  /** The revision this change produced. */
  revision: number
  at: string
  /** `agent`: a `config.*` action. `user`: the settings card. */
  actor: 'agent' | 'user'
  action: string
  sessionId?: string
  reason: string
  changes: AuditChange[]
}

export type OverlayItemKind = 'engines' | 'priority' | 'disabled' | 'confidence' | 'platform' | 'cli'

/** One overridden key, for the card and `config.inspect`. */
export interface OverlayItem {
  /** `engines`, `sources.priority`, `sources.disabled`, `sources.confidence.<id>`, `platformBackends.<platform>`, `cliAdapters.<id>`. */
  key: string
  kind: OverlayItemKind
  /** The id, platform or adapter id the key is about. */
  target?: string
  /** The overlaid value. */
  value: unknown
  /** Short text of the overlaid value. */
  summary: string
  /** Short text of what the baseline holds there, for the card. */
  baseline: string
  /** The newest audit entry that touched this key (absent when it has rotated out of the trail). */
  at?: string
  reason?: string
  actor?: AuditEntry['actor']
  sessionId?: string
}

/** What the card reads over RPC (`overlay` endpoint) and `config.inspect` extends. */
export interface OverlayView {
  file: string
  revision: number
  updatedAt: string
  /** The overlay file loads and agrees with the baseline; false = it is being ignored as a whole. */
  valid: boolean
  problem?: string
  items: OverlayItem[]
  audit: AuditEntry[]
}

/** One setting that was changed in the configuration but the running plugin still uses the value it started with. */
export interface PendingRestart {
  field: string
  /** The value in force (what the plugin started with), as short text. */
  running: string
  /** The value in the configuration now, as short text. */
  configured: string
}

/** The keys an overlay holds, in a stable order. */
export function overlayKeys(values: OverlayValues): string[] {
  const keys: string[] = []
  if (values.engines !== undefined) keys.push('engines')
  if (values.sources?.priority !== undefined) keys.push('sources.priority')
  if (values.sources?.disabled !== undefined) keys.push('sources.disabled')
  for (const id of Object.keys(values.sources?.confidence ?? {})) keys.push('sources.confidence.' + id)
  for (const platform of Object.keys(values.platformBackends ?? {})) keys.push('platformBackends.' + platform)
  for (const id of Object.keys(values.cliAdapters ?? {})) keys.push('cliAdapters.' + id)
  return keys
}

/** Kind and target of an overlay key; undefined for a name that is not one. */
export function describeKey(key: string): { kind: OverlayItemKind; target?: string } | undefined {
  if (key === 'engines') return { kind: 'engines' }
  if (key === 'sources.priority') return { kind: 'priority' }
  if (key === 'sources.disabled') return { kind: 'disabled' }
  let match = /^sources\.confidence\.(.+)$/.exec(key)
  if (match) return { kind: 'confidence', target: match[1]! }
  match = /^platformBackends\.(.+)$/.exec(key)
  if (match) return { kind: 'platform', target: match[1]! }
  match = /^cliAdapters\.(.+)$/.exec(key)
  if (match) return { kind: 'cli', target: match[1]! }
  return undefined
}

export function clipText(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

/**
 * Short text of a value for the audit trail and the card: a list is its items joined with `>` (order matters), a number is itself,
 * a CLI spec is its command and search arguments (what the program is and what it is asked), nothing is `(none)`.
 */
export function summarizeValue(key: string, value: unknown, max = 160): string {
  if (value === undefined || value === null) return '(none)'
  if (Array.isArray(value)) return clipText(value.length ? value.map(String).join(' > ') : '(empty)', max)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return clipText(value, max)
  if (typeof value === 'object' && key.startsWith('cliAdapters.')) return clipText(cliCommandLine(value as Record<string, unknown>), max)
  try { return clipText(JSON.stringify(value), max) } catch { return '(unprintable)' }
}

/** `<bins[0]> <search.argv...>`: the command a custom CLI spec would run for a search, with the placeholders as written. */
export function cliCommandLine(spec: Record<string, unknown>): string {
  const bins = Array.isArray(spec.bins) ? spec.bins.filter((bin): bin is string => typeof bin === 'string') : []
  const search = spec.search !== null && typeof spec.search === 'object' ? spec.search as Record<string, unknown> : {}
  const argv = Array.isArray(search.argv) ? search.argv.filter((token): token is string => typeof token === 'string') : []
  return [bins.join('|') || '(no command)', ...argv].join(' ')
}
