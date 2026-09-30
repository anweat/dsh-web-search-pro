/**
 * Run judge experiment groups over labeled tasks (dev-plan §6.3).
 *
 *   node --experimental-transform-types bench/src/run-judges.ts \
 *     [--judges rule,laya,jev] [--with-deepseek] [--tasks id1,id2] \
 *     [--split calibration|test|all] [--groups s4,s6,s1] [--gates single,relevance,constraint,nav] \
 *     [--max-jev-requests 50] [--blocks-per-need 12] [--laya-model multilingual|english|router] \
 *     [--run-id ID] [--max-spend-cny 2] [--min-balance-cny 41] [--effort low|high]
 *
 * S4: candidates at title+snippet level with each gate rubric per judge.
 * S6: (need, block) pairs for fetched pages with score.support.v1 (blocks
 *     pre-ranked lexically per need, like S5 in the plan; same set for every judge).
 * S1 (optional): profile.choice.v1 once per task.
 * Rows go to bench/data/runs/<runId>/results.jsonl; judge calls are cached under
 * bench/data/judge-cache/<judge>/ so reruns never re-bill. Keys come from env
 * (BOCHA_JEV_API_KEY, DEEPSEEK_API_KEY) and are never printed.
 * --with-deepseek is OFF by default: DeepSeek also drafted the labels (leakage).
 * @module bench/run-judges
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listFlag, numberFlag, parseFlags } from './cli.ts'
import {
  candidatesOf, candidateText, CANDIDATES_DIR, fetchedBlocks, JUDGE_CACHE_ROOT, LABELS_DIR, readLabel, readSnapshotFile, RUNS_DIR,
} from './data.ts'
import { BudgetGuard } from './judges/budget.ts'
import { JudgeCache } from './judges/cache.ts'
import { DeepSeekClient, DEEPSEEK_MODEL, EFFORTS, type Effort } from './judges/deepseek-client.ts'
import { DeepSeekJudge } from './judges/deepseek.ts'
import { createJevJudge } from './judges/jev.ts'
import { createLayaJudge, layaJudgeId, type LayaModel } from './judges/laya.ts'
import { weightedOverlap } from '../../src/pipeline/lexical.ts'
import { loadRubrics, renderQuestion } from './judges/rubrics.ts'
import { RuleJudge } from './judges/rule.ts'
import { SystemOneError, type SystemOneJudge } from './judges/systemone.ts'
import {
  BudgetStopError,
  type Judge, type JudgeContext, type JudgeItem, type JudgeQuestion, type JudgeResult,
} from './judges/types.ts'
import { assignSplits, loadTasks } from './tasks.ts'
import type { BenchTask, Split } from './types.ts'

/** Constraint kinds decided by rule only (remote judges are not asked). */
const RULE_ONLY_KINDS = new Set(['site', 'exclude_site'])

export type Group = 's4' | 's6' | 's1'

export interface Job {
  group: Group
  taskId: string
  needId?: string
  constraintId?: string
  state: string
  question: JudgeQuestion
  items: JudgeItem[]
}

export interface ResultRow {
  runId: string
  stage: Group
  judge: string
  model?: string
  rubricId: string
  rubricVersion: string
  taskId: string
  split: Split
  lang: string
  profile: string
  itemId: string
  needId?: string
  constraintId?: string
  kind: string
  prob?: number
  grade?: number
  decision?: string
  probabilities?: Record<string, number>
  latencyMs: number
  requestId?: string
  batchSize?: number
  usage?: { inputTokens: number; outputTokens: number }
  cached?: boolean
  truncated?: boolean
  error?: string
}

export const stateFor = (task: Pick<BenchTask, 'goal'>): string => '搜索任务：' + task.goal

function constraintLine(task: BenchTask): string {
  return task.constraints.length ? task.constraints.map(c => c.kind + '=' + c.value + '(' + c.strength + ')').join('；') : '无'
}

export interface BuildOptions {
  groups: readonly Group[]
  gates: readonly string[]
  blocksPerNeed: number
}

/** Build every judge job for one labeled task (judge independent; constraint jobs are filtered per judge later). */
export function buildJobs(
  task: BenchTask, snapshot: ReturnType<typeof readSnapshotFile> & {}, rubrics: ReturnType<typeof loadRubrics>, opts: BuildOptions,
): Job[] {
  const jobs: Job[] = []
  const state = stateFor(task)
  const needsJoined = task.needs.map(n => n.text).join('；')
  const ctxAll: JudgeContext = { goal: task.goal, query: task.query, needs: task.needs.map(n => n.text), constraints: task.constraints }
  const rubric = (id: string) => { const r = rubrics.get(id); if (!r) throw new Error('missing rubric ' + id); return r }

  if (opts.groups.includes('s4')) {
    const items: JudgeItem[] = candidatesOf(snapshot).map(c => ({
      id: c.url, text: candidateText(c), meta: { url: c.url, title: c.title, ...(c.publishedAt ? { publishedAt: c.publishedAt } : {}) },
    }))
    if (opts.gates.includes('single')) {
      jobs.push({ group: 's4', taskId: task.id, state, items,
        question: renderQuestion(rubric('gate.single.v1'), { need: needsJoined, constraint: constraintLine(task) }, ctxAll) })
    }
    if (opts.gates.includes('relevance')) {
      jobs.push({ group: 's4', taskId: task.id, state, items, question: renderQuestion(rubric('gate.relevance.v1'), { need: needsJoined }, ctxAll) })
    }
    if (opts.gates.includes('constraint')) {
      for (const c of task.constraints) {
        jobs.push({ group: 's4', taskId: task.id, constraintId: c.id, state, items,
          question: renderQuestion(rubric('gate.constraint.v1'), { constraint: c.kind + '：' + c.value + '（' + (c.strength === 'hard' ? '硬约束' : '软偏好') + '）' }, { ...ctxAll, constraint: c }) })
      }
    }
    if (opts.gates.includes('nav')) {
      jobs.push({ group: 's4', taskId: task.id, state, items, question: renderQuestion(rubric('gate.nav.v1'), {}, ctxAll) })
    }
  }

  if (opts.groups.includes('s6')) {
    const blocks = fetchedBlocks(snapshot)
    for (const need of task.needs) {
      const parts = [{ text: need.text, weight: 1.6 }, { text: task.query, weight: 1 }]
      const ranked = blocks
        .map((fb, pos) => ({ fb, pos, s: weightedOverlap(parts, (fb.block.heading ?? '') + '\n' + fb.block.text) }))
        .sort((a, b) => b.s - a.s || a.pos - b.pos)
        .slice(0, opts.blocksPerNeed)
      if (!ranked.length) continue
      const items: JudgeItem[] = ranked.map(({ fb }) => ({
        id: fb.block.blockId,
        text: (fb.block.heading ? fb.block.heading + '\n' : '') + fb.block.text,
        meta: { url: fb.page.url, ...(fb.block.heading ? { heading: fb.block.heading } : {}) },
      }))
      jobs.push({ group: 's6', taskId: task.id, needId: need.id, state, items,
        question: renderQuestion(rubric('score.support.v1'), { need: need.text }, { ...ctxAll, needs: [need.text] }) })
    }
  }
  return jobs
}

export function rowsOf(runId: string, job: Job, task: BenchTask, split: Split, judgeId: string, results: readonly JudgeResult[]): ResultRow[] {
  return results.map(r => ({
    runId, stage: job.group, judge: judgeId, model: r.model, rubricId: r.rubricId, rubricVersion: r.rubricVersion,
    taskId: job.taskId, split, lang: task.lang, profile: task.profile, itemId: r.id,
    needId: job.needId, constraintId: job.constraintId, kind: job.question.kind,
    prob: r.prob, grade: r.grade, decision: r.decision, probabilities: r.probabilities,
    latencyMs: r.latencyMs, requestId: r.requestId, batchSize: r.batchSize, usage: r.usage, cached: r.cached, truncated: r.truncated, error: r.error,
  }))
}

/** Interleave calibration and test tasks so a capped run covers both splits. */
export function interleaveBySplit<T extends { id: string }>(tasks: readonly T[], splits: ReadonlyMap<string, Split>): T[] {
  const cal = tasks.filter(t => splits.get(t.id) === 'calibration')
  const test = tasks.filter(t => splits.get(t.id) === 'test')
  const out: T[] = []
  for (let i = 0; i < Math.max(cal.length, test.length); i++) {
    if (cal[i]) out.push(cal[i]!)
    if (test[i]) out.push(test[i]!)
  }
  return out
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2), {
    values: ['judges', 'tasks', 'split', 'groups', 'gates', 'max-jev-requests', 'blocks-per-need', 'laya-model', 'run-id',
      'max-spend-cny', 'min-balance-cny', 'effort', 'out-dir'],
    booleans: ['with-deepseek'],
  })
  const judgeNames = listFlag(flags, 'judges') ?? ['rule']
  if (flags['with-deepseek'] && !judgeNames.includes('deepseek')) judgeNames.push('deepseek')
  const splitFlag = typeof flags.split === 'string' ? flags.split : 'all'
  if (!['calibration', 'test', 'all'].includes(splitFlag)) throw new Error('--split must be calibration|test|all')
  const groups = (listFlag(flags, 'groups') ?? ['s4', 's6']) as Group[]
  for (const g of groups) if (!['s4', 's6', 's1'].includes(g)) throw new Error('unknown group ' + g)
  const gates = listFlag(flags, 'gates') ?? ['single', 'relevance', 'constraint', 'nav']
  const blocksPerNeed = numberFlag(flags, 'blocks-per-need', 12)
  const maxJev = numberFlag(flags, 'max-jev-requests', 50)
  const layaModel = (typeof flags['laya-model'] === 'string' ? flags['laya-model'] : 'multilingual') as LayaModel
  const effort = typeof flags.effort === 'string' ? flags.effort as Effort : undefined
  if (effort && !EFFORTS.includes(effort)) throw new Error('--effort must be one of ' + EFFORTS.join('|'))
  const runId = typeof flags['run-id'] === 'string' ? flags['run-id'] : new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = typeof flags['out-dir'] === 'string' ? path.resolve(flags['out-dir']) : path.join(RUNS_DIR, runId)

  const allTasks = loadTasks()
  const splits = assignSplits(allTasks)
  let tasks = allTasks
  const only = listFlag(flags, 'tasks')
  if (only) {
    const unknown = only.filter(id => !allTasks.some(t => t.id === id))
    if (unknown.length) throw new Error('unknown task ids: ' + unknown.join(', '))
    tasks = only.map(id => allTasks.find(t => t.id === id)!)
  }
  if (splitFlag !== 'all') tasks = tasks.filter(t => splits.get(t.id) === splitFlag)
  tasks = interleaveBySplit(tasks, splits)

  const labeled = tasks.filter(t => readLabel(LABELS_DIR, t.id) && readSnapshotFile(CANDIDATES_DIR, t.id))
  console.log('tasks selected ' + tasks.length + ', labeled with snapshot ' + labeled.length + '; run ' + runId)
  if (!labeled.length) { console.log('nothing to run'); return 1 }

  const rubrics = loadRubrics()
  const judges: Judge[] = []
  for (const name of judgeNames) {
    const cache = (id: string) => new JudgeCache(JUDGE_CACHE_ROOT, id)
    let judge: Judge
    if (name === 'rule') judge = new RuleJudge()
    else if (name === 'jev') judge = createJevJudge({ requestCap: maxJev, cache: cache('jev') })
    else if (name === 'laya') judge = createLayaJudge({ layaModel, cache: cache(layaJudgeId(layaModel)) })
    else if (name === 'deepseek') {
      const client = new DeepSeekClient({ apiKey: process.env.DEEPSEEK_API_KEY ?? '' })
      const guard = new BudgetGuard({ getBalance: () => client.balanceCny(), maxSpend: numberFlag(flags, 'max-spend-cny', 2), minBalance: numberFlag(flags, 'min-balance-cny', 41) })
      const start = await guard.start()
      console.log('deepseek balance at start ' + start.balance.toFixed(4) + ' CNY')
      if (!start.ok) { console.log('deepseek skipped: ' + start.reason); continue }
      judge = new DeepSeekJudge({ client, effort, guard, cache: cache('deepseek') })
    } else throw new Error('unknown judge ' + name + ' (rule, jev, laya, deepseek)')
    const ready = await judge.ready()
    if (!ready.ready) { console.log(judge.id + ' not ready (' + ready.detail + '), skipped'); continue }
    judges.push(judge)
  }

  fs.mkdirSync(outDir, { recursive: true })
  const resultsFile = path.join(outDir, 'results.jsonl')
  fs.writeFileSync(resultsFile, '')
  const dead = new Set<string>()
  const coverage = new Map<string, Set<string>>()
  const errors = new Map<string, number>()
  let written = 0

  const runJob = async (judge: Judge, job: Job, task: BenchTask): Promise<void> => {
    if (dead.has(judge.id)) return
    const constraint = job.question.context?.constraint
    if (judge.id !== 'rule' && constraint && RULE_ONLY_KINDS.has(constraint.kind)) return
    let results: JudgeResult[]
    try {
      results = await judge.evaluate(job.state, job.question, job.items)
    } catch (error) {
      dead.add(judge.id)
      const why = error instanceof BudgetStopError || error instanceof SystemOneError ? error.message : (error as Error).message
      console.log('  ' + judge.id + ' stopped: ' + why)
      return
    }
    const rows = rowsOf(runId, job, task, splits.get(task.id)!, judge.id, results)
    fs.appendFileSync(resultsFile, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
    written += rows.length
    for (const r of rows) if (r.error) errors.set(judge.id, (errors.get(judge.id) ?? 0) + 1)
    if (!coverage.has(judge.id)) coverage.set(judge.id, new Set())
    if (rows.some(r => !r.error)) coverage.get(judge.id)!.add(task.id)
    if ((judge as SystemOneJudge).capReached) { dead.add(judge.id); console.log('  ' + judge.id + ': request cap reached, stopping this judge') }
  }

  for (const task of labeled) {
    const snapshot = readSnapshotFile(CANDIDATES_DIR, task.id)!
    const split = splits.get(task.id)
    const jobs = buildJobs(task, snapshot, rubrics, { groups, gates, blocksPerNeed })
    const before = written
    for (const judge of judges) for (const job of jobs) await runJob(judge, job, task)
    console.log(task.id + ' (' + split + '): ' + jobs.length + ' jobs, ' + (written - before) + ' rows')
    if (judges.every(j => dead.has(j.id))) break
  }

  if (groups.includes('s1')) {
    const question = renderQuestion(rubrics.get('profile.choice.v1')!, {})
    const items: JudgeItem[] = labeled.map(t => ({ id: t.id, text: t.goal + '（查询：' + t.query + '）' }))
    for (const judge of judges) {
      if (dead.has(judge.id)) continue
      try {
        const results = await judge.evaluate('', question, items)
        const rows = results.map((r): ResultRow => {
          const t = labeled.find(x => x.id === r.id)!
          return { ...rowsOf(runId, { group: 's1', taskId: t.id, state: '', question, items: [] }, t, splits.get(t.id)!, judge.id, [r])[0]! }
        })
        fs.appendFileSync(resultsFile, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
        written += rows.length
      } catch (error) { console.log('  ' + judge.id + ' profile stopped: ' + (error as Error).message) }
    }
  }

  const meta = {
    runId, startedAt: new Date().toISOString(), judges: judges.map(j => ({ id: j.id, model: j.model, requests: (j as SystemOneJudge).requests, capReached: (j as SystemOneJudge).capReached ?? false })),
    flags: Object.fromEntries(Object.entries(flags).filter(([k]) => !/key/i.test(k))),
    tasks: labeled.map(t => t.id), rows: written,
    coverage: Object.fromEntries([...coverage].map(([k, v]) => [k, [...v]])),
    errors: Object.fromEntries(errors),
  }
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
  console.log('wrote ' + written + ' rows to ' + resultsFile)
  for (const [id, n] of errors) console.log('  ' + id + ': ' + n + ' errored rows')
  for (const j of judges) if ((j as SystemOneJudge).requests !== undefined) console.log('  ' + j.id + ': ' + (j as SystemOneJudge).requests + ' HTTP request(s)')
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then(code => process.exit(code), error => { console.error((error as Error).message); process.exit(1) })
}
