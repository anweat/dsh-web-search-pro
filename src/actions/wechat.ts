/**
 * `wechat` group: the layers of the WeChat official-account integration that are not a plain search (docs/dev/wechat-design.md).
 *
 *  - `wechat.status`: which layer is ready, its access profile (login, risk, billing), today's 元宝搜索 use against the daily limit,
 *    the last failure of each layer, and optionally (`probe`) a live check of the history service. No network without `probe`.
 *  - `wechat.album`: the articles of a 合集 (album) through WeChat's login-free JSON endpoint.
 *  - `wechat.accounts` / `wechat.articles`: search an official account by name and list its articles through the user's own
 *    wechat-download-api service (`wechat.history.baseUrl`); these act through the user's WeChat account, which is why every
 *    successful use carries the `wechat.account-risk` warning.
 *
 * All four only read. They do not ask for approval: the history service is one the user configured on purpose, and the risk is
 * stated to them in a notice instead. Verification: album live (2 anonymous requests), history contract-only, 元宝搜索 docs-only.
 * @module web-search-pro/actions/wechat
 */

import { ACCESS_SCHEMA, accessProfileOf, renderAccess, type AccessProfile } from '../wechat/access.ts'
import { ALBUM_DEFAULT_COUNT, ALBUM_MAX_COUNT, albumRefOf, decodeAlbumCursor, fetchAlbum, parseAlbumUrl } from '../wechat/album.ts'
import { layerHealth } from '../wechat/health.ts'
import { createHistoryClient, historyBase, HistoryError } from '../wechat/history.ts'
import { NOTICES_SCHEMA, notice, renderNotices, takeNotices, type Notice } from '../wechat/notices.ts'
import { wechatSettings } from '../wechat/settings.ts'
import { WSA_USAGE_PROVIDER } from '../wechat/wsa.ts'
import { ActionArgError, ActionUnavailableError, type ActionContext, type ActionDef, type OutputNode } from './types.ts'

const FAILURE_SCHEMA: OutputNode = { type: 'object', additionalProperties: false, properties: { at: { type: 'string', required: true }, message: { type: 'string', required: true } } }
const LAYER_SCHEMA: OutputNode = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', required: true }, name: { type: 'string', required: true }, kind: { type: 'string', required: true },
    state: { type: 'string', required: true }, reason: { type: 'string' }, verification: { type: 'string', required: true },
    access: ACCESS_SCHEMA, lastOk: { type: 'string' }, lastFailure: FAILURE_SCHEMA,
  },
}
const PROBE_SCHEMA: OutputNode = {
  type: 'object', additionalProperties: false,
  properties: {
    reachable: { type: 'boolean', required: true }, version: { type: 'string' }, loggedIn: { type: 'boolean' }, expired: { type: 'boolean' },
    account: { type: 'string' }, expireTime: { type: 'string' }, status: { type: 'string' }, problem: { type: 'string' },
  },
}

const ARTICLE_SCHEMA: OutputNode = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string', required: true }, url: { type: 'string', required: true }, publishedAt: { type: 'string' }, digest: { type: 'string' }, author: { type: 'string' },
    msgid: { type: 'string' }, itemidx: { type: 'string' }, aid: { type: 'string' },
  },
}

const LAYER_NAMES: Readonly<Record<string, string>> = {
  sogou: '搜狗直连（内置）', omnireach: 'OmniReach CLI（搜狗）', 'wx-search-cli': 'wx-search-cli（搜狗）', 'tencent-wsa': '元宝搜索（腾讯云，付费）',
  history: '整号历史服务（wechat-download-api）', album: '合集列表（免登录）',
}

interface Layer { id: string; name: string; kind: string; state: string; reason?: string; verification: string; access?: AccessProfile; lastOk?: string; lastFailure?: { at: string; message: string } }

/** Wrap one layer with its remembered health. */
function layer(base: Omit<Layer, 'lastOk' | 'lastFailure'>, healthId: string): Layer {
  const health = layerHealth(healthId)
  return { ...base, ...health.lastOk ? { lastOk: health.lastOk } : {}, ...health.lastFailure ? { lastFailure: health.lastFailure } : {} }
}

/** Chain-entry state words for the model: ready, off (not enabled / not in the chain), needs_setup (a key or login is missing), unavailable. */
function stateOfEntry(entry: { state: string; reason?: string; credential?: string }): string {
  if (entry.state === 'ready') return 'ready'
  if (/disabled in settings|not in the chain|\boff\b/.test(entry.reason ?? '')) return 'off'
  return entry.credential === 'missing' ? 'needs_setup' : 'unavailable'
}

function historyOf(ctx: ActionContext) {
  const settings = wechatSettings(ctx.dynamic()).history
  const parsed = settings.baseUrl ? historyBase(settings.baseUrl) : undefined
  return { settings, parsed }
}

/** The client of the configured history service; throws a CAPABILITY_UNAVAILABLE error naming the setting when there is none. */
function historyClient(ctx: ActionContext) {
  const { settings, parsed } = historyOf(ctx)
  if (!settings.baseUrl) throw new ActionUnavailableError('wechat.history.baseUrl is not set, so there is no history service to ask', 'Ask the user to run their own wechat-download-api and put its address (e.g. http://127.0.0.1:5000) in the plugin settings, "微信 / 公众号" > 服务地址. wechat.album works without it.')
  if (!parsed) throw new ActionUnavailableError('wechat.history.baseUrl is not an http(s) address: ' + settings.baseUrl.slice(0, 80), 'Ask the user to fix the address in the plugin settings, "微信 / 公众号" > 服务地址.')
  return createHistoryClient({ allowProxyFakeIp: ctx.dynamic().allowProxyFakeIp }, settings)
}

/** The success notices of a history call: the account-risk warning (once per session by the board), and the errors that came back are forgotten so they show again next time. */
function historySuccessNotices(ctx: ActionContext): Notice[] | undefined {
  ctx.notices?.reset?.('wechat.login-expired')
  ctx.notices?.reset?.('wechat.rate-limited')
  return takeNotices(ctx.notices, [notice('wechat.account-risk')])
}

const withNotices = (notices: Notice[] | undefined): { notices?: Notice[] } => (notices?.length ? { notices } : {})

const KIND_OF_SERVICE: Readonly<Record<number, string>> = { 0: '订阅号', 1: '服务号', 2: '企业号' }

export const WECHAT_ACTIONS: ActionDef[] = [
  {
    name: 'wechat.status',
    group: 'wechat',
    summary: 'Which WeChat official-account layers can run now (Sogou, OmniReach, wx-search-cli, 元宝搜索, history service, album), what each costs and risks, today\'s 元宝搜索 use, and the last failure of each. probe=true also checks your history service.',
    notes: 'Local and free unless probe=true, which makes two requests to the history service the user configured (wechat.history.baseUrl): its health and its stored WeChat login. Use it when a history call failed, before asking the user to re-scan, or to tell whether 元宝搜索 is set up. The access lines say what each layer asks of the user: login, risk, billing. verification says how far the contract was checked (live, contract-only, docs-only).',
    params: { probe: { type: 'boolean', description: 'Also ask the history service whether it is up and logged in (needs wechat.history.baseUrl). Default false.' } },
    output: {
      type: 'object', additionalProperties: false,
      properties: {
        layers: { type: 'array', required: true, items: LAYER_SCHEMA },
        wsa: { type: 'object', required: true, additionalProperties: false, properties: { enabled: { type: 'boolean', required: true }, keyConfigured: { type: 'boolean' }, edition: { type: 'string', required: true }, mode: { type: 'number', required: true }, dailyLimit: { type: 'number', required: true }, usedToday: { type: 'number', required: true }, remaining: { type: 'number', required: true } } },
        history: { type: 'object', required: true, additionalProperties: false, properties: { configured: { type: 'boolean', required: true }, baseUrl: { type: 'string' }, probe: PROBE_SCHEMA } },
        notices: NOTICES_SCHEMA,
      },
    },
    approval: 'none', mutating: false, concurrencySafe: true,
    timeoutMs: () => 80_000,
    examples: [{ args: {} }, { args: { probe: true }, note: 'check the history service and its WeChat login' }],
    async execute(args, ctx) {
      const cfg = ctx.dynamic()
      const settings = wechatSettings(cfg)
      const chain = await ctx.router.platformChain('wechat')
      const layers: Layer[] = (chain?.entries ?? []).map(entry => layer({
        id: entry.id, name: LAYER_NAMES[entry.id] ?? entry.label, kind: 'search', state: stateOfEntry(entry), ...entry.reason ? { reason: entry.reason } : {},
        verification: entry.verification, ...entry.access ?? accessProfileOf('wechat', entry.id) ? { access: entry.access ?? accessProfileOf('wechat', entry.id)! } : {},
      }, 'wechat:' + entry.id))
      const wsaEntry = chain?.entries.find(entry => entry.id === 'tencent-wsa')
      const used = ctx.router.requestsToday(WSA_USAGE_PROVIDER)
      const { parsed } = historyOf(ctx)
      const notices: Notice[] = []
      let probe: { reachable: boolean; version?: string; loggedIn?: boolean; expired?: boolean; account?: string; expireTime?: string; status?: string; problem?: string } | undefined
      if (args.probe === true) {
        if (!parsed) throw new ActionUnavailableError('wechat.history.baseUrl is not set (or not an http(s) address), so there is nothing to probe', 'Ask the user to put the address of their wechat-download-api in the plugin settings, "微信 / 公众号" > 服务地址.')
        const client = historyClient(ctx)
        try {
          const health = await client.health(ctx.signal)
          const login = await client.loginStatus(ctx.signal)
          const expireMs = Number(login.expireTime)
          const loggedIn = login.loggedIn === true || login.authenticated === true
          const expired = login.isExpired === true
          probe = {
            reachable: true,
            ...typeof health.version === 'string' ? { version: health.version } : {},
            loggedIn: loggedIn && !expired, expired,
            ...typeof login.nickname === 'string' && login.nickname ? { account: login.nickname } : {},
            ...Number.isFinite(expireMs) && expireMs > 0 ? { expireTime: new Date(expireMs).toISOString() } : {},
            ...typeof login.status === 'string' && login.status ? { status: login.status } : {},
          }
          if (!probe.loggedIn) notices.push(notice('wechat.login-expired'))
          else ctx.notices?.reset?.('wechat.login-expired')
        } catch (error) {
          if (ctx.signal.aborted) throw error
          if (!(error instanceof HistoryError)) throw error
          probe = { reachable: false, problem: error.message }
        }
      }
      const historyState = !parsed ? 'off' : probe ? (!probe.reachable ? 'unreachable' : probe.loggedIn ? 'ready' : 'needs_login') : 'untested'
      const historyReason = !parsed
        ? 'wechat.history.baseUrl is ' + (settings.history.baseUrl ? 'not an http(s) address' : 'empty') + ': wechat.accounts / wechat.articles are off'
        : probe ? (!probe.reachable ? probe.problem : !probe.loggedIn ? 'the service is up but has no valid WeChat login' + (probe.status ? ' (' + probe.status + ')' : '') : undefined)
          : 'configured at ' + parsed.origin + '; run with probe=true to check the service and its login'
      layers.push(layer({ id: 'history', name: LAYER_NAMES.history!, kind: 'history', state: historyState, ...historyReason ? { reason: historyReason } : {}, verification: 'contract-only', access: accessProfileOf('wechat', 'history')! }, 'history'))
      layers.push(layer({ id: 'album', name: LAYER_NAMES.album!, kind: 'browse', state: 'ready', verification: 'live' }, 'album'))
      const shown = takeNotices(ctx.notices, notices)
      return {
        layers,
        wsa: {
          enabled: settings.wsa.enabled, ...settings.wsa.enabled && wsaEntry ? { keyConfigured: wsaEntry.credential === 'configured' } : {},
          edition: settings.wsa.edition, mode: settings.wsa.mode, dailyLimit: settings.wsa.dailyLimit, usedToday: used, remaining: Math.max(settings.wsa.dailyLimit - used, 0),
        },
        history: { configured: !!parsed, ...parsed ? { baseUrl: parsed.base } : {}, ...probe ? { probe } : {} },
        ...withNotices(shown),
      }
    },
    render(value) {
      const v = value as { layers: Layer[]; wsa: { enabled: boolean; keyConfigured?: boolean; edition: string; mode: number; dailyLimit: number; usedToday: number; remaining: number }; history: { configured: boolean; baseUrl?: string; probe?: { reachable: boolean; version?: string; loggedIn?: boolean; expired?: boolean; account?: string; expireTime?: string; status?: string; problem?: string } }; notices?: Notice[] }
      const mark = (state: string): string => (state === 'ready' ? '✅' : state === 'off' || state === 'untested' ? '·' : '⚠')
      const lines = ['WeChat layers:']
      for (const l of v.layers) {
        lines.push(`  ${mark(l.state)} ${l.id} [${l.state}] ${l.name} · ${l.verification}${l.reason ? ' — ' + l.reason : ''}`)
        if (l.access) lines.push('       access: ' + renderAccess(l.access))
        if (l.lastOk) lines.push('       last ok: ' + l.lastOk)
        if (l.lastFailure) lines.push('       last failure (' + l.lastFailure.at + '): ' + l.lastFailure.message)
      }
      lines.push(`元宝搜索: ${v.wsa.enabled ? 'on' : 'off'}${v.wsa.keyConfigured !== undefined ? ', key ' + (v.wsa.keyConfigured ? 'found' : 'MISSING') : ''}, ${v.wsa.edition}${v.wsa.edition === 'lite' ? '' : ' mode ' + v.wsa.mode}, today ${v.wsa.usedToday}/${v.wsa.dailyLimit} requests (${v.wsa.remaining} left)`)
      const p = v.history.probe
      if (p) lines.push('history service probe: ' + (p.reachable ? `up${p.version ? ' ' + p.version : ''}, ${p.loggedIn ? 'logged in' + (p.account ? ' as ' + p.account : '') + (p.expireTime ? ', login runs until ' + p.expireTime : '') : 'NOT logged in' + (p.expired ? ' (expired)' : '') + (p.status ? ' — ' + p.status : '')}` : 'unreachable — ' + p.problem))
      const tail = renderNotices(v.notices)
      return lines.join('\n') + (tail ? '\n\n' + tail : '')
    },
  },
  {
    name: 'wechat.album',
    group: 'wechat',
    summary: 'List the articles of a WeChat 合集 (album) without any login: give the album page URL, or biz + albumId; returns title, link and time of each article and a cursor for the next page.',
    notes: 'Anonymous request to mp.weixin.qq.com (live-verified); it paces itself, so page through with the cursor instead of firing many calls. url is an album page link (…/mp/appmsgalbum?__biz=…&album_id=…); an article page that belongs to an album links to it. count is 1-20 (default 10); the newest article comes first. Links are plain mp.weixin.qq.com links: read.fetch may hit WeChat\'s verification page for them, then tell the user instead of retrying.',
    params: {
      url: { type: 'string', description: 'Album page URL (mp.weixin.qq.com/mp/appmsgalbum?__biz=…&album_id=…). Wins over biz / albumId.' },
      biz: { type: 'string', description: 'The account id (__biz) when you have no URL.' },
      albumId: { type: 'string', description: 'The album id (album_id, 19 digits) when you have no URL.' },
      count: { type: 'number', description: `Articles per page, 1-${ALBUM_MAX_COUNT}. Default ${ALBUM_DEFAULT_COUNT}.` },
      cursor: { type: 'string', description: 'nextCursor of the previous page, to continue.' },
    },
    output: {
      type: 'object', additionalProperties: false,
      properties: {
        albumTitle: { type: 'string' }, account: { type: 'string' }, totalArticles: { type: 'number' },
        articles: { type: 'array', required: true, items: ARTICLE_SCHEMA }, nextCursor: { type: 'string' }, notices: NOTICES_SCHEMA,
      },
    },
    approval: 'none', mutating: false, concurrencySafe: true,
    timeoutMs: () => 45_000,
    errors: ['CAPABILITY_UNAVAILABLE'],
    examples: [{ args: { url: 'https://mp.weixin.qq.com/mp/appmsgalbum?__biz=MzA3MDM3NjE5NQ==&action=getalbum&album_id=1375870284640911361' } }, { args: { biz: 'MzA3MDM3NjE5NQ==', albumId: '1375870284640911361', count: 5, cursor: '<nextCursor>' } }],
    async execute(args, ctx) {
      const ref = typeof args.url === 'string' && args.url.trim()
        ? parseAlbumUrl(args.url)
        : typeof args.biz === 'string' && typeof args.albumId === 'string' ? albumRefOf(args.biz.trim(), args.albumId.trim()) : undefined
      if (!ref) {
        throw new ActionArgError(args.url ? 'url is not a WeChat album page link (mp.weixin.qq.com/mp/appmsgalbum?__biz=…&album_id=…)' : 'give url, or both biz and albumId (the album id is 19 digits)', 'An album link has __biz and album_id in its query; an article page of an album points to it.')
      }
      const cursor = typeof args.cursor === 'string' && args.cursor ? decodeAlbumCursor(args.cursor) : undefined
      if (typeof args.cursor === 'string' && args.cursor && !cursor) throw new ActionArgError('cursor is not a cursor this action returned', 'Pass nextCursor of the previous page unchanged, or leave cursor out for the first page.')
      const count = typeof args.count === 'number' ? Math.min(Math.max(Math.trunc(args.count), 1), ALBUM_MAX_COUNT) : ALBUM_DEFAULT_COUNT
      const page = await fetchAlbum(ref, count, cursor, { deps: { allowProxyFakeIp: ctx.dynamic().allowProxyFakeIp }, signal: ctx.signal })
      return {
        ...page.title ? { albumTitle: page.title } : {}, ...page.nickname ? { account: page.nickname } : {}, ...page.totalArticles !== undefined ? { totalArticles: page.totalArticles } : {},
        articles: page.articles, ...page.nextCursor ? { nextCursor: page.nextCursor } : {},
      }
    },
    render(value) {
      const v = value as { albumTitle?: string; account?: string; totalArticles?: number; articles: { title: string; url: string; publishedAt?: string }[]; nextCursor?: string; notices?: Notice[] }
      const head = v.albumTitle ? `合集「${v.albumTitle}」${v.account ? ' · ' + v.account : ''}${v.totalArticles !== undefined ? ' · 共 ' + v.totalArticles + ' 篇' : ''}` : '合集'
      const lines = [head + ' — ' + v.articles.length + ' articles' + (v.nextCursor ? ' (more: pass cursor)' : ' (end)')]
      v.articles.forEach((a, i) => lines.push(`${i + 1}. ${a.title}${a.publishedAt ? ' · ' + a.publishedAt.slice(0, 10) : ''}\n   ${a.url}`))
      if (v.nextCursor) lines.push('nextCursor: ' + v.nextCursor)
      const tail = renderNotices(v.notices)
      return lines.join('\n') + (tail ? '\n\n' + tail : '')
    },
  },
  {
    name: 'wechat.accounts',
    group: 'wechat',
    summary: 'Search official accounts by name through your own wechat-download-api service (wechat.history.baseUrl): returns fakeid, name, alias and type. The fakeid is what wechat.articles needs.',
    notes: 'Needs wechat.history.baseUrl and a WeChat login in that service. It acts through the USER\'S OWN WeChat official-account back end: the account can be rate-limited or banned for heavy use, so use it sparingly, one query at a time, and never loop over many names. The service returns at most the first 5 matches. On a login or rate-limit failure tell the user what the notice says; do not retry in a loop. Verification: contract-only (read from the service\'s source).',
    params: { query: { type: 'string', required: true, description: 'Account name (or part of it) to search.' } },
    output: {
      type: 'object', additionalProperties: false,
      properties: {
        accounts: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { fakeid: { type: 'string', required: true }, nickname: { type: 'string', required: true }, alias: { type: 'string' }, serviceType: { type: 'number', required: true }, kind: { type: 'string' } } } },
        total: { type: 'number', required: true }, notices: NOTICES_SCHEMA,
      },
    },
    approval: 'none', mutating: false, concurrencySafe: true,
    timeoutMs: () => 60_000,
    errors: ['CAPABILITY_UNAVAILABLE'],
    examples: [{ args: { query: '机器之心' } }],
    async execute(args, ctx) {
      const query = String(args.query ?? '').trim()
      if (!query) throw new ActionArgError('query is required')
      const client = historyClient(ctx)
      const found = await client.searchAccounts(query, ctx.signal)
      return {
        accounts: found.accounts.map(a => ({ fakeid: a.fakeid, nickname: a.nickname, ...a.alias ? { alias: a.alias } : {}, serviceType: a.serviceType, ...KIND_OF_SERVICE[a.serviceType] ? { kind: KIND_OF_SERVICE[a.serviceType]! } : {} })),
        total: found.total, ...withNotices(historySuccessNotices(ctx)),
      }
    },
    render(value) {
      const v = value as { accounts: { fakeid: string; nickname: string; alias?: string; kind?: string }[]; total: number; notices?: Notice[] }
      const lines = [v.accounts.length ? `${v.accounts.length} account(s):` : 'No account matched.', ...v.accounts.map((a, i) => `${i + 1}. ${a.nickname}${a.alias ? ' (' + a.alias + ')' : ''}${a.kind ? ' · ' + a.kind : ''} · fakeid ${a.fakeid}`)]
      const tail = renderNotices(v.notices)
      return lines.join('\n') + (tail ? '\n\n' + tail : '')
    },
  },
  {
    name: 'wechat.articles',
    group: 'wechat',
    summary: 'List the articles an official account has published (newest first) through your own wechat-download-api service: title, link, time, digest. Read a body with read.fetch.',
    notes: 'Needs wechat.history.baseUrl and a WeChat login in that service; get the fakeid from wechat.accounts. It acts through the USER\'S OWN WeChat back end: high frequency gets the account rate-limited (ret=200013, can last days) or banned, so ask for one page at a time, never loop over pages or accounts, and stop at the first rate-limit notice. begin / count count WeChat\'s publish batches (one batch may hold several articles), so a page can hold more than count articles: continue with nextBegin (= begin + count), which is given while a page returned articles. count 1-100 (default 10). keyword filters by title inside the account. An answer "服务器内部错误" usually means the service is not logged in: check wechat.status probe=true. Verification: contract-only.',
    params: {
      fakeid: { type: 'string', required: true, description: 'Account id from wechat.accounts.' },
      begin: { type: 'number', description: 'Offset in publish batches, default 0. Use nextBegin of the previous page.' },
      count: { type: 'number', description: 'Batches per page, 1-100, default 10.' },
      keyword: { type: 'string', description: 'Only articles whose title matches (searched by the service).' },
    },
    output: {
      type: 'object', additionalProperties: false,
      properties: {
        articles: { type: 'array', required: true, items: ARTICLE_SCHEMA }, total: { type: 'number' }, begin: { type: 'number', required: true }, nextBegin: { type: 'number' }, notices: NOTICES_SCHEMA,
      },
    },
    approval: 'none', mutating: false, concurrencySafe: true,
    timeoutMs: () => 60_000,
    errors: ['CAPABILITY_UNAVAILABLE'],
    examples: [{ args: { fakeid: 'MzA1MjM1ODk2MA==' } }, { args: { fakeid: 'MzA1MjM1ODk2MA==', begin: 10, count: 10, keyword: '备案' } }],
    async execute(args, ctx) {
      const fakeid = String(args.fakeid ?? '').trim()
      if (!fakeid) throw new ActionArgError('fakeid is required', 'wechat.accounts returns it.')
      const begin = typeof args.begin === 'number' && args.begin >= 0 ? Math.trunc(args.begin) : 0
      const count = typeof args.count === 'number' ? Math.min(Math.max(Math.trunc(args.count), 1), 100) : 10
      const keyword = typeof args.keyword === 'string' && args.keyword.trim() ? args.keyword.trim() : undefined
      const client = historyClient(ctx)
      const found = await client.listArticles({ fakeid, begin, count, ...keyword ? { keyword } : {} }, ctx.signal)
      return {
        articles: found.articles, ...found.total !== undefined ? { total: found.total } : {}, begin,
        ...found.articles.length ? { nextBegin: begin + count } : {}, ...withNotices(historySuccessNotices(ctx)),
      }
    },
    render(value) {
      const v = value as { articles: { title: string; url: string; publishedAt?: string; digest?: string; author?: string }[]; total?: number; begin: number; nextBegin?: number; notices?: Notice[] }
      const lines = [`${v.articles.length} article(s) from batch ${v.begin}${v.total !== undefined ? ' (service total ' + v.total + ')' : ''}${v.nextBegin !== undefined ? '; next page: begin=' + v.nextBegin : '; no more'}`]
      v.articles.forEach((a, i) => lines.push(`${i + 1}. ${a.title}${a.publishedAt ? ' · ' + a.publishedAt.slice(0, 10) : ''}${a.author ? ' · ' + a.author : ''}\n   ${a.url}${a.digest ? '\n   ' + a.digest.slice(0, 120) : ''}`))
      const tail = renderNotices(v.notices)
      return lines.join('\n') + (tail ? '\n\n' + tail : '')
    },
  },
]
