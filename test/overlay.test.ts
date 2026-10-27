import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { resolveConfig } from '../src/config.ts'
import { ActionArgError, ActionConflictError, ActionNotFoundError, ActionUnavailableError } from '../src/actions/types.ts'
import { checksumOf, mergeOverlay, overlayFileFor, MAX_AUDIT_ENTRIES } from '../src/overlay.ts'
import { engineSpec, overlayHarness } from './overlay-helpers.ts'

const posix = process.platform !== 'win32'

test('the overlay file sits beside dbPath: $DSH_HOME/data/web-search-pro/overlay.json by default, the dbPath folder when it was moved', () => {
  assert.equal(overlayFileFor('/home/u/.dsh/data/web-search-pro/store.db'), '/home/u/.dsh/data/web-search-pro/overlay.json')
  assert.equal(overlayFileFor('/srv/search/cache.sqlite'), '/srv/search/overlay.json')
})

test('a write puts a checksummed overlay file (0600) in place, bumps the revision, and the effective config is baseline + overlay', { skip: !posix }, () => {
  const h = overlayHarness({ engines: ['ddg', 'bing'], sources: { priority: ['exa'] } })
  try {
    assert.equal(h.store.current().revision, 0)
    assert.deepEqual(h.store.effective().engines, ['ddg', 'bing'])
    const applied = h.store.apply({ kind: 'order', engines: ['bing', 'ddg'], disabled: ['jina'] }, h.meta('bing answers faster here'))
    assert.equal(applied.changed, true)
    assert.equal(applied.revision, 1)
    assert.deepEqual(applied.keys, ['engines', 'sources.disabled'])
    const effective = h.store.effective()
    assert.deepEqual(effective.engines, ['bing', 'ddg'])
    assert.deepEqual(effective.sources.disabled, ['jina'])
    assert.deepEqual(effective.sources.priority, ['exa'], 'what the overlay does not hold stays the baseline\'s')
    assert.deepEqual(h.config.current.engines, ['ddg', 'bing'], 'the baseline object is never mutated')
    const raw = JSON.parse(fs.readFileSync(h.file, 'utf8'))
    assert.equal(raw.version, 1)
    assert.equal(raw.revision, 1)
    assert.equal(raw.checksum, checksumOf({ version: 1, revision: raw.revision, updatedAt: raw.updatedAt, values: raw.values, audit: raw.audit }))
    assert.deepEqual(raw.values, { engines: ['bing', 'ddg'], sources: { disabled: ['jina'] } })
    assert.equal(fs.statSync(h.file).mode & 0o777, 0o600)
    assert.deepEqual(fs.readdirSync(h.dir).filter(name => name.includes('.tmp-')), [], 'the temporary file was renamed away')
    const entry = raw.audit[0]
    assert.equal(entry.revision, 1)
    assert.equal(entry.actor, 'agent')
    assert.equal(entry.action, 'config.set_order')
    assert.equal(entry.sessionId, 'session-1')
    assert.equal(entry.reason, 'bing answers faster here')
    assert.deepEqual(entry.changes, [{ key: 'engines', before: 'ddg > bing', after: 'bing > ddg' }, { key: 'sources.disabled', before: '(empty)', after: 'jina' }])
    assert.equal(h.store.problem, undefined)
  } finally { h.cleanup() }
})

test('merge semantics: lists are replaced whole, confidence merges per id, a platform chain and a CLI replace the entry of the same key', () => {
  const h = overlayHarness({ sources: { confidence: { exa: 0.9, xhs: 0.7 } }, platformBackends: { reddit: ['opencli'], zhihu: ['browser-search'] } })
  try {
    h.store.apply({ kind: 'confidence', id: 'exa', value: 0.8 }, h.meta())
    h.store.apply({ kind: 'confidence', id: 'jina', value: 0.4 }, h.meta())
    h.store.apply({ kind: 'order', platform: 'reddit', backends: ['browser-opencli'] }, h.meta())
    h.store.apply({ kind: 'upsertCli', id: 'mine', spec: engineSpec() }, h.meta())
    h.store.apply({ kind: 'order', engines: ['custom-cli:mine', 'ddg'] }, h.meta())
    const effective = h.store.effective()
    assert.deepEqual(effective.sources.confidence, { exa: 0.8, xhs: 0.7, jina: 0.4 })
    assert.deepEqual(effective.platformBackends, { reddit: ['browser-opencli'], zhihu: ['browser-search'] })
    assert.deepEqual(Object.keys(effective.cliAdapters!), ['mine'])
    assert.deepEqual(effective.engines, ['custom-cli:mine', 'ddg'])
    // The pure merge on its own.
    const merged = mergeOverlay(h.config.current, { engines: ['exa'] })
    assert.deepEqual(merged.engines, ['exa'])
    assert.equal(mergeOverlay(h.config.current, {}), h.config.current, 'an empty overlay returns the baseline itself')
  } finally { h.cleanup() }
})

test('a value equal to the baseline is no override: it is dropped, and confidence null drops the overlay entry', () => {
  const h = overlayHarness({ engines: ['ddg', 'bing'] })
  try {
    h.store.apply({ kind: 'order', engines: ['bing', 'ddg'] }, h.meta())
    h.store.apply({ kind: 'order', engines: ['ddg', 'bing'] }, h.meta('back to what the profile says'))
    assert.deepEqual(h.store.current().values, {})
    assert.equal(h.store.current().revision, 2)
    h.store.apply({ kind: 'confidence', id: 'exa', value: 0.5 }, h.meta())
    assert.deepEqual(h.store.effective().sources.confidence, { exa: 0.5 })
    const dropped = h.store.apply({ kind: 'confidence', id: 'exa', value: null }, h.meta('exa is fine again'))
    assert.equal(dropped.changed, true)
    assert.deepEqual(h.store.current().values, {})
    // Nothing to do: nothing is written, the revision stays.
    const before = h.store.current().revision
    const noop = h.store.apply({ kind: 'confidence', id: 'exa', value: null }, h.meta())
    assert.equal(noop.changed, false)
    assert.equal(h.store.current().revision, before)
  } finally { h.cleanup() }
})

test('every write needs a reason of 3-300 characters and an unchanged revision when expectedRevision is given', () => {
  const h = overlayHarness()
  try {
    for (const reason of ['', 'ab', '   x ', 'y'.repeat(301)]) assert.throws(() => h.store.apply({ kind: 'order', engines: ['bing'] }, h.meta(reason)), ActionArgError)
    h.store.apply({ kind: 'order', engines: ['bing'] }, h.meta('ok then', { expectedRevision: 0 }))
    assert.throws(() => h.store.apply({ kind: 'order', engines: ['exa'] }, h.meta('stale view', { expectedRevision: 0 })), (error: Error) => error instanceof ActionConflictError && /revision 1, not 0/.test(error.message))
    assert.deepEqual(h.store.effective().engines, ['bing'], 'a refused write changes nothing')
    h.store.apply({ kind: 'order', engines: ['exa'] }, h.meta('current view', { expectedRevision: 1 }))
    assert.equal(h.store.current().revision, 2)
  } finally { h.cleanup() }
})

test('a second process\'s write is picked up by mtime and size, with no watcher; the first store checks the revision against the file', () => {
  const h = overlayHarness()
  try {
    assert.deepEqual(h.store.effective().engines, h.config.current.engines)
    const other = h.fresh()
    other.apply({ kind: 'order', engines: ['bing'] }, h.meta())
    assert.deepEqual(h.store.effective().engines, ['bing'])
    assert.equal(h.store.current().revision, 1)
    assert.throws(() => h.store.apply({ kind: 'order', engines: ['exa'] }, h.meta('based on revision zero', { expectedRevision: 0 })), ActionConflictError)
  } finally { h.cleanup() }
})

test('the audit trail keeps the newest 50 entries', () => {
  const h = overlayHarness()
  try {
    for (let i = 0; i < MAX_AUDIT_ENTRIES + 7; i++) h.store.apply({ kind: 'confidence', id: 'exa', value: i % 2 ? 0.5 : 0.6 }, h.meta('change number ' + i))
    const audit = h.store.current().audit
    assert.equal(audit.length, MAX_AUDIT_ENTRIES)
    assert.equal(audit.at(-1)!.revision, MAX_AUDIT_ENTRIES + 7)
    assert.equal(audit[0]!.revision, 8)
    assert.equal(h.store.view(3).audit.length, 3)
    assert.equal(h.store.view(3).audit[0]!.revision, MAX_AUDIT_ENTRIES + 7, 'newest first')
    assert.equal(h.fresh().current().audit.length, MAX_AUDIT_ENTRIES, 'and the file reloads')
  } finally { h.cleanup() }
})

test('a file that does not parse, fails its checksum, has unknown keys or holds a value the validators refuse is ignored as a whole and reported', () => {
  const h = overlayHarness({ engines: ['ddg', 'bing'] })
  try {
    h.store.apply({ kind: 'order', engines: ['bing', 'ddg'], disabled: ['jina'] }, h.meta())
    const good = JSON.parse(fs.readFileSync(h.file, 'utf8'))
    const rewrite = (change: (raw: any) => void, fix = true): void => {
      const raw = structuredClone(good)
      change(raw)
      if (fix) raw.checksum = checksumOf(raw)
      fs.writeFileSync(h.file, typeof raw === 'string' ? raw : JSON.stringify(raw))
    }
    const expectIgnored = (pattern: RegExp, label: string): void => {
      const fresh = h.fresh()
      assert.deepEqual(fresh.effective().engines, ['ddg', 'bing'], label + ': the baseline applies, nothing is half applied')
      assert.deepEqual(fresh.effective().sources.disabled, [], label)
      assert.match(fresh.problem ?? '', pattern, label)
      assert.equal(fresh.view().valid, false, label)
    }
    fs.writeFileSync(h.file, '{ not json')
    expectIgnored(/not valid JSON/, 'garbage')
    rewrite(raw => { raw.values.engines = ['bing', 'ddg', 'ddg'] }, false)
    expectIgnored(/checksum does not match/, 'edited by hand')
    rewrite(raw => { raw.extra = 1 })
    expectIgnored(/unknown key "extra"/, 'unknown key')
    rewrite(raw => { raw.version = 2 })
    expectIgnored(/unsupported version/, 'version')
    rewrite(raw => { raw.values.secrets = { apiKey: 'x' } })
    expectIgnored(/unknown key "secrets" in values/, 'unknown value key')
    rewrite(raw => { raw.values.sources.confidence = { exa: 7 } })
    expectIgnored(/not a number 0\.\.1/, 'out of range')
    rewrite(raw => { raw.values.engines = ['not a source'] })
    expectIgnored(/must be an id/, 'malformed engine id')
    rewrite(raw => { raw.values.engines = ['nope'] })
    expectIgnored(/not a registered source/, 'unregistered engine')
    rewrite(raw => { raw.values.cliAdapters = { evil: { bins: ['evil'] } } })
    expectIgnored(/not a valid spec/, 'bad spec')
    rewrite(raw => { raw.audit = [{ nope: true }] })
    expectIgnored(/bad audit entry/, 'bad audit')
    fs.writeFileSync(h.file, JSON.stringify(good))
    assert.equal(h.fresh().problem, undefined, 'the untouched file loads')
    assert.deepEqual(h.fresh().effective().engines, ['bing', 'ddg'])
  } finally { h.cleanup() }
})

test('an ignored overlay refuses writes until it is reset; reset all moves the bad file aside and starts fresh', () => {
  const h = overlayHarness()
  try {
    fs.writeFileSync(h.file, 'garbage')
    const store = h.fresh()
    assert.throws(() => store.apply({ kind: 'order', engines: ['bing'] }, h.meta()), (error: Error) => error instanceof ActionUnavailableError && /config\.reset/.test(error.hint ?? ''))
    assert.throws(() => store.apply({ kind: 'reset', scope: 'order' }, h.meta()), ActionUnavailableError, 'only a reset of everything repairs it')
    const reset = store.apply({ kind: 'reset', scope: 'all' }, h.meta('start over'))
    assert.equal(reset.changed, true)
    assert.equal(fs.readdirSync(h.dir).filter(name => name.startsWith('overlay.json.corrupt-')).length, 1)
    assert.equal(store.problem, undefined)
    store.apply({ kind: 'order', engines: ['bing'] }, h.meta())
    assert.deepEqual(store.effective().engines, ['bing'])
  } finally { h.cleanup() }
})

test('an overlay that no longer agrees with the baseline is ignored as a whole (a chain naming a CLI the profile dropped) and can only be taken back', () => {
  const h = overlayHarness({ cliAdapters: { base: engineSpec() } })
  try {
    h.store.apply({ kind: 'order', engines: ['custom-cli:base', 'ddg'] }, h.meta())
    h.store.apply({ kind: 'order', disabled: ['jina'] }, h.meta())
    assert.deepEqual(h.store.effective().engines, ['custom-cli:base', 'ddg'])
    h.config.current = resolveConfig({ dbPath: h.config.current.dbPath } as never)
    const effective = h.store.effective()
    assert.deepEqual(effective.engines, h.config.current.engines, 'nothing of the overlay applies, not even the part that is still fine')
    assert.deepEqual(effective.sources.disabled, [])
    assert.match(h.store.problem ?? '', /no longer agrees with the configuration[\s\S]*custom-cli:base/)
    assert.throws(() => h.store.apply({ kind: 'order', priority: ['exa'] }, h.meta()), ActionUnavailableError)
    h.store.apply({ kind: 'reset', scope: 'order' }, h.meta('the profile changed under it'))
    assert.equal(h.store.problem, undefined)
  } finally { h.cleanup() }
})

test('a change is validated with the same functions as the file: unknown ids, duplicates, ranges, chains, dangling references', () => {
  const h = overlayHarness()
  try {
    const refused = (change: Parameters<typeof h.store.apply>[0], pattern: RegExp, kind: Function = ActionArgError): void => {
      assert.throws(() => h.store.apply(change, h.meta()), (error: Error) => error instanceof kind && pattern.test(error.message), JSON.stringify(change))
      assert.equal(h.store.current().revision, 0, 'a refused change writes nothing')
      assert.equal(fs.existsSync(h.file), false)
    }
    refused({ kind: 'order' }, /at least one of/)
    refused({ kind: 'order', platform: 'reddit' }, /go together/)
    refused({ kind: 'order', backends: ['rest'] }, /go together/)
    refused({ kind: 'order', engines: [] }, /at least 1 id/)
    refused({ kind: 'order', engines: 'ddg' }, /list of source ids/)
    refused({ kind: 'order', engines: ['ddg', 'ddg'] }, /twice/)
    refused({ kind: 'order', engines: ['ddg', 'a b'] }, /must be an id/)
    refused({ kind: 'order', engines: ['__proto__'] }, /must be an id/)
    refused({ kind: 'order', engines: ['nope'] }, /not a registered source/)
    refused({ kind: 'order', engines: ['custom-cli:ghost'] }, /not defined/)
    refused({ kind: 'order', priority: ['nope'] }, /not a registered source/)
    refused({ kind: 'order', platform: 'atlantis', backends: ['rest'] }, /no such platform/)
    refused({ kind: 'order', platform: 'reddit', backends: ['custom-cli:ghost'] }, /custom-cli:ghost/)
    refused({ kind: 'order', platform: 'reddit', backends: ['browser-search'] }, /does not serve platform reddit/)
    refused({ kind: 'confidence', id: 'exa', value: 1.5 }, /0\.\.1/)
    refused({ kind: 'confidence', id: 'exa', value: '0.5' }, /0\.\.1/)
    refused({ kind: 'confidence', id: 'atlantis', value: 0.5 }, /not a registered source or platform backend/)
    refused({ kind: 'upsertCli', id: 'Bad Id', spec: engineSpec() }, /must be an id/)
    refused({ kind: 'upsertCli', id: 'mine', spec: 'x' }, /spec object/)
    refused({ kind: 'upsertCli', id: 'mine', spec: { ...engineSpec(), id: 'other' } }, /spec\.id must equal/)
    refused({ kind: 'upsertCli', id: 'mine', spec: engineSpec({ allowedSubcommands: ['login'], search: { argv: ['login', '{query}'], output: { format: 'text', lines: { mode: 'whole' } } } }) }, /write \/ login|read-only guard/)
    refused({ kind: 'upsertCli', id: 'mine', spec: engineSpec({ env: { set: { MY_TOKEN: 'x' } } }) }, /credentials/)
    refused({ kind: 'upsertCli', id: 'mine', spec: engineSpec({ platforms: ['atlantis'], engine: false }) }, /no backend chain exists/)
    refused({ kind: 'removeCli', id: 'mine' }, /holds no custom CLI/, ActionNotFoundError)
    refused({ kind: 'reset', scope: 'confidence', id: 'exa' }, /no confidence entry/, ActionNotFoundError)
  } finally { h.cleanup() }
})

test('remove_cli takes out only what the overlay added, and not while an overlay list still names it; a baseline CLI is pointed to sources.disabled', () => {
  const h = overlayHarness({ cliAdapters: { base: engineSpec() } })
  try {
    h.store.apply({ kind: 'upsertCli', id: 'mine', spec: engineSpec() }, h.meta())
    h.store.apply({ kind: 'order', engines: ['custom-cli:mine', 'ddg'] }, h.meta())
    assert.throws(() => h.store.apply({ kind: 'removeCli', id: 'mine' }, h.meta()), (error: Error) => error instanceof ActionArgError && /custom-cli:mine/.test(error.message), 'engines still names it')
    h.store.apply({ kind: 'order', engines: ['ddg'] }, h.meta())
    h.store.apply({ kind: 'removeCli', id: 'mine' }, h.meta('no longer needed'))
    assert.equal(h.store.effective().cliAdapters?.mine, undefined)
    assert.ok(h.store.effective().cliAdapters?.base, 'the baseline CLI is untouched')
    assert.throws(() => h.store.apply({ kind: 'removeCli', id: 'base' }, h.meta()), (error: Error) => error instanceof ActionNotFoundError && /sources\.disabled/.test(error.hint ?? ''))
    // Replacing a baseline CLI by id is allowed: the overlay holds the whole spec.
    h.store.apply({ kind: 'upsertCli', id: 'base', spec: engineSpec({ timeoutMs: 9_000 }) }, h.meta('slower machine'))
    assert.equal((h.store.effective().cliAdapters!.base as { timeoutMs: number }).timeoutMs, 9_000)
    assert.equal((h.config.current.cliAdapters!.base as { timeoutMs: number }).timeoutMs, 5_000)
  } finally { h.cleanup() }
})

test('reset scopes: order, confidence (all or one id), cli, platform, all', () => {
  const h = overlayHarness()
  try {
    const fill = (): void => {
      h.store.apply({ kind: 'order', engines: ['bing'], priority: ['exa'], disabled: ['jina'], platform: 'github', backends: ['rest'] }, h.meta())
      h.store.apply({ kind: 'confidence', id: 'exa', value: 0.5 }, h.meta())
      h.store.apply({ kind: 'confidence', id: 'jina', value: 0.6 }, h.meta())
      h.store.apply({ kind: 'upsertCli', id: 'mine', spec: engineSpec() }, h.meta())
    }
    fill()
    h.store.apply({ kind: 'reset', scope: 'order' }, h.meta())
    assert.deepEqual(Object.keys(h.store.current().values).sort(), ['cliAdapters', 'platformBackends', 'sources'])
    assert.deepEqual(h.store.current().values.sources, { confidence: { exa: 0.5, jina: 0.6 } })
    h.store.apply({ kind: 'reset', scope: 'confidence', id: 'exa' }, h.meta())
    assert.deepEqual(h.store.current().values.sources, { confidence: { jina: 0.6 } })
    h.store.apply({ kind: 'reset', scope: 'confidence' }, h.meta())
    assert.equal(h.store.current().values.sources, undefined)
    h.store.apply({ kind: 'reset', scope: 'platform', id: 'github' }, h.meta())
    assert.equal(h.store.current().values.platformBackends, undefined)
    h.store.apply({ kind: 'reset', scope: 'cli' }, h.meta())
    assert.deepEqual(h.store.current().values, {})
    fill()
    h.store.apply({ kind: 'reset', scope: 'all' }, h.meta())
    assert.deepEqual(h.store.current().values, {})
    assert.deepEqual(h.store.effective().engines, h.config.current.engines)
  } finally { h.cleanup() }
})

test('revoke (the card): one or several keys, or all; an unknown key is refused', () => {
  const h = overlayHarness()
  try {
    h.store.apply({ kind: 'order', engines: ['bing'], disabled: ['jina'] }, h.meta())
    h.store.apply({ kind: 'confidence', id: 'exa', value: 0.5 }, h.meta())
    const user = { actor: 'user' as const, action: 'panel.revoke', reason: 'revoked in the settings card' }
    assert.throws(() => h.store.apply({ kind: 'revoke', keys: ['engines', 'sources.priority'] }, user), ActionNotFoundError)
    h.store.apply({ kind: 'revoke', keys: ['engines'] }, user)
    assert.deepEqual(h.store.items().map(item => item.key), ['sources.disabled', 'sources.confidence.exa'])
    assert.equal(h.store.current().audit.at(-1)!.actor, 'user')
    h.store.apply({ kind: 'revoke', keys: 'all' }, { ...user, action: 'panel.revoke_all' })
    assert.deepEqual(h.store.items(), [])
  } finally { h.cleanup() }
})

test('items() carries the newest audit entry of each key (reason, time, who); view() reports validity', () => {
  const h = overlayHarness({ engines: ['ddg'] })
  try {
    h.store.apply({ kind: 'order', engines: ['bing'] }, h.meta('first reason'))
    h.store.apply({ kind: 'order', engines: ['exa'] }, h.meta('second reason', { sessionId: 'session-2' }))
    h.store.apply({ kind: 'confidence', id: 'exa', value: 0.5 }, h.meta('third reason'))
    const items = h.store.items()
    assert.deepEqual(items.map(item => [item.key, item.kind, item.target, item.summary, item.baseline, item.reason, item.sessionId]), [
      ['engines', 'engines', undefined, 'exa', 'ddg', 'second reason', 'session-2'],
      ['sources.confidence.exa', 'confidence', 'exa', '0.5', '(none)', 'third reason', 'session-1'],
    ])
    const view = h.store.view()
    assert.equal(view.valid, true)
    assert.equal(view.revision, 3)
    assert.equal(view.audit[0]!.reason, 'third reason')
  } finally { h.cleanup() }
})
