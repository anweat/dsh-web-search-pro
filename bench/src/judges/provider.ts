/**
 * A bench judge for any `systemone` provider of the plugin's registry (presets or
 * custom entries): endpoint, model, limits and extra body come from the provider
 * definition, the credentials from the environment variable its `keyRef` names.
 * @module bench/judges/provider
 */

import fs from 'node:fs'
import { endpointOf, selectProvider } from '../../../src/pipeline/judges/providers.ts'
import type { ProviderConfig } from '../../../src/pipeline/judges/types.ts'
import { SystemOneJudge, type SystemOneConfig } from './systemone.ts'

/** Bench judge id of a provider: the legacy `jev` for the hosted Bocha Jev (its cache directory and result rows keep that name), else the provider id. */
export const judgeIdOf = (p: ProviderConfig): string => p.recordedId ?? p.id

export interface ProviderJudgeOptions extends Partial<SystemOneConfig> {
  /** Overrides the key looked up in the environment. */
  apiKey?: string
}

export function createProviderJudge(p: ProviderConfig, options: ProviderJudgeOptions = {}): SystemOneJudge {
  if (p.protocol !== 'systemone') throw new Error('provider ' + p.id + ' speaks ' + p.protocol + ': the judge runner supports systemone providers (noul / score / choice questions); rerank and llm providers are score-only, use eval-pack')
  const { apiKey: given, ...rest } = options
  const apiKey = p.keyRef ? (given ?? process.env[p.keyRef]) : undefined
  if (p.keyRef && !apiKey) throw new Error(p.keyRef + ' is not set')
  return new SystemOneJudge({
    id: judgeIdOf(p), model: p.model, url: endpointOf(p),
    ...p.limits?.blockChars !== undefined ? { candidateChars: p.limits.blockChars } : {},
    ...p.limits?.maxQuestionsPerRequest !== undefined ? { maxQuestions: p.limits.maxQuestionsPerRequest } : {},
    ...p.limits?.maxBodyBytes !== undefined ? { maxBodyBytes: p.limits.maxBodyBytes } : {},
    ...p.limits?.maxRetries !== undefined ? { maxRetries: p.limits.maxRetries } : {},
    ...p.limits?.timeoutMs !== undefined ? { timeoutMs: p.limits.timeoutMs } : {},
    ...p.limits?.requestCap !== undefined ? { requestCap: p.limits.requestCap } : {},
    ...p.extraBody ? { extraBody: p.extraBody } : {},
    ...rest,
    headers: { ...apiKey ? { authorization: 'Bearer ' + apiKey } : {}, ...rest.headers },
  })
}

/** `--providers-file`: a JSON object shaped like `evidence.judge.providers`. */
export function loadProvidersFile(file: string): Record<string, unknown> {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(file + ' must be a JSON object { "<provider id>": { protocol, baseUrl, model, ... } }')
  return raw as Record<string, unknown>
}

/** The provider named by `--provider` (default bocha-jev) out of the presets and `--providers-file`; throws with the reasons when it cannot be used. */
export function pickProvider(id: string | undefined, providers?: Record<string, unknown>): ProviderConfig {
  const sel = selectProvider({ ...id ? { provider: id } : {}, ...providers ? { providers } : {}, allowLlm: true })
  if (!sel.provider) throw new Error((sel.unusable ?? 'no provider') + (sel.diagnostics.length ? '\n' + sel.diagnostics.join('\n') : ''))
  return sel.provider
}
