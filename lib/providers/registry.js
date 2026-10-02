/**
 * Search-provider registry (design §4, dev-plan M6): a descriptor (what a source
 * is: id, languages, task profiles, filters, requirements, cost) plus a runtime
 * (`probeLocal`: local readiness without network; `create`: the Engine). Built-in
 * engines and any later adapter use the same shape; adding a source is one
 * descriptor + adapter file and a `register` call, not an edit of the core.
 *
 * Ids are namespaced and stable (`builtin:ddg`, `vendor:name`); `aliases` keep the
 * short legacy ids (`ddg`) working. The id that appears in tool output, history,
 * cache keys and backend state is the ROUTE id: the first alias when there is one,
 * else the full id, so existing records and tests keep their names.
 * Nothing here loads code dynamically: only adapters handed to `register` exist.
 * @module web-search-pro/providers/registry
 */
/** The id under which a provider appears in tool output, history, cache keys and backend state. */
export function routeIdOf(descriptor) {
    return descriptor.aliases[0] ?? descriptor.id;
}
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._-]*)?$/;
export class ProviderRegistry {
    adapters = new Map();
    /** Every accepted spelling (full id and aliases) -> full id. */
    names = new Map();
    listeners = new Set();
    version = 0;
    /**
     * Add an adapter. A duplicate id, or an alias / id that another provider already owns, throws: nothing is
     * replaced silently. Returns the unregister function (stops new scheduling; in-flight calls finish).
     */
    register(adapter) {
        const d = adapter.descriptor;
        if (!d || typeof d.id !== 'string' || !ID_PATTERN.test(d.id))
            throw new Error('invalid provider id: ' + String(d?.id));
        if (this.adapters.has(d.id))
            throw new Error('duplicate provider id: ' + d.id);
        const spellings = [d.id, ...d.aliases];
        for (const name of spellings) {
            if (!name || /[\s,]/.test(name))
                throw new Error('invalid provider alias for ' + d.id + ': "' + name + '"');
            const owner = this.names.get(name);
            if (owner !== undefined)
                throw new Error('provider ' + d.id + ': "' + name + '" is already used by ' + owner);
        }
        if (new Set(spellings).size !== spellings.length)
            throw new Error('provider ' + d.id + ': duplicate alias');
        this.adapters.set(d.id, adapter);
        for (const name of spellings)
            this.names.set(name, d.id);
        this.touch();
        let active = true;
        return () => {
            if (!active)
                return;
            active = false;
            if (this.adapters.get(d.id) !== adapter)
                return;
            this.adapters.delete(d.id);
            for (const name of spellings)
                if (this.names.get(name) === d.id)
                    this.names.delete(name);
            this.touch();
        };
    }
    /** The adapter for a full id or alias (case-sensitive, trimmed), or undefined. */
    resolve(idOrAlias) {
        const full = this.names.get(idOrAlias.trim());
        return full === undefined ? undefined : this.adapters.get(full);
    }
    /** Route id for a full id or alias; undefined when unknown. */
    routeId(idOrAlias) {
        const adapter = this.resolve(idOrAlias);
        return adapter ? routeIdOf(adapter.descriptor) : undefined;
    }
    list(filter = {}) {
        return [...this.adapters.values()].filter(a => !filter.operation || a.descriptor.operations.includes(filter.operation));
    }
    /** Route ids of every provider that can search, registration order. */
    searchIds() {
        return this.list({ operation: 'search' }).map(a => routeIdOf(a.descriptor));
    }
    /** Normalise a list of ids (aliases, full ids) to route ids, dropping repeats; unknown ids are returned apart. */
    normalize(ids) {
        const out = [];
        const unknown = [];
        for (const raw of ids) {
            const route = this.routeId(raw);
            if (route === undefined) {
                if (!unknown.includes(raw))
                    unknown.push(raw);
                continue;
            }
            if (!out.includes(route))
                out.push(route);
        }
        return { ids: out, unknown };
    }
    /** Message for ids the registry does not know, listing what is available. */
    unknownMessage(unknown) {
        return 'unknown engine: ' + unknown.join(', ') + ' (available: ' + this.searchIds().join(', ') + ')';
    }
    /** Throws the "unknown engine" error when any id is unknown; otherwise returns the route ids (aliases accepted). */
    validate(ids) {
        const { ids: route, unknown } = this.normalize(ids);
        if (unknown.length)
            throw new Error(this.unknownMessage(unknown));
        return route;
    }
    /** Called after every register / unregister (the router syncs its backends). Returns the unsubscribe function. */
    onChange(listener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    /** Bumped on every change, so a consumer can tell whether its copy is stale. */
    get revision() { return this.version; }
    touch() {
        this.version++;
        for (const listener of this.listeners) {
            try {
                listener();
            }
            catch { /* a listener must not break registration */ }
        }
    }
}
//# sourceMappingURL=registry.js.map