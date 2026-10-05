/**
 * Local Laya sidecar judge (experiments/laya, 127.0.0.1:8765), built from the
 * plugin's `laya-local` provider preset; same request shape as Jev.
 * `model`: multilingual (default) | english | router.
 * @module bench/judges/laya
 */

import { PRESETS } from '../../../src/pipeline/judges/providers.ts'
import { createProviderJudge } from './provider.ts'
import type { SystemOneConfig, SystemOneJudge } from './systemone.ts'

export const LAYA_BASE = PRESETS['laya-local']!.baseUrl

export type LayaModel = 'multilingual' | 'english' | 'router'

export interface LayaOptions extends Partial<SystemOneConfig> {
  layaModel?: LayaModel
  baseUrl?: string
  /** Token budget per question (Laya `max_len`). */
  maxLen?: number
}

export const layaJudgeId = (model: LayaModel): string => (model === 'multilingual' ? 'laya' : 'laya-' + model)

export function createLayaJudge(options: LayaOptions = {}): SystemOneJudge {
  const { layaModel = 'multilingual', baseUrl = LAYA_BASE, maxLen = 1024, ...rest } = options
  const preset = PRESETS['laya-local']!
  return createProviderJudge({ ...preset, baseUrl, model: layaModel, extraBody: { ...preset.extraBody, max_len: maxLen } }, {
    id: layaJudgeId(layaModel), healthUrl: baseUrl + '/health', ...rest,
  })
}
