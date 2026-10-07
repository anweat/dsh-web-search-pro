/**
 * `sources` group: what is configured and ready (engines, providers, CLI dependencies, browser, evidence judge),
 * and the external CLI dependencies the plugin runs.
 * @module web-search-pro/actions/sources
 */

import { browserState } from '../browser-access.ts'
import { defaultInstaller, detectDeps, installDep } from '../deps.ts'
import { judgeStatus, type JudgeStatus } from '../pipeline/judge-status.ts'
import { resolveAllRubrics } from '../pipeline/rubrics.ts'
import type { ProviderReport } from '../router.ts'
import { renderProviderState, type ProviderState } from '../provider.ts'
import type { ResolvedConfig } from '../config.ts'
import { ActionArgError, type ActionDef, type OutputNode } from './types.ts'

/** One registry provider in `sources.status` (all fields beyond id / label / readiness.available are optional extensions). */
const PROVIDER_REPORT_SCHEMA: OutputNode = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', required: true }, route: { type: 'string' }, aliases: { type: 'array', items: { type: 'string' } }, label: { type: 'string', required: true }, kind: { type: 'string' }, domains: { type: 'array', items: { type: 'string' } }, needsBrowser: { type: 'string' },
    operations: { type: 'array', items: { type: 'string' } }, taskProfiles: { type: 'array', items: { type: 'string' } }, languages: { type: 'array', items: { type: 'string' } },
    regions: { type: 'array', items: { type: 'string' } }, resultKinds: { type: 'array', items: { type: 'string' } }, sourceFamily: { type: 'string' }, costTier: { type: 'string' },
    requirements: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true }, id: { type: 'string', required: true }, env: { type: 'array', items: { type: 'string' } }, optional: { type: 'boolean' }, note: { type: 'string' } } } },
    supportedFilters: { type: 'array', items: { type: 'string' } },
    costModel: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true }, unit: { type: 'string' }, note: { type: 'string' } } },
    budget: { type: 'object', additionalProperties: false, properties: {
      source: { type: 'string', required: true }, day: { type: 'string', required: true }, exhausted: { type: 'boolean', required: true }, reason: { type: 'string' },
      total: { type: 'object', additionalProperties: false, properties: { limit: { type: 'number', required: true }, used: { type: 'number', required: true }, remaining: { type: 'number', required: true } } },
      daily: { type: 'object', additionalProperties: false, properties: { limit: { type: 'number', required: true }, used: { type: 'number', required: true }, remaining: { type: 'number', required: true } } },
    } },
    unverified: { type: 'boolean' },
    chain: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      id: { type: 'string', required: true }, kind: { type: 'string', required: true }, label: { type: 'string', required: true }, order: { type: 'number', required: true }, state: { type: 'string', required: true },
      installation: { type: 'string' }, version: { type: 'string' }, credential: { type: 'string' }, reason: { type: 'string' }, verification: { type: 'string', required: true },
    } } },
    readiness: { type: 'object', additionalProperties: false, properties: {
      available: { type: 'boolean', required: true }, state: { type: 'string' }, installation: { type: 'string' }, credential: { type: 'string' }, health: { type: 'string' }, reason: { type: 'string' }, diagnosticCode: { type: 'string' },
      lastLocalCheck: { type: 'string' }, lastRemoteSuccess: { type: 'string' }, lastError: { type: 'string' }, cooldownUntil: { type: 'string' },
    } },
  },
}

const EVIDENCE_STATUS_SCHEMA: OutputNode = {
  type: 'object', additionalProperties: false,
  properties: {
    scorer: { type: 'string', required: true }, jevMode: { type: 'string', required: true },
    mode: { type: 'string' }, decides: { type: 'string' }, modeNote: { type: 'string' },
    rubrics: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, version: { type: 'string', required: true }, overridden: { type: 'boolean', required: true }, hash: { type: 'string', required: true } } } },
    diagnostics: { type: 'array', items: { type: 'string' } },
    provider: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, protocol: { type: 'string' }, model: { type: 'string' }, usable: { type: 'boolean', required: true }, reason: { type: 'string' }, unverified: { type: 'boolean' }, calibration: { type: 'string' }, keyConfigured: { type: 'boolean' } } },
    providers: { type: 'array', items: { type: 'string' } },
    coverage: { type: 'object', additionalProperties: false, properties: {
      mode: { type: 'string', required: true }, provider: { type: 'string', required: true }, rubric: { type: 'string', required: true }, usable: { type: 'boolean', required: true }, reason: { type: 'string' },
      thresholds: { type: 'object', additionalProperties: false, properties: { weak: { type: 'number' }, covered: { type: 'number' } } }, thresholdSource: { type: 'string' }, keyConfigured: { type: 'boolean' },
    } },
    usage: { type: 'object', additionalProperties: false, properties: {
      day: { type: 'string', required: true }, timezone: { type: 'string' }, requests: { type: 'number', required: true }, inputTokens: { type: 'number', required: true }, outputTokens: { type: 'number', required: true },
      estimated: { type: 'boolean', required: true }, amountKnown: { type: 'boolean', required: true }, amount: { type: 'number' }, currency: { type: 'string' },
      caps: { type: 'object', additionalProperties: false, properties: { perSearchInputTokens: { type: 'number', required: true }, dailyInputTokens: { type: 'number', required: true } } },
      byProvider: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { provider: { type: 'string', required: true }, protocol: { type: 'string' }, requests: { type: 'number', required: true }, inputTokens: { type: 'number', required: true }, outputTokens: { type: 'number', required: true }, estimated: { type: 'boolean', required: true } } } },
    } },
  },
}

const SELECTION_SCHEMA: OutputNode = { type: 'object', additionalProperties: false, properties: { pinned: { type: 'string' }, via: { type: 'string', required: true }, state: { type: 'string', required: true } } }

/** The ctx.web provider route: registered by this plugin, and whether the Host is pinned to it (M8c). */
const WEB_ROUTE_SCHEMA: OutputNode = {
  type: 'object', additionalProperties: false,
  properties: { id: { type: 'string', required: true }, registered: { type: 'boolean', required: true }, evidence: { type: 'string', required: true }, search: SELECTION_SCHEMA, fetch: SELECTION_SCHEMA },
}

const DEP_SCHEMA: OutputNode = { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, label: { type: 'string', required: true }, usedBy: { type: 'string', required: true }, available: { type: 'boolean', required: true }, optional: { type: 'boolean' }, path: { type: 'string' }, source: { type: 'string' }, requiredVersion: { type: 'string' }, version: { type: 'string' }, diagnostic: { type: 'string' }, installation: { type: 'string' }, verification: { type: 'string' }, installs: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { installer: { type: 'string', required: true }, command: { type: 'string', required: true } } } } } }

/**
 * Whether the twitter platform backend can really run: the `twitter` command works (probed by detectDeps)
 * AND the backend is enabled in settings AND its credentials are in the environment (same gates as the engine).
 */
export function twitterGate(cfg: Pick<ResolvedConfig, 'enableCliBackends' | 'agentReachEnabled'>, dep: { available: boolean; diagnostic?: string }): { available: boolean; note?: string } {
  if (!dep.available) return { available: false, note: dep.diagnostic ?? 'twitter command not found (install twitter-cli; Agent-Reach alone does not provide it)' }
  if (!cfg.enableCliBackends) return { available: false, note: 'CLI backends are disabled in settings (enableCliBackends)' }
  if (!cfg.agentReachEnabled) return { available: false, note: 'disabled in settings (agentReachEnabled)' }
  if (!process.env.TWITTER_AUTH_TOKEN || !process.env.TWITTER_CT0) return { available: false, note: 'twitter command found, but TWITTER_AUTH_TOKEN / TWITTER_CT0 are not set' }
  return { available: true }
}

function defaultInstallerFor(backend: string): string {
  try { return defaultInstaller(backend) } catch (error) { throw new ActionArgError(error instanceof Error ? error.message : String(error), 'sources.deps lists the backend ids.') }
}

type Dep = { id: string; label: string; usedBy: string; available: boolean; optional?: boolean; path?: string; source?: string; requiredVersion?: string; version?: string; diagnostic?: string; installation?: string; verification?: string; installs: { installer: string; command: string }[] }

export const SOURCES_ACTIONS: ActionDef[] = [
  {
    name: 'sources.status',
    group: 'sources',
    summary: 'Side-effect-free diagnostics: engine availability and cooldowns, per-source readiness, CLI dependency health, dsh-browser state, evidence judge settings and usage. Makes no search requests, shows no credentials.',
    notes: 'For which source to use on a task, call search.recommend instead of reading this list.',
    params: {},
    output: {
      type: 'object', additionalProperties: false,
      properties: {
        engines: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, available: { type: 'boolean', required: true }, state: { type: 'string', required: true }, reason: { type: 'string' }, lastError: { type: 'string' }, cooldownUntil: { type: 'string' } } } },
        providers: { type: 'array', items: PROVIDER_REPORT_SCHEMA },
        cli: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, available: { type: 'boolean', required: true }, path: { type: 'string' }, note: { type: 'string' }, installation: { type: 'string' }, version: { type: 'string' }, verification: { type: 'string' } } } },
        browser: { type: 'object', additionalProperties: false, properties: { available: { type: 'boolean', required: true }, state: { type: 'string', required: true }, reason: { type: 'string' } } },
        webRoute: WEB_ROUTE_SCHEMA,
        notes: { type: 'array', items: { type: 'string' } },
        sources: { type: 'object', additionalProperties: false, properties: { policy: { type: 'string', required: true }, priority: { type: 'array', required: true, items: { type: 'string' } }, disabled: { type: 'array', required: true, items: { type: 'string' } } } },
        evidence: EVIDENCE_STATUS_SCHEMA,
      },
    },
    approval: 'none', mutating: false, concurrencySafe: true,
    timeoutMs: () => 20_000,
    examples: [{ args: {} }],
    async execute(_args, ctx) {
      const { router, store } = ctx
      const cfg = ctx.dynamic()
      const cli = await detectDeps({ config: cfg })
      const availability = new Map(cli.map(value => [value.id, value.available]))
      const ev = cfg.evidence
      const { rubrics, diagnostics } = resolveAllRubrics(ev.rubrics)
      const judge = await judgeStatus(ev, store, { hasSecret: typeof (router as { resolveSecret?: unknown }).resolveSecret === 'function' ? async ref => !!(await router.resolveSecret(ref)) : undefined })
      // Custom platforms the registry could not take (a key that clashes with a built-in source, a bad key).
      const problems = [
        ...typeof (router as { customPlatformProblems?: unknown }).customPlatformProblems === 'function' ? router.customPlatformProblems() : [],
        ...typeof (router as { sourceDiagnostics?: unknown }).sourceDiagnostics === 'function' ? router.sourceDiagnostics() : [],
        ...typeof (router as { cliAdapterProblems?: unknown }).cliAdapterProblems === 'function' ? router.cliAdapterProblems() : [],
      ]
      const providers = typeof (router as { providerReport?: unknown }).providerReport === 'function' ? await router.providerReport(availability) : undefined
      // A platform chain is only `ready` when a backend can run with its login satisfied (or not needed); otherwise the line says
      // what it really is (`login_unverified`, `needs_login`, `unavailable`) and what to do next, the same word as the provider report.
      const engines = (await router.backendDiagnostics(availability)).map(e => {
        const state = providers?.find(p => p.route === e.id)?.readiness
        if (!state?.state || state.state === 'ready' || e.state === 'cooldown') return e
        const reason = state.reason ?? e.reason
        return { ...e, state: state.state, available: state.state === 'login_unverified' && e.available, ...reason ? { reason } : {} }
      })
      return {
        engines,
        ...providers ? { providers } : {},
        cli: cli.map(v => {
          const gate = v.id === 'twitter' ? twitterGate(cfg, v) : undefined
          return { id: v.id, available: gate ? gate.available : v.available, ...v.path ? { path: v.path } : {}, ...v.installation ? { installation: v.installation } : {}, ...v.version ? { version: v.version } : {}, ...v.verification ? { verification: v.verification } : {}, ...gate?.note ? { note: gate.note } : v.optional ? { note: 'optional helper, not executed by this plugin' } : v.diagnostic ? { note: v.diagnostic } : {} }
        }),
        browser: browserState(ctx.browser()),
        ...ctx.providerState ? { webRoute: ctx.providerState() } : {},
        ...problems.length ? { notes: problems } : {},
        sources: { policy: ev.sourcePolicy ?? 'default', priority: cfg.sources?.priority ?? [], disabled: cfg.sources?.disabled ?? [] },
        evidence: { scorer: ev.scorer, jevMode: ev.jevMode, mode: judge.mode, decides: judge.decides, ...judge.modeNote ? { modeNote: judge.modeNote } : {}, rubrics: rubrics.map(r => ({ id: r.id, version: r.version, overridden: r.overridden, hash: r.hash })), ...diagnostics.length || judge.diagnostics.length ? { diagnostics: [...diagnostics, ...judge.diagnostics] } : {}, provider: judge.provider, providers: judge.providers, ...judge.coverage ? { coverage: judge.coverage } : {}, ...judge.usage ? { usage: judge.usage } : {} },
      }
    },
    render(value) {
      const v = value as { engines: { id: string; available: boolean; state: string; reason?: string; lastError?: string }[]; providers?: ProviderReport[]; notes?: string[]; sources?: { policy: string; priority: string[]; disabled: string[] }; cli: { id: string; available: boolean; path?: string; note?: string; installation?: string; version?: string; verification?: string }[]; browser?: { available: boolean; state: string; reason?: string }; webRoute?: ProviderState; evidence?: { scorer: string; jevMode: string; mode?: string; decides?: string; modeNote?: string; rubrics: { id: string; version: string; overridden: boolean; hash: string }[]; diagnostics?: string[]; provider?: JudgeStatus['provider']; providers?: string[]; coverage?: JudgeStatus['coverage']; usage?: JudgeStatus['usage'] } }
      const mark = (e: { available: boolean; state: string }): string => (e.state === 'login_unverified' || e.state === 'needs_login' ? '⚠ ' : e.available ? '✅ ' : '❌ ')
      const lines = v.engines.map(e => mark(e) + e.id + ' [' + e.state.replace('_', ' ') + ']' + (e.lastError || e.reason ? ' — ' + (e.lastError ?? e.reason) : ''))
      for (const p of v.providers ?? []) {
        const r = p.readiness
        const dims = [r.installation && 'installation=' + r.installation, r.credential && 'credential=' + r.credential, r.health && 'health=' + r.health, r.state && 'state=' + r.state].filter(Boolean).join(' ')
        lines.push('  ' + (p.kind === 'platform' ? 'platform ' : 'provider ') + p.route + (p.id !== p.route ? ' (' + p.id + ')' : '') + ': ' + dims + ' · ' + (p.languages.join('/') || '*') + ' · ' + p.taskProfiles.join('/') + (p.costTier ? ' · ' + p.costTier : '') + (p.sourceFamily ? ' · family ' + p.sourceFamily : '') + (p.unverified ? ' · [not verified live]' : '') + (r.available ? '' : ' [' + (r.reason ?? 'unavailable') + ']'))
        for (const leg of p.chain ?? []) lines.push('    ' + leg.order + '. ' + leg.id + ' [' + leg.state + (leg.version ? ' ' + leg.version : '') + '] ' + leg.verification + (leg.reason ? ' — ' + leg.reason : ''))
        const b = p.budget
        if (b) lines.push('    request budget ' + p.route + ': ' + [b.total && 'total ' + b.total.used + '/' + b.total.limit + ' (' + b.total.remaining + ' left)', b.daily && 'today ' + b.daily.used + '/' + b.daily.limit + ' (' + b.daily.remaining + ' left)'].filter(Boolean).join(', ') + (b.exhausted ? ' — used up: skipped, the plan falls back to other sources' : ''))
      }
      if (v.sources) lines.push('source strategy: policy=' + v.sources.policy + (v.sources.priority.length ? ', priority: ' + v.sources.priority.join(' > ') : '') + (v.sources.disabled.length ? ', disabled: ' + v.sources.disabled.join(', ') : ''))
      lines.push(...(v.notes ?? []).map(n => '  ⚠ ' + n))
      lines.push(...v.cli.map(e => (e.available ? '✅ ' : '❌ ') + 'cli:' + e.id + (e.installation && e.installation !== 'detected' ? ' [' + e.installation + ']' : '') + (e.version ? ' ' + e.version : '') + (e.path ? ' — ' + e.path : '') + (e.note ? ' — ' + e.note : '')))
      if (v.browser) lines.push((v.browser.state === 'ready' ? '✅ ' : '❌ ') + 'browser:dsh-browser [' + (v.browser.state === 'legacy' ? 'legacy (unsupported)' : v.browser.state) + ']' + (v.browser.reason ? ' — ' + v.browser.reason : ''))
      if (v.webRoute) lines.push(...renderProviderState(v.webRoute))
      if (v.evidence) {
        // The effective judge mode, not the legacy `scorer` flag (which reads "rule" even while hybrid mode is on).
        lines.push(v.evidence.mode !== undefined
          ? 'evidence: judge mode=' + v.evidence.mode + ', decides=' + v.evidence.decides + (v.evidence.modeNote ? ' (' + v.evidence.modeNote + ')' : '')
          : 'evidence: scorer=' + v.evidence.scorer + ' jevMode=' + v.evidence.jevMode)
        lines.push(...v.evidence.rubrics.map(r => '  rubric ' + r.id + '@' + r.version + ' #' + r.hash + (r.overridden ? ' (override)' : ' (built-in)')))
        const p = v.evidence.provider
        if (p) lines.push('  judge provider: ' + p.id + (p.protocol ? ' (' + p.protocol + ', ' + p.model + ')' : '') + (p.usable ? '' : ' [unusable: ' + p.reason + ']') + (p.unverified ? ' [preset not verified live]' : '') + (p.calibration ? ' calibration ' + p.calibration : '') + (p.keyConfigured === false ? ' [key not found]' : ''))
        const c = v.evidence.coverage
        if (c) lines.push('  coverage judge: mode=' + c.mode + ' (' + c.provider + ', ' + c.rubric + ')' + (c.usable ? '' : ' [not used: ' + c.reason + ']') + (c.thresholds ? ' thresholds weak<' + c.thresholds.weak + ' covered>=' + c.thresholds.covered + ' (' + c.thresholdSource + ')' : ''))
        const u = v.evidence.usage
        if (u) lines.push('  model usage ' + u.day + (u.timezone ? ' ' + u.timezone : '') + ': ' + u.requests + ' request(s), ' + u.inputTokens + ' input / ' + u.outputTokens + ' output tokens' + (u.estimated ? ' (partly estimated)' : '') + (u.amount !== undefined ? ', ' + u.amount.toFixed(4) + ' ' + (u.currency ?? '') : u.requests ? ', cost unknown' : '') + '; caps: ' + u.caps.perSearchInputTokens + '/search, ' + u.caps.dailyInputTokens + '/day input tokens')
        for (const b of u?.byProvider ?? []) if (b.protocol === 'search') lines.push('  search usage ' + b.provider + ': ' + b.requests + ' request(s) today (tokens n/a, price unknown)')
        lines.push(...(v.evidence.diagnostics ?? []).map(d => '  ⚠ ' + d))
      }
      return lines.join('\n')
    },
  },
  {
    name: 'sources.deps',
    group: 'sources',
    summary: 'List the external CLIs the backends run (bili, yt-dlp, twitter, xhs, zhihu, rdt, omnireach, gh, opencli, your cliAdapters, ...): installation (missing / detected / incompatible with the reason), version, how far each adapter was verified, install commands. Local cached probes; never searches or logs in.',
    params: {},
    output: { type: 'object', additionalProperties: false, properties: { backends: { type: 'array', required: true, items: DEP_SCHEMA }, message: { type: 'string' } } },
    approval: 'none', mutating: false, concurrencySafe: true,
    timeoutMs: config => config.timeoutMs + 180_000,
    examples: [{ args: {} }],
    async execute(_args, ctx) {
      // An explicit check re-probes (sources.status and search.recommend reuse the cached probes of the last minute).
      const backends = await detectDeps({ config: ctx.dynamic(), force: true })
      const allOk = backends.every(b => b.available || b.optional)
      return {
        backends: backends.map(b => ({ ...b, installs: b.installs })),
        ...allOk ? { message: '所有外部依赖已就绪。' } : { message: '部分外部依赖缺失，可对缺失项运行 sources.install（仅在用户要求时；或手动执行列出的安装命令）。' },
      }
    },
    render: value => renderDeps(value as { backends: Dep[]; message?: string }),
  },
  {
    name: 'sources.install',
    group: 'sources',
    summary: 'Run one install command for a missing CLI dependency. Only when the user asks; it needs approval.',
    notes: 'Check with sources.deps first. Installers: winget, choco, brew, uv, pipx, pip or npm. Logging in to a tool (`xhs login`, `gh auth login`, ...) is never done here: the user runs it.',
    params: {
      backend: { type: 'string', required: true, description: 'Dependency id from sources.deps (bili, yt-dlp, twitter, xhs, zhihu, rdt, omnireach, gh, wx-search-cli, tanso, opencli, agent-reach, mcporter).' },
      installer: { type: 'string', description: 'winget, choco, brew, uv, pipx, pip or npm; default: the first one listed for the backend.' },
    },
    output: {
      type: 'object', additionalProperties: false,
      properties: { install: { type: 'object', required: true, additionalProperties: false, properties: { code: { type: 'number' }, stdout: { type: 'string' }, stderr: { type: 'string' }, timedOut: { type: 'boolean' } } } },
    },
    approval: 'install', mutating: true, concurrencySafe: false,
    timeoutMs: config => config.timeoutMs + 180_000,
    examples: [{ args: { backend: 'yt-dlp' } }],
    async execute(args) {
      const installer = args.installer ?? defaultInstallerFor(args.backend)
      const result = await installDep(args.backend, installer)
      return { install: { ...result } }
    },
    render(value) {
      const v = value as { install: { code: number; stdout: string; stderr: string; timedOut: boolean } }
      return '安装结果 exit=' + v.install.code + (v.install.timedOut ? ' (超时)' : '') + '\n' + (v.install.stderr || v.install.stdout).slice(0, 2000)
    },
  },
]

function renderDeps(v: { backends: Dep[]; message?: string }): string {
  const parts: string[] = []
  if (v.message) parts.push(v.message)
  for (const b of v.backends) {
    const details = [b.installation && b.installation !== 'detected' ? b.installation : '', b.verification ? '适配 ' + b.verification : '', b.version ? '版本 ' + b.version : '', b.requiredVersion ? '要求 ' + b.requiredVersion : '', b.source ? '来源 ' + b.source : '', b.path ? b.path : ''].filter(Boolean)
    parts.push((b.available ? '✅' : b.optional ? '➖' : '❌') + ' ' + b.label + ' (' + b.id + ') — ' + b.usedBy + (details.length ? ' · ' + details.join(' · ') : ''))
    if (b.diagnostic) parts.push('   诊断: ' + b.diagnostic)
    if (!b.available) parts.push('   安装: ' + b.installs.map(i => i.installer + ': ' + i.command).join('   |   '))
  }
  return parts.join('\n')
}
