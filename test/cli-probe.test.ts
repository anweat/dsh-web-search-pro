import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { cachedProbe, clearProbeCache, evaluateCliContract, findOnPath, probeAll, probeCli } from '../src/cli/probe.ts'
import { baseSpec, posix, withCommands } from './cli-helpers.ts'

const spec = baseSpec({ probe: { versionArgs: ['--version'], minVersion: '1.2.0', helpArgs: ['search', '--help'], mustContain: ['--json', '--limit'] } })
const OK = 'case "$1" in --version) echo "demo-cli 1.3.0";; search) echo "Usage: demo-cli search QUERY --limit N --json";; *) echo "demo";; esac'

test('evaluateCliContract: version floor and the subcommands / flags that prove the contract', () => {
  const ok = { code: 0, output: 'x' }
  assert.deepEqual(evaluateCliContract(spec, 'demo-cli', { code: 0, output: 'demo-cli 1.3.0' }, { code: 0, output: '--json --limit' }), { state: 'detected', version: '1.3.0' })
  assert.match(evaluateCliContract(spec, 'demo-cli', { code: 0, output: '1.1.9' }, ok).reason!, /demo-cli 1\.1\.9 is older than required 1\.2\.0/)
  assert.match(evaluateCliContract(spec, 'demo-cli', { code: 0, output: 'no number' }, ok).reason!, /no semantic version/)
  assert.match(evaluateCliContract(spec, 'demo-cli', { code: 2, output: '' }, ok).reason!, /--version failed with exit 2/)
  assert.match(evaluateCliContract(spec, 'demo-cli', { code: 0, output: '1.3.0' }, { code: 2, output: '' }).reason!, /search --help failed with exit 2/)
  const missing = evaluateCliContract(spec, 'demo-cli', { code: 0, output: '1.3.0' }, { code: 0, output: 'only --json' })
  assert.equal(missing.state, 'incompatible')
  assert.match(missing.reason!, /demo-cli search contract missing --limit/)
  assert.equal(missing.version, '1.3.0')
  // Without a version floor the version command may fail or print nothing.
  const lenient = baseSpec()
  assert.equal(evaluateCliContract(lenient, 'demo-cli', { code: 1, output: '' }, { code: 0, output: '--JSON' }).state, 'detected', 'matching is case-insensitive')
})

test('probe: missing, a same-named program with another contract, too old, ok', { skip: !posix }, async () => {
  clearProbeCache()
  const none = await withCommands({}, () => probeCli(spec))
  assert.equal(none.state, 'missing')
  assert.match(none.reason!, /demo-cli not found on PATH.*npm i -g demo-cli/)
  clearProbeCache()
  const wrong = await withCommands({ 'demo-cli': 'case "$1" in --version) echo "demo-cli 9.0.0";; *) echo "a different program";; esac' }, () => probeCli(spec))
  assert.equal(wrong.state, 'incompatible')
  assert.match(wrong.reason!, /contract missing --json, --limit.*different program with the same name/)
  assert.equal(wrong.version, '9.0.0')
  assert.ok(wrong.path)
  clearProbeCache()
  const old = await withCommands({ 'demo-cli': OK.replace('1.3.0', '1.1.0') }, () => probeCli(spec))
  assert.equal(old.state, 'incompatible')
  assert.match(old.reason!, /older than required/)
  clearProbeCache()
  const good = await withCommands({ 'demo-cli': OK }, () => probeCli(spec))
  assert.deepEqual([good.state, good.version, good.bin], ['detected', '1.3.0', 'demo-cli'])
  assert.match(good.path!, /demo-cli$/)
})

test('probe only runs the spec\'s version and help commands: never a search, never a login', { skip: !posix }, async () => {
  clearProbeCache()
  await withCommands({ 'demo-cli': 'echo "$@" >> "$0.log"; ' + OK }, async dir => {
    await probeCli(spec)
    const calls = fs.readFileSync(dir + '/demo-cli.log', 'utf8').trim().split('\n')
    assert.deepEqual(calls.sort(), ['--version', 'search --help'])
  })
})

test('probe cache: TTL, force, single flight, sync lookup for Engine.available()', { skip: !posix }, async () => {
  clearProbeCache()
  await withCommands({ 'demo-cli': 'echo x >> "$0.log"; ' + OK }, async dir => {
    const runs = (): number => (fs.existsSync(dir + '/demo-cli.log') ? fs.readFileSync(dir + '/demo-cli.log', 'utf8').trim().split('\n').length : 0)
    assert.equal(cachedProbe(spec), undefined, 'nothing probed yet')
    let now = 1_000
    const [a, b] = await Promise.all([probeCli(spec, { now: () => now }), probeCli(spec, { now: () => now })])
    assert.equal(a, b, 'concurrent calls share one run')
    assert.equal(runs(), 2, 'one version call and one help call')
    await probeCli(spec, { now: () => now + 30_000 })
    assert.equal(runs(), 2, 'within the TTL')
    assert.equal(cachedProbe(spec, 60_000, () => now + 30_000)?.state, 'detected')
    assert.equal(cachedProbe(spec, 60_000, () => now + 90_000), undefined, 'expired')
    now += 90_000
    await probeCli(spec, { now: () => now })
    assert.equal(runs(), 4, 'after the TTL')
    await probeCli(spec, { now: () => now, force: true })
    assert.equal(runs(), 6, 'force re-probes')
  })
})

test('probeAll probes many specs with bounded concurrency and findOnPath needs no process', { skip: !posix }, async () => {
  clearProbeCache()
  const a = baseSpec({ id: 'a', bins: ['a-cli'], probe: { versionArgs: ['--version'], helpArgs: ['--help'], mustContain: ['ok'] } })
  const b = baseSpec({ id: 'b', bins: ['b-cli'], probe: { versionArgs: ['--version'], helpArgs: ['--help'], mustContain: ['ok'] } })
  await withCommands({ 'a-cli': 'echo ok', 'b-cli': 'echo nope' }, async () => {
    const out = await probeAll([a, b])
    assert.equal(out.get('a')!.state, 'detected')
    assert.equal(out.get('b')!.state, 'incompatible')
    assert.ok(findOnPath('a-cli'))
    assert.equal(findOnPath('definitely-not-installed-cli'), undefined)
  })
})
