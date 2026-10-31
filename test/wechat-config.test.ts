import test from 'node:test'
import assert from 'node:assert/strict'
import { Config, resolveConfig } from '../src/config.ts'
import { credentialRef } from '../src/client/form-specs.ts'
import { ALL_SPECS } from '../src/client/form.ts'
import { renderTextView } from '../src/client/text-view.ts'
import { WECHAT_DEFAULTS, wechatSettings } from '../src/wechat/settings.ts'
import { findAction } from '../src/actions/registry.ts'
import { checkOutput } from '../src/actions/schema.ts'
import { bootPlugin } from './plugin-harness.ts'
import { harness } from './settings-harness.ts'

const LITERAL = 'sk-wsa-LITERAL-0123456789abcdefghijklmnop'

test('the wechat settings default to: reminders once, Sogou on, 元宝搜索 off (standard, mode 2, 100 a day), no history service', () => {
  assert.deepEqual(wechatSettings({}), WECHAT_DEFAULTS)
  assert.deepEqual(wechatSettings(undefined), WECHAT_DEFAULTS)
  assert.deepEqual(resolveConfig({} as never).wechat, WECHAT_DEFAULTS)
  assert.equal(WECHAT_DEFAULTS.wsa.enabled, false)
  assert.equal(WECHAT_DEFAULTS.wsa.apiKeyEnv, 'TENCENT_WSA_API_KEY')
  assert.equal(WECHAT_DEFAULTS.history.baseUrl, '')
})

test('malformed values fall back to the default; numbers are clamped; blank strings are absent', () => {
  const s = wechatSettings({ wechat: { notices: 'loud', sogou: { enabled: 'no', resolveLinks: 99, minIntervalMs: -5 }, wsa: { enabled: 'yes', apiKey: '  ', apiKeyEnv: '', baseUrl: ' ', edition: 'ultra', mode: 7, dailyLimit: 0 }, history: { baseUrl: 5, minIntervalMs: 'x' } } })
  assert.equal(s.notices, 'once')
  assert.deepEqual(s.sogou, { enabled: true, resolveLinks: 10, minIntervalMs: 0 })
  assert.deepEqual(s.wsa, { enabled: false, apiKeyEnv: 'TENCENT_WSA_API_KEY', edition: 'standard', mode: 2, dailyLimit: 1 })
  assert.deepEqual(s.history, { baseUrl: '', minIntervalMs: 2000 })
})

test('Config parses a wechat group and resolveConfig unwraps the live (volatile) leaves', () => {
  const parsed = (Config as unknown as (value: unknown) => unknown)({ wechat: { notices: 'always', sogou: { enabled: false, resolveLinks: 5 }, wsa: { enabled: true, apiKey: LITERAL, edition: 'lite', mode: 1, dailyLimit: 20, baseUrl: 'https://wsa.example.com' }, history: { baseUrl: 'http://127.0.0.1:5000', minIntervalMs: 500 } } })
  const resolved = resolveConfig(parsed as never)
  assert.equal(resolved.wechat.notices, 'always')
  assert.deepEqual(resolved.wechat.sogou, { enabled: false, resolveLinks: 5, minIntervalMs: 1500 })
  assert.deepEqual(resolved.wechat.wsa, { enabled: true, apiKey: LITERAL, apiKeyEnv: 'TENCENT_WSA_API_KEY', baseUrl: 'https://wsa.example.com', edition: 'lite', mode: 1, dailyLimit: 20 })
  assert.deepEqual(resolved.wechat.history, { baseUrl: 'http://127.0.0.1:5000', minIntervalMs: 500 })
  assert.throws(() => (Config as unknown as (value: unknown) => unknown)({ wechat: { wsa: { edition: 'ultra' } } }))
  assert.throws(() => (Config as unknown as (value: unknown) => unknown)({ wechat: { wsa: { mode: 3 } } }))
  assert.throws(() => (Config as unknown as (value: unknown) => unknown)({ wechat: { notices: 'loud' } }))
})

test('the schema marks wechat.wsa.apiKey as a secret and every wechat leaf as live', () => {
  const wechat = (Config as unknown as { dict: Record<string, any> }).dict.wechat
  assert.equal(wechat.dict.wsa.dict.apiKey.meta.role, 'secret')
  for (const [group, node] of Object.entries<any>(wechat.dict)) {
    if (group === 'notices') { assert.equal(node.meta.volatile, true); continue }
    for (const [key, leaf] of Object.entries<any>(node.dict)) assert.equal(leaf.meta.volatile, true, `wechat.${group}.${key} is volatile`)
  }
})

test('the card edits wechat fields at their own paths, keeps the literal key the user wrote, and never shows it', async () => {
  const { scope, controller } = harness(undefined, { wechat: { wsa: { apiKey: LITERAL, edition: 'lite' }, history: { baseUrl: 'http://127.0.0.1:5000' } } })
  const fields = controller.snapshot().fields
  assert.equal(fields['wechat.wsa.edition'].text, 'lite')
  assert.equal(fields['wechat.history.baseUrl'].text, 'http://127.0.0.1:5000')
  assert.equal(fields['wechat.wsa.mode'].text, '2')
  assert.equal(fields['wechat.wsa.dailyLimit'].text, '100')
  controller.edit('wechat.wsa.enabled', 'true')
  controller.edit('wechat.wsa.mode', '0')
  controller.edit('wechat.wsa.dailyLimit', '30')
  controller.edit('wechat.sogou.enabled', 'false')
  controller.edit('wechat.notices', 'off')
  await controller.save()
  assert.deepEqual(scope.writes.sort(), ['set:wechat.notices', 'set:wechat.sogou.enabled', 'set:wechat.wsa.dailyLimit', 'set:wechat.wsa.enabled', 'set:wechat.wsa.mode'])
  assert.deepEqual(scope.user.wechat, {
    notices: 'off', sogou: { enabled: false },
    wsa: { apiKey: LITERAL, edition: 'lite', enabled: true, mode: 0, dailyLimit: 30 },
    history: { baseUrl: 'http://127.0.0.1:5000' },
  })
  for (const field of Object.values(controller.snapshot().fields)) assert.doesNotMatch(field.text, new RegExp(LITERAL))
  for (const lang of ['en', 'zh']) assert.doesNotMatch(renderTextView(controller.snapshot().fields, ALL_SPECS, lang), new RegExp(LITERAL))
  controller.dispose()
})

test('the card refuses values the plugin would not take', () => {
  const { controller } = harness()
  for (const [field, text] of [['wechat.wsa.mode', '3'], ['wechat.wsa.edition', 'ultra'], ['wechat.wsa.dailyLimit', '0'], ['wechat.sogou.resolveLinks', '11'], ['wechat.history.baseUrl', 'ftp://x'], ['wechat.history.baseUrl', 'http://u:p@127.0.0.1:5000'], ['wechat.wsa.baseUrl', 'not a url'], ['wechat.wsa.apiKeyEnv', 'has space'], ['wechat.notices', 'loud']] as const) {
    controller.edit(field, text)
    assert.equal(controller.snapshot().fields[field].invalid, true, `${field}=${text}`)
    controller.resetField(field)
  }
  controller.dispose()
})

test('the write-only key is stored under the name wechat.wsa.apiKeyEnv (default TENCENT_WSA_API_KEY)', async () => {
  assert.deepEqual(credentialRef('wechat-wsa'), { field: 'wechat.wsa.apiKeyEnv', default: 'TENCENT_WSA_API_KEY' })
  const { controller, credentialValues } = harness(undefined, { wechat: { wsa: { apiKeyEnv: 'MY_WSA' } } })
  controller.editCredential('wechat-wsa', 'the-secret-value')
  await controller.save()
  assert.equal(credentialValues.get('MY_WSA'), 'the-secret-value')
  assert.equal(credentialValues.has('TENCENT_WSA_API_KEY'), false)
  controller.dispose()
})

test('config.inspect and config.export never carry the key or the wechat group', async () => {
  const h = bootPlugin({ wechat: { wsa: { enabled: true, apiKey: LITERAL }, history: { baseUrl: 'http://127.0.0.1:5000' } } })
  try {
    const inspect = await h.run('config.inspect')
    assert.deepEqual(checkOutput(findAction('config.inspect')!.output, inspect), [])
    const exported = await h.run('config.export')
    assert.doesNotMatch(JSON.stringify(inspect) + JSON.stringify(exported), new RegExp(LITERAL))
    assert.doesNotMatch(JSON.stringify(inspect) + JSON.stringify(exported), /wechat/)
    const status = JSON.stringify(await h.run('sources.status'))
    assert.doesNotMatch(status, new RegExp(LITERAL))
  } finally { h.cleanup() }
})
