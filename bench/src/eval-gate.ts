/**
 * Offline check of the src rule gate (dev-plan M2a) on the labeled bench data.
 *
 *   node --experimental-transform-types bench/src/eval-gate.ts [--task-set v1|v2] [--run r1-20261001] [--min-recall 0.95]
 *   node --experimental-transform-types bench/src/eval-gate.ts --compile [--github-live 5]
 *
 * Default mode: runs `gateItem` from src/pipeline/gate.ts over every labeled
 * candidate (title + snippet), re-derives the calibration threshold, and prints
 * test-split positive recall / gold-candidate recall / drop ratio next to the
 * r1 `rule / gate.relevance.v1` numbers from the run's report.json (parity
 * within 1 point is expected: same lexical function, same threshold rule).
 * Since the cross-lingual gate (needs and candidate text in different languages
 * are scored with align.ts), the r1 parity rows use the LEXICAL score alone
 * (the calibrated function; identical to the gate for same-language pairs, which
 * is verified pair by pair), and extra rows show the gate as it runs now plus
 * the split into same-language and cross-lingual pairs.
 * A second table adds the hard-constraint drops (the gate's default policy).
 * With `--task-set v2` (held-out set) the frozen default threshold is evaluated on all v2
 * tasks; nothing is derived from them and the r1 parity check is skipped.
 *
 * `--compile`: compiles all tasks per provider and lists the GitHub keyword
 * queries of docs_code / compare tasks; `--github-live N` sends N of those
 * (evenly spaced) to GitHub repository search, unauthenticated, 7 s apart.
 * @module bench/eval-gate
 */

import fs from 'node:fs'
import path from 'node:path'
import { compileQueries, githubKeywordQuery } from '../../src/pipeline/compile.ts'
import { DEFAULT_RELEVANCE_THRESHOLD, gateItem, lexicalRelevance, relevanceContextOf, type GateItem } from '../../src/pipeline/gate.ts'
import { mergeCandidates } from '../../src/pipeline/candidates.ts'
import { githubEngine, EngineError } from '../../src/engines.ts'
import { numberFlag, parseFlags, sleep } from './cli.ts'
import { candidatesOf, readLabel, readSnapshotFile, RUNS_DIR } from './data.ts'
import { enginesFor } from './harvest-lib.ts'
import { chooseDropThreshold, evalThreshold } from './metrics.ts'
import { buildTruth, type ReportJson } from './report.ts'
import { assignSplits, loadTaskSet, parseTaskSet, taskSetPaths, type TaskSet } from './tasks.ts'
import { toTaskSpec, type Split } from './types.ts'

interface Sample {
  taskId: string
  split: Split
  /** The gate's score (lexical-v1, or the aligned score for cross-lingual pairs). */
  relevance: number
  /** Lexical-v1 score alone (what the gate computed before the cross-lingual change). */
  legacy: number
  /** The pair is cross-lingual: `relevance` came from align.ts. */
  aligned: boolean
  rel: number
  goldCand: boolean
  /** Dropped by a definite hard-constraint violation. */
  constraintDrop: boolean
}

const pct = (n: number | undefined): string => (n === undefined ? '—' : (n * 100).toFixed(1) + '%')

function collect(taskSet: TaskSet): { samples: Sample[]; tasks: number; candidates: number; canonicalMismatch: number } {
  const tasks = loadTaskSet(taskSet)
  const splits = assignSplits(tasks, taskSet)
  const { candidatesDir, labelsDir } = taskSetPaths(taskSet)
  const samples: Sample[] = []
  let labeled = 0
  let canonicalMismatch = 0
  for (const task of tasks) {
    const label = readLabel(labelsDir, task.id)
    const snapshot = readSnapshotFile(candidatesDir, task.id)
    if (!label || !snapshot) continue
    labeled++
    const truth = buildTruth(label, snapshot)
    const spec = toTaskSpec(task)
    const split = splits.get(task.id)!
    const candidates = candidatesOf(snapshot)
    for (const c of candidates) {
      const rel = truth.rel.get(c.key)
      if (rel === undefined) continue
      const item: GateItem = { url: c.url, title: c.title, text: c.snippet, ...c.publishedAt ? { publishedAt: c.publishedAt } : {} }
      const { gate } = gateItem(spec, item, { relevanceThreshold: 0 })
      const legacy = lexicalRelevance(relevanceContextOf(spec), item, false)
      samples.push({ taskId: task.id, split, relevance: gate.relevance, legacy, aligned: gate.aligned === true, rel, goldCand: truth.goldUrls.has(c.key), constraintDrop: gate.reason === 'constraint' })
    }
    // Cross-check: the src canonicalization should merge the same candidates as the bench key does.
    const merged = mergeCandidates(snapshot.engineRuns.map(run => ({ providerId: run.engine, query: run.query, sources: run.results })))
    if (merged.length !== candidates.length) canonicalMismatch++
  }
  return { samples, tasks: labeled, candidates: samples.length, canonicalMismatch }
}

interface Row { recall2: number | undefined; recall1: number | undefined; dropped: number | undefined; goldRecall: number | undefined; goldN: number; n: number }

function measure(samples: readonly Sample[], threshold: number, withConstraints: boolean, score: 'relevance' | 'legacy' = 'relevance'): Row {
  const keep = (s: Sample): boolean => s[score] >= threshold && !(withConstraints && s.constraintDrop)
  const ev = (minRel: number): { recall: number | undefined } => {
    const pos = samples.filter(s => s.rel >= minRel)
    return { recall: pos.length ? pos.filter(keep).length / pos.length : undefined }
  }
  const gold = samples.filter(s => s.goldCand)
  return {
    n: samples.length,
    recall2: ev(2).recall,
    recall1: ev(1).recall,
    dropped: samples.length ? 1 - samples.filter(keep).length / samples.length : undefined,
    goldRecall: gold.length ? gold.filter(keep).length / gold.length : undefined,
    goldN: gold.length,
  }
}

function r1Reference(runDir: string): Row | undefined {
  try {
    const report = JSON.parse(fs.readFileSync(path.join(runDir, 'report.json'), 'utf8')) as ReportJson
    const g = report.gate.find(x => x.judge === 'rule' && x.rubricId === 'gate.relevance.v1')
    const t = g?.test.all
    return t ? { recall2: t.recall2, recall1: t.recall1, dropped: t.dropped, goldRecall: t.goldRecall, goldN: t.goldN, n: t.n } : undefined
  } catch { return undefined }
}

function printRow(label: string, r: Row | undefined): void {
  if (!r) { console.log(label.padEnd(44) + '(not available)'); return }
  console.log(label.padEnd(44) + [pct(r.recall2), pct(r.recall1), pct(r.goldRecall) + ' (n=' + r.goldN + ')', pct(r.dropped), String(r.n)].map(x => x.padStart(14)).join(''))
}

function evalMode(flags: Record<string, string | true>): number {
  const runId = typeof flags.run === 'string' ? flags.run : 'r1-20261001'
  const runDir = fs.existsSync(runId) ? path.resolve(runId) : path.join(RUNS_DIR, runId)
  const minRecall = numberFlag(flags, 'min-recall', 0.95)
  const taskSet = parseTaskSet(flags['task-set'])
  const { samples, tasks, candidates, canonicalMismatch } = collect(taskSet)
  const cal = samples.filter(s => s.split === 'calibration')
  const test = samples.filter(s => s.split === 'test' || s.split === 'heldout')
  const derived = chooseDropThreshold(cal.map(s => s.legacy), cal.map(s => s.rel >= 2), minRecall)
  const ref = r1Reference(runDir)

  console.log('task set ' + taskSet + (taskSet === 'v2' ? ' (held-out: frozen parameters only, never tune on it)' : ''))
  console.log('labeled tasks: ' + tasks + ', candidates: ' + candidates + ' (calibration ' + cal.length + ', test ' + test.length + ')')
  console.log('labels are LLM drafts (not human reviewed); gate = lexical relevance on title + snippet')
  console.log('threshold re-derived on calibration (recall >= ' + minRecall + '): ' + derived + '   default in src: ' + DEFAULT_RELEVANCE_THRESHOLD)
  console.log('calibration drop ratio at default: ' + pct(evalThreshold(cal.map(s => s.legacy), cal.map(s => s.rel >= 2), DEFAULT_RELEVANCE_THRESHOLD).dropped))
  console.log('canonical-URL cross-check: ' + canonicalMismatch + ' task(s) where src canonicalization merges a different number of candidates than the bench key\n')
  console.log((taskSet === 'v2' ? 'HELDOUT (v2)' : 'TEST split').padEnd(44) + ['recall(>=2)', 'recall(>=1)', 'gold-cand recall', 'dropped', 'n'].map(x => x.padStart(14)).join(''))
  printRow('r1 report: rule / gate.relevance.v1', ref)
  const relOnly = measure(test, DEFAULT_RELEVANCE_THRESHOLD, false, 'legacy')
  printRow('lexical-v1 only, relevance (default thr)', relOnly)
  if (derived !== undefined) printRow('lexical-v1 only, relevance (re-derived thr)', measure(test, derived, false, 'legacy'))
  printRow('lexical-v1 only, + hard constraints', measure(test, DEFAULT_RELEVANCE_THRESHOLD, true, 'legacy'))
  const gateRow = measure(test, DEFAULT_RELEVANCE_THRESHOLD, false)
  printRow('src gate NOW, relevance only (default thr)', gateRow)
  const full = measure(test, DEFAULT_RELEVANCE_THRESHOLD, true)
  printRow('src gate NOW, + hard constraints (default)', full)

  const all = [...cal, ...test]
  const sameLang = all.filter(s => !s.aligned)
  const cross = all.filter(s => s.aligned)
  const sameDiff = sameLang.filter(s => s.relevance !== s.legacy).length
  console.log('\ncross-lingual split (calibration + ' + (taskSet === 'v2' ? 'heldout' : 'test') + '): same-language pairs ' + sameLang.length + ', cross-lingual pairs ' + cross.length + '; same-language pairs whose score differs from lexical-v1: ' + sameDiff + (sameDiff === 0 ? ' (byte-identical)' : ' (UNEXPECTED)'))
  console.log('CROSS-LINGUAL pairs only'.padEnd(44) + ['recall(>=2)', 'recall(>=1)', 'gold-cand recall', 'dropped', 'n'].map(x => x.padStart(14)).join(''))
  printRow('  lexical-v1 (before)', measure(cross, DEFAULT_RELEVANCE_THRESHOLD, false, 'legacy'))
  printRow('  aligned (now)', measure(cross, DEFAULT_RELEVANCE_THRESHOLD, false))
  const flips = (from: 'legacy', to: 'relevance'): string => {
    const a = cross.filter(s => s[from] < DEFAULT_RELEVANCE_THRESHOLD && s[to] >= DEFAULT_RELEVANCE_THRESHOLD)
    const b = cross.filter(s => s[from] >= DEFAULT_RELEVANCE_THRESHOLD && s[to] < DEFAULT_RELEVANCE_THRESHOLD)
    return a.length + ' pairs newly kept (' + a.filter(s => s.rel >= 2).length + ' labeled >=2, ' + a.filter(s => s.rel < 1).length + ' labeled 0), ' + b.length + ' newly dropped (' + b.filter(s => s.rel >= 2).length + ' labeled >=2)'
  }
  console.log('  flips at the default threshold: ' + flips('legacy', 'relevance'))

  const cDrops = test.filter(s => s.constraintDrop)
  const cDropsAlso = cDrops.filter(s => s.relevance >= DEFAULT_RELEVANCE_THRESHOLD)
  console.log('\nhard-constraint drops on test: ' + cDrops.length + ' candidates; ' + cDropsAlso.length + ' of them would otherwise survive the relevance gate; ' +
    cDropsAlso.filter(s => s.rel >= 2).length + ' of those are labeled relevant (>=2)')
  const calC = cal.filter(s => s.constraintDrop && s.relevance >= DEFAULT_RELEVANCE_THRESHOLD)
  console.log('hard-constraint drops on calibration (beyond relevance): ' + calC.length + '; labeled relevant (>=2): ' + calC.filter(s => s.rel >= 2).length)

  if (taskSet !== 'v1') { console.log('\nparity vs r1: skipped (v1 only)'); return 0 }
  if (!ref) { console.log('\nparity: no r1 report.json found at ' + runDir); return 0 }
  const diffs = (['recall2', 'recall1', 'goldRecall', 'dropped'] as const).map(k => Math.abs((relOnly[k] ?? 0) - (ref[k] ?? 0)))
  const worst = Math.max(...diffs)
  console.log('\nparity vs r1 (max abs difference over recall(>=2), recall(>=1), gold-cand recall, dropped): ' + (worst * 100).toFixed(2) + ' pt -> ' + (worst <= 0.01 ? 'OK (within 1 pt)' : 'MISMATCH'))
  return worst <= 0.01 ? 0 : 1
}

async function compileMode(flags: Record<string, string | true>): Promise<number> {
  const tasks = loadTaskSet(parseTaskSet(flags['task-set']))
  const liveCount = numberFlag(flags, 'github-live', 0)
  let natives = 0
  let locals = 0
  console.log('compile: provider queries for all ' + tasks.length + ' tasks (only providers whose query differs from the plain one are listed)\n')
  for (const task of tasks) {
    const spec = toTaskSpec(task)
    const compiled = compileQueries(spec, [...new Set([...enginesFor(task), 'exa'])])
    const lines: string[] = []
    for (const c of compiled) {
      natives += c.native.length
      if (c.providerId !== 'exa') locals += c.local.length
      const changed = c.query !== task.query || c.options
      if (!changed) continue
      lines.push('    ' + c.providerId.padEnd(7) + c.query + (c.options ? '  ' + JSON.stringify(c.options) : '') + '   native=[' + c.native.join(',') + '] local=[' + c.local.join(',') + ']')
    }
    console.log(task.id + '  ' + task.query)
    if (!lines.length) console.log('    (all providers: plain query; all constraints local)')
    else console.log(lines.join('\n'))
  }
  console.log('\nnative constraint compilations (summed over providers incl. exa): ' + natives + '; non-exa local checks: ' + locals)

  const gh = tasks.filter(t => t.profile === 'docs_code' || t.profile === 'compare')
  console.log('\nGitHub keyword queries (' + gh.length + ' docs_code / compare tasks)')
  for (const t of gh) console.log('  ' + t.id + '  ' + githubKeywordQuery(toTaskSpec(t)).padEnd(60) + ' <- ' + t.query)

  if (liveCount > 0) {
    // Unauthenticated on purpose: results must not depend on a personal token.
    delete process.env.GITHUB_TOKEN
    delete process.env.GH_TOKEN
    const engine = githubEngine({ enableCli: false, opencliEnabled: false, agentReachEnabled: false, allowProxyFakeIp: process.env.BENCH_ALLOW_FAKE_IP !== '0', skipSeam: true })
    const step = Math.max(1, Math.floor(gh.length / liveCount))
    const picked = Array.from({ length: liveCount }, (_, i) => gh[Math.min(i * step, gh.length - 1)]!)
    console.log('\nLIVE GitHub repository search (unauthenticated), ' + picked.length + ' queries')
    let nonEmpty = 0
    for (const [i, t] of picked.entries()) {
      if (i > 0) await sleep(7000)
      const keyword = githubKeywordQuery(toTaskSpec(t))
      const show = async (query: string): Promise<number> => {
        try {
          const out = await engine.search(query, 5, AbortSignal.timeout(30_000))
          console.log('  ' + t.id + '  ' + JSON.stringify(query) + ' -> ' + out.sources.length + ' results: ' + out.sources.slice(0, 3).map(s => s.title).join(', '))
          return out.sources.length
        } catch (error) {
          const empty = error instanceof EngineError && error.code === 'ENGINE_EMPTY'
          console.log('  ' + t.id + '  ' + JSON.stringify(query) + ' -> ' + (empty ? '0 results (ENGINE_EMPTY)' : 'ERROR ' + (error as Error).message))
          return 0
        }
      }
      if (await show(keyword) > 0) nonEmpty++
    }
    console.log('non-empty: ' + nonEmpty + ' of ' + picked.length)
  }
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const flags = parseFlags(process.argv.slice(2), { values: ['run', 'min-recall', 'github-live', 'task-set'], booleans: ['compile'] })
  const run = flags.compile || flags['github-live'] !== undefined ? compileMode(flags) : Promise.resolve(evalMode(flags))
  run.then(code => process.exit(code), error => { console.error((error as Error).message); process.exit(1) })
}
