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
}

const CHECKED = { version: '1.8.8', date: '2026-10-27' } as const
const SITE_VERIFICATION: Readonly<Record<string, NonNullable<CliAdapterSpec['verification']>>> = {
  twitter: { status: 'live', ...CHECKED, note: '`opencli twitter search -f json` run on the user\'s own Chrome (OpenCLI Browser Bridge) and parsed: a JSON array of tweets (fixture live-opencli-twitter-search.json); created_at is in the X API format and is converted to ISO' },
  zhihu: { status: 'live', ...CHECKED, note: '`opencli zhihu search -f json` run on the user\'s own Chrome and parsed: a JSON array of { rank, title, type, author, votes, url } without excerpt or time (fixture live-opencli-zhihu-search.json)' },
  xiaohongshu: { status: 'contract-only', ...CHECKED, note: 'not measured: the only run answered AUTH_REQUIRED (exit 77, the Chrome had no xiaohongshu login); columns read from clis/xiaohongshu/search.js of 1.8.8. The AUTH_REQUIRED failure itself is mapped (fixture live-opencli-xiaohongshu-auth-required.yaml)' },
  reddit: { status: 'contract-only', ...CHECKED, note: 'not measured: the only run got an HTML page where the command expects JSON (exit 1, code UNKNOWN; Reddit blocked the request on this proxied network); columns read from clis/reddit/search.js of 1.8.8. That failure is mapped (fixture live-opencli-reddit-html-error.yaml)' },
}
const GENERIC_VERIFICATION: NonNullable<CliAdapterSpec['verification']> = { status: 'contract-only', ...CHECKED, note: 'command table from `opencli list -f json`; -f json is the documented output option; this site\'s search was not run (it uses your Chrome session)' }

/** How far the search of one OpenCLI site was checked (`live`, `contract-only`). */
export function opencliSiteVerification(site: string): NonNullable<CliAdapterSpec['verification']> {
  return SITE_VERIFICATION[site] ?? GENERIC_VERIFICATION
}
