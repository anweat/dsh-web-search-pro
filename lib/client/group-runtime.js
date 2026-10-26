import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * "Runtime and backends": the CLI / OpenCLI / Agent Reach switches, the Twitter / X login values (a dialog), the JSON objects
 * that shape backends (Playwright, platform backend chains, CLI adapters) and the platform settings (custom platforms,
 * selectors, browser bindings), each as a list with its own dialog.
 * @module web-search-pro/client/group-runtime
 */
import { useState } from 'react';
import { fill, SwitchRow, TextRow, useOverriddenCount } from "./field-rows.js";
import { SecretRow } from "./group-sources.js";
import { JsonList, jsonFieldsOf } from "./json-list.js";
import { styles as css } from "./styles.js";
import { Badge, Btn, Dialog, Group, Item, SubHead } from "./ui-kit.js";
const RUNTIME = ['enableCliBackends', 'opencliEnabled', 'agentReachEnabled', 'twitterAuthTokenEnv', 'twitterCt0Env', 'playwright', 'platformBackends', 'cliAdapters', 'customPlatforms', 'platformRules', 'browserBindings'];
/** The two values twitter-cli needs: the controls of the dialog. */
export function TwitterForm({ card }) {
    const { t } = card;
    return _jsxs(_Fragment, { children: [_jsx(TextRow, { card: card, field: "twitterAuthTokenEnv", code: true, placeholder: "TWITTER_AUTH_TOKEN" }), _jsx(SecretRow, { card: card, id: "twitter-auth-token", label: t('twitterAuthToken') }), _jsx(TextRow, { card: card, field: "twitterCt0Env", code: true, placeholder: "TWITTER_CT0" }), _jsx(SecretRow, { card: card, id: "twitter-ct0", label: t('twitterCt0') })] });
}
function TwitterItem({ card }) {
    const { t } = card;
    const [open, setOpen] = useState(false);
    const view = card.useWebSearchPro(snapshot => ({ a: snapshot.credentials['twitter-auth-token'], b: snapshot.credentials['twitter-ct0'], writable: snapshot.writable }));
    const both = view.a.configured && view.b.configured;
    return _jsxs(_Fragment, { children: [_jsx("div", { className: css.list, "data-wsp-twitter": true, children: _jsx(Item, { data: "twitter", title: _jsx("strong", { children: t('twitterGroup') }), badges: _jsx(Badge, { tone: both ? 'success' : view.a.configured || view.b.configured ? 'warning' : 'neutral', children: both ? t('credentialSet') : view.a.configured || view.b.configured ? t('twitterPartial') : t('credentialUnset') }), meta: t('twitterGroupHint'), actions: _jsx(Btn, { disabled: !view.writable, onClick: () => setOpen(true), data: "twitter-edit", children: t('edit') }) }) }), open ? _jsxs(Dialog, { open: true, title: t('twitterGroup'), closeLabel: t('close'), description: t('twitterGroupHint'), onClose: () => setOpen(false), footer: _jsx(Btn, { primary: true, onClick: () => setOpen(false), children: t('done') }), children: [_jsx("p", { className: css.rowHint, children: t('dialogStagesNote') }), _jsx(TwitterForm, { card: card })] }) : null] });
}
export function RuntimeGroup({ card }) {
    const { t } = card;
    const n = useOverriddenCount(card, RUNTIME);
    return _jsxs(Group, { id: "runtime", title: t('groupRuntime'), summary: t('groupRuntimeSub'), badges: n ? _jsx(Badge, { tone: "info", children: fill(t('overriddenCount'), { n }) }) : null, children: [_jsx(SwitchRow, { card: card, field: "enableCliBackends" }), _jsx(SwitchRow, { card: card, field: "opencliEnabled" }), _jsx(SwitchRow, { card: card, field: "agentReachEnabled" }), _jsx(SubHead, { children: t('runtimeLoginTitle') }), _jsx(TwitterItem, { card: card }), _jsx(SubHead, { children: t('runtimeBackendsTitle') }), _jsx(JsonList, { card: card, fields: jsonFieldsOf('runtime') }), _jsx(SubHead, { children: t('runtimePlatformsTitle') }), _jsx(JsonList, { card: card, fields: jsonFieldsOf('platform') })] });
}
//# sourceMappingURL=group-runtime.js.map