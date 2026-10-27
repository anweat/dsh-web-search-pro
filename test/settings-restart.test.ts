/**
 * The settings that are read only when the plugin starts: the card marks their rows, says so in the save bar when a save
 * touches one, and shows the ones the running plugin has not picked up in the status summary (from the plugin's own report).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { before, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { parse } from 'node-html-parser'
import { WebSearchSettingsController } from '../src/client/form.ts'
import { en, zh } from '../src/client/locales.ts'
import { restartWhyKey } from '../src/client/field-keys.ts'
import { RESTART_FIELD_LIST } from '../src/restart.ts'
import { RPC_CHANNEL } from '../src/rpc-types.ts'
import { ScopeStub, harness } from './settings-harness.ts'

const require = createRequire(import.meta.url)
type Render = (state: unknown, lang: 'zh' | 'en') => { html: string; missingKeys: string[] }
let renderCard: Render | undefined
let renderForms: Render | undefined

before(async () => {
  const fromTsdown = createRequire(require.resolve('tsdown/package.json'))
  const rolldown = await import(fromTsdown.resolve('rolldown'))
  const bundle = await rolldown.rolldown({
    input: new URL('./ui/ssr-entry.tsx', import.meta.url).pathname, platform: 'node', logLevel: 'silent',
    resolve: { alias: { '@deepseek-ai/dsh-client-ui-primitives': new URL('./ui/primitives-stub.ts', import.meta.url).pathname } },
    transform: { define: { 'process.env.NODE_ENV': '"development"' }, jsx: { runtime: 'automatic' } },
  } as never)
  const { output } = await bundle.generate({ format: 'esm' })
  await bundle.close()
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-search-pro-ssr-')), 'card.mjs')
  fs.writeFileSync(file, output[0]!.code)
  const mod = await import(pathToFileURL(file).href)
  renderCard = mod.renderCard
  renderForms = mod.renderForms
})

test('editing a start-up setting is reported as restart-touched until it is saved, reset or discarded; a live setting never is', async () => {
  const { controller, scope } = harness()
  assert.deepEqual(controller.snapshot().restartTouched, [])
  controller.edit('searchMaxResults', '12')
  controller.edit('engines', 'ddg, bing')
  assert.deepEqual(controller.snapshot().restartTouched, [], 'live fields')
  controller.edit('toolSurface', 'flat')
  controller.edit('timeoutMs', '45000')
  controller.edit('registerProvider', 'true')
  controller.edit('dbPath', '/data/elsewhere/store.db')
  controller.edit('verbose', 'true')
  controller.edit('memoryCacheEntries', '256')
  controller.edit('providerId', 'my-search')
  assert.deepEqual(controller.snapshot().restartTouched, ['toolSurface', 'providerId', 'registerProvider', 'timeoutMs', 'memoryCacheEntries', 'dbPath', 'verbose'])
  controller.edit('toolSurface', 'indexed')
  controller.edit('timeoutMs', '30000')
  assert.ok(!controller.snapshot().restartTouched.includes('toolSurface') && !controller.snapshot().restartTouched.includes('timeoutMs'), 'an edit back to the stored value is no change')
  await controller.save()
  assert.deepEqual(scope.writes.filter(write => /toolSurface|dbPath/.test(write)), ['set:dbPath'])
  assert.deepEqual(controller.snapshot().restartTouched, [], 'saved: nothing waiting any more (the status summary then reports it from the plugin)')
  controller.edit('toolSurface', 'flat')
  assert.deepEqual(controller.snapshot().restartTouched, ['toolSurface'])
  controller.discard()
  assert.deepEqual(controller.snapshot().restartTouched, [])
  controller.dispose()
})

test('playwright is one JSON field: only its snapshotDir needs a restart, enabled is live', () => {
  const { controller } = harness(undefined, { playwright: { enabled: true, snapshotDir: '/shots' } })
  controller.edit('playwright', '{"enabled": false, "snapshotDir": "/shots"}')
  assert.deepEqual(controller.snapshot().restartTouched, [])
  controller.edit('playwright', '{"enabled": false, "snapshotDir": "/elsewhere"}')
  assert.deepEqual(controller.snapshot().restartTouched, ['playwright.snapshotDir'])
  controller.edit('playwright', '{broken')
  assert.deepEqual(controller.snapshot().restartTouched, [])
  controller.resetField('playwright')
  assert.deepEqual(controller.snapshot().restartTouched, ['playwright.snapshotDir'], 'a reset removes the stored snapshotDir')
  controller.dispose()
})

test('every restart field has a row mark with its reason in both dictionaries; live fields have none', async () => {
  for (const field of RESTART_FIELD_LIST) {
    const key = restartWhyKey(field)
    assert.ok(key in zh && key in en, field + ' has a reason in zh and en')
    assert.notEqual(key, 'restartBadge', field + ' has its own reason')
  }
  // providerId only has a row while the route is switched on.
  const { controller } = harness(undefined, { registerProvider: true })
  const state = controller.snapshot()
  for (const lang of ['zh', 'en'] as const) {
    const card = renderCard!(state, lang)
    const forms = renderForms!(state, lang)
    assert.deepEqual([...card.missingKeys, ...forms.missingKeys], [])
    const marks = [...parse(card.html).querySelectorAll('[data-wsp-restart]'), ...parse(forms.html).querySelectorAll('[data-wsp-restart]')].map(node => node.getAttribute('data-wsp-restart'))
    assert.deepEqual([...new Set(marks)].sort(), [...RESTART_FIELD_LIST].sort(), lang + ': exactly the restart fields are marked')
    const root = parse(card.html)
    assert.match(root.querySelector('[data-wsp-field="toolSurface"] [data-wsp-restart]')!.text, lang === 'zh' ? /重启插件后生效/ : /plugin restart/)
    assert.equal(root.querySelector('[data-wsp-field="engines"] [data-wsp-restart]'), null)
    assert.equal(root.querySelector('[data-wsp-field="searchMaxResults"] [data-wsp-restart]'), null)
  }
  controller.dispose()
})

test('the save bar names the start-up settings a save would not apply yet; the mark of an edited row is picked out', () => {
  const { controller } = harness()
  controller.edit('toolSurface', 'flat')
  controller.edit('dbPath', '/data/elsewhere/store.db')
  const html = renderCard!(controller.snapshot(), 'zh').html
  const root = parse(html)
  const note = root.querySelector('[data-wsp-restart-note]')!
  assert.equal(note.getAttribute('data-wsp-restart-note'), 'toolSurface,dbPath')
  assert.match(note.text, /其中 toolSurface, dbPath 要重启插件后才生效/)
  assert.match(renderCard!(controller.snapshot(), 'en').html, /toolSurface, dbPath: takes effect only after the plugin restarts/)
  controller.discard()
  assert.equal(parse(renderCard!(controller.snapshot(), 'zh').html).querySelector('[data-wsp-restart-note]'), null)
  controller.dispose()
})

function withRpc(status: unknown) {
  const scope = new ScopeStub({ engines: ['ddg'], toolSurface: 'indexed' })
  const rpc = { call: async (channel: string, endpoint: string) => channel === RPC_CHANNEL && endpoint === 'status' ? { ok: true, value: status } : { ok: false, error: { message: 'no' } } }
  const ctx = { remote: { credentials: { describe: async (refs: string[]) => ({ ok: true, value: Object.fromEntries(refs.map(ref => [ref, { configured: false, writable: true }])) }), set: async () => ({ ok: true, value: {} }) } }, get: (name: string) => name === 'connection' ? { rpc } : undefined }
  return new WebSearchSettingsController(scope, ctx as never)
}

test('the status summary shows the settings the running plugin has not picked up, from the plugin\'s report, and lists them in the details', async () => {
  const controller = withRpc({ sources: {}, legs: {}, pendingRestart: [{ field: 'toolSurface', running: 'indexed', configured: 'flat' }, { field: 'dbPath', running: '/a/store.db', configured: '' }] })
  await controller.refreshStatus()
  const root = parse(renderCard!(controller.snapshot(), 'zh').html)
  const pending = root.querySelector('[data-wsp-pending-restart]')!
  assert.equal(pending.getAttribute('data-wsp-pending-restart'), 'toolSurface,dbPath')
  assert.match(pending.text, /待重启 2 项: toolSurface, dbPath/)
  assert.match(pending.getAttribute('title')!, /toolSurface: 待重启：当前生效 indexed，配置为 flat/)
  assert.match(pending.getAttribute('title')!, /dbPath: 待重启：当前生效 \/a\/store\.db，配置为 （空）/)
  assert.equal(root.querySelector('[data-wsp-warnings-count]')!.getAttribute('data-wsp-warnings-count'), '2', 'they are counted among the notices')
  const clean = withRpc({ sources: {}, legs: {} })
  await clean.refreshStatus()
  assert.equal(parse(renderCard!(clean.snapshot(), 'zh').html).querySelector('[data-wsp-pending-restart]'), null)
  controller.dispose(); clean.dispose()
})
