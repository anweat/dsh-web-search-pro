/**
 * The agent's changes in the settings card: the marks on the rows they change, the "Agent changes" group with its Adopt / Revoke buttons,
 * and what those buttons do (the atomic write into the profile first, the RPC call that drops the entry after it).
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
import { adoptionOf, formatTime, overlayKeyOfField } from '../src/client/overlay-ops.ts'
import { en, zh } from '../src/client/locales.ts'
import type { OverlayItem, OverlayView } from '../src/overlay-types.ts'
import { RPC_CHANNEL } from '../src/rpc-types.ts'
import { ScopeStub } from './settings-harness.ts'

const require = createRequire(import.meta.url)
type Render = (state: unknown, lang: 'zh' | 'en') => { html: string; missingKeys: string[] }
let renderCard: Render | undefined

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
  renderCard = (await import(pathToFileURL(file).href)).renderCard
})

const SPEC = { bins: ['mine'], packageNote: 'mine', platforms: [], engine: true, probe: { versionArgs: ['--version'], helpArgs: ['search', '--help'], mustContain: ['--json'] }, allowedSubcommands: ['search'], search: { argv: ['search', '{query}', '--json'], output: { format: 'json', itemsPath: 'results', fields: { url: 'url', title: 'title' } } }, env: {}, needsLogin: false, timeoutMs: 20_000, maxOutputBytes: 65_536 }

function item(key: string, kind: OverlayItem['kind'], target: string | undefined, value: unknown, over: Partial<OverlayItem> = {}): OverlayItem {
  return { key, kind, ...target ? { target } : {}, value, summary: Array.isArray(value) ? value.join(' > ') : typeof value === 'object' ? 'mine search {query} --json' : String(value), baseline: '(none)', at: '2026-10-27T14:35:00.000Z', reason: 'because the test says so', actor: 'agent', sessionId: 'session-1', ...over }
}

const ITEMS: OverlayItem[] = [
  item('engines', 'engines', undefined, ['bing', 'ddg'], { baseline: 'ddg' }),
  item('sources.priority', 'priority', undefined, ['exa']),
  item('sources.disabled', 'disabled', undefined, ['jina']),
  item('sources.confidence.exa', 'confidence', 'exa', 0.8),
  item('platformBackends.reddit', 'platform', 'reddit', ['browser-opencli']),
  item('cliAdapters.mine', 'cli', 'mine', SPEC),
]

function view(items: OverlayItem[] = ITEMS, over: Partial<OverlayView> = {}): OverlayView {
  return { file: '/home/u/.dsh/data/web-search-pro/overlay.json', revision: 7, updatedAt: '2026-10-27T14:35:00.000Z', valid: true, items, audit: [{ revision: 7, at: '2026-10-27T14:35:00.000Z', actor: 'agent', action: 'config.set_order', sessionId: 'session-1', reason: 'because the test says so', changes: [{ key: 'engines', before: 'ddg', after: 'bing > ddg' }] }], ...over }
}

/** A controller over an in-memory Host section, with an RPC double that remembers its calls and an overlay it answers from. */
function controllerWith(initial: OverlayView | undefined, options: { mutateOk?: boolean; revokeFails?: boolean; base?: Record<string, unknown>; user?: Record<string, unknown> } = {}) {
  const scope = new ScopeStub(options.base ?? { engines: ['ddg'], sources: {}, platformBackends: {}, cliAdapters: {} }, options.user ?? {})
  if (options.mutateOk === false) scope.mutate = async () => false
  let current = initial
  const calls: [string, string, unknown][] = []
  const rpc = {
    call: async (channel: string, endpoint: string, payload: any) => {
      calls.push([channel, endpoint, payload])
      if (endpoint === 'status') return { ok: true, value: { sources: {}, legs: {} } }
      if (endpoint === 'overlay') return current ? { ok: true, value: current } : { ok: false, error: { message: 'no overlay' } }
      if (endpoint === 'overlay.revoke') {
        if (options.revokeFails) return { ok: false, error: { message: 'the file changed' } }
        const keys: string[] | 'all' = payload.keys
        current = current && { ...current, items: keys === 'all' ? [] : current.items.filter(entry => !keys.includes(entry.key)) }
        return { ok: true, value: current }
      }
      return { ok: false, error: { message: 'no' } }
    },
  }
  const ctx = { remote: { credentials: { describe: async (refs: string[]) => ({ ok: true, value: Object.fromEntries(refs.map(ref => [ref, { configured: false, writable: true }])) }), set: async () => ({ ok: true, value: {} }) } }, get: (name: string) => name === 'connection' ? { rpc } : undefined }
  const controller = new WebSearchSettingsController(scope, ctx as never)
  return { controller, scope, calls }
}
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 5))

test('adoptionOf: each kind of entry becomes one atomic write at the leaf it is about, and names the staged drafts it replaces', () => {
  const op = (key: string) => { const found = ITEMS.find(entry => entry.key === key)!; return adoptionOf(found)! }
  assert.deepEqual(op('engines'), { ops: [{ op: 'set', path: ['engines'], value: ['bing', 'ddg'] }], drop: ['engines'] })
  assert.deepEqual(op('sources.priority'), { ops: [{ op: 'set', path: ['sources', 'priority'], value: ['exa'] }], drop: ['sources.priority'] })
  assert.deepEqual(op('sources.disabled'), { ops: [{ op: 'set', path: ['sources', 'disabled'], value: ['jina'] }], drop: ['sources.disabled'] })
  assert.deepEqual(op('sources.confidence.exa'), { ops: [{ op: 'set', path: ['sources', 'confidence', 'exa'], value: 0.8 }], drop: ['sources.confidence.exa'] })
  assert.deepEqual(op('platformBackends.reddit'), { ops: [{ op: 'set', path: ['platformBackends', 'reddit'], value: ['browser-opencli'] }], drop: ['platformBackends'] })
  assert.deepEqual(op('cliAdapters.mine'), { ops: [{ op: 'set', path: ['cliAdapters', 'mine'], value: SPEC }], drop: ['cliAdapters'] })
  assert.equal(adoptionOf({ kind: 'confidence', value: 1 }), undefined, 'a target-less leaf is refused')
  assert.equal(overlayKeyOfField('engines'), 'engines')
  assert.equal(overlayKeyOfField('searchMaxResults'), undefined)
  assert.match(formatTime('2026-10-27T14:35:00.000Z'), /^2026-10-2[78] \d\d:35$/)
  assert.equal(formatTime('not a date'), 'not a date')
})

test('the card reads the overlay once when it opens and on Refresh; without the channel it says so', async () => {
  const { controller, calls } = controllerWith(view())
  await settle()
  assert.equal(calls.filter(call => call[1] === 'overlay').length, 1, 'once when the panel opens')
  assert.deepEqual(calls.find(call => call[1] === 'overlay'), [RPC_CHANNEL, 'overlay', { limit: 20 }])
  assert.equal(controller.snapshot().server.overlay.view?.items.length, 6)
  await controller.refreshOverlay()
  assert.equal(calls.filter(call => call[1] === 'overlay').length, 2)
  controller.dispose()
  const scope = new ScopeStub({ engines: ['ddg'] })
  const bare = new WebSearchSettingsController(scope, { remote: { credentials: { describe: async () => ({ ok: true, value: {} }), set: async () => ({ ok: true, value: {} }) } } } as never)
  await settle()
  assert.deepEqual([bare.snapshot().server.overlay.failed, bare.snapshot().server.overlay.view], [true, undefined])
  const html = renderCard!(bare.snapshot(), 'zh').html
  assert.match(parse(html).querySelector('[data-wsp-agent-unavailable]')!.text, /读不到 agent 修改/)
  bare.dispose()
})

test('Adopt writes the value into the profile with one atomic mutate at its leaf, then drops the entry over RPC as the user; the staged draft of the field is replaced', async () => {
  const { controller, scope, calls } = controllerWith(view())
  await settle()
  controller.edit('engines', 'exa')
  assert.equal(await controller.adoptOverlay('engines'), true)
  assert.equal(scope.mutations.length, 1)
  assert.deepEqual(scope.mutations[0]!.ops, [{ op: 'set', path: ['engines'], value: ['bing', 'ddg'] }])
  assert.deepEqual(scope.user.engines, ['bing', 'ddg'])
  assert.deepEqual(calls.filter(call => call[1] === 'overlay.revoke'), [[RPC_CHANNEL, 'overlay.revoke', { keys: ['engines'], adopted: true }]])
  assert.equal(controller.snapshot().fields.engines.text, 'bing, ddg', 'the draft of engines is gone: the card shows the adopted value')
  assert.equal(controller.snapshot().dirty, false)
  assert.deepEqual(controller.snapshot().server.overlay.view?.items.map(entry => entry.key), ['sources.priority', 'sources.disabled', 'sources.confidence.exa', 'platformBackends.reddit', 'cliAdapters.mine'])
  assert.equal(controller.snapshot().server.overlay.busy, false)
  // The other kinds land at their own leaves (all of them beneath a volatile node of the schema: the stub refuses anything else).
  for (const key of ['sources.priority', 'sources.disabled', 'sources.confidence.exa', 'platformBackends.reddit', 'cliAdapters.mine']) assert.equal(await controller.adoptOverlay(key), true, key)
  assert.deepEqual(scope.refused, [])
  assert.deepEqual(scope.user.sources, { priority: ['exa'], disabled: ['jina'], confidence: { exa: 0.8 } })
  assert.deepEqual(scope.user.platformBackends, { reddit: ['browser-opencli'] })
  assert.deepEqual(scope.user.cliAdapters, { mine: SPEC })
  assert.deepEqual(controller.snapshot().server.overlay.view?.items, [])
  controller.dispose()
})

test('a refused write leaves the profile and the overlay as they were; a failed revoke after a good write says the value is already in the configuration', async () => {
  const refused = controllerWith(view(), { mutateOk: false })
  await settle()
  assert.equal(await refused.controller.adoptOverlay('engines'), false)
  assert.equal(refused.calls.filter(call => call[1] === 'overlay.revoke').length, 0, 'the entry is only dropped after the write landed')
  assert.equal(refused.controller.snapshot().server.overlay.error?.key, 'agentAdoptFailed')
  assert.equal(refused.controller.snapshot().server.overlay.view?.items.length, 6)
  assert.match(parse(renderCard!(refused.controller.snapshot(), 'en').html).querySelector('[data-wsp-agent-error]')!.text, /configuration was not written/)
  refused.controller.dispose()
  const half = controllerWith(view(), { revokeFails: true })
  await settle()
  assert.equal(await half.controller.adoptOverlay('engines'), false)
  assert.deepEqual(half.scope.user.engines, ['bing', 'ddg'], 'the value did reach the profile')
  assert.deepEqual(half.controller.snapshot().server.overlay.error, { key: 'agentAdoptHalf', why: 'the file changed' })
  assert.match(parse(renderCard!(half.controller.snapshot(), 'zh').html).querySelector('[data-wsp-agent-error]')!.text, /值已写进配置，但撤销覆盖没成功：the file changed/)
  half.controller.dispose()
  // Unknown keys and a read-only section are not adopted.
  const { controller, scope } = controllerWith(view())
  await settle()
  assert.equal(await controller.adoptOverlay('engines.nope'), false)
  assert.equal(scope.mutations.length, 0)
  controller.dispose()
})

test('Revoke drops one entry, a list, or all of them over RPC as the user; nothing is written to the profile', async () => {
  const { controller, scope, calls } = controllerWith(view())
  await settle()
  assert.equal(await controller.revokeOverlay(['sources.disabled']), true)
  assert.deepEqual(calls.filter(call => call[1] === 'overlay.revoke').at(-1), [RPC_CHANNEL, 'overlay.revoke', { keys: ['sources.disabled'] }])
  assert.equal(controller.snapshot().server.overlay.view?.items.length, 5)
  await controller.revokeOverlay('all')
  assert.deepEqual(calls.filter(call => call[1] === 'overlay.revoke').at(-1), [RPC_CHANNEL, 'overlay.revoke', { keys: 'all' }])
  assert.deepEqual(controller.snapshot().server.overlay.view?.items, [])
  assert.equal(scope.mutations.length, 0)
  controller.dispose()
  const failing = controllerWith(view(), { revokeFails: true })
  await settle()
  assert.equal(await failing.controller.revokeOverlay(['engines']), false)
  assert.deepEqual(failing.controller.snapshot().server.overlay.error, { key: 'agentRevokeFailed', why: 'the file changed' })
  failing.controller.dispose()
})

test('the rows an agent changed carry the mark with the reason and time in its tooltip; the others carry none', async () => {
  const { controller } = controllerWith(view(), { base: { engines: ['ddg', 'exa'], sources: {}, platformBackends: {}, cliAdapters: {} } })
  await settle()
  for (const lang of ['zh', 'en'] as const) {
    const rendered = renderCard!(controller.snapshot(), lang)
    assert.deepEqual(rendered.missingKeys, [], lang)
    const root = parse(rendered.html)
    const marks = root.querySelectorAll('[data-wsp-agent]').map(node => node.getAttribute('data-wsp-agent'))
    for (const key of ['engines', 'sources.priority', 'sources.disabled', 'platformBackends.reddit']) assert.ok(marks.includes(key), lang + ': mark on ' + key)
    const engines = root.querySelector('[data-wsp-field="engines"] [data-wsp-agent="engines"]')!
    assert.ok(engines.querySelector('[data-wsp-agent-adopt]') && engines.querySelector('[data-wsp-agent-revoke]'), 'the engines row has the two buttons')
    const tip = engines.querySelector('.wsp-agent-tag')!.getAttribute('title')!
    assert.ok(tip.includes('bing > ddg') && tip.includes('ddg') && tip.includes('because the test says so') && /2026-10-2[78] \d\d:35/.test(tip), tip)
    assert.match(tip, lang === 'zh' ? /agent 设为/ : /Set to/)
    // The platform row of reddit is marked, the one of github is not; the confidence box of exa is marked.
    assert.ok(root.querySelector('[data-wsp-item="reddit"] [data-wsp-agent="platformBackends.reddit"]'))
    assert.equal(root.querySelector('[data-wsp-item="github"] [data-wsp-agent]'), null)
    assert.ok(root.querySelector('[data-wsp-order-item="exa"] [data-wsp-agent="sources.confidence.exa"]'), 'the confidence box of exa is marked')
    assert.equal(root.querySelector('[data-wsp-order-item="ddg"] [data-wsp-agent]'), null)
    assert.equal(root.querySelector('[data-wsp-field="searchMaxResults"] [data-wsp-agent]'), null)
    assert.equal(root.querySelector('[data-wsp-field="parallelEngines"] [data-wsp-agent]'), null)
  }
  controller.dispose()
})

test('"Agent changes" lists every entry with its reason, time and the value against the configuration, the file and revision, the audit, and Adopt / Revoke / Revoke all / Refresh', async () => {
  const { controller } = controllerWith(view())
  await settle()
  const root = parse(renderCard!(controller.snapshot(), 'zh').html)
  const group = root.querySelector('details[data-wsp-group="agent"]')!
  assert.equal(group.hasAttribute('open'), false)
  assert.match(group.querySelector('summary')!.text, /agent 修改[\s\S]*6 项/)
  const rows = group.querySelectorAll('[data-wsp-agent-list] [data-wsp-item]')
  assert.deepEqual(rows.map(row => row.getAttribute('data-wsp-item')), ITEMS.map(entry => entry.key))
  const engines = rows[0]!
  assert.match(engines.text, /引擎顺序/)
  assert.match(engines.text, /生效：\s*bing > ddg/)
  assert.match(engines.text, /你的配置：\s*ddg/)
  assert.match(engines.text, /because the test says so/)
  assert.match(engines.text, /session-1/)
  assert.ok(engines.querySelector('[data-wsp-action="agent-adopt"]') && engines.querySelector('[data-wsp-action="agent-revoke"]'))
  assert.match(rows[5]!.text, /自定义 CLI[\s\S]*mine/)
  assert.ok(group.querySelector('[data-wsp-action="agent-refresh"]') && group.querySelector('[data-wsp-action="agent-revoke-all"]'))
  assert.match(group.querySelector('[data-wsp-agent-file]')!.text, /overlay\.json · 版本 7/)
  const audit = group.querySelectorAll('[data-wsp-agent-audit] [data-wsp-item]')
  assert.equal(audit.length, 1)
  assert.match(audit[0]!.text, /config\.set_order[\s\S]*because the test says so[\s\S]*engines ddg → bing > ddg/)
  // The summary bar counts them and links to the group.
  assert.equal(root.querySelector('[data-wsp-agent-summary]')!.getAttribute('data-wsp-agent-summary'), '6')
  // The custom CLI group lists the CLI that only the overlay holds.
  assert.ok(root.querySelector('[data-wsp-agent-clis] [data-wsp-item="mine"]'))
  assert.equal(root.querySelector('[data-wsp-cli-list] [data-wsp-item="mine"]'), null)
  controller.dispose()
})

test('an empty overlay, a loading one and an ignored one render their own state; Revoke all stays available to repair an ignored file', async () => {
  const empty = controllerWith(view([]))
  await settle()
  let root = parse(renderCard!(empty.controller.snapshot(), 'en').html)
  assert.match(root.querySelector('[data-wsp-agent-list]')!.text, /The agent has changed nothing/)
  assert.equal(root.querySelector('[data-wsp-agent-summary]'), null)
  assert.equal(root.querySelector('[data-wsp-action="agent-revoke-all"]')!.hasAttribute('disabled'), true)
  empty.controller.dispose()
  const broken = controllerWith(view([], { valid: false, problem: 'the checksum does not match' }))
  await settle()
  root = parse(renderCard!(broken.controller.snapshot(), 'en').html)
  assert.match(root.querySelector('[data-wsp-agent-invalid]')!.text, /ignored as a whole[\s\S]*the checksum does not match/)
  assert.equal(root.querySelector('[data-wsp-action="agent-revoke-all"]')!.hasAttribute('disabled'), false)
  broken.controller.dispose()
  const never = controllerWith(undefined)
  await settle()
  root = parse(renderCard!(never.controller.snapshot(), 'zh').html)
  assert.ok(root.querySelector('[data-wsp-agent-unavailable]'))
  never.controller.dispose()
})

test('both dictionaries carry every agent key', () => {
  for (const key of Object.keys(zh).filter(name => /^(agent|groupAgent|summaryAgent)/.test(name))) assert.ok(key in en, key + ' in en')
  for (const key of Object.keys(en).filter(name => /^(agent|groupAgent|summaryAgent)/.test(name))) assert.ok(key in zh, key + ' in zh')
})
