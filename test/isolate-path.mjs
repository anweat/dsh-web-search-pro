// Preloaded into every test process (`node --import ./test/isolate-path.mjs --test ...`, see package.json `test`).
// The suite runs fake CLIs (bili, twitter, xhs, ...) from temp dirs and must never meet the real tools of the machine
// it runs on: a real `opencli` or `xhs` on PATH would be probed and, in a platform chain, executed with the
// developer's own sessions. Tests that need commands put their own directory in front of this PATH.
// The caller's PATH is kept in WSP_REAL_PATH for the opt-in live tests (test/cli-live.test.ts, WSP_LIVE_CLI=1), which put
// it back around their own calls only.
if (process.platform !== 'win32') {
  process.env.WSP_REAL_PATH ??= process.env.PATH
  process.env.PATH = '/usr/bin:/bin'
}

// The plugin puts its database and the agent overlay under $DSH_HOME when a test does not give a dbPath. A test must never
// open the real home of the person running it, so point the suite at a throw-away one (the live tests may still set their own).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
if (!process.env.WSP_TEST_KEEP_HOME) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-test-home-'))
  process.env.DSH_HOME = home
  process.on('exit', () => { try { fs.rmSync(home, { recursive: true, force: true }) } catch { /* best effort */ } })
}
