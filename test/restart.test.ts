import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { isRestartField, pendingRestart, pendingRestartLine, restartValues, RESTART_FIELD_LIST, RESTART_FIELDS } from '../src/restart.ts'
import { Config, resolveConfig } from '../src/config.ts'
import { OverlayStore, checksumOf } from '../src/overlay.ts'
import { renderResult } from './call-helper.ts'
import { bootPlugin } from './plugin-harness.ts'
import { engineSpec } from './overlay-helpers.ts'

test('the restart fields are exactly the ones the plugin reads once, when it starts', () => {
  assert.deepEqual([...RESTART_FIELD_LIST].sort(), ['dbPath', 'memoryCacheEntries', 'playwright.snapshotDir', 'providerId', 'registerProvider', 'timeoutMs', 'toolSurface', 'verbose'])
  for (const field of RESTART_FIELD_LIST) assert.ok(isRestartField(field) && RESTART_FIELDS[field].length > 20, field + ' says why')
  assert.equal(isRestartField('engines'), false)
  // Every one of them is a real config field (the nested one under playwright).
  const dict = (Config as unknown as { dict: Record<string, { dict?: Record<string, unknown> }> }).dict
  for (const field of RESTART_FIELD_LIST) {
    const [top, child] = field.split('.') as [string, string | undefined]
    assert.ok(dict[top], field + ' exists in the schema')
    if (child) assert.ok(dict[top]!.dict?.[child], field + ' exists in the schema')
  }
})

test('a static read of the configuration anywhere in the plugin is a restart field: this guards the list when new code reads the start-up copy', () => {
  const root = path.resolve(import.meta.dirname, '..', 'src')
  const read = (file: string): string => fs.readFileSync(path.join(root, file), 'utf8')
  const found = new Map<string, Set<string>>()
  const note = (file: string, field: string): void => { found.set(file, (found.get(file) ?? new Set()).add(field)) }
  // index.ts reads the resolved start-up copy as `resolved.<field>`; tools.ts as `config.<field>`; actions as `ctx.config.<field>` / `config => config.<field>`; the router's constructor as `config.<field>`.
  for (const [file, re] of [['index.ts', /\bresolved\.(\w+)/g], ['tools.ts', /(?<![/'"\w])config\.(\w+)/g], ['router.ts', /\bconfig\.(memoryCacheEntries)\b/g]] as const) {
    for (const match of read(file).matchAll(re)) note(file, match[1]!)
  }
  for (const file of fs.readdirSync(path.join(root, 'actions')).filter(name => name.endsWith('.ts'))) {
    for (const match of read('actions/' + file).matchAll(/(?:\bctx\.config|(?<![/'"\w])config)\.(\w+)/g)) note('actions/' + file, match[1]!)
  }
  const allowed = new Set<string>([...RESTART_FIELD_LIST, 'playwright', 'engines' /* the load marker and the log line print it */, 'toolSurface'])
  const diagnostic = new Set(['engines'])
  for (const [file, fields] of found) {
    for (const field of fields) {
      if (diagnostic.has(field)) continue
      assert.ok(allowed.has(field), `${file} reads the start-up copy of "${field}": it is read once, so add it to RESTART_FIELDS (or read it through dynamic())`)
    }
  }
  // And the other way: what the plugin reads at start-up is in the list.
  const startup = new Set([...found.values()].flatMap(fields => [...fields]))
  for (const field of ['dbPath', 'toolSurface', 'registerProvider', 'providerId', 'verbose', 'memoryCacheEntries', 'timeoutMs']) assert.ok(startup.has(field), field + ' is read at start-up')
})

test('pendingRestart compares what the plugin started with and what the configuration holds now', () => {
  const mounted = restartValues(resolveConfig({ dbPath: '/data/a/store.db' } as never))
  assert.deepEqual(pendingRestart(mounted, mounted), [])
  const moved = restartValues(resolveConfig({ dbPath: '/data/a/store.db', toolSurface: 'flat', registerProvider: true, timeoutMs: 45_000, playwright: { snapshotDir: '/shots' } } as never))
  assert.deepEqual(pendingRestart(mounted, moved).map(entry => [entry.field, entry.running, entry.configured]), [
    ['toolSurface', 'indexed', 'flat'], ['playwright.snapshotDir', '/data/a/snapshots', '/shots'], ['registerProvider', 'false', 'true'], ['timeoutMs', '30000', '45000'],
  ])
  assert.equal(pendingRestartLine({ field: 'toolSurface', running: 'indexed', configured: 'flat' }), '待重启：toolSurface（当前生效 indexed，配置为 flat）')
})

test('sources.status says 待重启 for a restart field edited after start, and nothing for live fields', async () => {
  const h = bootPlugin()
  try {
    const clean = await h.run('sources.status')
    assert.equal(clean.pendingRestart, undefined)
    h.config.engines = ['bing']
    h.config.searchMaxResults = 3
    assert.equal((await h.run('sources.status')).pendingRestart, undefined, 'live fields are picked up with no restart')
    h.config.toolSurface = 'flat'
    h.config.memoryCacheEntries = 99
    const status = await h.run('sources.status')
    assert.deepEqual(status.pendingRestart, [
      { field: 'toolSurface', running: 'indexed', configured: 'flat' },
      { field: 'memoryCacheEntries', running: '16', configured: '99' },
    ])
    const text = renderResult('sources.status', status)
    assert.match(text, /待重启：toolSurface（当前生效 indexed，配置为 flat）/)
    assert.match(text, /待重启：memoryCacheEntries（当前生效 16，配置为 99）/)
    h.config.toolSurface = 'indexed'
    h.config.memoryCacheEntries = 16
    assert.equal((await h.run('sources.status')).pendingRestart, undefined, 'back to the running value: nothing pending')
  } finally { h.cleanup() }
})

test('the overlay file beside dbPath is merged into what every consumer reads, and a broken one is reported by sources.status', async () => {
  const seed = (dir: string): void => {
    const store = new OverlayStore({ file: path.join(dir, 'overlay.json'), baseline: () => resolveConfig({ engines: ['ddg'] } as never), known: id => ['ddg', 'bing', 'exa'].includes(id) })
    store.apply({ kind: 'order', priority: ['exa'], disabled: ['bing'] }, { actor: 'agent', action: 'config.set_order', reason: 'seed the file' })
    store.apply({ kind: 'confidence', id: 'exa', value: 0.8 }, { actor: 'agent', action: 'config.set_confidence', reason: 'seed the file' })
  }
  const h = bootPlugin({}, seed)
  try {
    const status = await h.run('sources.status')
    assert.deepEqual(status.sources.priority, ['exa'])
    assert.deepEqual(status.sources.disabled, ['bing'])
    assert.deepEqual(status.sources.confidence, { exa: 0.8 })
    assert.deepEqual(status.overlay, { revision: 2, keys: ['sources.priority', 'sources.disabled', 'sources.confidence.exa'], valid: true })
    assert.match(renderResult('sources.status', status), /agent overlay: revision 2, 3 key\(s\)/)
    // A profile edit changes the baseline in place; the overlay stays on top of the new baseline.
    h.config.sources = { priority: ['bing'] }
    assert.deepEqual((await h.run('sources.status')).sources.priority, ['exa'])
    // Tamper with the file: the baseline applies as a whole and the problem is reported.
    const raw = JSON.parse(fs.readFileSync(h.overlayFile, 'utf8'))
    raw.values.sources.priority = ['exa', 'bing']
    fs.writeFileSync(h.overlayFile, JSON.stringify(raw))
    const broken = await h.run('sources.status')
    assert.deepEqual(broken.sources.priority, ['bing'], 'the profile\'s own value applies')
    assert.deepEqual(broken.sources.disabled, [])
    assert.equal(broken.overlay.valid, false)
    assert.match(broken.overlay.problem, /checksum does not match/)
    assert.match(renderResult('sources.status', broken), /IGNORED: .*checksum/)
  } finally { h.cleanup() }
})

test('the overlay never reaches a restart field or a key: it merges only the five overridable settings', () => {
  const base = resolveConfig({ dbPath: '/x/store.db', toolSurface: 'flat', exaApiKey: 'literal-key' } as never)
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'wsp-ovl-'))
  try {
    const file = path.join(dir, 'overlay.json')
    const values = { engines: ['bing'], cliAdapters: { mine: engineSpec() } }
    const body = { version: 1 as const, revision: 1, updatedAt: new Date().toISOString(), values, audit: [] }
    fs.writeFileSync(file, JSON.stringify({ ...body, checksum: checksumOf(body) }))
    const store = new OverlayStore({ file, baseline: () => base, known: () => true })
    const merged = store.effective()
    assert.equal(merged.dbPath, '/x/store.db')
    assert.equal(merged.toolSurface, 'flat')
    assert.equal(merged.exaApiKey, 'literal-key')
    assert.deepEqual(merged.engines, ['bing'])
    assert.deepEqual(Object.keys(merged.cliAdapters!), ['mine'])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
