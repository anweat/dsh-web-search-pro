import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error a plain .mjs module without declarations
import { belongsTo, defaultAuthDir, gitWorkTreeOf, mergeStorageState, parseArgs, resolveOutput, saveLoginState, SITES, supportsIndexedDb, withoutSites } from '../scripts/lib/login-state.mjs'
import { posix } from './cli-helpers.ts'

const cookie = (name: string, domain: string, value = 'v', p = '/') => ({ name, value, domain, path: p, expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' })
const origin = (o: string, items = [{ name: 'k', value: 'v' }]) => ({ origin: o, localStorage: items })

test('the default place is dsh-browser\'s auth directory under DSH_HOME or ~/.dsh; an explicit path wins', () => {
  assert.equal(defaultAuthDir({ DSH_HOME: '/data/dsh' }, '/home/me'), path.join('/data/dsh', 'data', 'browser', 'auth'))
  assert.equal(defaultAuthDir({}, '/home/me'), path.join('/home/me', '.dsh', 'data', 'browser', 'auth'))
  assert.equal(defaultAuthDir({ DSH_HOME: '  ' }, '/home/me'), path.join('/home/me', '.dsh', 'data', 'browser', 'auth'), 'a blank DSH_HOME is not a home')
  assert.deepEqual(resolveOutput(undefined, { env: {}, home: '/home/me', cwd: '/work' }), { file: path.join('/home/me', '.dsh', 'data', 'browser', 'auth', 'login-state.json'), explicit: false })
  assert.deepEqual(resolveOutput('out/state.json', { env: { DSH_HOME: '/x' }, home: '/h', cwd: '/work' }), { file: path.join('/work', 'out', 'state.json'), explicit: true })
  assert.equal(resolveOutput('/abs/s.json', { env: {}, home: '/h', cwd: '/work' }).file, '/abs/s.json')
})

test('arguments: platform, optional output, --force; anything else is refused', () => {
  assert.deepEqual(parseArgs([]), { which: 'all', out: undefined, force: false, help: false })
  assert.deepEqual(parseArgs(['zhihu', 'a.json', '--force']), { which: 'zhihu', out: 'a.json', force: true, help: false })
  assert.deepEqual(parseArgs(['--force', 'weibo']), { which: 'weibo', out: undefined, force: true, help: false })
  assert.match(parseArgs(['--bogus']).error, /未知参数 --bogus/)
  assert.match(parseArgs(['a', 'b', 'c']).error, /参数太多/)
  assert.equal(parseArgs(['-h']).help, true)
})

test('a git work tree is recognised by the nearest .git (directory or worktree file); nothing is spawned', () => {
  const has = (set: string[]) => (p: string) => set.includes(p)
  assert.equal(gitWorkTreeOf('/repo/sub/deep/login-state.json', has([path.join('/repo', '.git')])), '/repo')
  assert.equal(gitWorkTreeOf('/repo/login-state.json', has([path.join('/repo', '.git')])), '/repo', 'a worktree\'s .git file counts the same')
  assert.equal(gitWorkTreeOf('/home/me/.dsh/data/browser/auth/login-state.json', has([])), undefined)
  assert.equal(gitWorkTreeOf('/home/me/.dsh/x.json', has([path.join('/home/me', '.git')])), '/home/me', 'a dotfiles repo in the home counts too')
})

test('Playwright 1.51 is the first version that can export IndexedDB', () => {
  for (const [v, ok] of [['1.50.1', false], ['1.51.0', true], ['1.59.1', true], ['2.0.0', true], ['', false], [undefined, false], ['x', false]] as const) assert.equal(supportsIndexedDb(v), ok, String(v))
})

test('belongsTo: registrable domains, with or without the leading dot, never a look-alike', () => {
  assert.equal(belongsTo('.www.zhihu.com', ['zhihu.com']), true)
  assert.equal(belongsTo('zhihu.com', ['zhihu.com']), true)
  assert.equal(belongsTo('notzhihu.com', ['zhihu.com']), false)
  assert.equal(belongsTo('zhihu.com.evil.test', ['zhihu.com']), false)
  assert.equal(belongsTo('', ['zhihu.com']), false)
  for (const [name, site] of Object.entries(SITES) as [string, { page: string; domains: string[] }][]) assert.ok(belongsTo(new URL(site.page).hostname, site.domains), name + ' login page belongs to its own domains')
})

test('merge: the sites logged in now are replaced, the others kept, a fresh cookie wins over an old one of the same name, domain and path', () => {
  const existing = {
    cookies: [cookie('sid', '.zhihu.com', 'old'), cookie('z_other', 'www.zhihu.com', 'old'), cookie('SUB', '.weibo.com', 'keep'), cookie('BDUSS', '.baidu.com', 'keep')],
    origins: [origin('https://www.zhihu.com'), origin('https://weibo.com'), origin('https://tieba.baidu.com')],
  }
  const fresh = { cookies: [cookie('sid', '.zhihu.com', 'new'), cookie('z_new', '.zhihu.com', 'new')], origins: [origin('https://www.zhihu.com', [{ name: 'fresh', value: '1' }])] }
  const merged = mergeStorageState(existing, fresh, SITES.zhihu.domains)
  assert.deepEqual(merged.cookies.map((c: any) => [c.name, c.value]).sort(), [['BDUSS', 'keep'], ['SUB', 'keep'], ['sid', 'new'], ['z_new', 'new']], 'z_other (old zhihu) is gone, the other sites stay')
  assert.deepEqual(merged.origins.map((o: any) => o.origin).sort(), ['https://tieba.baidu.com', 'https://weibo.com', 'https://www.zhihu.com'])
  assert.deepEqual(merged.origins.find((o: any) => o.origin === 'https://www.zhihu.com').localStorage, [{ name: 'fresh', value: '1' }])
  // Not a storage state on file: the fresh one is all there is.
  assert.deepEqual(mergeStorageState({ nope: 1 }, fresh, SITES.zhihu.domains), fresh)
  assert.deepEqual(mergeStorageState(undefined, fresh, SITES.zhihu.domains), fresh)
})

function tmp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-save-login-')) }
const mode = (p: string): number => fs.statSync(p).mode & 0o777

test('a skipped site keeps its saved login: the visitor cookies of its login page are dropped before the merge', () => {
  const old = { cookies: [cookie('z_c0', '.zhihu.com', 'saved'), cookie('SUB', '.weibo.com', 'saved')], origins: [origin('https://www.zhihu.com')] }
  const fresh = { cookies: [cookie('z_c0', '.zhihu.com', 'visitor'), cookie('d_c0', '.zhihu.com'), cookie('SUB', '.weibo.com', 'new'), cookie('SSO', '.sina.com.cn')], origins: [origin('https://www.zhihu.com', [{ name: 'k', value: 'visitor' }])] }
  const kept = withoutSites(fresh, SITES.zhihu.domains)
  assert.deepEqual(kept.cookies.map((c: { name: string }) => c.name), ['SUB', 'SSO'], 'a third domain of the sign-on stays')
  const merged = mergeStorageState(old, kept, SITES.weibo.domains)
  assert.deepEqual(merged.cookies.map((c: { name: string; value: string }) => c.name + '=' + c.value).sort(), ['SSO=v', 'SUB=new', 'z_c0=saved'])
  assert.equal(merged.origins[0].localStorage[0].value, 'v')
  assert.equal(withoutSites(fresh, []), fresh)
})

test('writing: directory 0700, file 0600, merged into what is there with ONE .bak', { skip: !posix }, () => {
  const root = tmp()
  try {
    const file = path.join(root, 'data', 'browser', 'auth', 'login-state.json')
    const first = saveLoginState({ file, fresh: { cookies: [cookie('sid', '.zhihu.com', 'a')], origins: [] }, domains: SITES.zhihu.domains, ownDir: true })
    assert.equal(first.note, 'created')
    assert.equal(first.backup, undefined)
    assert.equal(mode(file), 0o600)
    assert.equal(mode(path.dirname(file)), 0o700)
    assert.equal(fs.existsSync(file + '.bak'), false)

    const second = saveLoginState({ file, fresh: { cookies: [cookie('SUB', '.weibo.com', 'b')], origins: [origin('https://weibo.com')] }, domains: SITES.weibo.domains, ownDir: true })
    assert.equal(second.note, 'merged')
    assert.equal(second.backup, file + '.bak')
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).cookies.map((c: any) => c.name).sort(), ['SUB', 'sid'], 'zhihu kept, weibo added')
    assert.deepEqual(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')).cookies.map((c: any) => c.name), ['sid'], 'the .bak is the file as it was before this run')
    assert.equal(mode(file + '.bak'), 0o600)

    // A third run replaces the .bak (one, not a pile) and leaves no temporary file behind.
    saveLoginState({ file, fresh: { cookies: [cookie('SUB', '.weibo.com', 'c')], origins: [] }, domains: SITES.weibo.domains, ownDir: true })
    assert.deepEqual(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')).cookies.map((c: any) => [c.name, c.value]).sort(), [['SUB', 'b'], ['sid', 'a']])
    assert.deepEqual(fs.readdirSync(path.dirname(file)).sort(), ['login-state.json', 'login-state.json.bak'])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('writing: an existing file that is not a storage state is kept as .bak and replaced, and an explicit directory of the user is not re-moded', { skip: !posix }, () => {
  const root = tmp()
  try {
    const dir = path.join(root, 'mine')
    fs.mkdirSync(dir, { mode: 0o755 })
    fs.chmodSync(dir, 0o755)
    const file = path.join(dir, 's.json')
    fs.writeFileSync(file, 'this is not json')
    const r = saveLoginState({ file, fresh: { cookies: [], origins: [] }, domains: [], ownDir: false })
    assert.match(r.note, /^replaced \(the old file was not a storage state/)
    assert.equal(fs.readFileSync(file + '.bak', 'utf8'), 'this is not json')
    assert.equal(mode(dir), 0o755, 'a directory that already existed and is not ours keeps its mode')
    assert.equal(mode(file), 0o600)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('the script itself refuses before any browser is started: inside a git work tree without --force, an unknown platform, a stray flag', { skip: !posix }, async () => {
  const { execFile } = await import('node:child_process')
  const script = new URL('../scripts/save-login.mjs', import.meta.url).pathname
  const run = (args: string[], cwd: string): Promise<{ code: number; stderr: string; stdout: string }> => new Promise(resolve => {
    execFile(process.execPath, [script, ...args], { cwd, timeout: 20_000, env: { PATH: '/usr/bin:/bin', HOME: os.tmpdir() } }, (error, stdout, stderr) => resolve({ code: (error as { code?: number } | null)?.code ?? 0, stdout, stderr }))
  })
  const repo = tmp()
  try {
    fs.mkdirSync(path.join(repo, '.git'))
    const inTree = await run(['zhihu', 'login-state.json'], repo)
    assert.equal(inTree.code, 1)
    assert.match(inTree.stderr, /拒绝写入 .*login-state\.json：它在 git 工作区 .* 里/)
    assert.match(inTree.stderr, /--force/)
    assert.equal(fs.existsSync(path.join(repo, 'login-state.json')), false)
    assert.match((await run(['myspace'], repo)).stderr, /未知平台 myspace/)
    assert.match((await run(['--nope'], repo)).stderr, /未知参数 --nope/)
    assert.match((await run(['--help'], repo)).stdout, /node scripts\/save-login\.mjs \[platform\] \[output\.json\] \[--force\]/)
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})
