import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context } from './context-types.ts'

export type SettingField =
  | 'engines' | 'parallelEngines' | 'searchMaxResults' | 'timeoutMs'
  | 'exaApiKeyEnv' | 'jinaApiKeyEnv' | 'githubTokenEnv'
  | 'enableCliBackends' | 'opencliEnabled' | 'agentReachEnabled'
  | 'providerId' | 'registerProvider' | 'playwright'
  | 'ttlSeconds' | 'memoryCacheEntries' | 'rrfConstant'
  | 'freshnessBoost' | 'freshnessDays' | 'authorityBoost' | 'authorityDomains'
  | 'dbPath' | 'allowProxyFakeIp' | 'platformRules' | 'customPlatforms' | 'browserBindings' | 'verbose'

export type CredentialId = 'exa' | 'jina' | 'github'

export interface CardFieldState {
  text: string
  overridden: boolean
  invalid: boolean
}

export interface CredentialState {
  text: string
  configured: boolean
  writable: boolean
  loading: boolean
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
}

type FieldWrite = { kind: 'set'; value: unknown } | { kind: 'clear' }
interface FieldSpec {
  field: SettingField
  format(value: unknown): string
  parse(text: string): FieldWrite | undefined
}
interface Draft { text: string; clear: boolean }

const textField = (field: SettingField, required = false): FieldSpec => ({
  field,
  format: value => typeof value === 'string' ? value : '',
  parse(text) {
    const value = text.trim()
    if (value.length === 0) return required ? undefined : { kind: 'clear' }
    return { kind: 'set', value }
  },
})

const numberField = (
  field: SettingField,
  options: { min?: number; max?: number; integer?: boolean } = {},
): FieldSpec => ({
  field,
  format: value => typeof value === 'number' && Number.isFinite(value) ? String(value) : '',
  parse(text) {
    if (text.trim() === '') return { kind: 'clear' }
    const value = Number(text)
    if (!Number.isFinite(value)) return undefined
    if (options.integer && !Number.isInteger(value)) return undefined
    if (options.min !== undefined && value < options.min) return undefined
    if (options.max !== undefined && value > options.max) return undefined
    return { kind: 'set', value }
  },
})

const booleanField = (field: SettingField): FieldSpec => ({
  field,
  format: value => value === true ? 'true' : 'false',
  parse: text => text === 'true' || text === 'false'
    ? { kind: 'set', value: text === 'true' }
    : undefined,
})

const csvField = (field: SettingField, required = false): FieldSpec => ({
  field,
  format: value => Array.isArray(value) ? value.filter(item => typeof item === 'string').join(', ') : '',
  parse(text) {
    const values = [...new Set(text.split(',').map(item => item.trim()).filter(Boolean))]
    if (values.length === 0 && required) return undefined
    return { kind: 'set', value: values }
  },
})

const jsonField = (field: SettingField, required = false): FieldSpec => ({
  field,
  format: value => value && typeof value === 'object' && !Array.isArray(value)
    ? JSON.stringify(value, null, 2)
    : '',
  parse(text) {
    if (text.trim() === '') return required ? undefined : { kind: 'clear' }
    try {
      const value = JSON.parse(text) as unknown
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
      return { kind: 'set', value }
    } catch {
      return undefined
    }
  },
})

export const FIELD_SPECS: readonly FieldSpec[] = [
  csvField('engines', true),
  booleanField('parallelEngines'),
  numberField('searchMaxResults', { min: 1, max: 20, integer: true }),
  numberField('timeoutMs', { min: 1_000, integer: true }),
  textField('exaApiKeyEnv', true),
  textField('jinaApiKeyEnv', true),
  textField('githubTokenEnv', true),
  booleanField('enableCliBackends'),
  booleanField('opencliEnabled'),
  booleanField('agentReachEnabled'),
  textField('providerId', true),
  booleanField('registerProvider'),
  jsonField('playwright', true),
  numberField('ttlSeconds', { min: 0, integer: true }),
  numberField('memoryCacheEntries', { min: 1, integer: true }),
  numberField('rrfConstant', { min: 1 }),
  numberField('freshnessBoost', { min: 0, max: 1 }),
  numberField('freshnessDays', { min: 1 }),
  numberField('authorityBoost', { min: 0, max: 1 }),
  csvField('authorityDomains'),
  textField('dbPath'),
  booleanField('allowProxyFakeIp'),
  jsonField('platformRules'),
  jsonField('customPlatforms'),
  jsonField('browserBindings'),
  booleanField('verbose'),
] as const

const SPEC_BY_FIELD = new Map(FIELD_SPECS.map(spec => [spec.field, spec]))
const REF_FIELDS: Record<CredentialId, SettingField> = {
  exa: 'exaApiKeyEnv',
  jina: 'jinaApiKeyEnv',
  github: 'githubTokenEnv',
}
const DEFAULT_REFS: Record<CredentialId, string> = {
  exa: 'EXA_API_KEY',
  jina: 'JINA_API_KEY',
  github: 'GITHUB_TOKEN',
}

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

export class WebSearchSettingsController {
  private readonly staged = new Map<SettingField, Draft>()
  private readonly secretDrafts = new Map<CredentialId, string>()
  private readonly listeners = new Set<() => void>()
  private readonly store: SnapshotStore<WebSearchCardState>
  private readonly unsubscribe: () => void
  private saving = false
  private failed = false
  private credentialGeneration = 0
  private credentialRefSignature = ''
  private credentialStates: Record<CredentialId, Omit<CredentialState, 'text'>> = {
    exa: { configured: false, writable: true, loading: true },
    jina: { configured: false, writable: true, loading: true },
    github: { configured: false, writable: true, loading: true },
  }

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

  discard(): void {
    this.staged.clear()
    this.secretDrafts.clear()
    this.failed = false
    this.publish()
  }

  async save(): Promise<void> {
    const plan = this.plan()
    const invalid = plan.settings.some(item => item.write === undefined)
    if (this.saving || invalid || (plan.settings.length === 0 && plan.credentials.length === 0)) return
    this.saving = true
    this.failed = false
    this.publish()

    let landed = true
    try {
      for (const item of plan.settings) {
        if (item.write === undefined) { landed = false; break }
        if (item.write.kind === 'clear') {
          await this.scope.unset(item.field)
          landed = !this.stored(item.field) && landed
        } else {
          await this.scope.set(item.field, item.write.value)
          landed = same(this.userLayer()?.[item.field], item.write.value) && landed
        }
      }

      if (landed) {
        for (const id of plan.credentials) {
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
    }
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  async refreshCredentials(): Promise<void> {
    const generation = ++this.credentialGeneration
    const refs = this.credentialRefs()
    this.credentialRefSignature = stable(refs)
    for (const id of Object.keys(refs) as CredentialId[]) this.credentialStates[id].loading = true
    this.publish()
    const response = await this.ctx.remote.credentials.describe(Object.values(refs))
    if (generation !== this.credentialGeneration) return
    if (response.ok) {
      for (const id of Object.keys(refs) as CredentialId[]) {
        const view = response.value[refs[id]]
        this.credentialStates[id] = {
          configured: view?.configured ?? false,
          writable: view?.writable ?? true,
          loading: false,
        }
      }
    } else {
      for (const id of Object.keys(refs) as CredentialId[]) this.credentialStates[id].loading = false
    }
    if (generation === this.credentialGeneration) this.publish()
  }

  dispose(): void {
    this.unsubscribe()
    this.listeners.clear()
    this.credentialGeneration += 1
  }

  private project(): WebSearchCardState {
    const fields = {} as Record<SettingField, CardFieldState>
    for (const spec of FIELD_SPECS) fields[spec.field] = this.field(spec.field)
    const settingsPlan = this.plan().settings
    return {
      available: this.scope.getSnapshot().status === 'ready',
      writable: this.scope.getSnapshot().writable,
      dirty: settingsPlan.length > 0 || [...this.secretDrafts.values()].some(value => value.trim() !== ''),
      invalid: settingsPlan.some(item => item.write === undefined),
      saving: this.saving,
      failed: this.failed,
      fields,
      credentials: {
        exa: { text: this.secretDrafts.get('exa') ?? '', ...this.credentialStates.exa },
        jina: { text: this.secretDrafts.get('jina') ?? '', ...this.credentialStates.jina },
        github: { text: this.secretDrafts.get('github') ?? '', ...this.credentialStates.github },
      },
    }
  }

  private field(field: SettingField): CardFieldState {
    const spec = this.spec(field)
    const draft = this.staged.get(field)
    if (draft === undefined) {
      return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false }
    }
    const write = draft.clear ? { kind: 'clear' as const } : spec.parse(draft.text)
    return { text: draft.text, overridden: write?.kind === 'set', invalid: write === undefined }
  }

  private plan(): { settings: { field: SettingField; write: FieldWrite | undefined }[]; credentials: CredentialId[] } {
    const settings: { field: SettingField; write: FieldWrite | undefined }[] = []
    for (const [field, draft] of this.staged) {
      const spec = this.spec(field)
      if (draft.clear) {
        if (this.stored(field)) settings.push({ field, write: { kind: 'clear' } })
        continue
      }
      if (draft.text === spec.format(this.sectionValue(field))) continue
      settings.push({ field, write: spec.parse(draft.text) })
    }
    const credentials = ([...this.secretDrafts] as [CredentialId, string][])
      .filter(([, value]) => value.trim() !== '')
      .map(([id]) => id)
    return { settings, credentials }
  }

  private async writeCredential(id: CredentialId, value: string): Promise<boolean> {
    const ref = this.credentialRefs()[id]
    const written = await this.ctx.remote.credentials.set(ref, value)
    if (!written.ok) return false
    const response = await this.ctx.remote.credentials.describe([ref])
    return response.ok && (response.value[ref]?.configured ?? false)
  }

  private credentialRefs(): Record<CredentialId, string> {
    const value = this.scope.getSnapshot().value ?? {}
    return Object.fromEntries((Object.keys(REF_FIELDS) as CredentialId[]).map((id) => {
      const candidate = value[REF_FIELDS[id]]
      return [id, typeof candidate === 'string' && candidate.trim() !== '' ? candidate : DEFAULT_REFS[id]]
    })) as Record<CredentialId, string>
  }

  private spec(field: SettingField): FieldSpec {
    const spec = SPEC_BY_FIELD.get(field)
    if (!spec) throw new Error(`unknown web-search-pro settings field: ${field}`)
    return spec
  }

  private sectionValue(field: SettingField): unknown {
    return this.scope.getSnapshot().value?.[field]
  }

  private baseValue(field: SettingField): unknown {
    return (this.scope.getSnapshot().base as Record<string, unknown> | undefined)?.[field]
  }

  private userLayer(): Record<string, unknown> | undefined {
    return this.scope.getSnapshot().user as Record<string, unknown> | undefined
  }

  private stored(field: SettingField): boolean {
    const user = this.userLayer()
    return user !== undefined && Object.hasOwn(user, field)
  }

  private publish(): void {
    this.store.set(this.project())
    for (const listener of this.listeners) listener()
  }
}
