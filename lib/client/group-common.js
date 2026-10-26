import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * "Common": what nearly everyone touches, open by default (every other group starts closed): the default engine chain with the
 * order a search would really try, the result count, parallel fusion, the tool surface, the proxy fake-IP switch, and the
 * DeepSeek Search source (常用) with its page-reading switch.
 * @module web-search-pro/client/group-common
 */
import { chainOf } from "./card-frame.js";
import { fill, ListRow, NumberRow, SelectRow, SwitchRow, useOverriddenCount } from "./field-rows.js";
import { SourceList } from "./group-sources.js";
import { styles as css } from "./styles.js";
import { Badge, Group, SubHead } from "./ui-kit.js";
/** The names of the common group's fields, in order. */
export const COMMON_FIELDS = ['engines', 'searchMaxResults', 'parallelEngines', 'toolSurface', 'allowProxyFakeIp', 'deepseekFetch'];
/** The chain a plain search would try, computed from the staged settings by the router's own function. */
function ChainLine({ card }) {
    const { t } = card;
    const chain = card.useWebSearchPro(snapshot => chainOf(snapshot)?.join(' › ') ?? '');
    return _jsxs("p", { className: css.chain, role: "status", "data-wsp-chain": true, children: [_jsx("span", { children: t('chainNow') }), chain ? chain.split(' › ').map((id, index) => _jsxs("span", { children: [index ? '› ' : '', _jsx("code", { children: id })] }, id + index)) : _jsx("span", { children: t('chainEmpty') })] });
}
export function CommonGroup({ card }) {
    const { t } = card;
    const count = useOverriddenCount(card, COMMON_FIELDS);
    return _jsxs(Group, { id: "common", title: t('groupCommon'), summary: t('groupCommonSub'), defaultOpen: true, badges: count ? _jsx(Badge, { tone: "info", children: fill(t('overriddenCount'), { n: count }) }) : null, children: [_jsx(ListRow, { card: card, field: "engines", placeholder: "ddg" }), _jsx(ChainLine, { card: card }), _jsx(NumberRow, { card: card, field: "searchMaxResults", unit: "count" }), _jsx(SwitchRow, { card: card, field: "parallelEngines" }), _jsx(SelectRow, { card: card, field: "toolSurface", options: [{ value: 'indexed', label: t('optIndexed') }, { value: 'flat', label: t('optFlat') }] }), _jsx(SwitchRow, { card: card, field: "allowProxyFakeIp", risk: t('riskNetwork') }), _jsx(SubHead, { children: t('commonDeepseekTitle') }), _jsx(SourceList, { card: card, only: ['deepseek'] }), _jsx(SwitchRow, { card: card, field: "deepseekFetch", risk: t('riskBilled') })] });
}
//# sourceMappingURL=group-common.js.map