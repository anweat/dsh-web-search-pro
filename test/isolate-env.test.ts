import test from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error a plain .mjs module without declarations
import { envGet, isolatedPath, nodeShimText } from './isolate-env.mjs'

const NODE = 'C:\\Program Files\\nodejs\\node.exe'
const winEnv = { SystemRoot: 'C:\\Windows', Path: 'C:\\Users\\me\\AppData\\Roaming\\npm;C:\\Program Files\\nodejs;C:\\Windows\\System32' }
const entries = (p: string): string[] => p.split(';')

test('POSIX keeps /usr/bin:/bin and hands the caller\'s PATH on', () => {
  const r = isolatedPath({ platform: 'linux', env: { PATH: '/opt/x/bin:/usr/bin' }, execPath: '/opt/node/bin/node' })
  assert.deepEqual(r, { path: '/usr/bin:/bin', realPath: '/opt/x/bin:/usr/bin', delimiter: ':', nodeDirSkipped: false })
  assert.equal(isolatedPath({ platform: 'darwin', env: {} }).realPath, undefined)
})

test('win32: system directories plus the directory of node, nothing of the caller\'s PATH', () => {
  const r = isolatedPath({ platform: 'win32', env: winEnv, execPath: NODE, exists: () => false })
  assert.deepEqual(entries(r.path), [
    'C:\\Windows\\System32', 'C:\\Windows', 'C:\\Windows\\System32\\Wbem', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0', 'C:\\Program Files\\nodejs',
  ])
  assert.equal(r.realPath, winEnv.Path, 'the caller\'s PATH is kept for the live tests (the variable is called Path)')
  assert.equal(r.delimiter, ';')
  assert.equal(r.nodeDirSkipped, false)
  assert.ok(!/AppData|npm/i.test(r.path), 'no npm global directory')
})

test('win32: the variable names are found whatever their case, in a plain copy of the environment too', () => {
  assert.equal(envGet({ PATH: 'a' }, 'Path'), 'a')
  assert.equal(envGet({ sYsTeMrOoT: 'D:\\Win' }, 'SystemRoot'), 'D:\\Win')
  const r = isolatedPath({ platform: 'win32', env: { SYSTEMROOT: 'D:\\Win', PATH: 'x;y' }, execPath: NODE })
  assert.equal(entries(r.path)[0], 'D:\\Win\\System32')
  assert.equal(r.realPath, 'x;y')
})

test('win32: without SystemRoot (and windir) the standard Windows directory is used', () => {
  const r = isolatedPath({ platform: 'win32', env: {}, execPath: NODE })
  assert.equal(entries(r.path)[0], 'C:\\Windows\\System32')
  assert.equal(r.realPath, undefined)
  assert.equal(isolatedPath({ platform: 'win32', env: { windir: 'E:\\W' }, execPath: NODE }).path.startsWith('E:\\W\\System32;'), true)
})

test('win32: a node directory that holds opencli.cmd (custom npm prefix) is left out and the caller is told to shim node', () => {
  const prefix = 'C:\\tools\\node'
  for (const shim of ['opencli.cmd', 'opencli', 'opencli.ps1', 'xhs.cmd']) {
    const exists = (p: string) => p === prefix + '\\' + shim
    const r = isolatedPath({ platform: 'win32', env: winEnv, execPath: prefix + '\\node.exe', exists })
    assert.ok(!entries(r.path).includes(prefix), shim)
    assert.ok(!r.path.includes('tools'), shim + ': nothing of that directory remains')
    assert.equal(r.nodeDirSkipped, true, shim)
  }
  assert.match(nodeShimText(prefix + '\\node.exe'), /"C:\\tools\\node\\node\.exe" %\*/)
})

test('win32: the result never contains an npm global directory, whatever the caller\'s PATH and APPDATA hold', () => {
  const env = { SystemRoot: 'C:\\Windows', APPDATA: 'C:\\Users\\me\\AppData\\Roaming', Path: 'C:\\Users\\me\\AppData\\Roaming\\npm;C:\\Users\\me\\.npm-global;C:\\tools\\node' }
  for (const execPath of [NODE, 'C:\\tools\\node\\node.exe', 'C:\\Windows\\System32\\node.exe']) {
    const r = isolatedPath({ platform: 'win32', env, execPath, exists: p => p === 'C:\\tools\\node\\opencli.cmd' })
    assert.ok(!/npm|AppData|tools/i.test(r.path), execPath + ' -> ' + r.path)
    assert.equal(new Set(entries(r.path).map(d => d.toLowerCase())).size, entries(r.path).length, 'no duplicates')
  }
})
