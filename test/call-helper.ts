import { findAction } from '../src/actions/registry.ts'
import { renderEnvelope } from '../src/actions/run.ts'

/** A failed action, surfaced as an exception so tests can keep asserting on the message. */
export class ActionFailure extends Error {
  constructor(message: string, readonly code: string, readonly hint?: string, readonly schema?: string) {
    super(message)
    this.name = 'ActionFailure'
  }
}

/** The full result envelope of one `web_call`. */
export async function callEnvelope(defs: Map<string, any>, action: string, args: Record<string, unknown> = {}, exec: unknown = { signal: undefined }): Promise<any> {
  return defs.get('web_call').execute({ action, args }, exec)
}

/** Run one action through `web_call` and return its result; a failure rejects with the error message. */
export async function callAction(defs: Map<string, any>, action: string, args: Record<string, unknown> = {}, exec: unknown = { signal: undefined }): Promise<any> {
  const envelope = await callEnvelope(defs, action, args, exec)
  if (!envelope.ok) throw new ActionFailure(envelope.error.message, envelope.error.code, envelope.error.hint, envelope.error.schema)
  return envelope.result
}

/** The text the model reads for a result of `action`. */
export function renderResult(action: string, result: unknown, args: Record<string, unknown> = {}): string {
  if (!findAction(action)) throw new Error('unknown action ' + action)
  return renderEnvelope({ ok: true, action, result: result as Record<string, unknown> }, args)
}
