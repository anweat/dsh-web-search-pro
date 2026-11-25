// Preloaded into every test process (`node --import ./test/isolate-path.mjs --test ...`, see package.json `test`).
// The suite runs fake CLIs (bili, twitter, xhs, ...) from temp dirs and must never meet the real tools of the machine
// it runs on: a real `opencli` or `xhs` on PATH would be probed and, in a platform chain, executed with the
// developer's own sessions. Tests that need commands put their own directory in front of this PATH.
// The caller's PATH is kept in WSP_REAL_PATH for the opt-in live tests (test/cli-live.test.ts, WSP_LIVE_CLI=1), which put
// it back around their own calls only.
// Windows: the same, with system directories (plus node's own, unless it is a global-package directory) instead of /usr/bin:/bin,
// and APPDATA / LOCALAPPDATA pointed at empty directories below (the npm global directory lives there); see test/isolate-env.mjs.
if (process.platform !== 'win32') {
  process.env.WSP_REAL_PATH ??= process.env.PATH
  process.env.PATH = '/usr/bin:/bin'
}

// The standalone `opencli` is also looked for in the usual global install places under the home directory (Homebrew, nvm, fnm, ...),
// so a test must not see the real home of the machine either: point HOME at an empty throw-away one (tests that need a home set
// their own and restore it). DSH_BROWSER_OPENCLI, the explicit override, is cleared for the same reason.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isolatedPath, nodeShimText } from './isolate-env.mjs'
{
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-test-userhome-'))
  process.env.HOME = fakeHome
  process.env.USERPROFILE = fakeHome
  delete process.env.DSH_BROWSER_OPENCLI
  process.env.WSP_OPENCLI_SYSTEM_BINS = ''
  for (const name of ['npm_config_prefix', 'NPM_CONFIG_PREFIX', 'NVM_DIR', 'FNM_DIR', 'VOLTA_HOME', 'BUN_INSTALL']) delete process.env[name]
  if (process.platform === 'win32') {
    const isolated = isolatedPath({ exists: fs.existsSync })
    if (isolated.realPath !== undefined) process.env.WSP_REAL_PATH ??= isolated.realPath
    let dirs = isolated.path
    if (isolated.nodeDirSkipped) {
      const shimDir = path.join(fakeHome, 'bin')
      fs.mkdirSync(shimDir, { recursive: true })
      fs.writeFileSync(path.join(shimDir, 'node.cmd'), nodeShimText(process.execPath))
      dirs += ';' + shimDir
    }
    process.env.PATH = dirs
    for (const name of ['APPDATA', 'LOCALAPPDATA']) {
      const dir = path.join(fakeHome, name)
      fs.mkdirSync(dir, { recursive: true })
      process.env[name] = dir
    }
  }
  process.on('exit', () => { try { fs.rmSync(fakeHome, { recursive: true, force: true }) } catch { /* best effort */ } })
}

// The plugin puts its database and the agent overlay under $DSH_HOME when a test does not give a dbPath. A test must never
// open the real home of the person running it, so point the suite at a throw-away one (the live tests may still set their own).
if (!process.env.WSP_TEST_KEEP_HOME) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-test-home-'))
  process.env.DSH_HOME = home
  process.on('exit', () => { try { fs.rmSync(home, { recursive: true, force: true }) } catch { /* best effort */ } })
}
