// The platform-dependent part of test/isolate-path.mjs, as pure functions (environment, platform and file-system probe are injected)
// so it can be unit-tested on every platform. Importing this file has no side effects.
import path from 'node:path'

/** A variable of a plain env object, case-insensitively (process.env is case-insensitive on Windows, a copy of it is not). */
export function envGet(env, name) {
  if (env[name] !== undefined) return env[name]
  const key = Object.keys(env).find(k => k.toLowerCase() === name.toLowerCase())
  return key === undefined ? undefined : env[key]
}

/** Names of the real tools the suite must never meet; a directory holding one of them is a global-package directory. */
const GLOBAL_TOOLS = ['opencli', 'xhs', 'twitter', 'bili']
const SHIM_EXTENSIONS = ['', '.cmd', '.ps1', '.exe', '.bat']

/**
 * The PATH the test process runs with.
 * - POSIX: `/usr/bin:/bin`, exactly as before.
 * - win32: system directories only (System32, the Windows directory, Wbem, PowerShell's v1.0 directory), plus the directory of
 *   `execPath` so child processes can still find `node`. That directory is left out when it holds a global tool shim (a custom
 *   npm prefix puts `opencli.cmd` next to `node.exe`); `nodeDirSkipped` then tells the caller to provide a `node.cmd` shim elsewhere.
 * `realPath` is the caller's own PATH (the variable is `Path` on Windows), kept for the live tests.
 */
export function isolatedPath({ platform = process.platform, env = process.env, execPath = process.execPath, exists = () => false } = {}) {
  if (platform !== 'win32') return { path: '/usr/bin:/bin', realPath: env.PATH, delimiter: ':', nodeDirSkipped: false }
  const w = path.win32
  const root = envGet(env, 'SystemRoot') || envGet(env, 'windir') || 'C:\\Windows'
  const dirs = [w.join(root, 'System32'), root, w.join(root, 'System32', 'Wbem'), w.join(root, 'System32', 'WindowsPowerShell', 'v1.0')]
  const nodeDir = execPath ? w.dirname(execPath) : ''
  const holdsGlobalTool = !!nodeDir && GLOBAL_TOOLS.some(tool => SHIM_EXTENSIONS.some(ext => exists(w.join(nodeDir, tool + ext))))
  if (nodeDir && !holdsGlobalTool && !dirs.some(d => d.toLowerCase() === nodeDir.toLowerCase())) dirs.push(nodeDir)
  return { path: dirs.join(';'), realPath: envGet(env, 'Path'), delimiter: ';', nodeDirSkipped: holdsGlobalTool }
}

/** The contents of a `node.cmd` that runs the node of this process, for when its own directory is not on the PATH. */
export function nodeShimText(execPath) {
  return '@echo off\r\n"' + execPath + '" %*\r\n'
}
