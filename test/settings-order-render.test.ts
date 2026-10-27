/**
 * The "Search order" and "Custom CLI" groups as the real card renders them (bundled and rendered like settings-card-render.test.ts):
 * the engine list with its rows, the order a search would really use and why it differs, the platform rows and their dialog body,
 * the custom CLI list and the edit form (form <-> JSON, the server's messages beside the control, whole output, Try it).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { before, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { parse } from 'node-html-parser'
import { ORDER_PLATFORMS } from '../src/client/order.ts'
import { harness } from './settings-harness.ts'

const require = createRequire(import.meta.url)
let renderCard: ((state: unknown, lang: 'zh' | 'en') => { html: string; missingKeys: string[] }) | undefined
let renderForms: ((state: unknown, lang: 'zh' | 'en', clis?: Record<string, Record<string, unknown>>) => { html: string; missingKeys: string[] }) | undefined

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

const echo = (over: Record<string, unknown> = {}) => ({
  bins: ['echo'], packageNote: 'echo (part of the system)', platforms: [], engine: true, probe: { versionArgs: ['--version'], helpArgs: ['--help'], mustContain: [] }, allowedSubcommands: [],
  search: { argv: ['{query}'], output: { format: 'text', lines: { mode: 'whole' } } }, env: {}, needsLogin: false, timeoutMs: 5000, maxOutputBytes: 65536, ...over,
})
const jsonTool = (over: Record<string, unknown> = {}) => ({
  bins: ['mytool'], packageNote: 'mytool', platforms: ['weibo'], engine: false, confidence: 0.7, probe: { versionArgs: ['--version'], helpArgs: ['search', '--help'], mustContain: ['--json'] }, allowedSubcommands: ['search'],
  search: { argv: ['search', '{query}', '--json'], output: { format: 'json', itemsPath: 'data', fields: { url: 'link', title: 'name' } } }, env: {}, needsLogin: false, timeoutMs: 20000, maxOutputBytes: 1048576, ...over,
})

async function page(lang: 'zh' | 'en', user: Record<string, unknown> = {}, credentials: Record<string, string> = {}, clis?: Record<string, Record<string, unknown>>, edit?: (controller: ReturnType<typeof harness>['controller']) => void) {
  const { controller, credentialValues } = harness(undefined, user)
  for (const [ref, value] of Object.entries(credentials)) credentialValues.set(ref, value)
  await controller.refreshCredentials()
  edit?.(controller)
  const card = renderCard!(controller.snapshot(), lang)
  const forms = renderForms!(controller.snapshot(), lang, clis)
  controller.dispose()
  return { root: parse(card.html), formsRoot: parse(forms.html), html: card.html + forms.html, missingKeys: [...card.missingKeys, ...forms.missingKeys] }
}

const group = (root: ReturnType<typeof parse>, id: string) => root.querySelector(`details[data-wsp-group="${id}"]`)!
const items = (node: ReturnType<typeof parse>, selector: string) => node.querySelectorAll(selector).map(item => item.getAttribute('data-wsp-order-item'))

test('the engine list: one row per engine in the order stored, with its place, readiness, and the buttons that move it', async () => {
  const { root } = await page('en', { engines: ['ddg', 'exa', 'jina'] }, { EXA_API_KEY: 'x' })
  const list = group(root, 'order').querySelector('[data-wsp-order="engines"]')!
  assert.deepEqual(items(list, '[data-wsp-order-item]'), ['ddg', 'exa', 'jina'])
  const rows = list.querySelectorAll('[data-wsp-order-item]')
  assert.deepEqual(rows.map(row => row.querySelector('.wsp-order-no')!.text), ['1', '2', '3'])
  assert.match(rows[0]!.text, /DuckDuckGo/)
  assert.match(rows[0]!.text, /Ready/, 'a source that needs no key is ready')
  assert.match(rows[1]!.text, /Exa.*Ready/, 'a key that is stored makes it ready')
  assert.match(rows[2]!.text, /Jina AI.*No key/, 'and a keyed source without one says so')
  const buttons = (row: (typeof rows)[number], action: string) => row.querySelector(`[data-wsp-action="${action}"]`)!
  assert.ok(buttons(rows[0]!, 'order-up').hasAttribute('disabled'), 'the first cannot go up')
  assert.ok(!buttons(rows[1]!, 'order-up').hasAttribute('disabled') && !buttons(rows[1]!, 'order-down').hasAttribute('disabled'))
  assert.ok(buttons(rows[2]!, 'order-down').hasAttribute('disabled'), 'the last cannot go down')
  for (const row of rows) for (const action of ['order-up', 'order-down', 'order-remove']) assert.ok(buttons(row, action).getAttribute('aria-label'), action + ' has an accessible name')
  assert.equal(list.querySelector('input.wsp-sm')!.getAttribute('aria-label'), 'Confidence of DuckDuckGo')
  // The add box offers what is not in the list yet, and never what is.
  const options = list.querySelectorAll('[data-wsp-add="engine"] option').map(option => option.getAttribute('value'))
  assert.ok(options.includes('bing') && options.includes('deepseek') && options.includes('seam'))
  assert.ok(!options.includes('ddg') && !options.includes('exa') && !options.includes('jina'))
  assert.ok(options.every(value => !value?.startsWith('custom-cli:')), 'no custom CLI is marked as a general engine')
})

test('restore default is a button that is live only while the list is overridden, and the custom CLIs marked as engines are offered', async () => {
  const stored = await page('en', { engines: ['ddg'], cliAdapters: { echo: echo(), plat: jsonTool() } })
  const addOptions = stored.root.querySelectorAll('[data-wsp-add="engine"] option').map(option => option.getAttribute('value'))
  assert.ok(addOptions.includes('custom-cli:echo'), 'an engine CLI is offered')
  assert.ok(!addOptions.includes('custom-cli:plat'), 'a platform-only CLI is not')
  assert.ok(!stored.root.querySelector('[data-wsp-action="order-restore"]')!.hasAttribute('disabled'))
  const fresh = await page('en')
  assert.ok(fresh.root.querySelector('[data-wsp-action="order-restore"]')!.hasAttribute('disabled'), 'nothing to restore')
  // A custom CLI that is in the list shows as custom with its spec state and confidence.
  const withCustom = await page('en', { engines: ['ddg', 'custom-cli:echo', 'custom-cli:ghost'], cliAdapters: { echo: echo({ confidence: 0.6 }) } })
  const rows = group(withCustom.root, 'order').querySelectorAll('[data-wsp-order="engines"] [data-wsp-order-item]')
  assert.match(rows[1]!.text, /Custom/)
  assert.match(rows[1]!.text, /Spec valid/)
  assert.match(rows[1]!.text, /confidence 0\.6/)
  assert.equal(rows[1]!.querySelector('input.wsp-sm')!.getAttribute('placeholder'), '0.6', 'the box shows the default it would have')
  assert.match(rows[2]!.text, /No such custom CLI/, 'an id with no spec is flagged')
})

test('the order a search would use: DeepSeek leads, disabled leaves, only-free keeps it out, a list of your own stays yours, and each says why', async () => {
  const defaults = ['ddg', 'bing', 'exa', 'seam', 'jina']
  const chain = (root: ReturnType<typeof parse>) => group(root, 'order').querySelector('[data-wsp-chain]')!.querySelectorAll('code').map(node => node.text)
  const why = (root: ReturnType<typeof parse>) => group(root, 'order').querySelector('[data-wsp-why]')!.text
  const lead = await page('en', { engines: defaults }, { DEEPSEEK_API_KEY: 'x' })
  assert.deepEqual(chain(lead.root), ['deepseek', ...defaults])
  assert.match(why(lead.root), /deepseek: a key is set, so the default rule puts it in front of the list/)
  const off = await page('en', { engines: defaults, sources: { disabled: ['bing'] } }, { DEEPSEEK_API_KEY: 'x' })
  assert.deepEqual(chain(off.root), ['deepseek', 'ddg', 'exa', 'seam', 'jina'])
  assert.match(why(off.root), /sources\.disabled leaves out bing\./)
  const free = await page('en', { engines: defaults, evidence: { sourcePolicy: 'anonymous-only' } }, { DEEPSEEK_API_KEY: 'x' })
  assert.deepEqual(chain(free.root), defaults)
  assert.match(why(free.root), /Free sources only \(anonymous-only\): deepseek is not added\./)
  const own = await page('en', { engines: ['bing', 'ddg'] }, { DEEPSEEK_API_KEY: 'x' })
  assert.deepEqual(chain(own.root), ['bing', 'ddg'])
  assert.match(why(own.root), /your own order, so deepseek is not added/)
  const prio = await page('en', { engines: defaults, sources: { priority: ['jina'] } })
  assert.deepEqual(chain(prio.root), ['jina', 'ddg', 'bing', 'exa', 'seam'])
  assert.match(why(prio.root), /sources\.priority moves jina to the front/)
  const plain = await page('en', { engines: ['ddg', 'bing'] })
  assert.match(why(plain.root), /Same as the list above/)
  const none = await page('en', { engines: ['ddg'], sources: { disabled: ['ddg'] } })
  assert.match(why(none.root), /Every engine is disabled/)
  // A draft edit shows at once: the preview reads the staged text.
  const staged = await page('zh', { engines: defaults }, { DEEPSEEK_API_KEY: 'x' }, undefined, controller => controller.edit('engines', 'bing, ddg'))
  assert.deepEqual(chain(staged.root), ['bing', 'ddg'])
  assert.match(why(staged.root), /这是你自己写的顺序，deepseek 不会自动加入/)
})

test('the three-way relation is written out, with the current priority and disabled lists and a link to where they are set', async () => {
  const { root } = await page('en', { sources: { priority: ['jina'], disabled: ['bing'] } })
  const note = group(root, 'order').querySelector('[data-wsp-order-rules]')!
  assert.match(note.text, /explicit engines in the call wins; then the list above; then sources\.priority \/ sources\.disabled/)
  assert.match(note.text, /Priority: jina/)
  assert.match(note.text, /Disabled: bing/)
  assert.ok(note.querySelector('[data-wsp-open-sources]'))
  const common = group(root, 'common')
  assert.ok(common.querySelector('[data-wsp-open-order]'), 'the common group links to the order editor')
})

test('platforms: one row each with its chain, the built-in default shown as such, an override marked; the dialog body lists the chain and what can still be added', async () => {
  const { root, formsRoot } = await page('en', { platformBackends: { xiaohongshu: ['xhs', 'opencli'] }, cliAdapters: { mine: jsonTool() } })
  const rows = group(root, 'order').querySelectorAll('[data-wsp-platform-list] [data-wsp-item]')
  assert.deepEqual(rows.map(row => row.getAttribute('data-wsp-item')), [...ORDER_PLATFORMS])
  const byId = (id: string) => rows.find(row => row.getAttribute('data-wsp-item') === id)!
  assert.match(byId('xiaohongshu').text, /Overridden/)
  assert.match(byId('xiaohongshu').text, /xhs › OpenCLI/)
  assert.match(byId('reddit').text, /Default/)
  assert.match(byId('reddit').text, /OpenCLI › rdt › dsh-browser OpenCLI/)
  assert.equal(group(root, 'order').querySelectorAll('[role=dialog]').length, 0)
  // The dialog body of an overridden and of a default platform.
  const xhs = formsRoot.querySelector('[data-form="platform"][data-id="xiaohongshu"]')!
  assert.deepEqual(items(xhs, '[data-wsp-order-item]'), ['xhs', 'opencli'])
  assert.ok(!xhs.querySelector('[data-wsp-action="platform-restore"]')!.hasAttribute('disabled'))
  const addable = xhs.querySelectorAll('[data-wsp-add="backend"] option').map(option => option.getAttribute('value')).filter(Boolean)
  assert.ok(addable.includes('browser-opencli') && !addable.includes('xhs') && !addable.includes('rdt'))
  const weibo = formsRoot.querySelector('[data-form="platform"][data-id="weibo"]')!
  assert.deepEqual(items(weibo, '[data-wsp-order-item]'), ['browser-search'], 'a platform without an override lists its default chain')
  assert.ok(weibo.querySelector('[data-wsp-action="platform-restore"]')!.hasAttribute('disabled'), 'and has nothing to restore')
  assert.ok(weibo.querySelector('.wsp-order-default'), 'the default chain is drawn muted')
  assert.ok(weibo.querySelectorAll('[data-wsp-add="backend"] option').map(option => option.getAttribute('value')).includes('custom-cli:mine'), 'a custom CLI that declares weibo can be added')
})

test('the custom CLI list: purpose, confidence and the validity of each spec, a problem shown in place of the command, add and example buttons', async () => {
  const { root } = await page('en', { cliAdapters: { echo: echo({ confidence: 0.8 }), plat: jsonTool(), bad: echo({ bins: ['/usr/bin/x'], platforms: [] }) } })
  const list = group(root, 'cli').querySelector('[data-wsp-cli-list]')!
  const rows = list.querySelectorAll('[data-wsp-item]')
  assert.deepEqual(rows.map(row => row.getAttribute('data-wsp-item')), ['echo', 'plat', 'bad'])
  assert.match(rows[0]!.text, /General engine/)
  assert.match(rows[0]!.text, /confidence 0\.8/)
  assert.match(rows[0]!.text, /Spec valid/)
  assert.match(rows[0]!.text, /echo \{query\}/, 'the command and its argument template')
  assert.match(rows[1]!.text, /platforms weibo/)
  assert.match(rows[1]!.text, /confidence 0\.7/)
  assert.match(rows[2]!.text, /Spec has problems · \d/)
  assert.match(rows[2]!.text, /bins must be 1\.\.4 command names/, 'the first problem is the meta line')
  for (const row of rows) for (const action of ['cli-edit', 'cli-copy', 'cli-delete']) assert.ok(row.querySelector(`[data-wsp-action="${action}"]`), action)
  assert.ok(group(root, 'cli').querySelector('[data-wsp-action="cli-add"]') && group(root, 'cli').querySelector('[data-wsp-action="cli-add-example"]'))
  assert.match(group(root, 'cli').text, /read-only guarantee is the one of the built-in adapters/)
  const empty = await page('en')
  assert.match(group(empty.root, 'cli').text, /No custom CLI yet/)
  assert.equal(group(empty.root, 'cli').querySelectorAll('[data-wsp-item]').length, 0)
})

test('the edit form of a whole-output tool: no field mapping, the whole-output switch on, the derived subcommands, the JSON view, Try it unavailable without a channel', async () => {
  const { formsRoot, missingKeys } = await page('en', {}, {}, { echo: echo() })
  const form = formsRoot.querySelector('[data-form="cli"][data-id="echo"]')!
  assert.equal(form.querySelector('#web-search-pro-cli-bin')!.getAttribute('value'), 'echo')
  assert.deepEqual(form.querySelectorAll('[data-wsp-tokens] input').map(input => input.getAttribute('value')), ['{query}'])
  assert.equal(form.querySelector('#web-search-pro-cli-format')!.querySelector('option[selected]')?.getAttribute('value') ?? form.querySelector('#web-search-pro-cli-format')!.getAttribute('value'), 'text')
  assert.ok(form.querySelector('input[role=switch][aria-label="Whole output"]')!.hasAttribute('checked'))
  assert.ok(form.querySelector('[data-wsp-whole-note]'), 'the limits of whole output are written next to it')
  assert.match(form.querySelector('[data-wsp-whole-note]')!.text, /never fetches it/)
  assert.equal(form.querySelector('#web-search-pro-cli-field-url'), null, 'no field mapping in this mode')
  assert.equal(form.querySelector('#web-search-pro-cli-items'), null)
  assert.match(form.querySelector('[data-wsp-allowed]')!.text, /no subcommands/)
  assert.ok(form.querySelector('[data-wsp-cli-check="ok"]'))
  assert.equal(form.querySelector('#web-search-pro-cli-confidence')!.getAttribute('placeholder'), '0.5')
  const json = form.querySelector('[data-wsp-json-view] textarea')!
  assert.deepEqual(JSON.parse(json.text.replace(/&quot;/g, '"')) as unknown, echo(), 'the JSON box holds the spec')
  assert.ok(form.querySelector('[data-wsp-trial-unavailable]'), 'no channel: Try it says what to do instead')
  assert.match(form.querySelector('[data-wsp-trial-unavailable]')!.text, /sources\.status/)
  assert.ok(!form.querySelector('[data-wsp-action="trial-run"]'))
  assert.deepEqual(missingKeys, [])
})

test('the edit form of a JSON tool: format, result path, the four field paths, platforms, and the server\'s messages beside the control they are about', async () => {
  const { formsRoot } = await page('en', {}, {}, { good: jsonTool(), bad: jsonTool({ bins: ['/usr/bin/x'], timeoutMs: 5, search: { argv: ['login', '{query}'], output: { format: 'json', itemsPath: 'a..b', fields: { url: 'a b' } } } }) })
  const good = formsRoot.querySelector('[data-form="cli"][data-id="good"]')!
  assert.equal(good.querySelector('#web-search-pro-cli-items')!.getAttribute('value'), 'data')
  assert.equal(good.querySelector('#web-search-pro-cli-field-url')!.getAttribute('value'), 'link')
  assert.equal(good.querySelector('#web-search-pro-cli-field-title')!.getAttribute('value'), 'name')
  assert.equal(good.querySelector('#web-search-pro-cli-field-snippet')!.getAttribute('value'), '')
  assert.match(good.querySelector('[data-wsp-allowed]')!.text, /search/)
  assert.deepEqual(good.querySelectorAll('[data-wsp-chips] .wsp-chip').map(chip => chip.text.replace('×', '').trim()).slice(0, 1), ['weibo'])
  assert.ok(good.querySelector('[data-wsp-cli-check="ok"]'))
  const bad = formsRoot.querySelector('[data-form="cli"][data-id="bad"]')!
  const near = (selector: string) => bad.querySelector(selector)!.closest('.wsp-row')!.text
  assert.match(near('#web-search-pro-cli-bin'), /bins must be 1\.\.4 command names/)
  assert.match(near('#web-search-pro-cli-timeout'), /timeoutMs must be an integer 1000\.\.180000/)
  assert.match(near('#web-search-pro-cli-items'), /itemsPath must be a dotted path/)
  assert.match(near('#web-search-pro-cli-field-url'), /"a b" is not a dotted path/)
  assert.match(bad.querySelector('[data-wsp-tokens]')!.closest('.wsp-row')!.text, /"login" is a write \/ login command \(read-only guard\)/)
  assert.ok(bad.querySelector('[data-wsp-cli-check="bad"]'))
})

test('the dialog dictionaries cover the new groups in both languages', async () => {
  for (const lang of ['zh', 'en'] as const) {
    const { missingKeys, root, formsRoot } = await page(lang, { engines: ['ddg', 'custom-cli:echo'], platformBackends: { weibo: ['browser-search'] }, cliAdapters: { echo: echo() } }, {}, { echo: echo(), mytool: jsonTool() })
    assert.deepEqual(missingKeys, [], lang)
    assert.ok(group(root, 'order') && group(root, 'cli') && formsRoot.querySelector('[data-form="cli"]'))
  }
})
