import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { normalizeCoverage, normalizeJudge, normalizeRubrics } from '../config-fillers.ts'
import { BUILTIN_RUBRIC_IDS, builtinDef, type RubricKind } from '../pipeline/rubrics-spec.ts'
import type { Context } from './context-types.ts'
import {
  BUDGET_SPECS, CREDENTIAL_IDS, CONFIDENCE_PREFIX, FIELD_SPECS, KEYED_SPECS, PATH_SPECS, applyOps, confidenceSpec, credentialRef, deepMerge, getAt, hasAt, isPathSpec, isRecord,
  rubricField, rubricSpec,
  type CredentialId, type FieldSpec, type FieldWrite, type Json, type PathOp, type PathSpec, type RootKey, type SettingField,
} from './form-specs.ts'
import { cliIssues, evidenceIssues, sourcesIssues, nextVersion, providerChoices, unknownRubricIds, type Issue } from './validators.ts'

export { BUDGET_SPECS, CREDENTIAL_IDS, FIELD_SPECS, KEYED_SPECS, PATH_SPECS }
export type { CredentialId, SettingField }

export interface CardFieldState {
  text: string
  overridden: boolean
  invalid: boolean
  /** What is wrong with the value, as the server's own validation words it (shown instead of the hint). */
  message?: string
  /** Accepted, but unlikely to do what was meant (shown next to the hint). */
  warning?: string
}

export interface CredentialState {
  text: string
  configured: boolean
  writable: boolean
  loading: boolean
}

/** What the rubric editor edits of one override entry, as draft text. */
export const RUBRIC_TEXT_KEYS = ['version', 'instructions', 'criteria', 'maxStateChars', 'maxCandidateChars'] as const
export type RubricTextKey = typeof RUBRIC_TEXT_KEYS[number]

export interface RubricCardState {
  id: string
  kind: RubricKind
  description: string
  builtin: { version: string; instructions: string; criteria: string[]; maxStateChars: number; maxCandidateChars: number }
  /** Version in effect: the override's when it is valid, else the built-in's. */
  activeVersion: string
  /** An override entry exists (stored or being drafted). */
  editing: boolean
  /** The entry's fields as text; `criteria` is one level per line. */
  entry: Record<RubricTextKey, string>
  /** Whether the entry is stored in the user layer. */
  overridden: boolean
  invalid: boolean
  problems: string[]
}

export interface WebSearchCardState {
  available: boolean
  writable: boolean
  dirty: boolean
  /** How many staged edits a save would write: fields whose draft differs from what is stored, plus pending secrets. */
  changes: number
  invalid: boolean
  saving: boolean
  failed: boolean
  fields: Record<SettingField, CardFieldState>
  credentials: Record<CredentialId, CredentialState>
  /** Ids the judge / coverage provider controls offer: the presets plus the valid custom entries of the draft. */
  providerChoices: string[]
  rubrics: RubricCardState[]
  /** Overrides in settings that name no built-in rubric. */
  unknownRubrics: string[]
}

interface Draft { text: string; clear: boolean }
/** One Host write: a whole top-level config field. */
interface PlanItem { target: string; write: FieldWrite | undefined }
/** One edit as the Host's `mutate` takes it: a value set, or a field put back to what it inherits, at a path from the section root. */
type SectionOp = { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }
interface Analysis { settings: PlanItem[]; ops: SectionOp[]; issues: Issue[]; blocked: Set<SettingField>; evidence: Json }

const ROOTS: readonly RootKey[] = ['evidence', 'provider', 'keyedSources', 'sources']
/** Top-level fields that are objects whose keys, not the object, are the live (volatile) settings of the plugin schema. */
const CONTAINER_FIELDS: readonly string[] = ['playwright']

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function same(left: unknown, right: unknown): boolean {
  return stable(left) === stable(right)
}

const SPECS: readonly FieldSpec[] = [...FIELD_SPECS, ...PATH_SPECS, ...KEYED_SPECS, ...BUDGET_SPECS, ...BUILTIN_RUBRIC_IDS.map(rubricSpec)]
/** Every field spec of the form model, in display order. */
export const ALL_SPECS: readonly FieldSpec[] = SPECS
const SPEC_BY_FIELD = new Map<SettingField, FieldSpec>(SPECS.map(spec => [spec.field, spec]))
/** The dynamic fields (one `sources.confidence.<id>` per source id) made so far: a field is the same object every time it is asked for. */
const DYNAMIC_SPECS = new Map<string, FieldSpec>()

/** The spec of a field that is not in the fixed list: `sources.confidence.<id>`; undefined for any other name. */
function dynamicSpec(field: string): FieldSpec | undefined {
  if (!field.startsWith(CONFIDENCE_PREFIX) || field.length === CONFIDENCE_PREFIX.length) return undefined
  const known = DYNAMIC_SPECS.get(field)
  if (known) return known
  const spec = confidenceSpec(field.slice(CONFIDENCE_PREFIX.length))
  DYNAMIC_SPECS.set(field, spec)
  return spec
}

/** The specs of the dynamic fields among `fields` (the text view prints them next to the fixed ones). */
export function dynamicSpecsOf(fields: Readonly<Record<string, unknown>>): FieldSpec[] {
  return Object.keys(fields).filter(field => !SPEC_BY_FIELD.has(field as SettingField)).flatMap(field => dynamicSpec(field) ?? [])
}

function createLocalStore<T>(initial: T): SnapshotStore<T> {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next) {
      snapshot = next
      for (const listener of listeners) listener()
    },
    update(updater) {
      const draft = structuredClone(snapshot)
      updater(draft)
      snapshot = draft
      for (const listener of listeners) listener()
    },
  }
}

const emptyCredentials = (): Record<CredentialId, Omit<CredentialState, 'text'>> =>
  Object.fromEntries(CREDENTIAL_IDS.map(id => [id, { configured: false, writable: true, loading: true }])) as Record<CredentialId, Omit<CredentialState, 'text'>>

export class WebSearchSettingsController {
  private readonly staged = new Map<SettingField, Draft>()
  private readonly secretDrafts = new Map<CredentialId, string>()
  /** The criteria textarea of a rubric as typed: blank lines must survive while the person is still typing. */
  private readonly criteriaRaw = new Map<string, string>()
  private readonly listeners = new Set<() => void>()
  private readonly store: SnapshotStore<WebSearchCardState>
  private readonly unsubscribe: () => void
  private saving = false
  private failed = false
  private credentialGeneration = 0
  private credentialRefSignature = ''
  private credentialStates = emptyCredentials()

  constructor(
    private readonly scope: ConfigForm<Record<string, unknown>>,
    private readonly ctx: Context,
  ) {
    this.store = createLocalStore(this.project())
    this.unsubscribe = scope.subscribe(() => {
      this.publish()
      const signature = stable(this.credentialRefs())
      if (signature !== this.credentialRefSignature) void this.refreshCredentials()
    })
    void this.refreshCredentials()
  }

  inject() {
    return {
      hooks: { webSearchPro: this.store },
      edit: (field: SettingField, text: string) => { this.edit(field, text) },
      resetField: (field: SettingField) => { this.resetField(field) },
      editCredential: (id: CredentialId, text: string) => { this.editCredential(id, text) },
      editRubric: (id: string, key: RubricTextKey, text: string) => { this.editRubric(id, key, text) },
      startRubric: (id: string) => { this.startRubric(id) },
      restoreRubric: (id: string) => { this.restoreRubric(id) },
      save: () => { void this.save() },
      discard: () => { this.discard() },
      refreshCredentials: () => { void this.refreshCredentials() },
    }
  }

  snapshot(): WebSearchCardState {
    return this.store.getSnapshot()
  }

  edit(field: SettingField, text: string): void {
    this.staged.set(field, { text, clear: false })
    this.failed = false
    this.publish()
  }

  resetField(field: SettingField): void {
    const spec = this.spec(field)
    this.staged.set(field, { text: spec.format(this.baseValue(field)), clear: true })
    this.failed = false
    this.publish()
  }

  editCredential(id: CredentialId, text: string): void {
    this.secretDrafts.set(id, text)
    this.failed = false
    this.publish()
  }

  // --- rubric editor: structured controls over one staged JSON entry ----------------------------------------------

  /** The entry the editor shows: the staged draft when there is one, else what is stored; undefined = no override. */
  private rubricEntry(id: string): Json | undefined {
    const text = this.fieldState(rubricField(id)).text
    if (text.trim() === '') return undefined
    try {
      const value = JSON.parse(text) as unknown
      return isRecord(value) ? value : undefined
    } catch { return undefined }
  }

  private stageRubric(id: string, entry: Json | undefined): void {
    const field = rubricField(id)
    const spec = this.spec(field)
    this.staged.set(field, { text: entry && Object.keys(entry).length ? spec.format(entry) : '', clear: false })
    this.failed = false
    this.publish()
  }

  editRubric(id: string, key: RubricTextKey, text: string): void {
    const entry: Json = structuredClone(this.rubricEntry(id) ?? {})
    if (key === 'criteria') {
      this.criteriaRaw.set(id, text)
      const levels = text.split('\n').map(line => line.trim()).filter(Boolean)
      if (levels.length) entry.criteria = levels; else delete entry.criteria
    } else if (text.trim() === '') {
      delete entry[key]
    } else if (key === 'maxStateChars' || key === 'maxCandidateChars') {
      // A value that is not a number stays text, so the shared validation names it instead of the card guessing.
      entry[key] = Number.isFinite(Number(text)) ? Number(text) : text
    } else {
      entry[key] = key === 'version' ? text.trim() : text
    }
    this.stageRubric(id, entry)
  }

  /** Start an override from the built-in text under the next version label. */
  startRubric(id: string): void {
    const base = builtinDef(id)
    if (!base) return
    this.criteriaRaw.delete(id)
    this.stageRubric(id, {
      version: nextVersion(base.version),
      instructions: base.instructions,
      ...base.criteria ? { criteria: [...base.criteria] } : {},
      maxStateChars: base.maxStateChars,
      maxCandidateChars: base.maxCandidateChars,
    })
  }

  /** Restore default: the override entry is removed on save (the built-in applies again). */
  restoreRubric(id: string): void {
    this.criteriaRaw.delete(id)
    this.resetField(rubricField(id))
  }

  discard(): void {
    this.staged.clear()
    this.secretDrafts.clear()
    this.criteriaRaw.clear()
    this.failed = false
    this.publish()
  }

  async save(): Promise<void> {
    const analysis = this.analyze()
    const plan = analysis.settings
    const invalid = plan.some(item => item.write === undefined) || analysis.blocked.size > 0
    const credentials = this.credentialPlan()
    if (this.saving || invalid || (plan.length === 0 && credentials.length === 0)) return
    this.saving = true
    this.failed = false
    this.publish()

    let landed = true
    try {
      // One atomic mutation, at the paths of the fields that changed: the Host accepts an edit only beneath a field the plugin
      // declared volatile, so a whole container (`evidence`, `sources`, `playwright`) is never written as one value.
      if (analysis.ops.length > 0) landed = await this.scope.mutate(analysis.ops as Parameters<ConfigForm<Record<string, unknown>>['mutate']>[0])

      if (landed) {
        for (const id of credentials) {
          const value = this.secretDrafts.get(id)?.trim() ?? ''
          if (value === '') continue
          landed = await this.writeCredential(id, value) && landed
        }
      }
    } catch {
      landed = false
    }

    await this.refreshCredentials()
    if (landed) {
      this.staged.clear()
      this.secretDrafts.clear()
      this.criteriaRaw.clear()
    }
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  async refreshCredentials(): Promise<void> {
    const generation = ++this.credentialGeneration
    const refs = this.credentialRefs()
    this.credentialRefSignature = stable(refs)
    for (const id of CREDENTIAL_IDS) this.credentialStates[id].loading = true
    this.publish()
    const response = await this.ctx.remote.credentials.describe([...new Set(Object.values(refs))])
    if (generation !== this.credentialGeneration) return
    if (response.ok) {
      for (const id of CREDENTIAL_IDS) {
        const view = response.value[refs[id]]
        this.credentialStates[id] = {
          configured: view?.configured ?? false,
          writable: view?.writable ?? true,
          loading: false,
        }
      }
    } else {
      for (const id of CREDENTIAL_IDS) this.credentialStates[id].loading = false
    }
    if (generation === this.credentialGeneration) this.publish()
  }

  dispose(): void {
    this.unsubscribe()
    this.listeners.clear()
    this.credentialGeneration += 1
  }

  // --- projection --------------------------------------------------------------------------------------------------

  private project(): WebSearchCardState {
    const analysis = this.analyze()
    const fields = {} as Record<SettingField, CardFieldState>
    for (const spec of SPECS) fields[spec.field] = this.decorate(spec.field, this.fieldState(spec.field), analysis)
    for (const field of this.dynamicFields()) fields[field] = this.decorate(field, this.fieldState(field), analysis)
    const credentialsDirty = this.credentialPlan().length > 0
    return {
      available: this.scope.getSnapshot().status === 'ready',
      writable: this.scope.getSnapshot().writable,
      dirty: analysis.settings.length > 0 || credentialsDirty,
      changes: this.changedFields() + this.credentialPlan().length,
      invalid: analysis.settings.some(item => item.write === undefined) || analysis.blocked.size > 0,
      saving: this.saving,
      failed: this.failed,
      fields,
      credentials: Object.fromEntries(CREDENTIAL_IDS.map(id => [id, { text: this.secretDrafts.get(id) ?? '', ...this.credentialStates[id] }])) as Record<CredentialId, CredentialState>,
      providerChoices: providerChoices(getAt(analysis.evidence, ['judge', 'providers'])),
      rubrics: this.projectRubrics(fields, analysis),
      unknownRubrics: unknownRubricIds(analysis.evidence.rubrics),
    }
  }

  /** Staged fields that differ from what is stored (a pending reset counts only when something is stored). */
  private changedFields(): number {
    let count = 0
    for (const [field, draft] of this.staged) {
      const spec = this.spec(field)
      if (draft.clear) { if (this.stored(field)) count++; continue }
      if (draft.text !== spec.format(this.sectionValue(field))) count++
    }
    return count
  }

  private decorate(field: SettingField, state: CardFieldState, analysis: Analysis): CardFieldState {
    const own = analysis.issues.filter(issue => issue.field === field)
    const errors = own.filter(issue => issue.level === 'error').map(issue => issue.message)
    const warnings = own.filter(issue => issue.level === 'warning').map(issue => issue.message)
    return {
      ...state,
      invalid: state.invalid || analysis.blocked.has(field),
      ...errors.length ? { message: errors.join('\n') } : {},
      ...warnings.length ? { warning: warnings.join('\n') } : {},
    }
  }

  private projectRubrics(fields: Record<SettingField, CardFieldState>, analysis: Analysis): RubricCardState[] {
    return BUILTIN_RUBRIC_IDS.map((id) => {
      const base = builtinDef(id)!
      const field = rubricField(id)
      const entry = this.rubricEntry(id)
      const state = fields[field]
      const text = (value: unknown): string => typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''
      const problems = analysis.issues.filter(issue => issue.field === field).map(issue => issue.message)
      return {
        id,
        kind: base.kind,
        description: base.description,
        builtin: { version: base.version, instructions: base.instructions, criteria: [...base.criteria ?? []], maxStateChars: base.maxStateChars, maxCandidateChars: base.maxCandidateChars },
        activeVersion: entry !== undefined && problems.length === 0 && typeof entry.version === 'string' ? entry.version : base.version,
        editing: entry !== undefined,
        entry: {
          version: text(entry?.version),
          instructions: text(entry?.instructions),
          criteria: this.criteriaRaw.get(id) ?? (Array.isArray(entry?.criteria) ? (entry.criteria as unknown[]).map(text).join('\n') : ''),
          maxStateChars: text(entry?.maxStateChars),
          maxCandidateChars: text(entry?.maxCandidateChars),
        },
        overridden: state.overridden,
        invalid: state.invalid,
        problems: problems.flatMap(problem => problem.split('\n')),
      }
    })
  }

  /** The state of one control from the staged draft, else from the Host section. */
  private fieldState(field: SettingField): CardFieldState {
    const spec = this.spec(field)
    const draft = this.staged.get(field)
    if (draft === undefined) {
      return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false }
    }
    const write = draft.clear ? { kind: 'clear' as const } : spec.parse(draft.text)
    return { text: draft.text, overridden: write?.kind === 'set', invalid: write === undefined }
  }

  /**
   * What saving would do: the writes of the top-level fields, and for each root object (`evidence`, `provider`,
   * `keyedSources`) the one write that carries every staged field of it, built on the raw user layer. The effective
   * evidence settings the draft would produce are then checked with the server's own validators.
   */
  private analyze(): Analysis {
    const settings: PlanItem[] = []
    const sectionOps: SectionOp[] = []
    const ops = new Map<RootKey, { ops: PathOp[]; invalid: boolean }>()
    const staged = new Set<SettingField>()
    for (const [field, draft] of this.staged) {
      const spec = this.spec(field)
      if (!isPathSpec(spec)) {
        if (draft.clear) {
          if (this.stored(field)) { settings.push({ target: field, write: { kind: 'clear' } }); sectionOps.push(...this.topOps(field, { kind: 'clear' })) }
          continue
        }
        if (draft.text === spec.format(this.sectionValue(field))) continue
        const write = spec.parse(draft.text)
        settings.push({ target: field, write })
        if (write) sectionOps.push(...this.topOps(field, write))
        continue
      }
      const entry = ops.get(spec.root) ?? { ops: [], invalid: false }
      const resolved = this.resolvedRoot(spec.root)
      if (draft.clear) {
        if (this.stored(field)) { entry.ops.push(...this.opsOf(spec, { kind: 'clear' }, resolved)); staged.add(field) }
      } else if (draft.text !== spec.format(this.sectionValue(field))) {
        const write = spec.parse(draft.text)
        staged.add(field)
        if (write === undefined) entry.invalid = true
        else entry.ops.push(...this.opsOf(spec, write, resolved))
      }
      ops.set(spec.root, entry)
    }

    const user = this.userLayer() ?? {}
    const candidates = new Map<RootKey, Json>()
    for (const root of ROOTS) {
      const entry = ops.get(root)
      const stored = isRecord(user[root]) ? user[root] : undefined
      const next: Json = structuredClone(stored ?? {})
      if (entry) applyOps(next, entry.ops)
      candidates.set(root, next)
      if (entry === undefined || (!entry.invalid && same(next, stored ?? {}))) continue
      if (entry.invalid) settings.push({ target: root, write: undefined })
      else {
        if (Object.keys(next).length > 0) settings.push({ target: root, write: { kind: 'set', value: next } })
        else if (this.storedTop(root)) settings.push({ target: root, write: { kind: 'clear' } })
        // Leaf edits at their own paths; an unset of a leaf the user layer does not hold would only create empty parents.
        for (const op of entry.ops) if (op.op === 'set' || hasAt(stored ?? {}, op.path)) sectionOps.push({ ...op, path: [root, ...op.path] })
      }
    }

    // Effective evidence settings of the draft: the composition layer under the user layer as it would be written.
    const base = (this.scope.getSnapshot().base as Record<string, unknown> | undefined)?.evidence
    const merged = deepMerge(isRecord(base) ? base : {}, candidates.get('evidence')) as Json
    // The Host's schema parser fills empty containers (`thresholds: {}`, `providers`' `limits`, ...) into the base; the server drops
    // them before it validates, so the card does too: "present" must mean "given".
    const evidence: Json = {
      ...merged,
      ...isRecord(merged.judge) ? { judge: normalizeJudge(merged.judge) } : {},
      ...isRecord(merged.coverage) ? { coverage: normalizeCoverage(merged.coverage) } : {},
      ...isRecord(merged.rubrics) ? { rubrics: normalizeRubrics(merged.rubrics) } : {},
    }
    const baseSources = (this.scope.getSnapshot().base as Record<string, unknown> | undefined)?.sources
    // The CLI adapter settings are top-level fields: the draft value when staged, else what the Host section holds.
    const topValue = (field: 'platformBackends' | 'cliAdapters'): unknown => {
      const draft = this.staged.get(field)
      if (draft === undefined) return this.sectionValue(field)
      if (draft.clear) return undefined
      const write = this.spec(field).parse(draft.text)
      return write?.kind === 'set' ? write.value : undefined
    }
    const issues = [...evidenceIssues(evidence), ...sourcesIssues(deepMerge(isRecord(baseSources) ? baseSources : {}, candidates.get('sources')) as Json), ...cliIssues(topValue('platformBackends'), topValue('cliAdapters'))]
    // An error blocks the save when the person is editing what it is about; otherwise it is shown as it stands.
    const blocked = new Set<SettingField>()
    const touched = (field: SettingField): boolean => staged.has(field) || this.staged.has(field)
    for (const issue of issues) {
      if (issue.level === 'error' && (touched(issue.field) || (issue.related ?? []).some(related => touched(related)))) blocked.add(issue.field)
    }
    return { settings, ops: sectionOps, issues, blocked, evidence }
  }

  /**
   * The Host ops of a top-level field. A container the schema does not declare volatile as a whole (`playwright`: its keys are)
   * is written key by key; every other field is one `set` or one `unset`.
   */
  private topOps(field: SettingField, write: FieldWrite): SectionOp[] {
    if (!CONTAINER_FIELDS.includes(field)) return write.kind === 'clear' ? [{ op: 'unset', path: [field] }] : [{ op: 'set', path: [field], value: write.value }]
    const stored = this.userLayer()?.[field]
    const keys = isRecord(stored) ? Object.keys(stored) : []
    const value = write.kind === 'set' && isRecord(write.value) ? write.value : {}
    return [
      ...Object.entries(value).map(([key, entry]): SectionOp => ({ op: 'set', path: [field, key], value: entry })),
      ...keys.filter(key => !Object.hasOwn(value, key)).map((key): SectionOp => ({ op: 'unset', path: [field, key] })),
    ]
  }

  private opsOf(spec: PathSpec, write: FieldWrite, resolved: Json): PathOp[] {
    if (spec.ops) return spec.ops(write, { resolved })
    return write.kind === 'clear' ? [{ op: 'unset', path: [...spec.path] }] : [{ op: 'set', path: [...spec.path], value: write.value }]
  }

  private credentialPlan(): CredentialId[] {
    return ([...this.secretDrafts] as [CredentialId, string][])
      .filter(([, value]) => value.trim() !== '')
      .map(([id]) => id)
  }

  private async writeCredential(id: CredentialId, value: string): Promise<boolean> {
    const ref = this.credentialRefs()[id]
    const written = await this.ctx.remote.credentials.set(ref, value)
    if (!written.ok) return false
    const response = await this.ctx.remote.credentials.describe([ref])
    return response.ok && (response.value[ref]?.configured ?? false)
  }

  /** The credentials ref / environment variable name each key is read from, from the saved settings (else the default). */
  private credentialRefs(): Record<CredentialId, string> {
    return Object.fromEntries(CREDENTIAL_IDS.map((id) => {
      const { field, default: fallback } = credentialRef(id)
      const candidate = this.sectionValue(field)
      return [id, typeof candidate === 'string' && candidate.trim() !== '' ? candidate : fallback]
    })) as Record<CredentialId, string>
  }

  /** The `sources.confidence.<id>` fields that hold a value now or in the draft: the card shows these ids with their values. */
  private dynamicFields(): SettingField[] {
    const stored = this.scope.getSnapshot().value?.sources
    const ids = isRecord(stored) && isRecord(stored.confidence) ? Object.keys(stored.confidence) : []
    return [...new Set([...ids.map(id => CONFIDENCE_PREFIX + id), ...[...this.staged.keys()].filter(field => field.startsWith(CONFIDENCE_PREFIX))])] as SettingField[]
  }

  private spec(field: SettingField): FieldSpec {
    const spec = SPEC_BY_FIELD.get(field) ?? dynamicSpec(field)
    if (!spec) throw new Error(`unknown web-search-pro settings field: ${field}`)
    return spec
  }

  private resolvedRoot(root: RootKey): Json {
    const value = this.scope.getSnapshot().value?.[root]
    return isRecord(value) ? value : {}
  }

  private sectionValue(field: SettingField): unknown {
    const spec = this.spec(field)
    if (!isPathSpec(spec)) return this.scope.getSnapshot().value?.[field]
    const resolved = this.resolvedRoot(spec.root)
    return spec.read ? spec.read(resolved) : getAt(resolved, spec.path)
  }

  private baseValue(field: SettingField): unknown {
    const base = this.scope.getSnapshot().base as Record<string, unknown> | undefined
    const spec = this.spec(field)
    if (!isPathSpec(spec)) return base?.[field]
    const root = isRecord(base?.[spec.root]) ? base[spec.root] as Json : {}
    return spec.read ? spec.read(root) : getAt(root, spec.path)
  }

  private userLayer(): Record<string, unknown> | undefined {
    return this.scope.getSnapshot().user as Record<string, unknown> | undefined
  }

  private storedTop(key: string): boolean {
    const user = this.userLayer()
    return user !== undefined && Object.hasOwn(user, key)
  }

  private stored(field: SettingField): boolean {
    const spec = this.spec(field)
    if (!isPathSpec(spec)) return this.storedTop(field)
    const root = this.userLayer()?.[spec.root]
    if (!isRecord(root)) return false
    return spec.stored ? spec.stored(root) : hasAt(root, spec.path)
  }

  private publish(): void {
    this.store.set(this.project())
    for (const listener of this.listeners) listener()
  }
}
