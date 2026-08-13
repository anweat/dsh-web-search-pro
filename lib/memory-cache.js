/**
 * Minimal in-process LRU cache (Map + recency bump). Layered above SQLite:
 * hot searches/page fetches resolve in microseconds without touching the DB.
 * @module web-search-pro/memory-cache
 */
export class LruCache {
    capacity;
    map = new Map();
    constructor(capacity) {
        this.capacity = capacity;
    }
    get(key, ttlMs) {
        const entry = this.map.get(key);
        if (!entry)
            return undefined;
        if (Date.now() - entry.ts > ttlMs) {
            this.map.delete(key);
            return undefined;
        }
        // recency bump
        this.map.delete(key);
        this.map.set(key, entry);
        return entry.value;
    }
    set(key, value) {
        this.map.delete(key);
        this.map.set(key, { ts: Date.now(), value });
        while (this.map.size > this.capacity) {
            const oldest = this.map.keys().next().value;
            if (oldest === undefined)
                break;
            this.map.delete(oldest);
        }
    }
    clear() {
        this.map.clear();
    }
    get size() {
        return this.map.size;
    }
}
//# sourceMappingURL=memory-cache.js.map