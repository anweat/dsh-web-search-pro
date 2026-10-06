/**
 * The built-in CLI adapter specs (dev-plan M12). Every argv, flag and output field was derived from the tool's own
 * `--help` (and, where the help does not show the output shape, from the installed package source or the upstream
 * README), and `verification` records how far each was checked:
 *  - `live`: a real read-only search was run and its output parsed (bili, gh, omnireach/wechat);
 *  - `contract-only`: help and version probed on a real install, output shape taken from the tool's own source,
 *    README or documented output option, because a search needs the user's login or reads browser cookies, or was outside
 *    the checks allowed (xhs, zhihu, rdt, twitter, opencli sites, yt-dlp, wx-search-cli);
 *  - `docs-only`: not installed here; derived from the upstream README (tanso).
 * Fixtures for the contract-only and docs-only parsers are marked "constructed from help/docs" in test/fixtures/cli.
 * @module web-search-pro/cli/builtin-specs
 */
import { validateCliAdapterSpec } from "./spec.js";
export const BILI_CLI_VERSION = '0.6.2';
export const BILI_CLI_REVISION = '489607468f967e0e11f3cdff6efc022d011e982a';
export const BILI_CLI_SOURCE = `git+https://github.com/public-clis/bilibili-cli@${BILI_CLI_REVISION}`;
export const BILI_CLI_INSTALLS = [
    { installer: 'uv', command: `uv tool install --force ${BILI_CLI_SOURCE}` },
    { installer: 'pipx', command: `pipx install --force ${BILI_CLI_SOURCE}` },
    { installer: 'pip', command: `pip install --force-reinstall ${BILI_CLI_SOURCE}` },
];
export const TWITTER_CLI_INSTALLS = [
    { installer: 'uv', command: 'uv tool install twitter-cli' },
    { installer: 'pipx', command: 'pipx install twitter-cli' },
    { installer: 'pip', command: 'pip install twitter-cli' },
];
/** The date of the checks recorded below. */
export const SPEC_CHECK_DATE = '2026-10-06';
const MB = 1024 * 1024;
/** The versioned `{ ok, schema_version, data }` envelope of the agent-friendly Python CLIs (bili, xhs, rdt). */
const ENVELOPE = [{ path: 'ok', equals: true }, { path: 'schema_version', equals: '1' }];
/** Why a login-needing CLI is gated on its saved login files: it reads the browser's cookies by itself when it has none. */
const NOT_LOGGED_IN = ['not authenticated', 'not_authenticated', 'not logged in', 'login required', 'please log in', "no 'a1' cookie", 'no cookies'];
const bili = {
    id: 'bili',
    bins: ['bili'],
    packageNote: `bilibili-cli from public-clis/bilibili-cli ${BILI_CLI_VERSION} (the PyPI package of the same name has another contract; sources.deps shows the pinned install)`,
    platforms: ['bilibili'],
    probe: { versionArgs: ['--version'], minVersion: BILI_CLI_VERSION, helpArgs: ['search', '--help'], mustContain: ['--type', '--max', '--json'] },
    allowedSubcommands: ['search'],
    search: {
        argv: ['search', '{query}', '--type', 'video', '--max', '{count}', '--json'],
        maxCount: 10,
        output: {
            format: 'json', itemsPath: 'data', expect: ENVELOPE, errorPaths: ['message', 'error'], stripTags: true, snippetMax: 300,
            fields: {
                url: { template: 'https://www.bilibili.com/video/{bvid}' },
                title: 'title',
                snippet: { join: [{ path: 'author', prefix: 'UP: ' }, { path: 'play', prefix: '播放: ' }, 'duration'] },
            },
        },
    },
    env: {},
    needsLogin: false,
    timeoutMs: 30_000,
    maxOutputBytes: 4 * MB,
    verification: { status: 'live', version: BILI_CLI_VERSION, date: SPEC_CHECK_DATE, note: '`bili search DeepSeek --type video --max 2 --json` parsed (fixture bili-search.json)' },
};
const ytDlp = {
    id: 'yt-dlp',
    bins: ['yt-dlp'],
    packageNote: 'yt-dlp (uv tool install yt-dlp)',
    platforms: ['youtube'],
    probe: { versionArgs: ['--version'], helpArgs: ['--help'], mustContain: ['--flat-playlist', '--print', '--skip-download'] },
    allowedSubcommands: [],
    search: {
        argv: ['ytsearch{count}:{query}', '--flat-playlist', '--skip-download', '--no-warnings', '--print', '%(id)s\t%(title)s\t%(channel)s\t%(view_count)s\t%(duration_string)s'],
        maxCount: 10,
        output: {
            format: 'text', lines: { mode: 'tsv', columns: ['id', 'title', 'channel', 'view_count', 'duration'] }, emptyValues: ['None'], requireTitle: true,
            fields: {
                url: { template: 'https://www.youtube.com/watch?v={id}' },
                title: 'title',
                snippet: { join: ['channel', { path: 'view_count', suffix: ' views' }, 'duration'] },
            },
        },
    },
    env: {},
    needsLogin: false,
    timeoutMs: 60_000,
    maxOutputBytes: 4 * MB,
    verification: { status: 'contract-only', version: '2026.08.19', date: SPEC_CHECK_DATE, note: 'help and version probed; flags from `yt-dlp --help`; the print template is the one the plugin has used since 0.1; no search was run' },
};
const twitter = {
    id: 'twitter',
    bins: ['twitter'],
    packageNote: 'twitter-cli (PyPI twitter-cli; the command is `twitter`; Agent-Reach alone does not provide it)',
    platforms: ['twitter'],
    probe: { versionArgs: ['--version'], helpArgs: ['search', '--help'], mustContain: ['search'] },
    allowedSubcommands: ['search'],
    search: {
        argv: ['search', '{query}', '-n', '{count}'],
        maxCount: 10,
        output: { format: 'text', lines: { mode: 'url-lines' }, titleMax: 200, requireTitle: true, fields: { url: 'url', title: 'title' } },
        notLoggedInPatterns: ['not authenticated', 'unauthorized', 'no twitter cookies', 'auth_token', 'ct0'],
    },
    env: { required: ['TWITTER_AUTH_TOKEN', 'TWITTER_CT0'] },
    needsLogin: true,
    timeoutMs: 45_000,
    maxOutputBytes: 4 * MB,
    verification: { status: 'contract-only', version: '0.8.5', date: SPEC_CHECK_DATE, note: 'help probed; the plain-text output (`search QUERY -n N`) is the one the plugin has used since 0.1; the tool also offers --json, not used here; no search was run (needs your tokens)' },
};
const xhs = {
    id: 'xhs',
    bins: ['xhs'],
    packageNote: 'xiaohongshu-cli (PyPI xiaohongshu-cli; the command is `xhs`)',
    platforms: ['xiaohongshu'],
    probe: { versionArgs: ['--version'], helpArgs: ['search', '--help'], mustContain: ['keyword', '--json', '--sort'] },
    allowedSubcommands: ['search'],
    search: {
        argv: ['search', '{query}', '--json'],
        output: {
            format: 'json', itemsPath: 'data.items', expect: ENVELOPE, errorPaths: ['error.message'],
            fields: {
                url: { template: 'https://www.xiaohongshu.com/explore/{id}?xsec_token={xsec_token}&xsec_source=pc_search' },
                title: ['note_card.display_title', 'note_card.title'],
                snippet: { join: [{ path: 'note_card.user.nickname', prefix: '作者: ' }, { path: 'note_card.interact_info.liked_count', prefix: '赞: ' }] },
            },
        },
        notLoggedInPatterns: NOT_LOGGED_IN,
    },
    env: {},
    needsLogin: true,
    login: { command: 'xhs login', savedCredentialPaths: ['~/.xiaohongshu-cli/cookies.json'], readsBrowserCookiesWithoutLogin: true },
    timeoutMs: 45_000,
    maxOutputBytes: 4 * MB,
    verification: { status: 'contract-only', version: '0.6.4', date: SPEC_CHECK_DATE, note: 'help probed; output shape from the installed package source (client response + its own normalizer); no search was run: it needs your login and, without a saved one, reads browser cookies' },
};
const zhihu = {
    id: 'zhihu',
    bins: ['zhihu'],
    packageNote: 'zhihu-cli (PyPI pyzhihu-cli, BAIGUANGMEI/zhihu-cli; the command is `zhihu`; not the Access-Secret "zhihu-cli" of dawnswwwww)',
    platforms: ['zhihu'],
    probe: { versionArgs: ['--version'], helpArgs: ['search', '--help'], mustContain: ['query', '--json', '--limit', '--type'] },
    allowedSubcommands: ['search'],
    search: {
        argv: ['search', '{query}', '--limit', '{count}', '--answers', '0', '--json'],
        maxCount: 20,
        output: {
            format: 'json', itemsPath: 'data', stripTags: true,
            fields: {
                url: [
                    { template: 'https://www.zhihu.com/question/{object.question.id}/answer/{object.id}', when: { path: 'object.type', equals: 'answer' } },
                    { template: 'https://zhuanlan.zhihu.com/p/{object.id}', when: { path: 'object.type', equals: 'article' } },
                    { template: 'https://www.zhihu.com/question/{object.id}', when: { path: 'object.type', equals: 'question' } },
                ],
                title: ['object.title', 'object.question.name', 'object.name'],
                snippet: ['object.excerpt', 'object.content'],
                publishedAt: { epoch: 'object.created_time' },
            },
        },
        notLoggedInPatterns: ['not authenticated', 'zhihu login'],
    },
    env: {},
    needsLogin: true,
    login: { command: 'zhihu login', savedCredentialPaths: ['~/.zhihu-cli/cookies.json'] },
    timeoutMs: 45_000,
    maxOutputBytes: 4 * MB,
    verification: { status: 'contract-only', version: '0.2.4', date: SPEC_CHECK_DATE, note: 'help probed; output shape (`data[].object`) from the installed package source; the tool never reads browser cookies itself; no search was run (needs your login)' },
};
const rdt = {
    id: 'rdt',
    bins: ['rdt'],
    packageNote: 'rdt-cli (public-clis/rdt-cli; the command is `rdt`)',
    platforms: ['reddit'],
    probe: { versionArgs: ['--version'], helpArgs: ['search', '--help'], mustContain: ['query', '--json', '--compact', '--limit'] },
    allowedSubcommands: ['search'],
    search: {
        argv: ['search', '{query}', '--limit', '{count}', '--compact', '--json'],
        maxCount: 25,
        output: {
            format: 'json', itemsPath: 'data', expect: ENVELOPE, errorPaths: ['error.message'],
            fields: {
                url: { template: 'https://www.reddit.com{permalink}' },
                title: 'title',
                snippet: { join: [{ path: 'subreddit', prefix: 'r/' }, { path: 'score', prefix: 'score ' }, { path: 'num_comments', suffix: ' comments' }, 'selftext'] },
                publishedAt: { epoch: 'created_utc' },
            },
        },
        notLoggedInPatterns: NOT_LOGGED_IN,
    },
    env: {},
    needsLogin: true,
    login: { command: 'rdt login', savedCredentialPaths: ['~/.config/rdt-cli/credential.json'], readsBrowserCookiesWithoutLogin: true },
    timeoutMs: 45_000,
    maxOutputBytes: 4 * MB,
    verification: { status: 'contract-only', version: '0.4.2', date: SPEC_CHECK_DATE, note: 'help probed; `--compact --json` output (post dicts in the `data` envelope) from the installed package source; no search was run: without a saved login it reads browser cookies' },
};
const OMNIREACH_OUTPUT = {
    format: 'json', itemsPath: 'results', errorPaths: ['errors.0.error'], stripTags: true,
    fields: { url: 'url', title: 'title', snippet: 'content', publishedAt: 'ts' },
};
const omnireach = {
    id: 'omnireach',
    bins: ['omnireach'],
    packageNote: 'omnireach (Python, Daily-AC/omnireach; uv tool install from its repository)',
    platforms: ['omnireach', 'wechat'],
    probe: { versionArgs: ['--version'], minVersion: '0.19.0', helpArgs: ['search', '--help'], mustContain: ['--on', '--limit', '--json'] },
    allowedSubcommands: ['search'],
    // The multi-source search: the tool's own default sources (its browser-backed sources are opt-in there, never in the default fan-out).
    search: { argv: ['search', '{query}', '--limit', '{count}', '--json'], maxCount: 20, output: OMNIREACH_OUTPUT },
    searches: {
        // WeChat official accounts through Sogou: no key, no login, no browser (the tool prefers Exa when EXA_API_KEY is set, which this adapter never passes).
        wechat: { argv: ['search', '{query}', '--on', 'wechat', '--limit', '{count}', '--json'], maxCount: 10, output: OMNIREACH_OUTPUT },
    },
    env: {},
    needsLogin: false,
    timeoutMs: 60_000,
    maxOutputBytes: 8 * MB,
    verification: { status: 'live', version: '0.19.0-alpha', date: SPEC_CHECK_DATE, note: '`omnireach search 大模型 备案 --on wechat --limit 2 --json` parsed (fixture omnireach-wechat.json); the multi-source command was not run' },
};
const GH_REPO_FIELDS = 'fullName,description,url,stargazersCount,language,updatedAt,forksCount';
const gh = {
    id: 'gh',
    bins: ['gh'],
    packageNote: 'GitHub CLI (https://cli.github.com; brew install gh / winget install GitHub.cli)',
    platforms: ['github', 'github-issues', 'github-code'],
    probe: { versionArgs: ['--version'], helpArgs: ['search', 'repos', '--help'], mustContain: ['--json', '--limit', 'stargazersCount'] },
    allowedSubcommands: ['search', 'repos', 'issues', 'code'],
    search: {
        argv: ['search', 'repos', '--json', GH_REPO_FIELDS, '--limit', '{count}', '--sort', 'stars', '--order', 'desc', '--', '{query}'],
        maxCount: 15,
        output: {
            format: 'json', stripTags: false,
            fields: {
                url: 'url', title: 'fullName', publishedAt: { date: 'updatedAt' },
                snippet: { join: ['description', { path: 'stargazersCount', prefix: '⭐' }, { path: 'language', prefix: '[', suffix: ']' }, { path: 'forksCount', prefix: 'forks ' }] },
            },
        },
        notLoggedInPatterns: ['gh auth login', 'not logged in', 'authentication required'],
    },
    searches: {
        'github-issues': {
            argv: ['search', 'issues', '--json', 'title,url,state,repository,commentsCount,updatedAt', '--limit', '{count}', '--sort', 'updated', '--order', 'desc', '--', '{query}'],
            maxCount: 15,
            output: {
                format: 'json',
                fields: {
                    url: 'url', title: 'title', publishedAt: { date: 'updatedAt' },
                    snippet: { join: [{ path: 'state', prefix: '[', suffix: ']' }, 'repository.nameWithOwner', { path: 'commentsCount', suffix: ' comments' }], sep: ' · ' },
                },
            },
            notLoggedInPatterns: ['gh auth login', 'not logged in', 'authentication required'],
        },
        'github-code': {
            argv: ['search', 'code', '--json', 'path,repository,url', '--limit', '{count}', '--', '{query}'],
            maxCount: 15,
            output: { format: 'json', fields: { url: 'url', title: { template: '{repository.nameWithOwner} / {path}' }, snippet: { template: '仓库: {repository.nameWithOwner}' } } },
            notLoggedInPatterns: ['gh auth login', 'not logged in', 'authentication required'],
        },
    },
    env: { passthrough: ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_HOST', 'GH_CONFIG_DIR'] },
    needsLogin: true,
    login: { command: 'gh auth login' },
    timeoutMs: 30_000,
    maxOutputBytes: 4 * MB,
    verification: { status: 'live', version: '2.101.0', date: SPEC_CHECK_DATE, note: '`gh search repos --json … --sort stars -- "dsh web search"` parsed (fixture gh-repos.json); issues and code searches follow the documented JSON fields of their help pages and were not run' },
};
const wxSearchCli = {
    id: 'wx-search-cli',
    bins: ['wx-search-cli'],
    packageNote: 'wx-search-cli (npm i -g wx-search-cli, tjx666/wx-search-cli; the command is `wx-search-cli`)',
    platforms: ['wechat'],
    probe: { versionArgs: ['--version'], helpArgs: ['--help'], mustContain: ['search <query>', 'sogou'] },
    allowedSubcommands: ['search'],
    search: {
        argv: ['search', '{query}'],
        // `real_url` is the resolved mp.weixin.qq.com link; it is empty when Sogou showed a captcha, and such items are dropped.
        output: { format: 'json', fields: { url: 'real_url', title: 'title', publishedAt: 'publish_time' } },
    },
    env: {},
    needsLogin: false,
    timeoutMs: 45_000,
    maxOutputBytes: 2 * MB,
    verification: { status: 'contract-only', version: '0.1.0', date: SPEC_CHECK_DATE, note: 'help and version probed on a real install; output shape (JSON array of { title, link, real_url, publish_time, page }) from the upstream README and src/index.ts read with gh api; no search was run' },
};
const tanso = {
    id: 'tanso',
    bins: ['tanso'],
    packageNote: 'tanso (npm i -g @geekjourneyx/tanso, geekjourneyx/tanso; a Go binary; needs your Bocha / Zhihu keys in its own config)',
    platforms: ['tanso'],
    probe: { versionArgs: ['version'], helpArgs: ['--help'], mustContain: ['bocha', 'zhihu', '--json'] },
    allowedSubcommands: ['version'],
    search: {
        // Only the two sources the README shows with --source; the Volcengine answer source (a paid model call) is never selected.
        argv: ['{query}', '--json', '--source', 'bocha_web', '--source', 'zhihu_search'],
        output: { format: 'json', itemsPath: 'results', errorPaths: ['errors.0.message', 'errors.0'], fields: { url: 'url', title: 'title', snippet: 'snippet' } },
        notLoggedInPatterns: ['credential', 'api_key', 'access_secret', 'config error'],
    },
    env: { passthrough: ['BOCHA_API_KEY', 'ZHIHU_ACCESS_SECRET', 'ZHIHU_API_KEY', 'TANSO_CONFIG', 'XDG_CONFIG_HOME'] },
    needsLogin: true,
    login: { command: 'tanso config init' },
    timeoutMs: 60_000,
    maxOutputBytes: 2 * MB,
    verification: { status: 'docs-only', version: '2.0.2', date: SPEC_CHECK_DATE, note: 'not installed here; from the upstream README (envelope with results[].{source,title,url,snippet}); --limit is not documented and not used' },
};
/** The `wechat` platform's two tools and the multi-source `omnireach` platform come from the same specs; ids are the backend ids. */
export const BUILTIN_CLI_SPECS = [bili, ytDlp, twitter, xhs, zhihu, rdt, omnireach, gh, wxSearchCli, tanso];
for (const spec of BUILTIN_CLI_SPECS) {
    const result = validateCliAdapterSpec(spec, 'builtin');
    if (!result.ok)
        throw new Error('built-in CLI spec ' + spec.id + ' is invalid: ' + result.errors.join('; '));
}
export const builtinSpecById = (id) => BUILTIN_CLI_SPECS.find(spec => spec.id === id);
//# sourceMappingURL=builtin-specs.js.map