/**
 * Offline evaluation of the evidence pipeline (dev-plan M2b): runs S3-S8 over
 * the frozen candidate snapshots and labels with NO network (the snapshot's
 * engine results stand in for S2, its fetched pages/blocks for S5) and compares
 *
 *   (a) baseline: the top-8 fused candidates with snippets plus their full page texts,
 *   (b) the pipeline with the rule scorer,
 *   (c) the pipeline with the Jev scorer, answering from the r1 judge cache
 *       (bench/data/judge-cache/jev) whenever the question text matches.
 *
 *   node --experimental-transform-types bench/src/eval-pack.ts \
 *     [--run-id ID] [--split all|calibration|test] [--tasks a,b] [--allow-jev N] [--no-jev] \
 *     [--budget 6000] [--max-items 10] [--min-grade 1] [--fetch-top-k 4] [--blocks-per-need N (default: adaptive 12..24)] [--sweep]
 *
 * Jev: no HTTP request is made unless `--allow-jev N` (N > 0) is given; then at
 * most N requests are spent (tasks that need the fewest first) and every answer
 * is cached for later runs. The key comes from BOCHA_JEV_API_KEY and is never
 * printed. A task whose Jev questions cannot all be answered falls back to the
 * rule scorer and is excluded from the Jev comparison.
 * Labels are LLM drafts (not human reviewed), so numbers are for ordering work.
 * @module bench/eval-pack
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitBlocks } from '../../src/pipeline/blocks.ts'
import { mergeCandidates, type ProviderOutput } from '../../src/pipeline/candidates.ts'
import { fuseCandidates, type FusionOptions } from '../../src/pipeline/fusion.ts'
import { runEvidenceStages, type PageInput, type PipelineDeps, type PipelineOptions, type PipelineResult, type StageContext } from '../../src/pipeline/run.ts'
import { renderEvidencePack } from '../../src/pipeline/render.ts'
import { JEV_MODEL, JevScorer, type JevCache, type JevProbe } from '../../src/pipeline/score.ts'
import { DEFAULT_SELECT_OPTIONS, type SelectOptions } from '../../src/pipeline/select.ts'
import { canonicalizeUrl } from '../../src/pipeline/url.ts'
import { listFlag, numberFlag, parseFlags } from './cli.ts'
import { CANDIDATES_DIR, JUDGE_CACHE_ROOT, LABELS_DIR, readLabel, readSnapshotFile, RUNS_DIR } from './data.ts'
import { cacheKey, JudgeCache } from './judges/cache.ts'
import { loadRubrics, renderQuestion } from './judges/rubrics.ts'
import { assignSplits, loadTasks } from './tasks.ts'
import { toTaskSpec, type BenchTask, type CandidateSnapshot, type Label, type PageSnapshot, type Split } from './types.ts'

// ── parameters ──────────────────────────────────────────────────────────────

/** Fusion settings of the plugin defaults (config.ts). */
export const EVAL_FUSION: Omit<FusionOptions, 'nProviders' | 'now'> = { k: 60, freshnessBoost: 0.2, freshnessDays: 30, authorityBoost: 0.25, authorityDomains: [] }
const BASELINE_TOP = 8
const PAGE_CAP = 60_000
const pct = (n: number | undefined, digits = 1): string => (n === undefined || !Number.isFinite(n) ? '—' : (n * 100).toFixed(digits) + '%')
const num = (n: number | undefined, digits = 0): string => (n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(digits))

/** Rough model-token count (DeepSeek-like: about 0.7 per Han character, 0.3 per other character). Display only. */
export function approxTokens(text: string): number {
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0
  return Math.round(han * 0.7 + (text.length - han) * 0.3)
}

// ── snapshot -> pipeline inputs ─────────────────────────────────────────────

export function providerOutputs(snapshot: CandidateSnapshot): ProviderOutput[] {
  return snapshot.engineRuns.filter(run => run.results.length).map(run => ({ providerId: run.engine, query: run.query, sources: run.results }))
}

/** Pages of a snapshot by canonical URL; `ok` pages serve blocks, `error` pages fail like a real fetch, others do not exist. */
export function pageFetcher(snapshot: CandidateSnapshot): PipelineDeps['fetchPage'] {
  const byUrl = new Map<string, PageSnapshot>()
  for (const p of snapshot.pages) byUrl.set(canonicalizeUrl(p.url), p)
  return async (url: string): Promise<PageInput | undefined> => {
    const page = byUrl.get(canonicalizeUrl(url))
    if (!page || page.status === 'skipped') return undefined
    if (page.status === 'error') throw new Error('snapshot fetch failed: ' + (page.error ?? 'error'))
    return { url: page.url, ...page.title ? { title: page.title } : {}, text: page.text, ...page.shellPage ? { shellPage: true } : {}, blocks: page.blocks }
  }
}

function offlineContext(task: ReturnType<typeof toTaskSpec>, outputs: readonly ProviderOutput[]): StageContext {
  const never = new AbortController().signal
  return {
    plan: { profile: task.profile ?? 'general', profileInferred: false, providers: [...new Set(outputs.map(o => o.providerId))].map(id => ({ id })) },
    notes: [], partial: false, stage: never, deadlineSignal: never, now: new Date(), verification: { native: [], local: [] },
  }
}

// ── Jev cache adapter (r1 judge cache) ──────────────────────────────────────

const JEV_EXTRA_KEY = '{}|1200' // SystemOneJudge: JSON.stringify(extraBody ?? {}) + '|' + candidateChars

export function r1JevCache(root = JUDGE_CACHE_ROOT): JevCache & { misses: number; hits: number } {
  const rubric = loadRubrics().get('score.support.v1')!
  const cache = new JudgeCache(root, 'jev')
  const judge = { id: 'jev', model: JEV_MODEL }
  const keyOf = (probe: JevProbe): string => cacheKey(judge, probe.state, renderQuestion(rubric, { need: probe.need }), { id: '', text: probe.candidate }, JEV_EXTRA_KEY)
  const adapter = {
    misses: 0, hits: 0,
    get(probe: JevProbe) {
      const hit = cache.get(keyOf(probe))
      if (hit && !hit.error && typeof hit.grade === 'number') { adapter.hits++; return { grade: hit.grade, ...hit.probabilities ? { probabilities: hit.probabilities } : {} } }
      adapter.misses++
      return undefined
    },
    set(probe: JevProbe, answer: { grade: number; probabilities?: Record<string, number> }) {
      cache.set(keyOf(probe), { judge: 'jev', model: JEV_MODEL, rubricId: rubric.id, rubricVersion: rubric.version, latencyMs: 0, grade: answer.grade, decision: String(Math.round(answer.grade)), ...answer.probabilities ? { probabilities: answer.probabilities } : {}, kind: 'score' } as never)
    },
  }
  return adapter
}

// ── metrics ─────────────────────────────────────────────────────────────────

export interface GoldPair { needId: string; blockId: string; url: string }

/** Distinct (need, gold block) pairs of a label; `url` is canonical. */
export function goldPairs(label: Label): GoldPair[] {
  const out: GoldPair[] = []
  for (const g of label.gold) for (const e of new Map(g.evidence.map(x => [x.blockId, x])).values()) out.push({ needId: g.needId, blockId: e.blockId, url: canonicalizeUrl(e.url) })
  return out
}

export interface ArmResult {
  /** Characters / approximate tokens the model would read. */
  chars: number
  tokens: number
  /** Pages read (fetched). */
  pages: number
  /** Evidence items (pipeline) or source lines (baseline). */
  items: number
  /** Gold (need, block) pairs whose block is in the pack / whose page was read / that got an S6 grade / graded >= 2. */
  retained: number
  reached: number
  scored: number
  strong: number
  /** Needs that have gold evidence, and how many of them have >= 1 gold block in the pack. */
  needsWithGold: number
  needsHit: number
  /** Needs the pack claims covered, and how many of those have gold in the pack (pipeline only). */
  claimed: number
  claimedHit: number
  /** Needs without any gold block in the snapshot, and how many the pack lists as gaps (pipeline only). */
  noGold: number
  noGoldFlagged: number
}

interface PackView {
  text: string
  blockIds: ReadonlySet<string>
  pagesRead: ReadonlySet<string>
  items: number
  claimed?: readonly string[]
  gapNeeds?: readonly string[]
  /** needId|blockId -> S6 grade (pipeline only). */
  grades?: ReadonlyMap<string, number>
}

function armOf(label: Label, pairs: readonly GoldPair[], view: PackView): ArmResult {
  const goldNeeds = new Set(pairs.map(p => p.needId))
  const hit = new Set(pairs.filter(p => view.blockIds.has(p.blockId)).map(p => p.needId))
  const claimed = view.claimed ?? []
  const noGold = label.gold.map(g => g.needId).filter(n => !goldNeeds.has(n))
  return {
    chars: view.text.length, tokens: approxTokens(view.text), pages: view.pagesRead.size, items: view.items,
    retained: pairs.filter(p => view.blockIds.has(p.blockId)).length,
    reached: pairs.filter(p => view.pagesRead.has(p.url)).length,
    scored: pairs.filter(p => view.grades?.has(p.needId + '|' + p.blockId)).length,
    strong: pairs.filter(p => (view.grades?.get(p.needId + '|' + p.blockId) ?? 0) >= 2).length,
    needsWithGold: goldNeeds.size, needsHit: hit.size,
    claimed: claimed.length, claimedHit: claimed.filter(n => hit.has(n)).length,
    noGold: noGold.length, noGoldFlagged: noGold.filter(n => (view.gapNeeds ?? []).includes(n)).length,
  }
}

/** Baseline pack: the top-8 fused candidates as source lines, plus the full (60k-capped) text of each one whose page exists in the snapshot. */
export function baselineArm(label: Label, snapshot: CandidateSnapshot, outputs: readonly ProviderOutput[], pairs: readonly GoldPair[]): { arm: ArmResult; candidates: number } {
  const merged = mergeCandidates(outputs)
  const top = fuseCandidates(merged, { ...EVAL_FUSION, nProviders: Math.max(new Set(outputs.map(o => o.providerId)).size, 1) }).slice(0, BASELINE_TOP).map(r => r.candidate)
  const pages = new Map(snapshot.pages.filter(p => p.status === 'ok').map(p => [canonicalizeUrl(p.url), p]))
  const parts: string[] = top.map(c => '- [' + (c.title || c.url) + '](' + c.url + ')' + (c.snippet ? ' — ' + c.snippet : ''))
  const blockIds = new Set<string>()
  const read = new Set<string>()
  for (const c of top) {
    const page = pages.get(c.canonicalUrl)
    if (!page) continue
    read.add(c.canonicalUrl)
    parts.push('# ' + (page.title ?? c.title) + '\n' + page.text.slice(0, PAGE_CAP))
    for (const b of page.blocks) if (b.end <= PAGE_CAP) blockIds.add(b.blockId)
  }
  return { arm: armOf(label, pairs, { text: parts.join('\n\n'), blockIds, pagesRead: read, items: top.length }), candidates: merged.length }
}

/**
 * Size-matched naive baseline: the same source lines, but each read page is cut to its first
 * `totalChars / pages` characters (what cutting the baseline down to the pipeline's size would keep).
 */
export function truncatedBaselineArm(label: Label, snapshot: CandidateSnapshot, outputs: readonly ProviderOutput[], pairs: readonly GoldPair[], totalChars: number): ArmResult {
  const merged = mergeCandidates(outputs)
  const top = fuseCandidates(merged, { ...EVAL_FUSION, nProviders: Math.max(new Set(outputs.map(o => o.providerId)).size, 1) }).slice(0, BASELINE_TOP).map(r => r.candidate)
  const pages = new Map(snapshot.pages.filter(p => p.status === 'ok').map(p => [canonicalizeUrl(p.url), p]))
  const lines = top.map(c => '- [' + (c.title || c.url) + '](' + c.url + ')' + (c.snippet ? ' — ' + c.snippet : ''))
  const withPage = top.filter(c => pages.has(c.canonicalUrl))
  const perPage = withPage.length ? Math.max(Math.floor((totalChars - lines.join('\n').length) / withPage.length), 0) : 0
  const parts = [...lines]
  const blockIds = new Set<string>()
  const read = new Set<string>()
  for (const c of withPage) {
    const page = pages.get(c.canonicalUrl)!
    read.add(c.canonicalUrl)
    parts.push(page.text.slice(0, perPage))
    for (const b of page.blocks) if (b.end <= perPage) blockIds.add(b.blockId)
  }
  return armOf(label, pairs, { text: parts.join('\n\n'), blockIds, pagesRead: read, items: top.length })
}

export function packArm(label: Label, result: PipelineResult, pairs: readonly GoldPair[]): ArmResult {
  const { pack } = result
  return armOf(label, pairs, {
    text: renderEvidencePack(pack, pack.sources, 'Engine: ' + pack.engine),
    blockIds: new Set(pack.evidence.map(e => e.blockId)), pagesRead: new Set(result.pagesRead), items: pack.evidence.length,
    claimed: pack.coveredNeeds, gapNeeds: pack.gaps.map(g => g.needId),
    grades: new Map(result.scored.flatMap(b => [...b.grades].map(([needId, g]): [string, number] => [needId + '|' + b.block.blockId, g.grade]))),
  })
}

// ── the run ─────────────────────────────────────────────────────────────────

export interface EvalOptions {
  select: Partial<SelectOptions>
  fetchTopK: number
  blocksPerNeed: number
  /** Jev HTTP requests allowed in total (0 = answer from the cache only). */
  allowJev: number
  /** Run the Jev arm at all. */
  jev: boolean
  /** Judge-cache root (default: bench/data/judge-cache). */
  jevRoot?: string
}

/** `nothing`: no page gave a block, so there was nothing to score (the arm equals the rule arm). */
export type JevStatus = 'off' | 'answered' | 'fallback' | 'nothing'

export interface TaskEval {
  taskId: string
  profile: string
  lang: string
  split: Split
  candidates: number
  goldPairs: number
  baseline: ArmResult
  /** Baseline cut to the size of the rule pack. */
  baselineCut: ArmResult
  rule: ArmResult
  jev?: ArmResult
  jevStatus: JevStatus
  jevCacheHits: number
  jevMisses: number
  jevRequests: number
}

export interface LoadedTask { task: BenchTask; split: Split; snapshot: CandidateSnapshot; label: Label }

export function loadEvalTasks(only?: readonly string[], split: 'all' | Split = 'all'): LoadedTask[] {
  const tasks = loadTasks()
  const splits = assignSplits(tasks)
  const out: LoadedTask[] = []
  for (const task of tasks) {
    if (only && !only.includes(task.id)) continue
    if (split !== 'all' && splits.get(task.id) !== split) continue
    const snapshot = readSnapshotFile(CANDIDATES_DIR, task.id)
    const label = readLabel(LABELS_DIR, task.id)
    if (snapshot && label) out.push({ task, split: splits.get(task.id)!, snapshot, label })
  }
  return out
}

function runStages(item: LoadedTask, opts: EvalOptions, scorer?: JevScorer): Promise<PipelineResult> {
  const spec = toTaskSpec(item.task)
  const outputs = providerOutputs(item.snapshot)
  const deps: PipelineDeps = {
    fetchPage: pageFetcher(item.snapshot), scorers: scorer ? { control: scorer } : {}, configuredEngines: [],
    fusion: EVAL_FUSION, newId: () => 'r_eval',
  }
  const options: PipelineOptions = { fetchTopK: opts.fetchTopK, fetchConcurrency: 1, ...opts.blocksPerNeed > 0 ? { blocksPerNeed: opts.blocksPerNeed } : {}, select: opts.select, maxScoreQuestions: 64 }
  return runEvidenceStages(spec, outputs, deps, options, offlineContext(spec, outputs))
}

const noNetwork = (async () => { throw new Error('offline evaluation: no network') }) as unknown as typeof fetch

/** The Jev arm of one task; `cap` HTTP requests may be spent (0 = cache only). */
async function jevArm(item: LoadedTask, opts: EvalOptions, cap: number, key: string | undefined): Promise<{ result: PipelineResult; cache: ReturnType<typeof r1JevCache>; requests: number }> {
  const cache = r1JevCache(opts.jevRoot)
  const scorer = new JevScorer({ apiKey: key || 'offline', cache, requestCap: cap, ...cap > 0 ? {} : { fetchImpl: noNetwork } })
  const result = await runStages(item, opts, scorer)
  return { result, cache, requests: scorer.requests }
}

/** Jev questions per task the cache cannot answer (dry run: no requests, tasks fall back to rule). */
export async function jevMisses(items: readonly LoadedTask[], opts: EvalOptions): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (const item of items) out.set(item.task.id, (await jevArm(item, opts, 0, undefined)).cache.misses)
  return out
}

export async function evaluate(items: readonly LoadedTask[], opts: EvalOptions, log: (line: string) => void = () => {}): Promise<{ tasks: TaskEval[]; jevRequests: number }> {
  const key = process.env.BOCHA_JEV_API_KEY
  if (opts.jev && opts.allowJev > 0 && !key) throw new Error('--allow-jev needs BOCHA_JEV_API_KEY in the environment')
  const jevByTask = new Map<string, { result: PipelineResult; cache: ReturnType<typeof r1JevCache>; requests: number }>()
  let remaining = opts.allowJev
  let jevRequests = 0
  if (opts.jev) {
    const misses = await jevMisses(items, opts)
    // Spend the allowance on the tasks that need the fewest requests first; tasks fully answered by the cache cost nothing.
    const order = [...items].sort((a, b) => misses.get(a.task.id)! - misses.get(b.task.id)!)
    for (const item of order) {
      const r = await jevArm(item, opts, misses.get(item.task.id) === 0 ? 0 : remaining, key)
      remaining -= r.requests
      jevRequests += r.requests
      jevByTask.set(item.task.id, r)
      log('  jev ' + item.task.id + ': ' + ({ jev: 'answered', none: 'nothing to score' }[r.result.pack.stats.scorer] ?? 'fallback to rule') + ' (cache hits ' + r.cache.hits + ', misses ' + misses.get(item.task.id) + ', requests ' + r.requests + ')')
    }
  }
  const tasks: TaskEval[] = []
  for (const item of items) {
    const pairs = goldPairs(item.label)
    const { arm: baseline, candidates } = baselineArm(item.label, item.snapshot, providerOutputs(item.snapshot), pairs)
    const rule = packArm(item.label, await runStages(item, opts), pairs)
    const baselineCut = truncatedBaselineArm(item.label, item.snapshot, providerOutputs(item.snapshot), pairs, rule.chars)
    const j = jevByTask.get(item.task.id)
    tasks.push({
      taskId: item.task.id, profile: item.task.profile, lang: item.task.lang, split: item.split, candidates, goldPairs: pairs.length, baseline, baselineCut, rule,
      ...j ? { jev: packArm(item.label, j.result, pairs) } : {},
      jevStatus: !j ? 'off' : j.result.pack.stats.scorer === 'jev' ? 'answered' : j.result.pack.stats.scorer === 'none' ? 'nothing' : 'fallback',
      jevCacheHits: j?.cache.hits ?? 0, jevMisses: j?.cache.misses ?? 0, jevRequests: j?.requests ?? 0,
    })
  }
  return { tasks, jevRequests }
}

// ── aggregation and report ──────────────────────────────────────────────────

export interface Summary {
  tasks: number
  goldPairs: number
  retention: number | undefined
  reach: number | undefined
  needCoverage: number | undefined
  claimPrecision: number | undefined
  gapHonesty: number | undefined
  chars: number
  tokens: number
  pages: number
  items: number
  /** Funnel: share of gold pairs reached -> scored -> graded >= 2 -> in the pack. */
  scoredShare: number | undefined
  strongShare: number | undefined
}

export function summarize(evals: readonly TaskEval[], pick: (t: TaskEval) => ArmResult | undefined): Summary {
  const arms = evals.map(pick).filter((a): a is ArmResult => a !== undefined)
  const sum = (f: (a: ArmResult) => number): number => arms.reduce((n, a) => n + f(a), 0)
  const ratio = (a: number, b: number): number | undefined => (b > 0 ? a / b : undefined)
  const n = Math.max(arms.length, 1)
  return {
    tasks: arms.length, goldPairs: evals.reduce((s, t) => s + (pick(t) ? t.goldPairs : 0), 0),
    retention: ratio(sum(a => a.retained), evals.reduce((s, t) => s + (pick(t) ? t.goldPairs : 0), 0)),
    reach: ratio(sum(a => a.reached), evals.reduce((s, t) => s + (pick(t) ? t.goldPairs : 0), 0)),
    needCoverage: ratio(sum(a => a.needsHit), sum(a => a.needsWithGold)),
    claimPrecision: ratio(sum(a => a.claimedHit), sum(a => a.claimed)),
    gapHonesty: ratio(sum(a => a.noGoldFlagged), sum(a => a.noGold)),
    chars: sum(a => a.chars) / n, tokens: sum(a => a.tokens) / n, pages: sum(a => a.pages) / n, items: sum(a => a.items) / n,
    scoredShare: ratio(sum(a => a.scored), evals.reduce((s, t) => s + (pick(t) ? t.goldPairs : 0), 0)),
    strongShare: ratio(sum(a => a.strong), evals.reduce((s, t) => s + (pick(t) ? t.goldPairs : 0), 0)),
  }
}

const HEAD = ['组', '任务', '金标块', '金标块保留', '金标页到达', '需求命中', '声称覆盖的正确率', '无金标需求标缺口', '平均字符', '≈tokens', '读页', '条目']
const ALIGN = ['---', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:']

function row(label: string, s: Summary, pipeline: boolean): string[] {
  return [label, String(s.tasks), String(s.goldPairs), pct(s.retention), pct(s.reach), pct(s.needCoverage), pipeline ? pct(s.claimPrecision) : '—', pipeline ? pct(s.gapHonesty) : '—', num(s.chars), num(s.tokens), num(s.pages, 1), num(s.items, 1)]
}

function table(rows: string[][], head = HEAD, align = ALIGN): string {
  return [head, align, ...rows].map(r => '| ' + r.join(' | ') + ' |').join('\n')
}

function armRows(evals: readonly TaskEval[], jev: boolean): string[][] {
  const rows = [
    row('(a) 基线 top-8 + 全文', summarize(evals, t => t.baseline), false),
    row('(a′) 基线截到规则包同等大小', summarize(evals, t => t.baselineCut), false),
    row('(b) 管线 + 规则评分', summarize(evals, t => t.rule), true),
  ]
  if (jev) rows.push(row('(c) 管线 + Jev 评分', summarize(evals, t => t.jev), true))
  return rows
}

export interface ReportInput {
  runId: string
  tasks: TaskEval[]
  /** Rule-arm variants of the selection parameters (sensitivity table). */
  variants?: { label: string; tasks: TaskEval[] }[]
  opts: EvalOptions
  /** Jev HTTP requests of this invocation / summed over every invocation that wrote this run directory. */
  jevRequests: number
  jevRequestsTotal?: number
  generatedAt: string
}

export function renderReport(r: ReportInput): string {
  const all = r.tasks
  const matched = all.filter(t => t.jevStatus === 'answered')
  const byKey = (key: (t: TaskEval) => string): string[] => [...new Set(all.map(key))].sort()
  const out: string[] = []
  out.push('# 证据包离线评测（M2b，pack-report）', '')
  out.push('运行：' + r.runId + '，生成时间 ' + r.generatedAt + '。**标签是 LLM 初稿，未经人工复核**；本报告用于排定开发顺序，不作最终质量判断。', '')
  out.push('## 1. 设置', '')
  out.push('- 数据：冻结的候选快照与标注（' + all.length + ' 个任务，金标块共 ' + all.reduce((s, t) => s + t.goldPairs, 0) + ' 个）；**全程不联网**：快照中的引擎结果代替 S2，快照中的页面和块代替 S5 抓取与分块（块 ID 与金标一致）。')
  out.push('- (a) 基线：融合排序后的前 8 个候选（标题、链接、摘要）加上其中有快照页面的全文（每页上限 ' + PAGE_CAP + ' 字符）。页面全文送入主模型时，整页都算保留。')
  out.push('- (a′) 等长基线：同样的前 8 个候选，但每个已读页面只取开头，总长截到 (b) 同一任务的包大小——即“把基线压缩到同样大小、不做任何选择”能保留多少。')
  out.push('- (b) 管线 + 规则评分：S3/S4 规则 gate → 读取前 ' + r.opts.fetchTopK + ' 个保留候选（无快照页面的候选不占名额）→ 每个需求按 IDF 加权词法取前 ' + (r.opts.blocksPerNeed > 0 ? String(r.opts.blocksPerNeed) : '12（块数 > 80 的页面自适应，至多 24）') + ' 块 → RuleScorer → 选择（预算 ' + (r.opts.select.charBudget ?? DEFAULT_SELECT_OPTIONS.charBudget) + ' 字符，每 URL 至多 ' + (r.opts.select.maxPerUrl ?? DEFAULT_SELECT_OPTIONS.maxPerUrl) + ' 块，至多 ' + (r.opts.select.maxItems ?? DEFAULT_SELECT_OPTIONS.maxItems) + ' 条，最低入选评分 ' + (r.opts.select.minGrade ?? DEFAULT_SELECT_OPTIONS.minGrade) + '）→ 覆盖判定。')
  out.push('- (c) 管线 + Jev 评分：同 (b)，评分改用 JevScorer；问题文本与 r1 相同时直接读 r1 评分缓存。' + (r.opts.jev ? '本次调用实际发出 **' + r.jevRequests + '** 次 Jev 请求（上限 ' + r.opts.allowJev + '）' + (r.jevRequestsTotal !== undefined && r.jevRequestsTotal !== r.jevRequests ? '；该运行目录累计 **' + r.jevRequestsTotal + '** 次（此前的调用补全了缓存缺口，之后的回答都已缓存，可重复运行不再计费）' : '') + '。无法全部回答的任务回退到规则评分并排除在 Jev 对照之外。' : '未运行 Jev 组。'))
  out.push('- 指标：**金标块保留** = 金标 (需求, 块) 对中，该块出现在最终送给主模型的内容里的比例（基线按“所在页面被整页送入”计）；**金标页到达** = 金标块所在页面被读取的比例；**需求命中** = 有金标的需求中，至少一个金标块在内容里的比例；**声称覆盖的正确率** = 管线声称已覆盖的需求里，确有金标块在包内的比例（无金标的需求算错）；**无金标需求标缺口** = 快照里没有任何金标的需求，管线把它列为缺口的比例；字符与 tokens 为主模型实际看到的渲染文本（tokens 为粗估：汉字 0.7、其他 0.3 每字符）。', '')

  const section = (title: string, evals: TaskEval[], jev: boolean): void => {
    out.push(title, '', table(armRows(evals, jev)), '')
  }
  out.push('## 2. 总体对比', '')
  section('### 全部任务', all, false)
  section('### calibration', all.filter(t => t.split === 'calibration'), false)
  section('### test', all.filter(t => t.split === 'test'), false)
  if (r.opts.jev) {
    out.push('## 3. Jev 对照（仅 Jev 评分全部可回答的任务，三组在同一子集上比较）', '')
    const nothing = all.filter(t => t.jevStatus === 'nothing').length
  out.push('Jev 评分了的任务：' + matched.length + ' / ' + all.length + '；无页面块可评分（两组相同，不计入）' + nothing + ' 个；因缓存缺口回退到规则评分 ' + (all.length - matched.length - nothing) + ' 个。', '')
    section('### 匹配子集（全部）', matched, true)
    section('### 匹配子集 · test', matched.filter(t => t.split === 'test'), true)
    section('### 匹配子集 · calibration', matched.filter(t => t.split === 'calibration'), true)
  }
  const funnel = (title: string, evals: TaskEval[], jev: boolean): void => {
    const f = (label: string, s: Summary): string[] => [label, pct(s.reach), pct(s.scoredShare), pct(s.strongShare), pct(s.retention), num(s.items, 1)]
    const rows = [f('(b) 规则评分', summarize(evals, t => t.rule))]
    if (jev) rows.push(f('(c) Jev 评分', summarize(evals, t => t.jev)))
    out.push(title, '', table(rows, ['组', '页面被读取', '进入评分（每需求前 N 块）', '评分 ≥ 2', '入选进包', '条目'], ['---', '---:', '---:', '---:', '---:', '---:']), '')
  }
  out.push('## 2b. 漏斗：金标块在哪一步丢失', '')
  out.push('占全部金标块的比例（每一步都是上一步的子集）。“进入评分”受每需求只评前 N 块的限制，“评分 ≥ 2”看评分器能否认出金标，“入选进包”还受预算、每 URL 块数和去重限制。', '')
  funnel('### 全部任务', all, false)
  if (r.opts.jev && matched.length) funnel('### Jev 匹配子集', matched, true)
  if (r.variants?.length) {
    out.push('## 2c. 选择参数敏感性（规则评分，全部任务）', '')
    const variantRows = r.variants.map(v => {
      const s = summarize(v.tasks, t => t.rule)
      return [v.label, pct(s.retention), pct(s.needCoverage), pct(s.claimPrecision), num(s.chars), num(s.tokens), num(s.items, 1)]
    })
    out.push(table(variantRows, ['变体', '金标块保留', '需求命中', '声称覆盖的正确率', '平均字符', '≈tokens', '条目'], ['---', '---:', '---:', '---:', '---:', '---:', '---:']), '')
  }
  out.push('## 4. 按 profile', '')
  for (const profile of byKey(t => t.profile)) section('### ' + profile, all.filter(t => t.profile === profile), false)
  out.push('## 5. 按语言', '')
  for (const lang of byKey(t => t.lang)) section('### ' + lang, all.filter(t => t.lang === lang), false)
  if (r.opts.jev && matched.length) {
    out.push('## 6. Jev 匹配子集：按 profile 与语言', '')
    for (const profile of [...new Set(matched.map(t => t.profile))].sort()) section('### ' + profile, matched.filter(t => t.profile === profile), true)
    for (const lang of [...new Set(matched.map(t => t.lang))].sort()) section('### ' + lang, matched.filter(t => t.lang === lang), true)
  }
  if (r.opts.jev) {
    out.push('## 7. Jev 缓存与请求', '')
    out.push(table(all.map(t => [t.taskId, t.split, ({ answered: '已回答', fallback: '回退规则', nothing: '无可评分块', off: '—' })[t.jevStatus], String(t.jevCacheHits), String(t.jevMisses), String(t.jevRequests)]), ['任务', '划分', 'Jev', '缓存命中', '缓存缺口', '请求'], ['---', '---', '---', '---:', '---:', '---:']), '')
  }
  out.push('## 8. 逐任务', '')
  out.push(table(all.map(t => [t.taskId, t.split, t.profile, t.lang, String(t.goldPairs), ...[t.baseline, t.rule, ...t.jev ? [t.jev] : []].map(a => a.retained + '/' + t.goldPairs + ' · ' + a.chars), ...t.jev ? [] : ['—']]), ['任务', '划分', 'profile', '语言', '金标块', '基线 保留·字符', '规则 保留·字符', 'Jev 保留·字符'], ['---', '---', '---', '---', '---:', '---:', '---:', '---:']), '')
  out.push('## 9. 局限', '')
  out.push('- 金标只有 LLM 初稿；词法规则可能因标签由同样的标题、摘要和块生成而被高估。')
  out.push('- 离线时无快照页面的候选既不读取也不占读页名额，实际线上这些候选可能被读到（也可能读取失败）；快照页面来自 E1 采集的 top-4 页面，未必与融合排序的前 4 个一致，所以“金标页到达”受快照覆盖限制。')
  out.push('- 基线按整页送入计保留，这对基线有利；它的代价体现在字符数上。')
  out.push('- Jev 问题文本与 r1 只在候选页面集合相同的部分一致，其余块需要新请求或回退；匹配子集偏向缓存已覆盖的任务。', '')
  return out.join('\n')
}

// ── parameter sweep (calibration only) ──────────────────────────────────────

export async function sweep(items: readonly LoadedTask[], base: EvalOptions, log: (line: string) => void): Promise<void> {
  const cal = items.filter(i => i.split === 'calibration')
  const rows: string[][] = []
  for (const minGrade of [1, 2]) for (const maxItems of [6, 8, 10, 12]) for (const charBudget of [4000, 6000]) for (const maxPerUrl of [2, 3]) {
    const opts: EvalOptions = { ...base, jev: false, select: { ...base.select, minGrade, maxItems, charBudget, maxPerUrl } }
    const { tasks } = await evaluate(cal, opts)
    const s = summarize(tasks, t => t.rule)
    rows.push([String(minGrade), String(maxItems), String(charBudget), String(maxPerUrl), pct(s.retention), pct(s.needCoverage), pct(s.claimPrecision), num(s.chars), num(s.items, 1)])
  }
  log(table(rows, ['minGrade', 'maxItems', 'budget', 'perUrl', '金标块保留', '需求命中', '声称正确率', '平均字符', '条目'], ['---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:']))
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2), {
    values: ['run-id', 'split', 'tasks', 'allow-jev', 'budget', 'max-items', 'min-grade', 'max-per-url', 'fetch-top-k', 'blocks-per-need'],
    booleans: ['no-jev', 'sweep'],
  })
  const split = typeof flags.split === 'string' ? flags.split : 'all'
  if (!['all', 'calibration', 'test'].includes(split)) throw new Error('--split must be all|calibration|test')
  const items = loadEvalTasks(listFlag(flags, 'tasks'), split as 'all' | Split)
  if (!items.length) { console.log('no labeled tasks with snapshots found (bench/data is local-only)'); return 1 }
  const select: Partial<SelectOptions> = {
    ...flags.budget !== undefined ? { charBudget: numberFlag(flags, 'budget', 6000) } : {},
    ...flags['max-items'] !== undefined ? { maxItems: numberFlag(flags, 'max-items', 10) } : {},
    ...flags['min-grade'] !== undefined ? { minGrade: numberFlag(flags, 'min-grade', 1) } : {},
    ...flags['max-per-url'] !== undefined ? { maxPerUrl: numberFlag(flags, 'max-per-url', 2) } : {},
  }
  const opts: EvalOptions = {
    select, fetchTopK: numberFlag(flags, 'fetch-top-k', 4), blocksPerNeed: numberFlag(flags, 'blocks-per-need', 0),
    allowJev: numberFlag(flags, 'allow-jev', 0), jev: !flags['no-jev'],
  }
  console.log(items.length + ' labeled tasks; Jev ' + (opts.jev ? 'arm on, request allowance ' + opts.allowJev : 'arm off'))
  if (flags.sweep) { await sweep(items, opts, line => console.log(line)); return 0 }
  const { tasks, jevRequests } = await evaluate(items, opts, line => console.log(line))
  const runId = typeof flags['run-id'] === 'string' ? flags['run-id'] : 'pack-' + new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const dir = path.join(RUNS_DIR, runId)
  fs.mkdirSync(dir, { recursive: true })
  const variants: { label: string; tasks: TaskEval[] }[] = []
  for (const [label, sel] of [['每 URL 2 块、至多 10 条（M2b 初版）', { maxPerUrl: 2, maxItems: 10 }], ['每 URL 3 块', { maxPerUrl: 3 }], ['默认（每 URL 4 块、至多 12 条）', {}]] as const) {
    variants.push({ label, tasks: (await evaluate(items, { ...opts, jev: false, select: { ...select, ...sel } })).tasks })
  }
  let previous = 0
  try {
    const prev = JSON.parse(fs.readFileSync(path.join(dir, 'pack-report.json'), 'utf8')) as { jevRequests?: number; jevRequestsTotal?: number }
    previous = prev.jevRequestsTotal ?? prev.jevRequests ?? 0
  } catch { /* first invocation for this run id */ }
  const jevRequestsTotal = previous + jevRequests
  const report = renderReport({ runId, tasks, variants, opts, jevRequests, jevRequestsTotal, generatedAt: new Date().toISOString() })
  fs.writeFileSync(path.join(dir, 'pack-report.md'), report + '\n')
  fs.writeFileSync(path.join(dir, 'pack-report.json'), JSON.stringify({ runId, opts, jevRequests, jevRequestsTotal, tasks }, null, 1) + '\n')
  console.log('wrote ' + path.join(dir, 'pack-report.md') + ' (Jev requests used: ' + jevRequests + ')')
  console.log(report.split('\n').slice(report.split('\n').findIndex(l => l.startsWith('## 2.')), report.split('\n').findIndex(l => l.startsWith('## 4.'))).join('\n'))
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then(code => process.exit(code), error => { console.error((error as Error).message); process.exit(1) })
}
