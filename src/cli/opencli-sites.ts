/**
 * The static facts of the standalone OpenCLI sites the plugin searches (free of Node imports, so the catalog and the chain
 * specs can read them): which site serves which platform, how each site's `search` rows map to sources, and how far each
 * mapping was verified. The spec generation itself (src/cli/opencli.ts) reads the live command table.
 * @module web-search-pro/cli/opencli-sites
 */

import type { CliAdapterSpec, CliOutputSpec } from './spec.ts'

/** Platform -> site of the standalone OpenCLI (`opencli <site> search`). */
export const OPENCLI_SITE_OF: Readonly<Record<string, string>> = {
  xiaohongshu: 'xiaohongshu', twitter: 'twitter', reddit: 'reddit', instagram: 'instagram', facebook: 'facebook',
  zhihu: 'zhihu', weibo: 'weibo', douban: 'douban', tieba: 'tieba', douyin: 'douyin', bilibili: 'bilibili', youtube: 'youtube', wechat: 'weixin',
}

/** Generic field mapping over the columns OpenCLI commands emit (rank, title, url, summary, ...), for the sites without a measured or documented mapping below. */
const FIELDS = {
  url: ['url', 'link', 'href', 'projectUrl', 'item_url'],
  title: ['title', 'name', 'text', 'desc', 'label'],
  snippet: ['summary', 'snippet', 'description', 'desc', 'content', 'selftext', 'abstract', 'author', 'user'],
  publishedAt: ['published_at', 'publish_time', 'created_at', 'date', 'time', 'published', 'postTime'],
} as const

export const GENERIC_OUTPUT: CliOutputSpec = {
  format: 'json', stripTags: true,
  fields: { url: [...FIELDS.url], title: [...FIELDS.title], snippet: [...FIELDS.snippet], publishedAt: [...FIELDS.publishedAt] },
}

/**
 * The output mapping of the sites the plugin knows by their real columns. All four print a JSON array of flat rows under `-f json`.
 *  - twitter, zhihu: MEASURED (opencli 1.8.8, 2026-10-27, fixtures live-opencli-*). twitter rows are `id, author (handle), bio, text,
 *    created_at (X API format), likes (number), views (string), url (https://x.com/i/status/<id>), has_media, media_urls, ...`; the
 *    title and meta line follow the standalone twitter backend (text, then author · likes · views · time). zhihu rows are
 *    `rank, title, type, author, votes, url` and carry no excerpt and no time.
 *  - xiaohongshu, reddit: NOT MEASURED. The only runs failed (login wall; an HTML page instead of JSON), so the mapping is the
 *    documented columns of clis/xiaohongshu/search.js (`rank, title, author, likes, published_at (date from the note id), url`,
 *    the url is a signed search_result link) and clis/reddit/search.js (`id, title, subreddit (r/x), author, score, comments, url,
 *    created_utc (epoch seconds), selftext, ...`), read from the source of 1.8.8.
 *  - weibo, tieba, douyin: NOT MEASURED, columns read from clis/<site>/search.js of 1.8.8 (2026-11-25): weibo `rank, id, title (the post
 *    text), author, time (the page's text, `3分钟前` or a date), url`; tieba `rank, id, title, forum, author, time, url` (its rows also
 *    carry a `snippet` of up to 200 characters, which is read when present); douyin `rank, desc, author, url (https://www.douyin.com/video/<id>),
 *    plays, likes, comments, shares` where plays, comments and shares are always 0 (the search page does not show them) - a value of 0 is
 *    not shown as a fact. Each command's own --limit maximum (weibo 50, tieba 20, douyin 30) is at or above the adapter's maxCount of 20.
 */
export const SITE_OUTPUT: Readonly<Record<string, CliOutputSpec>> = {
  twitter: {
    format: 'json', titleMax: 200,
    fields: {
      url: [{ template: 'https://x.com/{author}/status/{id}' }, 'url'],
      title: ['text', { template: '@{author}' }],
      snippet: { join: [{ template: '@{author}' }, { path: 'likes', prefix: 'likes ' }, { path: 'views', prefix: 'views ' }, { time: 'created_at' }], sep: ' · ' },
      publishedAt: { time: 'created_at' },
    },
  },
  zhihu: {
    format: 'json', stripTags: true,
    fields: {
      url: 'url',
      title: 'title',
      snippet: { join: ['type', 'author', { path: 'votes', prefix: '赞同 ' }], sep: ' · ' },
    },
  },
  xiaohongshu: {
    format: 'json',
    fields: {
      url: 'url',
      title: 'title',
      snippet: { join: [{ path: 'author', prefix: '作者: ' }, { path: 'likes', prefix: '赞: ' }] },
      publishedAt: { time: 'published_at' },
    },
  },
  reddit: {
    format: 'json',
    fields: {
      url: 'url',
      title: 'title',
      snippet: { join: ['subreddit', { path: 'score', prefix: 'score ' }, { path: 'comments', suffix: ' comments' }, 'selftext'], sep: ' · ' },
      publishedAt: { epoch: 'created_utc' },
    },
  },
  // weibo, tieba, douyin: columns read from the 1.8.8 sources; the commands themselves were run on 2026-11-25 and print exactly these columns (see the notes below). `time` is the page's own text: it becomes a
  // date only in an exact format (`3分钟前`, `昨天 08:00`, `MM-DD`), otherwise the row has no time rather than a guessed one.
  weibo: {
    format: 'json', titleMax: 200,
    fields: {
      url: 'url',
      title: 'title',
      snippet: { join: [{ path: 'author', prefix: '@' }, 'time'], sep: ' · ' },
      publishedAt: { time: 'time' },
    },
  },
  tieba: {
    format: 'json',
    fields: {
      url: ['url', { template: 'https://tieba.baidu.com/p/{id}' }],
      title: 'title',
      snippet: { join: ['forum', 'author', 'time', 'snippet'], sep: ' · ' },
      publishedAt: { time: 'time' },
    },
  },
  douyin: {
    format: 'json', emptyValues: ['0'],
    fields: {
      url: 'url',
      title: 'desc',
      // plays, comments and shares are always 0 in the output (the search page does not show them): only the like count carries information, and a 0 is hidden.
      snippet: { join: [{ path: 'author', prefix: '@' }, { path: 'likes', prefix: '赞 ' }], sep: ' · ' },
    },
  },
}

const CHECKED = { version: '1.8.8', date: '2026-10-27' } as const
const SITE_VERIFICATION: Readonly<Record<string, NonNullable<CliAdapterSpec['verification']>>> = {
  twitter: { status: 'live', ...CHECKED, note: '`opencli twitter search -f json` run on the user\'s own Chrome (OpenCLI Browser Bridge) and parsed: a JSON array of tweets (fixture live-opencli-twitter-search.json); created_at is in the X API format and is converted to ISO' },
  zhihu: { status: 'live', ...CHECKED, note: '`opencli zhihu search -f json` run on the user\'s own Chrome and parsed: a JSON array of { rank, title, type, author, votes, url } without excerpt or time (fixture live-opencli-zhihu-search.json)' },
  xiaohongshu: { status: 'contract-only', version: '2.0.3', date: '2026-11-25', note: 'run on the user\'s own logged-in Chrome by calling opencli directly (1.8.8 and 2.0.3); the printed columns are the ones mapped here, but the rows were not kept and not parsed through this adapter, so it stays contract-only. 1.8.8 fails since the site changed its search page (0 of 4, TIMEOUT / COMMAND_EXEC, also logged in), 2.0.3 answered 2 of 4 (the other two timed out on the in-site navigation). AUTH_REQUIRED without a login is mapped (fixture live-opencli-xiaohongshu-auth-required.yaml)' },
  weibo: { status: 'contract-only', version: '2.0.3', date: '2026-11-25', note: 'run on the user\'s own logged-in Chrome by calling opencli directly (1.8.8 and 2.0.3); the printed columns are the ones mapped here, but the rows were not kept and not parsed through this adapter, so it stays contract-only. Without a login every search answered NOT_FOUND (4 of 4), after logging in 2 of 2 (1.8.8) and 4 of 4 (2.0.3); --limit up to 50' },
  tieba: { status: 'contract-only', version: '2.0.3', date: '2026-11-25', note: 'run on the user\'s own logged-in Chrome by calling opencli directly (1.8.8 and 2.0.3); the printed columns are the ones mapped here, but the rows were not kept and not parsed through this adapter, so it stays contract-only. 2 of 2 on both versions; zero results (also a risk-control page) answer EMPTY_RESULT; --limit up to 20' },
  douyin: { status: 'contract-only', version: '2.0.3', date: '2026-11-25', note: 'run on the user\'s own logged-in Chrome by calling opencli directly (1.8.8 and 2.0.3); the printed columns are the ones mapped here, but the rows were not kept and not parsed through this adapter, so it stays contract-only. Without a login AUTH_REQUIRED or UNKNOWN (0 of 4), logged in 1 of 2 (1.8.8) and 4 of 4 (2.0.3); plays, comments and shares are always 0 there; --limit up to 30' },
  reddit: { status: 'contract-only', version: '2.0.3', date: '2026-11-25', note: 'search blocked on this network with both versions: 1.8.8 gives an HTML page where JSON is expected (UNKNOWN, fixture live-opencli-reddit-html-error.yaml), 2.0.3 says SECURITY_BLOCK; columns read from clis/reddit/search.js' },
}
const GENERIC_VERIFICATION: NonNullable<CliAdapterSpec['verification']> = { status: 'contract-only', ...CHECKED, note: 'command table from `opencli list -f json`; -f json is the documented output option; this site\'s search was not run (it uses your Chrome session)' }

/** How far the search of one OpenCLI site was checked (`live`, `contract-only`). */
export function opencliSiteVerification(site: string): NonNullable<CliAdapterSpec['verification']> {
  return SITE_VERIFICATION[site] ?? GENERIC_VERIFICATION
}
