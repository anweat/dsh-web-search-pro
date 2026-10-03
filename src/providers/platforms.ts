/**
 * Platform search backends as registry providers (dev-plan M8b): one provider per site or community, with the same
 * descriptor + adapter shape as the web engines, so a platform is planned, probed, cooled down, singleflighted,
 * persisted and reported exactly like any other source. A platform with several backends (twitter: OpenCLI, then
 * twitter-cli) is ONE provider with an internal ordered chain. User `customPlatforms` become providers too
 * ({@link customPlatformAdapter}); the router registers and unregisters them as the settings change.
 * The legacy platform ids that already were web providers (github, bilibili, v2ex, youtube, arxiv, pubmed) are
 * declared in builtin.ts and carry `kind: 'platform'` as well.
 * @module web-search-pro/providers/platforms
 */

import crypto from 'node:crypto'
import {
  EngineError, agentReachEngine, customPlatformEngine, githubCodeEngine, githubIssuesEngine, opencliEngine,
  playwrightPlatformEngine, rssEngine, type Engine, type EngineDeps,
} from '../engines.ts'
import { browserGap, type BrowserMethod } from '../browser-access.ts'
import type { CustomPlatformSpec } from '../config.ts'
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
        if (!engine.available()) continue
        try {
          const outcome = await engine.search(query, count, signal, options)
          return { ...outcome, via: outcome.via ?? engine.id }
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
    },
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

/** Dimensions of a platform that runs through the optional dsh-browser service (`method`); the reason names what is missing. */
function browserDims(id: string, method: BrowserMethod, extraGap?: (env: ProbeEnv) => string | undefined): Dims {
  return (env, available) => {
    const gap = browserGap(env.deps.browser, method, 'platform ' + id)
    const bound = env.config.browserBindings?.[id]?.authProfile
    return {
      installation: !env.deps.browser ? 'missing' : gap ? 'incompatible' : 'detected',
      ...bound ? { credential: 'configured' as const } : {},
      ...available ? { diagnosticCode: 'login_unverified' } : { diagnosticCode: gap ? 'browser_missing' : 'disabled', ...(gap ?? extraGap?.(env)) ? { reason: (gap ?? extraGap?.(env))! } : {} },
    }
  }
}

/** Why the OpenCLI bridge cannot run although the browser is fine: a settings switch. */
const opencliSwitch = (env: ProbeEnv): string | undefined =>
  !env.deps.enableCli ? 'CLI backends are disabled in settings (enableCliBackends)' : !env.deps.opencliEnabled ? 'the OpenCLI backend is disabled in settings (opencliEnabled)' : undefined

const BROWSER_REQ: Requirement = { kind: 'browser', id: 'dsh-browser', note: 'logged-in browser session (OpenCLI bridge or a saved auth profile)' }

function opencliPlatform(id: string, label: string, over: Partial<ProviderDescriptor>): ProviderAdapter {
  return platform(descriptor({
    id: 'platform:' + id, aliases: [id], label, kind: 'platform', needsBrowser: 'opencli', taskProfiles: ['experience'], resultKinds: ['social'],
    requirements: [BROWSER_REQ], costModel: { kind: 'free', note: 'uses your logged-in session' },
    verification: { live: false, note: 'needs a logged-in browser session; not verified live' },
    ...over,
  }), deps => opencliEngine(id, deps), browserDims(id, 'opencli', opencliSwitch))
}

function browserPlatform(id: string, label: string, over: Partial<ProviderDescriptor>): ProviderAdapter {
  return platform(descriptor({
    id: 'platform:' + id, aliases: [id], label, kind: 'platform', needsBrowser: 'searchResults', taskProfiles: ['experience'], languages: ['zh'], regions: ['cn'],
    resultKinds: ['forum'], requirements: [BROWSER_REQ], costModel: { kind: 'free', note: 'reads the rendered search page in your logged-in browser' },
    verification: { live: false, note: 'best-effort page selectors, need a login state; not verified live' },
    ...over,
  }), deps => playwrightPlatformEngine(id, deps), browserDims(id, 'searchResults'))
}

const GITHUB_TOKEN_REQ = (optional: boolean, note: string): Requirement => ({ kind: 'key', id: 'github-token', env: ['GITHUB_TOKEN', 'GH_TOKEN'], optional, note })

/** The TWITTER_* tokens twitter-cli reads from the environment (both are needed). */
const twitterTokensSet = (): boolean => !!process.env.TWITTER_AUTH_TOKEN && !!process.env.TWITTER_CT0

export const platformAdapters: readonly ProviderAdapter[] = [
  platform(descriptor({
    id: 'platform:github-code', aliases: ['github-code'], label: 'GitHub 代码', kind: 'platform', domains: ['github.com'], taskProfiles: ['docs_code'], resultKinds: ['code'], sourceFamily: 'github',
    requirements: [GITHUB_TOKEN_REQ(false, 'code search requires an authenticated request')],
  }), githubCodeEngine, (env, ok) => ({ installation: 'not_required', credential: (env.deps.githubToken?.length ?? 0) > 0 || ok ? 'configured' : 'missing', ...ok ? {} : { reason: 'GitHub code search requires authentication: set $GITHUB_TOKEN (or config githubToken)', diagnosticCode: 'key_missing' } })),

  platform(descriptor({
    id: 'platform:github-issues', aliases: ['github-issues'], label: 'GitHub Issues', kind: 'platform', domains: ['github.com'], taskProfiles: ['docs_code', 'experience'], resultKinds: ['forum'], sourceFamily: 'github',
    requirements: [GITHUB_TOKEN_REQ(true, 'optional: raises the rate limit')],
  }), githubIssuesEngine, env => ({ installation: 'not_required', credential: (env.deps.githubToken?.length ?? 0) > 0 ? 'configured' : 'not_required' })),

  opencliPlatform('xiaohongshu', '小红书', { languages: ['zh'], regions: ['cn'], domains: ['xiaohongshu.com'] }),

  // One provider, two backends in today's order: the OpenCLI bridge first, twitter-cli (agent-reach) behind it.
  platform(descriptor({
    id: 'platform:twitter', aliases: ['twitter'], label: 'Twitter / X', kind: 'platform', needsBrowser: 'opencli', domains: ['twitter.com', 'x.com'], taskProfiles: ['experience', 'news_fact'], resultKinds: ['social'],
    requirements: [
      { kind: 'browser', id: 'dsh-browser', optional: true, note: 'first backend: OpenCLI bridge with your logged-in session' },
      { kind: 'cli', id: 'twitter', optional: true, note: 'second backend: twitter-cli' },
      { kind: 'key', id: 'twitter-auth-token', env: ['TWITTER_AUTH_TOKEN'], optional: true, note: 'twitter-cli needs this and TWITTER_CT0' },
      { kind: 'key', id: 'twitter-ct0', env: ['TWITTER_CT0'], optional: true, note: 'twitter-cli needs this and TWITTER_AUTH_TOKEN' },
    ],
    costModel: { kind: 'free', note: 'uses your logged-in session' },
    verification: { live: false, note: 'needs a logged-in session or twitter-cli tokens; not verified live' },
  }), deps => chainEngine('twitter', 'Twitter / X', [opencliEngine('twitter', deps), agentReachEngine('twitter', deps)]), (env, available) => {
    const gap = browserGap(env.deps.browser, 'opencli', 'platform twitter')
    const cli = env.cli?.get('twitter')
    const browserOk = !gap && !opencliSwitch(env)
    const cliOk = env.deps.enableCli && env.deps.agentReachEnabled && twitterTokensSet() && cli !== false
    const why: string[] = []
    if (!available) {
      why.push(gap ?? opencliSwitch(env) ?? 'OpenCLI backend unavailable')
      why.push(!env.deps.enableCli ? 'twitter-cli: CLI backends are disabled in settings' : !env.deps.agentReachEnabled ? 'twitter-cli: disabled in settings (agentReachEnabled)' : cli === false ? 'twitter-cli: the twitter command was not found' : 'twitter-cli: TWITTER_AUTH_TOKEN / TWITTER_CT0 are not set')
    }
    return {
      installation: browserOk || cli === true ? 'detected' : !env.deps.browser || cli === false ? 'missing' : 'incompatible',
      ...twitterTokensSet() ? { credential: 'configured' as const } : {},
      ...available ? {} : { reason: why.join('; '), diagnosticCode: gap ? 'browser_missing' : 'disabled' },
    }
  }),

  opencliPlatform('reddit', 'Reddit', { languages: ['en'], domains: ['reddit.com'] }),
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

  browserPlatform('zhihu', '知乎', { resultKinds: ['qa'], taskProfiles: ['experience', 'compare'], domains: ['zhihu.com'] }),
  browserPlatform('weibo', '微博', { resultKinds: ['social'], taskProfiles: ['experience', 'news_fact'], domains: ['weibo.com', 'weibo.cn'] }),
  browserPlatform('douban', '豆瓣', { taskProfiles: ['experience', 'compare'], domains: ['douban.com'] }),
  browserPlatform('tieba', '百度贴吧', { domains: ['tieba.baidu.com'] }),
  browserPlatform('douyin', '抖音', { resultKinds: ['video'], domains: ['douyin.com'] }),
  browserPlatform('kuaishou', '快手', { resultKinds: ['video'], domains: ['kuaishou.com'] }),
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
    requirements: [BROWSER_REQ],
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
