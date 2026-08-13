/**
 * Minimal in-process LRU cache (Map + recency bump). Layered above SQLite:
 * hot searches/page fetches resolve in microseconds without touching the DB.
 * @module web-search-pro/memory-cache
 */

export interface LruEntry<T> {
  ts: number
  value: T
}

export class LruCache<T> {
  private readonly map = new Map<string, LruEntry<T>>()

  constructor(private readonly capacity: number) {}

  get(key: string, ttlMs: number): T | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.ts > ttlMs) {
      this.map.delete(key)
      return undefined
    }
    // recency bump
    this.map.delete(key)
    this.map.set(key, entry)
    return entry.value
  }

  set(key: string, value: T): void {
    this.map.delete(key)
    this.map.set(key, { ts: Date.now(), value })
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  clear(): void {
    this.map.clear()
  }

  get size(): number {
    return this.map.size
  }
}
