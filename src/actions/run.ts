/**
 * Action dispatch: validate arguments, run the executor under a deadline, and
 * wrap everything in the result envelope.
 *
 * Both tool surfaces call {@link runAction}, so the envelope and the error
 * codes are identical whether the model reaches an action through `web_call`
 * or through a flat per-action tool.
 * @module web-search-pro/actions/run
 */

import type { ActionContext, ActionEnvelope, ActionErrorBody, ActionServices } from './types.ts'
import { CALL_TOOL, INDEX_TOOL, findAction, similarActions } from './registry.ts'
import { compactSchema, validateArgs } from './schema.ts'
import { DeadlineError, abortedByDeadline, hintFor, mapError } from './errors.ts'
import { isLegacyToolName, mapLegacyCall } from './legacy.ts'

/** Serialized-result cap; larger results get their longest strings shortened. */
export const RESULT_CHAR_LIMIT = 100_000

function failure(action: string, error: ActionErrorBody): ActionEnvelope {
  return { ok: false, action, error }
}

/** Normalize an executor's return value into an object result. */
function asResult(value: unknown): Record<string, unknown> {
  // A JSON round trip drops `undefined` members, which the Host's lossless-JSON output check would reject.
  const plain = JSON.parse(JSON.stringify(value ?? null)) as unknown
  if (plain !== null && typeof plain === 'object' && !Array.isArray(plain)) return plain as Record<string, unknown>
  if (Array.isArray(plain)) return { items: plain }
  return { value: plain }
}

/**
 * Shorten the longest string fields until the serialized result fits. The
 * result stays valid JSON; the envelope reports how much text was dropped.
 */
export function truncateResult(result: Record<string, unknown>, limit = RESULT_CHAR_LIMIT): { result: Record<string, unknown>; truncation?: { omitted: number; reason: string } } {
  if (JSON.stringify(result).length <= limit) return { result }
  let omitted = 0
  const copy = structuredClone(result)
  const strings: { holder: Record<string, unknown> | unknown[]; key: string | number; length: number }[] = []
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach((entry, index) => { if (typeof entry === 'string') strings.push({ holder: value, key: index, length: entry.length }); else walk(entry) })
    else if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === 'string') strings.push({ holder: value as Record<string, unknown>, key, length: entry.length })
        else walk(entry)
      }
    }
  }
  walk(copy)
  strings.sort((a, b) => b.length - a.length)
  for (const slot of strings) {
    const size = JSON.stringify(copy).length
    if (size <= limit) break
    const text = (slot.holder as Record<string | number, string>)[slot.key]!
    const excess = size - limit
    const keep = Math.max(200, text.length - excess - 80)
    if (keep >= text.length) continue
    omitted += text.length - keep
    ;(slot.holder as Record<string | number, string>)[slot.key] = text.slice(0, keep) + '…[truncated]'
  }
  return { result: copy, truncation: { omitted, reason: `result exceeded ${limit} characters; longest text fields were shortened` } }
}

function withDeadline<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent: AbortSignal): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  const controller = new AbortController()
  const onAbort = (): void => controller.abort(parent.reason)
  if (parent.aborted) controller.abort(parent.reason)
  else parent.addEventListener('abort', onAbort, { once: true })
  const work = run(controller.signal).then(value => ({ timedOut: false as const, value }))
  // If the deadline wins, the work may still reject later; swallow it.
  work.catch(() => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<{ timedOut: true }>(resolve => {
    timer = setTimeout(() => {
      controller.abort(new DeadlineError('deadline'))
      resolve({ timedOut: true })
    }, timeoutMs)
  })
  return Promise.race([work, deadline]).finally(() => {
    clearTimeout(timer)
    parent.removeEventListener('abort', onAbort)
  })
}

/** The reply to a `web_call` whose action is not in the registry. */
export function unknownActionFailure(name: unknown, args?: unknown): ActionEnvelope {
  const label = typeof name === 'string' ? name : String(name)
  if (isLegacyToolName(label)) {
    const input = (args && typeof args === 'object' && !Array.isArray(args) ? args : {}) as Record<string, unknown>
    const mapped = mapLegacyCall(label, input)
    return failure(label, {
      code: 'UNKNOWN_ACTION',
      message: `${label} is an old tool name; it no longer exists.`,
      hint: `Use ${CALL_TOOL}({action:"${mapped.action}", args:${JSON.stringify(mapped.args)}}). ${INDEX_TOOL}({action:"${mapped.action}"}) shows its schema.`,
    })
  }
  const close = typeof name === 'string' ? similarActions(name) : []
  return failure(label, {
    code: 'UNKNOWN_ACTION',
    message: `Unknown action: ${label}`,
    hint: `Actions are named group.action. Call ${INDEX_TOOL}() to list groups${close.length ? `; similar: ${close.join(', ')}` : ''}.`,
  })
}

/**
 * Run one action and return the envelope. Never throws: every failure is a
 * structured error the model can act on.
 */
export async function runAction(name: unknown, rawArgs: unknown, services: ActionServices & { signal: AbortSignal }): Promise<ActionEnvelope> {
  const action = findAction(name)
  if (!action) return unknownActionFailure(name, rawArgs)
  const validation = validateArgs(action.params, rawArgs)
  if (!validation.ok) {
    return failure(action.name, {
      code: 'INVALID_ARGS',
      message: validation.errors.join('; '),
      hint: 'Fix the arguments to match the schema below and call again.',
      schema: compactSchema(action.name, action.params),
    })
  }
  if (services.signal.aborted) return failure(action.name, { code: 'CANCELLED', message: 'cancelled before start', hint: hintFor('CANCELLED')! })

  const timeoutMs = action.timeoutMs(services.config)
  let workSignal: AbortSignal = services.signal
  try {
    const outcome = await withDeadline(signal => {
      workSignal = signal
      const ctx: ActionContext = { ...services, signal }
      return action.execute(validation.value, ctx)
    }, timeoutMs, services.signal)
    if (outcome.timedOut) {
      return failure(action.name, {
        code: 'DEADLINE',
        message: `${action.name} did not finish within ${timeoutMs} ms`,
        hint: action.mutating ? 'It may or may not have taken effect: check with history.list / cache.stats before retrying.' : hintFor('DEADLINE')!,
      })
    }
    const { result, truncation } = truncateResult(asResult(outcome.value))
    return { ok: true, action: action.name, result, ...truncation ? { truncation } : {} }
  } catch (error) {
    const body = mapError(error, { signal: workSignal })
    if (body.code === 'INVALID_ARGS') body.schema = compactSchema(action.name, action.params)
    return failure(action.name, body)
  }
}

/** Text of an envelope for the model: the action's own rendering of a result, or the error as compact JSON. */
export function renderEnvelope(envelope: ActionEnvelope, args: Record<string, unknown> = {}): string {
  if (!envelope.ok || !envelope.result) return JSON.stringify({ ok: false, action: envelope.action, error: envelope.error })
  const action = findAction(envelope.action)
  let text: string
  try { text = action ? action.render(envelope.result, args) : JSON.stringify(envelope.result) } catch { text = JSON.stringify(envelope.result) }
  return envelope.truncation ? text + `\n\n[truncated: ${envelope.truncation.reason}]` : text
}
