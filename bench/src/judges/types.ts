/**
 * Judge interface for the offline bench (dev-plan §4.4). Batch-oriented: one
 * `evaluate(state, question template, items)` call judges many candidates against
 * the same question. Unlike the plan sketch, `evaluate` needs no ExecutionContext
 * (the bench has no host) and the question carries a rendered template with
 * `{candidate}` still open; each judge binds it per item.
 * @module bench/judges/types
 */

import type { TaskConstraint } from '../types.ts'

export type JudgeKind = 'noul' | 'score' | 'choice'

/** Versioned, data-only rubric (bench/rubrics/*.json). */
export interface Rubric {
  /** e.g. `gate.single.v1` — the stable id used in cache keys and result rows. */
  id: string
  version: string
  lang: 'zh'
  kind: JudgeKind
  description: string
  /** Template with whitelisted variables: {task} {need} {constraint} {candidate}. */
  instructions: string
  /** score: ordered level descriptions (index = grade). */
  criteria?: string[]
  /** choice: label -> description. */
  options?: Record<string, string>
  /** score: caps of the shared task description / the candidate text (plugin rubric limits apply). */
  maxStateChars?: number
  maxCandidateChars?: number
}

export const RUBRIC_VARIABLES = ['task', 'need', 'constraint', 'candidate'] as const
export type RubricVariable = typeof RUBRIC_VARIABLES[number]

export interface JudgeItem {
  /** Caller-chosen stable id (URL, blockId, ...). */
  id: string
  /** The candidate text bound to `{candidate}` (title + snippet, or block text). */
  text: string
  /** Structured hints for rule-based judges: `url`, `title`, `publishedAt`, `heading`. */
  meta?: Record<string, string>
}

/** Structured task context; only the rule judge reads it (remote judges see rendered text only). */
export interface JudgeContext {
  goal: string
  query: string
  /** Text of the need(s) this question is about. */
  needs: string[]
  /** All task constraints (rule judge applies them in gate.single). */
  constraints: TaskConstraint[]
  /** The single constraint this question is about (gate.constraint). */
  constraint?: TaskConstraint
}

export interface JudgeQuestion {
  kind: JudgeKind
  rubricId: string
  rubricVersion: string
  /** Rendered instructions; `{candidate}` is substituted per item (see `bindCandidate`). */
  instructions: string
  criteria?: string[]
  options?: Record<string, string>
  context?: JudgeContext
}

export interface Usage {
  inputTokens: number
  outputTokens: number
}

export interface JudgeResult {
  id: string
  /** noul: 'true' | 'false'; choice: the chosen label; score: rounded grade as string. */
  decision?: string
  /** noul: probability of true; choice: probability of the chosen option. */
  prob?: number
  /** score: grade expectation (not a probability). */
  grade?: number
  probabilities?: Record<string, number>
  judge: string
  model?: string
  rubricId: string
  rubricVersion: string
  /** Wall time of the request that produced this result (0 for rule judges). */
  latencyMs: number
  /** Request id, shared by all items answered in one remote call; absent for cache hits and the rule judge. */
  requestId?: string
  /** Number of items answered in that request. */
  batchSize?: number
  usage?: Usage
  cached?: boolean
  /** The service reported that it truncated this input to its token budget. */
  truncated?: boolean
  /** Set when the judge could not answer this item (parse failure, ...). */
  error?: string
}

export interface Readiness {
  ready: boolean
  detail?: string
}

export interface Judge {
  id: string
  /** Model / checkpoint label folded into cache keys. */
  model: string
  ready(): Promise<Readiness>
  evaluate(state: string, question: JudgeQuestion, items: readonly JudgeItem[]): Promise<JudgeResult[]>
}

/** Thrown by remote judges when a configured hard request cap is reached. */
export class RequestCapError extends Error {
  constructor(public readonly judge: string, public readonly cap: number) {
    super(judge + ': request cap reached (' + cap + ')')
    this.name = 'RequestCapError'
  }
}

/** Thrown when a spend / balance guard says stop. */
export class BudgetStopError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BudgetStopError'
  }
}
