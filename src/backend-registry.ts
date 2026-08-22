export interface BackendProbe { available: boolean; reason?: string }
export interface Backend<I, O> { id: string; probe(): BackendProbe; run(input: I): Promise<O> }
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

  async runSelected(input: I, options: { preferred: readonly string[]; override?: string }): Promise<{ id: string; value: O }> {
    const ids = options.override ? [options.override] : options.preferred
    const errors: string[] = []
    for (const id of ids) {
      const backend = this.entries.get(id)
      if (!backend) { errors.push(id + ': unknown'); continue }
      const failed = this.failures.get(id)
      if (failed && failed.until > Date.now()) { errors.push(id + ': cooldown'); continue }
      const probe = backend.probe()
      if (!probe.available) { errors.push(id + ': ' + (probe.reason ?? 'unavailable')); continue }
      try {
        const result = await backend.run(input)
        this.failures.delete(id)
        return { id, value: result }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.failures.set(id, { message, until: Date.now() + (this.options.cooldownMs ?? 30_000) })
        errors.push(id + ': ' + message)
      }
    }
    throw new Error('no backend succeeded: ' + errors.join('; '))
  }

  diagnostics(): BackendDiagnostic[] {
    return [...this.entries.values()].map(backend => {
      const probe = backend.probe()
      const failed = this.failures.get(backend.id)
      if (failed && failed.until > Date.now()) return { id: backend.id, available: probe.available, state: 'cooldown', lastError: failed.message, cooldownUntil: new Date(failed.until).toISOString() }
      return { id: backend.id, available: probe.available, state: probe.available ? 'ready' : 'unavailable', ...probe.reason ? { reason: probe.reason } : {} }
    })
  }
}
