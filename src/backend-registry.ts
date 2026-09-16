export interface BackendProbe { available: boolean; reason?: string }
/** Quality verdict for a successful run: ok, low-quality (usable but thin), or error. */
export interface BackendRunResult { ok: boolean; lowQuality?: boolean; detail?: string }
/** Per-engine attempt record so callers can report *why* the router fell back. */
export interface BackendAttempt { id: string; outcome: 'ok' | 'low-quality' | 'error'; detail?: string }
export interface Backend<I, O> { id: string; probe(): BackendProbe | Promise<BackendProbe>; run(input: I): Promise<O>; assess?(value: O): BackendRunResult }
export interface BackendDiagnostic { id: string; available: boolean; state: 'ready' | 'unavailable' | 'cooldown'; reason?: string; lastError?: string; cooldownUntil?: string }

export class BackendRegistry<I, O> {
  private readonly entries = new Map<string, Backend<I, O>>()
  private readonly failures = new Map<string, { message: string; until: number }>()
  constructor(private readonly options: { cooldownMs?: number } = {}) {}

  register(backend: Backend<I, O>): this {
    if (this.entries.has(backend.id)) throw new Error('duplicate backend: ' + backend.id)
    this.entries.set(backend.id, backend)
    return this
  }

  async run(input: I, options: { preferred: readonly string[]; override?: string }): Promise<O> {
    return (await this.runSelected(input, options)).value
  }

  /**
   * Try engines in order. A successful engine wins by default, but when its
   * `assess()` verdict is `lowQuality` and there are more engines to try, the
   * router keeps probing; a later *ok* engine replaces it. If no later engine
   * does better, the best low-quality result (first one) is still returned.
   */
  async runSelected(input: I, options: { preferred: readonly string[]; override?: string }): Promise<{ id: string; value: O; attempts: BackendAttempt[] }> {
    const ids = options.override ? [options.override] : options.preferred
    const errors: string[] = []
    const attempts: BackendAttempt[] = []
    let fallback: { id: string; value: O; detail?: string } | undefined
    for (const id of ids) {
      const backend = this.entries.get(id)
      if (!backend) { errors.push(id + ': unknown'); attempts.push({ id, outcome: 'error', detail: 'unknown' }); continue }
      const failed = this.failures.get(id)
      if (failed && failed.until > Date.now()) { errors.push(id + ': cooldown'); attempts.push({ id, outcome: 'error', detail: 'cooldown' }); continue }
      const probe = await backend.probe()
      if (!probe.available) { errors.push(id + ': ' + (probe.reason ?? 'unavailable')); attempts.push({ id, outcome: 'error', detail: probe.reason ?? 'unavailable' }); continue }
      try {
        const result = await backend.run(input)
        this.failures.delete(id)
        const verdict = backend.assess ? backend.assess(result) : { ok: true }
        if (verdict.ok && !verdict.lowQuality) {
          attempts.push({ id, outcome: 'ok' })
          return { id, value: result, attempts }
        }
        // Low-quality: usable but thin — remember it and keep probing.
        if (!fallback) fallback = { id, value: result, detail: verdict.detail }
        attempts.push({ id, outcome: 'low-quality', detail: verdict.detail })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.failures.set(id, { message, until: Date.now() + (this.options.cooldownMs ?? 30_000) })
        errors.push(id + ': ' + message)
        attempts.push({ id, outcome: 'error', detail: message })
      }
    }
    if (fallback) return { id: fallback.id, value: fallback.value, attempts }
    throw new Error('no backend succeeded: ' + errors.join('; '))
  }

  diagnostics(): BackendDiagnostic[] {
    return [...this.entries.values()].map(backend => {
      const probe = backend.probe()
      if (probe instanceof Promise) return { id: backend.id, available: false, state: 'unavailable', reason: 'asynchronous probe requires diagnosticsAsync()' }
      const failed = this.failures.get(backend.id)
      if (failed && failed.until > Date.now()) return { id: backend.id, available: probe.available, state: 'cooldown', lastError: failed.message, cooldownUntil: new Date(failed.until).toISOString() }
      return { id: backend.id, available: probe.available, state: probe.available ? 'ready' : 'unavailable', ...probe.reason ? { reason: probe.reason } : {} }
    })
  }

  async diagnosticsAsync(): Promise<BackendDiagnostic[]> {
    return Promise.all([...this.entries.values()].map(async backend => {
      const probe = await backend.probe()
      const failed = this.failures.get(backend.id)
      if (failed && failed.until > Date.now()) return { id: backend.id, available: probe.available, state: 'cooldown', lastError: failed.message, cooldownUntil: new Date(failed.until).toISOString() } as BackendDiagnostic
      return { id: backend.id, available: probe.available, state: probe.available ? 'ready' : 'unavailable', ...probe.reason ? { reason: probe.reason } : {} } as BackendDiagnostic
    }))
  }
}
