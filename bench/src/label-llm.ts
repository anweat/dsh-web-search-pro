/**
 * DeepSeek label drafter (dev-plan §6.5): writes DRAFT labels
 * (`labeler.reviewed: false`) to bench/data/labels.v1/<taskId>.json —
 * candidate relevance 0–3, per-constraint yes/no/unknown, nav flag and gold
 * evidence blocks per need. Not human-reviewed; reports must say so.
 *
 *   node --experimental-transform-types bench/src/label-llm.ts \
 *     [--tasks id1,id2] [--limit N] [--effort low|high, default low] [--model deepseek-flash] \
 *     [--max-tokens 12000] [--max-total-tokens 3000000] \
 *     [--max-spend-cny 2] [--min-balance-cny 41] [--force] [--dry-run]
 *
 * Budget guard (mandatory): the balance is read from GET /user/balance before
 * the first request and after EVERY request; the run stops as soon as
 * spend >= --max-spend-cny or balance < --min-balance-cny. Per-request token
 * usage and balance go to bench/data/labels.v1/_ledger.jsonl.
 * Key: env DEEPSEEK_API_KEY (never printed).
 * @module bench/label-llm
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listFlag, numberFlag, parseFlags } from './cli.ts'
import {
  candidatesOf, candidateText, fetchedBlocks, LABELS_DIR, CANDIDATES_DIR, readLabel, readSnapshotFile, writeLabel,
  type Candidate,
} from './data.ts'
import { canonicalUrl } from './harvest-lib.ts'
import { BudgetGuard } from './judges/budget.ts'
import {
  DeepSeekClient, DEEPSEEK_MODEL, EFFORTS, parseJsonLoose, type ChatMessage, type Effort,
} from './judges/deepseek-client.ts'
import { weightedOverlap } from './judges/lexical.ts'
import { checkConstraint } from './judges/rule.ts'
import { BudgetStopError } from './judges/types.ts'
import { loadTasks } from './tasks.ts'
import {
  LABEL_VERSION,
  type BenchTask, type CandidateLabel, type CandidateSnapshot, type ConstraintCheck, type Label, type NeedGold,
  type Relevance, type Satisfied, type TaskConstraint,
} from './types.ts'

export const PROMPT_VERSION = 'label.v1'
export const CANDIDATES_PER_REQUEST = 40
export const MAX_BLOCKS_IN_PROMPT = 80
const SNIPPET_CHARS = 320
const FIRST_BLOCK_CHARS = 360
const BLOCK_CHARS = 450

/** Constraint kinds decided by rule (URL host) instead of asking the model. */
const RULE_KINDS = new Set(['site', 'exclude_site'])

export type Ask = (stage: string, messages: ChatMessage[]) => Promise<string>

const cut = (text: string, n: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > n ? flat.slice(0, n) + '…' : flat
}

// ── prompts ─────────────────────────────────────────────────────────────────

function taskHeader(task: BenchTask): string {
  const needs = task.needs.map(n => '- ' + n.id + (n.critical ? '[关键] ' : ' ') + n.text).join('\n')
  const cons = task.constraints.length
    ? task.constraints.map(c => '- ' + c.id + ' (' + c.kind + ', ' + c.strength + '): ' + c.value).join('\n')
    : '（无）'
  return ['任务目标：' + task.goal, '查询串：' + task.query, '需求：', needs, '约束：', cons].join('\n')
}

const SYSTEM = '你是严谨的搜索评测标注员，只依据给定材料判断，不凭记忆补全。只输出一个 JSON 对象，不要任何解释。'

export function buildCandidatePrompt(
  task: BenchTask, chunk: readonly { index: number; cand: Candidate; pageNote: string }[],
): ChatMessage[] {
  const modelConstraints = task.constraints.filter(c => !RULE_KINDS.has(c.kind))
  const lines = chunk.map(({ index, cand, pageNote }) => {
    const parts = ['[' + index + '] ' + cand.url, '  标题：' + cut(cand.title, 160)]
    if (cand.snippet) parts.push('  摘要：' + cut(cand.snippet, SNIPPET_CHARS))
    if (cand.publishedAt) parts.push('  发布时间：' + cand.publishedAt)
    if (pageNote) parts.push('  ' + pageNote)
    return parts.join('\n')
  })
  const user = [
    taskHeader(task),
    '',
    '为下面每个候选标注：',
    '- rel：0 无关（含同名干扰、仅同名词）；1 仅定位（同主题但不回答需求）；2 部分支持（回答了部分需求或给出可行的替代方案）；3 直接支持且含条件（直接回答需求并满足约束）。',
    modelConstraints.length
      ? '- c：对约束 ' + modelConstraints.map(c => c.id).join('、') + ' 分别给 y（满足）/ n（不满足或违反）/ u（材料中看不出）。site 与 exclude_site 类约束由程序判断，不要标。'
      : '- c：本任务没有需要你判断的约束，给空对象 {}。',
    '- nav：true 表示该页是导航页、列表页、搜索结果页、首页或目录页，而不是具体内容页。',
    '- note：可选，不超过 20 字的理由。',
    '',
    '候选：',
    lines.join('\n'),
    '',
    '输出 JSON：{"candidates":[{"i":1,"rel":2,"c":{' + (modelConstraints[0] ? '"' + modelConstraints[0].id + '":"y"' : '') + '},"nav":false,"note":""}, ...]}，必须覆盖 ' +
      chunk[0]!.index + ' 到 ' + chunk[chunk.length - 1]!.index + ' 的每个编号。',
  ].join('\n')
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }]
}

export interface PromptBlock { ref: string; url: string; blockId: string; hash: string; heading?: string; text: string }

export function buildGoldPrompt(task: BenchTask, pages: readonly { ref: number; url: string; title?: string; blocks: readonly PromptBlock[] }[]): ChatMessage[] {
  const body = pages.map(p => ['[P' + p.ref + '] ' + p.url + (p.title ? '（' + cut(p.title, 80) + '）' : ''),
    ...p.blocks.map(b => '  (' + b.ref + ') ' + (b.heading ? '《' + cut(b.heading, 60) + '》 ' : '') + cut(b.text, BLOCK_CHARS))].join('\n')).join('\n')
  const user = [
    taskHeader(task),
    '',
    '下面是已抓取页面的文本块，每块前的括号是块编号。对每个需求，挑出能直接支撑它的块（最多 3 个，优先直接回答且写明条件的块）；如果没有任何块支撑该需求，给空数组。只在给定文本块中选择。',
    '',
    body,
    '',
    '输出 JSON：{"gold":[{"need":"' + task.needs[0]!.id + '","blocks":["1.2"]}, ...]}，必须为每个需求各给一项：' + task.needs.map(n => n.id).join('、') + '。',
  ].join('\n')
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }]
}

// ── validation ──────────────────────────────────────────────────────────────

export interface CandidateRow { rel: Relevance; checks: Map<string, Satisfied>; nav: boolean; note?: string }

const SAT: Record<string, Satisfied> = { y: 'yes', yes: 'yes', n: 'no', no: 'no', u: 'unknown', unknown: 'unknown' }

export function validateCandidateAnswer(
  json: unknown, indices: readonly number[], constraintIds: readonly string[],
): { errors: string[]; rows: Map<number, CandidateRow> } {
  const errors: string[] = []
  const rows = new Map<number, CandidateRow>()
  const list = Array.isArray(json) ? json : (json as { candidates?: unknown } | undefined)?.candidates
  if (!Array.isArray(list)) return { errors: ['缺少 candidates 数组'], rows }
  const allowed = new Set(indices)
  for (const raw of list as Record<string, unknown>[]) {
    const i = Number(raw?.i)
    if (!allowed.has(i)) { errors.push('未知编号 ' + String(raw?.i)); continue }
    if (rows.has(i)) { errors.push('重复编号 ' + i); continue }
    const rel = Number(raw.rel)
    if (!Number.isInteger(rel) || rel < 0 || rel > 3) { errors.push('编号 ' + i + ' 的 rel 必须是 0–3 的整数'); continue }
    const checks = new Map<string, Satisfied>()
    const c = (raw.c ?? {}) as Record<string, unknown>
    for (const id of constraintIds) {
      const v = SAT[String(c[id]).toLowerCase()]
      if (!v) errors.push('编号 ' + i + ' 缺少约束 ' + id + ' 的 y/n/u')
      else checks.set(id, v)
    }
    const nav = raw.nav === true || raw.nav === 'true'
    rows.set(i, { rel: rel as Relevance, checks, nav, note: typeof raw.note === 'string' ? raw.note.slice(0, 80) : undefined })
  }
  for (const i of indices) if (!rows.has(i)) errors.push('缺少编号 ' + i)
  return { errors, rows }
}

export function validateGoldAnswer(
  json: unknown, needIds: readonly string[], blockRefs: ReadonlySet<string>,
): { errors: string[]; gold: Map<string, string[]> } {
  const errors: string[] = []
  const gold = new Map<string, string[]>()
  const list = Array.isArray(json) ? json : (json as { gold?: unknown } | undefined)?.gold
  if (!Array.isArray(list)) return { errors: ['缺少 gold 数组'], gold }
  for (const raw of list as Record<string, unknown>[]) {
    const need = String(raw?.need)
    if (!needIds.includes(need)) { errors.push('未知需求 ' + need); continue }
    if (gold.has(need)) { errors.push('重复需求 ' + need); continue }
    if (!Array.isArray(raw.blocks)) { errors.push('需求 ' + need + ' 的 blocks 必须是数组'); continue }
    const refs = raw.blocks.map(String)
    const bad = refs.filter(r => !blockRefs.has(r))
    if (bad.length) { errors.push('需求 ' + need + ' 引用了不存在的块 ' + bad.join(',')); continue }
    gold.set(need, [...new Set(refs)])
  }
  for (const id of needIds) if (!gold.has(id)) errors.push('缺少需求 ' + id)
  return { errors, gold }
}

// ── one task ────────────────────────────────────────────────────────────────

async function askValidated<T>(
  ask: Ask, stage: string, messages: ChatMessage[], validate: (json: unknown) => { errors: string[]; value: T },
): Promise<T> {
  let content = await ask(stage, messages)
  let result = validate(parseJsonLoose(content))
  if (result.errors.length) {
    const note = '上次输出无效：' + result.errors.slice(0, 8).join('；') + '。请重新输出完整、合法的 JSON，不要任何解释。'
    content = await ask(stage + '#retry', [...messages, { role: 'assistant', content: content.slice(0, 6000) }, { role: 'user', content: note }])
    result = validate(parseJsonLoose(content))
    if (result.errors.length) throw new Error(stage + ': invalid output after retry: ' + result.errors.slice(0, 5).join('; '))
  }
  return result.value
}

function pageNoteFor(snapshot: CandidateSnapshot, cand: Candidate): string {
  const page = snapshot.pages.find(p => canonicalUrl(p.url) === cand.key)
  if (!page) return ''
  if (page.status !== 'ok') return '页面未能抓取（' + (page.error ?? page.status) + '）'
  const first = page.blocks[0]?.text
  return (page.shellPage ? '页面已抓取，疑似壳/导航页；' : '页面已抓取；') + (first ? '正文开头：' + cut(first, FIRST_BLOCK_CHARS) : '无正文')
}

export async function labelTask(
  task: BenchTask, snapshot: CandidateSnapshot, ask: Ask, meta: { model: string; effort?: string },
): Promise<Label> {
  const cands = candidatesOf(snapshot)
  if (!cands.length) throw new Error('snapshot has no candidates')
  const modelConstraintIds = task.constraints.filter(c => !RULE_KINDS.has(c.kind)).map(c => c.id)

  // Stage 1: candidates, in chunks.
  const rows = new Map<number, CandidateRow>()
  for (let start = 0; start < cands.length; start += CANDIDATES_PER_REQUEST) {
    const chunk = cands.slice(start, start + CANDIDATES_PER_REQUEST)
      .map((cand, k) => ({ index: start + k + 1, cand, pageNote: pageNoteFor(snapshot, cand) }))
    const indices = chunk.map(c => c.index)
    const got = await askValidated(ask, task.id + ':candidates@' + (start + 1), buildCandidatePrompt(task, chunk),
      json => { const r = validateCandidateAnswer(json, indices, modelConstraintIds); return { errors: r.errors, value: r.rows } })
    for (const [i, row] of got) rows.set(i, row)
  }

  const candidates: CandidateLabel[] = cands.map((cand, k) => {
    const row = rows.get(k + 1)!
    const item = { id: cand.url, text: candidateText(cand), meta: { url: cand.url, title: cand.title } }
    const constraintChecks: ConstraintCheck[] = task.constraints.map((c: TaskConstraint) => ({
      constraintId: c.id,
      satisfied: RULE_KINDS.has(c.kind) ? checkConstraint(c, item).satisfied : row.checks.get(c.id)!,
    }))
    const label: CandidateLabel = { url: cand.url, relevance: row.rel, constraintChecks, navPage: row.nav }
    if (row.note) label.note = row.note
    return label
  })

  // Stage 2: gold evidence among fetched blocks.
  const fetched = fetchedBlocks(snapshot)
  const gold: NeedGold[] = []
  if (!fetched.length) {
    for (const n of task.needs) gold.push({ needId: n.id, evidence: [] })
  } else {
    const needText = task.needs.map(n => n.text).join(' ') + ' ' + task.query
    let kept = fetched
    if (kept.length > MAX_BLOCKS_IN_PROMPT) {
      const scored = kept.map((fb, pos) => ({ fb, pos, s: weightedOverlap([{ text: needText, weight: 1 }], (fb.block.heading ?? '') + '\n' + fb.block.text) }))
      const top = new Set(scored.sort((a, b) => b.s - a.s || a.pos - b.pos).slice(0, MAX_BLOCKS_IN_PROMPT).map(x => x.pos))
      kept = fetched.filter((_, pos) => top.has(pos))
    }
    const pageOrder = [...new Set(kept.map(fb => fb.page.url))]
    const refMap = new Map<string, PromptBlock & { page: string }>()
    const pages = pageOrder.map((url, pi) => {
      const page = kept.find(fb => fb.page.url === url)!.page
      const blocks = kept.filter(fb => fb.page.url === url).map((fb, bi): PromptBlock => {
        const pb: PromptBlock = { ref: (pi + 1) + '.' + (bi + 1), url, blockId: fb.block.blockId, hash: fb.block.hash, heading: fb.block.heading, text: fb.block.text }
        refMap.set(pb.ref, { ...pb, page: url })
        return pb
      })
      return { ref: pi + 1, url, title: page.title, blocks }
    })
    const refs = new Set(refMap.keys())
    const got = await askValidated(ask, task.id + ':gold', buildGoldPrompt(task, pages),
      json => { const r = validateGoldAnswer(json, task.needs.map(n => n.id), refs); return { errors: r.errors, value: r.gold } })
    for (const n of task.needs) {
      gold.push({
        needId: n.id,
        evidence: (got.get(n.id) ?? []).map(ref => { const b = refMap.get(ref)!; return { url: b.url, blockId: b.blockId, hash: b.hash } }),
      })
    }
  }

  const createdAt = new Date().toISOString()
  return {
    version: LABEL_VERSION,
    taskId: task.id,
    snapshotHarvestedAt: snapshot.harvestedAt,
    labeler: { kind: 'llm', id: meta.model, model: meta.model, effort: meta.effort, promptVersion: PROMPT_VERSION, createdAt, reviewed: false },
    labeledAt: createdAt,
    candidates,
    gold,
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const f2 = (n: number): string => n.toFixed(4)

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2), {
    values: ['tasks', 'limit', 'effort', 'model', 'max-tokens', 'max-total-tokens', 'max-spend-cny', 'min-balance-cny', 'candidates-dir', 'labels-dir'],
    booleans: ['force', 'dry-run'],
  })
  const maxSpend = numberFlag(flags, 'max-spend-cny', 2)
  const minBalance = numberFlag(flags, 'min-balance-cny', 41)
  const model = typeof flags.model === 'string' ? flags.model : DEEPSEEK_MODEL
  const effort = (typeof flags.effort === 'string' ? flags.effort : 'low') as Effort
  const maxTokens = numberFlag(flags, 'max-tokens', 12000)
  // Belt and braces: the balance API only has 0.01 CNY resolution and can lag, so also cap total tokens.
  const maxTotalTokens = numberFlag(flags, 'max-total-tokens', 3_000_000)
  let totalTokens = 0
  if (effort && !EFFORTS.includes(effort)) throw new Error('--effort must be one of ' + EFFORTS.join('|') + ' (low or high recommended)')
  const candidatesDir = typeof flags['candidates-dir'] === 'string' ? path.resolve(flags['candidates-dir']) : CANDIDATES_DIR
  const labelsDir = typeof flags['labels-dir'] === 'string' ? path.resolve(flags['labels-dir']) : LABELS_DIR
  const ledgerFile = path.join(labelsDir, '_ledger.jsonl')

  let tasks = loadTasks()
  const only = listFlag(flags, 'tasks')
  if (only) {
    const unknown = only.filter(id => !tasks.some(t => t.id === id))
    if (unknown.length) throw new Error('unknown task ids: ' + unknown.join(', '))
    tasks = only.map(id => tasks.find(t => t.id === id)!)
  }
  if (flags.limit !== undefined) tasks = tasks.slice(0, numberFlag(flags, 'limit', tasks.length))

  if (flags['dry-run']) {
    for (const t of tasks) {
      const snap = readSnapshotFile(candidatesDir, t.id)
      if (!snap) { console.log(t.id + ': no snapshot'); continue }
      const cands = candidatesOf(snap)
      const chars = buildCandidatePrompt(t, cands.slice(0, CANDIDATES_PER_REQUEST).map((cand, k) => ({ index: k + 1, cand, pageNote: pageNoteFor(snap, cand) })))
        .reduce((n, m) => n + m.content.length, 0)
      console.log(t.id + ': ' + cands.length + ' candidates, ' + fetchedBlocks(snap).length + ' blocks, candidate prompt ~' + chars + ' chars')
    }
    return 0
  }

  const client = new DeepSeekClient({ apiKey: process.env.DEEPSEEK_API_KEY ?? '' })
  const guard = new BudgetGuard({ getBalance: () => client.balanceCny(), maxSpend, minBalance })
  const start = await guard.start()
  console.log('balance at start: ' + f2(start.balance) + ' CNY (max spend ' + maxSpend + ', min balance ' + minBalance + ')')
  if (!start.ok) { console.log('STOP: ' + start.reason); return 2 }

  fs.mkdirSync(labelsDir, { recursive: true })
  const ledger = (entry: Record<string, unknown>): void => {
    fs.appendFileSync(ledgerFile, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n')
  }
  ledger({ type: 'start', balance: start.balance, maxSpend, minBalance, model, effort })

  let done = 0
  let stopped: string | undefined
  for (const task of tasks) {
    if (!flags.force && readLabel(labelsDir, task.id)) { console.log(task.id + ': already labeled, skip'); continue }
    const snapshot = readSnapshotFile(candidatesDir, task.id)
    if (!snapshot) { console.log(task.id + ': no snapshot, skip'); continue }
    let inTokens = 0
    let outTokens = 0
    const ask: Ask = async (stage, messages) => {
      if (guard.lastStatus && !guard.lastStatus.ok) throw new BudgetStopError(guard.lastStatus.reason ?? 'budget guard stopped')
      // Reasoning tokens count against max_tokens; if they eat the whole budget (finish_reason
      // 'length', empty content) fall back to no reasoning for this request.
      let useEffort: Effort | undefined = effort
      for (;;) {
        const res = await client.chat({ model, effort: useEffort, json: true, maxTokens, messages })
        inTokens += res.inputTokens
        outTokens += res.outputTokens
        totalTokens += res.inputTokens + res.outputTokens
        const status = await guard.check()
        ledger({ type: 'request', taskId: task.id, stage, model, effort: useEffort, finishReason: res.finishReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens, latencyMs: res.latencyMs, balance: status.balance, spend: status.spend })
        if (res.finishReason === 'length' && !res.content.trim() && useEffort !== 'none') {
          if (!status.ok) throw new BudgetStopError(status.reason ?? 'budget guard stopped')
          useEffort = 'none'
          continue
        }
        return res.content
      }
    }
    try {
      const label = await labelTask(task, snapshot, ask, { model, effort })
      writeLabel(labelsDir, label)
      done++
      const s = guard.lastStatus!
      ledger({ type: 'task', taskId: task.id, ok: true, candidates: label.candidates.length, inputTokens: inTokens, outputTokens: outTokens, balance: s.balance, spend: s.spend })
      console.log(task.id + ': labeled ' + label.candidates.length + ' candidates, tokens in/out ' + inTokens + '/' + outTokens + ', balance ' + f2(s.balance) + ' (spent ' + f2(s.spend) + ')')
    } catch (error) {
      const s = guard.lastStatus
      ledger({ type: 'task', taskId: task.id, ok: false, error: (error as Error).message, inputTokens: inTokens, outputTokens: outTokens, balance: s?.balance, spend: s?.spend })
      if (error instanceof BudgetStopError) { stopped = error.message; break }
      console.log(task.id + ': FAILED ' + (error as Error).message)
    }
    if (guard.lastStatus && !guard.lastStatus.ok) { stopped = guard.lastStatus.reason; break }
    if (totalTokens >= maxTotalTokens) { stopped = 'total tokens ' + totalTokens + ' reached --max-total-tokens ' + maxTotalTokens; break }
  }
  const end = guard.lastStatus!
  ledger({ type: 'end', labeled: done, stopped, balance: end.balance, spend: end.spend })
  console.log('labeled ' + done + ' task(s); balance ' + f2(end.balance) + ' CNY, spent ' + f2(end.spend) + (stopped ? '; STOPPED: ' + stopped : ''))
  return stopped ? 2 : 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then(code => process.exit(code), error => { console.error((error as Error).message); process.exit(1) })
}
