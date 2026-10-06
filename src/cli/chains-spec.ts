/**
 * The static facts of the platform backend chains (dev-plan M12), free of Node imports so the settings card validates
 * `platformBackends` with the same code the server resolves it with: the default chain of each platform, which backend
 * ids exist and which platforms each can serve.
 * @module web-search-pro/cli/chains-spec
 */

import { BUILTIN_CLI_SPECS } from './builtin-specs.ts'
import { platformBackendProblems, resolveCliAdapters } from './spec.ts'

/** The default chain of each platform: first usable backend answers, empty or failing ones fall through in order. */
export const DEFAULT_CHAINS: Readonly<Record<string, readonly string[]>> = {
  xiaohongshu: ['opencli', 'xhs', 'browser-opencli'],
  reddit: ['rdt', 'opencli', 'browser-opencli'],
  twitter: ['twitter', 'opencli', 'browser-opencli'],
  zhihu: ['zhihu', 'browser-search'],
  bilibili: ['bili'],
  youtube: ['yt-dlp'],
  github: ['rest', 'gh'],
  'github-issues': ['rest', 'gh'],
  'github-code': ['rest', 'gh'],
  wechat: ['omnireach', 'wx-search-cli'],
  omnireach: ['omnireach'],
  tanso: ['tanso'],
  instagram: ['browser-opencli'],
  facebook: ['browser-opencli'],
  weibo: ['browser-search'],
  douban: ['browser-search'],
  tieba: ['browser-search'],
  douyin: ['browser-search'],
  kuaishou: ['browser-search'],
}

/** Platforms whose provider is a chain (everything in the default table). */
export const CHAIN_PLATFORMS: readonly string[] = Object.keys(DEFAULT_CHAINS)

/** Platform -> site of the standalone OpenCLI (`opencli <site> search`). */
export const OPENCLI_SITE_OF: Readonly<Record<string, string>> = {
  xiaohongshu: 'xiaohongshu', twitter: 'twitter', reddit: 'reddit', instagram: 'instagram', facebook: 'facebook',
  zhihu: 'zhihu', weibo: 'weibo', douban: 'douban', tieba: 'tieba', douyin: 'douyin', bilibili: 'bilibili', youtube: 'youtube', wechat: 'weixin',
}

/** Platforms the dsh-browser OpenCLI bridge has a site adapter for (pinned to engines.ts by a test). */
export const BROWSER_OPENCLI_PLATFORMS: readonly string[] = ['xiaohongshu', 'twitter', 'reddit', 'instagram', 'facebook']
/** Platforms with a built-in rendered-search-page spec in dsh-browser's searchResults (pinned to platform-search.ts by a test). */
export const BROWSER_SEARCH_PLATFORMS: readonly string[] = ['zhihu', 'weibo', 'douban', 'tieba', 'douyin', 'kuaishou']
/** Platforms the plugin's own REST client serves. */
export const REST_PLATFORMS: readonly string[] = ['github', 'github-issues', 'github-code']

/** Backend ids that are not CLI specs. */
export const FIXED_BACKENDS = ['opencli', 'browser-opencli', 'browser-search', 'rest'] as const

export interface BackendServing { ok: boolean; why?: string }

/**
 * Whether backend `id` can serve `platform`. `specPlatforms` maps a CLI spec id (built-in, or `custom-cli:<id>` of the user)
 * to the platforms it lists; a user spec serves any platform its chain names.
 */
export function backendServes(id: string, platform: string, specPlatforms: ReadonlyMap<string, readonly string[]>): BackendServing {
  if (id === 'opencli') return OPENCLI_SITE_OF[platform] ? { ok: true } : { ok: false, why: 'has no site for platform ' + platform }
  if (id === 'browser-opencli') return BROWSER_OPENCLI_PLATFORMS.includes(platform) ? { ok: true } : { ok: false, why: 'does not serve platform ' + platform }
  if (id === 'browser-search') return BROWSER_SEARCH_PLATFORMS.includes(platform) ? { ok: true } : { ok: false, why: 'does not serve platform ' + platform }
  if (id === 'rest') return REST_PLATFORMS.includes(platform) ? { ok: true } : { ok: false, why: 'does not serve platform ' + platform }
  const platforms = specPlatforms.get(id)
  if (!platforms) return { ok: false, why: 'is not a known backend (built-in ids: ' + [...specPlatforms.keys()].filter(k => !k.startsWith('custom-cli:')).join(', ') + ', ' + FIXED_BACKENDS.join(', ') + ')' }
  if (!id.startsWith('custom-cli:') && !platforms.includes(platform)) return { ok: false, why: 'does not serve platform ' + platform + ' (it serves ' + platforms.join(', ') + ')' }
  return { ok: true }
}

/** The CLI specs a chain may name: the built-ins by id and the user's valid `cliAdapters` as `custom-cli:<id>`. */
export function specPlatformsOf(cliAdapters: unknown): { platforms: Map<string, readonly string[]>; diagnostics: string[] } {
  const platforms = new Map<string, readonly string[]>(BUILTIN_CLI_SPECS.map(spec => [spec.id, spec.platforms]))
  const user = resolveCliAdapters(cliAdapters)
  for (const [id, spec] of user.specs) platforms.set('custom-cli:' + id, spec.platforms)
  return { platforms, diagnostics: user.diagnostics }
}

/**
 * Every problem of the `platformBackends` setting (shape, unknown platform, unknown or foreign backend id) given the
 * `cliAdapters` setting. The settings card and `sources.status` both call this.
 */
export function platformBackendIssues(platformBackends: unknown, cliAdapters: unknown): string[] {
  const shape = platformBackendProblems(platformBackends)
  if (shape.length || !platformBackends || typeof platformBackends !== 'object') return shape
  const { platforms } = specPlatformsOf(cliAdapters)
  const known = new Set<string>([...CHAIN_PLATFORMS, ...[...platforms.keys()].filter(id => id.startsWith('custom-cli:'))])
  const out: string[] = []
  for (const [platform, ids] of Object.entries(platformBackends as Record<string, string[]>)) {
    if (!known.has(platform)) { out.push('platformBackends.' + platform + ': no such platform with a backend chain (known: ' + [...known].join(', ') + ')'); continue }
    for (const id of ids) {
      const served = backendServes(id, platform, platforms)
      if (!served.ok) out.push('platformBackends.' + platform + ': "' + id + '" ' + served.why)
    }
  }
  return out
}
