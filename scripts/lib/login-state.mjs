/**
 * The pure and file-system parts of scripts/save-login.mjs, split out so they can be tested without a browser: where the login state
 * goes, whether that place is inside a git work tree, how a fresh state is merged into an existing file, and how it is written
 * (directory 0700, file 0600, one `.bak`). Nothing here opens a browser or touches the network.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** The login page of each platform the script knows, and the registrable domains whose cookies and storage belong to it. */
export const SITES = {
  zhihu: { page: 'https://www.zhihu.com/signin', domains: ['zhihu.com'] },
  weibo: { page: 'https://weibo.com/login.php', domains: ['weibo.com', 'weibo.cn'] },
  douban: { page: 'https://accounts.douban.com/passport/login', domains: ['douban.com'] },
  tieba: { page: 'https://tieba.baidu.com', domains: ['baidu.com'] },
  douyin: { page: 'https://www.douyin.com', domains: ['douyin.com'] },
  kuaishou: { page: 'https://www.kuaishou.com', domains: ['kuaishou.com'] },
  xiaohongshu: { page: 'https://www.xiaohongshu.com', domains: ['xiaohongshu.com'] },
}

export const DEFAULT_FILE_NAME = 'login-state.json'

/** dsh-browser's auth directory: `<DSH_HOME or ~/.dsh>/data/browser/auth`. */
export function defaultAuthDir(env = process.env, home = homeOf(env)) {
  const base = env.DSH_HOME && env.DSH_HOME.trim() ? env.DSH_HOME.trim() : path.join(home, '.dsh')
  return path.join(base, 'data', 'browser', 'auth')
}

export function homeOf(env = process.env) {
  return env.HOME || env.USERPROFILE || os.homedir()
}

/**
 * `[platform] [output.json] [--force]`. The output path is optional: an explicit one wins over the default place.
 * Returns `{ error }` for an unknown flag or too many arguments.
 */
export function parseArgs(argv) {
  const positional = []
  let force = false
  let help = false
  for (const arg of argv) {
    if (arg === '--force') force = true
    else if (arg === '--help' || arg === '-h') help = true
    else if (arg.startsWith('--')) return { error: '未知参数 ' + arg + '（可用: --force, --help）' }
    else positional.push(arg)
  }
  if (positional.length > 2) return { error: '参数太多：node scripts/save-login.mjs [platform] [output.json] [--force]' }
  return { which: positional[0] || 'all', out: positional[1], force, help }
}

/** Where the state is written: the explicit path (against the current directory), else the default file in dsh-browser's auth directory. */
export function resolveOutput(explicit, { env = process.env, home = homeOf(env), cwd = process.cwd() } = {}) {
  if (explicit) return { file: path.resolve(cwd, explicit), explicit: true }
  return { file: path.join(defaultAuthDir(env, home), DEFAULT_FILE_NAME), explicit: false }
}

/** The git work tree a file would land in (the nearest ancestor holding `.git`, a directory or a worktree file), or undefined. */
export function gitWorkTreeOf(file, exists = fs.existsSync) {
  let dir = path.dirname(path.resolve(file))
  for (;;) {
    if (exists(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** Whether Playwright's `storageState({ indexedDB: true })` exists (added in 1.51). */
export function supportsIndexedDb(version) {
  const m = /^(\d+)\.(\d+)/.exec(String(version || ''))
  return !!m && (Number(m[1]) > 1 || (Number(m[1]) === 1 && Number(m[2]) >= 51))
}

/** Whether a cookie domain or a host belongs to one of the registrable domains (`.www.zhihu.com` and `zhihu.com` both belong to `zhihu.com`). */
export function belongsTo(host, domains) {
  const h = String(host || '').replace(/^\./, '').toLowerCase()
  return domains.some(d => h === d || h.endsWith('.' + d))
}

const hostOfOrigin = origin => { try { return new URL(origin).hostname } catch { return '' } }

/** A storage state, or undefined for anything that is not one. */
export function asStorageState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (!Array.isArray(value.cookies) || !Array.isArray(value.origins)) return undefined
  return value
}

/**
 * Merge a fresh state into the one on file: the cookies and origins that belong to the sites logged in now (`domains`) are REPLACED
 * by the fresh ones, everything else of the file is kept. A fresh cookie wins over an old one of the same name, domain and path.
 */
export function mergeStorageState(existing, fresh, domains) {
  const old = asStorageState(existing)
  const next = asStorageState(fresh) ?? { cookies: [], origins: [] }
  if (!old) return next
  const keptCookies = old.cookies.filter(c => !belongsTo(c?.domain, domains))
  const keptOrigins = old.origins.filter(o => !belongsTo(hostOfOrigin(o?.origin), domains))
  const cookies = new Map()
  for (const c of [...keptCookies, ...next.cookies]) cookies.set([c.name, c.domain, c.path].join('\u0000'), c)
  const origins = new Map()
  for (const o of [...keptOrigins, ...next.origins]) origins.set(o.origin, o)
  return { ...old, ...next, cookies: [...cookies.values()], origins: [...origins.values()] }
}

/** A file mode (`0o600`) on platforms that have modes; Windows ACLs ignore it. */
function tighten(target, mode) { try { fs.chmodSync(target, mode) } catch { /* not supported here */ } }

/**
 * Write the state: create the directory with mode 0700 (and tighten dsh-browser's own auth directory if it exists), merge into an
 * existing file after keeping ONE `.bak` of it, write the file with mode 0600 through a temporary file in the same directory.
 * Returns what was done. The caller has checked the git rule.
 */
export function saveLoginState({ file, fresh, domains, ownDir }) {
  const dir = path.dirname(file)
  const created = !fs.existsSync(dir)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (created || ownDir) tighten(dir, 0o700)
  let existing
  let note = 'created'
  let unreadable = false
  if (fs.existsSync(file)) {
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { unreadable = true }
    fs.copyFileSync(file, file + '.bak')
    tighten(file + '.bak', 0o600)
    note = unreadable || !asStorageState(existing) ? 'replaced (the old file was not a storage state; it is kept as .bak)' : 'merged'
  }
  const merged = mergeStorageState(existing, fresh, domains)
  const tmp = file + '.tmp-' + process.pid
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), { encoding: 'utf8', mode: 0o600 })
  tighten(tmp, 0o600)
  fs.renameSync(tmp, file)
  tighten(file, 0o600)
  return { file, note, backup: note === 'created' ? undefined : file + '.bak', cookies: merged.cookies.length, origins: merged.origins.length }
}
