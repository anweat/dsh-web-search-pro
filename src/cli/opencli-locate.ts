/**
 * Finding the standalone `opencli` launcher (and a Node that can run it) when it is not on the PATH of the process. A desktop
 * host often starts with a PATH that holds an fnm per-shell directory (which disappears with the shell that made it) or only
 * `/usr/bin:/bin`, while the user installed OpenCLI with `npm i -g` under a version manager. After PATH has failed, the usual
 * global install places are looked at, the same ones dsh-browser's `locateOpencli` knows (the DSH_BROWSER_OPENCLI override,
 * Homebrew, ~/.npm-global, nvm, fnm, Volta, the Windows npm dir); the plugin-local copies and `npm root -g` (a spawn) are not.
 *
 * The launcher is a `#!/usr/bin/env node` script (a `.cmd` shim on Windows), so a launcher found outside PATH comes with the
 * directories to put in front of the child's PATH: its own bin directory (a version manager keeps `node` there), and, when that
 * has no node, the directory of one that was found. Pure: the machine (platform, environment, home, file system) is injected.
 * @module web-search-pro/cli/opencli-locate
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Everything the resolver reads from the machine, so a test can describe a machine instead of owning one. */
export interface LocateMachine {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: string
  /** A regular file (a launcher that can be run). */
  isFile(file: string): boolean
  /** The names in a directory; empty when it cannot be read. */
  readdir(dir: string): string[]
  /** `process.execPath`: used as the node when it is one (an Electron host's is not). */
  execPath?: string
}

export type OpencliSource = 'override' | 'path' | 'fallback'

export interface OpencliLocation {
  /** The launcher to run. */
  path: string
  source: OpencliSource
  /** Directories to put in front of the child's PATH so its `env node` finds a node; empty when the launcher came from PATH. */
  pathPrefix: string[]
}

export interface OpencliLookup {
  location?: OpencliLocation
  /** An override that does not lead to a launcher (never silently replaced by another copy). */
  problem?: string
}

const winOf = (platform: NodeJS.Platform): boolean => platform === 'win32'
const pathOf = (platform: NodeJS.Platform): path.PlatformPath => (winOf(platform) ? path.win32 : path.posix)
const delimiterOf = (platform: NodeJS.Platform): string => (winOf(platform) ? ';' : ':')

/** The machine this process runs on. */
export function realMachine(env: NodeJS.ProcessEnv = process.env): LocateMachine {
  const win = process.platform === 'win32'
  return {
    platform: process.platform,
    env,
    home: env.HOME ?? env.USERPROFILE ?? os.homedir(),
    isFile: file => { try { const stat = fs.statSync(file); return stat.isFile() && (win || (stat.mode & 0o111) !== 0) } catch { return false } },
    readdir: dir => { try { return fs.readdirSync(dir) } catch { return [] } },
    execPath: process.execPath,
  }
}

/** Names a launcher goes by: `opencli` on Unix, the npm shims on Windows (in PATHEXT order). */
function launcherNames(machine: LocateMachine): string[] {
  if (!winOf(machine.platform)) return ['opencli']
  const exts = (machine.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map(e => e.trim().toLowerCase()).filter(e => e && e !== '.com')
  return [...new Set(['.cmd', '.exe', ...exts.filter(e => e === '.bat')])].map(ext => 'opencli' + ext)
}

function pathDirs(machine: LocateMachine): string[] {
  const raw = machine.env.PATH ?? machine.env.Path ?? machine.env.path ?? ''
  return raw.split(delimiterOf(machine.platform)).map(dir => dir.trim().replace(/^"|"$/g, '')).filter(Boolean)
}

/** Version-directory names (`v22.11.0`, `22.11.0`), newest first, numerically. */
export function newestFirst(names: readonly string[]): string[] {
  const key = (name: string): number[] => (/\d+(?:\.\d+)*/.exec(name)?.[0] ?? '0').split('.').map(Number)
  return [...names].sort((a, b) => {
    const x = key(a)
    const y = key(b)
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (y[i] ?? 0) - (x[i] ?? 0); if (d !== 0) return d }
    return a < b ? 1 : a > b ? -1 : 0
  })
}

/**
 * The directories a global `npm i -g` may have put a launcher in, most specific first: the npm prefix of the environment,
 * Homebrew and the usual user prefixes, then every Node of the version managers (nvm, fnm), newest first, then Volta and Bun.
 */
export function fallbackBinDirs(machine: LocateMachine): string[] {
  const p = pathOf(machine.platform)
  const { env, home } = machine
  const out: string[] = []
  const prefix = env.npm_config_prefix ?? env.NPM_CONFIG_PREFIX
  if (winOf(machine.platform)) {
    // npm puts its shims straight into the prefix on Windows.
    if (prefix) out.push(prefix)
    out.push(env.APPDATA ? p.join(env.APPDATA, 'npm') : p.join(home, 'AppData', 'Roaming', 'npm'))
    return out
  }
  if (prefix) out.push(p.join(prefix, 'bin'))
  // WSP_OPENCLI_SYSTEM_BINS replaces the two system directories (a test seam: the suite must not meet an opencli of the machine it runs on).
  out.push(...(env.WSP_OPENCLI_SYSTEM_BINS ?? '/opt/homebrew/bin:/usr/local/bin').split(':').filter(Boolean), p.join(home, '.npm-global', 'bin'), p.join(home, '.local', 'bin'))
  const managers = [
    p.join(env.NVM_DIR ?? p.join(home, '.nvm'), 'versions', 'node'),
    ...[env.FNM_DIR, p.join(home, '.local', 'share', 'fnm'), p.join(home, 'Library', 'Application Support', 'fnm'), p.join(home, '.fnm')].filter((dir): dir is string => !!dir).map(dir => p.join(dir, 'node-versions')),
  ]
  for (const base of managers) {
    for (const version of newestFirst(machine.readdir(base))) out.push(p.join(base, version, 'bin'), p.join(base, version, 'installation', 'bin'))
  }
  out.push(p.join(env.VOLTA_HOME ?? p.join(home, '.volta'), 'bin'), p.join(env.BUN_INSTALL ?? p.join(home, '.bun'), 'bin'))
  return [...new Set(out)]
}

function firstLauncherIn(dirs: readonly string[], machine: LocateMachine): string | undefined {
  const p = pathOf(machine.platform)
  for (const dir of dirs) for (const name of launcherNames(machine)) {
    const file = p.join(dir, name)
    if (machine.isFile(file)) return file
  }
  return undefined
}

/** The launcher an override names: the launcher itself, or the package directory / `main.js` of a global npm install (the launcher sits beside `lib` or `node_modules`). */
function launcherOfOverride(target: string, machine: LocateMachine): string | undefined {
  const p = pathOf(machine.platform)
  const normal = p.normalize(target.trim().replace(/^"|"$/g, ''))
  const parts = normal.split(p.sep)
  if (/^opencli(\.(cmd|exe|bat))?$/i.test(p.basename(normal)) && parts[parts.length - 2] !== '@jackwener') return machine.isFile(normal) ? normal : undefined
  const at = parts.findIndex((part, index) => part === 'opencli' && parts[index - 1] === '@jackwener')
  if (at < 2) return undefined
  const modules = parts.slice(0, at - 1).join(p.sep) || p.sep
  if (p.basename(modules) !== 'node_modules') return undefined
  const root = p.dirname(modules)
  const prefix = p.basename(root) === 'lib' ? p.dirname(root) : root
  return firstLauncherIn(p.basename(root) === 'lib' ? [p.join(prefix, 'bin')] : [prefix], machine)
}

/** The node for a launcher outside PATH: the launcher's own directory, an execPath that is node, one on PATH, one in the fallback places. */
function nodeDirs(launcherDir: string, machine: LocateMachine): string[] {
  const p = pathOf(machine.platform)
  const nodeName = winOf(machine.platform) ? 'node.exe' : 'node'
  if (machine.isFile(p.join(launcherDir, nodeName))) return [launcherDir]
  if (machine.execPath && /(?:^|[\\/])node(?:\.exe)?$/i.test(machine.execPath) && machine.isFile(machine.execPath)) return [launcherDir, p.dirname(machine.execPath)]
  const elsewhere = [...pathDirs(machine), ...fallbackBinDirs(machine)].find(dir => machine.isFile(p.join(dir, nodeName)))
  return elsewhere ? [launcherDir, elsewhere] : [launcherDir]
}

/**
 * Find the standalone OpenCLI: the `DSH_BROWSER_OPENCLI` override when it is set (it either leads to a launcher or is a
 * problem; another copy is never used instead), else PATH, else the usual global install places.
 */
export function locateOpencliBin(machine: LocateMachine): OpencliLookup {
  const p = pathOf(machine.platform)
  const override = machine.env.DSH_BROWSER_OPENCLI?.trim()
  const outside = (file: string, source: OpencliSource): OpencliLocation => ({ path: file, source, pathPrefix: nodeDirs(p.dirname(file), machine) })
  if (override) {
    const file = launcherOfOverride(override, machine)
    return file
      ? { location: outside(file, 'override') }
      : { problem: 'DSH_BROWSER_OPENCLI=' + override + ' does not lead to an opencli launcher (give the `opencli` launcher, or the package directory or main.js of a global npm install): fix or unset it' }
  }
  const onPath = firstLauncherIn(pathDirs(machine), machine)
  if (onPath) return { location: { path: onPath, source: 'path', pathPrefix: [] } }
  const elsewhere = firstLauncherIn(fallbackBinDirs(machine), machine)
  return elsewhere ? { location: outside(elsewhere, 'fallback') } : {}
}

/** `env` with `dirs` in front of its PATH (a copy; the key is always `PATH`, which is what the clean environment of a CLI run uses). */
export function withPathPrefix(env: Record<string, string>, dirs: readonly string[] | undefined, platform: NodeJS.Platform = process.platform): Record<string, string> {
  if (!dirs?.length) return env
  const current = env.PATH ?? env.Path ?? ''
  const rest = current.split(delimiterOf(platform)).filter(dir => dir && !dirs.includes(dir))
  const { Path: _path, ...others } = env
  return { ...others, PATH: [...dirs, ...rest].join(delimiterOf(platform)) }
}
