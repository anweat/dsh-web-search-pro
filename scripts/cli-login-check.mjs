/**
 * cli-login-check.mjs - 登录类 CLI 的一键陪测脚本（由用户本人运行）。
 *
 * 做什么：对 xhs、zhihu、rdt、twitter（以及你点名的独立 opencli 站点）逐个执行
 *   1) 插件自己的契约探测（只跑该工具的 --version 与 `search --help`，不搜索、不登录）；
 *   2) 与插件完全相同的登录闸门：缺少已保存的登录文件 / 缺少 TWITTER_AUTH_TOKEN+TWITTER_CT0 就跳过，
 *      并给出和插件一样的提示——这样不会触发 xhs / rdt 在没有登录文件时自行读取浏览器 Cookie 的行为；
 *   3) 闸门通过才用插件的内置规格（和插件运行时是同一份 argv、同一个解析器）执行一次只读搜索；
 *   4) 打印解析结果摘要，并把原始 stdout/stderr（已脱敏）和 summary.json 存到输出目录。
 *
 * 不做什么：任何登录命令（xhs login / zhihu login / rdt login / opencli ... login）；任何写操作；
 * 不读你的 Cookie 或 Token 内容（只检查登录文件“是否存在”；Token 只通过环境变量交给 twitter 子进程，
 * 保存的原始输出里会被替换）。独立 opencli 会驱动你自己的 Chrome，所以默认不跑，需要 --opencli 点名站点。
 *
 * 用法（在插件包目录内；需要先 `pnpm build`，或使用已发布的包）：
 *   node scripts/cli-login-check.mjs [--only xhs,zhihu,rdt,twitter] [--count 3] [--out DIR]
 *                                    [--opencli xiaohongshu,twitter,reddit,zhihu] [--query-<id> "词"] [--yes]
 *   例：node scripts/cli-login-check.mjs --only xhs --yes
 *   例：TWITTER_AUTH_TOKEN=... TWITTER_CT0=... node scripts/cli-login-check.mjs --only twitter --yes
 *
 * 退出码：0 = 脚本跑完（无论各 CLI 是否通过，结果看摘要）；2 = 参数错误或用户未确认。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { pathToFileURL } from 'node:url'

const lib = rel => import(pathToFileURL(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'lib', rel)).href)

let modules
try {
  const [{ builtinSpecById }, probe, runner, spec, opencli, util] = await Promise.all([
    lib('cli/builtin-specs.js'), lib('cli/probe.js'), lib('cli/runner.js'), lib('cli/spec.js'), lib('cli/opencli.js'), lib('util.js'),
  ])
  modules = { builtinSpecById, ...probe, ...runner, ...spec, ...opencli, runCli: util.runCli }
} catch (error) {
  console.error('找不到插件的构建产物 lib/（先在包目录运行 `pnpm build`）：' + (error instanceof Error ? error.message : String(error)))
  process.exit(2)
}
const {
  builtinSpecById, probeCli, savedLoginPresent, missingEnv, loginHint, runCliSearchDetailed, searchSpecFor, listOpencliSites, planOpencliSearch, OPENCLI_PROBE, runCli,
} = modules

// ── 参数 ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const flag = name => args.includes('--' + name)
const value = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined }
if (flag('help') || flag('h')) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0] + '*/'); process.exit(0) }

const ALL = ['xhs', 'zhihu', 'rdt', 'twitter']
const only = (value('only') ?? ALL.join(',')).split(',').map(s => s.trim()).filter(Boolean)
const unknown = only.filter(id => !ALL.includes(id))
if (unknown.length) { console.error('未知的 CLI：' + unknown.join(', ') + '（可选：' + ALL.join(', ') + '）'); process.exit(2) }
const count = Math.min(Math.max(Number(value('count') ?? 3) || 3, 1), 10)
const opencliSites = (value('opencli') ?? '').split(',').map(s => s.trim()).filter(Boolean)
const OPENCLI_PLATFORMS = ['xiaohongshu', 'twitter', 'reddit', 'zhihu']
const badSites = opencliSites.filter(site => !OPENCLI_PLATFORMS.includes(site))
if (badSites.length) { console.error('--opencli 只接受：' + OPENCLI_PLATFORMS.join(', ')); process.exit(2) }

/** 每个 CLI 的默认查询：中文平台用中文，其余用英文。可用 --query-xhs "词" 覆盖。 */
const DEFAULT_QUERY = { xhs: '露营装备测评', zhihu: '大模型 备案', rdt: 'rust async runtime', twitter: 'DeepSeek Harness' }
const PLATFORM_OF = { xhs: 'xiaohongshu', zhihu: 'zhihu', rdt: 'reddit', twitter: 'twitter' }
const queryOf = id => value('query-' + id) ?? DEFAULT_QUERY[id]

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outDir = path.resolve(value('out') ?? path.join(process.cwd(), 'cli-login-check-' + stamp))

// ── 确认 ────────────────────────────────────────────────────────────────────

function plan() {
  const lines = ['将要执行（全部只读；不会运行任何登录命令）：']
  for (const id of only) {
    const s = builtinSpecById(id)
    lines.push('  - ' + id + '：' + [s.bins[0], ...searchSpecFor(s, s.platforms[0]).argv].join(' ').replace('{query}', JSON.stringify(queryOf(id))).replace('{count}', String(count)))
  }
  for (const site of opencliSites) lines.push('  - opencli（驱动你自己的 Chrome）：opencli ' + site + ' search <查询> -f json')
  lines.push('输出目录：' + outDir)
  return lines.join('\n')
}

async function confirm() {
  console.log(plan())
  if (flag('yes')) return true
  if (!process.stdin.isTTY) { console.error('非交互环境：请加 --yes 确认。'); return false }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise(resolve => rl.question('继续？[y/N] ', resolve))
  rl.close()
  return /^y(es)?$/i.test(String(answer).trim())
}

// ── 脱敏与摘要 ──────────────────────────────────────────────────────────────

const SECRET_KEY = /(cookie|token|secret|session|auth|password|a1|z_c0|d_c0|ct0)/i

/** 把原始输出里敏感键的值、已知环境变量的值和 xsec_token 参数替换掉，再写盘。 */
function redact(text, env) {
  let out = text
  for (const name of ['TWITTER_AUTH_TOKEN', 'TWITTER_CT0']) { const v = env[name]; if (v && v.length >= 6) out = out.split(v).join('[redacted]') }
  out = out.replace(/("(?:[^"\\]|\\.)*")(\s*:\s*)"((?:[^"\\]|\\.)*)"/g, (m, key, colon, val) => (SECRET_KEY.test(key) && val.length > 6 && !/^https?:/.test(val) ? key + colon + '"[redacted]"' : m))
  return out.replace(/(xsec_token=)[^&"\s]+/g, '$1REDACTED')
}

const short = (text, n = 90) => { const t = String(text ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }

/** 一眼能看出的垃圾：字段名当标题、占位符文本、重复链接、非 http 链接。 */
function junkChecks(sources) {
  const problems = []
  const seen = new Set()
  for (const s of sources) {
    if (!/^https?:\/\//.test(s.url)) problems.push('非 http(s) 链接：' + short(s.url))
    if (seen.has(s.url)) problems.push('重复链接：' + short(s.url))
    seen.add(s.url)
    if (!s.title || !s.title.trim()) problems.push('空标题：' + short(s.url))
    else if (/^[A-Za-z_][\w.-]*:$/.test(s.title)) problems.push('标题是字段名：' + s.title)
    for (const field of ['title', 'snippet']) if (/(^|[|·] )(NA|None|null|undefined)( |$)/.test(s[field] ?? '')) problems.push(field + ' 含占位符：' + short(s[field]))
    if (s.publishedAt !== undefined && Number.isNaN(Date.parse(s.publishedAt))) problems.push('publishedAt 不是日期：' + s.publishedAt)
  }
  return problems
}

// ── 单个 CLI ────────────────────────────────────────────────────────────────

async function checkOne(label, spec, platform, query, runOptions = {}) {
  const row = { id: label, platform, query, status: 'skipped', note: '' }
  const t0 = Date.now()
  const probe = await probeCli(spec, { force: true })
  row.probe = { state: probe.state, version: probe.version, path: probe.path, reason: probe.reason }
  console.log('\n=== ' + label + '（平台 ' + platform + '）')
  console.log('  探测：' + probe.state + (probe.version ? ' ' + probe.version : '') + (probe.path ? ' @ ' + probe.path : '') + (probe.reason ? ' - ' + probe.reason : ''))
  if (probe.state !== 'detected') { row.note = probe.state === 'missing' ? '未安装：' + spec.packageNote : '已安装但契约不符：' + (probe.reason ?? ''); console.log('  跳过：' + row.note); return row }

  // 与插件一致的登录闸门（runCliSearchDetailed 内部会再检查一遍，这里只是先给出明确说明）。
  const missing = missingEnv(spec)
  if (missing.length) { row.note = '缺少环境变量 ' + missing.join(' / ') + '；' + loginHint(spec); row.status = 'needs_login'; console.log('  跳过（未登录）：' + row.note); return row }
  if (savedLoginPresent(spec) === false) {
    row.note = '没有已保存的登录文件（' + (spec.login?.savedCredentialPaths ?? []).join(', ') + '）；' + loginHint(spec) + (spec.login?.readsBrowserCookiesWithoutLogin ? '。没有登录文件时该工具会自己读取浏览器 Cookie，所以脚本不运行它' : '')
    row.status = 'needs_login'; console.log('  跳过（未登录）：' + row.note); return row
  }

  const base = path.join(outDir, label.replace(/[^\w.-]/g, '_'))
  const argv = searchSpecFor(spec, platform).argv
  console.log('  执行：' + [probe.path ?? spec.bins[0], ...argv].join(' ').replace('{query}', JSON.stringify(query)).replace('{count}', String(count)))
  let raw
  const capture = async (bin, runArgs, opts) => { raw = await runCli(bin, runArgs, opts); return raw }
  try {
    const { sources, skipped } = await runCliSearchDetailed(spec, { query, count }, { platform, bin: probe.path, run: capture, ...runOptions })
    row.status = 'ok'
    row.resultCount = sources.length
    row.skipped = skipped
    row.sample = sources.slice(0, 3).map(s => ({ ...s, url: redact(s.url, process.env) }))
    row.junk = junkChecks(sources)
    row.withPublishedAt = sources.filter(s => s.publishedAt).length
    row.withSnippet = sources.filter(s => s.snippet).length
    console.log('  结果：' + sources.length + ' 条（请求 ' + count + '；无链接被跳过 ' + skipped + '；带时间 ' + row.withPublishedAt + '；带摘要 ' + row.withSnippet + '）')
    row.sample.forEach((s, i) => console.log('   ' + (i + 1) + '. ' + short(s.title, 70) + '  ' + short(s.url, 80) + (s.publishedAt ? '  [' + s.publishedAt + ']' : '')))
    console.log('  自动检查：' + (row.junk.length ? '发现问题 ' + row.junk.length + ' 个' : '未发现垃圾行') )
    row.junk.forEach(p => console.log('   ! ' + p))
  } catch (error) {
    row.status = 'error'
    row.code = error?.code
    row.note = (error instanceof Error ? error.message : String(error))
    row.hint = error?.hint
    console.log('  失败：[' + (row.code ?? 'error') + '] ' + short(row.note, 300) + (row.hint ? '\n  提示：' + row.hint : ''))
    if (raw) console.log('  工具原话（脱敏，前 240 字符）：' + short(redact(raw.stderr.trim() || raw.stdout.trim(), process.env), 240))
  }
  row.ms = Date.now() - t0
  if (raw) {
    fs.mkdirSync(outDir, { recursive: true })
    const env = process.env
    fs.writeFileSync(base + '.stdout.txt', redact(raw.stdout, env))
    fs.writeFileSync(base + '.stderr.txt', redact(raw.stderr, env))
    row.raw = { exit: raw.code, timedOut: !!raw.timedOut, stdout: base + '.stdout.txt', stderr: base + '.stderr.txt', stdoutBytes: raw.stdout.length }
    console.log('  原始输出（已脱敏）：' + row.raw.stdout + '（exit ' + raw.code + '，' + raw.stdout.length + ' 字符）')
  }
  return row
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

if (!(await confirm())) { console.error('已取消，没有运行任何东西。'); process.exit(2) }
fs.mkdirSync(outDir, { recursive: true })

console.log('\n主机：' + os.platform() + ' ' + os.release() + '，Node ' + process.version + '；HOME=' + os.homedir())
const rows = []
for (const id of only) rows.push(await checkOne(id, builtinSpecById(id), PLATFORM_OF[id], queryOf(id)))

if (opencliSites.length) {
  const probe = await probeCli(OPENCLI_PROBE, { force: true })
  console.log('\n=== opencli（独立）：' + probe.state + (probe.version ? ' ' + probe.version : '') + (probe.reason ? ' - ' + probe.reason : ''))
  if (probe.state === 'detected') {
    await listOpencliSites({ force: true })
    for (const site of opencliSites) {
      // 与插件完全相同的计划：命令表里的 search 条目、是否带后台窗口 / 临时会话 / 不保留标签页参数、生成的规格。
      const plan = await planOpencliSearch(site, site)
      if (!plan.spec) { rows.push({ id: 'opencli:' + site, platform: site, status: 'skipped', note: plan.problem ?? '生成的规格无效' }); console.log('  ' + site + '：跳过 - ' + rows.at(-1).note); continue }
      const spec = plan.spec
      console.log('  ' + site + '：' + (plan.silent ? '带 --window background --site-session ephemeral --keep-tab false（不抢焦点，用完关标签页）' : '该命令不支持后台窗口参数，按默认方式运行'))
      // 登录态在 Chrome 里，无法本地检查；这里就是用户点名要跑的那一次。
      rows.push(await checkOne('opencli:' + site, { ...spec, probe: OPENCLI_PROBE.probe }, site, DEFAULT_QUERY[Object.keys(PLATFORM_OF).find(k => PLATFORM_OF[k] === site)] ?? 'DeepSeek', { skipCredentialGate: true }))
    }
  } else {
    for (const site of opencliSites) rows.push({ id: 'opencli:' + site, platform: site, status: 'skipped', note: probe.reason ?? 'opencli 不可用' })
  }
}

const summary = { date: new Date().toISOString(), node: process.version, platform: os.platform(), count, results: rows }
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log('\n──────── 汇总 ────────')
for (const r of rows) console.log(r.id.padEnd(18) + r.status.padEnd(12) + (r.status === 'ok' ? r.resultCount + ' 条' + (r.junk?.length ? '，有 ' + r.junk.length + ' 个问题' : '') : short(r.note, 70)))
console.log('\n完整结果：' + path.join(outDir, 'summary.json'))
console.log('把上面的汇总和 summary.json（以及对应的 *.stdout.txt）发给我即可；里面没有 Cookie / Token。')
