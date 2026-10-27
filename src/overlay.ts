/**
 * The agent overlay: the settings an agent may change at run time without hand-editing the configuration.
 *
 * The profile configuration stays the user's baseline. The overlay is a small managed file next to the plugin's database
 * (`$DSH_HOME/data/web-search-pro/overlay.json`, or beside `dbPath` when the user moved it) that `dynamic()` merges on top of the
 * baseline on every read, so every consumer sees the change at once, with no watcher and no restart. It holds only what
 * overlay-types.ts lists (engine order, source priority / disabled, confidence, platform backend chains, custom CLI specs),
 * carries a revision for optimistic locking, a checksum, and an audit trail cut to {@link MAX_AUDIT_ENTRIES} entries.
 *
 * The same functions validate a change before it is written and the whole file when it is loaded: a file that does not parse,
 * fails its checksum, holds a value the validators refuse, or no longer agrees with the baseline (a chain naming a CLI the user
 * removed) is ignored as a whole and reported, never half applied. Validation reuses the functions the settings card and
 * `sources.status` use (`cliIssues`, `sourcesIssues`, the CLI spec validator, the source id rules).
 *
 * Adding or replacing only: the overlay never deletes a baseline entry. Taking a baseline CLI out of service is
 * `sources.disabled`; removing a CLI the overlay added is `config.remove_cli`.
 * @module web-search-pro/overlay
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ActionArgError, ActionConflictError, ActionNotFoundError, ActionUnavailableError } from './actions/types.ts'
import { isBackendId } from './cli/chains-spec.ts'
import { resolveCliAdapters, validateCliAdapterSpec } from './cli/spec.ts'
import { cliIssues, sourcesIssues } from './client/validators.ts'
import type { ResolvedConfig } from './config.ts'
import {
  describeKey, MAX_AUDIT_ENTRIES, MAX_REASON, MIN_REASON, OVERLAY_FILE, OVERLAY_VERSION, overlayKeys, summarizeValue,
  type AuditChange, type AuditEntry, type OverlayItem, type OverlayValues, type OverlayView, type ResetScope,
} from './overlay-types.ts'
import { resolveSources } from './pipeline/sources-spec.ts'

export { MAX_AUDIT_ENTRIES, OVERLAY_FILE, OVERLAY_VERSION }

// ── limits ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const MAX_ENGINES = 40
const MAX_LIST = 40
const MAX_CONFIDENCE = 60
const MAX_PLATFORMS = 30
const MAX_BACKENDS = 12
const MAX_CLI = 10
const MAX_SPEC_BYTES = 16_384
const MAX_FILE_BYTES = 1_048_576
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype'])
/** A source, backend or platform id as the configuration writes it (`github-issues`, `custom-cli:mine`). */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$/
/** An adapter id (the key of `cliAdapters`): the rule of the spec validator. */
const CLI_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,39}$/
const CUSTOM_PREFIX = 'custom-cli:'

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const nullRecord = <T>(): Record<string, T> => Object.create(null) as Record<string, T>
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

// ── the file ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Overlay {
  version: 1
  revision: number
  updatedAt: string
  values: OverlayValues
  audit: AuditEntry[]
}

export function emptyOverlay(): Overlay {
  return { version: OVERLAY_VERSION, revision: 0, updatedAt: new Date(0).toISOString(), values: {}, audit: [] }
}

export function checksumOf(overlay: Pick<Overlay, 'version' | 'revision' | 'updatedAt' | 'values' | 'audit'>): string {
  const canonical = JSON.stringify({ version: overlay.version, revision: overlay.revision, updatedAt: overlay.updatedAt, values: overlay.values, audit: overlay.audit })
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

/** `<dir of dbPath>/overlay.json`: the overlay sits beside the database, wherever the user put it. */
export function overlayFileFor(dbPath: string): string {
  return path.join(path.dirname(dbPath), OVERLAY_FILE)
}

// ── the merge ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Parts {
  engines: string[]
  priority: string[]
  disabled: string[]
  confidence: Record<string, number>
  platformBackends: Record<string, string[]>
  cliAdapters: Record<string, Record<string, unknown>>
}

function partsOf(base: ResolvedConfig, values: OverlayValues): Parts {
  return {
    engines: [...values.engines ?? base.engines],
    priority: [...values.sources?.priority ?? base.sources.priority],
    disabled: [...values.sources?.disabled ?? base.sources.disabled],
    confidence: { ...base.sources.confidence, ...values.sources?.confidence },
    platformBackends: { ...base.platformBackends, ...values.platformBackends },
    cliAdapters: { ...base.cliAdapters, ...values.cliAdapters },
  }
}

/** The baseline with the overlay merged on top. Never mutates its inputs. */
export function mergeOverlay(base: ResolvedConfig, values: OverlayValues): ResolvedConfig {
  if (overlayKeys(values).length === 0) return base
  const parts = partsOf(base, values)
  return {
    ...base,
    engines: parts.engines,
    sources: { ...base.sources, priority: parts.priority, disabled: parts.disabled, confidence: parts.confidence },
    ...Object.keys(parts.platformBackends).length ? { platformBackends: parts.platformBackends } : {},
    ...Object.keys(parts.cliAdapters).length ? { cliAdapters: parts.cliAdapters } : {},
  }
}

/** Where the effective value of an overlay key comes from, and what it is. */
export function effectiveValueOf(config: ResolvedConfig, key: string): unknown {
  const info = describeKey(key)
  if (!info) return undefined
  switch (info.kind) {
    case 'engines': return config.engines
    case 'priority': return config.sources.priority
    case 'disabled': return config.sources.disabled
    case 'confidence': return config.sources.confidence[info.target!]
    case 'platform': return config.platformBackends?.[info.target!]
    case 'cli': return config.cliAdapters?.[info.target!]
  }
}

// ── validation (one set of functions for a change and for the whole file) ──────────────────────────────────────────────────

/** The id rules of the sources the baseline knows; supplied by the router (`registry.routeId(id) !== undefined`). */
export type KnownSource = (id: string) => boolean

function errorsOf(parts: Parts, known: KnownSource): string[] {
  const errors = new Set<string>()
  const specs = resolveCliAdapters(parts.cliAdapters).specs
  const customOk = (id: string): boolean => id.startsWith(CUSTOM_PREFIX) && specs.has(id.slice(CUSTOM_PREFIX.length))
  if (parts.engines.length === 0) errors.add('engines must list at least one source id')
  for (const id of parts.engines) {
    if (!ID_PATTERN.test(id)) errors.add('engines: "' + id + '" is not a source id')
    else if (id.startsWith(CUSTOM_PREFIX)) {
      const spec = specs.get(id.slice(CUSTOM_PREFIX.length))
      if (!spec) errors.add('engines: "' + id + '" names a custom CLI that is not defined (cliAdapters.' + id.slice(CUSTOM_PREFIX.length) + ')')
      else if (spec.engine !== true) errors.add('engines: "' + id + '" is a custom CLI without "engine": true, so it cannot be a general engine')
    } else if (!known(id)) errors.add('engines: "' + id + '" is not a registered source')
  }
  const sources = { priority: parts.priority, disabled: parts.disabled, confidence: parts.confidence }
  const sourceKnown = (id: string): boolean => known(id) || customOk(id)
  const backendKnown = (id: string): boolean => isBackendId(id) && (!id.startsWith(CUSTOM_PREFIX) || customOk(id))
  for (const message of resolveSources(sources, sourceKnown, backendKnown).diagnostics) if (!message.includes('both prioritised and disabled')) errors.add(message)
  for (const issue of sourcesIssues(sources)) if (issue.level === 'error') errors.add(issue.message)
  for (const issue of cliIssues(parts.platformBackends, parts.cliAdapters)) if (issue.level === 'error') errors.add(issue.message)
  return [...errors]
}

/** Problems the overlay values add to what the baseline already has (the user's own mistakes are not the overlay's to answer for). */
export function overlayErrors(base: ResolvedConfig, values: OverlayValues, known: KnownSource): string[] {
  const own = new Set(errorsOf(partsOf(base, {}), known))
  return errorsOf(partsOf(base, values), known).filter(message => !own.has(message))
}

function checkId(id: unknown, what: string, pattern = ID_PATTERN): string {
  if (typeof id !== 'string' || !pattern.test(id) || FORBIDDEN_IDS.has(id)) throw new ActionArgError(what + ' must be an id such as ' + (pattern === CLI_ID_PATTERN ? '"my-tool" (lower case letters, digits, . _ -, at most 40)' : '"ddg" or "custom-cli:my-tool"') + ', got ' + JSON.stringify(id))
  return id
}

function checkList(value: unknown, what: string, max: number, options: { min?: number } = {}): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new ActionArgError(what + ' must be a list of source ids')
  if (value.length > max) throw new ActionArgError(what + ' may hold at most ' + max + ' ids')
  if ((options.min ?? 0) > value.length) throw new ActionArgError(what + ' must list at least ' + options.min + ' id')
  const ids = (value as string[]).map(item => item.trim())
  ids.forEach(id => checkId(id, what + ' entry'))
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index)
  if (duplicate !== undefined) throw new ActionArgError(what + ' lists "' + duplicate + '" twice')
  return ids
}

/** Reason rule shared by every write: a real sentence, not a placeholder. */
export function checkReason(reason: unknown): string {
  const text = typeof reason === 'string' ? reason.trim() : ''
  if (text.length < MIN_REASON || text.length > MAX_REASON) throw new ActionArgError('reason must be ' + MIN_REASON + '-' + MAX_REASON + ' characters: say why the setting changes (it is recorded in the audit trail)')
  return text
}

/** Shape of the stored values: keys, types, sizes. Throws a plain Error naming the problem (used for the whole file). */
function checkShape(values: unknown): OverlayValues {
  if (!isRecord(values)) throw new Error('values is not an object')
  for (const key of Object.keys(values)) if (!['engines', 'sources', 'platformBackends', 'cliAdapters'].includes(key)) throw new Error('unknown key "' + key + '" in values')
  const out: OverlayValues = {}
  const wrap = <T>(fn: () => T): T => {
    try { return fn() } catch (error) { throw new Error(error instanceof Error ? error.message : String(error)) }
  }
  if (values.engines !== undefined) out.engines = wrap(() => checkList(values.engines, 'engines', MAX_ENGINES, { min: 1 }))
  if (values.sources !== undefined) {
    const sources = values.sources
    if (!isRecord(sources)) throw new Error('sources is not an object')
    for (const key of Object.keys(sources)) if (!['priority', 'disabled', 'confidence'].includes(key)) throw new Error('unknown key "' + key + '" in sources')
    out.sources = {}
    if (sources.priority !== undefined) out.sources.priority = wrap(() => checkList(sources.priority, 'sources.priority', MAX_LIST))
    if (sources.disabled !== undefined) out.sources.disabled = wrap(() => checkList(sources.disabled, 'sources.disabled', MAX_LIST))
    if (sources.confidence !== undefined) {
      if (!isRecord(sources.confidence)) throw new Error('sources.confidence is not an object')
      const entries = Object.entries(sources.confidence)
      if (entries.length > MAX_CONFIDENCE) throw new Error('too many confidence entries')
      const confidence = nullRecord<number>()
      for (const [id, value] of entries) {
        wrap(() => checkId(id, 'sources.confidence key'))
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('sources.confidence.' + id + ' is not a number 0..1')
        confidence[id] = value
      }
      out.sources.confidence = { ...confidence }
    }
    if (Object.keys(out.sources).length === 0) delete out.sources
  }
  if (values.platformBackends !== undefined) {
    if (!isRecord(values.platformBackends)) throw new Error('platformBackends is not an object')
    const entries = Object.entries(values.platformBackends)
    if (entries.length > MAX_PLATFORMS) throw new Error('too many platforms')
    const chains = nullRecord<string[]>()
    for (const [platform, ids] of entries) {
      wrap(() => checkId(platform, 'platformBackends key'))
      chains[platform] = wrap(() => checkList(ids, 'platformBackends.' + platform, MAX_BACKENDS))
    }
    out.platformBackends = { ...chains }
  }
  if (values.cliAdapters !== undefined) {
    if (!isRecord(values.cliAdapters)) throw new Error('cliAdapters is not an object')
    const entries = Object.entries(values.cliAdapters)
    if (entries.length > MAX_CLI) throw new Error('too many custom CLIs (at most ' + MAX_CLI + ')')
    const specs = nullRecord<Record<string, unknown>>()
    for (const [id, spec] of entries) {
      wrap(() => checkId(id, 'cliAdapters key', CLI_ID_PATTERN))
      if (!isRecord(spec) || 'id' in spec) throw new Error('cliAdapters.' + id + ' is not a spec object without an id')
      if (JSON.stringify(spec).length > MAX_SPEC_BYTES) throw new Error('cliAdapters.' + id + ' is too large')
      const checked = validateCliAdapterSpec({ ...spec, id }, 'user')
      if (!checked.ok) throw new Error('cliAdapters.' + id + ' is not a valid spec: ' + checked.errors.slice(0, 3).join('; '))
      specs[id] = spec
    }
    out.cliAdapters = { ...specs }
  }
  return out
}

function checkAudit(audit: unknown): AuditEntry[] {
  if (!Array.isArray(audit) || audit.length > MAX_AUDIT_ENTRIES) throw new Error('bad audit')
  return audit.map((entry): AuditEntry => {
    if (!isRecord(entry) || typeof entry.action !== 'string' || typeof entry.reason !== 'string' || typeof entry.at !== 'string' || !Number.isInteger(entry.revision)
      || (entry.actor !== 'agent' && entry.actor !== 'user') || !Array.isArray(entry.changes)) throw new Error('bad audit entry')
    const changes = entry.changes.map((change): AuditChange => {
      if (!isRecord(change) || typeof change.key !== 'string' || typeof change.before !== 'string' || typeof change.after !== 'string') throw new Error('bad audit change')
      return { key: change.key, before: change.before, after: change.after }
    })
    return { revision: entry.revision as number, at: entry.at, actor: entry.actor, action: entry.action, ...typeof entry.sessionId === 'string' ? { sessionId: entry.sessionId } : {}, reason: entry.reason, changes }
  })
}

// ── changes ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type OverlayChange =
  | { kind: 'order'; engines?: unknown; priority?: unknown; disabled?: unknown; platform?: unknown; backends?: unknown }
  | { kind: 'confidence'; id: unknown; value: unknown }
  | { kind: 'upsertCli'; id: unknown; spec: unknown }
  | { kind: 'removeCli'; id: unknown }
  | { kind: 'reset'; scope: ResetScope; id?: unknown }
  /** The settings card: drop these keys (one or several), or everything when `keys` is `'all'`. */
  | { kind: 'revoke'; keys: readonly string[] | 'all' }

export interface ChangeMeta {
  actor: 'agent' | 'user'
  /** The action name (`config.set_order`) or the card's button. */
  action: string
  reason: string
  sessionId?: string
  /** When given, the change only applies if the overlay is still at this revision. */
  expectedRevision?: number
}

export interface AppliedChange {
  /** False when the change left the overlay as it was (nothing was written, the revision is unchanged). */
  changed: boolean
  revision: number
  keys: string[]
  changes: AuditChange[]
  audit?: AuditEntry
}

export interface OverlayStoreOptions {
  file: string
  /** The configuration the user owns (the profile), re-read on every call. */
  baseline: () => ResolvedConfig
  known: KnownSource
  /** Changes whenever the answer of `known` can have changed (the router's registry revision), so a cached verdict is not kept past it. */
  knownSignature?: () => string
  now?: () => Date
}

export class OverlayStore {
  private overlay: Overlay = emptyOverlay()
  private signature = ''
  private loadProblem: string | undefined
  private compat: { signature: string; errors: string[] } | undefined

  constructor(private readonly options: OverlayStoreOptions) {
    this.reload()
  }

  get file(): string { return this.options.file }

  // -- reading ------------------------------------------------------------------------------------------------------------

  private stat(): string {
    try {
      const stat = fs.statSync(this.options.file)
      return stat.mtimeMs + ':' + stat.size
    } catch { return 'missing' }
  }

  /** Re-read the file when its mtime or size changed. No watcher: every read of the effective config asks. */
  private refresh(): void {
    if (this.stat() !== this.signature) this.reload()
  }

  private reload(): void {
    this.signature = this.stat()
    this.loadProblem = undefined
    this.compat = undefined
    if (this.signature === 'missing') { this.overlay = emptyOverlay(); return }
    try {
      this.overlay = this.parse(this.readFile())
    } catch (error) {
      // Not fail-open: the baseline applies and the problem is visible. The file stays in place for inspection.
      this.overlay = emptyOverlay()
      this.loadProblem = 'the overlay file ' + this.options.file + ' was ignored and the configuration applies as written: ' + String(error instanceof Error ? error.message : error).slice(0, 300)
    }
  }

  private readFile(): string {
    const size = fs.statSync(this.options.file).size
    if (size > MAX_FILE_BYTES) throw new Error('the file is larger than ' + MAX_FILE_BYTES + ' bytes')
    return fs.readFileSync(this.options.file, 'utf8')
  }

  /** Strict parse: unknown keys, wrong types, a failed checksum or any value the validators refuse reject the whole file. */
  private parse(text: string): Overlay {
    let raw: unknown
    try { raw = JSON.parse(text) } catch { throw new Error('the file is not valid JSON') }
    if (!isRecord(raw)) throw new Error('the file is not an object')
    for (const key of Object.keys(raw)) if (!['version', 'revision', 'updatedAt', 'values', 'audit', 'checksum'].includes(key)) throw new Error('unknown key "' + key + '"')
    if (raw.version !== OVERLAY_VERSION) throw new Error('unsupported version')
    if (!Number.isInteger(raw.revision) || (raw.revision as number) < 0) throw new Error('bad revision')
    if (typeof raw.updatedAt !== 'string') throw new Error('bad updatedAt')
    const audit = checkAudit(raw.audit)
    const body = { version: OVERLAY_VERSION as 1, revision: raw.revision as number, updatedAt: raw.updatedAt, values: raw.values as OverlayValues, audit }
    if (typeof raw.checksum !== 'string' || raw.checksum !== checksumOf(body)) throw new Error('the checksum does not match: the file was edited outside the plugin')
    return { ...body, values: checkShape(raw.values) }
  }

  /** Why the overlay is being ignored, if it is: a broken file, or values that no longer agree with the baseline. */
  get problem(): string | undefined {
    this.refresh()
    return this.loadProblem ?? this.incompatibility()
  }

  private incompatibility(): string | undefined {
    if (this.loadProblem || overlayKeys(this.overlay.values).length === 0) return undefined
    const base = this.options.baseline()
    const signature = this.overlay.revision + '|' + (this.options.knownSignature?.() ?? '') + '|' + JSON.stringify(partsOf(base, {}))
    if (this.compat?.signature !== signature) this.compat = { signature, errors: overlayErrors(base, this.overlay.values, this.options.known) }
    return this.compat.errors.length
      ? 'the overlay (revision ' + this.overlay.revision + ') no longer agrees with the configuration and is ignored as a whole: ' + this.compat.errors.slice(0, 3).join('; ') + (this.compat.errors.length > 3 ? ' (+' + (this.compat.errors.length - 3) + ' more)' : '')
      : undefined
  }

  /** The loaded overlay (an empty one while the file is missing or ignored). */
  current(): Overlay {
    this.refresh()
    return this.overlay
  }

  /** The configuration as the plugin runs it: the baseline with the overlay on top, or the baseline alone while the overlay is ignored. */
  effective(): ResolvedConfig {
    const base = this.options.baseline()
    this.refresh()
    if (this.loadProblem || overlayKeys(this.overlay.values).length === 0 || this.incompatibility()) return base
    return mergeOverlay(base, this.overlay.values)
  }

  baselineConfig(): ResolvedConfig { return this.options.baseline() }

  /** The overlaid keys with the newest audit entry that touched each, for the card and `config.inspect`. */
  items(): OverlayItem[] {
    const overlay = this.current()
    const base = this.options.baseline()
    return overlayKeys(overlay.values).map((key): OverlayItem => {
      const info = describeKey(key)!
      const value = effectiveValueOf(mergeOverlay(base, overlay.values), key)
      const latest = [...overlay.audit].reverse().find(entry => entry.changes.some(change => change.key === key))
      return {
        key, kind: info.kind, ...info.target ? { target: info.target } : {}, value,
        summary: summarizeValue(key, value), baseline: summarizeValue(key, effectiveValueOf(base, key)),
        ...latest ? { at: latest.at, reason: latest.reason, actor: latest.actor, ...latest.sessionId ? { sessionId: latest.sessionId } : {} } : {},
      }
    })
  }

  view(limit = 10): OverlayView {
    const problem = this.problem
    const overlay = this.current()
    return {
      file: this.options.file, revision: overlay.revision, updatedAt: overlay.updatedAt, valid: problem === undefined, ...problem ? { problem } : {},
      items: this.items(), audit: overlay.audit.slice(-Math.max(1, Math.min(MAX_AUDIT_ENTRIES, limit))).reverse(),
    }
  }

  // -- writing ------------------------------------------------------------------------------------------------------------

  /** Compute the values a change leads to without writing anything. Throws {@link ActionArgError} for an invalid change. */
  private plan(change: OverlayChange, base: ResolvedConfig): OverlayValues {
    const values: OverlayValues = structuredClone(this.overlay.values)
    const sources = (): NonNullable<OverlayValues['sources']> => (values.sources ??= {})
    const here = overlayKeys(values)
    switch (change.kind) {
      case 'order': {
        const given = [change.engines, change.priority, change.disabled, change.platform, change.backends].some(value => value !== undefined)
        if (!given) throw new ActionArgError('give at least one of engines, priority, disabled, or platform with backends')
        if ((change.platform === undefined) !== (change.backends === undefined)) throw new ActionArgError('platform and backends go together: name the platform and give its whole backend chain')
        if (change.engines !== undefined) values.engines = checkList(change.engines, 'engines', MAX_ENGINES, { min: 1 })
        if (change.priority !== undefined) sources().priority = checkList(change.priority, 'priority', MAX_LIST)
        if (change.disabled !== undefined) sources().disabled = checkList(change.disabled, 'disabled', MAX_LIST)
        if (change.platform !== undefined) {
          const platform = checkId(change.platform, 'platform')
          ;(values.platformBackends ??= {})[platform] = checkList(change.backends, 'backends', MAX_BACKENDS)
        }
        break
      }
      case 'confidence': {
        const id = checkId(change.id, 'id')
        if (change.value === null) {
          if (values.sources?.confidence && id in values.sources.confidence) delete values.sources.confidence[id]
          break
        }
        if (typeof change.value !== 'number' || !Number.isFinite(change.value) || change.value < 0 || change.value > 1) throw new ActionArgError('value must be a number 0..1, or null to drop the overlay entry of ' + id)
        ;(sources().confidence ??= {})[id] = change.value
        break
      }
      case 'upsertCli': {
        const id = checkId(change.id, 'id', CLI_ID_PATTERN)
        if (!isRecord(change.spec)) throw new ActionArgError('spec must be an adapter spec object (see the cliAdapters setting)')
        if (change.spec.id !== undefined && change.spec.id !== id) throw new ActionArgError('spec.id must equal id ("' + id + '") or be left out')
        const { id: _id, ...spec } = change.spec
        if (JSON.stringify(spec).length > MAX_SPEC_BYTES) throw new ActionArgError('spec is larger than ' + MAX_SPEC_BYTES + ' bytes')
        const checked = validateCliAdapterSpec({ ...spec, id }, 'user')
        if (!checked.ok) throw new ActionArgError('spec is not valid: ' + checked.errors.slice(0, 5).join('; '), 'Fix the spec and call again; the same rules apply as in the settings card (read-only commands only, no login or write words, no cookie flags, no secrets).')
        if (!(id in (values.cliAdapters ?? {})) && Object.keys(values.cliAdapters ?? {}).length >= MAX_CLI) throw new ActionArgError('the overlay holds at most ' + MAX_CLI + ' custom CLIs')
        ;(values.cliAdapters ??= {})[id] = spec
        break
      }
      case 'removeCli': {
        const id = checkId(change.id, 'id', CLI_ID_PATTERN)
        if (!values.cliAdapters || !(id in values.cliAdapters)) {
          throw new ActionNotFoundError('the overlay holds no custom CLI "' + id + '"', base.cliAdapters && id in base.cliAdapters
            ? 'It comes from the configuration, which an agent cannot remove. To stop using it, add custom-cli:' + id + ' to sources.disabled with config.set_order.'
            : 'config.inspect lists the CLIs the overlay added.')
        }
        delete values.cliAdapters[id]
        break
      }
      case 'reset': {
        const drop = (what: string, present: boolean): void => { if (change.id !== undefined && !present) throw new ActionNotFoundError('the overlay has no ' + what + ' "' + String(change.id) + '"', 'config.inspect lists what the overlay holds.') }
        if (change.scope === 'all') { delete values.engines; delete values.sources; delete values.platformBackends; delete values.cliAdapters; break }
        if (change.scope === 'order') { delete values.engines; if (values.sources) { delete values.sources.priority; delete values.sources.disabled } break }
        if (change.scope === 'confidence') {
          const map = values.sources?.confidence
          if (change.id !== undefined) { const id = checkId(change.id, 'id'); drop('confidence entry', !!map && id in map); if (map) delete map[id] } else if (values.sources) delete values.sources.confidence
          break
        }
        if (change.scope === 'cli') {
          const map = values.cliAdapters
          if (change.id !== undefined) { const id = checkId(change.id, 'id', CLI_ID_PATTERN); drop('custom CLI', !!map && id in map); if (map) delete map[id] } else delete values.cliAdapters
          break
        }
        const map = values.platformBackends
        if (change.id !== undefined) { const id = checkId(change.id, 'id'); drop('platform chain', !!map && id in map); if (map) delete map[id] } else delete values.platformBackends
        break
      }
      case 'revoke': {
        if (change.keys === 'all') { delete values.engines; delete values.sources; delete values.platformBackends; delete values.cliAdapters; break }
        for (const key of change.keys) {
          if (!here.includes(key)) throw new ActionNotFoundError('the overlay holds no "' + key + '"')
          const info = describeKey(key)!
          if (info.kind === 'engines') delete values.engines
          else if (info.kind === 'priority') delete values.sources?.priority
          else if (info.kind === 'disabled') delete values.sources?.disabled
          else if (info.kind === 'confidence') delete values.sources?.confidence?.[info.target!]
          else if (info.kind === 'platform') delete values.platformBackends?.[info.target!]
          else delete values.cliAdapters?.[info.target!]
        }
        break
      }
    }
    return this.normalize(values, base)
  }

  /** Drop empty containers, and entries equal to the baseline (an override that changes nothing is not one). */
  private normalize(values: OverlayValues, base: ResolvedConfig): OverlayValues {
    if (values.engines && same(values.engines, base.engines)) delete values.engines
    if (values.sources) {
      if (values.sources.priority && same(values.sources.priority, base.sources.priority)) delete values.sources.priority
      if (values.sources.disabled && same(values.sources.disabled, base.sources.disabled)) delete values.sources.disabled
      for (const [id, value] of Object.entries(values.sources.confidence ?? {})) if (base.sources.confidence[id] === value) delete values.sources.confidence![id]
      if (values.sources.confidence && Object.keys(values.sources.confidence).length === 0) delete values.sources.confidence
      if (Object.keys(values.sources).length === 0) delete values.sources
    }
    for (const [platform, ids] of Object.entries(values.platformBackends ?? {})) if (base.platformBackends?.[platform] && same(base.platformBackends[platform], ids)) delete values.platformBackends![platform]
    if (values.platformBackends && Object.keys(values.platformBackends).length === 0) delete values.platformBackends
    for (const [id, spec] of Object.entries(values.cliAdapters ?? {})) if (base.cliAdapters?.[id] && same({ ...base.cliAdapters[id], id: undefined }, { ...spec, id: undefined })) delete values.cliAdapters![id]
    if (values.cliAdapters && Object.keys(values.cliAdapters).length === 0) delete values.cliAdapters
    return values
  }

  /**
   * Plan, validate and write a change: re-reads the file first, checks the revision, validates the merged result with the
   * server's own functions, writes atomically (0600) and appends the audit entry. A failed change leaves the file as it was.
   */
  apply(change: OverlayChange, meta: ChangeMeta): AppliedChange {
    this.refresh()
    const wholeReset = (change.kind === 'reset' && change.scope === 'all') || (change.kind === 'revoke' && change.keys === 'all')
    let quarantined = false
    if (this.loadProblem) {
      if (!wholeReset) throw new ActionUnavailableError('the overlay file is unreadable and is being ignored (the configuration applies as written), so it cannot be changed: ' + this.loadProblem, 'Nothing was changed. Call config.reset {scope:"all", reason:...} (or ask the user to use "Revoke all" in the settings card) to move the bad file aside, then repeat this change.')
      this.quarantine()
      quarantined = true
    }
    if (meta.expectedRevision !== undefined && meta.expectedRevision !== this.overlay.revision) {
      throw new ActionConflictError('the overlay is at revision ' + this.overlay.revision + ', not ' + meta.expectedRevision + ': it changed since it was read', 'Call config.inspect, look at what changed, and decide again.')
    }
    const reason = checkReason(meta.reason)
    const base = this.options.baseline()
    const stale = this.incompatibility()
    // A stale overlay can only be taken back (reset / revoke), not added to.
    if (stale && change.kind !== 'reset' && change.kind !== 'revoke') {
      throw new ActionUnavailableError('the overlay no longer agrees with the configuration, so it cannot be changed: ' + stale, 'Nothing was changed. Call config.reset (scope all, or the scope that holds the stale entry) first.')
    }
    const before = this.overlay.values
    const next = this.plan(change, base)
    if (same(before, next) && !quarantined) return { changed: false, revision: this.overlay.revision, keys: [], changes: [] }
    const errors = overlayErrors(base, next, this.options.known)
    if (errors.length) {
      throw new ActionArgError('the change is refused, the overlay stays as it was: ' + errors.slice(0, 4).join('; ') + (errors.length > 4 ? ' (+' + (errors.length - 4) + ' more)' : ''),
        'Fix the values (config.inspect shows what is in force, the settings card the same rules) and call again.')
    }
    const keys = [...new Set([...overlayKeys(before), ...overlayKeys(next)])].filter(key => !same(presenceOf(before, key), presenceOf(next, key)))
    const changes = keys.map((key): AuditChange => ({
      key, before: summarizeValue(key, effectiveValueOf(mergeOverlay(base, before), key)), after: summarizeValue(key, effectiveValueOf(mergeOverlay(base, next), key)),
    }))
    if (quarantined) changes.push({ key: '(overlay file)', before: 'unreadable', after: 'moved aside, a fresh overlay started' })
    const at = (this.options.now?.() ?? new Date()).toISOString()
    const audit: AuditEntry = {
      revision: this.overlay.revision + 1, at, actor: meta.actor, action: meta.action, ...meta.sessionId ? { sessionId: meta.sessionId } : {}, reason, changes: changes.slice(0, 20),
    }
    const written: Overlay = { version: OVERLAY_VERSION, revision: audit.revision, updatedAt: at, values: next, audit: [...this.overlay.audit, audit].slice(-MAX_AUDIT_ENTRIES) }
    this.write(written)
    return { changed: true, revision: written.revision, keys, changes, audit }
  }

  private write(overlay: Overlay): void {
    const dir = path.dirname(this.options.file)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const temporary = this.options.file + '.tmp-' + crypto.randomUUID().slice(0, 8)
    try {
      fs.writeFileSync(temporary, JSON.stringify({ ...overlay, checksum: checksumOf(overlay) }, null, 2), { encoding: 'utf8', mode: 0o600 })
      fs.renameSync(temporary, this.options.file)
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }) } catch { /* nothing to clean */ }
      throw error
    }
    this.overlay = overlay
    this.signature = this.stat()
    this.loadProblem = undefined
    this.compat = undefined
  }

  /** Move an unreadable file aside (kept for inspection) so a fresh overlay can start. */
  private quarantine(): void {
    try { fs.renameSync(this.options.file, this.options.file + '.corrupt-' + Date.now()) } catch { /* nothing to move */ }
    this.overlay = emptyOverlay()
    this.loadProblem = undefined
    this.compat = undefined
    this.signature = this.stat()
  }
}

/** Whether the overlay holds a key (and its value), so a key that the overlay just stopped holding counts as changed even when it falls back to an equal value. */
function presenceOf(values: OverlayValues, key: string): unknown {
  const info = describeKey(key)
  if (!info) return undefined
  switch (info.kind) {
    case 'engines': return values.engines
    case 'priority': return values.sources?.priority
    case 'disabled': return values.sources?.disabled
    case 'confidence': return values.sources?.confidence?.[info.target!]
    case 'platform': return values.platformBackends?.[info.target!]
    case 'cli': return values.cliAdapters?.[info.target!]
  }
}
