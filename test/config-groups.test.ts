import assert from 'node:assert/strict'
import test from 'node:test'
import { CONFIG_FIELD_ORDER, CONFIG_GROUP_IDS, CONFIG_GROUP_TITLES, CONFIG_GROUPS, groupOf } from '../src/config-groups.ts'
import { Config, resolveConfig } from '../src/config.ts'
import { ALL_SPECS } from '../src/client/form.ts'
import { isPathSpec } from '../src/client/form-specs.ts'
import { renderTextView } from '../src/client/text-view.ts'
import { harness } from './settings-harness.ts'

const schemaKeys = (): string[] => Object.keys((Config as unknown as { dict: Record<string, unknown> }).dict)

test('the schema lists its fields group by group, in the order of config-groups.ts (what the Host\'s generic view and --dump-config print)', () => {
  assert.deepEqual(schemaKeys(), [...CONFIG_FIELD_ORDER])
})

test('every config field belongs to exactly one group, and the groups follow the settings page', () => {
  assert.deepEqual([...CONFIG_GROUP_IDS], ['common', 'order', 'sources', 'cli', 'evidence', 'runtime', 'advanced'])
  const seen = new Map<string, string>()
  for (const id of CONFIG_GROUP_IDS) {
    assert.ok(CONFIG_GROUPS[id].length > 0, id + ' is not empty')
    for (const key of CONFIG_GROUPS[id]) {
      assert.equal(seen.get(key), undefined, key + ' is in two groups')
      seen.set(key, id)
    }
  }
  for (const key of schemaKeys()) assert.ok(seen.has(key), key + ' has no group')
  for (const key of seen.keys()) assert.ok(schemaKeys().includes(key), key + ' is not a config field')
  assert.equal(groupOf('sources.priority'), 'order')
  assert.equal(groupOf('evidence.judge.mode'), 'evidence')
  assert.equal(groupOf('keyedSources.tavily.baseUrl'), 'sources')
  assert.equal(groupOf('dbPath'), 'advanced')
  assert.equal(groupOf('nope'), undefined)
  for (const lang of ['en', 'zh'] as const) for (const id of CONFIG_GROUP_IDS) assert.ok(CONFIG_GROUP_TITLES[lang][id], lang + ' title of ' + id)
})

test('the options of the object fields keep a stable order too (sources: priority, disabled, confidence, budget)', () => {
  const sources = (Config as unknown as { dict: Record<string, { dict: Record<string, unknown> }> }).dict.sources!
  assert.deepEqual(Object.keys(sources.dict), ['priority', 'disabled', 'confidence', 'budget'])
})

test('resolveConfig still resolves every field with the same defaults', () => {
  const resolved = resolveConfig({} as never)
  assert.equal(resolved.searchMaxResults, 8)
  assert.equal(resolved.toolSurface, 'indexed')
  assert.deepEqual(resolved.engines, ['ddg', 'bing', 'exa', 'seam', 'jina'])
})

test('the text view prints one section per group, in group order, with the Chinese section titles in zh; every field sits in its own group\'s section', () => {
  const { controller } = harness()
  const fields = controller.snapshot().fields
  for (const lang of ['en', 'zh'] as const) {
    const text = renderTextView(fields, ALL_SPECS, lang)
    const lines = text.split('\n')
    const heads = lines.map((line, index) => ({ line, index })).filter(entry => entry.line.startsWith('# ── '))
    assert.deepEqual(heads.map(h => h.line), CONFIG_GROUP_IDS.map(id => '# ── ' + CONFIG_GROUP_TITLES[lang][id] + ' ──'))
    for (const spec of ALL_SPECS) {
      const top = spec.field.split('.')[0]!
      const key = isPathSpec(spec) ? spec.path.at(-1)! : spec.field
      const group = groupOf(spec.field)!
      const from = heads[CONFIG_GROUP_IDS.indexOf(group)]!.index
      const to = heads[CONFIG_GROUP_IDS.indexOf(group) + 1]?.index ?? lines.length
      const found = lines.findIndex((line, index) => index > from && index < to && new RegExp(`^\\s*(# )?"?${key.replace(/[-.]/g, '\\$&')}"?:`).test(line))
      assert.ok(found > 0, `${spec.field} (${top}) is printed in the ${group} section`)
    }
  }
  assert.match(renderTextView(fields, ALL_SPECS, 'zh'), /# ── 常用 ──[\s\S]*# ── 搜索顺序 ──[\s\S]*# ── 来源与密钥/)
  controller.dispose()
})
