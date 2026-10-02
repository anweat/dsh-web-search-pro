/**
 * Bocha Jev hosted judge, built from the plugin's `bocha-jev` provider preset
 * (src/pipeline/judges/providers.ts). The key comes from env BOCHA_JEV_API_KEY
 * and is only ever placed in the Authorization header: never logged, never cached.
 * @module bench/judges/jev
 */

import { endpointOf, JEV_MODEL, JEV_URL, PRESETS } from '../../../src/pipeline/judges/providers.ts'
import { createProviderJudge } from './provider.ts'
import type { SystemOneConfig, SystemOneJudge } from './systemone.ts'

export { JEV_MODEL, JEV_URL }

export interface JevOptions extends Partial<SystemOneConfig> {
  apiKey?: string
}

export function createJevJudge(options: JevOptions = {}): SystemOneJudge {
  const preset = PRESETS['bocha-jev']!
  const apiKey = options.apiKey ?? process.env[preset.keyRef!]
  if (!apiKey) throw new Error(preset.keyRef + ' is not set')
  const { apiKey: _omit, ...rest } = options
  return createProviderJudge(preset, { apiKey, requestCap: 50, ...rest, url: rest.url ?? endpointOf(preset) })
}
