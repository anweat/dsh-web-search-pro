/**
 * Shared types for the offline evaluation bench (dev-plan §4.2 and §6.2).
 * The TaskSpec / Need / Constraint shapes mirror the plan; the snapshot and
 * label shapes are bench-local and versioned by `SNAPSHOT_VERSION` / `LABEL_VERSION`.
 * @module bench/types
 */

// ── Plan types (§4.2) ───────────────────────────────────────────────────────

export type Profile = 'docs_code' | 'news_fact' | 'academic' | 'experience' | 'compare' | 'general'
export const PROFILES: readonly Profile[] = ['docs_code', 'news_fact', 'academic', 'experience', 'compare', 'general']

export type ConstraintKind =
  | 'must_term' | 'exclude_term' | 'entity' | 'version' | 'time_window'
  | 'site' | 'exclude_site' | 'language' | 'region' | 'source_type'
export const CONSTRAINT_KINDS: readonly ConstraintKind[] = [
  'must_term', 'exclude_term', 'entity', 'version', 'time_window',
  'site', 'exclude_site', 'language', 'region', 'source_type',
]

export type ConstraintStrength = 'hard' | 'soft'
export type ConstraintOrigin = 'param' | 'query_syntax' | 'rule_extracted' | 'judge_extracted'

export interface Need { id: string; text: string; critical: boolean }

export interface Constraint {
  id: string
  kind: ConstraintKind
  value: string
  strength: ConstraintStrength
  origin: ConstraintOrigin
}

/** Placeholder: the plan leaves BudgetProfile open; experiments fill it in. */
export type BudgetProfile = Record<string, unknown>

export interface TaskSpec {
  goal: string
  query: string
  profile?: Profile
  needs: Need[]
  constraints: Constraint[]
  budget: BudgetProfile
}

// ── Task set (bench/tasks/tasks.v1.jsonl) ───────────────────────────────────

export type TaskLang = 'zh' | 'en' | 'mixed'
export const TASK_LANGS: readonly TaskLang[] = ['zh', 'en', 'mixed']

/** A task-set constraint is hand-authored, so it carries no `origin` (it plays the role of a `param`). */
export type TaskConstraint = Omit<Constraint, 'origin'> & { origin?: ConstraintOrigin }

export interface BenchTask {
  id: string
  profile: Profile
  lang: TaskLang
  goal: string
  query: string
  needs: Need[]
  constraints: TaskConstraint[]
  /** Short labels for what makes the task hard (see bench/README.md for the vocabulary). */
  traps: string[]
  notes: string
}

/** Convert a bench task to the plan's TaskSpec (constraints become `param`-origin). */
export function toTaskSpec(task: BenchTask, budget: BudgetProfile = {}): TaskSpec {
  return {
    goal: task.goal,
    query: task.query,
    profile: task.profile,
    needs: task.needs,
    constraints: task.constraints.map(c => ({ ...c, origin: c.origin ?? 'param' })),
    budget,
  }
}

// ── Candidate snapshot (bench/data/candidates.v1/<taskId>.json) ────────────

export const SNAPSHOT_VERSION = 1

export type EngineRunStatus = 'ok' | 'empty' | 'error'

export interface SnapshotResult {
  rank: number
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
}

export interface EngineRun {
  engine: string
  /** The exact query sent (may be a `site:` variant of the task query). */
  query: string
  status: EngineRunStatus
  /** Error code + message for `error`; for `empty` the engine's own note (e.g. "may be rate-limited"). */
  error?: string
  /** Wall time of the final attempt, in ms. */
  ms: number
  /** Number of attempts made (1, or 2 after a back-off retry). Omitted when 1. */
  attempts?: number
  results: SnapshotResult[]
}

export interface Block {
  /** `b_` + 12 hex of sha1(url + ':' + start). Stable for the same url + text layout. */
  blockId: string
  /** Heading path, `A > B > C`, when the block sits under a heading. */
  heading?: string
  text: string
  /** Character offsets into the page `text`; `text === page.text.slice(start, end)`. */
  start: number
  end: number
  /** 16 hex of sha1(text): detects drift when a page is re-fetched. */
  hash: string
}

export type PageStatus = 'ok' | 'error' | 'skipped'

export interface PageSnapshot {
  url: string
  fetchedAt: string
  status: PageStatus
  /** Extraction path: `http` (plain HTTP + extractText). */
  source: string
  httpStatus?: number
  finalUrl?: string
  contentType?: string
  title?: string
  text: string
  /** Why the page is `error` / `skipped` (timeout, non-text, HTTP 403, ...). */
  error?: string
  /** `detectShellPage` verdict (navigation / JS shell). */
  shellPage?: boolean
  truncated?: boolean
  /** `engine#rank` provenance of this URL. */
  from: string[]
  blocks: Block[]
}

export interface CandidateSnapshot {
  version: typeof SNAPSHOT_VERSION
  taskId: string
  harvestedAt: string
  engineRuns: EngineRun[]
  pages: PageSnapshot[]
}

// ── Labels (bench/data/labels.v1/<taskId>.json; written by humans / LLM judges later) ──

export const LABEL_VERSION = 1

/** 0 irrelevant / 1 locates the topic only / 2 partially supports / 3 directly supports incl. conditions (matches §4.3 S6). */
export type Relevance = 0 | 1 | 2 | 3
export type Satisfied = 'yes' | 'no' | 'unknown'

export interface ConstraintCheck { constraintId: string; satisfied: Satisfied }

export interface CandidateLabel {
  url: string
  relevance: Relevance
  constraintChecks: ConstraintCheck[]
  /** The page is a navigation / listing / search shell rather than content. */
  navPage?: boolean
  note?: string
}

export interface GoldEvidence {
  url: string
  blockId: string
  /** Block content hash at labeling time; lets labels be re-mapped if blocks are re-cut. */
  hash: string
}

export interface NeedGold {
  needId: string
  /** Empty = no page in the snapshot supports the need. */
  evidence: GoldEvidence[]
}

export interface Label {
  version: typeof LABEL_VERSION
  taskId: string
  /** `harvestedAt` of the snapshot this label was made against. */
  snapshotHarvestedAt: string
  labeler: {
    kind: 'human' | 'llm'
    id: string
    /** LLM labelers only: model, reasoning effort, prompt template version, creation time, human-review flag. */
    model?: string
    effort?: string
    promptVersion?: string
    createdAt?: string
    reviewed?: boolean
  }
  labeledAt: string
  candidates: CandidateLabel[]
  gold: NeedGold[]
}

export type Split = 'calibration' | 'test'
