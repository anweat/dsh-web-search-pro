/**
 * What a rendered search page said (dsh-browser's optional `searchPage`, docs/session-p0-contract.md) as the result or the error a
 * platform search raises. Every state has its own message, in Chinese like the neighbours: what happened and the ONE next step that
 * fits THAT state. The old combined sentence ("login or selectors") belongs to the `searchResults` fallback only, where the browser
 * cannot tell the states apart.
 *
 * Codes, and why (they flow through `router.providerReport` and the registry's cooldown rule, which cools down only a coded error that
 * is retryable):
 *  - needs_login with an AuthProfile: ENGINE_AUTH, not retryable. A credential was supplied and the site refused it, which is what
 *    `sources.status` shows as `credential: rejected`; waiting does not help, so no cooldown.
 *  - needs_login without a profile: CLI_NOT_LOGGED_IN, not retryable. The same code the standalone OpenCLI leg of the same chain gives for
 *    the same situation, and it does NOT claim a credential was rejected (none was supplied).
 *  - captcha / blocked: ENGINE_ERROR, not retryable. It is risk control; a retry at once makes it worse, and a cooldown timer would only
 *    hide that another leg of the chain (opencli, in your own Chrome) may still answer.
 *  - rate_limited: ENGINE_RATE_LIMIT, retryable. site_error / network: ENGINE_ERROR, retryable. timeout: ENGINE_TIMEOUT, retryable.
 *  - contract_drift: ENGINE_ERROR, not retryable: the page changed, a wait does not fix it.
 *  - empty / empty_unconfirmed: ENGINE_EMPTY (a served request: it never cools a platform down).
 * @module web-search-pro/search-page
 */
import { EngineError } from "./engine-error.js";
import { OPENCLI_SITE_OF } from "./cli/opencli-sites.js";
const detailOf = (res) => (res.detail ? '（依据：' + res.detail.replace(/\s+/g, ' ').slice(0, 160) + '）' : '');
const error = (message, code, retryable, outcome) => new EngineError(message, code, retryable, undefined, outcome);
/** The rows of a search page, or the error its state calls for. */
export function sourcesOfSearchPage(res, ctx) {
    const { label, platform } = ctx;
    const detail = detailOf(res);
    const fixSelectors = ctx.custom ? '更新 customPlatforms.' + platform + ' 里的 item / title / link 选择器' : '在 $DSH_HOME/settings.yaml 的 platformRules.' + platform + ' 里更新结果选择器（item / title / link）';
    switch (res.state) {
        case 'ok':
            if (res.items.length)
                return res.items;
            // `ok` without rows breaks the contract; the honest reading is "nothing came back, nothing was explained".
            throw error(label + ' 搜索页没有返回结果，也没有说明原因' + detail + '：先在浏览器里手动打开同一搜索页，看是否需要登录或有无结果。', 'ENGINE_EMPTY', false, 'empty_unconfirmed');
        case 'empty':
            return failEmpty(label + ' 没有结果：搜索页明确提示没有匹配的内容。换一个关键词再试。' + detail, 'empty');
        case 'empty_unconfirmed':
            return failEmpty(label + ' 没取到结果，但页面没有给出任何说明，无法确认原因（可能是需要登录，也可能是页面改版）' + detail + '：先在浏览器里手动打开同一搜索页，看是否需要登录或有无结果。', 'empty_unconfirmed');
        case 'needs_login': {
            const profile = res.authProfile ?? ctx.boundProfile;
            if (profile) {
                throw error(label + ' 要求登录：使用的 AuthProfile「' + profile + '」里保存的登录已经失效' + detail + '。重新运行 node scripts/save-login.mjs 登录一次，更新这个 profile。', 'ENGINE_AUTH', false, 'needs_login');
            }
            if (ctx.hasCookie) {
                throw error(label + ' 要求登录：customPlatforms.' + platform + '.cookie 里的登录已经失效' + detail + '。在浏览器里重新登录，换上新的 cookie（或改用 AuthProfile）。', 'ENGINE_AUTH', false, 'needs_login');
            }
            const way = ctx.custom
                ? '在 customPlatforms.' + platform + '.cookie 填入登录后的 cookie，或运行 node scripts/save-login.mjs 登录一次、在 dsh-browser 声明 AuthProfile 并通过 browserBindings.' + platform + ' 绑定'
                : '运行 node scripts/save-login.mjs 登录一次，在 dsh-browser 声明按域名授权的 AuthProfile，并通过 browserBindings.' + platform + ' 绑定';
            const viaChrome = OPENCLI_SITE_OF[platform] ? '（该平台的后端链里有 opencli，它直接使用你日常 Chrome 的登录态，不需要这一步）' : '';
            throw error(label + ' 要求登录，而这次没有绑定任何 AuthProfile' + detail + '。' + way + '。' + viaChrome, 'CLI_NOT_LOGGED_IN', false, 'needs_login');
        }
        case 'captcha':
            throw error(label + ' 弹出了验证码：这是站点的风控，不是登录或选择器问题' + detail + '。不要马上重试（在别的浏览器里通过验证对这里无效，通行证不共享）；隔一段时间再搜，或换一个来源。', 'ENGINE_ERROR', false, 'captcha');
        case 'blocked':
            throw error(label + ' 拒绝了这次访问（被拦截' + (res.status ? '，HTTP ' + res.status : '') + '）：这是站点的风控，不是登录或选择器问题' + detail + '。不要马上重试；换个网络出口，或隔一段时间再搜。', 'ENGINE_ERROR', false, 'blocked');
        case 'rate_limited':
            throw error(label + ' 限流了这次请求（HTTP 429）' + detail + '。等一会儿再搜。', 'ENGINE_RATE_LIMIT', true, 'rate_limited');
        case 'site_error':
            throw error(label + ' 服务端出错' + (res.status ? '（HTTP ' + res.status + '）' : '') + detail + '。稍后重试。', 'ENGINE_ERROR', true, 'site_error');
        case 'network':
            throw error(label + ' 的搜索页打不开（网络不通）' + detail + '。检查网络或代理后重试。', 'ENGINE_ERROR', true, 'network');
        case 'timeout':
            throw error(label + ' 的搜索页超时，没有加载完成' + detail + '。稍后重试。', 'ENGINE_TIMEOUT', true, 'timeout');
        case 'contract_drift':
            throw error(label + ' 的页面上有结果列表，但现有选择器一个也没匹配到：页面结构很可能改版了' + detail + '。' + fixSelectors + '。', 'ENGINE_ERROR', false, 'contract_drift');
        default:
            throw new EngineError(label + ' 搜索页返回了无法识别的状态「' + String(res.state) + '」：把 dsh-browser 与本插件升级到同一代版本。', 'ENGINE_ERROR', false);
    }
}
function failEmpty(message, outcome) {
    throw error(message, 'ENGINE_EMPTY', false, outcome);
}
//# sourceMappingURL=search-page.js.map