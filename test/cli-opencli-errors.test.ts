import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { opencliSearchSpec, parseOpencliList } from '../src/cli/opencli.ts'
import { parseFailurePayload, runCliSearch, type CliRunOptions } from '../src/cli/runner.ts'
import { validateCliAdapterSpec } from '../src/cli/spec.ts'
import type { CliResult } from '../src/util.ts'

const dir = new URL('./fixtures/cli/', import.meta.url)
const read = (name: string): string => fs.readFileSync(new URL(name, dir), 'utf8')
const sites = parseOpencliList(read('opencli-list.json'))
const spec = (site: string) => opencliSearchSpec(site, sites.get(site)!, { silent: true })!
const NOTICE = '\n  Update available: v1.8.8 → v2.0.2\n  Run: npm install -g @jackwener/opencli\n'

/** What `opencli <site> search` did: exit code, stdout, stderr. */
const failing = (code: number, stderr: string, stdout = ''): CliRunOptions => ({ run: async (): Promise<CliResult> => ({ code, stdout, stderr, timedOut: false }) })
const outcome = async (site: string, options: CliRunOptions): Promise<any> => {
  try { return { sources: await runCliSearch(spec(site), { query: 'q', count: 3 }, { platform: site, skipCredentialGate: true, ...options }) } } catch (error) { return { error } }
}

test('the generated opencli spec is valid, reads the failure format of the tool, and hints at the user\'s own Chrome instead of a login command', () => {
  for (const site of ['xiaohongshu', 'reddit', 'twitter', 'zhihu']) {
    const s = spec(site)
    assert.deepEqual(validateCliAdapterSpec(s, 'builtin').errors, [], site)
    assert.equal(s.search.errorCodes!.codePath, 'error.code')
    assert.equal(s.login!.command, undefined, 'no login command is ever suggested for opencli')
  }
  assert.equal(spec('xiaohongshu').login!.hint, '在你的 Chrome 里登录 www.xiaohongshu.com 后重试（opencli 使用 Chrome 的登录态）')
  assert.equal(spec('twitter').login!.hint, '在你的 Chrome 里登录 x.com 后重试（opencli 使用 Chrome 的登录态）')
  // A site that needs no login has none.
  assert.equal(opencliSearchSpec('hackernews', sites.get('hackernews')!)!.login, undefined)
})

test('AUTH_REQUIRED (exit 77, measured on xiaohongshu) is CLI_NOT_LOGGED_IN with a hint to log in in your own Chrome, not to run a login command', async () => {
  const r = await outcome('xiaohongshu', failing(77, read('live-opencli-xiaohongshu-auth-required.yaml')))
  assert.equal(r.error.code, 'CLI_NOT_LOGGED_IN')
  assert.equal(r.error.message, 'opencli is not logged in: Xiaohongshu search results are blocked behind a login wall')
  assert.equal(r.error.hint, '在你的 Chrome 里登录 www.xiaohongshu.com 后重试（opencli 使用 Chrome 的登录态）')
  assert.doesNotMatch(r.error.hint + r.error.message, /login yourself|opencli xiaohongshu login/)
  assert.equal(r.error.retryable, false)
  // The update notice that opencli prints around the payload does not matter, and neither does the stream it is on.
  assert.equal((await outcome('xiaohongshu', failing(77, NOTICE + '\n' + read('live-opencli-xiaohongshu-auth-required.yaml') + NOTICE))).error.code, 'CLI_NOT_LOGGED_IN')
  assert.equal((await outcome('xiaohongshu', failing(77, '', read('live-opencli-xiaohongshu-auth-required.yaml')))).error.code, 'CLI_NOT_LOGGED_IN')
  // Exit 77 with no readable payload is still a missing login.
  assert.equal((await outcome('zhihu', failing(77, 'something went wrong'))).error.code, 'CLI_NOT_LOGGED_IN')
})

test('a web page where JSON was expected (measured on reddit through a proxy) says so: blocked, IP, risk control or login wall - not a bare CLI_FAILED', async () => {
  const r = await outcome('reddit', failing(1, read('live-opencli-reddit-html-error.yaml')))
  assert.equal(r.error.code, 'CLI_FAILED')
  assert.match(r.error.message, /^opencli: the site returned a web page instead of data, or blocked the request \(站点返回了网页而不是数据，可能是风控、IP 被拦或需要登录\); UNKNOWN: SyntaxError: Unexpected token '<'/)
  assert.match(r.error.hint, /proxied or shared IP address is often blocked/)
  assert.notEqual(r.error.code, 'CLI_NOT_LOGGED_IN', 'it cannot tell a login wall from a block, and does not claim to')
  // The tool's own LOGIN_WALL / SECURITY_BLOCK codes get the same words.
  const wall = ['ok: false', 'error:', '  code: LOGIN_WALL', '  message: Server returned HTML instead of JSON (status=403).', '  exitCode: 77'].join('\n')
  assert.match((await outcome('reddit', failing(77, wall))).error.message, /web page instead of data.*LOGIN_WALL: Server returned HTML/)
  const security = ['ok: false', 'error:', '  code: SECURITY_BLOCK', '  message: Xiaohongshu search was blocked by request-frequency or security controls.', '  exitCode: 1'].join('\n')
  assert.match((await outcome('xiaohongshu', failing(1, security))).error.message, /blocked the request.*SECURITY_BLOCK/)
  // HTML that arrives as the output of a successful run.
  const page = await outcome('reddit', { run: async () => ({ code: 0, stdout: '<!DOCTYPE html><html><body>blocked</body></html>', stderr: '', timedOut: false }) })
  assert.equal(page.error.code, 'CLI_FAILED')
  assert.match(page.error.message, /opencli: the site returned a web page instead of data.*it printed a web page \(HTML\)/)
  const plain = await outcome('zhihu', { run: async () => ({ code: 0, stdout: 'not json at all', stderr: '', timedOut: false }) })
  assert.equal(plain.error.code, 'CLI_CONTRACT_MISMATCH', 'other garbage stays a contract mismatch')
})

test('the other opencli codes: empty, no browser, timeout, bad arguments; unknown codes keep the tool\'s own words', async () => {
  const payload = (code: string, message: string, exitCode: number): string => ['ok: false', 'error:', '  code: ' + code, '  message: ' + message, '  exitCode: ' + exitCode].join('\n')
  const empty = await outcome('xiaohongshu', failing(66, payload('EMPTY_RESULT', 'xiaohongshu search returned no data', 66)))
  assert.deepEqual([empty.error.code, empty.error.retryable], ['ENGINE_EMPTY', false])
  const bridge = await outcome('twitter', failing(69, payload('BROWSER_CONNECT', 'Browser Bridge extension not connected', 69)))
  assert.equal(bridge.error.code, 'CLI_FAILED')
  assert.match(bridge.error.message, /opencli could not reach its browser: Browser Bridge extension not connected/)
  assert.match(bridge.error.hint, /OpenCLI Browser Bridge in your own Chrome/)
  assert.equal(bridge.error.retryable, false)
  const slow = await outcome('zhihu', failing(75, payload('TIMEOUT', 'zhihu search timed out after 30s', 75)))
  assert.deepEqual([slow.error.code, slow.error.retryable], ['ENGINE_TIMEOUT', true])
  const args = await outcome('twitter', failing(2, payload('ARGUMENT', '--limit must be a positive integer', 2)))
  assert.equal(args.error.code, 'CLI_CONTRACT_MISMATCH')
  const other = await outcome('zhihu', failing(1, payload('COMMAND_EXEC', 'Zhihu search request failed (HTTP 500)', 1)))
  assert.equal(other.error.code, 'CLI_FAILED')
  assert.equal(other.error.message, 'opencli search failed: [COMMAND_EXEC] Zhihu search request failed (HTTP 500)')
  // A failure with no readable payload keeps the generic wording.
  assert.match((await outcome('zhihu', failing(1, 'boom'))).error.message, /^opencli search failed: boom/)
})

test('parseFailurePayload: JSON or a YAML document, after or before notices, never a success payload', () => {
  assert.deepEqual(parseFailurePayload('{"ok":false,"error":{"code":"X"}}'), { ok: false, error: { code: 'X' } })
  assert.deepEqual(parseFailurePayload(NOTICE + 'ok: false\nerror:\n  code: A\n  exitCode: 1\n\n' + NOTICE), { ok: false, error: { code: 'A', exitCode: 1 } })
  assert.equal(parseFailurePayload('ok: true\ndata: []'), undefined)
  assert.equal(parseFailurePayload(''), undefined)
  assert.equal(parseFailurePayload('{broken'), undefined)
})
