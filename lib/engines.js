/**
 * Search engine backends for web-search-pro. Each engine is a plain object
 * with { id, label, available(), search(query, count, signal) }. Routing,
 * caching, and persistence live in router.ts.
 * @module web-search-pro/engines
 */
import { httpGet, runCli, jsYaml, stripTags, capText, decodeRedirectUrl } from "./util.js";
export class EngineError extends Error {
    code;
    retryable;
    constructor(message, code, retryable = true) {
        super(message);
        this.code = code;
        this.retryable = retryable;
        this.name = 'EngineError';
    }
}
function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new EngineError(label + ' timed out', 'ENGINE_TIMEOUT')), ms);
        promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
}
// ── ctx.web seam (DeepSeek native search) ───────────────────────────────────
export function seamEngine(deps) {
    return {
        id: 'seam',
        label: 'DeepSeek 原生搜索 (ctx.web)',
        available: () => !!deps.web && !deps.skipSeam,
        async search(query, count, signal) {
            if (!deps.web)
                throw new EngineError('ctx.web seam unavailable', 'ENGINE_UNAVAILABLE');
            const result = await withTimeout(deps.web.search({ query, maxResults: count }, signal), 45_000, 'seam search');
            return { sources: [...result.sources], ...result.content !== undefined ? { content: result.content } : {} };
        },
    };
}
// ── Exa (API key) ────────────────────────────────────────────────────────────
export function exaEngine(deps) {
    const key = () => deps.exaApiKey || process.env.EXA_API_KEY;
    return {
        id: 'exa',
        label: 'Exa',
        available: () => (key()?.length ?? 0) > 0,
        async search(query, count, signal) {
            const res = await httpGet('https://api.exa.ai/search', {
                method: 'POST',
                headers: { 'x-api-key': key(), 'content-type': 'application/json' },
                body: JSON.stringify({ query, numResults: Math.min(count, 10), type: 'auto', contents: { text: false, highlights: true } }),
                signal,
                timeoutMs: 30_000,
            });
            if (!res.ok)
                throw new EngineError('Exa API error HTTP ' + res.status, 'ENGINE_ERROR');
            const data = JSON.parse(res.text);
            const sources = (data.results ?? []).map(r => ({
                url: r.url ?? '',
                ...r.title ? { title: r.title } : {},
                ...(r.highlights?.length ? { snippet: capText(r.highlights.join(' '), 400) } : {}),
                ...r.publishedDate ? { publishedAt: r.publishedDate } : {},
            })).filter(s => s.url.length > 0);
            return { sources };
        },
    };
}
// ── DuckDuckGo HTML (no key) ────────────────────────────────────────────────
export function ddgEngine() {
    return {
        id: 'ddg',
        label: 'DuckDuckGo',
        available: () => true,
        async search(query, count, signal) {
            const res = await httpGet('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), { signal, timeoutMs: 30_000 });
            if (!res.ok)
                throw new EngineError('DuckDuckGo HTTP ' + res.status, 'ENGINE_ERROR');
            const sources = [];
            const blockRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>)?/g;
            let m;
            while ((m = blockRe.exec(res.text)) !== null) {
                const rawHref = m[1] ?? '';
                const url = decodeRedirectUrl(rawHref);
                const title = stripTags(m[2] ?? '').trim();
                const snippet = m[3] ? stripTags(m[3]).trim() : undefined;
                if (!/^https?:\/\//i.test(url) || title.length < 2)
                    continue;
                sources.push({ url, ...title ? { title } : {}, ...snippet ? { snippet: capText(snippet, 400) } : {} });
                if (sources.length >= count)
                    break;
            }
            if (!sources.length)
                throw new EngineError('DuckDuckGo returned no results (may be rate-limited)', 'ENGINE_EMPTY', true);
            return { sources };
        },
    };
}
// ── Bing RSS (no key) ───────────────────────────────────────────────────────
export function bingEngine() {
    return {
        id: 'bing',
        label: 'Bing',
        available: () => true,
        async search(query, count, signal) {
            const res = await httpGet('https://www.bing.com/search?q=' + encodeURIComponent(query) + '&format=rss&count=' + Math.min(count, 20), { signal, timeoutMs: 30_000 });
            if (!res.ok)
                throw new EngineError('Bing HTTP ' + res.status, 'ENGINE_ERROR');
            const sources = parseRss(res.text, count);
            if (!sources.length)
                throw new EngineError('Bing returned no results', 'ENGINE_EMPTY', true);
            return { sources };
        },
    };
}
/** Parse RSS/Atom XML into sources (used by bing engine and rss platform). */
export function parseRss(xml, count = 20) {
    const sources = [];
    const itemRe = /<(item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
    let m;
    while ((m = itemRe.exec(xml)) !== null) {
        const block = m[2] ?? '';
        const grab = (tag) => {
            const t = new RegExp('<' + tag + '(?:[^>]*)>([\\s\\S]*?)<\\/' + tag + '>', 'i').exec(block);
            return t ? decodeCdata(stripTags(t[1])) : undefined;
        };
        const linkMatch = /<link[^>]*href="([^"]+)"/i.exec(block) ?? /<link[^>]*>([\s\S]*?)<\/link>/i.exec(block);
        const title = grab('title');
        const link = linkMatch ? (linkMatch[1] ?? stripTags(linkMatch[2] ?? '')) : undefined;
        const description = grab('description') ?? grab('summary') ?? grab('content');
        const pubDate = grab('pubDate') ?? grab('published') ?? grab('updated');
        if (!link || !/^https?:\/\//i.test(link))
            continue;
        sources.push({
            url: link,
            ...title && title.length > 1 ? { title } : {},
            ...description && description.length > 1 ? { snippet: capText(description, 400) } : {},
            ...pubDate ? { publishedAt: pubDate } : {},
        });
        if (sources.length >= count)
            break;
    }
    return sources;
}
function decodeCdata(s) {
    const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s);
    return m ? m[1] : s;
}
// ── Jina AI search / reader (optional key) ──────────────────────────────────
export function jinaSearchEngine(deps) {
    const key = () => deps.jinaApiKey || process.env.JINA_API_KEY;
    return {
        id: 'jina',
        label: 'Jina AI',
        available: () => true,
        async search(query, count, signal) {
            const headers = {};
            const k = key();
            if (k)
                headers['authorization'] = 'Bearer ' + k;
            const res = await httpGet('https://s.jina.ai/?q=' + encodeURIComponent(query), { headers, signal, timeoutMs: 30_000 });
            if (res.status === 401 && !k)
                throw new EngineError('Jina AI requires an API key (set jinaApiKey or $JINA_API_KEY)', 'ENGINE_UNAVAILABLE', false);
            if (!res.ok)
                throw new EngineError('Jina search HTTP ' + res.status, 'ENGINE_ERROR');
            const sources = [];
            const lineRe = /^\s*(\d+)\.\s*\[([^\]]+)\]\(([^)]+)\)(?:[：:\-—]?\s*([\s\S]*?))?$/gm;
            let m;
            while ((m = lineRe.exec(res.text)) !== null) {
                const url = m[3] ?? '';
                if (!/^https?:\/\//i.test(url))
                    continue;
                sources.push({
                    url,
                    ...(m[2] ?? '').trim() ? { title: (m[2] ?? '').trim() } : {},
                    ...(m[4] ?? '').trim() ? { snippet: capText((m[4] ?? '').trim(), 400) } : {},
                });
                if (sources.length >= count)
                    break;
            }
            if (!sources.length) {
                // Jina may return a plain markdown list without numbering.
                throw new EngineError('Jina returned no parseable results', 'ENGINE_EMPTY', true);
            }
            return { sources };
        },
    };
}
// ── GitHub (gh CLI) ─────────────────────────────────────────────────────────
export function githubEngine(deps) {
    return {
        id: 'github',
        label: 'GitHub',
        available: () => deps.enableCli,
        async search(query, count, signal) {
            const res = await runCli('gh', ['search', 'repos', query, '--limit', String(Math.min(count, 15)), '--json', 'fullName,url,description,stargazersCount,language,updatedAt'], { timeoutMs: 30_000, signal });
            if (res.code !== 0)
                throw new EngineError('gh search failed: ' + res.stderr.trim().slice(0, 200), 'ENGINE_ERROR');
            const rows = JSON.parse(res.stdout);
            const sources = rows.map(r => {
                const stars = r.stargazersCount != null ? ' ⭐' + r.stargazersCount : '';
                const lang = r.language ? ' [' + r.language + ']' : '';
                return {
                    url: r.url ?? 'https://github.com/' + (r.fullName ?? ''),
                    ...r.fullName ? { title: r.fullName } : {},
                    ...(r.description ?? r.fullName) ? { snippet: capText((r.description ?? '') + stars + lang, 400) } : {},
                };
            });
            return { sources };
        },
    };
}
// ── Bilibili (bili CLI) ─────────────────────────────────────────────────────
export function bilibiliEngine(deps) {
    return {
        id: 'bilibili',
        label: 'B站 (bili-cli)',
        available: () => deps.enableCli,
        async search(query, count, signal) {
            const res = await runCli('bili', ['search', query, '--type', 'video', '-n', String(Math.min(count, 10))], { timeoutMs: 30_000, signal });
            if (res.code !== 0)
                throw new EngineError('bili search failed: ' + res.stderr.trim().slice(0, 200), 'ENGINE_ERROR');
            let data;
            try {
                data = jsYaml.load(res.stdout);
            }
            catch {
                throw new EngineError('bili output not parseable', 'ENGINE_ERROR');
            }
            const items = data?.data ?? [];
            const sources = items.filter(i => i.bvid).map(i => ({
                url: 'https://www.bilibili.com/video/' + i.bvid,
                ...i.title ? { title: i.title } : {},
                ...(i.author || i.play != null || i.duration) ? { snippet: capText(['UP: ' + (i.author ?? ''), '播放: ' + i.play, i.duration ?? ''].filter(Boolean).join(' | '), 300) } : {},
            }));
            return { sources };
        },
    };
}
// ── V2EX (sov2ex community search API) ──────────────────────────────────────
export function v2exEngine() {
    return {
        id: 'v2ex',
        label: 'V2EX (sov2ex)',
        available: () => true,
        async search(query, count, signal) {
            const res = await httpGet('https://www.sov2ex.com/api/search?q=' + encodeURIComponent(query) + '&size=' + Math.min(count, 15), { signal, timeoutMs: 25_000 });
            if (!res.ok)
                throw new EngineError('sov2ex HTTP ' + res.status, 'ENGINE_ERROR');
            const parsed = JSON.parse(res.text);
            // sov2ex returns the hits array at top level; keep a defensive fallback.
            const rawHits = Array.isArray(parsed.hits)
                ? parsed.hits
                : (parsed.hits?.hits ?? []);
            const sources = rawHits.map(h => {
                const s = h._source;
                const url = s?.id != null ? 'https://www.v2ex.com/t/' + s.id : undefined;
                const created = typeof s?.created === 'number' ? new Date(s.created * 1000).toISOString().slice(0, 10) : s?.created;
                return {
                    url: url ?? '',
                    ...s?.title ? { title: s.title } : {},
                    ...(s?.content || s?.node?.title) ? { snippet: capText((s.content ?? '') + (s.node?.title ? ' [节点: ' + s.node.title + ']' : ''), 400) } : {},
                    ...created ? { publishedAt: String(created) } : {},
                };
            }).filter(s => s.url.length > 0);
            return { sources };
        },
    };
}
// ── YouTube (yt-dlp search) ─────────────────────────────────────────────────
export function youtubeEngine(deps) {
    return {
        id: 'youtube',
        label: 'YouTube (yt-dlp)',
        available: () => deps.enableCli,
        async search(query, count, signal) {
            const n = Math.min(count, 10);
            const res = await runCli('yt-dlp', ['ytsearch' + n + ':' + query, '--flat-playlist', '--skip-download', '--no-warnings', '--print', '%(id)s\t%(title)s\t%(channel)s\t%(view_count)s\t%(duration_string)s'], { timeoutMs: 60_000, signal });
            if (res.code !== 0)
                throw new EngineError('yt-dlp failed: ' + res.stderr.trim().slice(0, 200), 'ENGINE_ERROR');
            const sources = [];
            for (const line of res.stdout.split(/\r?\n/)) {
                const [id, title, channel, views, duration] = line.split('\t');
                if (!id || !title)
                    continue;
                const meta = [];
                if (channel)
                    meta.push(channel);
                if (views && views !== 'None')
                    meta.push(views + ' views');
                if (duration)
                    meta.push(duration);
                sources.push({
                    url: 'https://www.youtube.com/watch?v=' + id,
                    title,
                    ...meta.length ? { snippet: meta.join(' | ') } : {},
                });
                if (sources.length >= n)
                    break;
            }
            if (!sources.length)
                throw new EngineError('yt-dlp returned no results', 'ENGINE_EMPTY', true);
            return { sources };
        },
    };
}
// ── OpenCLI platform search (reuses the user's logged-in browser session) ───
const OPENCLI_PLATFORMS = {
    xiaohongshu: 'xiaohongshu',
    twitter: 'twitter',
    reddit: 'reddit',
    instagram: 'instagram',
    facebook: 'facebook',
};
export function opencliEngine(platform, deps) {
    const adapter = OPENCLI_PLATFORMS[platform];
    return {
        id: 'opencli-' + platform,
        label: 'OpenCLI ' + platform,
        available: () => deps.enableCli && deps.opencliEnabled && !!adapter,
        async search(query, count, signal) {
            if (!adapter)
                throw new EngineError('no opencli adapter for ' + platform, 'ENGINE_UNAVAILABLE', false);
            const res = await runCli('opencli', [adapter, 'search', query, '-f', 'yaml'], { timeoutMs: 45_000, signal });
            if (res.code !== 0) {
                const msg = res.stderr.trim() || res.stdout.trim() || 'exit ' + res.code;
                throw new EngineError('opencli ' + platform + ' search failed (browser session connected?): ' + msg.slice(0, 200), 'ENGINE_UNAVAILABLE', false);
            }
            let rows = [];
            try {
                const parsed = jsYaml.load(res.stdout);
                rows = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? Object.values(parsed).find(Array.isArray) ?? [] : []);
            }
            catch {
                try {
                    rows = JSON.parse(res.stdout);
                }
                catch { /* fallthrough */ }
            }
            const sources = rows.slice(0, count).map((r) => ({
                url: String(r.url ?? r.link ?? r.href ?? ''),
                ...(r.title ?? r.name ?? r.text) ? { title: String(r.title ?? r.name ?? r.text ?? '') } : {},
                ...(r.description ?? r.snippet ?? r.desc ?? r.author ?? r.user) ? { snippet: capText(String(r.description ?? r.snippet ?? r.desc ?? r.author ?? r.user ?? ''), 400) } : {},
            })).filter(s => /^https?:\/\//i.test(s.url));
            if (!sources.length)
                throw new EngineError('opencli ' + platform + ' returned no parseable results', 'ENGINE_EMPTY', false);
            return { sources };
        },
    };
}
// ── agent-reach CLI backends (twitter etc.) ─────────────────────────────────
export function agentReachEngine(platform, deps) {
    if (platform === 'twitter') {
        return {
            id: 'agentreach-twitter',
            label: 'agent-reach twitter-cli',
            available: () => deps.enableCli && deps.agentReachEnabled && !!process.env.TWITTER_AUTH_TOKEN && !!process.env.TWITTER_CT0,
            async search(query, count, signal) {
                const res = await runCli('twitter', ['search', query, '-n', String(Math.min(count, 10))], { timeoutMs: 45_000, signal });
                if (res.code !== 0)
                    throw new EngineError('twitter search failed: ' + res.stderr.trim().slice(0, 200), 'ENGINE_ERROR');
                const sources = [];
                for (const line of res.stdout.split(/\r?\n/)) {
                    const m = /(https?:\/\/[^\s]+)/.exec(line);
                    if (!m)
                        continue;
                    const title = stripTags(line).replace(m[1], '').trim();
                    if (title)
                        sources.push({ url: m[1], title: capText(title, 200) });
                    if (sources.length >= count)
                        break;
                }
                return { sources };
            },
        };
    }
    return {
        id: 'agentreach-' + platform,
        label: 'agent-reach ' + platform,
        available: () => false,
        async search() {
            throw new EngineError('agent-reach has no backend for ' + platform, 'ENGINE_UNAVAILABLE', false);
        },
    };
}
// ── RSS feed (platform tool) ────────────────────────────────────────────────
export function rssEngine(url) {
    return {
        id: 'rss',
        label: 'RSS ' + url,
        available: () => /^https?:\/\//i.test(url),
        async search(_query, count, signal) {
            const res = await httpGet(url, { signal, timeoutMs: 25_000 });
            if (!res.ok)
                throw new EngineError('RSS HTTP ' + res.status, 'ENGINE_ERROR');
            const sources = parseRss(res.text, count);
            if (!sources.length)
                throw new EngineError('RSS feed has no items', 'ENGINE_EMPTY', false);
            return { sources };
        },
    };
}
/** Build the ordered engine list for a platform search. */
export function platformEngines(platform, deps) {
    switch (platform) {
        case 'github': return [githubEngine(deps)];
        case 'bilibili': return [bilibiliEngine(deps)];
        case 'youtube': return [youtubeEngine(deps)];
        case 'v2ex': return [v2exEngine()];
        case 'xiaohongshu': return [opencliEngine('xiaohongshu', deps)];
        case 'twitter': return [opencliEngine('twitter', deps), agentReachEngine('twitter', deps)];
        case 'reddit': return [opencliEngine('reddit', deps)];
        case 'instagram': return [opencliEngine('instagram', deps)];
        case 'facebook': return [opencliEngine('facebook', deps)];
        default: return [];
    }
}
export const SEARCH_ENGINE_IDS = ['seam', 'exa', 'ddg', 'bing', 'jina', 'github', 'bilibili', 'v2ex', 'youtube'];
export const PLATFORM_IDS = ['github', 'bilibili', 'youtube', 'v2ex', 'xiaohongshu', 'twitter', 'reddit', 'instagram', 'facebook', 'rss'];
//# sourceMappingURL=engines.js.map