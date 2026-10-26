import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { posix } from './cli-helpers.ts'

const run = promisify(execFile)
const script = new URL('../scripts/cli-login-check.mjs', import.meta.url).pathname

/** The user-run companion script, exercised with fake tools only: PATH is the temp dir plus /usr/bin:/bin, HOME is a temp dir. */
async function runScript(home: string, bin: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; out: string }> {
  const out = path.join(home, 'out')
  try {
    const r = await run(process.execPath, [script, '--yes', '--out', out, ...args], { env: { PATH: bin + path.delimiter + '/usr/bin:/bin', HOME: home, ...env }, timeout: 60_000 })
    return { code: 0, stdout: r.stdout, out }
  } catch (error) {
    const e = error as { code?: number; stdout?: string }
    return { code: e.code ?? 1, stdout: e.stdout ?? '', out }
  }
}

const fake = (dir: string, name: string, body: string): void => { fs.writeFileSync(path.join(dir, name), '#!/bin/sh\n' + body + '\n', { mode: 0o755 }) }
const XHS_OK = '{"ok":true,"schema_version":"1","data":{"items":[{"id":"n1","xsec_token":"SECRETTOKEN123","note_card":{"display_title":"露营装备测评","user":{"nickname":"小王"}}},{"model_type":"hot_query"}]}}'
const xhs = (marker: string): string => `case "$1" in --version) echo "xhs, version 0.6.4";; search) if [ "$2" = "--help" ]; then echo "xhs search KEYWORD --sort --json"; else echo ran > "${marker}"; printf '%s' '${XHS_OK}'; fi;; *) echo "UNEXPECTED $1" >> "${marker}.unexpected";; esac`

test('cli-login-check: without saved logins nothing is searched, and the reasons are the plugin\'s', { skip: !posix }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-login-script-'))
  try {
    fs.mkdirSync(path.join(dir, 'bin')); fs.mkdirSync(path.join(dir, 'home'))
    const marker = path.join(dir, 'ran')
    for (const name of ['xhs', 'zhihu', 'rdt']) fake(path.join(dir, 'bin'), name, name === 'xhs' ? xhs(marker) : `case "$1" in --version) echo "${name} 1.0.0";; search) if [ "$2" = "--help" ]; then echo "Usage: ${name} [x]"; else echo ran > "${marker}.${name}"; fi;; esac`)
    const r = await runScript(path.join(dir, 'home'), path.join(dir, 'bin'), ['--only', 'xhs,rdt,twitter'])
    assert.equal(r.code, 0, r.stdout)
    const summary = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8')) as { results: { id: string; status: string; note: string }[] }
    // xhs is probed (version + help only); no saved login file, so it is not searched; rdt does not match its contract; twitter is not installed.
    assert.deepEqual(summary.results.map(x => [x.id, x.status]), [['xhs', 'needs_login'], ['rdt', 'skipped'], ['twitter', 'skipped']])
    assert.match(summary.results[0]!.note, /no saved login|没有已保存的登录文件/)
    assert.match(summary.results[0]!.note, /xhs login/)
    assert.match(summary.results[0]!.note, /读取浏览器 Cookie/, 'says why it is not run')
    assert.equal(fs.existsSync(marker), false, 'xhs search was never run')
    assert.equal(fs.existsSync(marker + '.rdt'), false)
    assert.equal(fs.existsSync(marker + '.unexpected'), false, 'only --version and search --help were run')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('cli-login-check: with a saved login it runs the spec\'s search once, parses it, flags junk, and redacts the saved output', { skip: !posix }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-login-script-'))
  try {
    fs.mkdirSync(path.join(dir, 'bin')); fs.mkdirSync(path.join(dir, 'home', '.xiaohongshu-cli'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'home', '.xiaohongshu-cli', 'cookies.json'), '{"a1":"x"}')
    const marker = path.join(dir, 'ran')
    fake(path.join(dir, 'bin'), 'xhs', xhs(marker))
    const r = await runScript(path.join(dir, 'home'), path.join(dir, 'bin'), ['--only', 'xhs', '--count', '2'])
    assert.equal(r.code, 0, r.stdout)
    const summary = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8')) as { results: { status: string; resultCount: number; skipped: number; junk: string[]; sample: { url: string }[] }[] }
    const x = summary.results[0]!
    assert.deepEqual([x.status, x.resultCount, x.skipped, x.junk], ['ok', 1, 1, []])
    assert.match(x.sample[0]!.url, /xsec_token=REDACTED/)
    assert.equal(fs.readFileSync(marker, 'utf8').trim(), 'ran')
    const raw = fs.readFileSync(path.join(r.out, 'xhs.stdout.txt'), 'utf8')
    assert.doesNotMatch(raw, /SECRETTOKEN123/)
    assert.doesNotMatch(r.stdout, /SECRETTOKEN123/)
    assert.equal(fs.existsSync(marker + '.unexpected'), false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('cli-login-check: no confirmation, no run; unknown CLIs and opencli sites are refused; the script holds no login command', { skip: !posix }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-login-script-'))
  try {
    fs.mkdirSync(path.join(dir, 'bin')); fs.mkdirSync(path.join(dir, 'home'))
    const noYes = await run(process.execPath, [script, '--only', 'xhs'], { env: { PATH: '/usr/bin:/bin', HOME: path.join(dir, 'home') }, timeout: 30_000 }).then(() => ({ code: 0 }), (e: { code?: number }) => ({ code: e.code ?? 1 }))
    assert.equal(noYes.code, 2, 'a non-interactive run needs --yes')
    assert.equal((await runScript(path.join(dir, 'home'), path.join(dir, 'bin'), ['--only', 'bili'])).code, 2)
    assert.equal((await runScript(path.join(dir, 'home'), path.join(dir, 'bin'), ['--only', 'xhs', '--opencli', 'weixin'])).code, 2)
    const source = fs.readFileSync(script, 'utf8')
    assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//, '').replace(/^\s*\/\/.*$/gm, ''), /['"`](login|logout|post|delete|like|follow|comment|publish)['"`]/, 'no write / login command is ever built here')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
