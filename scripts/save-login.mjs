/**
 * save-login.mjs — 登录一次，把浏览器登录态保存为 Playwright storageState JSON。
 *
 * 用法（在插件包目录内）：
 *   node scripts/save-login.mjs [platform] [output.json]
 *   例：node scripts/save-login.mjs zhihu login-state.json
 *   例：node scripts/save-login.mjs all login-state.json   # 依次登录所有平台，合并到一个文件
 *
 * 会打开一个可见浏览器窗口；请在窗口里完成登录（扫码/账号密码），回到终端按回车，
 * 再继续下一个平台。结束后把输出文件声明为 dsh-browser 的命名
 * AuthProfile，并通过 web-search-pro.browserBindings 绑定到平台。
 */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const LOGIN_PAGES = {
  zhihu: 'https://www.zhihu.com/signin',
  weibo: 'https://weibo.com/login.php',
  douban: 'https://accounts.douban.com/passport/login',
  tieba: 'https://tieba.baidu.com',
  douyin: 'https://www.douyin.com',
  kuaishou: 'https://www.kuaishou.com',
  xiaohongshu: 'https://www.xiaohongshu.com',
}

function globalNpmRoot() {
  try { return execFileSync('npm', ['root', '-g'], { encoding: 'utf8', windowsHide: true }).trim() }
  catch { return path.join(process.env.APPDATA || '', 'npm', 'node_modules') }
}

function resolvePlaywright() {
  const local = createRequire(import.meta.url)
  try {
    const browserPackage = local.resolve('@anweat/dsh-browser/package.json')
    return createRequire(browserPackage)('playwright')
  } catch { /* compatibility fallbacks below */ }
  const anchors = [
    'playwright/package.json',
    path.join(globalNpmRoot(), 'playwright', 'package.json'),
  ]
  for (const anchor of anchors) {
    try { return createRequire(anchor)('playwright') } catch { /* next */ }
  }
  throw new Error('未找到 Playwright。请先安装 @anweat/dsh-browser，并调用 browser_install 安装 Chromium。')
}

function waitForEnter(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question + ' ', () => { rl.close(); resolve() })
  })
}

async function main() {
  const which = process.argv[2] || 'all'
  const out = path.resolve(process.argv[3] || 'login-state.json')
  const { chromium } = resolvePlaywright()
  const configuredChannel = String(process.env.DSH_BROWSER_CHANNEL || '').trim()
  const launchOptions = { headless: false }
  if (configuredChannel && configuredChannel !== 'chromium') launchOptions.channel = configuredChannel
  const browser = await chromium.launch(launchOptions)
  const context = await browser.newContext()
  const platforms = which === 'all' ? Object.keys(LOGIN_PAGES) : [which]
  for (const p of platforms) {
    if (!LOGIN_PAGES[p]) { console.error('未知平台 ' + p + '，可选: ' + Object.keys(LOGIN_PAGES).join(', ')); process.exit(1) }
    const page = await context.newPage()
    await page.goto(LOGIN_PAGES[p], { waitUntil: 'domcontentloaded', timeout: 60000 })
    console.log('请在浏览器里完成「' + p + '」登录，登录成功后回到终端……')
    await waitForEnter('按回车继续下一个平台：')
    await page.close()
  }
  const state = await context.storageState()
  fs.writeFileSync(out, JSON.stringify(state, null, 2), 'utf8')
  console.log('已保存登录态到 ' + out)
  console.log('请在 dsh-browser 的 authProfiles 中引用该绝对路径：')
  console.log('  storageStatePath: ' + out)
  console.log('并通过 web-search-pro.browserBindings 为目标平台绑定该 AuthProfile。')
  await browser.close()
}

main().catch((e) => { console.error(String(e)); process.exit(1) })
