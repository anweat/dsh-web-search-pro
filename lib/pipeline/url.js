/**
 * URL canonicalization for candidate merging (design §6.1, dev-plan M2a).
 *
 * The canonical form is a MERGE KEY, not a fetch target: two raw URLs with the
 * same canonical form are treated as the same document. The rules are
 * deliberately conservative. Content parameters (ids, versions, pagination,
 * queries), hash routes, scheme and `www.` are never normalised away, because
 * merging different documents loses evidence while missing a merge only
 * costs a duplicate.
 *
 *  - host lower-cased, trailing dot and default port dropped (WHATWG URL does the latter two);
 *  - fragment dropped, EXCEPT hash routes (`#/path`, `#!/path`), which address
 *    different content on single-page apps;
 *  - tracking parameters removed (documented lists below); all other
 *    parameters are kept and sorted by key (stable for repeated keys);
 *  - percent-escapes upper-cased, trailing slash dropped on non-root paths.
 * @module web-search-pro/pipeline/url
 */
/** Parameter-name prefixes that are tracking by construction. */
export const TRACKING_PARAM_PREFIXES = [
    'utm_', // Google Analytics campaign tags
    'mtm_', // Matomo tag manager
    'pk_', // Matomo campaign tags
    'hsa_', // HubSpot ads
    'spm_', // Alibaba / Bilibili SPM (spm_id_from)
];
/** Exact (case-insensitive) parameter names that are tracking or share-attribution only. */
export const TRACKING_PARAMS = new Set([
    'spm', 'scm', // Alibaba / Bilibili / Taobao page attribution
    'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'li_fat_id', 'igshid', 'igsh', // ad / social click ids
    'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'hsctatracking', 'mkt_tok', 'vero_id', 'oly_anon_id', 'oly_enc_id', // email campaigns
    '_ga', '_gl', // Google linker
    'ref_src', 'ref_url', // Twitter / generic referrer attribution
    'share_source', 'share_medium', 'share_plat', 'share_session_id', 'share_tag', 'share_from', // in-app share attribution
    'vd_source', // Bilibili share
    'bd_vid', 'hmsr', 'hmpl', 'hmcu', 'hmkw', 'hmci', // Baidu ads / Tongji
    'cmpid',
]);
/** Parameters that are tracking only on specific hosts (name set per host suffix). */
export const HOST_TRACKING_PARAMS = [
    { host: 'mp.weixin.qq.com', params: new Set(['chksm', 'scene', 'srcid', 'sharer_sharetime', 'sharer_shareid', 'clicktime', 'enterid', 'ascene', 'exportkey', 'pass_ticket', 'nettype', 'devicetype']) },
];
/** Hosts where `ref` names a git ref / branch (content), never a referrer. */
const CODE_FORGE_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org', 'gitee.com', 'codeberg.org', 'sr.ht', 'huggingface.co', 'sourceforge.net', 'dev.azure.com'];
/** `ref=v1.2`, `ref=main`, `ref=<sha>` are content even off the code forges. */
const GIT_REF_VALUE = /^(v?\d+(\.\d+)*[\w.-]*|[0-9a-f]{7,40}|refs\/.+|head|main|master)$/i;
function hostIs(host, domain) {
    return host === domain || host.endsWith('.' + domain);
}
/**
 * Whether query parameter `name=value` on `host` is a tracking parameter.
 *
 * Two names are ambiguous and therefore conditional:
 *  - `ref` is tracking except on code forges or when the value looks like a git ref;
 *  - `from` is tracking only with a non-numeric value (`from=search`); a numeric
 *    `from` is an offset/pagination parameter and is kept.
 */
export function isTrackingParam(name, value, host) {
    const key = name.toLowerCase();
    if (TRACKING_PARAMS.has(key))
        return true;
    if (TRACKING_PARAM_PREFIXES.some(prefix => key.startsWith(prefix)))
        return true;
    if (HOST_TRACKING_PARAMS.some(entry => hostIs(host, entry.host) && entry.params.has(key)))
        return true;
    if (key === 'ref')
        return !CODE_FORGE_HOSTS.some(domain => hostIs(host, domain)) && !GIT_REF_VALUE.test(value);
    if (key === 'from')
        return value !== '' && !/^\d+$/.test(value);
    return false;
}
/** `#/docs/x` and `#!/docs/x` are client-side routes, not anchors. */
export function isHashRoute(hash) {
    return hash.startsWith('#/') || hash.startsWith('#!/');
}
/**
 * Canonical merge key of a URL. Non-http(s) or unparsable input is returned
 * trimmed but otherwise unchanged, so callers can still use it as a key.
 */
export function canonicalizeUrl(raw) {
    const input = raw.trim();
    let u;
    try {
        u = new URL(input);
    }
    catch {
        return input;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:')
        return input;
    if (u.hostname.endsWith('.'))
        u.hostname = u.hostname.slice(0, -1);
    if (!isHashRoute(u.hash))
        u.hash = '';
    const kept = [];
    for (const [name, value] of u.searchParams)
        if (!isTrackingParam(name, value, u.hostname))
            kept.push([name, value]);
    kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); // Array#sort is stable: repeated keys keep their order
    u.search = new URLSearchParams(kept).toString();
    let pathname = u.pathname.replace(/%[0-9a-f]{2}/gi, escape => escape.toUpperCase());
    if (pathname.length > 1 && pathname.endsWith('/'))
        pathname = pathname.slice(0, -1);
    u.pathname = pathname;
    return u.href;
}
//# sourceMappingURL=url.js.map