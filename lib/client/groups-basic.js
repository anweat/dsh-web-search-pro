import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The small groups: "Reading and evidence", "Network and cache", "Ranking weights" (advanced) and the built-in web tool
 * "Route". Each is a handful of rows built from the same controls; the long explanations sit behind the `?`.
 * @module web-search-pro/client/groups-basic
 */
import { fill, ListRow, NumberRow, SelectRow, SwitchRow, TextRow, useOverriddenCount } from "./field-rows.js";
import { styles as css } from "./styles.js";
import { Badge, Fold, Group } from "./ui-kit.js";
const count = (card, fields, t) => {
    const n = useOverriddenCount(card, fields);
    return n ? _jsx(Badge, { tone: "info", children: fill(t('overriddenCount'), { n }) }) : null;
};
const READING = ['fetchDefaultChars', 'exaContentsPerUrlChars', 'exaContentsTotalChars', 'evidence.autoProviders', 'evidence.maxRounds', 'evidence.maxQueries'];
export function ReadingGroup({ card }) {
    const { t } = card;
    return _jsxs(Group, { id: "reading", title: t('groupReading'), summary: t('groupReadingSub'), badges: count(card, READING, t), children: [_jsx(NumberRow, { card: card, field: "fetchDefaultChars", unit: "chars" }), _jsx(NumberRow, { card: card, field: "exaContentsPerUrlChars", unit: "chars" }), _jsx(NumberRow, { card: card, field: "exaContentsTotalChars", unit: "chars" }), _jsx(SwitchRow, { card: card, field: "evidence.autoProviders" }), _jsx(NumberRow, { card: card, field: "evidence.maxRounds", unit: "rounds" }), _jsx(NumberRow, { card: card, field: "evidence.maxQueries", unit: "count" }), _jsx("p", { className: css.notice, role: "note", children: t('evidenceNote') })] });
}
const NETWORK = ['timeoutMs', 'ttlSeconds', 'memoryCacheEntries', 'dbPath', 'verbose'];
export function NetworkGroup({ card }) {
    const { t } = card;
    return _jsxs(Group, { id: "network", title: t('groupNetwork'), summary: t('groupNetworkSub'), badges: count(card, NETWORK, t), children: [_jsx(NumberRow, { card: card, field: "timeoutMs", unit: "ms" }), _jsx(NumberRow, { card: card, field: "ttlSeconds", unit: "sec" }), _jsx(NumberRow, { card: card, field: "memoryCacheEntries", unit: "count" }), _jsx(TextRow, { card: card, field: "dbPath", code: true }), _jsx(SwitchRow, { card: card, field: "verbose" })] });
}
const RANKING = ['rrfConstant', 'freshnessBoost', 'freshnessDays', 'authorityBoost', 'authorityDomains'];
export function RankingGroup({ card }) {
    const { t } = card;
    return _jsxs(Group, { id: "ranking", title: t('groupRanking'), summary: t('groupRankingSub'), badges: count(card, RANKING, t), children: [_jsx(NumberRow, { card: card, field: "rrfConstant" }), _jsx(NumberRow, { card: card, field: "freshnessBoost" }), _jsx(NumberRow, { card: card, field: "freshnessDays", unit: "days" }), _jsx(NumberRow, { card: card, field: "authorityBoost" }), _jsx(ListRow, { card: card, field: "authorityDomains", placeholder: "docs.example.com" }), _jsx("p", { className: css.notice, role: "note", children: t('rankingNote') })] });
}
const ROUTE = ['registerProvider', 'providerId', 'provider.evidence', 'provider.deadlineMs'];
export function RouteGroup({ card }) {
    const { t } = card;
    const on = card.useWebSearchPro(snapshot => snapshot.fields.registerProvider.text === 'true');
    const routeId = card.useWebSearchPro(snapshot => snapshot.fields.providerId.text.trim() || 'web-search-pro');
    return _jsxs(Group, { id: "route", title: t('groupRoute'), summary: t('groupRouteSub'), badges: count(card, ROUTE, t), children: [_jsx(SwitchRow, { card: card, field: "registerProvider" }), on ? _jsxs(_Fragment, { children: [_jsx(TextRow, { card: card, field: "providerId", code: true }), _jsx(SelectRow, { card: card, field: "provider.evidence", options: [{ value: 'auto', label: t('optAuto') }, { value: 'off', label: t('optOff') }] }), _jsx(NumberRow, { card: card, field: "provider.deadlineMs", unit: "ms" })] }) : _jsx("p", { className: css.rowHint, children: t('routeOffNote') }), _jsx(Fold, { id: "route-patch", title: t('routeHelpTitle'), hint: t('routeHelpFoldHint'), children: _jsxs("div", { "data-wsp-route-help": true, children: [_jsx("p", { className: css.rowHint, children: t('routeHelpIntro') }), _jsx("pre", { className: css.codeBlock, children: `- id: web\n  name: '@deepseek-ai/dsh-web'\n  config:\n    searchProvider: ${routeId}\n    fetchProvider: ${routeId}` }), _jsx("p", { className: css.rowHint, children: t('routeHelpAfter') })] }) })] });
}
//# sourceMappingURL=groups-basic.js.map