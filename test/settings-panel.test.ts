import assert from 'node:assert/strict'
import test from 'node:test'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { FIELD_SPECS, WebSearchSettingsController } from '../src/client/form.ts'

test('settings panel covers every non-secret Web Search Pro configuration field', () => {
  assert.deepEqual(FIELD_SPECS.map(spec => spec.field), [
    'engines', 'parallelEngines', 'searchMaxResults', 'timeoutMs',
    'exaApiKeyEnv', 'jinaApiKeyEnv', 'githubTokenEnv',
    'enableCliBackends', 'opencliEnabled', 'agentReachEnabled', 'providerId', 'registerProvider', 'playwright',
    'ttlSeconds', 'memoryCacheEntries', 'rrfConstant', 'freshnessBoost', 'freshnessDays', 'authorityBoost',
    'authorityDomains', 'dbPath', 'allowProxyFakeIp', 'platformRules', 'customPlatforms', 'browserBindings', 'verbose',
  ])
})

class ScopeStub implements SettingsScope<Record<string, unknown>> {
  readonly writes: string[] = []
  private readonly listeners = new Set<() => void>()
  private snapshotValue: SettingsScopeSnapshot<Record<string, unknown>>

  constructor(base: Record<string, unknown>) {
    this.snapshotValue = {
      status: 'ready', value: structuredClone(base), base: structuredClone(base), user: {},
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
}

function fixture() {
  const scope = new ScopeStub({
    engines: ['seam', 'exa', 'ddg'], parallelEngines: false, searchMaxResults: 8, timeoutMs: 30_000,
    exaApiKeyEnv: 'EXA_API_KEY', jinaApiKeyEnv: 'JINA_API_KEY', githubTokenEnv: 'GITHUB_TOKEN',
    enableCliBackends: true, opencliEnabled: true, agentReachEnabled: true,
    providerId: 'web-search-pro', registerProvider: false, playwright: { enabled: true },
    ttlSeconds: 3600, memoryCacheEntries: 128, rrfConstant: 60, freshnessBoost: 0.2,
    freshnessDays: 30, authorityBoost: 0.25, authorityDomains: [], verbose: false,
  })
  const credentialValues = new Map<string, string>()
  const api = {
    credentials: {
      async describe({ refs }: { refs: string[] }) {
        return {
          result: {
            ok: true,
            value: {
              credentials: Object.fromEntries(refs.map(ref => [ref, {
                configured: credentialValues.has(ref), writable: true,
              }])),
            },
          },
        }
      },
      async set({ ref, value }: { ref: string; value: string }) {
        credentialValues.set(ref, value)
        return { result: { ok: true, value: { ref } } }
      },
    },
  }
  const controller = new WebSearchSettingsController(scope, api as never)
  return { scope, credentialValues, controller }
}

test('settings panel stages, validates, saves, and resets scalar fields', async () => {
  const { scope, controller } = fixture()
  controller.edit('searchMaxResults', '21')
  assert.equal(controller.snapshot().invalid, true)
  await controller.save()
  assert.deepEqual(scope.writes, [])

  controller.edit('searchMaxResults', '12')
  assert.equal(controller.snapshot().dirty, true)
  assert.equal(controller.snapshot().invalid, false)
  await controller.save()
  assert.equal(scope.getSnapshot().user?.searchMaxResults, 12)
  assert.equal(controller.snapshot().dirty, false)
  assert.equal(controller.snapshot().failed, false)

  controller.resetField('searchMaxResults')
  assert.equal(controller.snapshot().fields.searchMaxResults.text, '8')
  assert.equal(controller.snapshot().fields.searchMaxResults.overridden, false)
  await controller.save()
  assert.equal(Object.hasOwn(scope.getSnapshot().user ?? {}, 'searchMaxResults'), false)
  controller.dispose()
})

test('settings panel rejects malformed JSON and persists structured bindings', async () => {
  const { scope, controller } = fixture()
  controller.edit('browserBindings', '{bad json')
  assert.equal(controller.snapshot().fields.browserBindings.invalid, true)

  controller.edit('browserBindings', '{"v2ex":{"authProfile":"community"}}')
  assert.equal(controller.snapshot().invalid, false)
  await controller.save()
  assert.deepEqual(scope.getSnapshot().user?.browserBindings, { v2ex: { authProfile: 'community' } })
  controller.dispose()
})

test('credential writes follow a newly saved reference and never enter settings', async () => {
  const { scope, credentialValues, controller } = fixture()
  controller.edit('exaApiKeyEnv', 'EXA_TEST_KEY')
  controller.editCredential('exa', 'secret-for-test')
  await controller.save()

  assert.equal(scope.getSnapshot().user?.exaApiKeyEnv, 'EXA_TEST_KEY')
  assert.equal(credentialValues.get('EXA_TEST_KEY'), 'secret-for-test')
  assert.equal(Object.hasOwn(scope.getSnapshot().user ?? {}, 'exaApiKey'), false)
  assert.equal(controller.snapshot().credentials.exa.configured, true)
  assert.equal(controller.snapshot().credentials.exa.text, '')
  controller.dispose()
})

test('settings panel closes a rejected Host write and keeps the draft retryable', async () => {
  const { scope, controller } = fixture()
  scope.set = async () => { throw new Error('host write rejected') }
  controller.edit('searchMaxResults', '12')

  await controller.save()

  assert.equal(controller.snapshot().saving, false)
  assert.equal(controller.snapshot().failed, true)
  assert.equal(controller.snapshot().dirty, true)
  assert.equal(controller.snapshot().fields.searchMaxResults.text, '12')
  controller.dispose()
})
