/**
 * Per-provider calibration of raw scores onto grades 0..3 (design §7: scores of
 * different models are never mixed without calibration).
 * @module web-search-pro/pipeline/judges/calibration
 */

import crypto from 'node:crypto'
import { calibrationProblems } from './calibration-spec.ts'
import type { Calibration } from './types.ts'

export { calibrationProblems }

/** Raw score -> grade 0..3 (linear between points, constant outside). Assumes a valid calibration. */
export function applyCalibration(c: Calibration, raw: number): number {
  const pts = c.points
  if (!Number.isFinite(raw)) return 0
  if (raw <= pts[0]![0]) return pts[0]![1]
  const last = pts[pts.length - 1]!
  if (raw >= last[0]) return last[1]
  for (let i = 1; i < pts.length; i++) {
    const [x1, g1] = pts[i]!
    if (raw <= x1) {
      const [x0, g0] = pts[i - 1]!
      return g0 + ((raw - x0) / (x1 - x0)) * (g1 - g0)
    }
  }
  return last[1]
}

/** `version#hash`: what results and cache keys record (a changed point changes the hash). */
export function calibrationKey(c: Calibration): string {
  return c.version + '#' + crypto.createHash('sha256').update(JSON.stringify(c.points)).digest('hex').slice(0, 8)
}
