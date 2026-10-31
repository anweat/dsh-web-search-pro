/**
 * What the WeChat layers did last, kept in memory for `wechat.status`: per layer id (`sogou`, `tencent-wsa`, `history`, `album`, ...)
 * the time of the last success and the last failure with its text. Process-wide like the Sogou throttle, never persisted, and the
 * text is cut short: it is a pointer to "why did it stop", not a log.
 * @module web-search-pro/wechat/health
 */

export interface LayerHealth {
  /** ISO time of the last success. */
  lastOk?: string
  lastFailure?: { at: string; message: string }
}

const layers = new Map<string, LayerHealth>()
const MAX_MESSAGE = 240

function entry(id: string): LayerHealth {
  let e = layers.get(id)
  if (!e) { e = {}; layers.set(id, e) }
  return e
}

export function noteLayerOk(id: string, at = new Date()): void {
  const e = entry(id)
  e.lastOk = at.toISOString()
}

export function noteLayerFailure(id: string, error: unknown, at = new Date()): void {
  const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE)
  entry(id).lastFailure = { at: at.toISOString(), message }
}

export function layerHealth(id: string): LayerHealth {
  const e = layers.get(id)
  return e ? { ...e.lastOk ? { lastOk: e.lastOk } : {}, ...e.lastFailure ? { lastFailure: { ...e.lastFailure } } : {} } : {}
}

/** Forget everything (tests). */
export function resetLayerHealth(): void { layers.clear() }
