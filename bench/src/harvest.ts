/**
 * CLI: harvest candidate snapshots for the bench task set.
 *
 *   node --experimental-transform-types bench/src/harvest.ts \
 *     [--tasks id1,id2] [--limit N] [--fetch-top K] [--engines ddg,bing,...] \
 *     [--force] [--summary-only] [--task-set v1|v2] [--tasks-file path] [--out-dir dir]
 *
 * Sequential and polite (see harvest-lib.ts); Ctrl-C aborts in-flight requests
 * and leaves no partial snapshot for the interrupted task.
 * @module bench/harvest
 */

import path from 'node:path'
import fs from 'node:fs'
import { loadTasks, parseTaskSet, taskSetPaths } from './tasks.ts'
import {
  formatSummary, harvestTask, HostGate, readSnapshot, snapshotPath, summarize, writeSnapshot,
  type SnapshotStats,
} from './harvest-lib.ts'

interface Args {
  tasks?: string[]
  limit?: number
  fetchTop: number
  engines?: string[]
  force: boolean
  summaryOnly: boolean
  tasksFile: string
  outDir: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    fetchTop: 4,
    force: false,
    summaryOnly: false,
    tasksFile: taskSetPaths().tasksFile,
    outDir: taskSetPaths().candidatesDir,
  }
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(flag + ' needs a value')
    return v
  }
  // --task-set picks the default task file and output dir; explicit --tasks-file / --out-dir still win.
  let explicitTasksFile = false
  let explicitOutDir = false
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!
    switch (flag) {
      case '--task-set': {
        const paths = taskSetPaths(parseTaskSet(value(i++, flag)))
        if (!explicitTasksFile) args.tasksFile = paths.tasksFile
        if (!explicitOutDir) args.outDir = paths.candidatesDir
        break
      }
      case '--tasks': args.tasks = value(i++, flag).split(',').map(s => s.trim()).filter(Boolean); break
      case '--limit': args.limit = Number(value(i++, flag)); break
      case '--fetch-top': args.fetchTop = Number(value(i++, flag)); break
      case '--engines': args.engines = value(i++, flag).split(',').map(s => s.trim()).filter(Boolean); break
      case '--tasks-file': args.tasksFile = path.resolve(value(i++, flag)); explicitTasksFile = true; break
      case '--out-dir': args.outDir = path.resolve(value(i++, flag)); explicitOutDir = true; break
      case '--force': args.force = true; break
      case '--summary-only': args.summaryOnly = true; break
      default: throw new Error('unknown argument: ' + flag)
    }
  }
  if (args.limit !== undefined && !(args.limit > 0)) throw new Error('--limit must be a positive number')
  if (!Number.isInteger(args.fetchTop) || args.fetchTop < 0) throw new Error('--fetch-top must be a non-negative integer')
  return args
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  let tasks = loadTasks(args.tasksFile)
  if (args.tasks) {
    const known = new Set(tasks.map(t => t.id))
    const unknown = args.tasks.filter(id => !known.has(id))
    if (unknown.length) throw new Error('unknown task ids: ' + unknown.join(', '))
    tasks = args.tasks.map(id => tasks.find(t => t.id === id)!)
  }
  if (args.limit !== undefined) tasks = tasks.slice(0, args.limit)

  if (args.summaryOnly) {
    const stats: SnapshotStats[] = []
    for (const t of tasks) {
      const snap = readSnapshot(args.outDir, t.id)
      if (snap) stats.push(summarize(snap))
    }
    console.log(formatSummary(stats))
    return 0
  }

  // Snapshots must not depend on a personal token (reproducibility, and no keys in this task).
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN

  const controller = new AbortController()
  process.once('SIGINT', () => {
    console.error('\nSIGINT: aborting in-flight requests; the current task will not be saved')
    controller.abort(new Error('interrupted'))
  })
  const gate = new HostGate()
  const ctx = {
    gate,
    signal: controller.signal,
    allowProxyFakeIp: process.env.BENCH_ALLOW_FAKE_IP !== '0',
    log: (line: string): void => console.error(line),
  }

  fs.mkdirSync(args.outDir, { recursive: true })
  const stats: SnapshotStats[] = []
  let done = 0
  for (const task of tasks) {
    const file = snapshotPath(args.outDir, task.id)
    if (!args.force && fs.existsSync(file)) {
      console.error('[skip] ' + task.id + ' (snapshot exists; use --force to redo)')
      const existing = readSnapshot(args.outDir, task.id)
      if (existing) stats.push(summarize(existing))
      continue
    }
    console.error('[' + (++done) + '] ' + task.id + ' ' + task.profile + '/' + task.lang + '  ' + task.query)
    try {
      const snapshot = await harvestTask(task, { fetchTop: args.fetchTop, ...args.engines ? { engines: args.engines } : {} }, ctx)
      writeSnapshot(args.outDir, snapshot)
      stats.push(summarize(snapshot))
    } catch (error) {
      if (controller.signal.aborted) break
      console.error('  FAILED ' + task.id + ': ' + (error as Error).message)
    }
  }
  console.log('\n' + formatSummary(stats))
  return controller.signal.aborted ? 130 : 0
}

main().then(code => { process.exitCode = code }, error => {
  console.error((error as Error).message)
  process.exitCode = 1
})
