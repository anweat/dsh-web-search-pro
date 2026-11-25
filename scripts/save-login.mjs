/**
 * save-login.mjs — 登录一次，把浏览器登录态保存为 Playwright storageState JSON。
 *
 * 用法（在插件包目录内）：
 *   node scripts/save-login.mjs [platform] [output.json] [--force]
 *   例：node scripts/save-login.mjs zhihu
 *   例：node scripts/save-login.mjs all          # 依次登录所有平台
 *
 * 默认输出：<DSH_HOME 或 ~/.dsh>/data/browser/auth/login-state.json（dsh-browser 的 auth 目录，目录 0700、文件 0600）。
 * 显式给出 output.json 时以它为准。输出位置在 git 工作区里会被拒绝（登录态等于账号权限，不能进仓库），确实要写加 --force。
 * 目标文件已存在时合并：只替换这次登录的站点的 cookie / origin，其余保留；旧文件留一份 .bak。
 *
 * 会打开一个可见浏览器窗口；请在窗口里完成登录（扫码/账号密码），回到终端按回车，
 * 再继续下一个平台。结束后把输出文件声明为 dsh-browser 的命名
 * AuthProfile，并通过 web-search-pro.browserBindings 绑定到平台。
 */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'
import {
  gitWorkTreeOf, parseArgs, resolveOutput, saveLoginState, SITES, supportsIndexedDb, withoutSites,
} from './lib/login-state.mjs'


function globalNpmRoot() {
  try { return execFileSync('npm', ['root', '-g'], { encoding: 'utf8', windowsHide: true }).trim() }
  catch { return path.join(process.env.APPDATA || '', 'npm', 'node_modules') }
}

/** The Playwright module a require resolves, with its version (the `indexedDB` option of storageState needs 1.51). */
function withVersion(req) {
  const playwright = req('playwright')
  let version = ''
  try { version = req('playwright/package.json').version } catch { /* the version stays unknown: no indexedDB */ }
  return { playwright, version }
}

function resolvePlaywright() {
  const local = createRequire(import.meta.url)
  try {
    const browserPackage = local.resolve('@anweat/dsh-browser/package.json')
    return withVersion(createRequire(browserPackage))
  } catch { /* compatibility fallbacks below */ }
  const anchors = [
    'playwright/package.json',
    path.join(globalNpmRoot(), 'playwright', 'package.json'),
  ]
  for (const anchor of anchors) {
    try { return withVersion(createRequire(anchor)) } catch { /* next */ }
  }
  throw new Error('未找到 Playwright。请先安装 @anweat/dsh-browser，并调用 browser_install 安装 Chromium。')
}

function waitForEnter(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question + ' ', (answer) => { rl.close(); resolve(answer.trim().toLowerCase()) })
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.error) { console.error(args.error); process.exit(1) }
  if (args.help) { console.log('node scripts/save-login.mjs [platform] [output.json] [--force]\n平台: all, ' + Object.keys(SITES).join(', ')); return }
  const platforms = args.which === 'all' ? Object.keys(SITES) : [args.which]
  const unknown = platforms.find(p => !SITES[p])
  if (unknown) { console.error('未知平台 ' + unknown + '，可选: ' + Object.keys(SITES).join(', ')); process.exit(1) }

  const target = resolveOutput(args.out)
  const tree = gitWorkTreeOf(target.file)
  if (tree && !args.force) {
    console.error('拒绝写入 ' + target.file + '：它在 git 工作区 ' + tree + ' 里。登录态等于账号权限，不能放进仓库。')
    console.error('不指定输出路径会写到 dsh-browser 的 auth 目录；确实要写在这里，加 --force。')
    process.exit(1)
  }

  const { playwright, version } = resolvePlaywright()
  const configuredChannel = String(process.env.DSH_BROWSER_CHANNEL || '').trim()
  const launchOptions = { headless: false }
  if (configuredChannel && configuredChannel !== 'chromium') launchOptions.channel = configuredChannel
  const browser = await playwright.chromium.launch(launchOptions)
  const context = await browser.newContext()
  const done = []
  for (const p of platforms) {
    const page = await context.newPage()
    await page.goto(SITES[p].page, { waitUntil: 'domcontentloaded', timeout: 60000 })
    console.log('请在浏览器里完成「' + p + '」登录，登录成功后回到终端……')
    if (await waitForEnter('登录好了按回车；不登录这个平台就输入 s 再按回车：') !== 's') done.push(p)
    await page.close()
  }
  if (!done.length) { console.log('没有登录任何平台，没有写文件。'); await browser.close(); return }
  const skipped = platforms.filter(p => !done.includes(p)).flatMap(p => SITES[p].domains)
  // IndexedDB holds the login of some sites; only Playwright 1.51+ can export it.
  const fresh = withoutSites(await context.storageState(supportsIndexedDb(version) ? { indexedDB: true } : undefined), skipped)
  const saved = saveLoginState({ file: target.file, fresh, domains: done.flatMap(p => SITES[p].domains), ownDir: !target.explicit })
  console.log('已保存登录态到 ' + saved.file + '（' + saved.note + '；' + saved.cookies + ' 个 cookie，' + saved.origins + ' 个 origin' + (supportsIndexedDb(version) ? '，含 IndexedDB' : '，当前 Playwright 不支持导出 IndexedDB') + '）')
  if (saved.backup) console.log('旧文件备份在 ' + saved.backup)
  console.log('请在 dsh-browser 的 authProfiles 中引用该绝对路径：')
  console.log('  storageStatePath: ' + saved.file)
  console.log('并通过 web-search-pro.browserBindings 为目标平台绑定该 AuthProfile。')
  await browser.close()
}

main().catch((e) => { console.error(String(e)); process.exit(1) })
