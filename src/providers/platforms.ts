/**
 * Platform search backends as registry providers (dev-plan M8b): one provider per site or community, with the same
 * descriptor + adapter shape as the web engines, so a platform is planned, probed, cooled down, singleflighted,
 * persisted and reported exactly like any other source. A platform with several backends (twitter: twitter-cli, standalone
 * OpenCLI, dsh-browser OpenCLI) is ONE provider with an internal ordered chain, resolved by src/cli/chain.ts (dev-plan M12). User `customPlatforms` become providers too
 * ({@link customPlatformAdapter}); the router registers and unregisters them as the settings change.
 * The legacy platform ids that already were web providers (github, bilibili, v2ex, youtube, arxiv, pubmed) are
 * declared in builtin.ts and carry `kind: 'platform'` as well.
 * @module web-search-pro/providers/platforms
 */

import crypto from 'node:crypto'
import {
  EngineError, customPlatformEngine, rssEngine, type Engine, type EngineDeps,
} from '../engines.ts'
import { browserGap, type BrowserMethod } from '../browser-access.ts'
import type { CustomPlatformSpec } from '../config.ts'
import { chainReport, resolveChain } from '../cli/chain.ts'
import { validateCliAdapterSpec, type CliAdapterSpec } from '../cli/spec.ts'
import { descriptor } from './descriptor.ts'
import type { ProbeEnv, ProviderAdapter, ProviderDescriptor, Readiness, Requirement } from './registry.ts'

/** Chain `engines` into one provider: the first available leg that answers wins; empty and failing legs fall through in order. */
export function chainEngine(id: string, label: string, chain: readonly Engine[]): Engine {
  return {
    id, label,
    available: () => chain.some(engine => engine.available()),
    async search(query, count, signal, options) {
      const errors: unknown[] = []
      const notes: string[] = []
      for (const engine of chain) {
        if (!engine.available()) { notes.push(engine.id + ': unavailable'); continue }
        try {
          const outcome = await engine.search(query, count, signal, options)
          // The legs that were passed over are named with their reasons, so a fall-through is never silent.
          const passed = notes.length ? ['skipped backends: ' + notes.join('; ')] : []
          return { ...outcome, via: outcome.via ?? engine.id, backend: outcome.backend ?? engine.backend ?? engine.id, ...passed.length || outcome.notes?.length ? { notes: [...passed, ...outcome.notes ?? []] } : {} }
        } catch (error) {
          if (signal?.aborted) throw error
          errors.push(error)
          notes.push(engine.id + ': ' + (error instanceof Error ? error.message : String(error)))
        }
      }
      if (!errors.length) throw new EngineError(label + ' unavailable', 'ENGINE_UNAVAILABLE', false)
      if (errors.length === 1) throw errors[0]
      const code = (error: unknown): unknown => (error as { code?: unknown } | null)?.code
      if (errors.every(error => code(error) === 'ENGINE_EMPTY')) throw new EngineError(notes.join('; '), 'ENGINE_EMPTY', false)
      throw new EngineError(notes.join('; '), 'ENGINE_ERROR', errors.some(error => (error as { retryable?: unknown } | null)?.retryable !== false))
    }
  }
}

type Create = (deps: EngineDeps, config: ProbeEnv['config']) => Engine
type Dims = (env: ProbeEnv, available: boolean) => Omit<Readiness, 'available'>

/** The platform adapter: local probe = the engine's own cheap `available()` plus the dimensions and the reason `dims` knows. */
function platform(d: ProviderDescriptor, create: Create, dims: Dims = () => ({})): ProviderAdapter {
  return {
    descriptor: d,
    create,
    probeLocal(env) {
      const engine = create(env.deps, env.config)
      const available = engine.available()
      const extra = dims(env, available)
      return { available, ...extra, ...available ? {} : { reason: extra.reason ?? engine.label + ' unavailable' } }
    },
  }
}

const BROWSER_REQ: Requirement = { kind: 'browser', id: 'dsh-browser', optional: true, note: 'dsh-browser backend: OpenCLI bridge or a saved auth profile (your logged-in session)' }
const cliReq = (id: string, note: string): Requirement => ({ kind: 'cli', id, optional: true, note })

/**
 * A platform provider whose backends are an ordered chain (`resolveChain`): the engine is the chain, the local probe is the
 * readiness of every leg (cached contract probes, no search, no login), and `chain` reports each leg for `sources.status`.
 */
export function chainProvider(platformId: string, d: ProviderDescriptor): ProviderAdapter {
  const label = d.label
  const ctxOf = (env: ProbeEnv) => ({ deps: env.deps, config: env.config })
  return {
    descriptor: d,
    create: (deps, config) => chainEngine(platformId, label, resolveChain(platformId, { deps, config }).legs.map(leg => leg.engine)),
    async probeLocal(env): Promise<Readiness> {
      const report = await chainReport(platformId, ctxOf(env))
      return {
        available: report.available,
        installation: report.installation,
        ...report.credential ? { credential: report.credential } : {},
        ...report.reason ? { reason: report.reason } : {},
        ...report.diagnosticCode ? { diagnosticCode: report.diagnosticCode } : {},
      }
    },
    chain: async env => chainReport(platformId, ctxOf(env)),
  }
}

function opencliPlatform(id: string, label: string, over: Partial<ProviderDescriptor>): ProviderAdapter {
  return chainProvider(id, descriptor({
    id: 'platform:' + id, aliases: [id], label, kind: 'platform', needsBrowser: 'opencli', taskProfiles: ['experience'], resultKinds: ['social'],
    requirements: [BROWSER_REQ], costModel: { kind: 'free', note: 'uses your logged-in session' }, costTier: 'free-quota',
    verification: { live: false, note: 'needs a logged-in browser session; not verified live' },
    ...over,
  }))
}

function browserPlatform(id: string, label: string, over: Partial<ProviderDescriptor>): ProviderAdapter {
  return chainProvider(id, descriptor({
    id: 'platform:' + id, aliases: [id], label, kind: 'platform', needsBrowser: 'searchResults', taskProfiles: ['experience'], languages: ['zh'], regions: ['cn'],
    resultKinds: ['forum'], requirements: [BROWSER_REQ], costModel: { kind: 'free', note: 'reads the rendered search page in your logged-in browser' }, costTier: 'free-quota',
    verification: { live: false, note: 'best-effort page selectors, need a login state; not verified live' },
    ...over,
  }))
}

/** A platform served by standalone CLIs (and optionally dsh-browser legs): `legs` name the CLI requirements shown in the descriptor. */
function cliPlatform(id: string, label: string, over: Partial<ProviderDescriptor>): ProviderAdapter {
  return chainProvider(id, descriptor({ id: 'platform:' + id, aliases: [id], label, kind: 'platform', ...over }))
}

const GITHUB_TOKEN_REQ = (optional: boolean, note: string): Requirement => ({ kind: 'key', id: 'github-token', env: ['GITHUB_TOKEN', 'GH_TOKEN'], optional, note })
const GH_REQ = cliReq('gh', 'fallback backend: GitHub CLI (`gh auth login` is yours to run)')

export const platformAdapters: readonly ProviderAdapter[] = [
  chainProvider('github-code', descriptor({
    id: 'platform:github-code', aliases: ['github-code'], label: 'GitHub 代码', kind: 'platform', domains: ['github.com'], taskProfiles: ['docs_code'], resultKinds: ['code'], sourceFamily: 'github',
    requirements: [GITHUB_TOKEN_REQ(true, 'code search requires an authenticated request: a token, or the gh fallback'), GH_REQ], costTier: 'free-quota',
  })),

  chainProvider('github-issues', descriptor({
    id: 'platform:github-issues', aliases: ['github-issues'], label: 'GitHub Issues', kind: 'platform', domains: ['github.com'], taskProfiles: ['docs_code', 'experience'], resultKinds: ['forum'], sourceFamily: 'github',
    requirements: [GITHUB_TOKEN_REQ(true, 'optional: raises the rate limit'), GH_REQ],
  })),

  cliPlatform('xiaohongshu', '小红书', {
    languages: ['zh'], regions: ['cn'], domains: ['xiaohongshu.com'], taskProfiles: ['experience'], resultKinds: ['social'],
    requirements: [cliReq('opencli', 'first backend: standalone OpenCLI with your own Chrome'), cliReq('xhs', 'second backend: xiaohongshu-cli (`xhs login` is yours to run)'), BROWSER_REQ],
    costModel: { kind: 'free', note: 'uses your logged-in session' }, costTier: 'free-quota',
    verification: { live: false, note: 'needs your login; command contracts probed locally, no search run' },
  }),

  // One provider, three backends in order: twitter-cli, the standalone OpenCLI, the dsh-browser OpenCLI bridge.
  cliPlatform('twitter', 'Twitter / X', {
    domains: ['twitter.com', 'x.com'], taskProfiles: ['experience', 'news_fact'], resultKinds: ['social'],
    requirements: [
      cliReq('twitter', 'first backend: twitter-cli (needs TWITTER_AUTH_TOKEN and TWITTER_CT0)'),
      { kind: 'key', id: 'twitter-auth-token', env: ['TWITTER_AUTH_TOKEN'], optional: true, note: 'twitter-cli needs this and TWITTER_CT0' },
      { kind: 'key', id: 'twitter-ct0', env: ['TWITTER_CT0'], optional: true, note: 'twitter-cli needs this and TWITTER_AUTH_TOKEN' },
      cliReq('opencli', 'second backend: standalone OpenCLI with your own Chrome'),
      BROWSER_REQ,
    ],
    costModel: { kind: 'free', note: 'uses your logged-in session' }, costTier: 'free-quota',
    verification: { live: false, note: 'needs a logged-in session or twitter-cli tokens; not verified live' },
  }),

  cliPlatform('reddit', 'Reddit', {
    languages: ['en'], domains: ['reddit.com'], taskProfiles: ['experience'], resultKinds: ['social'],
    requirements: [cliReq('rdt', 'first backend: rdt-cli (`rdt login` is yours to run)'), cliReq('opencli', 'second backend: standalone OpenCLI with your own Chrome'), BROWSER_REQ],
    costModel: { kind: 'free', note: 'uses your logged-in session' }, costTier: 'free-quota',
    verification: { live: false, note: 'needs your login; command contracts probed locally, no search run' },
  }),
  opencliPlatform('instagram', 'Instagram', { domains: ['instagram.com'] }),
  opencliPlatform('facebook', 'Facebook', { domains: ['facebook.com'] }),

  platform(descriptor({
    id: 'platform:rss', aliases: ['rss'], label: 'RSS', kind: 'platform', taskProfiles: ['news_fact'], resultKinds: ['feed'], regions: ['global'],
    requirements: [{ kind: 'service', id: 'feed-url', note: 'pass the feed as url=' }],
    verification: { live: true, note: 'shipped before the registry; exercised by the plugin since 0.1' },
  }), deps => ({
    id: 'rss', label: 'RSS',
    available: () => true,
    search(query, count, signal, options) {
      const url = options?.url
      if (!url || !/^https?:\/\//i.test(url)) throw new EngineError('RSS needs a feed URL: search.run platform=rss url=<feed>', 'ENGINE_UNAVAILABLE', false)
      return rssEngine(url, deps.allowProxyFakeIp).search(query, count, signal, options)
    },
  }), () => ({ installation: 'not_required', credential: 'not_required' })),

  cliPlatform('zhihu', '知乎', {
    languages: ['zh'], regions: ['cn'], resultKinds: ['qa'], taskProfiles: ['experience', 'compare'], domains: ['zhihu.com'],
    requirements: [cliReq('zhihu', 'first backend: zhihu-cli (`zhihu login` is yours to run)'), BROWSER_REQ],
    costModel: { kind: 'free', note: 'uses your logged-in session' }, costTier: 'free-quota',
    verification: { live: false, note: 'needs your login; command contract probed locally, no search run' },
  }),
  browserPlatform('weibo', '微博', { resultKinds: ['social'], taskProfiles: ['experience', 'news_fact'], domains: ['weibo.com', 'weibo.cn'] }),
  browserPlatform('douban', '豆瓣', { taskProfiles: ['experience', 'compare'], domains: ['douban.com'] }),
  browserPlatform('tieba', '百度贴吧', { domains: ['tieba.baidu.com'] }),
  browserPlatform('douyin', '抖音', { resultKinds: ['video'], domains: ['douyin.com'] }),
  browserPlatform('kuaishou', '快手', { resultKinds: ['video'], domains: ['kuaishou.com'] }),

  // WeChat official accounts (dev-plan M12): OmniReach's wechat source (Sogou, no key, no login), then wx-search-cli.
  cliPlatform('wechat', '微信公众号', {
    languages: ['zh'], regions: ['cn'], domains: ['mp.weixin.qq.com', 'weixin.qq.com'], taskProfiles: ['news_fact', 'experience'], resultKinds: ['social'],
    requirements: [cliReq('omnireach', 'first backend: OmniReach (`--on wechat`, Sogou, no key)'), cliReq('wx-search-cli', 'second backend: wx-search-cli (Sogou)')],
    costModel: { kind: 'free', note: 'Sogou WeChat search through a local CLI; no key, no login; rate limits and captchas apply' }, costTier: 'anonymous',
    verification: { live: true, note: 'omnireach 0.19.0-alpha wechat search parsed on 2026-10-06; wx-search-cli from its docs only' },
  }),

  // OmniReach as its own multi-source provider: addressable (`platform=omnireach`), never planned on its own.
  cliPlatform('omnireach', 'OmniReach (多源)', {
    languages: ['zh', 'en'], regions: ['global', 'cn'], taskProfiles: [], resultKinds: ['web', 'social'],
    requirements: [cliReq('omnireach', 'OmniReach CLI (its own default sources; browser-backed ones stay opt-in there)')],
    costModel: { kind: 'free', note: 'the CLI\'s default free sources; keys and the Chrome bridge are not passed' }, costTier: 'anonymous',
    verification: { live: false, note: 'contract probed and the wechat source run live; the multi-source command was not run' },
  }),

  // Tanso (Bocha / Zhihu API CLI): documented contract only.
  cliPlatform('tanso', 'Tanso (博查 / 知乎)', {
    languages: ['zh'], regions: ['cn'], taskProfiles: [], resultKinds: ['web'],
    requirements: [cliReq('tanso', 'Tanso CLI with your own Bocha / Zhihu keys in its config')],
    costModel: { kind: 'metered', unit: 'request', note: 'uses your Bocha / Zhihu keys through its own config' }, costTier: 'paid',
    verification: { live: false, note: 'documented contract only (upstream README); not installed or run' },
  }),
]

// ── user-defined platforms (settings `customPlatforms`) ─────────────────────

const ID_SAFE = /^[a-z0-9][a-z0-9._-]*$/

/** Registry id of a custom platform: its key when that is a valid id, else a stable hash of it (the key stays the route alias). */
export function customProviderId(key: string): string {
  return 'custom:' + (ID_SAFE.test(key) ? key : 'k' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 10))
}

function hostOf(url: string): string | undefined {
  try { return new URL(url.replace(/{query}/g, 'q')).hostname.replace(/^www\./, '') || undefined } catch { return undefined }
}

/** A key the registry cannot take as an alias (whitespace or a comma would break the `engines` list). */
export function customKeyProblem(key: string): string | undefined {
  return /[\s,]/.test(key) ? 'custom platform key "' + key + '" contains whitespace or a comma' : undefined
}

/**
 * A custom platform as a provider. The engine reads the spec from the settings it is created with, so a settings edit
 * reaches the next call even before the router re-registers the provider.
 */
export function customPlatformAdapter(key: string, spec: CustomPlatformSpec): ProviderAdapter {
  const host = hostOf(spec.url)
  return platform(descriptor({
    id: customProviderId(key), aliases: [key], label: spec.name + ' (自定义)', kind: 'platform', needsBrowser: 'searchResults', taskProfiles: ['experience'], resultKinds: ['forum'],
    ...host ? { domains: [host] } : {},
    requirements: [{ ...BROWSER_REQ, optional: false }],
    costModel: { kind: 'free', note: 'reads the rendered search page in your browser' },
    verification: { live: false, note: 'user-defined (settings customPlatforms)' },
  }), (deps, config) => customPlatformEngine(key, config.customPlatforms?.[key] ?? spec, deps), (env, available) => {
    const gap = browserGap(env.deps.browser, 'searchResults', 'platform ' + key)
    return {
      installation: !env.deps.browser ? 'missing' : gap ? 'incompatible' : 'detected',
      ...spec.cookie || env.config.browserBindings?.[key]?.authProfile ? { credential: 'configured' as const } : {},
      ...available ? {} : { diagnosticCode: 'browser_missing', ...gap ? { reason: gap } : {} },
    }
  })
}

// ── user-defined CLI adapters (settings `cliAdapters`) ──────────────────────

/** Registry id and route id of a user-defined CLI adapter: `custom-cli:<id>` (also its backend id in `platformBackends`). */
export const customCliProviderId = (id: string): string => 'custom-cli:' + id

/** A user-defined CLI adapter as a platform provider whose chain is the adapter itself (an edit of `platformBackends` can still reorder it). */
export function customCliAdapter(id: string, spec: CliAdapterSpec): ProviderAdapter {
  const route = customCliProviderId(id)
  return chainProvider(route, descriptor({
    id: route, aliases: [], label: spec.bins[0] + ' (自定义 CLI)', kind: 'platform', taskProfiles: ['experience'], languages: ['*'], regions: ['global'], resultKinds: ['web'],
    requirements: [cliReq(spec.bins[0]!, 'user-defined adapter ' + id + ': ' + spec.packageNote)],
    costModel: { kind: 'free', note: 'user-defined adapter (settings cliAdapters)' }, costTier: spec.needsLogin ? 'free-quota' : 'anonymous',
    verification: { live: false, note: 'user-defined (settings cliAdapters); unverified' },
  }))
}

/** A user spec as validated for registration: the problem text, or undefined when it can be registered. */
export function customCliProblem(id: string, raw: unknown): string | undefined {
  const result = validateCliAdapterSpec(raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw as Record<string, unknown>, id } : raw, 'user')
  return result.ok ? undefined : 'cliAdapters.' + id + ' ignored: ' + result.errors.join('; ')
}
