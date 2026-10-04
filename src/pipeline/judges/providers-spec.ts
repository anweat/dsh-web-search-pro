/**
 * The pure part of the judge provider registry (dev-plan M10): built-in presets, the validation of a provider
 * definition and the catalog resolution. No Node imports and no protocol code, so the settings panel (client bundle)
 * runs the very validation the server runs; the scorer factories live in ./providers.ts.
 * @module web-search-pro/pipeline/judges/providers-spec
 */

import { BUILTIN_RUBRIC_IDS, builtinDef } from '../rubrics-spec.ts'
import { calibrationProblems } from './calibration-spec.ts'
import { PROTOCOLS, type ProviderConfig } from './types.ts'

/** Credentials ref / environment variable holding the Bocha Jev key. */
export const JEV_KEY_REF = 'BOCHA_JEV_API_KEY'
export const JEV_BASE_URL = 'https://jev.bocha.cn'
export const JEV_MODEL = 'bocha-jev-v1'
export const DEFAULT_PROVIDER_ID = 'bocha-jev'

/** Built-in presets. Only `bocha-jev` is exercised by the plugin's own experiments; the others are unverified starting points. */
export const PRESETS: Readonly<Record<string, ProviderConfig>> = {
  'bocha-jev': {
    id: 'bocha-jev', protocol: 'systemone', baseUrl: JEV_BASE_URL, model: JEV_MODEL, keyRef: JEV_KEY_REF,
    label: 'Jev', recordedId: 'jev',
    notes: 'Hosted Bocha Jev (the default when a model scorer is switched on).',
  },
  'typesafe-jev': {
    id: 'typesafe-jev', protocol: 'systemone', baseUrl: 'https://typesafe-jev.invalid', model: 'typesafe-jev-v1', keyRef: 'TYPESAFE_JEV_API_KEY',
    label: 'TypeSafe Jev', unverified: true, placeholders: ['baseUrl', 'model'],
    notes: 'Placeholder: another hosted Jev deployment. Set baseUrl and model (evidence.judge.providers.typesafe-jev) before use; never called by the plugin authors.',
  },
  'laya-local': {
    id: 'laya-local', protocol: 'systemone', baseUrl: 'http://127.0.0.1:8765', model: 'multilingual',
    label: 'Laya', tokenModel: 'plain', extraBody: { max_len: 1024 }, limits: { blockChars: 700 },
    notes: 'Local Laya sidecar (experiments/laya, Jev-compatible). Experiment r1 found it near random with the current prompts: it needs a calibration fitted on your own labels (calibration.points) before it is trusted for control.',
  },
  'jina-rerank': {
    id: 'jina-rerank', protocol: 'rerank', baseUrl: 'https://api.jina.ai/v1', model: 'jina-reranker-v2-base-multilingual', keyRef: 'JINA_API_KEY',
    label: 'Jina rerank', extraBody: { return_documents: false }, unverified: true,
    notes: 'Jina-style rerank API; never called by the plugin authors. Needs calibration.points: relevance scores are not grades.',
  },
  'cohere-rerank': {
    id: 'cohere-rerank', protocol: 'rerank', baseUrl: 'https://api.cohere.com/v2', model: 'rerank-v3.5', keyRef: 'COHERE_API_KEY',
    label: 'Cohere rerank', unverified: true,
    notes: 'Cohere-style rerank API; never called by the plugin authors. Needs calibration.points: relevance scores are not grades.',
  },
}

export interface JudgeSettings {
  /** Provider id used when a model scorer is on (default `bocha-jev`). */
  provider?: string | undefined
  /** Allow providers speaking the `llm` protocol (default false). */
  allowLlm?: boolean | undefined
  /** Custom providers, or overrides of a preset with the same id. */
  providers?: Record<string, unknown> | undefined
}

export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,47}$/
/** Scorer ids the pipeline gives meaning to. */
export const RESERVED_PROVIDER_IDS = ['rule', 'hybrid', 'none']
export const KEY_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$/
export const PROVIDER_LIMIT_KEYS = ['maxQuestionsPerRequest', 'requestTokenBudget', 'blockChars', 'maxNeedChars', 'maxStateChars', 'maxBodyBytes', 'maxDocumentsPerRequest', 'maxRetries', 'timeoutMs', 'requestCap'] as const
export const PROVIDER_FIELDS = ['protocol', 'baseUrl', 'model', 'keyRef', 'path', 'limits', 'calibration', 'rubricId', 'extraBody', 'price', 'tokenModel', 'label'] as const
const RESERVED_BODY_KEYS = ['model', 'state', 'questions', 'query', 'documents', 'messages']

const isLoopback = (host: string): boolean => host === 'localhost' || host.endsWith('.localhost') || /^127\./.test(host) || host === '[::1]'

/** Problems of a complete provider definition; empty = usable. */
export function providerProblems(p: Record<string, unknown>): string[] {
  const out: string[] = []
  if (typeof p.protocol !== 'string' || !(PROTOCOLS as readonly string[]).includes(p.protocol)) out.push('protocol must be one of ' + PROTOCOLS.join(', '))
  if (typeof p.model !== 'string' || !p.model.trim()) out.push('model must be a non-empty string')
  if (typeof p.baseUrl !== 'string') out.push('baseUrl must be a URL string')
  else {
    let url: URL | undefined
    try { url = new URL(p.baseUrl) } catch { out.push('baseUrl "' + p.baseUrl + '" is not a URL') }
    if (url) {
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) out.push('baseUrl must be https (http is only allowed for localhost: the API key would travel in clear text)')
      if (url.username || url.password) out.push('baseUrl must not carry credentials: use keyRef')
      if (url.search || url.hash) out.push('baseUrl must not carry a query or fragment')
    }
  }
  if (p.keyRef !== undefined && (typeof p.keyRef !== 'string' || !KEY_REF_PATTERN.test(p.keyRef))) out.push('keyRef must be a credentials ref / environment variable name (not the key itself)')
  if (p.path !== undefined && (typeof p.path !== 'string' || !/^\/[A-Za-z0-9._~\/-]*$/.test(p.path))) out.push('path must look like /v1/endpoint')
  if (p.tokenModel !== undefined && p.tokenModel !== 'expanded' && p.tokenModel !== 'plain') out.push('tokenModel must be expanded or plain')
  if (p.label !== undefined && (typeof p.label !== 'string' || !p.label.trim() || p.label.length > 40)) out.push('label must be a short string')
  if (p.rubricId !== undefined) {
    if (typeof p.rubricId !== 'string' || !BUILTIN_RUBRIC_IDS.includes(p.rubricId)) out.push('rubricId must be a known rubric (' + BUILTIN_RUBRIC_IDS.join(', ') + ')')
    else if (builtinDef(p.rubricId)?.kind !== 'score') out.push('rubricId ' + p.rubricId + ' is not a score rubric')
    else if (p.protocol === 'rerank') out.push('rubricId does not apply to the rerank protocol (the need text is the query)')
  }
  if (p.limits !== undefined) {
    if (p.limits === null || typeof p.limits !== 'object' || Array.isArray(p.limits)) out.push('limits must be an object')
    else for (const [k, v] of Object.entries(p.limits)) {
      if (!(PROVIDER_LIMIT_KEYS as readonly string[]).includes(k)) out.push('unknown limit "' + k + '" (known: ' + PROVIDER_LIMIT_KEYS.join(', ') + ')')
      else if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) out.push('limits.' + k + ' must be a positive integer')
    }
  }
  if (p.calibration !== undefined) out.push(...calibrationProblems(p.calibration))
  if (p.extraBody !== undefined) {
    if (p.extraBody === null || typeof p.extraBody !== 'object' || Array.isArray(p.extraBody)) out.push('extraBody must be an object')
    else for (const k of Object.keys(p.extraBody)) if (RESERVED_BODY_KEYS.includes(k)) out.push('extraBody must not set "' + k + '" (the protocol owns it)')
  }
  if (p.price !== undefined) {
    const price = p.price as Record<string, unknown> | null
    if (price === null || typeof price !== 'object' || typeof price.inputPerMTokens !== 'number' || !(price.inputPerMTokens >= 0) || typeof price.currency !== 'string' || !price.currency
      || (price.outputPerMTokens !== undefined && !(typeof price.outputPerMTokens === 'number' && price.outputPerMTokens >= 0))) out.push('price must be { inputPerMTokens, outputPerMTokens?, currency } with non-negative numbers')
  }
  return out
}

/** Preset (when `id` names one) overlaid with the user's fields; limits and extraBody merge key by key. */
function merge(id: string, raw: Record<string, unknown>): Record<string, unknown> {
  const base = PRESETS[id]
  const out: Record<string, unknown> = { ...base, ...raw, id }
  if (base) {
    if (base.limits || raw.limits) out.limits = { ...base.limits, ...(raw.limits as object | undefined) }
    if (base.extraBody || raw.extraBody) out.extraBody = { ...base.extraBody, ...(raw.extraBody as object | undefined) }
    // A user who points a preset at another endpoint or model has replaced its placeholders.
    const placeholders = (base.placeholders ?? []).filter(f => raw[f] === undefined)
    if (placeholders.length) out.placeholders = placeholders
    else delete out.placeholders
  }
  return out
}

export interface ProviderCatalog {
  providers: Map<string, ProviderConfig>
  /** Problems of custom entries (those providers are left out). */
  diagnostics: string[]
}

/** Every usable provider: the presets, overridden / extended by `settings.providers`. */
export function resolveProviders(settings?: JudgeSettings | undefined): ProviderCatalog {
  const providers = new Map<string, ProviderConfig>(Object.entries(PRESETS))
  const diagnostics: string[] = []
  for (const [id, raw] of Object.entries(settings?.providers ?? {})) {
    const where = 'evidence.judge.providers.' + id
    if (!PROVIDER_ID_PATTERN.test(id) || RESERVED_PROVIDER_IDS.includes(id)) { diagnostics.push(where + ' ignored: the id must be lowercase letters, digits, . _ - (at most 48 characters) and not rule / hybrid / none'); continue }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) { diagnostics.push(where + ' ignored: not an object'); continue }
    const unknown = Object.keys(raw).filter(k => !(PROVIDER_FIELDS as readonly string[]).includes(k))
    const merged = merge(id, raw as Record<string, unknown>)
    const problems = [...unknown.map(k => 'unknown field "' + k + '"'), ...providerProblems(merged)]
    if (problems.length) {
      diagnostics.push(where + ' ignored' + (PRESETS[id] ? ', the built-in preset is kept' : '') + ': ' + problems.join('; '))
      continue
    }
    providers.set(id, merged as unknown as ProviderConfig)
  }
  return { providers, diagnostics }
}

export function unusableReason(p: ProviderConfig, settings?: JudgeSettings | undefined): string | undefined {
  if (p.placeholders?.length) return 'provider ' + p.id + ' is a placeholder preset: set ' + p.placeholders.join(' and ') + ' in evidence.judge.providers.' + p.id
  if (p.protocol === 'rerank' && !p.calibration) return 'provider ' + p.id + ' is a rerank provider: set calibration.points (raw score -> grade 0..3), its scores are not grades'
  if (p.protocol === 'llm' && settings?.allowLlm !== true) return 'provider ' + p.id + ' uses the llm protocol, which is off: set evidence.judge.allowLlm to true'
  return undefined
}
