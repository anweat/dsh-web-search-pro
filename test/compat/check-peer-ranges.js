#!/usr/bin/env node
/**
 * 断言 package.json 里所有受管 peer 范围在**两种解析模式**下都成立：
 *
 *   runtime —— DSH 组装期校验：semver.satisfies(host, range, { includePrerelease: true })
 *              （@deepseek-ai/dsh-app-boot 的 plugin-compatibility.ts，0.1.7-rc.2 与 0.2.0-rc.2 同）
 *   install —— npm/pnpm 解析 peer：**默认** semver。预发布版本只有在某个比较符
 *              自带同号（同 major.minor.patch）预发布时才被判为满足。
 *
 * 只满足前者、不满足后者，在用户机器上表现为 `dsh plugin add` 报 ERESOLVE，
 * 而 DSH 自己的组装日志看起来是正常的 —— 所以这里两个都查。
 *
 * 用法：
 *   node test/compat/check-peer-ranges.js                    # 检查本仓库：受支持基线必须通过，已放弃/未验证的版本必须被拒绝
 *   node test/compat/check-peer-ranges.js 0.2.0-rc.2         # 只检查指定宿主版本（必须通过）
 *   node test/compat/check-peer-ranges.js --selftest         # 自校验（含本文档引用的行为矩阵）
 *   node test/compat/check-peer-ranges.js --json             # 机器可读输出
 *
 * 本脚本自带最小 semver 实现（插件仓库没有 semver 依赖，也不该为了这个检查新增依赖）：
 * 只支持本仓库 peer 范围实际用到的写法（^ / ~ / >= / > / <= / < / =、`||` 分组、空格并列），
 * 以及 semver 的预发布优先级与上面那条“同号预发布”规则。
 * 与 anweat/dsh-browser 0.2.0 的 test/compat/check-peer-ranges.js 同一套策略：只有 0.2.0-rc.2 这一条基线。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// ── 最小 semver ────────────────────────────────────────────────────────────────
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:[0-9A-Za-z-]+)(?:\.(?:[0-9A-Za-z-]+))*))?(?:\+[0-9A-Za-z.-]+)?$/

function parse(version) {
  const m = VERSION_RE.exec(String(version).trim())
  if (m === null) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] === undefined ? [] : m[4].split('.'),
  }
}

const isNumeric = (id) => /^(0|[1-9]\d*)$/.test(id)

function compareIdentifiers(a, b) {
  if (isNumeric(a) && isNumeric(b)) return Number(a) - Number(b)
  if (isNumeric(a)) return -1
  if (isNumeric(b)) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** semver 优先级比较（含预发布规则）：a<b → 负数。 */
function compare(a, b) {
  const x = typeof a === 'string' ? parse(a) : a
  const y = typeof b === 'string' ? parse(b) : b
  for (const field of ['major', 'minor', 'patch']) {
    if (x[field] !== y[field]) return x[field] < y[field] ? -1 : 1
  }
  if (x.prerelease.length === 0 && y.prerelease.length === 0) return 0
  if (x.prerelease.length === 0) return 1 // 正式版 > 预发布
  if (y.prerelease.length === 0) return -1
  const len = Math.max(x.prerelease.length, y.prerelease.length)
  for (let i = 0; i < len; i += 1) {
    const left = x.prerelease[i]
    const right = y.prerelease[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    const diff = compareIdentifiers(left, right)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}

const bump = (version, field) => {
  const next = { ...version, prerelease: [] }
  next[field] += 1
  if (field === 'major') { next.minor = 0; next.patch = 0 }
  if (field === 'minor') next.patch = 0
  return next
}

/** 一个比较符 → 一个 { op, version }；`-0` 上界按 semver 原样保留。 */
function parseComparator(raw) {
  const text = raw.trim()
  const m = /^(>=|<=|>|<|\^|~|=)?\s*(.+)$/.exec(text)
  if (m === null) return null
  const op = m[1] ?? '='
  const version = parse(m[2])
  if (version === null) return null
  return { op, version, raw: text }
}

/** semver 的脱糖：^ / ~ 展开成不等式；其余原样。 */
function expand(comparator) {
  const { op, version } = comparator
  if (op === '^') {
    const upper = version.major > 0
      ? { ...parse(`${version.major + 1}.0.0`), prerelease: ['0'] }
      : version.minor > 0
        ? { ...parse(`0.${version.minor + 1}.0`), prerelease: ['0'] }
        : { ...parse(`0.0.${version.patch + 1}`), prerelease: ['0'] }
    return [
      { op: '>=', version },
      { op: '<', version: upper },
    ]
  }
  if (op === '~') {
    const upper = version.minor === undefined
      ? bump(version, 'major')
      : { ...bump(version, 'minor'), prerelease: ['0'] }
    return [{ op: '>=', version }, { op: '<', version: upper }]
  }
  return [comparator]
}

function testComparator(version, comparator) {
  const diff = compare(version, comparator.version)
  switch (comparator.op) {
    case '>=': return diff >= 0
    case '>': return diff > 0
    case '<=': return diff <= 0
    case '<': return diff < 0
    case '=':
    default: return diff === 0
  }
}

const sameTuple = (a, b) => a.major === b.major && a.minor === b.minor && a.patch === b.patch

/**
 * @param {string} version 待判定的宿主版本
 * @param {string} range   peer 范围
 * @param {{ includePrerelease?: boolean }} [options]
 */
function satisfies(version, range, options = {}) {
  const target = parse(version)
  if (target === null) throw new Error(`不是合法版本：${version}`)
  const hasPrerelease = target.prerelease.length > 0
  const includePrerelease = options.includePrerelease === true

  return String(range)
    .split('||')
    .some((group) => {
      const comparators = group
        .split(/\s+/)
        .filter((part) => part.length > 0)
        .map(parseComparator)
        .filter((comparator) => comparator !== null)
        .flatMap(expand)
      if (comparators.length === 0) return false
      if (!comparators.every((comparator) => testComparator(target, comparator))) return false
      // 默认解析：预发布版本必须命中“同号且带预发布”的比较符，否则视为不满足。
      if (!hasPrerelease || includePrerelease) return true
      return comparators.some((c) => c.version.prerelease.length > 0 && sameTuple(c.version, target))
    })
}

// ── 策略与检查 ────────────────────────────────────────────────────────────────
/** 本仓库声明支持、并已在真实 profile 上跑过的 DSH 基线：只有这一条线。 */
const SUPPORTED_BASELINES = ['0.2.0-rc.2']
/**
 * 必须被拒绝的宿主版本（runtime 与 install 两种模式都不能满足）：
 * 已放弃的旧线、功能未在其上验证过的前一个预发布、以及不放行的下一个次版本的预发布。
 */
const REJECTED_BASELINES = ['0.1.7-rc.2', '0.2.0-rc.1', '0.2.1-alpha.1']
/** 用于说明范围宽窄的代表性版本（只做展示，不影响退出码）。 */
const MATRIX_VERSIONS = [
  '0.1.7-rc.2', '0.1.8', '0.2.0-alpha.1', '0.2.0-rc.1', '0.2.0-rc.2', '0.2.0-rc.3', '0.2.0',
  '0.2.1-alpha.1', '0.2.1', '0.3.0-rc.1',
]

const gatedPeers = (manifest) =>
  Object.entries(manifest.peerDependencies ?? {})
    .filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))

function evaluate(manifest, version) {
  return gatedPeers(manifest).map(([name, range]) => ({
    name,
    range,
    runtime: satisfies(version, range, { includePrerelease: true }),
    install: satisfies(version, range),
  }))
}

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

function selftest() {
  const pinned = '>=0.2.0-rc.2 <0.2.1-0'
  const looseCaret = '^0.2.0-rc.2'
  const wide = '>=0.2.0-rc.2 <0.3.0'
  const foreignLower = '>=0.1.7-rc.2 <0.2.1-0'
  const cases = [
    // range, version, runtime, install —— 期望值与真实 semver 7（npm/pnpm 默认解析、includePrerelease 解析）实测一致
    [pinned, '0.1.7-rc.2', false, false],     // 已放弃的旧线
    [pinned, '0.1.8', false, false],
    [pinned, '0.2.0-alpha.1', false, false],
    [pinned, '0.2.0-rc.1', false, false],     // 新功能没有在 rc.1 宿主上验证过
    [pinned, '0.2.0-rc.2', true, true],       // 受支持基线；`>=0.2.0-rc.2` 这个比较符自带同号预发布，是承重的
    [pinned, '0.2.0-rc.3', true, true],
    [pinned, '0.2.0', true, true],
    [pinned, '0.2.1-alpha.1', false, false],  // 上界是 <0.2.1-0，不是 <0.2.1：连 0.2.1 的预发布也挡掉
    [pinned, '0.2.1', false, false],          // cap 生效：未实测的 0.2.1 不声称兼容
    [pinned, '0.3.0-rc.1', false, false],
    [looseCaret, '0.2.1', true, true],        // ^0.2.0-rc.2 把未实测的 0.2.1 也算兼容
    [looseCaret, '0.3.0-rc.1', false, false], // ^ 的上界是 <0.3.0-0
    [wide, '0.2.0-rc.2', true, true],
    [wide, '0.3.0-rc.1', true, false],        // 手写 <0.3.0 挡不住 0.3.0-rc.1（宿主放行）
    [foreignLower, '0.2.0-rc.2', true, false], // 下界写成别条线的预发布：宿主校验放行、npm 拒绝（install 毒药）
  ]
  let failed = 0
  for (const [range, version, runtime, install] of cases) {
    const gotRuntime = satisfies(version, range, { includePrerelease: true })
    const gotInstall = satisfies(version, range)
    const ok = gotRuntime === runtime && gotInstall === install
    if (!ok) failed += 1
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${version.padEnd(14)} ${range}` +
      ` → runtime ${gotRuntime ? 'accept' : 'reject'} / install ${gotInstall ? 'accept' : 'reject'}`)
  }
  if (failed > 0) {
    console.error(`\n  自校验失败 ${failed} 条：最小 semver 实现与已知行为不符，先修实现。`)
    process.exit(1)
  }
  console.log(`\n  自校验通过（${cases.length} 条已知行为）`)
}

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, ''))
  process.exit(0)
}
if (argv.includes('--selftest')) {
  selftest()
  process.exit(0)
}

const json = argv.includes('--json')
const versions = argv.filter((arg) => !arg.startsWith('-'))
const targets = versions.length > 0 ? versions : SUPPORTED_BASELINES
const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
const gated = gatedPeers(manifest)

if (gated.length === 0) {
  console.error('  没有找到受管的 @deepseek-ai/dsh-* peer，检查是否在插件仓库根目录运行。')
  process.exit(1)
}

let bad = 0
const report = { package: manifest.name, version: manifest.version, checks: [] }
for (const version of targets) {
  const rows = evaluate(manifest, version)
  report.checks.push({ version, peers: rows })
  for (const row of rows) {
    if (!row.runtime) {
      console.error(`  FAIL(runtime) ${version}  ${row.name} "${row.range}" 连宿主校验都不满足`)
      bad += 1
    } else if (!row.install) {
      console.error(`  FAIL(install) ${version}  ${row.name} "${row.range}" 过宿主校验但 npm 会拒绝（ERESOLVE）`)
      bad += 1
    }
  }
  if (!json && rows.every((row) => row.runtime && row.install)) {
    const ranges = [...new Set(rows.map((row) => row.range))]
    console.log(`  ${rows.length} 个 dsh peer 在 ${version} 上两种模式均通过  ${ranges.join(' / ')}`)
  }
}

// 默认运行时，已放弃 / 未验证的版本必须被拒绝：任一 peer 在任一模式下放行，都说明范围比支持声明宽。
const rejected = versions.length > 0 ? [] : REJECTED_BASELINES
for (const version of rejected) {
  const rows = evaluate(manifest, version)
  report.checks.push({ version, expected: 'reject', peers: rows })
  for (const row of rows) {
    if (row.runtime || row.install) {
      console.error(`  FAIL(accepts) ${version}  ${row.name} "${row.range}" 不应放行（runtime ${row.runtime ? 'accept' : 'reject'} / install ${row.install ? 'accept' : 'reject'}）`)
      bad += 1
    }
  }
  if (!json) console.log(`  ${rows.length} 个 dsh peer 在 ${version} 上两种模式均拒绝（符合预期）`)
}

if (!json && targets.includes('0.2.0-rc.2')) {
  const ranges = [...new Set(gated.map(([, range]) => range))]
  const capped = ranges.every((range) => /<0\.2\.1-0/.test(range))
  console.log('\n  代表性宿主版本（runtime / install）：')
  const header = '    ' + 'range'.padEnd(44) + MATRIX_VERSIONS.map((v) => v.padEnd(14)).join('')
  console.log(header)
  for (const range of ranges) {
    const cells = MATRIX_VERSIONS.map((version) => {
      const runtime = satisfies(version, range, { includePrerelease: true })
      const install = satisfies(version, range)
      return `${runtime ? 'rt+' : 'rt-'}/${install ? 'npm+' : 'npm-'}`.padEnd(14)
    })
    console.log('    ' + range.padEnd(44) + cells.join(''))
  }
  if (!capped) {
    console.log('\n  提示：上界未收口（缺少 <0.2.1-0）。0.2.x 后续版本一旦破坏，会在用户机器上表现为')
    console.log('        组装日志正常、`dsh plugin add` ERESOLVE —— 加 cap 可让问题在组装期点名报错。')
  }
}

if (json) console.log(JSON.stringify(report, null, 2))
if (bad > 0) {
  console.error(`\n  ${bad} 处 peer 与支持声明不符（受支持版本不可用，或不受支持的版本被放行）。预发布宿主必须用“显式点出该线”的范围，`)
  console.error('  例如 >=0.2.0-rc.2 <0.2.1-0；比较符的同号预发布是承重的，只满足 runtime 的范围是 install 毒药。')
  process.exit(1)
}
console.log(`\n  peer 范围检查通过（基线：${targets.join(', ')}${rejected.length > 0 ? `；拒绝：${rejected.join(', ')}` : ''}）`)
