/**
 * External dependency detection and install for the CLI/platform backends.
 * Most backends shell out to tools installed outside DSH (bili, yt-dlp,
 * opencli, agent-reach, playwright, mcporter). This module reports which are
 * present and how to install them; the web_deps tool exposes it to the model.
 *
 * Install is intentionally a MODEL-FACING TOOL, not a browser settings button:
 * a browser button running winget/pip/npm would be arbitrary command execution
 * without a permission gate, whereas a tool flows through DSH's existing
 * tool-permission/approval pipeline. The card points at this tool instead.
 * @module web-search-pro/deps
 */

import { runCli } from './util.ts'

export interface DepInfo {
  id: string
  label: string
  /** Backend that needs it. */
  usedBy: string
  available: boolean
  path?: string
  installs: { installer: string; command: string }[]
}

const IS_WIN = process.platform === 'win32'

/** One external tool the plugin may shell out to. */
const DEPS: Omit<DepInfo, 'available' | 'path'>[] = [
  {
    id: 'bili', label: 'bili-cli', usedBy: 'bilibili 后端',
    installs: [
      { installer: 'uv', command: 'uv tool install bili-cli' },
      { installer: 'pipx', command: 'pipx install bili-cli' },
      { installer: 'pip', command: 'pip install bili-cli' },
    ],
  },
  {
    id: 'yt-dlp', label: 'yt-dlp', usedBy: 'youtube 后端',
    installs: [
      { installer: 'uv', command: 'uv tool install yt-dlp' },
      { installer: 'pip', command: 'pip install yt-dlp' },
    ],
  },
  {
    id: 'agent-reach', label: 'Agent-Reach', usedBy: 'agent-reach 后端',
    installs: [
      { installer: 'uv', command: 'uv tool install agent-reach' },
      { installer: 'pip', command: 'pip install agent-reach' },
    ],
  },
  {
    id: 'mcporter', label: 'mcporter', usedBy: 'Exa MCP fallback',
    installs: [
      { installer: 'npm', command: 'npm i -g mcporter' },
    ],
  },
  // opencli and playwright are NOT listed here: they are bundled (plugin-local
  // node_modules, with global reuse fallback) in the dsh-browser plugin, which
  // this plugin injects via the `browser` service.
]

/** Resolve a command on PATH (win32: where.exe; posix: sh -c command -v). */
async function resolveCmd(cmd: string): Promise<{ found: boolean; path?: string }> {
  const res = await runCli(
    IS_WIN ? 'where' : 'sh',
    IS_WIN ? [cmd] : ['-c', 'command -v ' + cmd],
    { timeoutMs: 8_000, signal: undefined, maxOutput: 64 * 1024 },
  )
  if (res.code !== 0) return { found: false }
  const first = res.stdout.split(/\r?\n/).find(line => line.trim().length > 0)
  return first ? { found: true, path: first.trim() } : { found: false }
}

/** Detect all backends. */
export async function detectDeps(): Promise<DepInfo[]> {
  const out: DepInfo[] = []
  for (const dep of DEPS) {
    const resolved = await resolveCmd(dep.id)
    out.push({ ...dep, available: resolved.found, ...resolved.path ? { path: resolved.path } : {} })
  }
  return out
}

/** Run the install command for one backend + installer. */
export async function installDep(id: string, installer: string): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  const dep = DEPS.find(d => d.id === id)
  if (!dep) throw new Error('unknown dependency: ' + id)
  const target = dep.installs.find(i => i.installer === installer)
  if (!target) throw new Error('unknown installer ' + installer + ' for ' + id + '; try: ' + dep.installs.map(i => i.installer).join(', '))
  return runCompound(target.command, 180_000)
}

async function runCompound(command: string, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  // Split on spaces is fine for these fixed commands; quotes are not used.
  const parts = command.split(' ').filter(Boolean)
  const bin = parts.shift()!
  return runCli(bin, parts, { timeoutMs, signal: undefined, maxOutput: 256 * 1024 })
}

export const DEP_IDS = DEPS.map(d => d.id)
