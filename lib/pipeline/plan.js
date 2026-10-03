/**
 * S1 source planning (dev-plan §4.3): profile -> provider table, explicit
 * `engines` first, availability / cooldown filtering, one compiled query per
 * provider. Pure: availability comes in through a callback so the router
 * registry (or a test double) supplies it.
 * @module web-search-pro/pipeline/plan
 */
import { compileQuery } from "./compile.js";
import { detectLang } from "./align.js";
import { domainOf, hostMatches } from "./gate.js";
import { routeIdOf } from "../providers/registry.js";
/** Provider ids per profile (`general` uses the configured `engines`). */
export const PROFILE_PROVIDERS = {
    docs_code: ['ddg', 'bing', 'github'],
    // M7b: the anonymous vertical sources join academic and experience. Round 1 runs at most `maxQueries - 1` (3 by default)
    // of the plan, in this order, so the later entries are second-round candidates.
    academic: ['arxiv', 'openalex', 'pubmed', 'semanticscholar', 'ddg'],
    experience: ['ddg', 'bing', 'v2ex', 'hackernews', 'stackexchange'],
    news_fact: ['ddg', 'bing'],
    compare: ['ddg', 'bing', 'github'],
};
/**
 * Supplementary sources per profile (registered ones only): candidates for the second round and for recommendations, never
 * part of round 1 and never a replacement for web search (Wikipedia for facts and background, Stack Overflow for code questions).
 */
export const PROFILE_SUPPLEMENTS = {
    docs_code: ['stackexchange'],
    news_fact: ['wikipedia'],
    general: ['wikipedia'],
    academic: [],
    experience: [],
    compare: [],
};
/** Result kinds whose content is bound to a language community: such a source in another language than the task's goes last. */
const LANGUAGE_BOUND_KINDS = ['forum', 'qa', 'video', 'social'];
/** Default cap on providers of one plan (general profile with a long engine list). */
export const DEFAULT_MAX_PROVIDERS = 4;
export const DEFAULT_WEB_FALLBACKS = 1;
/**
 * Most providers promoted ahead of the profile table for one task (dev-plan M7c). With the round-1 cap of three, two
 * specialists leave one slot for a free fallback engine, so configuring every keyed source never crowds out the keyless ones.
 * The surplus stays in `wanted` (second round).
 */
export const DEFAULT_MAX_PROMOTED = 2;
const PROMOTABLE_CREDENTIALS = [undefined, 'configured', 'not_required'];
/** `zh` / `en` from the task text (goal + query); undefined when there is no letter to tell. */
export function taskLanguage(task) {
    const lang = detectLang(task.goal + ' ' + task.query);
    return lang === 'zh' ? 'zh' : lang === 'latin' ? 'en' : undefined;
}
// ── profile inference (rule fallback; the calling model's `profile` wins) ───
const PROFILE_KEYWORDS = {
    docs_code: /(文档|api|用法|版本|报错|安装|配置|示例|源码|sdk|cli|函数|参数|接口|升级|迁移|docs?|install|config|error|exception|version|syntax|usage|example)/gi,
    news_fact: /(新闻|最新|发布|公告|据报道|是否属实|官方回应|事件|声明|宣布|news|announce|released?|reported|latest|did |是否)/gi,
    academic: /(论文|arxiv|综述|研究|方法|实验|基准|模型|算法|paper|survey|study|benchmark|theorem|dataset|citation)/gi,
    experience: /(体验|踩坑|口碑|推荐|经验|评测|值得|好用|吐槽|心得|怎么样|review|experience|worth|recommend|reddit|v2ex|小红书)/gi,
    compare: /(对比|区别|比较|选型|哪个好|哪个更|vs\.?|versus|difference|compare|comparison|alternatives?|优缺点)/gi,
};
/** Keyword hit counts per profile (general has no keywords). */
export function profileHits(text) {
    const out = {};
    for (const [profile, re] of Object.entries(PROFILE_KEYWORDS))
        out[profile] = (text.match(re) ?? []).length;
    return out;
}
/** Softmax over keyword hits with a fixed prior for `general` (the r1 bench rule judge's choice scores). */
export function profileScores(text) {
    const raw = { general: 0.6, ...profileHits(text) };
    const exp = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.exp(v)]));
    const sum = Object.values(exp).reduce((a, b) => a + b, 0);
    return Object.fromEntries(Object.entries(exp).map(([k, v]) => [k, v / sum]));
}
/** Conservative rule inference: the profile with strictly the most keyword hits, else general (r1: 60% accurate, hence only a fallback). */
export function inferProfile(text) {
    const hits = Object.entries(profileHits(text)).sort((a, b) => b[1] - a[1]);
    const [best, second] = hits;
    if (!best || best[1] === 0 || (second && second[1] === best[1]))
        return 'general';
    return best[0];
}
// ── the plan ────────────────────────────────────────────────────────────────
export function planSources(task, options) {
    const notes = [];
    const profileInferred = task.profile === undefined;
    const profile = task.profile ?? inferProfile(task.goal + ' ' + task.query);
    const explicit = Boolean(options.engines?.length);
    const language = taskLanguage(task);
    const base = options.engines?.length
        ? options.engines
        : profile === 'general' ? options.configured : PROFILE_PROVIDERS[profile];
    const descriptors = new Map((options.descriptors ?? []).map(d => [routeIdOf(d), d]));
    const isReady = (id) => {
        const status = options.status ? options.status(id) : { state: 'ready' };
        return status && status.state === 'ready' ? status : undefined;
    };
    // Promotion: specialists for the task's language, then the table with its language-agnostic web engines trimmed.
    let planList = [...base];
    const held = [];
    const promoted = [];
    const surplus = [];
    if (!explicit && language && options.autoProviders !== false && descriptors.size) {
        const candidates = [...descriptors.values()]
            .filter(d => d.kind !== 'platform' && d.operations.includes('search') && d.resultKinds.includes('web') && d.languages.includes(language) && d.taskProfiles.includes(profile))
            .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
        const maxPromoted = Math.max(options.maxPromoted ?? DEFAULT_MAX_PROMOTED, 1);
        const families = new Set();
        for (const d of candidates) {
            const status = isReady(routeIdOf(d));
            if (!status || !PROMOTABLE_CREDENTIALS.includes(status.credential))
                continue;
            // Two sources over one upstream index (Serper and another Google wrapper) are not two vantage points: the second waits for round 2.
            if (promoted.length >= maxPromoted || (d.sourceFamily && families.has(d.sourceFamily))) {
                surplus.push(routeIdOf(d));
                continue;
            }
            if (d.sourceFamily)
                families.add(d.sourceFamily);
            promoted.push(routeIdOf(d));
        }
        if (promoted.length) {
            // Web engines that were not promoted (language-agnostic ones, or strong in another language) are the fallbacks; vertical sources stay.
            const generic = (id) => !!descriptors.get(id)?.resultKinds.includes('web');
            const keep = Math.max(options.webFallbacks ?? DEFAULT_WEB_FALLBACKS, 0);
            let kept = 0;
            const rest = base.filter(id => {
                if (promoted.includes(id))
                    return false;
                if (!generic(id) || !isReady(id))
                    return true; // an engine that is not ready is skipped later with its reason and takes no fallback slot
                if (kept < keep) {
                    kept++;
                    return true;
                }
                held.push(id);
                return false;
            });
            planList = [...promoted, ...rest];
            if (surplus.length)
                notes.push('also ready for a second round: ' + surplus.join(', '));
            notes.push('language ' + language + ': preferred ' + promoted.join(', ') + (held.length ? '; fallback web engines limited to ' + rest.filter(id => generic(id) && isReady(id)).join(', ') + ' (held for a second round: ' + held.join(', ') + ')' : ''));
            // A hard filter a promoted provider cannot enforce is checked locally, never silently dropped.
            const hardKinds = [...new Set(task.constraints.filter(c => c.strength === 'hard').map(c => c.kind))];
            for (const id of promoted) {
                const unsupported = hardKinds.filter(k => !descriptors.get(id).supportedFilters.includes(k) && ['site', 'exclude_site', 'exclude_term', 'time_window'].includes(k));
                if (unsupported.length)
                    notes.push(id + ' does not enforce hard ' + unsupported.join(', ') + ' natively: verified locally');
            }
        }
    }
    // Community sources (forum / Q&A / video) in another language than the task's are ordered after the rest: an English
    // task does not spend a first-round slot on V2EX, a Chinese one not on Hacker News. They stay in `wanted` for round 2.
    if (!explicit && language && options.autoProviders !== false && descriptors.size) {
        const wrongLanguage = (id) => {
            const d = descriptors.get(id);
            return !!d && d.resultKinds.length > 0 && d.resultKinds.every(k => LANGUAGE_BOUND_KINDS.includes(k)) && !d.languages.includes('*') && !d.languages.includes(language);
        };
        const demoted = planList.filter(wrongLanguage);
        if (demoted.length) {
            planList = [...planList.filter(id => !wrongLanguage(id)), ...demoted];
            notes.push('language ' + language + ': ' + demoted.join(', ') + ' ordered last (community source in another language)');
        }
    }
    // Platforms are never planned on their own: round 1 draws from the profile table (whose vertical sources are curated), the
    // promoted web specialists and the configured list. The one exception is a task that names a site: a HARD `site`
    // constraint on a platform's domain (zhihu.com) puts that platform first when it is ready, with ONE web engine kept as the fallback.
    if (!explicit && descriptors.size) {
        const sitePlatforms = [];
        const siblings = [];
        const families = new Set();
        const hosts = [];
        for (const c of task.constraints) {
            if (c.kind !== 'site' || c.strength !== 'hard')
                continue;
            const host = domainOf(c.value);
            if (!host)
                continue;
            for (const d of descriptors.values()) {
                const id = routeIdOf(d);
                if (d.kind !== 'platform' || !d.domains?.some(domain => hostMatches(host, domain)) || sitePlatforms.includes(id) || siblings.includes(id))
                    continue;
                const status = options.status ? options.status(id) : { state: 'ready' };
                // One entry per upstream family (github, github-code and github-issues are one site): the others wait for round 2.
                if (isReady(id) && d.sourceFamily && families.has(d.sourceFamily)) {
                    siblings.push(id);
                    continue;
                }
                if (isReady(id)) {
                    sitePlatforms.push(id);
                    hosts.push(host);
                    if (d.sourceFamily)
                        families.add(d.sourceFamily);
                }
                else
                    notes.push('site ' + host + ' names platform ' + id + ' but it is not ready' + (status && status.state !== 'ready' ? ' (' + status.state + (status.reason ? ': ' + status.reason : '') + ')' : ' (unknown provider)') + ': web engines used');
            }
        }
        if (sitePlatforms.length) {
            const web = planList.find(id => !sitePlatforms.includes(id) && !!descriptors.get(id)?.resultKinds.includes('web') && !!isReady(id));
            const rest = [...planList.filter(id => !sitePlatforms.includes(id) && id !== web), ...siblings.filter(id => !planList.includes(id))];
            planList = [...sitePlatforms, ...web ? [web] : []];
            for (const id of rest)
                if (!held.includes(id))
                    held.push(id);
            notes.push('site ' + [...new Set(hosts)].join(', ') + ': platform ' + sitePlatforms.join(', ') + ' first' + (web ? ', ' + web + ' kept as the web fallback' : ', no web fallback is ready') + (rest.length ? '; held for a second round: ' + rest.join(', ') : ''));
        }
    }
    const max = Math.max(options.maxProviders ?? DEFAULT_MAX_PROVIDERS, 1);
    const compile = options.compiler ?? compileQuery;
    const providers = [];
    const skipped = [];
    const seen = new Set();
    const now = options.now ?? new Date();
    for (const id of planList) {
        if (seen.has(id))
            continue;
        seen.add(id);
        const status = options.status ? options.status(id) : { state: 'ready' };
        if (!status) {
            skipped.push({ id, reason: 'unknown provider' });
            continue;
        }
        if (status.state !== 'ready') {
            skipped.push({ id, reason: status.state + (status.reason ? ' (' + status.reason + ')' : '') });
            continue;
        }
        if (providers.length >= max && !explicit) {
            skipped.push({ id, reason: 'provider cap ' + max });
            continue;
        }
        providers.push({ id, compiled: compile(task, id, now) });
    }
    if (profileInferred)
        notes.push('profile inferred by rule: ' + profile);
    if (skipped.length)
        notes.push('skipped providers: ' + skipped.map(s => s.id + ' [' + s.reason + ']').join(', '));
    if (!providers.length)
        notes.push('no usable provider for profile ' + profile + (explicit ? ' (explicit engines)' : ''));
    // Supplements (registered ones only) are second-round candidates behind everything the plan already wants.
    const supplements = !explicit && options.autoProviders !== false ? PROFILE_SUPPLEMENTS[profile].filter(id => descriptors.has(id)) : [];
    return { profile, profileInferred, providers, ...language ? { language } : {}, wanted: [...new Set([...planList, ...surplus, ...held, ...supplements])], skipped, notes };
}
//# sourceMappingURL=plan.js.map