import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { resolveConfig } from '../src/config.ts'
import { Store } from '../src/store.ts'
import { ACTIONS, CALL_TOOL, INDEX_TOOL, findAction, findActionByFlatTool, flatToolName } from '../src/actions/registry.ts'
import { COMPACT_GUIDE, renderIndex, type IndexEnvironment } from '../src/actions/index-view.ts'
import { legacyLine } from '../src/actions/legacy.ts'
import { checkOutput } from '../src/actions/schema.ts'
import { renderEnvelope } from '../src/actions/run.ts'
import { callAction, callEnvelope } from './call-helper.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: 'data:text/javascript,export const defineTool = value => value', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
const { registerTools } = await import('../src/tools.ts')

function harness(opts: { toolSurface?: 'indexed' | 'flat'; router?: any; fetch?: any; browser?: any; skill?: boolean; config?: Record<string, unknown> } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-surface-'))
  const config = resolveConfig({ dbPath: path.join(dir, 'store.db'), engines: ['ddg'], enableCliBackends: false, timeoutMs: 5_000, playwright: { enabled: true, snapshotDir: path.join(dir, 'shots') }, ...opts.config } as never)
  const store = new Store(config.dbPath)
  const definitions = new Map<string, any>()
  registerTools({
    ctx: { tools: { register: (d: any) => definitions.set(d.name, d) } } as any, config, dynamic: () => config, store,
    router: opts.router ?? {} as any, fetch: opts.fetch ?? {} as any, ...opts.browser !== undefined ? { browser: opts.browser } : {},
    ...opts.toolSurface ? { toolSurface: opts.toolSurface } : {}, ...opts.skill !== undefined ? { skillAvailable: () => opts.skill! } : {},
  })
  return { dir, config, store, definitions, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

const index = (h: ReturnType<typeof harness>, args: Record<string, unknown> = {}): Promise<{ level: string; text: string }> => h.definitions.get(INDEX_TOOL).execute(args, {})

// ── web_index ────────────────────────────────────────────────────────────────

test('web_index root: groups with their actions, the two everyday calls, the old-name map, and the compact guide without a skill', async () => {
  const h = harness()
  try {
    const { level, text } = await index(h)
    assert.equal(level, 'root')
    for (const group of ['search', 'read', 'history', 'sources', 'rules', 'cache']) assert.match(text, new RegExp(`\\n  ${group} \\(\\d+\\)`))
    assert.match(text, /web_call\(\{action:"search\.run",args:\{query:"\.\.\.",task:"one-sentence goal",profile:"docs_code"\}\}\)/)
    assert.match(text, /web_call\(\{action:"read\.fetch",args:\{url:"https:\/\/\.\.\.",offset:20000\}\}\)/)
    assert.ok(text.includes(legacyLine()), 'old names -> new actions')
    for (const old of ['web_search_pro -> search.run', 'web_platform_search -> search.run {platform}', 'web_fetch_pro -> read.fetch', 'web_backend_status -> sources.status | search.recommend']) assert.ok(text.includes(old), old)
    assert.ok(text.includes(COMPACT_GUIDE), 'the compact guide stands in for the skill')
    assert.doesNotMatch(text, /Load skill/)
    assert.match(text, /Unavailable \(needs the dsh-browser plugin[^)]*\): read\.snapshot/)
    assert.ok(COMPACT_GUIDE.length <= 1200, 'compact guide is about 300 tokens: ' + COMPACT_GUIDE.length)
    assert.ok(text.length <= 3200, 'root stays small: ' + text.length)
  } finally { h.cleanup() }
})

test('web_index root with the skill registered points at it instead of the guide; with a ready browser read.snapshot is listed', async () => {
  const browser = { render() {}, snapshot() {}, searchResults() {}, opencli() {}, close() {} }
  const h = harness({ skill: true, browser })
  try {
    const { text } = await index(h)
    assert.match(text, /Load skill "dsh-web-search-pro"/)
    assert.ok(!text.includes(COMPACT_GUIDE))
    assert.doesNotMatch(text, /Unavailable/)
    assert.match(text, /\n  read \(3\)/)
  } finally { h.cleanup() }
})

test('web_index group, action, and query levels', async () => {
  const h = harness()
  try {
    const group = await index(h, { group: 'history' })
    assert.equal(group.level, 'group')
    for (const name of ['history.list', 'history.replay', 'history.expand', 'history.export', 'history.delete']) assert.ok(group.text.includes(name + ' - '), name)
    assert.match(group.text, /history\.delete - .*\| id: string \| asks/)
    assert.match((await index(h, { group: 'nope' })).text, /Unknown group "nope"\. Groups: search, read, history, sources, rules, cache\./)

    const action = await index(h, { action: 'search.run' })
    assert.equal(action.level, 'action')
    assert.match(action.text, /^search\.run - /)
    assert.match(action.text, /args:\n  query\?: string - /)
    assert.match(action.text, /task\?: string - Evidence mode/)
    assert.match(action.text, /example: web_call\(\{"action":"search\.run","args":\{"query":"node:sqlite busy timeout"/)
    assert.match(action.text, /errors: INVALID_ARGS, DEADLINE, CANCELLED/)
    const clear = (await index(h, { action: 'cache.clear' })).text
    assert.match(clear, /approval: asks/)
    assert.match(clear, /changes stored data/)
    assert.match(clear, /a DEADLINE on this action means the outcome is unknown/)
    assert.match((await index(h, { action: 'read.snapshot' })).text, /UNAVAILABLE: needs the dsh-browser plugin/)
    assert.match((await index(h, { action: 'search.runn' })).text, /Unknown action "search\.runn"\. Similar: search\.(run|recommend)/)

    const search = await index(h, { query: 'evidence expand' })
    assert.equal(search.level, 'search')
    assert.match(search.text, /history\.expand/)
    assert.match((await index(h, { query: 'delete' })).text, /history\.delete/)
    assert.match((await index(h, { query: 'zzzz-nothing' })).text, /No usable action matches/)
    assert.ok(search.text.split('\n').length <= 9, 'at most 8 hits plus the header')
  } finally { h.cleanup() }
})

test('web_index answers an old tool name with the new action', async () => {
  const h = harness()
  try {
    assert.match((await index(h, { action: 'web_search_pro' })).text, /old tool name \(gone\)\. It is now search\.run/)
    assert.match((await index(h, { query: 'web_history' })).text, /old tool name.*history\.list\|replay\|expand\|export/)
  } finally { h.cleanup() }
})

test('renderIndex is pure over its environment', () => {
  const env: IndexEnvironment = { skillAvailable: false, browserReady: true }
  assert.equal(renderIndex({}, env).level, 'root')
  assert.equal(renderIndex({ action: 'search.run', group: 'read' }, env).level, 'action')
  assert.equal(renderIndex({ group: 'read', query: 'x' }, env).level, 'group')
})

// ── web_call ─────────────────────────────────────────────────────────────────

test('web_call returns the envelope {ok, action, result}; the model reads the action\'s own rendering', async () => {
  const h = harness()
  try {
    h.store.upsertRule('example.com', 'main')
    const envelope = await callEnvelope(h.definitions, 'rules.list')
    assert.deepEqual(envelope, { ok: true, action: 'rules.list', result: { rules: [{ hostname: 'example.com', content: 'main' }] } })
    const tool = h.definitions.get(CALL_TOOL)
    assert.equal(tool.output.render({ action: 'rules.list' }, envelope)[0].text, 'Rules:\n- example.com → content: main')
    assert.deepEqual(Object.keys(tool.output.schema.properties).sort(), ['action', 'error', 'ok', 'result', 'truncation'])
    assert.equal(tool.output.schema.additionalProperties, false)
    assert.equal(tool.output.schema.properties.error.additionalProperties, false)
  } finally { h.cleanup() }
})

test('web_call: INVALID_ARGS carries the compact schema; an error is rendered as the compact envelope', async () => {
  const h = harness()
  try {
    const missing = await callEnvelope(h.definitions, 'read.fetch', {})
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'INVALID_ARGS')
    assert.match(missing.error.message, /url: required/)
    assert.match(missing.error.schema, /^read\.fetch\(url: string, mode\?: /)
    assert.match(missing.error.hint, /Fix the arguments/)
    const unknownArg = await callEnvelope(h.definitions, 'cache.clear', { nope: 1 })
    assert.match(unknownArg.error.message, /nope: unknown argument \(allowed: olderThanDays, engine\)/)
    const notObject = await callEnvelope(h.definitions, 'rules.list', 'oops' as never)
    assert.equal(notObject.error.code, 'INVALID_ARGS')
    // A message from deeper in the stack that is about the call also gets the schema.
    const deeper = await callEnvelope(h.definitions, 'search.recommend', { profile: 'weird' })
    assert.equal(deeper.error.code, 'INVALID_ARGS')
    assert.match(deeper.error.schema, /^search\.recommend\(/)
    const text = renderEnvelope(missing)
    assert.deepEqual(JSON.parse(text), { ok: false, action: 'read.fetch', error: missing.error })
    // The tool's render does the same.
    assert.equal(h.definitions.get(CALL_TOOL).output.render({}, missing)[0].text, text)
  } finally { h.cleanup() }
})

test('web_call: an unknown action suggests close names; an old tool name is answered with the new action and translated arguments', async () => {
  const h = harness()
  try {
    const typo = await callEnvelope(h.definitions, 'search.find', {})
    assert.equal(typo.error.code, 'UNKNOWN_ACTION')
    assert.match(typo.error.hint, /Call web_index\(\) to list groups; similar: search\.(run|recommend), search\.(run|recommend)/)
    assert.equal((await callEnvelope(h.definitions, undefined as never, {})).error.code, 'UNKNOWN_ACTION')
    const bare = await callEnvelope(h.definitions, 'fetch', {})
    assert.match(bare.error.hint, /similar: read\.fetch/)

    const old = h.definitions.get(CALL_TOOL).execute({ action: 'web_search_pro', args: { query: 'q', task: 't', fresh: true } }, {})
    const reply = await old
    assert.equal(reply.ok, false)
    assert.equal(reply.error.code, 'UNKNOWN_ACTION')
    assert.match(reply.error.message, /web_search_pro is an old tool name; it no longer exists\./)
    assert.match(reply.error.hint, /web_call\(\{action:"search\.run", args:\{"query":"q","task":"t","fresh":true\}\}\)/)
    const hist = await h.definitions.get(CALL_TOOL).execute({ action: 'web_history', args: { replay: 'q_1' } }, {})
    assert.match(hist.error.hint, /action:"history\.replay", args:\{"id":"q_1"\}/)
    const deps = await h.definitions.get(CALL_TOOL).execute({ action: 'web_deps', args: { action: 'install', backend: 'twitter' } }, {})
    assert.match(deps.error.hint, /action:"sources\.install", args:\{"backend":"twitter"\}/)
  } finally { h.cleanup() }
})

test('web_call forwards cancellation: a signal aborted mid-call reaches the executor and the call ends CANCELLED; a pre-aborted one never starts', async () => {
  let seen: AbortSignal | undefined
  const h = harness({ fetch: { fetchPage: (_url: string, opts: { signal: AbortSignal }) => new Promise((_resolve, reject) => { seen = opts.signal; opts.signal.addEventListener('abort', () => reject(new Error('aborted by caller'))) }) } })
  try {
    const controller = new AbortController()
    const pending = callEnvelope(h.definitions, 'read.fetch', { url: 'https://a.test' }, { signal: controller.signal })
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.ok(seen && !seen.aborted)
    controller.abort()
    const envelope = await pending
    assert.equal(seen!.aborted, true, 'the executor\'s signal follows the caller\'s')
    assert.equal(envelope.ok, false)
    assert.equal(envelope.error.code, 'CANCELLED')

    const done = new AbortController()
    done.abort()
    const never = await callEnvelope(h.definitions, 'read.fetch', { url: 'https://b.test' }, { signal: done.signal })
    assert.equal(never.error.code, 'CANCELLED')
    assert.match(never.error.message, /before start/)
  } finally { h.cleanup() }
})

test('web_call deadline: an action that outlives its ceiling ends DEADLINE and its signal is aborted', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  let seen: AbortSignal | undefined
  const h = harness({ fetch: { fetchPage: (_url: string, opts: { signal: AbortSignal }) => { seen = opts.signal; return new Promise(() => {}) } } })
  try {
    const pending = callEnvelope(h.definitions, 'read.fetch', { url: 'https://slow.test' })
    await Promise.resolve()
    mock.timers.tick(5_000 + 30_000 + 1)
    const envelope = await pending
    assert.equal(envelope.error.code, 'DEADLINE')
    assert.match(envelope.error.message, /read\.fetch did not finish within 35000 ms/)
    assert.equal(seen?.aborted, true)
  } finally { mock.timers.reset(); h.cleanup() }
})

test('web_call tool flags: host ceiling is the longest action deadline, concurrency follows the action named in the arguments', () => {
  const h = harness()
  try {
    const tool = h.definitions.get(CALL_TOOL)
    assert.equal(tool.timeoutMs, 5_000 + 180_000 + 5_000, 'sources.deps/install: timeoutMs + 180 s, plus 5 s')
    assert.equal(tool.isConcurrencySafe({ action: 'search.run', args: {} }), true)
    assert.equal(tool.isConcurrencySafe({ action: 'read.fetch', args: {} }), true)
    assert.equal(tool.isConcurrencySafe({ action: 'rules.list' }), true)
    assert.equal(tool.isConcurrencySafe({ action: 'rules.upsert' }), false)
    assert.equal(tool.isConcurrencySafe({ action: 'cache.clear' }), false)
    assert.equal(tool.isConcurrencySafe({ action: 'sources.install' }), false)
    assert.equal(tool.isConcurrencySafe({ action: 'nope' }), false)
    assert.equal(tool.isConcurrencySafe({}), false)
    assert.equal(h.definitions.get(INDEX_TOOL).isConcurrencySafe(), true)
    assert.deepEqual(tool.presentCall({ action: 'search.run', args: { query: 'node' } }), { card: 'generic', kind: 'search', title: 'node', rawInput: 'node' })
    assert.equal(tool.presentCall({ action: 'read.fetch', args: { url: 'https://a.test' } }), undefined)
  } finally { h.cleanup() }
})

// ── flat surface ─────────────────────────────────────────────────────────────

test('toolSurface=flat registers the same actions as native tools, with the same envelope', async () => {
  const flat = harness({ toolSurface: 'flat' })
  const indexed = harness()
  try {
    assert.deepEqual([...flat.definitions.keys()].sort(), ACTIONS.map(flatToolName).sort())
    assert.ok(!flat.definitions.has(CALL_TOOL) && !flat.definitions.has(INDEX_TOOL))
    assert.deepEqual([...indexed.definitions.keys()].sort(), [CALL_TOOL, INDEX_TOOL])
    for (const action of ACTIONS) {
      const tool = flat.definitions.get(flatToolName(action))
      assert.equal(findActionByFlatTool(tool.name), action)
      assert.deepEqual(tool.parameters, action.params)
      assert.ok(tool.description.startsWith(action.summary))
      assert.equal(tool.isConcurrencySafe({}), action.concurrencySafe)
      assert.equal(tool.timeoutMs, action.timeoutMs(flat.config) + 5_000)
    }
    flat.store.upsertRule('example.com', 'main')
    indexed.store.upsertRule('example.com', 'main')
    const viaFlat = await flat.definitions.get('web_rules_list').execute({}, {})
    const viaIndexed = await callEnvelope(indexed.definitions, 'rules.list')
    assert.deepEqual(viaFlat, viaIndexed)
    const bad = await flat.definitions.get('web_read_fetch').execute({}, {})
    assert.equal(bad.error.code, 'INVALID_ARGS')
    assert.match(flat.definitions.get('web_rules_list').output.render({}, viaFlat)[0].text, /example\.com/)
  } finally { flat.cleanup(); indexed.cleanup() }
})

test('toolSurface comes from the config when the dependency does not override it', () => {
  const h = harness({ config: { toolSurface: 'flat' } })
  try { assert.equal(h.definitions.size, ACTIONS.length) } finally { h.cleanup() }
  assert.throws(() => resolveConfig({ toolSurface: 'weird' } as never), /toolSurface must be one of: indexed, flat/)
  assert.equal(resolveConfig({} as never).toolSurface, 'indexed')
})

// ── results fit their closed output schemas ──────────────────────────────────

test('local actions return results that fit their closed output schemas (store lifecycle)', async () => {
  const h = harness()
  try {
    const fit = (action: string, result: unknown): void => assert.deepEqual(checkOutput(findAction(action)!.output, result), [], action)
    const up = await callAction(h.definitions, 'rules.upsert', { hostname: 'Example.com', contentSelectors: 'article', removeSelectors: '.ad' })
    assert.equal(up.message, 'Rule upserted for example.com')
    fit('rules.upsert', up)
    const list = await callAction(h.definitions, 'rules.list')
    assert.deepEqual(list.rules, [{ hostname: 'example.com', content: 'article', remove: '.ad' }])
    fit('rules.list', list)
    const exported = await callAction(h.definitions, 'rules.export')
    fit('rules.export', exported)
    const imported = await callAction(h.definitions, 'rules.import', { rulesJson: fs.readFileSync(exported.exportPath, 'utf8') })
    assert.equal(imported.message, 'Imported 1 rules')
    fit('rules.import', imported)
    await assert.rejects(callAction(h.definitions, 'rules.import', { rulesJson: '{bad' }), /rulesJson is not valid JSON/)
    await assert.rejects(callAction(h.definitions, 'rules.import', { rulesJson: '{}' }), /JSON array or exported rule pack/)
    const removed = await callAction(h.definitions, 'rules.remove', { hostname: 'example.com' })
    assert.equal(removed.message, 'Rule removed for example.com')
    fit('rules.remove', removed)
    assert.equal((await callAction(h.definitions, 'rules.remove', { hostname: 'example.com' })).message, 'No rule found for example.com')

    const queryId = h.store.recordQuery({ kind: 'search', query: 'sqlite', engine: 'ddg', status: 'ok' })
    const records = await callAction(h.definitions, 'history.list', { kind: 'search', query: 'sqlite' })
    assert.equal(records.records[0].id, queryId)
    fit('history.list', records)
    const replayed = await callAction(h.definitions, 'history.replay', { id: queryId })
    assert.deepEqual(replayed.replayedSources, [])
    fit('history.replay', replayed)
    const history = await callAction(h.definitions, 'history.export', { kind: 'search' })
    assert.equal(history.count, 1)
    assert.equal(JSON.parse(fs.readFileSync(history.exportPath, 'utf8'))[0].id, queryId)
    fit('history.export', history)
    await assert.rejects(callAction(h.definitions, 'history.replay', { id: 'q_missing' }), /history query id not found/)
    assert.equal((await callEnvelope(h.definitions, 'history.replay', { id: 'q_missing' })).error.code, 'NOT_FOUND')
    await assert.rejects(callAction(h.definitions, 'history.list', { kind: 'bogus' }), /kind: must be one of search \| fetch \| platform \| snapshot \| all/)

    const stats = await callAction(h.definitions, 'cache.stats')
    assert.equal(stats.queries, 1)
    fit('cache.stats', stats)
    const deleted = await callAction(h.definitions, 'history.delete', { id: queryId })
    assert.equal(deleted.removedQueries, 1)
    fit('history.delete', deleted)
    assert.equal((await callEnvelope(h.definitions, 'history.delete', { id: queryId })).error.code, 'NOT_FOUND')
    const cleared = await callAction(h.definitions, 'cache.clear', { olderThanDays: 1 })
    fit('cache.clear', cleared)
  } finally { h.cleanup() }
})

// ── search.run modes ─────────────────────────────────────────────────────────

test('search.run: platform delegates to the platform path (fresh forwarded, count default 8) and refuses evidence arguments', async () => {
  const seen: any[] = []
  const h = harness({ router: { platformSearch: async (...args: any[]) => { seen.push(args); return { sources: [{ url: 'https://x.test/1', title: 'X' }], engine: 'github', fromCache: false } } } })
  try {
    const out = await callAction(h.definitions, 'search.run', { platform: 'github', query: 'dsh', fresh: true, authProfile: 'p' })
    assert.deepEqual(out, { platform: 'github', sources: [{ url: 'https://x.test/1', title: 'X' }], engine: 'github', fromCache: false })
    assert.deepEqual(checkOutput(findAction('search.run')!.output, out), [])
    assert.deepEqual(seen[0].slice(0, 4), ['github', 'dsh', undefined, 8])
    assert.equal(seen[0][4].fresh, true)
    assert.equal(seen[0][4].authProfile, 'p')
    const text = h.definitions.get(CALL_TOOL).output.render({}, { ok: true, action: 'search.run', result: out })[0].text
    assert.match(text, /^Platform: github \(via github\)\n\n- \[X\]\(https:\/\/x\.test\/1\)/)
    await assert.rejects(callAction(h.definitions, 'search.run', { platform: 'github', query: 'q', task: 't' }), /platform cannot be combined with task/)
    await assert.rejects(callAction(h.definitions, 'search.run', { platform: 'not-a-platform', query: 'q' }), /unsupported platform: not-a-platform/)
    await assert.rejects(callAction(h.definitions, 'search.run', { query: 'q', url: 'https://f.test' }), /url only applies together with platform/)
    await assert.rejects(callAction(h.definitions, 'search.run', {}), /query is required/)
    assert.equal(seen.length, 1)
  } finally { h.cleanup() }
})
