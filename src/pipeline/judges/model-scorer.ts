/**
 * Base of the model-backed scorers (one subclass per protocol). It owns what is
 * the same whatever the protocol: the transport (retries, cap, metering), the
 * provider record that results carry, and the calibration of raw scores.
 * @module web-search-pro/pipeline/judges/model-scorer
 */

import { applyCalibration, calibrationKey } from './calibration.ts'
import { BudgetExceededError, JudgeError } from './errors.ts'
import { JudgeHttp, sleepMs, type HttpOptions } from './http.ts'
import type { Calibration, JudgeAnswerCache, ProtocolId, ProviderRecord, ScoreContext, ScoreJob, ScoreOutcome, ScoreTask, ScoreUsage, Scorer, UsageMeter } from './types.ts'
import type { RubricRef } from '../rubrics.ts'

export interface ModelScorerOptions {
  /** Scorer id recorded in stats / evidence rows. */
  id: string
  /** Name in messages. */
  label: string
  model: string
  /** Full endpoint URL. */
  url: string
  apiKey?: string | undefined
  headers?: Record<string, string> | undefined
  extraBody?: Record<string, unknown> | undefined
  fetchImpl?: typeof fetch | undefined
  sleep?: ((ms: number) => Promise<void>) | undefined
  meter?: UsageMeter | undefined
  cache?: JudgeAnswerCache | undefined
  calibration?: Calibration | undefined
  /** Provider identity recorded with results; absent for a bare scorer built outside the provider layer. */
  provider?: { id: string; protocol: ProtocolId } | undefined
  maxRetries?: number | undefined
  timeoutMs?: number | undefined
  requestCap?: number | undefined
  maxRetryWaitMs?: number | undefined
  capError?: ((cap: number) => Error) | undefined
}

export abstract class ModelScorerBase implements Scorer {
  readonly id: string
  readonly model: string
  readonly provider: ProviderRecord | undefined
  abstract readonly rubricRef: RubricRef | undefined
  protected readonly label: string
  protected readonly http: JudgeHttp
  protected readonly calibration: Calibration | undefined
  protected readonly cache: JudgeAnswerCache | undefined
  protected readonly extraBody: Record<string, unknown>

  protected constructor(options: ModelScorerOptions) {
    this.id = options.id
    this.label = options.label
    this.model = options.model
    this.calibration = options.calibration
    this.cache = options.cache
    this.extraBody = options.extraBody ?? {}
    this.provider = options.provider
      ? { id: options.provider.id, protocol: options.provider.protocol, model: options.model, ...options.calibration ? { calibration: calibrationKey(options.calibration) } : {} }
      : undefined
    const http: HttpOptions = {
      url: options.url, apiKey: options.apiKey, headers: options.headers, label: options.label,
      fetchImpl: options.fetchImpl ?? globalThis.fetch, sleep: options.sleep ?? sleepMs,
      timeoutMs: options.timeoutMs ?? 20_000, maxRetries: options.maxRetries ?? 2, requestCap: options.requestCap, meter: options.meter,
      maxRetryWaitMs: options.maxRetryWaitMs, capError: options.capError,
    }
    this.http = new JudgeHttp(http)
  }

  /** HTTP attempts made so far (retries and splits included). */
  get requests(): number { return this.http.requests }

  /** `provider|protocol|model` for cache probes: answers of one provider are never reused for another. */
  protected get providerKey(): string | undefined {
    return this.provider ? this.provider.id + '|' + this.provider.protocol + '|' + this.provider.model : undefined
  }

  /** A grade on the 0..3 scale -> the calibrated grade (identity without a calibration). */
  protected shape(grade: number): number {
    return this.calibration ? applyCalibration(this.calibration, grade) : grade
  }

  /**
   * Run `run` over the request chunks in order. `run` returns how many of the chunk's questions went unanswered.
   * A failed chunk only loses its own questions; a refused reservation stops the remaining chunks (never asked);
   * an abort or a fatal error (bad key, request cap) propagates.
   */
  protected async dispatch<Q>(chunks: readonly Q[][], run: (chunk: Q[]) => Promise<number>, ctx: ScoreContext): Promise<Dispatch> {
    const out: Dispatch = { failed: 0, notes: [] }
    for (const chunk of chunks) {
      if (out.budgetStop) { out.failed += chunk.length; continue }
      try {
        out.failed += await run(chunk)
      } catch (error) {
        if (ctx.signal?.aborted) throw error
        if (error instanceof BudgetExceededError) { out.budgetStop = error; out.failed += chunk.length; continue }
        if (error instanceof JudgeError && error.fatal) throw error
        out.failed += chunk.length
        out.notes.push((error as Error).message)
      }
    }
    return out
  }

  /**
   * Fill the usage totals and the notes after `dispatch`. Throws when the model stage produced (almost) nothing so the
   * caller falls back to the rule grades: nothing asked because of the budget, or more than half the questions unanswered.
   * @returns the notes
   */
  protected conclude(d: Dispatch, usage: ScoreUsage, counts: { total: number; asked: number; requestsBefore: number }): string[] {
    usage.requests = this.requests - counts.requestsBefore
    usage.questions = counts.asked - d.failed
    if (d.budgetStop) {
      if (usage.questions === 0 && usage.cacheHits === 0) throw d.budgetStop
      d.notes.unshift(d.budgetStop.message)
    }
    if (d.failed) d.notes.push(d.failed + ' of ' + counts.total + ' ' + this.label + ' questions got no answer')
    if (counts.total && d.failed / counts.total > 0.5) throw new JudgeError(this.label + ' answered only ' + (counts.total - d.failed) + ' of ' + counts.total + ' questions' + (d.notes[0] ? ' (' + d.notes[0] + ')' : ''))
    return d.notes
  }

  abstract score(task: ScoreTask, jobs: readonly ScoreJob[], ctx?: ScoreContext): Promise<ScoreOutcome>
}

export interface Dispatch { failed: number; notes: string[]; budgetStop?: BudgetExceededError | undefined }
