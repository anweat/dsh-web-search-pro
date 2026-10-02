/**
 * Query compilation (dev-plan §4.1 step 2): turn a TaskSpec into one query per
 * provider, pushing constraints to the provider natively where it can enforce
 * them and reporting which constraints are left for local verification.
 *
 *  - ddg / bing: `site:`, `-site:` and `-term` operators for HARD site /
 *    exclude_site / exclude_term constraints (the first hard `site` only: two
 *    `site:` operators are ANDed into nothing);
 *  - exa: includeDomains / excludeDomains / startPublishedDate options for HARD
 *    site / exclude_site / time_window (Exa omits undated pages when a date
 *    bound is set, hence hard only);
 *  - bocha: include / exclude (domain lists) for HARD site / exclude_site, and `freshness` as an
 *    inclusive `start..today` date range for a HARD time_window whose lower bound is understood
 *    (an exact translation, so it is reported as native);
 *  - github*: the natural-language query returns nothing on repository search
 *    (E1: 0 of 20), so it is replaced by a short keyword query;
 *  - everything else: the plain query.
 * Soft constraints are never pushed down (a preference must not shrink recall);
 * they are verified locally like every constraint the provider cannot express.
 * The gate re-checks rule-checkable constraints on every candidate regardless,
 * so a provider silently ignoring an operator costs nothing but precision.
 * @module web-search-pro/pipeline/compile
 */
import { domainOf } from "./gate.js";
import { LATIN_STOP } from "./lexical.js";
const hard = (task, kind) => task.constraints.filter(c => c.kind === kind && c.strength === 'hard' && c.value.trim());
// ── time windows ────────────────────────────────────────────────────────────
const ZH_NUMBERS = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const UNIT_DAYS = { 天: 1, 日: 1, 周: 7, 星期: 7, 个月: 30, 月: 30, 年: 365, day: 1, days: 1, week: 7, weeks: 7, month: 30, months: 30, year: 365, years: 365 };
/**
 * Lower bound (ISO 8601, UTC) of a time_window value, in the same sense the rule
 * gate uses: a year ("2025 年以后", "since 2025", "2025") means "published in or
 * after that year"; relative spans ("最近一周", "past 30 days") count back from
 * `now`. Upper bounds are not expressed by the constraint vocabulary. Returns
 * undefined when the value is not understood (the constraint then stays local).
 */
export function parseTimeWindow(value, now = new Date()) {
    const relative = /(?:最近|过去|近|past|last)\s*(\d+|[一二两三四五六七八九十])?\s*(个月|星期|周|天|日|月|年|days?|weeks?|months?|years?)/i.exec(value);
    if (relative) {
        const amount = relative[1] ? (ZH_NUMBERS[relative[1]] ?? Number(relative[1])) : 1;
        const days = UNIT_DAYS[relative[2].toLowerCase()];
        if (days && amount > 0)
            return new Date(now.getTime() - amount * days * 86_400_000).toISOString();
    }
    const year = /(?<!\d)((?:19|20)\d\d)(?!\d)/.exec(value);
    return year ? year[1] + '-01-01T00:00:00.000Z' : undefined;
}
// ── search-engine operators ─────────────────────────────────────────────────
const operatorTerm = (term) => {
    const clean = term.replace(/["']/g, '').trim();
    return /\s/.test(clean) ? '"' + clean + '"' : clean;
};
function compileOperators(task, providerId) {
    const parts = [];
    const native = [];
    const has = (token) => task.query.toLowerCase().includes(token.toLowerCase());
    const add = (token, id) => {
        native.push(id);
        if (!has(token))
            parts.push(token); // query_syntax constraints are already spelled in the query
    };
    const site = hard(task, 'site')[0];
    if (site && domainOf(site.value))
        add('site:' + domainOf(site.value), site.id);
    for (const c of hard(task, 'exclude_site'))
        if (domainOf(c.value))
            add('-site:' + domainOf(c.value), c.id);
    for (const c of hard(task, 'exclude_term'))
        if (operatorTerm(c.value))
            add('-' + operatorTerm(c.value), c.id);
    return finish(task, providerId, [task.query, ...parts].join(' ').trim(), native);
}
function compileExa(task, providerId, now) {
    const exa = {};
    const native = [];
    const include = hard(task, 'site').map(c => ({ c, d: domainOf(c.value) })).filter(x => x.d);
    if (include.length) {
        exa.includeDomains = [...new Set(include.map(x => x.d))];
        native.push(...include.map(x => x.c.id));
    }
    const exclude = hard(task, 'exclude_site').map(c => ({ c, d: domainOf(c.value) })).filter(x => x.d);
    if (exclude.length) {
        exa.excludeDomains = [...new Set(exclude.map(x => x.d))];
        native.push(...exclude.map(x => x.c.id));
    }
    const windows = hard(task, 'time_window').map(c => ({ c, start: parseTimeWindow(c.value, now) })).filter((x) => x.start !== undefined);
    if (windows.length) {
        exa.startPublishedDate = windows.map(x => x.start).sort().at(-1); // several lower bounds: the strictest holds
        native.push(...windows.map(x => x.c.id));
    }
    return { ...finish(task, providerId, task.query, native), ...Object.keys(exa).length ? { options: { exa } } : {} };
}
const isoDay = (iso) => (typeof iso === 'string' ? iso : iso.toISOString()).slice(0, 10);
export function compileBocha(task, providerId, now) {
    const bocha = {};
    const native = [];
    const include = hard(task, 'site').map(c => ({ c, d: domainOf(c.value) })).filter(x => x.d);
    if (include.length) {
        bocha.include = [...new Set(include.map(x => x.d))];
        native.push(...include.map(x => x.c.id));
    }
    const exclude = hard(task, 'exclude_site').map(c => ({ c, d: domainOf(c.value) })).filter(x => x.d);
    if (exclude.length) {
        bocha.exclude = [...new Set(exclude.map(x => x.d))];
        native.push(...exclude.map(x => x.c.id));
    }
    const windows = hard(task, 'time_window').map(c => ({ c, start: parseTimeWindow(c.value, now) })).filter((x) => x.start !== undefined && x.start < now.toISOString());
    if (windows.length) {
        bocha.freshness = isoDay(windows.map(x => x.start).sort().at(-1)) + '..' + isoDay(now); // several lower bounds: the strictest holds
        native.push(...windows.map(x => x.c.id));
    }
    return { ...finish(task, providerId, task.query, native), ...Object.keys(bocha).length ? { options: { bocha } } : {} };
}
// ── GitHub keyword queries ──────────────────────────────────────────────────
/** Chinese words that carry no topical signal in a repository search. */
const ZH_FILLER_WORDS = /(如何|怎么样|怎么|怎样|什么|哪个|哪些|是否|能否|可以|使用|用法|方法|示例|例子|教程|指南|介绍|详解|对比|比较|区别|选型|推荐|最新|官方|文档|支持|问题|原因|实现|原理|说明|配置|安装|运行|检测|一下|有没有|请问|我们|取舍|性能|兼容性|评测|榜单|速度|成本|限制|额度|版本|需要|不需要|默认|修改|策略|失败|回滚)/g;
/** Single function characters; stripped from free query text only, never from entity / must_term values (中文分词 must survive). */
const ZH_FILLER_CHARS = /[的了和与及在中里是吗呢吧把被对从向为有要能会这那个些]/g;
/** English words that carry no topical signal in a repository search (on top of the lexical stop list). */
const LATIN_FILLER = new Set('doc docs documentation tutorial tutorials guide guides example examples usage introduction intro best practice practices tips difference differences between compare comparison latest new official setup install installation configure configuration config how-to'.split(' '));
export const GITHUB_MAX_TERMS = 5;
function latinTokens(text) {
    // ':' and '/' split tokens so "node:sqlite" cannot be read as a GitHub qualifier.
    return (text.match(/[A-Za-z0-9][A-Za-z0-9_.+#-]*[A-Za-z0-9+#]|[A-Za-z0-9]/g) ?? [])
        .map(t => t.toLowerCase())
        .filter(t => !LATIN_STOP.has(t) && !LATIN_FILLER.has(t) && (t.length >= 2) && !/^[\d.]+$/.test(t));
}
function hanTerms(text, freeText) {
    const stripped = text.replace(ZH_FILLER_WORDS, ' ');
    return ((freeText ? stripped.replace(ZH_FILLER_CHARS, ' ') : stripped).match(/\p{Script=Han}+/gu) ?? []).filter(t => t.length >= 2 && t.length <= 8);
}
/**
 * Short keyword query for repository search: entities, then must_terms, then a
 * few salient Latin tokens of the query; Chinese terms only from entities /
 * must_terms, or from the query when fewer than two terms were found. At most
 * {@link GITHUB_MAX_TERMS} terms, version-like numbers dropped.
 */
export function githubKeywordTerms(task) {
    const order = (kind) => task.constraints
        .filter(c => c.kind === kind && c.value.trim())
        .sort((a, b) => (a.strength === b.strength ? 0 : a.strength === 'hard' ? -1 : 1));
    const terms = [];
    const push = (list) => {
        for (const t of list)
            if (terms.length < GITHUB_MAX_TERMS && !terms.includes(t))
                terms.push(t);
    };
    const fromConstraints = [...order('entity'), ...order('must_term')].map(c => c.value);
    for (const value of fromConstraints)
        push([...latinTokens(value), ...hanTerms(value, false)]);
    push(latinTokens(task.query));
    if (terms.length < 2)
        push(hanTerms(task.query, true));
    return terms;
}
export function githubKeywordQuery(task) {
    return githubKeywordTerms(task).join(' ') || task.query;
}
/** Repository search ANDs every keyword, so one rare token empties the result: retry with the leading 3 and 2 terms. */
export const GITHUB_FALLBACK_TERM_COUNTS = [3, 2];
function compileGithub(task, providerId) {
    const terms = githubKeywordTerms(task);
    const fallbacks = GITHUB_FALLBACK_TERM_COUNTS.filter(n => n < terms.length).map(n => terms.slice(0, n).join(' '));
    return { ...finish(task, providerId, terms.join(' ') || task.query, []), ...fallbacks.length ? { fallbacks } : {} };
}
// ── entry points ────────────────────────────────────────────────────────────
function finish(task, providerId, query, native) {
    const done = new Set(native);
    return { providerId, query, native, local: task.constraints.map(c => c.id).filter(id => !done.has(id)) };
}
/** Compile the task for one provider id (`ddg`, `bing`, `exa`, `bocha`, `github*`; anything else gets the plain query). */
export function compileQuery(task, providerId, now = new Date()) {
    if (providerId === 'ddg' || providerId === 'bing')
        return compileOperators(task, providerId);
    if (providerId === 'exa')
        return compileExa(task, providerId, now);
    if (providerId === 'bocha')
        return compileBocha(task, providerId, now);
    if (providerId === 'github' || providerId.startsWith('github-'))
        return compileGithub(task, providerId);
    return finish(task, providerId, task.query, []);
}
export function compileQueries(task, providerIds, now = new Date()) {
    return providerIds.map(id => compileQuery(task, id, now));
}
// ── follow-up (gap) queries ─────────────────────────────────────────────────
/** Identifier-like tokens (`node:sqlite`, `DatabaseSync`, `busy_timeout`, `v22.5`): the entities of a query worth repeating in a follow-up. */
export function keyTokens(text) {
    const out = [];
    for (const token of text.match(/[A-Za-z0-9][A-Za-z0-9_.:/#+-]*[A-Za-z0-9+#]/g) ?? []) {
        const structured = /[:._/#-]/.test(token) || /\d/.test(token) || /[a-z][A-Z]/.test(token);
        if (token.length >= 3 && structured && !/^[\d.]+$/.test(token) && !/^https?:/i.test(token) && !out.some(t => t.toLowerCase() === token.toLowerCase()))
            out.push(token);
    }
    return out;
}
/** Longest follow-up query (characters); search engines gain nothing from more. */
export const GAP_QUERY_MAX_CHARS = 200;
/** Entities appended to the need text. */
const GAP_QUERY_EXTRAS = 3;
/**
 * Query for a follow-up round targeted at one unsupported need: the need text plus the task's key entities
 * (entity / must_term / version constraints, then identifier-like tokens of the original query) that the
 * need does not already mention. Provider-specific shaping (site: operators, Exa options, GitHub keywords)
 * is left to {@link compileQuery} over a task whose `query` is this text.
 */
export function gapQueryText(task, need) {
    const lower = need.text.toLowerCase();
    const extras = [];
    const candidates = [
        ...task.constraints.filter(c => (c.kind === 'entity' || c.kind === 'must_term' || c.kind === 'version') && c.value.trim()).map(c => c.value.trim()),
        ...keyTokens(task.query),
    ];
    for (const value of candidates) {
        if (extras.length >= GAP_QUERY_EXTRAS)
            break;
        if (lower.includes(value.toLowerCase()) || extras.some(e => e.toLowerCase() === value.toLowerCase()))
            continue;
        extras.push(value);
    }
    return [need.text.trim(), ...extras].join(' ').slice(0, GAP_QUERY_MAX_CHARS).trim();
}
//# sourceMappingURL=compile.js.map