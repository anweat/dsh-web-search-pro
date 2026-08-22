export class BackendRegistry {
    options;
    entries = new Map();
    failures = new Map();
    constructor(options = {}) {
        this.options = options;
    }
    register(backend) {
        if (this.entries.has(backend.id))
            throw new Error('duplicate backend: ' + backend.id);
        this.entries.set(backend.id, backend);
        return this;
    }
    async run(input, options) {
        return (await this.runSelected(input, options)).value;
    }
    async runSelected(input, options) {
        const ids = options.override ? [options.override] : options.preferred;
        const errors = [];
        for (const id of ids) {
            const backend = this.entries.get(id);
            if (!backend) {
                errors.push(id + ': unknown');
                continue;
            }
            const failed = this.failures.get(id);
            if (failed && failed.until > Date.now()) {
                errors.push(id + ': cooldown');
                continue;
            }
            const probe = backend.probe();
            if (!probe.available) {
                errors.push(id + ': ' + (probe.reason ?? 'unavailable'));
                continue;
            }
            try {
                const result = await backend.run(input);
                this.failures.delete(id);
                return { id, value: result };
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.failures.set(id, { message, until: Date.now() + (this.options.cooldownMs ?? 30_000) });
                errors.push(id + ': ' + message);
            }
        }
        throw new Error('no backend succeeded: ' + errors.join('; '));
    }
    diagnostics() {
        return [...this.entries.values()].map(backend => {
            const probe = backend.probe();
            const failed = this.failures.get(backend.id);
            if (failed && failed.until > Date.now())
                return { id: backend.id, available: probe.available, state: 'cooldown', lastError: failed.message, cooldownUntil: new Date(failed.until).toISOString() };
            return { id: backend.id, available: probe.available, state: probe.available ? 'ready' : 'unavailable', ...probe.reason ? { reason: probe.reason } : {} };
        });
    }
}
//# sourceMappingURL=backend-registry.js.map