import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { BUILTIN_RUBRIC_IDS, builtinDef, type RubricKind } from '../pipeline/rubrics-spec.ts'
import type { Context } from './context-types.ts'
import {
  CREDENTIAL_IDS, FIELD_SPECS, KEYED_SPECS, PATH_SPECS, applyOps, credentialRef, deepMerge, getAt, hasAt, isPathSpec, isRecord,
  rubricField, rubricSpec,
  type CredentialId, type FieldSpec, type FieldWrite, type Json, type PathOp, type PathSpec, type RootKey, type SettingField,
} from './form-specs.ts'
import { evidenceIssues, nextVersion, providerChoices, unknownRubricIds, type Issue } from './validators.ts'

export { CREDENTIAL_IDS, FIELD_SPECS, KEYED_SPECS, PATH_SPECS }
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
interface Analysis { settings: PlanItem[]; issues: Issue[]; blocked: Set<SettingField>; evidence: Json }

const ROOTS: readonly RootKey[] = ['evidence', 'provider', 'keyedSources']

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

const SPECS: readonly FieldSpec[] = [...FIELD_SPECS, ...PATH_SPECS, ...KEYED_SPECS, ...BUILTIN_RUBRIC_IDS.map(rubricSpec)]
const SPEC_BY_FIELD = new Map<SettingField, FieldSpec>(SPECS.map(spec => [spec.field, spec]))

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
      for (const item of plan) {
        if (item.write === undefined) { landed = false; break }
        if (item.write.kind === 'clear') {
          await this.scope.unset(item.target)
          landed = !this.storedTop(item.target) && landed
        } else {
          await this.scope.set(item.target, item.write.value)
          landed = same(this.userLayer()?.[item.target], item.write.value) && landed
        }
      }

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
    const credentialsDirty = this.credentialPlan().length > 0
    return {
      available: this.scope.getSnapshot().status === 'ready',
      writable: this.scope.getSnapshot().writable,
      dirty: analysis.settings.length > 0 || credentialsDirty,
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
    const ops = new Map<RootKey, { ops: PathOp[]; invalid: boolean }>()
    const staged = new Set<SettingField>()
    for (const [field, draft] of this.staged) {
      const spec = this.spec(field)
      if (!isPathSpec(spec)) {
        if (draft.clear) {
          if (this.stored(field)) settings.push({ target: field, write: { kind: 'clear' } })
          continue
        }
        if (draft.text === spec.format(this.sectionValue(field))) continue
        settings.push({ target: field, write: spec.parse(draft.text) })
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
      else if (Object.keys(next).length > 0) settings.push({ target: root, write: { kind: 'set', value: next } })
      else if (this.storedTop(root)) settings.push({ target: root, write: { kind: 'clear' } })
    }

    // Effective evidence settings of the draft: the composition layer under the user layer as it would be written.
    const base = (this.scope.getSnapshot().base as Record<string, unknown> | undefined)?.evidence
    const evidence = deepMerge(isRecord(base) ? base : {}, candidates.get('evidence')) as Json
    const issues = evidenceIssues(evidence)
    // An error blocks the save when the person is editing what it is about; otherwise it is shown as it stands.
    const blocked = new Set<SettingField>()
    for (const issue of issues) {
      if (issue.level === 'error' && (staged.has(issue.field) || (issue.related ?? []).some(related => staged.has(related)))) blocked.add(issue.field)
    }
    return { settings, issues, blocked, evidence }
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

  private spec(field: SettingField): FieldSpec {
    const spec = SPEC_BY_FIELD.get(field)
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
