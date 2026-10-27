/**
 * The static facts of the standalone OpenCLI sites the plugin searches (free of Node imports, so the catalog and the chain
 * specs can read them): which site serves which platform, how each site's `search` rows map to sources, and how far each
 * mapping was verified. The spec generation itself (src/cli/opencli.ts) reads the live command table.
 * @module web-search-pro/cli/opencli-sites
 */
import type { CliAdapterSpec, CliOutputSpec } from './spec.ts';
/** Platform -> site of the standalone OpenCLI (`opencli <site> search`). */
export declare const OPENCLI_SITE_OF: Readonly<Record<string, string>>;
export declare const GENERIC_OUTPUT: CliOutputSpec;
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
export declare const SITE_OUTPUT: Readonly<Record<string, CliOutputSpec>>;
/** How far the search of one OpenCLI site was checked (`live`, `contract-only`). */
export declare function opencliSiteVerification(site: string): NonNullable<CliAdapterSpec['verification']>;
