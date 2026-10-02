/**
 * Shared types of the provider-agnostic judge layer (dev-plan M5, design §7).
 *
 * A judge is split in two: a PROTOCOL (how a request is encoded and the answer
 * decoded: `systemone`, `rerank`, `llm`) and a PROVIDER (where it is sent: base
 * URL, model, credentials reference, limits, calibration). Any provider that
 * speaks a supported protocol can serve S6; nothing else in the pipeline knows
 * which one is configured.
 * @module web-search-pro/pipeline/judges/types
 */

import type { CorpusBlock } from '../corpus.ts'
import type { RubricRef } from '../rubrics.ts'
import type { BlockGrade, Need, TaskSpec } from '../types.ts'

// ── scorer contract (re-exported by ../score.ts) ────────────────────────────

export type ScoreTask = Pick<TaskSpec, 'goal' | 'query' | 'needs' | 'constraints'>

export interface ScoreBlock { blockId: string; url: string; heading?: string; text: string }
export interface ScoreJob { need: Need; blocks: ScoreBlock[] }

export interface ScoreContext {
  signal?: AbortSignal | undefined
  /** Epoch ms after which no new request may start (the run's overall deadline). */
  deadline?: number | undefined
  /** Every block of the pages read (the rule scorer takes term statistics from it, dev-plan M3b); absent = no statistics. */
  corpus?: readonly CorpusBlock[] | undefined
}

export interface ScoreUsage {
  requests: number
  questions: number
  cacheHits: number
  inputTokens: number
  outputTokens: number
  /** Some input tokens are the plugin's estimate (the service reported none). */
  estimated?: boolean
}

export interface ScoreOutcome {
  /** needId -> blockId -> grade. Questions that got no answer are absent. */
  grades: Map<string, Map<string, BlockGrade>>
  usage?: ScoreUsage
  /** Non-fatal problems (unanswered questions, ...). */
  notes?: string[]
}

export interface Scorer {
  id: string
  model: string
  /** The judge rubric behind the grades (rubric-driven protocols); recorded with their results. */
  rubricRef?: RubricRef | undefined
  /** Which provider / protocol / model / calibration produced the grades (model scorers only). */
  provider?: ProviderRecord | undefined
  score(task: ScoreTask, jobs: readonly ScoreJob[], ctx?: ScoreContext): Promise<ScoreOutcome>
}

// ── providers ───────────────────────────────────────────────────────────────

export type ProtocolId = 'systemone' | 'rerank' | 'llm'
export const PROTOCOLS: readonly ProtocolId[] = ['systemone', 'rerank', 'llm']

/** Request-shaping limits; every field is optional and defaults per protocol. */
export interface ProviderLimits {
  /** systemone / llm: questions (pairs) per request (systemone service limit: 32). */
  maxQuestionsPerRequest?: number
  /** Estimated input tokens per request (systemone hosted limit 32768 for the request total). */
  requestTokenBudget?: number
  /** A candidate (heading + block) is cut to this many characters. */
  blockChars?: number
  /** A need is cut to this many characters. */
  maxNeedChars?: number
  /** The shared task state is cut to this many characters (default: the rubric's). */
  maxStateChars?: number
  /** Request body size bound in bytes (systemone). */
  maxBodyBytes?: number
  /** rerank: documents per request. */
  maxDocumentsPerRequest?: number
  /** Retries per request for 429 / 503 / 529 / network errors. */
  maxRetries?: number
  timeoutMs?: number
  /** Hard cap on HTTP attempts of one search (retries and splits included). */
  requestCap?: number
}

/**
 * Monotone piecewise-linear map from a provider's raw score to a grade 0..3:
 * `points` are `[raw, grade]` pairs with strictly increasing raw values and
 * non-decreasing grades; outside the range the end grades hold. A reranker's
 * relevance scores are NOT grades and differ per model and per task language:
 * they are never mixed or thresholded without such a map.
 */
export interface Calibration {
  /** Label of the calibration (a new fit gets a new version; it is recorded with every result). */
  version: string
  points: [number, number][]
}

export interface ProviderPrice {
  /** Price per million input tokens, in `currency`. Unset = unknown (the ledger records amount null, never 0). */
  inputPerMTokens: number
  outputPerMTokens?: number
  currency: string
}

export interface ProviderConfig {
  /** Stable id (`bocha-jev`, `jina-rerank`, or a user-chosen one). */
  id: string
  protocol: ProtocolId
  /** `https://host[/prefix]`; the protocol's path is appended unless `path` is set. */
  baseUrl: string
  model: string
  /** Credentials ref / environment variable name of the API key; absent = no authentication (local servers). */
  keyRef?: string
  /** Endpoint path override (default per protocol: /v1/systemone, /rerank, /chat/completions). */
  path?: string
  limits?: ProviderLimits
  calibration?: Calibration
  /** Rubric used by the rubric-driven protocols (systemone, llm); default `score.support`. */
  rubricId?: string
  /** Extra top-level request fields (e.g. Laya `max_len`, Jina `return_documents`). */
  extraBody?: Record<string, unknown>
  price?: ProviderPrice
  /** `plain`: estimate tokens as the text is; `expanded`: Jev bills every question once per level (about 4x). Default per protocol. */
  tokenModel?: 'expanded' | 'plain'
  /** Human label used in messages (`Jev`); default the id. */
  label?: string
  /** Preset never called against the live service by the plugin authors. */
  unverified?: boolean
  /** Preset fields that are placeholders the user must replace. */
  placeholders?: string[]
  notes?: string
  /** Scorer id recorded in stats / evidence rows (legacy `jev` for bocha-jev); default the id. */
  recordedId?: string
}

/** What results record about the judge behind them. */
export interface ProviderRecord {
  id: string
  protocol: ProtocolId
  model: string
  /** `version#hash` of the calibration when one is applied. */
  calibration?: string
}

// ── offline answer cache (the bench plugs its judge cache in here) ──────────

export interface JudgeProbe {
  state: string
  need: string
  /** Full candidate text (heading + block), before trimming. */
  candidate: string
  /** Trimmed task description (what `{task}` renders to). */
  task?: string
  /** `id@version#hash` of the rubric that worded the question: a cache must key on it. */
  rubric?: string
  /** `provider|protocol|model`: answers of one provider are never reused for another. */
  provider?: string
}
/** `grade` is the provider's RAW answer (rubric level / relevance score), before rescaling and calibration. */
export interface JudgeCachedAnswer { grade: number; probabilities?: Record<string, number> }
export interface JudgeAnswerCache {
  get(probe: JudgeProbe): JudgeCachedAnswer | undefined
  set(probe: JudgeProbe, answer: JudgeCachedAnswer): void
}

// ── usage metering (implemented by ../ledger.ts) ────────────────────────────

export interface UsageSettled { inputTokens: number; outputTokens: number; estimated: boolean }

/** One reserved model call: exactly one of the three closing methods is called. */
export interface UsageTicket {
  /** The service answered: actual tokens (an absent input count is replaced by the reservation estimate, flagged estimated). */
  settle(actual: { inputTokens?: number | undefined; outputTokens?: number | undefined }): UsageSettled
  /** The call went out but its outcome is unknown (network error, timeout, abort): the estimate stays booked, flagged estimated. */
  unknown(): UsageSettled
  /** The service refused the request (4xx / 5xx): the request is counted, no tokens. */
  refused(): void
}

export interface UsageMeter {
  /** Reserve the estimate before a call; throws BudgetExceededError when a cap would be passed. */
  reserve(estimate: { inputTokens: number }): UsageTicket
  /** Input tokens that could still be reserved now (Infinity = no limit known): lets a scorer size its requests. */
  headroom(): number
}
