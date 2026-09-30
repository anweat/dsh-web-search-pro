/**
 * Bocha Jev hosted judge. The key comes from env BOCHA_JEV_API_KEY and is only
 * ever placed in the Authorization header: never logged, never cached.
 * @module bench/judges/jev
 */

import { SystemOneJudge, type SystemOneConfig } from './systemone.ts'

export const JEV_URL = 'https://jev.bocha.cn/v1/systemone'
export const JEV_MODEL = 'bocha-jev-v1'

export interface JevOptions extends Partial<SystemOneConfig> {
  apiKey?: string
}

export function createJevJudge(options: JevOptions = {}): SystemOneJudge {
  const apiKey = options.apiKey ?? process.env.BOCHA_JEV_API_KEY
  if (!apiKey) throw new Error('BOCHA_JEV_API_KEY is not set')
  const { apiKey: _omit, ...rest } = options
  return new SystemOneJudge({
    id: 'jev', model: JEV_MODEL, url: JEV_URL, requestCap: 50,
    ...rest,
    headers: { authorization: 'Bearer ' + apiKey, ...rest.headers },
  })
}
