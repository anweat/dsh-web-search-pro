// Preloaded into every test process (`node --import ./test/isolate-path.mjs`, see package.json `test`).
// The suite runs fake CLIs (bili, twitter, xhs, ...) from temp dirs and must never meet the real tools of the machine
// it runs on: a real `opencli` or `xhs` on PATH would be probed and, in a platform chain, executed with the
// developer's own sessions. Tests that need commands put their own directory in front of this PATH.
if (process.platform !== 'win32') process.env.PATH = '/usr/bin:/bin'
