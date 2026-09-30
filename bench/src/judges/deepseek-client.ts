/**
 * Minimal DeepSeek API client: chat completions (OpenAI-compatible) and
 * `GET /user/balance`. The key is read from env DEEPSEEK_API_KEY by the caller
 * and only used in the Authorization header.
 * @module bench/judges/deepseek-client
 */

import { sleep as realSleep } from '../cli.ts'
import { parseRetryAfter } from './systemone.ts'

export const DEEPSEEK_BASE = 'https://api.deepseek.com'
export const DEEPSEEK_MODEL = 'deepseek-flash'

/** Accepted by the API (probed 2026-10-01): none minimal low medium high xhigh ultra max; invalid values return 422. */
export type Effort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'ultra' | 'max'
export const EFFORTS: readonly Effort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'ultra', 'max']

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  /** Sent as `reasoning_effort` only when set. */
  effort?: Effort
  json?: boolean
  maxTokens?: number
  signal?: AbortSignal
}

export interface ChatResponse {
  content: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  finishReason?: string
}

export class DeepSeekError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message)
    this.name = 'DeepSeekError'
  }
}

export interface ClientOptions {
  apiKey: string
  baseUrl?: string
  maxRetries?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export class DeepSeekClient {
  private readonly base: string
  private readonly doFetch: typeof fetch
  private readonly sleeper: (ms: number) => Promise<void>
  private readonly maxRetries: number
  private readonly timeoutMs: number
  private readonly apiKey: string
  requests = 0

  constructor(opts: ClientOptions) {
    if (!opts.apiKey) throw new Error('DEEPSEEK_API_KEY is not set')
    this.apiKey = opts.apiKey
    this.base = (opts.baseUrl ?? DEEPSEEK_BASE).replace(/\/$/, '')
    this.doFetch = opts.fetchImpl ?? globalThis.fetch
    this.sleeper = opts.sleep ?? realSleep
    this.maxRetries = opts.maxRetries ?? 2
    this.timeoutMs = opts.timeoutMs ?? 180_000
  }

  private headers(): Record<string, string> {
    return { authorization: 'Bearer ' + this.apiKey, 'content-type': 'application/json' }
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = { model: req.model, messages: req.messages, stream: false }
    if (req.effort) body.reasoning_effort = req.effort
    if (req.json) body.response_format = { type: 'json_object' }
    if (req.maxTokens) body.max_tokens = req.maxTokens
    const payload = JSON.stringify(body)
    for (let attempt = 0; ; attempt++) {
      this.requests++
      const started = Date.now()
      let res: Response
      try {
        res = await this.doFetch(this.base + '/chat/completions', {
          method: 'POST', headers: this.headers(), body: payload,
          signal: req.signal ?? AbortSignal.timeout(this.timeoutMs),
        })
      } catch (error) {
        throw new DeepSeekError('network error: ' + (error as Error).message)
      }
      if (res.ok) {
        // DeepSeek sends headers early and the body after inference: time the whole exchange.
        const json = await res.json() as any
        const latencyMs = Date.now() - started
        return {
          content: String(json.choices?.[0]?.message?.content ?? ''),
          finishReason: json.choices?.[0]?.finish_reason,
          inputTokens: Number(json.usage?.prompt_tokens ?? 0),
          outputTokens: Number(json.usage?.completion_tokens ?? 0),
          latencyMs,
        }
      }
      const text = (await res.text().catch(() => '')).slice(0, 300)
      if ([429, 500, 503].includes(res.status) && attempt < this.maxRetries) {
        await this.sleeper(Math.min(parseRetryAfter(res.headers.get('retry-after')) ?? 2_000 * 2 ** attempt, 60_000))
        continue
      }
      throw new DeepSeekError('HTTP ' + res.status + ' ' + text, res.status)
    }
  }

  /** `GET /user/balance` -> total CNY balance. */
  async balanceCny(): Promise<number> {
    const res = await this.doFetch(this.base + '/user/balance', { headers: this.headers(), signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new DeepSeekError('balance HTTP ' + res.status, res.status)
    return parseBalanceCny(await res.json())
  }
}

export function parseBalanceCny(json: any): number {
  const infos: any[] = json?.balance_infos ?? []
  const cny = infos.find(i => i?.currency === 'CNY')
  const n = Number(cny?.total_balance)
  if (!Number.isFinite(n)) throw new DeepSeekError('balance response has no CNY total_balance')
  return n
}

/** Extract a JSON value from model output: tolerates code fences and leading/trailing prose. */
export function parseJsonLoose(text: string): unknown {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(stripped) } catch { /* fall through */ }
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const a = stripped.indexOf(open)
    const b = stripped.lastIndexOf(close)
    if (a >= 0 && b > a) {
      try { return JSON.parse(stripped.slice(a, b + 1)) } catch { /* try next */ }
    }
  }
  return undefined
}
