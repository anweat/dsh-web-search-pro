/**
 * S1 source planning (dev-plan §4.3): profile -> provider table, explicit
 * `engines` first, availability / cooldown filtering, one compiled query per
 * provider. Pure: availability comes in through a callback so the router
 * registry (or a test double) supplies it.
 * @module web-search-pro/pipeline/plan
 */
import { compileQuery } from "./compile.js";
/** Provider ids per profile (`general` uses the configured `engines`). */
export const PROFILE_PROVIDERS = {
    docs_code: ['ddg', 'bing', 'github'],
    academic: ['arxiv', 'pubmed', 'ddg'],
    experience: ['ddg', 'bing', 'v2ex'],
    news_fact: ['ddg', 'bing'],
    compare: ['ddg', 'bing', 'github'],
};
/** Default cap on providers of one plan (general profile with a long engine list). */
export const DEFAULT_MAX_PROVIDERS = 4;
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
    const wanted = options.engines?.length
        ? options.engines
        : profile === 'general' ? options.configured : PROFILE_PROVIDERS[profile];
    const explicit = Boolean(options.engines?.length);
    const max = Math.max(options.maxProviders ?? DEFAULT_MAX_PROVIDERS, 1);
    const providers = [];
    const skipped = [];
    const seen = new Set();
    const now = options.now ?? new Date();
    for (const id of wanted) {
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
        providers.push({ id, compiled: compileQuery(task, id, now) });
    }
    if (profileInferred)
        notes.push('profile inferred by rule: ' + profile);
    if (skipped.length)
        notes.push('skipped providers: ' + skipped.map(s => s.id + ' [' + s.reason + ']').join(', '));
    if (!providers.length)
        notes.push('no usable provider for profile ' + profile + (explicit ? ' (explicit engines)' : ''));
    return { profile, profileInferred, providers, skipped, notes };
}
//# sourceMappingURL=plan.js.map