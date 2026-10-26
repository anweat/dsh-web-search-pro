import assert from 'node:assert/strict'
import test from 'node:test'
import { load } from 'js-yaml'
import { effectiveChain, DEFAULT_ENGINES } from '../src/default-chain.ts'
import { fieldDoc } from '../src/client/field-docs.ts'
import { ALL_SPECS } from '../src/client/form.ts'
import { isPathSpec } from '../src/client/form-specs.ts'
import { renderTextView, stripComments } from '../src/client/text-view.ts'
import { harness } from './settings-harness.ts'

const view = (controller: ReturnType<typeof harness>['controller'], lang: string) => renderTextView(controller.snapshot().fields, ALL_SPECS, lang)

test('every field of the form model has a comment in both languages, and it states the default or the range', () => {
  for (const spec of ALL_SPECS) {
    for (const lang of ['en', 'zh']) {
      const doc = fieldDoc(spec.field, lang)
      assert.ok(doc && doc.length > 20, `${spec.field} has a ${lang} comment`)
      if (!spec.field.startsWith('evidence.rubrics.') && !/thresholds/.test(spec.field)) assert.match(doc!, lang === 'zh' ? /默认|留空/ : /Default|Empty|empty/, `${spec.field} ${lang} says what the default is`)
    }
    assert.notEqual(fieldDoc(spec.field, 'en'), fieldDoc(spec.field, 'zh'))
  }
  assert.equal(fieldDoc('nope', 'en'), undefined)
})

test('the text view prints every key with its comment in front; with nothing overridden the data is empty', () => {
  const { controller } = harness()
  for (const lang of ['en', 'zh']) {
    const text = view(controller, lang)
    const lines = text.split('\n')
    for (const spec of ALL_SPECS) {
      const key = isPathSpec(spec) ? spec.path.at(-1)! : spec.field
      const index = lines.findIndex(line => new RegExp(`^\\s*(# )?"?${key.replace(/[-.]/g, '\\$&')}"?:`).test(line))
      assert.ok(index > 0, `${spec.field} is printed`)
      assert.match(lines[index - 1]!, /^\s*# /, `a comment precedes ${spec.field}`)
    }
    assert.ok(text.startsWith('# '), 'the header is comments')
    assert.equal(stripComments(text), '', 'nothing is overridden in the harness: the data part is empty')
    assert.equal(load(stripComments(text)) ?? null, null)
  }
  assert.match(view(controller, 'zh'), /# 默认 ddg|默认 8/)
  assert.match(view(controller, 'en'), /Default: 8/)
  controller.dispose()
})

test('stripping the comments leaves exactly the overrides, as valid YAML with the right nesting; comments never become data', () => {
  const { controller } = harness()
  controller.edit('engines', 'ddg, bing')
  controller.edit('searchMaxResults', '12')
  controller.edit('evidence.sourcePolicy', 'anonymous-only')
  controller.edit('evidence.judge.mode', 'hybrid')
  controller.edit('evidence.coverage.thresholds.weak', '0.2')
  controller.edit('evidence.coverage.thresholds.covered', '0.6')
  controller.edit('sources.disabled', 'deepseek')
  controller.edit('keyedSources.tavily.apiKeyEnv', 'MY_TAVILY')
  controller.edit('sources.budget.deepseek.daily', '50')
  controller.edit('deepseekFetch', 'true')
  controller.edit('customPlatforms', '{"mine":{"name":"Mine","url":"https://x.test/?q={q}","item":"a","title":"a","link":"a"}}')
  for (const lang of ['en', 'zh']) {
    const text = view(controller, lang)
    const data = load(stripComments(text)) as Record<string, unknown>
    assert.deepEqual(data, {
      engines: ['ddg', 'bing'], searchMaxResults: 12, deepseekFetch: true,
      customPlatforms: { mine: { name: 'Mine', url: 'https://x.test/?q={q}', item: 'a', title: 'a', link: 'a' } },
      evidence: { sourcePolicy: 'anonymous-only', judge: { mode: 'hybrid' }, coverage: { thresholds: { weak: 0.2, covered: 0.6 } } },
      sources: { disabled: ['deepseek'], budget: { deepseek: { daily: 50 } } },
      keyedSources: { tavily: { apiKeyEnv: 'MY_TAVILY' } },
    })
    // The overridden keys are plain lines, the rest are commented ones, and the comment text is not in the data.
    assert.ok(!JSON.stringify(data).includes('Default'))
    assert.ok(text.includes('\n# searchMaxResults') === false && text.includes('\nsearchMaxResults: 12'))
    assert.ok(text.includes('\n# parallelEngines: false') || text.includes('# parallelEngines: false'), 'an untouched key is a commented line with its value in force')
  }
  // A draft that is not valid yet prints as a comment, not as broken data.
  controller.edit('searchMaxResults', 'abc')
  assert.equal((load(stripComments(view(controller, 'en'))) as Record<string, unknown>).searchMaxResults, undefined)
  controller.dispose()
})

test('the text view never contains a secret: not a stored literal, not a typed key, only credential names', async () => {
  const { controller, credentialValues } = harness(undefined, { exaApiKey: 'sk-literal-exa-value', keyedSources: { deepseek: { apiKey: 'sk-literal-deepseek-value', apiKeyEnv: 'MY_DEEPSEEK' } } })
  controller.editCredential('keyed:deepseek', 'sk-typed-secret-value')
  credentialValues.set('X', 'y')
  for (const lang of ['en', 'zh']) {
    const text = view(controller, lang)
    assert.doesNotMatch(text, /sk-literal|sk-typed/)
    assert.doesNotMatch(text, /^\s*apiKey:/m, 'no literal key line')
    assert.match(text, /MY_DEEPSEEK/, 'the name of the credential is printed')
  }
  controller.dispose()
})

test('the unsaved-changes count follows the staged edits: a field counts once, an edit back to the stored value or a discard clears it, a typed secret counts', async () => {
  const { controller, scope } = harness()
  const changes = () => controller.snapshot().changes
  assert.equal(changes(), 0)
  controller.edit('searchMaxResults', '12')
  controller.edit('searchMaxResults', '13')
  assert.equal(changes(), 1, 'the same field is one change')
  controller.edit('engines', 'ddg')
  controller.edit('evidence.judge.mode', 'hybrid')
  assert.equal(changes(), 3)
  controller.edit('searchMaxResults', '8')
  assert.equal(changes(), 2, 'back to the stored value: no change')
  controller.editCredential('exa', 'a-typed-key')
  assert.equal(changes(), 3)
  controller.editCredential('exa', '   ')
  assert.equal(changes(), 2, 'a blank secret writes nothing')
  controller.resetField('provider.deadlineMs')
  assert.equal(changes(), 2, 'a reset of a field that is not stored is no change')
  controller.discard()
  assert.equal(changes(), 0)
  controller.edit('engines', 'ddg')
  controller.edit('allowProxyFakeIp', 'true')
  await controller.save()
  assert.equal(changes(), 0, 'saved')
  assert.equal(scope.user.allowProxyFakeIp, true)
  controller.dispose()
})

test('effectiveChain is the one rule behind the router and the card: priority, then a ready common source, then the rest; a written list is left alone', () => {
  const D = [...DEFAULT_ENGINES]
  assert.deepEqual(effectiveChain({ engines: D }), D)
  assert.deepEqual(effectiveChain({ engines: D, commonReady: ['deepseek'] }), ['deepseek', ...D])
  assert.deepEqual(effectiveChain({ engines: D, commonReady: ['deepseek'], priority: ['bing'] }), ['bing', 'deepseek', 'ddg', 'exa', 'seam', 'jina'])
  assert.deepEqual(effectiveChain({ engines: D, commonReady: ['deepseek'], priority: ['deepseek', 'jina'] }), ['jina', 'deepseek', 'ddg', 'bing', 'exa', 'seam'], 'priority only moves ids the list holds')
  assert.deepEqual(effectiveChain({ engines: D, commonReady: ['deepseek'], disabled: ['deepseek', 'bing'] }), ['ddg', 'exa', 'seam', 'jina'])
  assert.deepEqual(effectiveChain({ engines: D, commonReady: ['deepseek'], anonymousOnly: true }), D)
  assert.deepEqual(effectiveChain({ engines: ['bing', 'ddg'], commonReady: ['deepseek'] }), ['bing', 'ddg'])
  assert.deepEqual(effectiveChain({ engines: ['ddg', 'deepseek'], commonReady: ['deepseek'] }), ['ddg', 'deepseek'])
  assert.throws(() => effectiveChain({ engines: ['ddg'], disabled: ['ddg'] }), /every configured engine is disabled/)
})
