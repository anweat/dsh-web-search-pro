/**
 * save-login.mjs — 登录一次，把浏览器登录态保存为 Playwright storageState JSON。
 *
 * 用法（在插件包目录内）：
 *   node scripts/save-login.mjs [platform] [output.json]
 *   例：node scripts/save-login.mjs zhihu login-state.json
 *   例：node scripts/save-login.mjs all login-state.json   # 依次登录所有平台，合并到一个文件
 *
 * 会打开一个可见浏览器窗口；请在窗口里完成登录（扫码/账号密码），回到终端按回车，
 * 再继续下一个平台。结束后把输出文件路径填到 settings.yaml：
 *   playwright.storageStatePath: 'login-state.json'
 * 之后 web_platform_search 的中文社区平台（zhihu/weibo/douban/tieba/douyin/kuaishou）
 * 就会复用这份登录态驱动搜索结果页。
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
  const anchors = [
    path.join(globalNpmRoot(), 'playwright', 'package.json'),
    'playwright/package.json',
  ]
  for (const anchor of anchors) {
    try { return createRequire(anchor)('playwright') } catch { /* next */ }
  }
  throw new Error('未找到 playwright，先运行：npm i -g playwright && playwright install chromium')
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
  const browser = await chromium.launch({ headless: false, channel: 'msedge' })
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
  console.log('在 $DSH_HOME/settings.yaml 里设置：')
  console.log('  playwright.storageStatePath: ' + out)
  await browser.close()
}

main().catch((e) => { console.error(String(e)); process.exit(1) })
