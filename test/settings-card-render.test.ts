/**
 * What the real SettingsCard puts on the page, read from its rendered markup (not from a list of field names):
 * every control of the form model is rendered, the sections are there and collapsible, the route help names the
 * configured provider id, no secret value reaches the page, and both shipped dictionaries cover every key the card asks for.
 * The card is bundled with the rolldown that tsdown ships and rendered with react-dom/server.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { before, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { parse } from 'node-html-parser'
import { ALL_SPECS, CREDENTIAL_IDS } from '../src/client/form.ts'
import { JSON_FIELDS, SOURCE_DEFS, sourceFields } from '../src/client/field-keys.ts'
import { en, zh } from '../src/client/locales.ts'
import { ANONYMOUS_SOURCES } from '../src/client/sources-table.ts'
import { KEYED_SOURCE_IDS } from '../src/providers/keyed-meta.ts'
import { costTierOf } from '../src/providers/registry.ts'
import { BUILTIN_RUBRIC_IDS } from '../src/pipeline/rubrics-spec.ts'
import { builtinAdapters } from '../src/providers/builtin.ts'
import { harness } from './settings-harness.ts'

const require = createRequire(import.meta.url)

type Render = (state: unknown, lang: 'zh' | 'en', view?: 'page' | 'summary') => { html: string; missingKeys: string[] }
let renderCard: Render | undefined
let renderForms: ((state: unknown, lang: 'zh' | 'en') => { html: string; missingKeys: string[] }) | undefined

before(async () => {
  // No skip on failure: the card is part of what ships, so an environment that cannot bundle it must fail loudly.
  {
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
  }
})

const GROUPS = ['common', 'order', 'sources', 'cli', 'reading', 'judge', 'route', 'runtime', 'network', 'ranking', 'advanced']

/** The card and every dialog body, parsed. `user` is the stored settings; `credentials` the refs that hold a secret. */
function page(lang: 'zh' | 'en', user: Record<string, unknown> = {}, credentials: Record<string, string> = {}) {
  const { controller, credentialValues } = harness(undefined, user)
  for (const [ref, value] of Object.entries(credentials)) credentialValues.set(ref, value)
  return controller.refreshCredentials().then(() => {
    const card = renderCard!(controller.snapshot(), lang)
    const forms = renderForms!(controller.snapshot(), lang)
    controller.dispose()
    return { card, forms, root: parse(card.html), formsRoot: parse(forms.html), html: card.html + forms.html, missingKeys: [...card.missingKeys, ...forms.missingKeys] }
  })
}

const entriesOf = (root: ReturnType<typeof parse>, field: string) => root.querySelectorAll(`[data-wsp-field="${field}"]`).length

test('the card is a status summary, eleven accordion groups of which only Common is open, and a sticky save bar', async () => {
  const { root } = await page('en')
  assert.ok(root.querySelector('[data-wsp-summary]'), 'status summary on top')
  assert.deepEqual(root.querySelectorAll('details[data-wsp-group]').map(node => node.getAttribute('data-wsp-group')), GROUPS)
  assert.deepEqual(root.querySelectorAll('details[data-wsp-group]').filter(node => node.hasAttribute('open')).map(node => node.getAttribute('data-wsp-group')), ['common'], 'only the common group starts open')
  for (const group of root.querySelectorAll('details[data-wsp-group]')) {
    assert.ok(group.querySelector('summary strong'), 'a group has a heading that toggles it')
    assert.ok(group.querySelector('summary span span'), 'and a one-line summary')
  }
  assert.ok(root.querySelector('[data-wsp-savebar]'), 'the save bar')
  assert.equal(root.querySelectorAll('[data-web-search-pro-settings]').length, 1)
})

test('every public config field has exactly one entry in the card (or in the dialog of its list row), and every secret exactly one write-only input', async () => {
  const { root, formsRoot, html, missingKeys } = await page('en', { registerProvider: true })
  for (const spec of ALL_SPECS) {
    const where = entriesOf(root, spec.field) + entriesOf(formsRoot, spec.field)
    assert.equal(where, 1, `${spec.field} has exactly one entry (found ${where})`)
  }
  for (const id of CREDENTIAL_IDS) {
    assert.equal(root.querySelectorAll(`[data-wsp-credential="${id}"]`).length + formsRoot.querySelectorAll(`[data-wsp-credential="${id}"]`).length, 1, `credential ${id}`)
    assert.ok(formsRoot.querySelector(`input[id="web-search-pro-credential-${id}"][type=password]`), `write-only input of ${id}`)
  }
  assert.equal(parse(html).querySelectorAll('input[type=password]').length, CREDENTIAL_IDS.length)
  // Every control has an accessible name: a label tied to its id, or an aria-label (switches, chips, secrets).
  const labels = new Set([...root.querySelectorAll('label[for]'), ...formsRoot.querySelectorAll('label[for]')].map(node => node.getAttribute('for')))
  for (const node of [...root.querySelectorAll('input,select,textarea'), ...formsRoot.querySelectorAll('input,select,textarea')]) {
    assert.ok(node.getAttribute('aria-label') || labels.has(node.getAttribute('id') ?? '\u0000'), 'unnamed control: ' + node.outerHTML.slice(0, 120))
  }
  assert.deepEqual(missingKeys, [])
})

test('the route fields exist only while the route is on; the dialogs hold the keys, JSON objects, rubrics and the Twitter values', async () => {
  const off = await page('en')
  assert.equal(entriesOf(off.root, 'registerProvider'), 1)
  for (const field of ['providerId', 'provider.evidence', 'provider.deadlineMs']) assert.equal(entriesOf(off.root, field), 0, field + ' hidden while the route is off')
  const on = await page('en', { registerProvider: true })
  for (const field of ['providerId', 'provider.evidence', 'provider.deadlineMs']) assert.equal(entriesOf(on.root, field), 1, field)
  assert.equal(off.formsRoot.querySelectorAll('[data-form="source"]').length, SOURCE_DEFS.length)
  assert.deepEqual(off.formsRoot.querySelectorAll('[data-form="rubric"]').map(node => node.getAttribute('data-id')), [...BUILTIN_RUBRIC_IDS])
  assert.deepEqual(off.formsRoot.querySelectorAll('[data-form="json"]').map(node => node.getAttribute('data-id')), JSON_FIELDS.map(entry => entry.field))
  assert.deepEqual(off.formsRoot.querySelectorAll('[data-form="platform"]').map(node => node.getAttribute('data-id')), ['xiaohongshu', 'weibo'])
  assert.deepEqual(off.formsRoot.querySelectorAll('[data-form="cli"]').map(node => node.getAttribute('data-id')), ['echo'])
})

test('lists: one row per source with its tier, key state and the common mark; one per JSON object; one per rubric; dialogs stay closed until asked', async () => {
  const { root } = await page('en')
  const rows = root.querySelectorAll('[data-wsp-source-list] [data-wsp-item]').map(node => node.getAttribute('data-wsp-item'))
  assert.deepEqual(rows, ['deepseek', ...SOURCE_DEFS.map(def => def.id)], 'DeepSeek in Common, then every source in Sources')
  const common = root.querySelectorAll('[data-wsp-source-list] [data-wsp-item="deepseek"]')
  assert.equal(common.length, 2)
  for (const item of common) assert.match(item.text, /Common/)
  for (const item of root.querySelectorAll('[data-wsp-source-list] [data-wsp-item]').filter(node => node.getAttribute('data-wsp-item') !== 'deepseek')) assert.doesNotMatch(item.text, /Common/)
  assert.equal(root.querySelectorAll('[role=dialog]').length, 0, 'no dialog is open')
  // The JSON lists are in the groups they belong to: scoring, runtime, platforms and, for the two that have editors of their own, "Advanced".
  assert.deepEqual(root.querySelectorAll('[data-wsp-json-list] [data-wsp-item]').map(node => node.getAttribute('data-wsp-item')), (['judge', 'runtime', 'platform', 'advanced'] as const).flatMap(group => JSON_FIELDS.filter(entry => entry.group === group).map(entry => entry.field)))
  assert.deepEqual(root.querySelectorAll('details[data-wsp-group="advanced"] [data-wsp-json-list] [data-wsp-item]').map(node => node.getAttribute('data-wsp-item')), ['platformBackends', 'cliAdapters'], 'the raw JSON of the order and the CLIs moved to Advanced')
  assert.deepEqual(root.querySelectorAll('[data-wsp-rubrics] [data-wsp-item]').map(node => node.getAttribute('data-wsp-item')), [...BUILTIN_RUBRIC_IDS])
  assert.equal(root.querySelectorAll('textarea').length, 1, 'the only text box on the closed page is the text view')
})

test('the status summary shows the chain a search tries: DeepSeek leads once its key is stored, sources.disabled removes it, a customised engines list is left alone', async () => {
  const chain = (root: ReturnType<typeof parse>) => root.querySelector('[data-wsp-chain]')!.querySelectorAll('code').map(node => node.text)
  const none = await page('en')
  assert.deepEqual(chain(none.root), ['seam', 'exa', 'ddg'], 'the harness engines are seam, exa, ddg and a custom list is shown as it is')
  const withKey = await page('en', { engines: ['ddg', 'bing', 'exa', 'seam', 'jina'] }, { DEEPSEEK_API_KEY: 'x' })
  assert.deepEqual(chain(withKey.root), ['deepseek', 'ddg', 'bing', 'exa', 'seam', 'jina'])
  assert.match(withKey.root.querySelector('[data-wsp-summary]')!.text, /DeepSeek Search \/ Fetch · Common · ready/)
  const disabled = await page('en', { engines: ['ddg', 'bing', 'exa', 'seam', 'jina'], sources: { disabled: ['deepseek'] } }, { DEEPSEEK_API_KEY: 'x' })
  assert.deepEqual(chain(disabled.root), ['ddg', 'bing', 'exa', 'seam', 'jina'])
  const own = await page('en', { engines: ['bing', 'ddg'] }, { DEEPSEEK_API_KEY: 'x' })
  assert.deepEqual(chain(own.root), ['bing', 'ddg'])
  const summary = (await page('zh', {}, { DEEPSEEK_API_KEY: 'x' })).root.querySelector('[data-wsp-summary]')!.text
  assert.match(summary, /已配置 Key 的来源 1\/\d+/)
  assert.match(summary, /常用/)
})

test('the groups hold the fields the milestone names, and enum options are the schema values', async () => {
  const { root, formsRoot } = await page('en', { registerProvider: true })
  const within = (group: string, field: string) => root.querySelector(`details[data-wsp-group="${group}"] [data-wsp-field="${field}"]`)
  for (const field of ['searchMaxResults', 'parallelEngines', 'toolSurface', 'allowProxyFakeIp', 'deepseekFetch']) assert.ok(within('common', field), field)
  assert.equal(within('common', 'engines'), null, 'the engine list is edited in "Search order" now')
  assert.ok(within('order', 'engines'), 'engines')
  for (const field of ['evidence.sourcePolicy', 'sources.priority', 'sources.disabled', 'openalexMailto']) assert.ok(within('sources', field), field)
  for (const field of ['fetchDefaultChars', 'exaContentsPerUrlChars', 'exaContentsTotalChars', 'evidence.autoProviders', 'evidence.maxRounds', 'evidence.maxQueries']) assert.ok(within('reading', field), field)
  for (const field of ['evidence.judge.mode', 'evidence.hybridBorderline', 'evidence.judge.provider', 'evidence.maxJevQuestions', 'evidence.judge.allowLlm', 'evidence.coverage.mode', 'evidence.coverage.provider', 'evidence.coverage.thresholds.weak', 'evidence.coverage.thresholds.covered', 'evidence.budget.perSearchInputTokens', 'evidence.budget.dailyInputTokens', 'evidence.budget.timezone']) assert.ok(within('judge', field), field)
  for (const field of ['registerProvider', 'providerId', 'provider.evidence', 'provider.deadlineMs']) assert.ok(within('route', field), field)
  for (const field of ['enableCliBackends', 'opencliEnabled', 'agentReachEnabled']) assert.ok(within('runtime', field), field)
  for (const field of ['timeoutMs', 'ttlSeconds', 'memoryCacheEntries', 'dbPath', 'verbose']) assert.ok(within('network', field), field)
  for (const field of ['rrfConstant', 'freshnessBoost', 'freshnessDays', 'authorityBoost', 'authorityDomains']) assert.ok(within('ranking', field), field)
  const options = (id: string) => root.querySelectorAll(`select[id="web-search-pro-${id}"] option`).map(option => option.getAttribute('value'))
  assert.deepEqual(options('toolSurface'), ['indexed', 'flat'])
  assert.deepEqual(options('provider.evidence'), ['auto', 'off'])
  assert.deepEqual(options('evidence.judge.mode'), ['off', 'shadow', 'control', 'hybrid'])
  assert.deepEqual(options('evidence.coverage.mode'), ['off', 'shadow', 'control'])
  assert.deepEqual(options('evidence.sourcePolicy'), ['default', 'anonymous-only'])
  assert.deepEqual(options('evidence.judge.provider'), ['', 'bocha-jev', 'typesafe-jev', 'laya-local', 'jina-rerank', 'cohere-rerank'])
  // A source dialog holds, in this order: key reference, write-only key, endpoint, extras, budget.
  const fieldsIn = (id: string) => formsRoot.querySelectorAll(`[data-form="source"][data-id="${id}"] [data-wsp-field]`).map(node => node.getAttribute('data-wsp-field'))
  for (const def of SOURCE_DEFS) assert.deepEqual(fieldsIn(def.id), sourceFields(def), def.id)
})

test('the route help shows the profile patch for the configured provider id, and the sources group points at sources.status', async () => {
  const { root } = await page('zh', { providerId: 'my-search' })
  const help = root.querySelector('[data-wsp-route-help] pre')!.text
  assert.equal(help, "- id: web\n  name: '@deepseek-ai/dsh-web'\n  config:\n    searchProvider: my-search\n    fetchProvider: my-search")
  assert.match(root.querySelector('[data-wsp-status-line]')!.text, /web_call sources\.status/)
  assert.deepEqual(root.querySelectorAll('[data-wsp-anonymous] tbody tr').map(row => row.querySelector('code')!.text), ANONYMOUS_SOURCES.map(source => source.id))
})

test('stored problems and warnings are shown inline, with the server wording, and in the notices dialog count', async () => {
  const { root, formsRoot } = await page('en', { evidence: { judge: { provider: 'ghost' }, jevMode: 'shadow', rubrics: { 'gate.relevance': { version: 'v2', instructions: 'x {nope} {need} {candidate}' } } } })
  assert.match(root.querySelector('details[data-wsp-group="judge"] [data-wsp-field="evidence.judge.provider"]')!.text, /provider "ghost" is not defined/)
  assert.match(formsRoot.querySelector('[data-wsp-rubric="gate.relevance"] [data-wsp-rubric-problems]')!.text, /unknown variable \{nope\}/)
  assert.ok(formsRoot.querySelector('[data-wsp-rubric="gate.relevance"]')!.text.includes('Restore default'), 'an override can be restored')
  assert.ok(Number(root.querySelector('[data-wsp-warnings-count]')!.getAttribute('data-wsp-warnings-count')) >= 2, 'the summary counts both')
})

test('no secret value reaches the page', async () => {
  const { html } = await page('en', { exaApiKey: 'sk-literal-exa', keyedSources: { tavily: { apiKey: 'tvly-literal', apiKeyEnv: 'T_ENV' } }, evidence: { judge: { providers: { mine: { protocol: 'systemone', baseUrl: 'https://j.example.com', model: 'm', keyRef: 'MY_KEY' } } } } }, { DEEPSEEK_API_KEY: 'stored-secret-value' })
  assert.doesNotMatch(html, /sk-literal-exa|tvly-literal|stored-secret-value/)
  assert.match(html, /MY_KEY/, 'the keyRef name is shown')
  assert.match(html, /T_ENV/)
})

test('the summary view is the one-line description', () => {
  const { controller } = harness()
  assert.equal(renderCard!(controller.snapshot(), 'zh', 'summary').html, zh.description)
  controller.dispose()
})

/** Hints are one short line; the longer explanation sits behind the `?` (a `Help` entry) or in a note. */
const LONG_HINT_OK = new Set(['sourcesListHint', 'jsonDialogHint', 'twitterGroupHint', 'anonymousHint', 'keyedEnvHint', 'keyedBaseUrlHint', 'credentialWriteOnlyHint', 'credentialReadOnlyHint', 'textViewHint'])

test('both dictionaries have the same keys, every value is non-empty, hints are one short line, and the card asks for no key outside them', async () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  for (const [lang, dictionary] of [['zh', zh], ['en', en]] as const) {
    for (const [key, value] of Object.entries(dictionary)) if (key !== 'unitCount') assert.ok(value.trim().length > 0, `${lang}.${key} is empty`)
    for (const [key, value] of Object.entries(dictionary)) {
      if (key.endsWith('Hint') && !LONG_HINT_OK.has(key)) assert.ok(value.length <= (lang === 'zh' ? 40 : 80), `${lang}.${key} is ${value.length} characters: move the detail to ${key.replace(/Hint$/, 'Help')}`)
      if (key.endsWith('Help')) assert.ok(value.length <= 480, `${lang}.${key} is ${value.length} characters`)
    }
    assert.deepEqual((await page(lang, { registerProvider: true })).missingKeys, [])
  }
  // Rubric editing open with problems still only asks for dictionary keys.
  const { controller } = harness()
  controller.startRubric('score.support')
  controller.editRubric('score.support', 'instructions', 'broken {x}')
  for (const lang of ['zh', 'en'] as const) assert.deepEqual(renderForms!(controller.snapshot(), lang).missingKeys, [])
  controller.dispose()
})

test('the anonymous source table is pinned to the provider registry', () => {
  const descriptors = new Map(builtinAdapters().map(adapter => [adapter.descriptor.aliases[0]!, adapter.descriptor]))
  for (const source of ANONYMOUS_SOURCES) {
    const descriptor = descriptors.get(source.id)
    assert.ok(descriptor, `${source.id} is a registered source`)
    const needsKey = descriptor.requirements.some(requirement => requirement.kind !== 'key' ? requirement.kind === 'cli' || requirement.kind === 'browser' : !requirement.optional)
    assert.equal(needsKey, false, `${source.id} runs without a key, a CLI or the browser`)
    assert.ok(source.use in zh && source.use in en)
  }
})

test('the sources list is pinned to the provider registry: ids, tiers, the common mark, key variables, and every keyed source is listed', () => {
  const descriptors = new Map(builtinAdapters().map(adapter => [adapter.descriptor.aliases[0]!, adapter.descriptor]))
  for (const def of SOURCE_DEFS) {
    const descriptor = descriptors.get(def.id)
    assert.ok(descriptor, `${def.id} is a registered source`)
    if (!['github', 'searxng', 'exa'].includes(def.id)) assert.equal(costTierOf(descriptor), def.tier, `${def.id} tier`)
    assert.equal(Boolean(descriptor.common), Boolean(def.common), `${def.id} common`)
    if (def.credential) assert.ok((CREDENTIAL_IDS as readonly string[]).includes(def.credential), def.credential)
    const key = descriptor.requirements.find(requirement => requirement.kind === 'key')
    if (key?.env && def.defaultEnv) assert.ok(key.env.includes(def.defaultEnv), `${def.id} default variable`)
  }
  for (const id of KEYED_SOURCE_IDS) assert.ok(SOURCE_DEFS.some(def => def.id === id), `${id} has a row`)
  assert.deepEqual(SOURCE_DEFS.filter(def => def.common).map(def => def.id), ['deepseek'])
})
