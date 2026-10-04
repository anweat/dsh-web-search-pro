import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { WebSearchSettingsController } from '../src/client/form.ts'

/** A Host settings scope in memory: top-level `set` / `unset` like the real one, with a base (composition) and a user layer. */
export class ScopeStub implements SettingsScope<Record<string, unknown>> {
  readonly writes: string[] = []
  private readonly listeners = new Set<() => void>()
  private snapshotValue: SettingsScopeSnapshot<Record<string, unknown>>

  constructor(base: Record<string, unknown>, user: Record<string, unknown> = {}) {
    this.snapshotValue = {
      status: 'ready', value: { ...structuredClone(base), ...structuredClone(user) }, base: structuredClone(base), user: structuredClone(user),
      revision: 0, writable: true, mode: 'host',
    }
  }

  getSnapshot(): SettingsScopeSnapshot<Record<string, unknown>> { return this.snapshotValue }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  async set(field: string, value: unknown): Promise<void> {
    this.writes.push(`set:${field}`)
    const user = { ...(this.snapshotValue.user as Record<string, unknown>), [field]: structuredClone(value) }
    this.snapshotValue = {
      ...this.snapshotValue,
      value: { ...(this.snapshotValue.value ?? {}), [field]: structuredClone(value) },
      user,
      revision: (this.snapshotValue.revision ?? 0) + 1,
    }
    for (const listener of this.listeners) listener()
  }
  async unset(field: string): Promise<void> {
    this.writes.push(`unset:${field}`)
    const user = { ...(this.snapshotValue.user as Record<string, unknown>) }
    delete user[field]
    const value = { ...(this.snapshotValue.value ?? {}) }
    const base = this.snapshotValue.base as Record<string, unknown>
    if (Object.hasOwn(base, field)) value[field] = structuredClone(base[field])
    else delete value[field]
    this.snapshotValue = {
      ...this.snapshotValue, value, user, revision: (this.snapshotValue.revision ?? 0) + 1,
    }
    for (const listener of this.listeners) listener()
  }
  async dispose(): Promise<void> {}

  /** What is stored in the user layer. */
  get user(): Record<string, unknown> { return this.snapshotValue.user as Record<string, unknown> }
}

/** Defaults a Host section carries for the plain top-level fields. */
export const BASE = {
  engines: ['seam', 'exa', 'ddg'], parallelEngines: false, searchMaxResults: 8, timeoutMs: 30_000,
  exaApiKeyEnv: 'EXA_API_KEY', jinaApiKeyEnv: 'JINA_API_KEY', githubTokenEnv: 'GITHUB_TOKEN',
  enableCliBackends: true, opencliEnabled: true, agentReachEnabled: true,
  providerId: 'web-search-pro', registerProvider: false, playwright: { enabled: true },
  ttlSeconds: 3600, memoryCacheEntries: 128, rrfConstant: 60, freshnessBoost: 0.2,
  freshnessDays: 30, authorityBoost: 0.25, authorityDomains: [], verbose: false,
}

export function harness(base: Record<string, unknown> = BASE, user: Record<string, unknown> = {}) {
  const scope = new ScopeStub(base, user)
  const credentialValues = new Map<string, string>()
  const described: string[][] = []
  const ctx = {
    remote: {
      credentials: {
        async describe(refs: string[]) {
          described.push(refs)
          return { ok: true, value: Object.fromEntries(refs.map(ref => [ref, { configured: credentialValues.has(ref), writable: true }])) }
        },
        async set(ref: string, value: string) {
          credentialValues.set(ref, value)
          return { ok: true, value: { ref } }
        },
      },
    },
  }
  const controller = new WebSearchSettingsController(scope, ctx as never)
  return { scope, credentialValues, described, controller }
}
