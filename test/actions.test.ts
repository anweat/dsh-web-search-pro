import test from 'node:test'
import assert from 'node:assert/strict'
import { ACTIONS, CALL_TOOL, INDEX_TOOL, findAction, flatToolName, findActionByFlatTool, isActionGroup } from '../src/actions/registry.ts'
import { ACTION_GROUPS, type OutputNode } from '../src/actions/types.ts'
import { checkOutput, compactSchema, validateArgs } from '../src/actions/schema.ts'
import { LEGACY_TOOLS, LEGACY_TOOL_NAMES, legacyLine, mapLegacyCall } from '../src/actions/legacy.ts'
import { mapError } from '../src/actions/errors.ts'
import { ActionArgError, ActionNotFoundError } from '../src/actions/types.ts'

const EXPECTED_ACTIONS = [
  'search.run', 'search.recommend',
  'read.fetch', 'read.contents', 'read.snapshot',
  'history.list', 'history.replay', 'history.expand', 'history.export', 'history.delete',
  'sources.status', 'sources.deps', 'sources.install',
  'rules.list', 'rules.upsert', 'rules.remove', 'rules.import', 'rules.export',
  'cache.clear', 'cache.stats',
]

test('the registry holds exactly the planned actions, named group.action', () => {
  assert.deepEqual(ACTIONS.map(action => action.name), EXPECTED_ACTIONS)
  assert.equal(new Set(ACTIONS.map(action => action.name)).size, ACTIONS.length)
  for (const action of ACTIONS) {
    assert.match(action.name, /^[a-z]+\.[a-z]+$/)
    assert.equal(action.name.split('.')[0], action.group)
    assert.ok(isActionGroup(action.group))
    assert.ok(action.summary.length > 20 && action.summary.length <= 400 && !action.summary.includes('\n'), action.name + ' summary')
    assert.equal(typeof action.execute, 'function')
    assert.equal(typeof action.render, 'function')
  }
  for (const group of ACTION_GROUPS) assert.ok(ACTIONS.some(action => action.group === group), group + ' has no action')
  assert.equal(INDEX_TOOL, 'web_index')
  assert.equal(CALL_TOOL, 'web_call')
})

test('flat tool names are unique, derived from the action name, and not the old tool names', () => {
  const names = ACTIONS.map(flatToolName)
  assert.equal(new Set(names).size, names.length)
  for (const action of ACTIONS) assert.equal(findActionByFlatTool(flatToolName(action)), action)
  assert.equal(flatToolName(findAction('search.run')!), 'web_search_run')
  for (const old of ['web_search_pro', 'web_fetch_pro', 'web_platform_search', 'web_exa_contents', 'web_snapshot', 'web_history', 'web_rule', 'web_search_stats', 'web_backend_status', 'web_deps']) {
    assert.ok(!names.includes(old), old + ' must not be a flat tool name')
  }
})

function assertClosed(node: OutputNode, path: string): void {
  if (node.type === 'object' && node.properties) {
    assert.notEqual(node.additionalProperties, true, path + ' must be closed')
    assert.equal(node.additionalProperties, false, path + ' must declare additionalProperties: false')
    for (const [key, child] of Object.entries(node.properties)) assertClosed(child, path + '.' + key)
  }
  if (node.type === 'array' && node.items) assertClosed(node.items, path + '[]')
}

test('every output schema is closed and its fields are optional unless marked', () => {
  for (const action of ACTIONS) {
    assert.equal(action.output.type, 'object')
    assert.equal(action.output.additionalProperties, false)
    assertClosed(action.output, action.name)
  }
  // search.run keeps the classic fields required and every evidence field optional, so both exits fit one schema.
  const run = findAction('search.run')!.output.properties
  assert.deepEqual(Object.entries(run).filter(([, node]) => node.required).map(([key]) => key).sort(), ['engine', 'fromCache', 'sources'])
})

test('checkOutput accepts conforming values and flags unknown or missing fields', () => {
  const stats = findAction('cache.clear')!.output
  assert.deepEqual(checkOutput(stats, { removedQueries: 1, removedResults: 2, removedPages: 3 }), [])
  assert.match(checkOutput(stats, { removedQueries: 1, removedResults: 2, removedPages: 3, extra: 1 }).join(), /extra: not declared/)
  assert.match(checkOutput(stats, { removedQueries: 1 }).join(), /removedResults: required but missing/)
  assert.match(checkOutput(stats, { removedQueries: 'x', removedResults: 2, removedPages: 3 }).join(), /expected number/)
})

test('every example validates against its action schema', () => {
  let checked = 0
  for (const action of ACTIONS) {
    for (const example of action.examples ?? []) {
      assert.deepEqual(validateArgs(action.params, example.args).errors, [], action.name)
      checked++
    }
  }
  assert.ok(checked >= ACTIONS.length)
})

test('validateArgs: required, unknown, wrong type, enum, null as absent', () => {
  const fetch = findAction('read.fetch')!
  assert.deepEqual(validateArgs(fetch.params, { url: 'https://a.test' }).errors, [])
  assert.match(validateArgs(fetch.params, {}).errors.join(), /url: required/)
  assert.match(validateArgs(fetch.params, { url: 'x', bogus: 1 }).errors.join(), /bogus: unknown argument/)
  assert.match(validateArgs(fetch.params, { url: 1 }).errors.join(), /url: expected string/)
  assert.match(validateArgs(fetch.params, { url: 'x', mode: 'nope' }).errors.join(), /mode: must be one of auto \| jina \| http \| playwright/)
  assert.deepEqual(validateArgs(fetch.params, { url: 'x', offset: null }).value, { url: 'x' })
  assert.match(validateArgs(fetch.params, 'oops').errors.join(), /expected object/)
  assert.match(compactSchema('read.fetch', fetch.params), /^read\.fetch\(url: string, mode\?: "auto"\|"jina"/)
})

test('approval classes and concurrency map the old tools\' flags per action', () => {
  const approval = Object.fromEntries(ACTIONS.map(action => [action.name, action.approval]))
  for (const name of ['sources.install']) assert.equal(approval[name], 'install')
  for (const name of ['cache.clear', 'history.delete', 'rules.upsert', 'rules.remove', 'rules.import']) assert.equal(approval[name], 'local-write', name)
  for (const action of ACTIONS) if (!['sources.install', 'cache.clear', 'history.delete', 'rules.upsert', 'rules.remove', 'rules.import'].includes(action.name)) assert.equal(action.approval, 'none', action.name)
  // Whatever changes state is approval-gated and never runs beside another call; the rest may overlap (web_rule list/export, every read-only tool were concurrency-safe).
  for (const action of ACTIONS) {
    assert.equal(action.mutating, action.approval !== 'none', action.name)
    assert.equal(action.concurrencySafe, !action.mutating, action.name)
  }
})

test('timeouts keep the old tools\' ceilings', () => {
  const config = { timeoutMs: 30_000 } as never
  const t = (name: string): number => findAction(name)!.timeoutMs(config)
  assert.equal(t('search.run'), 90_000)
  assert.equal(t('read.snapshot'), 90_000)
  assert.equal(t('read.fetch'), 60_000)
  assert.equal(t('read.contents'), 60_000)
  assert.equal(t('sources.deps'), 210_000)
  assert.equal(t('sources.install'), 210_000)
  assert.equal(t('sources.status'), 20_000)
  assert.equal(t('history.list'), 15_000)
  assert.equal(t('cache.clear'), 20_000)
  assert.equal(t('rules.list'), 10_000)
  assert.equal(t('cache.stats'), 10_000)
})

// Every parameter of the 11 old tools, as the old definitions declared them.
const OLD_PARAMS: Record<string, string[]> = {
  web_search_pro: ['query', 'engines', 'count', 'fresh', 'multi', 'exaType', 'includeDomains', 'excludeDomains', 'startPublishedDate', 'endPublishedDate', 'category', 'task', 'profile', 'needs', 'constraints', 'budget'],
  web_exa_contents: ['urls'],
  web_fetch_pro: ['url', 'mode', 'maxChars', 'offset', 'fresh', 'persist'],
  web_platform_search: ['platform', 'query', 'url', 'count', 'authProfile', 'rulePack'],
  web_snapshot: ['url', 'screenshot'],
  web_history: ['kind', 'query', 'engine', 'platform', 'limit', 'replay', 'export', 'action', 'evidenceId'],
  web_cache_clear: ['olderThanDays', 'engine', 'queryId'],
  web_rule: ['action', 'hostname', 'contentSelectors', 'removeSelectors', 'rulesJson'],
  web_search_stats: [],
  web_backend_status: ['action', 'task', 'profile', 'query', 'language', 'platform'],
  web_deps: ['action', 'backend', 'installer'],
}

// One representative old call per capability, each with the action it must become.
const OLD_CALLS: { tool: string; args: Record<string, unknown>; action: string; args2?: Record<string, unknown> }[] = [
  { tool: 'web_search_pro', args: { query: 'q', engines: 'ddg', count: 3, fresh: true, multi: true, exaType: 'fast', includeDomains: 'a.test', excludeDomains: 'b.test', startPublishedDate: '2026-01-01', endPublishedDate: '2026-02-01', category: 'news' }, action: 'search.run' },
  { tool: 'web_search_pro', args: { query: 'q', task: 't', profile: 'docs_code', needs: 'a;b', constraints: '[]', budget: 3000 }, action: 'search.run' },
  { tool: 'web_platform_search', args: { platform: 'rss', query: 'k', url: 'https://f.test/rss', count: 3, authProfile: 'p', rulePack: 'r' }, action: 'search.run' },
  { tool: 'web_exa_contents', args: { urls: ['https://a.test'] }, action: 'read.contents' },
  { tool: 'web_fetch_pro', args: { url: 'https://a.test', mode: 'http', maxChars: 5000, offset: 10, fresh: true, persist: false }, action: 'read.fetch' },
  { tool: 'web_snapshot', args: { url: 'https://a.test', screenshot: false }, action: 'read.snapshot' },
  { tool: 'web_history', args: { kind: 'search', query: 'q', engine: 'ddg', platform: 'github', limit: 5 }, action: 'history.list' },
  { tool: 'web_history', args: { replay: 'q_1' }, action: 'history.replay', args2: { id: 'q_1' } },
  { tool: 'web_history', args: { action: 'expand', evidenceId: 'e_1' }, action: 'history.expand', args2: { evidenceId: 'e_1' } },
  { tool: 'web_history', args: { export: true, kind: 'all', limit: 10 }, action: 'history.export', args2: { kind: 'all', limit: 10 } },
  { tool: 'web_cache_clear', args: { olderThanDays: 3, engine: 'ddg' }, action: 'cache.clear' },
  { tool: 'web_cache_clear', args: { queryId: 'q_1' }, action: 'history.delete', args2: { id: 'q_1' } },
  { tool: 'web_rule', args: { action: 'list' }, action: 'rules.list', args2: {} },
  { tool: 'web_rule', args: { action: 'upsert', hostname: 'a.test', contentSelectors: 'article', removeSelectors: 'nav' }, action: 'rules.upsert', args2: { hostname: 'a.test', contentSelectors: 'article', removeSelectors: 'nav' } },
  { tool: 'web_rule', args: { action: 'remove', hostname: 'a.test' }, action: 'rules.remove', args2: { hostname: 'a.test' } },
  { tool: 'web_rule', args: { action: 'import', rulesJson: '[]' }, action: 'rules.import', args2: { rulesJson: '[]' } },
  { tool: 'web_rule', args: { action: 'export' }, action: 'rules.export', args2: {} },
  { tool: 'web_search_stats', args: {}, action: 'cache.stats' },
  { tool: 'web_backend_status', args: {}, action: 'sources.status' },
  { tool: 'web_backend_status', args: { action: 'recommend', task: 't', profile: 'news_fact', query: 'q', language: 'zh', platform: 'github' }, action: 'search.recommend', args2: { task: 't', profile: 'news_fact', query: 'q', language: 'zh', platform: 'github' } },
  { tool: 'web_deps', args: {}, action: 'sources.deps' },
  { tool: 'web_deps', args: { action: 'check' }, action: 'sources.deps', args2: {} },
  { tool: 'web_deps', args: { action: 'install', backend: 'twitter', installer: 'uv' }, action: 'sources.install', args2: { backend: 'twitter', installer: 'uv' } },
]

test('every old tool name has a route, and the table covers exactly the 11 old tools', () => {
  assert.deepEqual([...LEGACY_TOOL_NAMES].sort(), Object.keys(OLD_PARAMS).sort())
  assert.equal(LEGACY_TOOL_NAMES.length, 11)
  for (const name of LEGACY_TOOL_NAMES) assert.ok(legacyLine().includes(name), name)
  assert.ok(Object.keys(LEGACY_TOOLS).every(name => name.startsWith('web_')))
})

test('every old call maps to an action that accepts the translated arguments', () => {
  for (const call of OLD_CALLS) {
    const mapped = mapLegacyCall(call.tool, call.args)
    assert.equal(mapped.action, call.action, call.tool + ' ' + JSON.stringify(call.args))
    const action = findAction(mapped.action)
    assert.ok(action, mapped.action)
    assert.deepEqual(validateArgs(action.params, mapped.args).errors, [], call.tool + ' -> ' + mapped.action)
    if (call.args2) assert.deepEqual(mapped.args, call.args2)
  }
})

test('every parameter of every old tool is reachable on some new action', () => {
  const reachable = new Map<string, Set<string>>()
  for (const call of OLD_CALLS) {
    const mapped = mapLegacyCall(call.tool, call.args)
    const set = reachable.get(call.tool) ?? new Set<string>()
    // A parameter is reachable when the call that used it still carries it (renamed or not).
    for (const key of Object.keys(call.args)) {
      const renamed = key === 'replay' ? 'id' : key === 'queryId' ? 'id' : key
      if (key in mapped.args || renamed in mapped.args) set.add(key)
      // `action`, `export` and the other selectors are now the action name itself.
      else if (['action', 'export'].includes(key)) set.add(key)
    }
    reachable.set(call.tool, set)
  }
  for (const [tool, params] of Object.entries(OLD_PARAMS)) {
    for (const param of params) assert.ok(reachable.get(tool)?.has(param), `${tool}.${param} has no route`)
  }
})

test('old tool names and the new actions: lookups are consistent', () => {
  assert.equal(mapLegacyCall('web_search_pro', { query: 'x' }).action, 'search.run')
  assert.throws(() => mapLegacyCall('web_nope'), /not an old tool name/)
  assert.ok(ACTIONS.every(action => findAction(action.name) === action))
  assert.equal(findAction('web_search_pro'), undefined)
})

test('mapError: classes and messages become codes', () => {
  assert.equal(mapError(new ActionArgError('bad')).code, 'INVALID_ARGS')
  assert.equal(mapError(new ActionNotFoundError('gone')).code, 'NOT_FOUND')
  assert.equal(mapError(new Error('profile must be one of a, b')).code, 'INVALID_ARGS')
  assert.equal(mapError(new Error('evidence id not found: e_x')).code, 'NOT_FOUND')
  assert.equal(mapError(new Error('boom')).code, 'ACTION_FAILED')
  const controller = new AbortController()
  controller.abort()
  assert.equal(mapError(new Error('x'), { signal: controller.signal }).code, 'CANCELLED')
})
