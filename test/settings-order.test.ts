import assert from 'node:assert/strict'
import test from 'node:test'
import { BUILTIN_CLI_SPECS } from '../src/cli/builtin-specs.ts'
import { DEFAULT_CHAINS } from '../src/cli/chains-spec.ts'
import { DEFAULT_ENGINES, explainChain } from '../src/default-chain.ts'
import { createBuiltinRegistry } from '../src/providers/index.ts'
import { dynamicSpecsOf } from '../src/client/form.ts'
import {
  addId, backendChoices, backendName, BUILTIN_ENGINE_IDS, chainsOf, COMMON_PLATFORMS, confidenceView, customRows, defaultChainOf, engineChoices, filterPlatforms, idsOf, moveId, ORDER_PLATFORMS, PLATFORM_NAMES, removeId,
  sourceInfo, splitPlatforms, textOf, withChain,
} from '../src/client/order.ts'
import { BASE, harness } from './settings-harness.ts'

const echo = (over: Record<string, unknown> = {}) => ({
  bins: ['echo'], packageNote: 'echo', platforms: [], engine: true, probe: { versionArgs: ['--version'], helpArgs: ['--help'], mustContain: [] }, allowedSubcommands: [],
  search: { argv: ['{query}'], output: { format: 'text', lines: { mode: 'whole' } } }, env: {}, needsLogin: false, timeoutMs: 5000, maxOutputBytes: 65536, ...over,
})

test('list edits: add, remove and move are pure, keep the order, and refuse nothing silently', () => {
  assert.deepEqual(idsOf(' ddg, bing ,ddg,, exa'), ['ddg', 'bing', 'exa'])
  assert.equal(textOf(['ddg', 'bing']), 'ddg, bing')
  assert.deepEqual(addId(['ddg'], 'bing'), ['ddg', 'bing'])
  assert.deepEqual(addId(['ddg', 'bing'], 'ddg'), ['ddg', 'bing'], 'an id already in the list is not added twice')
  assert.deepEqual(removeId(['ddg', 'bing', 'exa'], 'bing'), ['ddg', 'exa'])
  assert.deepEqual(moveId(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c'])
  assert.deepEqual(moveId(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b'])
  assert.deepEqual(moveId(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c'], 'the first cannot go up')
  assert.deepEqual(moveId(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c'], 'the last cannot go down')
  assert.deepEqual(moveId(['a', 'b'], 'zzz', 1), ['a', 'b'])
  const input = ['a', 'b']
  moveId(input, 'a', 1)
  assert.deepEqual(input, ['a', 'b'], 'the input list is not changed')
})

test('the engines the card offers are real route ids, the custom ones are the valid CLIs marked as a general engine', () => {
  const registry = createBuiltinRegistry()
  for (const id of BUILTIN_ENGINE_IDS) assert.ok(registry.routeId(id) !== undefined, id + ' is a registered source')
  for (const id of DEFAULT_ENGINES) assert.ok(BUILTIN_ENGINE_IDS.includes(id), id + ' (a default engine) is offered')
  assert.ok(!BUILTIN_ENGINE_IDS.some(id => id.startsWith('custom-cli:')))
  const adapters = { echo: echo(), plat: echo({ engine: false, platforms: ['weibo'] }), bad: echo({ confidence: 7 }) }
  assert.deepEqual(engineChoices(['ddg', 'bing'], adapters).filter(id => id.startsWith('custom-cli:')), ['custom-cli:echo'], 'only the valid engine CLI')
  assert.ok(!engineChoices(['ddg', 'bing'], undefined).includes('ddg'), 'what is in the list is not offered again')
  assert.ok(!engineChoices(['custom-cli:echo'], adapters).includes('custom-cli:echo'))
  assert.equal(sourceInfo('deepseek').kind, 'keyed')
  assert.equal(sourceInfo('ddg').name, 'DuckDuckGo')
  assert.equal(sourceInfo('seam').kind, 'seam')
  assert.deepEqual([sourceInfo('custom-cli:echo', adapters).kind, sourceInfo('custom-cli:ghost', adapters).kind, sourceInfo('nope').kind], ['custom', 'unknown', 'unknown'])
})

test('the platform lists: a name for every platform with a chain, the default chain, and the backends that can serve each platform', () => {
  assert.deepEqual([...ORDER_PLATFORMS].sort(), Object.keys(PLATFORM_NAMES).sort())
  assert.deepEqual(defaultChainOf('xiaohongshu'), DEFAULT_CHAINS.xiaohongshu)
  const adapters = { mine: echo({ engine: false, platforms: ['weibo', 'xiaohongshu'] }), other: echo({ platforms: ['reddit'] }) }
  const choices = backendChoices('xiaohongshu', ['xhs'], adapters)
  assert.ok(choices.includes('opencli') && choices.includes('browser-opencli') && choices.includes('custom-cli:mine'))
  assert.ok(!choices.includes('xhs'), 'a backend already in the chain is not offered')
  assert.ok(!choices.includes('rdt') && !choices.includes('custom-cli:other'), 'a backend that does not serve the platform is not offered')
  assert.deepEqual(backendChoices('bilibili', [], undefined), ['bili', 'opencli'])
  assert.ok(backendChoices('github', [], undefined).includes('rest') && backendChoices('github', [], undefined).includes('gh'))
  assert.equal(backendName('opencli'), 'OpenCLI')
  assert.equal(backendName('custom-cli:mine'), 'mine')
  assert.equal(backendName('xhs'), BUILTIN_CLI_SPECS.find(spec => spec.id === 'xhs')!.bins[0])
})

test('the chain of one platform is a text patch of platformBackends: set, reorder, back to the default (the key goes), and the last key clears the field', () => {
  const set = withChain('', 'xiaohongshu', ['xhs', 'opencli'])!
  assert.deepEqual(chainsOf(set), { xiaohongshu: ['xhs', 'opencli'] })
  const two = withChain(set, 'reddit', ['rdt'])!
  assert.deepEqual(chainsOf(two), { xiaohongshu: ['xhs', 'opencli'], reddit: ['rdt'] })
  assert.deepEqual(chainsOf(withChain(two, 'xiaohongshu', ['opencli', 'xhs'])!), { xiaohongshu: ['opencli', 'xhs'], reddit: ['rdt'] })
  assert.deepEqual(chainsOf(withChain(two, 'xiaohongshu', undefined)!), { reddit: ['rdt'] }, 'back to the default removes the key of that platform only')
  assert.equal(withChain(set, 'xiaohongshu', undefined), '', 'no key left = the empty text, which the form model stores as "not set"')
  assert.equal(withChain('{ not json', 'x', ['a']), undefined)
  assert.equal(withChain('[]', 'x', ['a']), undefined)
  assert.equal(withChain('', 'x', undefined), '')
  assert.deepEqual(chainsOf(''), {})
  assert.equal(chainsOf('[1]'), undefined)
})

test('custom rows: id, command, purpose, confidence (default 0.5) and the server\'s validation problems', () => {
  const rows = customRows({ echo: echo({ confidence: 0.7 }), plat: echo({ engine: false, platforms: ['weibo'] }), bad: echo({ bins: ['/usr/bin/x'] }), junk: 'x' })
  assert.deepEqual(rows.map(row => [row.id, row.bin, row.engine, row.platforms, row.confidence, row.problems.length === 0]), [
    ['echo', 'echo', true, [], 0.7, true], ['plat', 'echo', false, ['weibo'], 0.5, true], ['bad', '/usr/bin/x', true, [], 0.5, false],
  ])
  assert.match(rows[2]!.problems.join('\n'), /bins must be 1\.\.4 command names/)
  assert.deepEqual(customRows(undefined), [])
})

test('explainChain: the effective chain and why it differs from the list, one reason per rule', () => {
  const base = { engines: ['ddg', 'bing', 'exa', 'seam', 'jina'], commonReady: ['deepseek'] }
  assert.deepEqual(explainChain(base), { chain: ['deepseek', 'ddg', 'bing', 'exa', 'seam', 'jina'], reasons: [{ kind: 'common', ids: ['deepseek'] }] })
  assert.deepEqual(explainChain({ ...base, disabled: ['deepseek'] }), { chain: ['ddg', 'bing', 'exa', 'seam', 'jina'], reasons: [] }, 'a disabled common source is neither added nor mentioned')
  assert.deepEqual(explainChain({ ...base, disabled: ['bing'] }).reasons, [{ kind: 'disabled', ids: ['bing'] }, { kind: 'common', ids: ['deepseek'] }])
  assert.deepEqual(explainChain({ ...base, priority: ['jina', 'ddg'] }).chain, ['jina', 'ddg', 'deepseek', 'bing', 'exa', 'seam'], 'sources.priority goes before the common source the default rule adds')
  assert.deepEqual(explainChain({ ...base, priority: ['jina', 'ddg'] }).reasons, [{ kind: 'common', ids: ['deepseek'] }, { kind: 'priority', ids: ['jina', 'ddg'] }])
  assert.deepEqual(explainChain({ ...base, priority: ['ddg'] }).reasons, [{ kind: 'common', ids: ['deepseek'] }], 'a priority id that already leads is not "moved"')
  // Only free sources: the paid common one is kept out and the sentence says so.
  assert.deepEqual(explainChain({ ...base, anonymousOnly: true }), { chain: ['ddg', 'bing', 'exa', 'seam', 'jina'], reasons: [{ kind: 'anonymous-only', ids: ['deepseek'] }] })
  // A list the user wrote is theirs: DeepSeek is not added, and the sentence says why.
  assert.deepEqual(explainChain({ engines: ['bing', 'ddg'], commonReady: ['deepseek'] }), { chain: ['bing', 'ddg'], reasons: [{ kind: 'own-list', ids: ['deepseek'] }] })
  assert.deepEqual(explainChain({ engines: ['deepseek', 'ddg'], commonReady: ['deepseek'] }), { chain: ['deepseek', 'ddg'], reasons: [] }, 'a list that names it keeps its place')
  assert.deepEqual(explainChain({ engines: ['ddg'], disabled: ['ddg'] }), { chain: undefined, reasons: [{ kind: 'disabled', ids: ['ddg'] }] }, 'everything disabled = no chain')
  assert.deepEqual(explainChain({ engines: ['ddg', 'bing'] }), { chain: ['ddg', 'bing'], reasons: [] })
})

// ── through the form model: what saving writes ──────────────────────────────────────────────────────────────────────────

test('engines: add, move, remove and "restore default" stage the patches the Host takes (one atomic mutate; restore = unset)', async () => {
  const { scope, controller } = harness(BASE, { engines: ['ddg', 'bing'] })
  const text = (): string => controller.snapshot().fields.engines.text
  controller.edit('engines', textOf(addId(idsOf(text()), 'exa')))
  controller.edit('engines', textOf(moveId(idsOf(text()), 'exa', -1)))
  controller.edit('engines', textOf(removeId(idsOf(text()), 'bing')))
  assert.equal(text(), 'ddg, exa', 'the draft after three edits: [ddg bing exa] -> [ddg exa bing] -> [ddg exa]')
  assert.equal(controller.snapshot().changes, 1, 'three edits of one field are one pending change')
  await controller.save()
  assert.deepEqual(scope.writes, ['set:engines'])
  assert.deepEqual(scope.user.engines, ['ddg', 'exa'])
  assert.equal(scope.mutations.length, 1)
  // Restore default: the key goes, the composition layer's list applies again.
  controller.resetField('engines')
  assert.equal(controller.snapshot().dirty, true)
  await controller.save()
  assert.deepEqual(scope.writes, ['set:engines', 'unset:engines'])
  assert.equal(Object.hasOwn(scope.user, 'engines'), false)
  // Nothing stored: restoring default is not a change.
  controller.resetField('engines')
  assert.equal(controller.snapshot().dirty, false)
  controller.dispose()
})

test('platform chains: editing one platform writes platformBackends, restoring its default removes its key, the last one unsets the field', async () => {
  const { scope, controller } = harness()
  const text = (): string => controller.snapshot().fields.platformBackends.text
  controller.edit('platformBackends', withChain(text(), 'xiaohongshu', ['xhs', 'opencli'])!)
  controller.edit('platformBackends', withChain(text(), 'reddit', ['rdt'])!)
  await controller.save()
  assert.deepEqual(scope.writes, ['set:platformBackends'])
  assert.deepEqual(scope.user.platformBackends, { xiaohongshu: ['xhs', 'opencli'], reddit: ['rdt'] })
  controller.edit('platformBackends', withChain(text(), 'reddit', undefined)!)
  await controller.save()
  assert.deepEqual(scope.user.platformBackends, { xiaohongshu: ['xhs', 'opencli'] })
  controller.edit('platformBackends', withChain(text(), 'xiaohongshu', undefined)!)
  await controller.save()
  assert.equal(Object.hasOwn(scope.user, 'platformBackends'), false, 'no override left: the field is unset, not written as {}')
  assert.deepEqual(scope.writes, ['set:platformBackends', 'set:platformBackends', 'unset:platformBackends'])
  // A chain the server would refuse blocks the save with the server's words.
  controller.edit('platformBackends', withChain('', 'xiaohongshu', ['rdt'])!)
  assert.equal(controller.snapshot().invalid, true)
  assert.match(controller.snapshot().fields.platformBackends.message ?? '', /"rdt" does not serve platform xiaohongshu/)
  controller.dispose()
})

test('a custom CLI is offered to a platform chain only when its spec declares the platform; saving the chain then passes the server\'s check', async () => {
  const { scope, controller } = harness()
  controller.edit('cliAdapters', JSON.stringify({ mine: echo({ engine: false, platforms: ['weibo'] }) }))
  controller.edit('platformBackends', withChain('', 'weibo', ['custom-cli:mine', 'browser-search'])!)
  assert.equal(controller.snapshot().invalid, false, controller.snapshot().fields.platformBackends.message ?? controller.snapshot().fields.cliAdapters.message ?? '')
  controller.edit('platformBackends', withChain('', 'twitter', ['custom-cli:mine'])!)
  assert.match(controller.snapshot().fields.platformBackends.message ?? '', /"custom-cli:mine" does not serve platform twitter \(it serves weibo\)/)
  controller.edit('cliAdapters', JSON.stringify({ mine: echo({ platforms: ['nowhere'] }) }))
  assert.match(controller.snapshot().fields.cliAdapters.message ?? '', /cliAdapters\.mine\.platforms: no backend chain exists for nowhere/)
  controller.dispose()
  void scope
})

test('sources.confidence.<id>: a field for any source id, validated 0..1, written beneath sources.confidence, reset to unset', async () => {
  const { scope, controller } = harness(BASE, { sources: { confidence: { 'custom-cli:echo': 0.4 } } })
  assert.equal(controller.snapshot().fields['sources.confidence.custom-cli:echo']?.text, '0.4', 'a stored entry is a field of the card state')
  assert.equal(controller.snapshot().fields['sources.confidence.custom-cli:echo']?.overridden, true)
  assert.equal(controller.snapshot().fields['sources.confidence.ddg'], undefined, 'no field until something is staged')
  controller.edit('sources.confidence.ddg', '0.6')
  assert.equal(controller.snapshot().fields['sources.confidence.ddg']!.overridden, true)
  controller.edit('sources.confidence.bing', '1.5')
  assert.equal(controller.snapshot().invalid, true)
  assert.equal(controller.snapshot().fields['sources.confidence.bing']!.invalid, true)
  await controller.save()
  assert.deepEqual(scope.writes, [], 'an invalid value blocks the whole save')
  controller.edit('sources.confidence.bing', '0')
  await controller.save()
  assert.deepEqual(scope.writes, ['set:sources.confidence.ddg', 'set:sources.confidence.bing'])
  assert.deepEqual((scope.user.sources as { confidence: Record<string, number> }).confidence, { 'custom-cli:echo': 0.4, ddg: 0.6, bing: 0 })
  controller.resetField('sources.confidence.ddg')
  await controller.save()
  assert.deepEqual(scope.writes.slice(2), ['unset:sources.confidence.ddg'])
  assert.deepEqual((scope.user.sources as { confidence: Record<string, number> }).confidence, { 'custom-cli:echo': 0.4, bing: 0 })
  // The text view prints them next to the fixed fields.
  assert.ok(dynamicSpecsOf(controller.snapshot().fields).some(spec => spec.field === 'sources.confidence.bing'))
  controller.dispose()
})

test('splitPlatforms: shown = changed, served by a valid custom CLI, or common; the rest folds; both keep the platform order', () => {
  assert.deepEqual([...COMMON_PLATFORMS].sort(), ['bilibili', 'github', 'reddit', 'twitter', 'wechat', 'xiaohongshu', 'youtube', 'zhihu'])
  for (const id of COMMON_PLATFORMS) assert.ok(ORDER_PLATFORMS.includes(id), id + ' is a platform with a chain')
  const plain = splitPlatforms(ORDER_PLATFORMS, '', undefined)
  assert.deepEqual(plain.shown, ORDER_PLATFORMS.filter(id => COMMON_PLATFORMS.includes(id)))
  assert.deepEqual([...plain.shown, ...plain.rest].sort(), [...ORDER_PLATFORMS].sort(), 'nothing is lost')
  assert.ok(plain.rest.includes('weibo') && plain.rest.includes('github-issues'))
  // changed: a key of platformBackends, whatever the chain
  assert.ok(splitPlatforms(ORDER_PLATFORMS, JSON.stringify({ weibo: ['browser-search'] }), undefined).shown.includes('weibo'))
  assert.ok(splitPlatforms(ORDER_PLATFORMS, JSON.stringify({ douban: [] }), undefined).shown.includes('douban'), 'an emptied chain is a change too')
  assert.ok(splitPlatforms(ORDER_PLATFORMS, '{ not json', undefined).rest.includes('weibo'), 'broken text counts nothing as changed')
  // served by a custom CLI: only a spec that validates
  const adapters = { mine: echo({ engine: false, platforms: ['douban', 'weibo'] }), bad: echo({ engine: false, platforms: ['tieba'], bins: ['/usr/bin/x'] }) }
  const withCli = splitPlatforms(ORDER_PLATFORMS, '', adapters)
  assert.ok(withCli.shown.includes('douban') && withCli.shown.includes('weibo'))
  assert.ok(withCli.rest.includes('tieba'), 'an invalid spec serves nothing')
  assert.deepEqual(withCli.shown, ORDER_PLATFORMS.filter(id => withCli.shown.includes(id)), 'platform order kept')
})

test('filterPlatforms: by display name or id, any case, surrounding spaces ignored; an empty query keeps everything', () => {
  assert.deepEqual(filterPlatforms(ORDER_PLATFORMS, ''), [...ORDER_PLATFORMS])
  assert.deepEqual(filterPlatforms(ORDER_PLATFORMS, '   '), [...ORDER_PLATFORMS])
  assert.deepEqual(filterPlatforms(ORDER_PLATFORMS, 'GitHub'), ['github', 'github-issues', 'github-code'])
  assert.deepEqual(filterPlatforms(ORDER_PLATFORMS, ' issues '), ['github-issues'])
  assert.deepEqual(filterPlatforms(ORDER_PLATFORMS, '知乎'), ['zhihu'])
  assert.deepEqual(filterPlatforms(ORDER_PLATFORMS, '贴吧'), ['tieba'])
  assert.deepEqual(filterPlatforms(ORDER_PLATFORMS, 'x'), ORDER_PLATFORMS.filter(id => id.includes('x') || (PLATFORM_NAMES[id] ?? '').toLowerCase().includes('x')))
  assert.deepEqual(filterPlatforms(ORDER_PLATFORMS, 'no such platform'), [])
  assert.deepEqual(filterPlatforms(['a', 'b'], 'A'), ['a'])
})

test('confidenceView: empty = the source\'s default; 1 is quiet; anything else in 0-1 is shown; text outside 0-1 is invalid and never quiet', () => {
  assert.deepEqual(confidenceView('', 1), { effective: 1, invalid: false, typed: false, quiet: true })
  assert.deepEqual(confidenceView('  ', 0.5), { effective: 0.5, invalid: false, typed: false, quiet: false }, 'a custom CLI defaults to 0.5, which is not neutral')
  assert.deepEqual(confidenceView('1', 0.5), { effective: 1, invalid: false, typed: true, quiet: true })
  assert.deepEqual(confidenceView('0.8', 1), { effective: 0.8, invalid: false, typed: true, quiet: false })
  assert.deepEqual(confidenceView('0', 1), { effective: 0, invalid: false, typed: true, quiet: false })
  for (const text of ['7', '-0.1', 'abc', '1.5', '0..5']) assert.deepEqual(confidenceView(text, 1), { effective: 1, invalid: true, typed: true, quiet: false }, text)
})
