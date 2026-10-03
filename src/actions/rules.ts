/**
 * `rules` group: per-site extraction rules (contentSelectors / removeSelectors by hostname) used by read.fetch
 * and read.snapshot; stored in SQLite, they override the built-ins.
 * @module web-search-pro/actions/rules
 */

import fs from 'node:fs'
import path from 'node:path'
import type { Store } from '../store.ts'
import { ActionArgError, type ActionDef, type OutputNode } from './types.ts'

type RuleRow = { hostname: string; content: string; remove?: string }

const RULES_SCHEMA: OutputNode = { type: 'array', items: { type: 'object', additionalProperties: false, properties: { hostname: { type: 'string' }, content: { type: 'string' }, remove: { type: 'string' } } } }
const RULE_OUTPUT = (extra: Record<string, OutputNode> = {}): ActionDef['output'] => ({ type: 'object', additionalProperties: false, properties: { message: { type: 'string' }, rules: RULES_SCHEMA, ...extra } })

const listRules = (store: Store): RuleRow[] => store.listRules().map(r => ({ hostname: r.hostname, content: r.content, ...r.remove ? { remove: r.remove } : {} }))

function renderRules(value: unknown): string {
  const v = value as { message?: string; rules?: RuleRow[]; exportPath?: string }
  const parts: string[] = []
  if (v.message) parts.push(v.message)
  if (v.rules?.length) {
    parts.push('Rules:')
    for (const r of v.rules) parts.push('- ' + r.hostname + ' → content: ' + r.content + (r.remove ? ' | remove: ' + r.remove : ''))
  }
  if (v.exportPath) parts.push('Exported to: ' + v.exportPath)
  return parts.join('\n') || 'No rules.'
}

const HOST = { type: 'string', required: true, description: 'Hostname, e.g. example.com.' } as const

export const RULES_ACTIONS: ActionDef[] = [
  {
    name: 'rules.list',
    group: 'rules',
    summary: 'List the stored per-site extraction rules.',
    params: {},
    output: RULE_OUTPUT(),
    approval: 'none', mutating: false, concurrencySafe: true,
    timeoutMs: () => 10_000,
    examples: [{ args: {} }],
    async execute(_args, ctx) { return { rules: listRules(ctx.store) } },
    render: renderRules,
  },
  {
    name: 'rules.upsert',
    group: 'rules',
    summary: 'Add or replace the extraction rule of one hostname (CSS selectors of the main content, and optionally of elements to remove first). Used by read.fetch and read.snapshot.',
    params: {
      hostname: HOST,
      contentSelectors: { type: 'string', required: true, description: 'CSS selectors of the main content, comma-separated.' },
      removeSelectors: { type: 'string', description: 'CSS selectors to remove first, comma-separated.' },
    },
    output: RULE_OUTPUT(),
    approval: 'local-write', mutating: true, concurrencySafe: false,
    timeoutMs: () => 10_000,
    examples: [{ args: { hostname: 'example.com', contentSelectors: 'article, .post-body', removeSelectors: '.ads, nav' } }],
    async execute(args, ctx) {
      ctx.store.upsertRule(args.hostname, args.contentSelectors, args.removeSelectors)
      return { message: 'Rule upserted for ' + args.hostname.toLowerCase() }
    },
    render: renderRules,
  },
  {
    name: 'rules.remove',
    group: 'rules',
    summary: 'Remove the stored rule of one hostname (built-in rules stay).',
    params: { hostname: HOST },
    output: RULE_OUTPUT(),
    approval: 'local-write', mutating: true, concurrencySafe: false,
    timeoutMs: () => 10_000,
    examples: [{ args: { hostname: 'example.com' } }],
    async execute(args, ctx) {
      const removed = ctx.store.removeRule(args.hostname)
      return { message: removed ? 'Rule removed for ' + args.hostname.toLowerCase() : 'No rule found for ' + args.hostname.toLowerCase() }
    },
    render: renderRules,
  },
  {
    name: 'rules.import',
    group: 'rules',
    summary: 'Import rules from a JSON array or an exported rule pack (a rules.export file); existing hostnames are replaced.',
    params: { rulesJson: { type: 'string', required: true, description: 'JSON text: an array of {hostname, content, remove?} or an exported pack {version, rules}.' } },
    output: RULE_OUTPUT(),
    approval: 'local-write', mutating: true, concurrencySafe: false,
    timeoutMs: () => 10_000,
    examples: [{ args: { rulesJson: '[{"hostname":"example.com","content":"article"}]' } }],
    async execute(args, ctx) {
      let parsed: unknown
      try { parsed = JSON.parse(args.rulesJson) } catch { throw new ActionArgError('rulesJson is not valid JSON') }
      const importedRules = Array.isArray(parsed)
        ? parsed
        : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { rules?: unknown }).rules) ? (parsed as { rules: unknown[] }).rules : undefined)
      if (!importedRules) throw new ActionArgError('rulesJson must be a JSON array or exported rule pack')
      let count = 0
      for (const item of importedRules as { hostname?: string; content?: string; remove?: string }[]) {
        if (typeof item?.hostname !== 'string' || typeof item?.content !== 'string') continue
        ctx.store.upsertRule(item.hostname, item.content, item.remove)
        count++
      }
      return { message: 'Imported ' + count + ' rules', rules: listRules(ctx.store) }
    },
    render: renderRules,
  },
  {
    name: 'rules.export',
    group: 'rules',
    summary: 'Write all stored rules to a versioned JSON pack next to the database and return its path (importable with rules.import).',
    params: {},
    output: RULE_OUTPUT({ exportPath: { type: 'string' } }),
    approval: 'none', mutating: false, concurrencySafe: true,
    timeoutMs: () => 10_000,
    examples: [{ args: {} }],
    async execute(_args, ctx) {
      const rules = listRules(ctx.store)
      const exportPath = path.join(path.dirname(ctx.config.dbPath), 'rules-export-' + Date.now() + '.json')
      fs.mkdirSync(path.dirname(exportPath), { recursive: true })
      fs.writeFileSync(exportPath, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), rules }, null, 2), 'utf8')
      return { message: 'Exported ' + rules.length + ' rules', rules, exportPath }
    },
    render: renderRules,
  },
]
