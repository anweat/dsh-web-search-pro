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
