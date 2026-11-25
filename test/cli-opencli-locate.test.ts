import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fallbackBinDirs, locateOpencliBin, newestFirst, withPathPrefix, type LocateMachine } from '../src/cli/opencli-locate.ts'
import { clearProbeCache, probeCli, resolveBin } from '../src/cli/probe.ts'
import { clearOpencliCache, listOpencliSites, OPENCLI_PROBE } from '../src/cli/opencli.ts'
import { resolveConfig } from '../src/config.ts'
import { createBuiltinRegistry } from '../src/providers/index.ts'
import { SearchRouter } from '../src/router.ts'
import { Store } from '../src/store.ts'
import { BROWSER_020 } from './browser-stub.ts'
import { fakeOpencli, posix } from './cli-helpers.ts'

/** A machine described by the files that exist on it (a path ending in `/` is a directory listing). */
function machine(platform: NodeJS.Platform, files: string[], env: Record<string, string> = {}, home = platform === 'win32' ? 'C:\\Users\\me' : '/home/me', execPath?: string): LocateMachine {
  const win = platform === 'win32'
  const norm = (p: string): string => (win ? p.replace(/\//g, '\\') : p)
  const all = files.map(norm)
  return {
    platform, env, home,
    isFile: file => all.includes(norm(file)),
    readdir: dir => {
      const base = norm(dir).replace(/[\\/]+$/, '') + (win ? '\\' : '/')
      return [...new Set(all.filter(f => f.startsWith(base)).map(f => f.slice(base.length).split(win ? '\\' : '/')[0]!))]
    },
    ...execPath ? { execPath } : {},
  }
}

test('PATH comes first and needs no extra directories', () => {
  const m = machine('linux', ['/usr/bin/opencli', '/home/me/.npm-global/bin/opencli'], { PATH: '/bin:/usr/bin' })
  assert.deepEqual(locateOpencliBin(m), { location: { path: '/usr/bin/opencli', source: 'path', pathPrefix: [] } })
})

test('after PATH fails: npm prefix, Homebrew, ~/.npm-global, ~/.local/bin, in that order', () => {
  const env = { PATH: '/usr/bin:/bin', npm_config_prefix: '/opt/npm' }
  const first = locateOpencliBin(machine('darwin', ['/opt/npm/bin/opencli', '/opt/homebrew/bin/opencli', '/home/me/.npm-global/bin/opencli'], env))
  assert.equal(first.location?.path, '/opt/npm/bin/opencli')
  assert.equal(first.location?.source, 'fallback')
  assert.equal(locateOpencliBin(machine('darwin', ['/opt/homebrew/bin/opencli', '/home/me/.npm-global/bin/opencli'], { PATH: '/usr/bin' })).location?.path, '/opt/homebrew/bin/opencli')
  assert.equal(locateOpencliBin(machine('linux', ['/usr/local/bin/opencli'], { PATH: '/usr/bin' })).location?.path, '/usr/local/bin/opencli')
  assert.equal(locateOpencliBin(machine('linux', ['/home/me/.npm-global/bin/opencli'], { PATH: '/usr/bin' })).location?.path, '/home/me/.npm-global/bin/opencli')
  assert.equal(locateOpencliBin(machine('linux', ['/home/me/.local/bin/opencli'], { PATH: '' })).location?.path, '/home/me/.local/bin/opencli')
  assert.equal(locateOpencliBin(machine('linux', ['/home/me/.volta/bin/opencli'], { PATH: '' })).location?.path, '/home/me/.volta/bin/opencli')
  assert.deepEqual(locateOpencliBin(machine('linux', [], { PATH: '/usr/bin' })), {})
})

test('a launcher under a version manager brings its own bin directory (which holds node) in front of PATH; versions are taken newest first', () => {
  const fnm = '/home/me/.local/share/fnm/node-versions'
  const files = [`${fnm}/v22.9.0/installation/bin/opencli`, `${fnm}/v22.9.0/installation/bin/node`, `${fnm}/v24.21.0/installation/bin/opencli`, `${fnm}/v24.21.0/installation/bin/node`, `${fnm}/v9.0.0/installation/bin/opencli`]
  const found = locateOpencliBin(machine('linux', files, { PATH: '/usr/bin:/bin' }))
  assert.equal(found.location?.path, `${fnm}/v24.21.0/installation/bin/opencli`, 'v24 before v22 before v9, not a string sort')
  assert.deepEqual(found.location?.pathPrefix, [`${fnm}/v24.21.0/installation/bin`])
  const nvm = locateOpencliBin(machine('linux', ['/home/me/.nvm/versions/node/v20.1.0/bin/opencli', '/home/me/.nvm/versions/node/v20.1.0/bin/node'], { PATH: '/usr/bin' }))
  assert.deepEqual(nvm.location?.pathPrefix, ['/home/me/.nvm/versions/node/v20.1.0/bin'])
  const macFnm = locateOpencliBin(machine('darwin', ['/Users/me/Library/Application Support/fnm/node-versions/v22.0.0/installation/bin/opencli'], { PATH: '/usr/bin' }, '/Users/me'))
  assert.equal(macFnm.location?.source, 'fallback')
  const custom = locateOpencliBin(machine('linux', ['/data/nvm/versions/node/v20.1.0/bin/opencli'], { PATH: '', NVM_DIR: '/data/nvm' }))
  assert.equal(custom.location?.path, '/data/nvm/versions/node/v20.1.0/bin/opencli')
})

test('a launcher whose directory has no node gets one: the running node, then one on PATH, then one of the usual places', () => {
  const launcher = '/home/me/.npm-global/bin/opencli'
  const viaExec = locateOpencliBin(machine('linux', [launcher, '/opt/node/bin/node'], { PATH: '/usr/bin' }, '/home/me', '/opt/node/bin/node'))
  assert.deepEqual(viaExec.location?.pathPrefix, ['/home/me/.npm-global/bin', '/opt/node/bin'])
  const electron = locateOpencliBin(machine('linux', [launcher, '/home/me/.nvm/versions/node/v22.0.0/bin/node'], { PATH: '/usr/bin' }, '/home/me', '/Applications/DSH.app/Contents/MacOS/DSH'))
  assert.deepEqual(electron.location?.pathPrefix, ['/home/me/.npm-global/bin', '/home/me/.nvm/versions/node/v22.0.0/bin'], 'an Electron execPath is not a node')
  const onPath = locateOpencliBin(machine('linux', [launcher, '/srv/bin/node'], { PATH: '/usr/bin:/srv/bin' }))
  assert.deepEqual(onPath.location?.pathPrefix, ['/home/me/.npm-global/bin', '/srv/bin'])
  const none = locateOpencliBin(machine('linux', [launcher], { PATH: '/usr/bin' }))
  assert.deepEqual(none.location?.pathPrefix, ['/home/me/.npm-global/bin'], 'nothing better is known: the launcher directory alone')
})

test('DSH_BROWSER_OPENCLI: the launcher, or the package directory / main.js of a global install; an override that leads nowhere is a problem, never another copy', () => {
  const files = ['/opt/x/bin/opencli', '/opt/x/bin/node', '/usr/bin/opencli']
  const launcher = locateOpencliBin(machine('linux', files, { PATH: '/usr/bin', DSH_BROWSER_OPENCLI: '/opt/x/bin/opencli' }))
  assert.deepEqual(launcher.location, { path: '/opt/x/bin/opencli', source: 'override', pathPrefix: ['/opt/x/bin'] }, 'the override wins over PATH')
  const pkg = locateOpencliBin(machine('linux', files, { PATH: '', DSH_BROWSER_OPENCLI: '/opt/x/lib/node_modules/@jackwener/opencli' }))
  assert.equal(pkg.location?.path, '/opt/x/bin/opencli')
  const main = locateOpencliBin(machine('linux', files, { PATH: '', DSH_BROWSER_OPENCLI: '/opt/x/lib/node_modules/@jackwener/opencli/dist/src/main.js' }))
  assert.equal(main.location?.path, '/opt/x/bin/opencli')
  const wrong = locateOpencliBin(machine('linux', files, { PATH: '/usr/bin', DSH_BROWSER_OPENCLI: '/nowhere/opencli' }))
  assert.equal(wrong.location, undefined, 'the copy on PATH is not used instead')
  assert.match(wrong.problem!, /DSH_BROWSER_OPENCLI=\/nowhere\/opencli does not lead to an opencli launcher/)
})

test('Windows: npm shims (.cmd) in PATH, then %APPDATA%\\npm, then the prefix; paths and delimiters are Windows ones', () => {
  const win = (files: string[], env: Record<string, string>, execPath?: string): ReturnType<typeof locateOpencliBin> => locateOpencliBin(machine('win32', files, env, 'C:\\Users\\me', execPath))
  const onPath = win(['C:/tools/opencli.cmd'], { PATH: 'C:\\Windows;C:\\tools' })
  assert.deepEqual(onPath.location, { path: 'C:\\tools\\opencli.cmd', source: 'path', pathPrefix: [] })
  const appdata = win(['C:/Users/me/AppData/Roaming/npm/opencli.cmd', 'C:/Users/me/AppData/Roaming/npm/node.exe'], { PATH: 'C:\\Windows', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' })
  assert.equal(appdata.location?.path, 'C:\\Users\\me\\AppData\\Roaming\\npm\\opencli.cmd')
  assert.equal(appdata.location?.source, 'fallback')
  assert.deepEqual(appdata.location?.pathPrefix, ['C:\\Users\\me\\AppData\\Roaming\\npm'])
  const home = win(['C:/Users/me/AppData/Roaming/npm/opencli.cmd'], { PATH: 'C:\\Windows' })
  assert.equal(home.location?.path, 'C:\\Users\\me\\AppData\\Roaming\\npm\\opencli.cmd', 'APPDATA unset: the profile folder')
  const prefix = win(['D:/npm/opencli.cmd'], { PATH: '', npm_config_prefix: 'D:\\npm' })
  assert.equal(prefix.location?.path, 'D:\\npm\\opencli.cmd')
  const node = win(['D:/npm/opencli.cmd', 'C:/Program Files/nodejs/node.exe'], { PATH: 'C:\\Windows;C:\\Program Files\\nodejs', npm_config_prefix: 'D:\\npm' })
  assert.deepEqual(node.location?.pathPrefix, ['D:\\npm', 'C:\\Program Files\\nodejs'])
  const override = win(['D:/npm/opencli.cmd'], { PATH: '', DSH_BROWSER_OPENCLI: 'D:\\npm\\node_modules\\@jackwener\\opencli\\dist\\src\\main.js' })
  assert.equal(override.location?.path, 'D:\\npm\\opencli.cmd')
  assert.deepEqual(win([], { PATH: 'C:\\Windows' }), {})
  assert.deepEqual(fallbackBinDirs(machine('win32', [], { APPDATA: 'C:\\A' })), ['C:\\A\\npm'])
})

test('newestFirst sorts version directories numerically; withPathPrefix puts directories first without duplicates', () => {
  assert.deepEqual(newestFirst(['v9.0.0', 'v22.9.0', 'v24.21.0', 'v22.10.1']), ['v24.21.0', 'v22.10.1', 'v22.9.0', 'v9.0.0'])
  assert.deepEqual(withPathPrefix({ PATH: '/usr/bin:/bin', LANG: 'C' }, ['/a/bin', '/usr/bin'], 'linux'), { PATH: '/a/bin:/usr/bin:/bin', LANG: 'C' })
  const same = { PATH: '/usr/bin' }
  assert.equal(withPathPrefix(same, [], 'linux'), same, 'nothing to add: the environment is returned as it is')
  assert.deepEqual(withPathPrefix({ Path: 'C:\\Windows' }, ['C:\\n'], 'win32'), { PATH: 'C:\\n;C:\\Windows' })
})

/** A throwaway home for the duration of `fn`; PATH stays the isolated `/usr/bin:/bin`. */
async function withFakeHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-locate-home-'))
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
  process.env.HOME = home
  process.env.USERPROFILE = home
  clearProbeCache()
  clearOpencliCache()
  try { return await fn(home) } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    clearProbeCache()
    clearOpencliCache()
    fs.rmSync(home, { recursive: true, force: true })
  }
}

/** An `opencli` that, like the real launcher, needs a `node` on its PATH (it fails with 127 as `env node` does when there is none). */
const NEEDS_NODE = 'command -v node >/dev/null 2>&1 || { echo "env: node: No such file or directory" >&2; exit 127; }\n'
const ZHIHU_ROWS = JSON.stringify([{ rank: 1, title: 'Rust 异步运行时', type: 'article', author: 'author-a', votes: 12, url: 'https://zhuanlan.zhihu.com/p/100000001' }])

test('integration: opencli outside PATH is probed, listed and searched through the same launcher, with a node on the child PATH', { skip: !posix }, async () => {
  await withFakeHome(async home => {
    const dir = path.join(home, '.npm-global', 'bin')
    fs.mkdirSync(dir, { recursive: true })
    const launcher = path.join(dir, 'opencli')
    fs.writeFileSync(launcher, '#!/bin/sh\n' + NEEDS_NODE + 'echo "$PATH" > "$(dirname "$0")/path.log"\n' + fakeOpencli({ zhihu: { stdout: ZHIHU_ROWS } }) + '\n')
    fs.chmodSync(launcher, 0o755)
    assert.equal(process.env.PATH, '/usr/bin:/bin', 'the isolated PATH has no opencli and no node')
    assert.equal(resolveBin('opencli').path, launcher)
    const probe = await probeCli(OPENCLI_PROBE)
    assert.equal(probe.state, 'detected', probe.reason)
    assert.equal(probe.path, launcher)
    assert.equal(probe.pathPrefix?.[0], dir, 'the launcher\'s own directory first')
    assert.equal(probe.pathPrefix?.[1], path.dirname(process.execPath), 'then the node that is running')
    const listed = await listOpencliSites({ force: true })
    assert.ok(listed.sites?.has('zhihu'), listed.problem)

    const store = new Store(path.join(home, 'store.db'))
    const browser: any = { ...BROWSER_020, render: async () => ({}), snapshot: async () => ({}), close: async () => {}, searchResults: async () => [] }
    const config = resolveConfig({ engines: ['ddg'], dbPath: path.join(home, 'store.db'), enableCliBackends: true, opencliEnabled: true, ttlSeconds: 60, platformBackends: { zhihu: ['opencli'] } } as never)
    const router = new SearchRouter({ get: () => undefined } as never, config, store, () => config, () => browser, undefined, createBuiltinRegistry())
    try {
      const out = await router.search({ query: 'rust', count: 3, fresh: true, multi: false, signal: undefined, platform: { id: 'zhihu' } as never })
      assert.equal(out.sources[0]!.url, 'https://zhuanlan.zhihu.com/p/100000001')
      assert.equal(fs.readFileSync(path.join(dir, 'argv.log'), 'utf8').trim().split('\n').length, 1, 'one search through the located launcher')
      const childPath = fs.readFileSync(path.join(dir, 'path.log'), 'utf8').trim().split('\n').pop()!
      assert.ok(childPath.startsWith(dir + ':'), 'the child PATH starts with the launcher directory: ' + childPath)
      assert.doesNotMatch(childPath, new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/\\.ssh'), 'nothing else of the machine leaks into it')
    } finally { router.dispose(); store.close() }
  })
})

test('integration: a missing opencli says where it looked, and a bad DSH_BROWSER_OPENCLI is named', { skip: !posix }, async () => {
  await withFakeHome(async home => {
    const missing = await probeCli(OPENCLI_PROBE, { force: true })
    assert.equal(missing.state, 'missing')
    assert.match(missing.reason!, /opencli not found on PATH or in the usual global install folders \(Homebrew, ~\/\.npm-global, nvm, fnm, Volta; DSH_BROWSER_OPENCLI names it explicitly\)/)
    process.env.DSH_BROWSER_OPENCLI = path.join(home, 'nowhere', 'opencli')
    try {
      clearProbeCache()
      assert.match((await probeCli(OPENCLI_PROBE, { force: true })).reason!, /DSH_BROWSER_OPENCLI=.*does not lead to an opencli launcher/)
      assert.match((await listOpencliSites({ force: true })).problem!, /DSH_BROWSER_OPENCLI/)
    } finally { delete process.env.DSH_BROWSER_OPENCLI; clearProbeCache() }
  })
})
