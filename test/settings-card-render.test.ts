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
import { CREDENTIAL_IDS, FIELD_SPECS, KEYED_SPECS, PATH_SPECS } from '../src/client/form.ts'
import { en, zh } from '../src/client/locales.ts'
import { ANONYMOUS_SOURCES } from '../src/client/sources-table.ts'
import { BUILTIN_RUBRIC_IDS } from '../src/pipeline/rubrics-spec.ts'
import { builtinAdapters } from '../src/providers/builtin.ts'
import { harness } from './settings-harness.ts'

const require = createRequire(import.meta.url)

type Render = (state: unknown, lang: 'zh' | 'en', view?: 'page' | 'summary') => { html: string; missingKeys: string[] }
let renderCard: Render | undefined

before(async () => {
  // No skip on failure: the card is part of what ships, so an environment that cannot bundle it must fail loudly.
  {
    const fromTsdown = createRequire(require.resolve('tsdown/package.json'))
    const rolldown = await import(fromTsdown.resolve('rolldown'))
    const bundle = await rolldown.rolldown({
      input: new URL('./ui/ssr-entry.tsx', import.meta.url).pathname, platform: 'node', logLevel: 'silent',
      transform: { define: { 'process.env.NODE_ENV': '"development"' }, jsx: { runtime: 'automatic' } },
    } as never)
    const { output } = await bundle.generate({ format: 'esm' })
    await bundle.close()
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-search-pro-ssr-')), 'card.mjs')
    fs.writeFileSync(file, output[0]!.code)
    renderCard = (await import(pathToFileURL(file).href)).renderCard
  }
})

const SECTIONS = ['search', 'network', 'tool-surface', 'route', 'evidence', 'judge', 'prompts', 'sources', 'credentials', 'runtime']

function page(lang: 'zh' | 'en', user: Record<string, unknown> = {}) {
  const { controller } = harness(undefined, user)
  const result = renderCard!(controller.snapshot(), lang)
  controller.dispose()
  return { ...result, root: parse(result.html) }
}

test('the card renders every section, collapsible, and a control for every field of the form model', () => {
  const { root, missingKeys } = page('en')
  assert.deepEqual(root.querySelectorAll('details[data-web-search-pro-section]').map(node => node.getAttribute('data-web-search-pro-section')), SECTIONS)
  for (const section of root.querySelectorAll('details[data-web-search-pro-section]')) {
    assert.ok(section.querySelector('summary h3'), 'a section has a summary heading that toggles it')
    assert.ok(section.querySelector('summary p'), 'and a one-line hint')
  }
  const ids = new Set(root.querySelectorAll('[id]').map(node => node.getAttribute('id')))
  const missing = [...FIELD_SPECS, ...PATH_SPECS, ...KEYED_SPECS].map(spec => spec.field).filter(field => !ids.has(`web-search-pro-${field}`))
  assert.deepEqual(missing, [])
  for (const id of CREDENTIAL_IDS) assert.ok(ids.has(`web-search-pro-credential-${id}`), `credential input ${id}`)
  assert.deepEqual(root.querySelectorAll('[data-web-search-pro-rubric]').map(node => node.getAttribute('data-web-search-pro-rubric')), [...BUILTIN_RUBRIC_IDS])
  assert.equal(root.querySelectorAll('[data-web-search-pro-keyed]').length, 7)
  assert.deepEqual(missingKeys, [])
})

test('the sections keep the groups the milestone names, and enum options are the schema values', () => {
  const { root } = page('en')
  const within = (section: string, id: string) => root.querySelector(`[data-web-search-pro-section="${section}"] [id="web-search-pro-${id}"]`)
  assert.ok(within('network', 'allowProxyFakeIp') && within('network', 'timeoutMs'))
  assert.ok(within('tool-surface', 'toolSurface'))
  for (const field of ['registerProvider', 'providerId', 'provider.evidence', 'provider.deadlineMs']) assert.ok(within('route', field), field)
  for (const field of ['evidence.autoProviders', 'evidence.maxRounds', 'evidence.maxQueries', 'fetchDefaultChars', 'exaContentsPerUrlChars', 'exaContentsTotalChars']) assert.ok(within('evidence', field), field)
  for (const field of ['evidence.judge.mode', 'evidence.hybridBorderline', 'evidence.judge.provider', 'evidence.maxJevQuestions', 'evidence.coverage.mode', 'evidence.coverage.thresholds.weak', 'evidence.coverage.thresholds.covered', 'evidence.budget.perSearchInputTokens', 'evidence.budget.dailyInputTokens', 'evidence.budget.timezone', 'evidence.judge.providers']) assert.ok(within('judge', field), field)
  for (const field of ['bochaApiKeyEnv', 'bochaBaseUrl', 'searxngUrl', 'openalexMailto', 'keyedSources.tavily.apiKeyEnv', 'keyedSources.baidu-qianfan.baseUrl']) assert.ok(within('sources', field), field)
  const options = (id: string) => root.querySelectorAll(`[id="web-search-pro-${id}"] option`).map(option => option.getAttribute('value'))
  assert.deepEqual(options('toolSurface'), ['indexed', 'flat'])
  assert.deepEqual(options('provider.evidence'), ['auto', 'off'])
  assert.deepEqual(options('evidence.judge.mode'), ['off', 'shadow', 'control', 'hybrid'])
  assert.deepEqual(options('evidence.coverage.mode'), ['off', 'shadow', 'control'])
  assert.deepEqual(options('evidence.judge.provider'), ['', 'bocha-jev', 'typesafe-jev', 'laya-local', 'jina-rerank', 'cohere-rerank'])
})

test('the route help shows the profile patch for the configured provider id, and the sources section points at sources.status', () => {
  const { root } = page('zh', { providerId: 'my-search' })
  const help = root.querySelector('[data-web-search-pro-route-help] pre')!.text
  assert.equal(help, "- id: web\n  name: '@deepseek-ai/dsh-web'\n  config:\n    searchProvider: my-search\n    fetchProvider: my-search")
  assert.match(root.querySelector('[data-web-search-pro-status-line]')!.text, /web_call sources\.status/)
  assert.deepEqual(root.querySelectorAll('[data-web-search-pro-anonymous] tbody tr').map(row => row.querySelector('code')!.text), ANONYMOUS_SOURCES.map(source => source.id))
})

test('stored problems and warnings are shown inline, with the server wording', () => {
  const { root } = page('en', { evidence: { judge: { provider: 'ghost' }, jevMode: 'shadow', rubrics: { 'gate.relevance': { version: 'v2', instructions: 'x {nope} {need} {candidate}' } } } })
  assert.match(root.querySelector('[data-web-search-pro-section="judge"] [data-web-search-pro-problem]')!.text, /provider "ghost" is not defined/)
  assert.match(root.querySelector('[data-web-search-pro-rubric="gate.relevance"] [data-web-search-pro-rubric-problems]')!.text, /unknown variable \{nope\}/)
  assert.equal(root.querySelector('[data-web-search-pro-rubric="gate.relevance"]')!.text.includes('overridden'), true)
})

test('no secret value reaches the page', () => {
  const { html } = page('en', { exaApiKey: 'sk-literal-exa', keyedSources: { tavily: { apiKey: 'tvly-literal', apiKeyEnv: 'T_ENV' } }, evidence: { judge: { providers: { mine: { protocol: 'systemone', baseUrl: 'https://j.example.com', model: 'm', keyRef: 'MY_KEY' } } } } })
  assert.doesNotMatch(html, /sk-literal-exa|tvly-literal/)
  assert.match(html, /MY_KEY/, 'the keyRef name is shown')
  assert.match(html, /T_ENV/)
  assert.equal(parse(html).querySelectorAll('input[type=password]').length, CREDENTIAL_IDS.length)
})

test('the summary view is the one-line description', () => {
  const { controller } = harness()
  assert.equal(renderCard!(controller.snapshot(), 'zh', 'summary').html, zh.description)
  controller.dispose()
})

test('both dictionaries have the same keys, every value is non-empty, and the card asks for no key outside them', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  for (const [lang, dictionary] of [['zh', zh], ['en', en]] as const) {
    for (const [key, value] of Object.entries(dictionary)) assert.ok(value.trim().length > 0, `${lang}.${key} is empty`)
    // Hints are one or two sentences, not manuals (the route help and the fake-IP symptom hint are the longest).
    for (const [key, value] of Object.entries(dictionary)) if (key.endsWith('Hint')) assert.ok(value.length <= 320, `${lang}.${key} is ${value.length} characters`)
    assert.deepEqual(page(lang).missingKeys, [])
  }
  // Rubric editing open with problems still only asks for dictionary keys.
  const { controller } = harness()
  controller.startRubric('score.support')
  controller.editRubric('score.support', 'instructions', 'broken {x}')
  for (const lang of ['zh', 'en'] as const) assert.deepEqual(renderCard!(controller.snapshot(), lang).missingKeys, [])
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
