/**
 * `config` group: let the agent read, and change at run time, the few settings that are about how a search is routed. The user's
 * configuration stays the baseline; these actions write the agent overlay (see ../overlay.ts), a managed file merged on top of it.
 *
 * `config.inspect` reads what is in force and where each value comes from. The writes need a `reason` (kept in the audit trail),
 * can pass `expectedRevision` to refuse a change made on a stale view, are validated with the same functions as the settings card,
 * and take effect on the next call. Only `config.upsert_cli` asks the user: it lets the plugin run a local program.
 * @module web-search-pro/actions/config
 */

import { dump } from 'js-yaml'
import { cliCommandLine, MAX_REASON, MIN_REASON, RESET_SCOPES, type AuditEntry, type OverlayItem } from '../overlay-types.ts'
import { pendingRestartLine } from '../restart.ts'
import { ActionUnavailableError, type ActionContext, type ActionDef, type OutputNode, type ParamSchema } from './types.ts'
import { PENDING_RESTART_SCHEMA } from './sources.ts'
import { cliSpecProblems, type OverlayChange } from '../overlay.ts'
import type { ResolvedConfig } from '../config.ts'

const REASON = { type: 'string', required: true, description: `Why the setting changes (${MIN_REASON}-${MAX_REASON} characters). Recorded in the audit trail the user can read.` } as const
const EXPECTED = { type: 'number', description: 'Revision from config.inspect; the change is refused if the overlay changed since you read it.' } as const

const NAMES = ['config.set_order', 'config.set_confidence', 'config.upsert_cli', 'config.remove_cli', 'config.reset'] as const

const AUDIT_SCHEMA: OutputNode = {
  type: 'array',
  items: {
    type: 'object', additionalProperties: false,
    properties: {
      revision: { type: 'number', required: true }, at: { type: 'string', required: true }, actor: { type: 'string', required: true }, action: { type: 'string', required: true },
      sessionId: { type: 'string' }, reason: { type: 'string', required: true },
      changes: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { key: { type: 'string', required: true }, before: { type: 'string', required: true }, after: { type: 'string', required: true } } } },
    },
  },
}

const SOURCE = { type: 'string', required: true } as const
const LIST_VALUE: OutputNode = { type: 'object', additionalProperties: false, properties: { value: { type: 'array', required: true, items: { type: 'string' } }, source: SOURCE } }

const WRITE_OUTPUT = {
  type: 'object', additionalProperties: false,
  properties: {
    changed: { type: 'boolean', required: true }, revision: { type: 'number', required: true },
    changes: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { key: { type: 'string', required: true }, before: { type: 'string', required: true }, after: { type: 'string', required: true } } } },
    note: { type: 'string' },
  },
} as const

function overlayOf(ctx: ActionContext) {
  if (!ctx.overlay) throw new ActionUnavailableError('the agent overlay is not available here', 'This host did not set the overlay up; ask the user to change the setting in the plugin configuration instead.')
  return ctx.overlay
}

/** Run one overlay change for an action call and shape its result. */
function write(action: typeof NAMES[number], change: (args: Record<string, any>) => OverlayChange) {
  return async (args: Record<string, any>, ctx: ActionContext) => {
    const applied = overlayOf(ctx).apply(change(args), {
      actor: 'agent', action, reason: args.reason,
      ...ctx.sessionId ? { sessionId: ctx.sessionId } : {},
      ...typeof args.expectedRevision === 'number' ? { expectedRevision: args.expectedRevision } : {},
    })
    return {
      changed: applied.changed, revision: applied.revision, changes: applied.changes,
      ...applied.changed ? {} : { note: 'Nothing changed: the overlay already holds these values, or they equal the configuration. The revision is unchanged and nothing was written.' },
    }
  }
}

function renderWrite(action: string): (value: unknown) => string {
  return value => {
    const v = value as { changed: boolean; revision: number; changes: { key: string; before: string; after: string }[]; note?: string }
    if (!v.changed) return action + ': ' + (v.note ?? 'nothing changed') + ' (revision ' + v.revision + ')'
    return [action + ': applied, overlay revision ' + v.revision + '; takes effect on the next call.', ...v.changes.map(change => '  ' + change.key + ': ' + change.before + '  →  ' + change.after)].join('\n')
  }
}

const sourceOf = (items: readonly OverlayItem[], key: string): 'overlay' | 'baseline' => items.some(item => item.key === key) ? 'overlay' : 'baseline'

/** Everything `config.inspect` reports, from the store and the two configurations. */
export function inspectOverlay(ctx: ActionContext, limit: number) {
  const overlay = overlayOf(ctx)
  const view = overlay.view(limit)
  const effective = overlay.effective()
  const base = overlay.baselineConfig()
  const items = view.items
  const chains = Object.keys({ ...base.platformBackends, ...overlay.current().values.platformBackends }).sort()
  const confidence = Object.keys(effective.sources.confidence).sort()
  const cli = Object.keys(effective.cliAdapters ?? {}).sort()
  return {
    revision: view.revision, file: view.file, valid: view.valid, ...view.problem ? { problem: view.problem } : {},
    engines: { value: effective.engines, source: sourceOf(items, 'engines') },
    priority: { value: effective.sources.priority, source: sourceOf(items, 'sources.priority') },
    disabled: { value: effective.sources.disabled, source: sourceOf(items, 'sources.disabled') },
    confidence: confidence.map(id => ({ id, value: effective.sources.confidence[id]!, source: sourceOf(items, 'sources.confidence.' + id) })),
    platforms: chains.map(platform => ({ platform, backends: effective.platformBackends?.[platform] ?? [], source: sourceOf(items, 'platformBackends.' + platform) })),
    cli: cli.map(id => {
      const spec = effective.cliAdapters![id]!
      return {
        id, source: sourceOf(items, 'cliAdapters.' + id), command: cliCommandLine(spec),
        ...typeof spec.engine === 'boolean' ? { engine: spec.engine } : {}, platforms: Array.isArray(spec.platforms) ? spec.platforms.filter((p): p is string => typeof p === 'string') : [],
        ...typeof spec.confidence === 'number' ? { confidence: spec.confidence } : {},
      }
    }),
    audit: view.audit,
    ...(ctx.pendingRestart?.() ?? []).length ? { pendingRestart: ctx.pendingRestart!() } : {},
  }
}

/** The overridable settings of the effective configuration as YAML the user can paste into the entry's `config:` in a profile. */
export function exportYaml(config: ResolvedConfig, revision: number): string {
  const body: Record<string, unknown> = { engines: config.engines }
  const sources: Record<string, unknown> = {}
  if (config.sources.priority.length) sources.priority = config.sources.priority
  if (config.sources.disabled.length) sources.disabled = config.sources.disabled
  if (Object.keys(config.sources.confidence).length) sources.confidence = config.sources.confidence
  if (Object.keys(sources).length) body.sources = sources
  if (config.platformBackends && Object.keys(config.platformBackends).length) body.platformBackends = config.platformBackends
  if (config.cliAdapters && Object.keys(config.cliAdapters).length) body.cliAdapters = config.cliAdapters
  return [
    '# Web Search Pro: the search order, source rules, platform backends and custom CLIs in force now',
    '# (the configuration with the agent overlay at revision ' + revision + ' on top). Paste into the config: of the',
    '# web-search-pro entry in your profile (cordis.patch.yml); then the overlay entries can be revoked.',
    dump(body, { lineWidth: 110, noRefs: true }).trimEnd(),
  ].join('\n') + '\n'
}

const renderAudit = (entry: AuditEntry): string =>
  '  #' + entry.revision + ' ' + entry.at + ' ' + entry.actor + (entry.sessionId ? ' ' + entry.sessionId : '') + ' ' + entry.action + ': "' + entry.reason + '"' + entry.changes.map(change => '\n      ' + change.key + ': ' + change.before + '  →  ' + change.after).join('')

export const CONFIG_ACTIONS: ActionDef[] = [
  {
    name: 'config.inspect',
    group: 'config',
    summary: 'Read the search order, source priority / disabled lists, confidence, platform backend chains and custom CLIs in force, which of them the agent overlay changed, the newest audit entries and the settings waiting for a restart.',
    notes: 'The overlay is a managed layer over the user\'s configuration; the user can read, adopt or revoke it in the settings card. revision is what expectedRevision of the config.* writes refers to. Call this before changing anything.',
    params: { limit: { type: 'number', description: 'Newest 1-50 audit entries. Default 10.' } },
    output: {
      type: 'object', additionalProperties: false,
      properties: {
        revision: { type: 'number', required: true }, file: { type: 'string', required: true }, valid: { type: 'boolean', required: true }, problem: { type: 'string' },
        engines: { ...LIST_VALUE, required: true }, priority: { ...LIST_VALUE, required: true }, disabled: { ...LIST_VALUE, required: true },
        confidence: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, value: { type: 'number', required: true }, source: SOURCE } } },
        platforms: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { platform: { type: 'string', required: true }, backends: { type: 'array', required: true, items: { type: 'string' } }, source: SOURCE } } },
        cli: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, source: SOURCE, command: { type: 'string', required: true }, engine: { type: 'boolean' }, platforms: { type: 'array', required: true, items: { type: 'string' } }, confidence: { type: 'number' } } } },
        audit: { ...AUDIT_SCHEMA, required: true },
        pendingRestart: PENDING_RESTART_SCHEMA,
      },
    },
    approval: 'none', mutating: false, concurrencySafe: true,
    timeoutMs: () => 10_000,
    examples: [{ args: {} }],
    async execute(args, ctx) {
      const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(50, Math.floor(args.limit))) : 10
      return inspectOverlay(ctx, limit)
    },
    render(value) {
      const v = value as ReturnType<typeof inspectOverlay>
      const tag = (source: string): string => source === 'overlay' ? ' [overlay]' : ' [configuration]'
      const lines = [
        'agent overlay: revision ' + v.revision + (v.valid ? '' : ' — IGNORED as a whole: ' + (v.problem ?? 'invalid') + ' (the configuration applies as written)'),
        'engines' + tag(v.engines.source) + ': ' + (v.engines.value.join(' > ') || '(none)'),
        'sources.priority' + tag(v.priority.source) + ': ' + (v.priority.value.join(' > ') || '(none)'),
        'sources.disabled' + tag(v.disabled.source) + ': ' + (v.disabled.value.join(', ') || '(none)'),
        'sources.confidence: ' + (v.confidence.length ? v.confidence.map(entry => entry.id + '=' + entry.value + tag(entry.source)).join(', ') : '(none set)'),
        'platformBackends: ' + (v.platforms.length ? '' : '(built-in chains)'),
        ...v.platforms.map(entry => '  ' + entry.platform + tag(entry.source) + ': ' + entry.backends.join(' > ')),
        'cliAdapters: ' + (v.cli.length ? '' : '(none)'),
        ...v.cli.map(entry => '  ' + entry.id + tag(entry.source) + ': ' + entry.command + (entry.engine ? ' [engine custom-cli:' + entry.id + ']' : '') + (entry.platforms.length ? ' [platforms ' + entry.platforms.join(', ') + ']' : '') + (entry.confidence !== undefined ? ' [confidence ' + entry.confidence + ']' : '')),
        ...v.audit.length ? ['audit (newest first):', ...v.audit.map(renderAudit)] : ['audit: (no changes yet)'],
        ...(v.pendingRestart ?? []).map(entry => '⚠ ' + pendingRestartLine(entry) + '；重启插件后生效'),
      ]
      return lines.join('\n')
    },
  },
  {
    name: 'config.set_order',
    group: 'config',
    summary: 'Change the engine order, the source priority / disabled lists, or the backend chain of one platform, for this and later searches. Takes effect at once; the user can revoke it in the settings card.',
    notes: 'Each list replaces the whole list in force (config.inspect shows it). Give only what changes. platform and backends go together: backends is the complete chain of that platform. A custom CLI is written custom-cli:<id>. To stop using a source, put it in disabled (a baseline entry cannot be deleted). The overlay never touches keys, paths or budgets.',
    params: {
      engines: { type: 'array', items: { type: 'string' }, description: 'The whole default engine list, in order, e.g. ["ddg","bing","exa"].' },
      priority: { type: 'array', items: { type: 'string' }, description: 'sources.priority: ids ranked first, in this order.' },
      disabled: { type: 'array', items: { type: 'string' }, description: 'sources.disabled: ids never used by automatic planning or the engines list.' },
      platform: { type: 'string', description: 'A platform with a backend chain, e.g. "xiaohongshu". Needs backends.' },
      backends: { type: 'array', items: { type: 'string' }, description: 'The complete backend chain of platform, in order, e.g. ["xhs","opencli"].' },
      reason: REASON, expectedRevision: EXPECTED,
    } satisfies ParamSchema,
    output: WRITE_OUTPUT,
    approval: 'config', mutating: true, concurrencySafe: false,
    timeoutMs: () => 10_000,
    errors: ['POLICY_DENIED'],
    examples: [{ args: { engines: ['bing', 'ddg'], reason: 'ddg is rate limited right now' } }, { args: { platform: 'xiaohongshu', backends: ['xhs', 'opencli'], reason: 'xhs is logged in' } }],
    execute: write('config.set_order', args => ({ kind: 'order', engines: args.engines, priority: args.priority, disabled: args.disabled, platform: args.platform, backends: args.backends })),
    render: renderWrite('config.set_order'),
  },
  {
    name: 'config.set_confidence',
    group: 'config',
    summary: 'Set the confidence (0..1) of one source or platform backend, or drop the overlay entry of it. Takes effect at once.',
    notes: 'Confidence only slightly lowers a source\'s weight when several sources are fused (1 = no adjustment) and is printed with its results. Omit value to remove the overlay\'s entry for id; the configuration\'s own value then applies again.',
    params: {
      id: { type: 'string', required: true, description: 'A source (ddg, exa, ...), a platform backend (xhs, browser-search, ...) or custom-cli:<id>.' },
      value: { type: 'number', description: '0..1. Omit to remove the overlay entry.' },
      reason: REASON, expectedRevision: EXPECTED,
    } satisfies ParamSchema,
    output: WRITE_OUTPUT,
    approval: 'config', mutating: true, concurrencySafe: false,
    timeoutMs: () => 10_000,
    errors: ['POLICY_DENIED'],
    examples: [{ args: { id: 'custom-cli:mine', value: 0.7, reason: 'its answers are usually fine but unchecked' } }],
    execute: write('config.set_confidence', args => ({ kind: 'confidence', id: args.id, value: args.value === undefined ? null : args.value })),
    render: renderWrite('config.set_confidence'),
  },
  {
    name: 'config.upsert_cli',
    group: 'config',
    summary: 'Add or replace a custom CLI source (the whole adapter spec) in the overlay. Always asks the user first: it lets this plugin run a local program.',
    notes: 'spec is one entry of the cliAdapters setting (bins, packageNote, platforms, engine, probe, allowedSubcommands, search, env, needsLogin, timeoutMs, maxOutputBytes ...). The same read-only checks as in the settings card apply: argv tokens, no login / write / delete words, no cookie or credential flags, no secrets in env. The id is the key; a spec with "engine": true is usable as custom-cli:<id> in engines. A CLI the overlay added is removed with config.remove_cli; one from the configuration is replaced by id, or switched off with sources.disabled.',
    params: {
      id: { type: 'string', required: true, description: 'Adapter id: lower case letters, digits, . _ - (at most 40).' },
      spec: { type: 'object', required: true, additionalProperties: true, description: 'The adapter spec, without id (see the cliAdapters setting).' },
      reason: REASON, expectedRevision: EXPECTED,
    } satisfies ParamSchema,
    output: WRITE_OUTPUT,
    approval: 'run-program', mutating: true, concurrencySafe: false,
    timeoutMs: () => 10_000,
    errors: ['POLICY_DENIED'],
    examples: [{ args: { id: 'mytool', spec: { bins: ['mytool'], packageNote: 'mytool (npm i -g mytool)', platforms: [], engine: true, probe: { versionArgs: ['--version'], helpArgs: ['search', '--help'], mustContain: ['--json'] }, allowedSubcommands: ['search'], search: { argv: ['search', '{query}', '--json'], output: { format: 'json', itemsPath: 'results', fields: { url: 'url', title: 'title', snippet: 'text' } } }, env: {}, needsLogin: false, timeoutMs: 20000, maxOutputBytes: 65536 }, reason: 'the user asked for mytool as a source' } }],
    precheck: args => cliSpecProblems(args.id, args.spec),
    execute: write('config.upsert_cli', args => ({ kind: 'upsertCli', id: args.id, spec: args.spec })),
    render: renderWrite('config.upsert_cli'),
  },
  {
    name: 'config.remove_cli',
    group: 'config',
    summary: 'Remove a custom CLI that the overlay added (not one from the configuration).',
    notes: 'Refused while the overlay still lists it in engines, a platform chain, priority, disabled or confidence: change those first. To stop using a CLI from the configuration, add custom-cli:<id> to disabled with config.set_order.',
    params: { id: { type: 'string', required: true, description: 'Adapter id from config.inspect.' }, reason: REASON, expectedRevision: EXPECTED } satisfies ParamSchema,
    output: WRITE_OUTPUT,
    approval: 'config', mutating: true, concurrencySafe: false,
    timeoutMs: () => 10_000,
    errors: ['POLICY_DENIED', 'NOT_FOUND'],
    examples: [{ args: { id: 'mytool', reason: 'no longer needed' } }],
    execute: write('config.remove_cli', args => ({ kind: 'removeCli', id: args.id })),
    render: renderWrite('config.remove_cli'),
  },
  {
    name: 'config.reset',
    group: 'config',
    summary: 'Drop overlay changes and go back to the configuration: everything, only the order lists, confidence, custom CLIs or platform chains, or one id of the last three.',
    notes: 'scope all also repairs an overlay file that could not be read (the bad file is moved aside). order = engines, priority, disabled. id narrows confidence / cli / platform to one entry.',
    params: {
      scope: { type: 'string', required: true, enum: RESET_SCOPES, description: 'What to drop.' },
      id: { type: 'string', description: 'With scope confidence, cli or platform: only this source id / adapter id / platform.' },
      reason: REASON, expectedRevision: EXPECTED,
    } satisfies ParamSchema,
    output: WRITE_OUTPUT,
    approval: 'config', mutating: true, concurrencySafe: false,
    timeoutMs: () => 10_000,
    errors: ['POLICY_DENIED', 'NOT_FOUND'],
    examples: [{ args: { scope: 'all', reason: 'back to the configured order' } }],
    execute: write('config.reset', args => ({ kind: 'reset', scope: args.scope, ...args.id !== undefined ? { id: args.id } : {} })),
    render: renderWrite('config.reset'),
  },
  {
    name: 'config.export',
    group: 'config',
    summary: 'Export the search order, source rules, platform backends and custom CLIs in force (configuration plus overlay) as YAML the user can paste into the plugin configuration.',
    notes: 'Read-only. Show the YAML to the user as it is; they decide whether to keep it in their profile. Contains no keys or paths.',
    params: {},
    output: { type: 'object', additionalProperties: false, properties: { yaml: { type: 'string', required: true }, revision: { type: 'number', required: true }, keys: { type: 'array', required: true, items: { type: 'string' } } } },
    approval: 'none', mutating: false, concurrencySafe: true,
    timeoutMs: () => 10_000,
    examples: [{ args: {} }],
    async execute(_args, ctx) {
      const overlay = overlayOf(ctx)
      const keys = overlay.items().map(item => item.key)
      return { yaml: exportYaml(overlay.effective(), overlay.current().revision), revision: overlay.current().revision, keys }
    },
    render: value => (value as { yaml: string }).yaml,
  },
]
