/**
 * Local Laya sidecar judge (experiments/laya, 127.0.0.1:8765), same request
 * shape as Jev. `model`: multilingual (default) | english | router.
 * @module bench/judges/laya
 */

import { SystemOneJudge, type SystemOneConfig } from './systemone.ts'

export const LAYA_BASE = 'http://127.0.0.1:8765'

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
  return new SystemOneJudge({
    id: layaJudgeId(layaModel),
    model: layaModel,
    url: baseUrl + '/v1/systemone',
    healthUrl: baseUrl + '/health',
    candidateChars: 700,
    extraBody: { max_len: maxLen },
    ...rest,
  })
}
