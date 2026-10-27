import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveConfig, type ResolvedConfig } from '../src/config.ts'
import { OverlayStore, type ChangeMeta } from '../src/overlay.ts'
import { baseSpec } from './cli-helpers.ts'

/** The source ids the stub registry knows. */
export const KNOWN = new Set(['ddg', 'bing', 'exa', 'seam', 'jina', 'deepseek', 'tavily', 'bocha'])

/** A user CLI spec that is a general engine and serves no platform (valid for the overlay). */
export const engineSpec = (over: Record<string, unknown> = {}): Record<string, unknown> => {
  const { id: _id, ...spec } = baseSpec({ platforms: [], engine: true, ...over }) as unknown as Record<string, unknown>
  return spec
}

export interface OverlayHarness {
  dir: string
  file: string
  /** The user's configuration; tests assign a new one to move the baseline. */
  config: { current: ResolvedConfig }
  store: OverlayStore
  meta: (reason?: string, over?: Partial<ChangeMeta>) => ChangeMeta
  fresh: () => OverlayStore
  cleanup: () => void
}

export function overlayHarness(baseline: Record<string, unknown> = {}): OverlayHarness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-overlay-'))
  const file = path.join(dir, 'overlay.json')
  const config = { current: resolveConfig({ dbPath: path.join(dir, 'store.db'), ...baseline } as never) }
  const make = (): OverlayStore => new OverlayStore({ file, baseline: () => config.current, known: id => KNOWN.has(id) })
  return {
    dir, file, config, store: make(), fresh: make,
    meta: (reason = 'because the test says so', over = {}) => ({ actor: 'agent', action: 'config.set_order', reason, sessionId: 'session-1', ...over }),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  }
}
