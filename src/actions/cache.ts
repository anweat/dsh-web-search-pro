/** `cache` group: purge cached results and read store statistics. @module web-search-pro/actions/cache */

import type { ActionDef } from './types.ts'
import { removedText, type RemovedCounts } from './history.ts'

export const CACHE_ACTIONS: ActionDef[] = [
  {
    name: 'cache.clear',
    group: 'cache',
    summary: 'Purge cached search results and page snapshots, optionally only older than N days and/or one engine; returns removed counts. Deletes stored data.',
    notes: 'With no arguments it removes everything. To delete a single query use history.delete.',
    params: {
      olderThanDays: { type: 'number', description: 'Only records older than N days; omit for everything.' },
      engine: { type: 'string', description: 'Only this engine.' },
    },
    output: { type: 'object', additionalProperties: false, properties: { removedQueries: { type: 'number', required: true }, removedResults: { type: 'number', required: true }, removedPages: { type: 'number', required: true } } },
    approval: 'local-write', mutating: true, concurrencySafe: false,
    timeoutMs: () => 20_000,
    examples: [{ args: { olderThanDays: 30 } }],
    async execute(args, ctx) {
      const removed = ctx.store.clearCache({
        ...args.olderThanDays != null ? { olderThanDays: args.olderThanDays } : {},
        ...args.engine ? { engine: args.engine } : {},
      })
      return { removedQueries: removed.queries, removedResults: removed.results, removedPages: removed.pages }
    },
    render: value => removedText(value as RemovedCounts),
  },
  {
    name: 'cache.stats',
    group: 'cache',
    summary: 'Store state: database size, table and kind counts, top engines and queries, configured engines.',
    params: {},
    output: {
      type: 'object', additionalProperties: false,
      properties: {
        dbPath: { type: 'string', required: true },
        dbSizeBytes: { type: 'number', required: true },
        queries: { type: 'number', required: true },
        results: { type: 'number', required: true },
        pages: { type: 'number', required: true },
        rules: { type: 'number', required: true },
        engines: { type: 'array', required: true, items: { type: 'string' } },
        kindCounts: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true }, count: { type: 'number', required: true } } } },
        topEngines: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { engine: { type: 'string', required: true }, count: { type: 'number', required: true } } } },
        topQueries: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', required: true }, count: { type: 'number', required: true } } } },
      },
    },
    approval: 'none', mutating: false, concurrencySafe: true,
    timeoutMs: () => 10_000,
    examples: [{ args: {} }],
    async execute(_args, ctx) {
      const stats = ctx.store.stats()
      return {
        dbPath: ctx.config.dbPath,
        ...stats,
        engines: ctx.dynamic().engines,
        kindCounts: ctx.store.kindCounts(),
        topEngines: ctx.store.topEngines(),
        topQueries: ctx.store.topQueries(),
      }
    },
    render(value) {
      const v = value as { dbPath: string; dbSizeBytes: number; queries: number; results: number; pages: number; rules: number; engines: string[]; kindCounts: { kind: string; count: number }[]; topEngines: { engine: string; count: number }[]; topQueries: { query: string; count: number }[] }
      return [
        'Database: ' + v.dbPath,
        'Size: ' + (v.dbSizeBytes / 1024).toFixed(1) + ' KB',
        'Queries: ' + v.queries + ' · Result rows: ' + v.results + ' · Page snapshots: ' + v.pages + ' · Custom rules: ' + v.rules,
        'Engines: ' + v.engines.join(', '),
        'Per kind: ' + (v.kindCounts.map(k => k.kind + '=' + k.count).join(', ') || '-'),
        'Top engines: ' + (v.topEngines.map(e => e.engine + '(' + e.count + ')').join(', ') || '-'),
        'Top queries: ' + (v.topQueries.map(q => JSON.stringify(q.query) + '(' + q.count + ')').join(', ') || '-'),
      ].join('\n')
    },
  },
]
