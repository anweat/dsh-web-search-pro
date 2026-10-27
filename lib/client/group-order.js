import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * "Search order": the order a plain search tries its engines, and the order each platform tries its backends, as lists one
 * moves, adds to and removes from (not as a comma text). Below the engine list sits the order a search would really use, with a
 * sentence on why it differs from the list; the platforms are rows with a dialog. Everything stages into the same draft the sticky
 * save bar writes: `engines` and `platformBackends` as they are, `sources.confidence.<id>` for the confidence box of a row.
 * @module web-search-pro/client/group-order
 */
import { useState } from 'react';
import { explainChain } from "../default-chain.js";
import { adaptersOf } from "./cli-form.js";
import { chainInputOf } from "./card-frame.js";
import { fill, rowLabels, useField, useOverriddenCount } from "./field-rows.js";
import { hasHelp, labelKey } from "./field-keys.js";
import { confidenceField, CONFIDENCE_PREFIX } from "./form-specs.js";
import { addId, backendChoices, backendName, chainsOf, confidenceView, customEntries, customRows, defaultChainOf, engineChoices, filterPlatforms, idsOf, isCustomId, moveId, ORDER_PLATFORMS, PLATFORM_NAMES, removeId, sourceInfo, splitPlatforms, textOf, withChain, } from "./order.js";
import { styles as css } from "./styles.js";
import { Badge, Btn, Dialog, Fold, Group, Help, Item, Row, Select, SubHead, TextInput } from "./ui-kit.js";
import { DEFAULT_CUSTOM_CONFIDENCE } from "../cli/spec.js";
/** The fields of this group, for its "N overridden" badge (the confidence entries are counted by their prefix). */
const ORDER_FIELDS = ['engines', 'platformBackends'];
/** Whether the card can tell a source runs: its key, its address, its spec, or (when the plugin answers) the plugin's own probe. */
function sourceState(snapshot, info, t) {
    const live = snapshot.server.status?.sources[info.id];
    if (info.kind === 'keyed' && info.def) {
        const def = info.def;
        if (def.credential) {
            const cred = snapshot.credentials[def.credential];
            return cred.loading ? { tone: 'neutral', label: t('credentialChecking') } : cred.configured ? { tone: 'success', label: t('stateReady') } : { tone: 'warning', label: t('stateNoKey') };
        }
        return (snapshot.fields.searxngUrl?.text ?? '') !== '' ? { tone: 'success', label: t('stateReady') } : { tone: 'warning', label: t('stateNoUrl') };
    }
    if (info.kind === 'custom') {
        const problems = customRows(adaptersOf(snapshot.fields.cliAdapters.text)).find(row => row.id === info.id.slice('custom-cli:'.length))?.problems ?? [];
        if (problems.length)
            return { tone: 'danger', label: t('stateSpecBad'), reason: problems[0] };
        // A saved CLI is probed by the plugin: installed or not. One that is only in the draft is just a valid spec so far.
        if (live)
            return live.available ? { tone: 'success', label: t('stateReady') } : { tone: 'warning', label: t('stateNotReady'), ...live.reason ? { reason: live.reason } : {} };
        return { tone: 'neutral', label: t('stateSpecOk') };
    }
    if (info.kind === 'unknown')
        return info.id.startsWith('custom-cli:') ? { tone: 'danger', label: t('stateNoSpec') } : { tone: 'warning', label: t('stateUnknown') };
    if (live && !live.available)
        return { tone: 'warning', label: t('stateNotReady'), ...live.reason ? { reason: live.reason } : {} };
    return { tone: 'success', label: t('stateReady') };
}
/** Confidence a source has when nothing is set for it. */
const defaultConfidence = (info, adapters) => {
    if (info.kind !== 'custom')
        return 1;
    const raw = customEntries(adapters).find(([key]) => key === info.id.slice('custom-cli:'.length))?.[1];
    return typeof raw?.confidence === 'number' ? raw.confidence : DEFAULT_CUSTOM_CONFIDENCE;
};
/**
 * The confidence of a source, as a labelled box. While it is 1 (the built-in default, which changes nothing) it is only a quiet
 * "Confidence · default 1" that opens into the box on a click; any other value, or a wrong one, keeps the box open and picked out.
 */
function ConfidenceBox({ card, info, adapters, fallback }) {
    const { t } = card;
    const [open, setOpen] = useState(false);
    const field = confidenceField(info.id);
    const text = card.useWebSearchPro(snapshot => snapshot.fields[field]?.text ?? '');
    const invalid = card.useWebSearchPro(snapshot => snapshot.fields[field]?.invalid ?? false);
    const disabled = card.useWebSearchPro(snapshot => !snapshot.writable || snapshot.saving);
    const dflt = fallback ?? defaultConfidence(info, adapters);
    const view = confidenceView(text, dflt);
    const name = fill(t('orderConfidenceOf'), { name: info.name });
    const help = _jsx(Help, { label: t('helpLabel'), text: t('orderConfidenceHelp') });
    if (view.quiet && !open && !invalid) {
        return _jsxs("span", { className: "wsp-conf", "data-wsp-confidence": "quiet", children: [_jsxs("button", { type: "button", className: "wsp-conf-quiet", disabled: disabled, "aria-label": name, title: t('orderConfidenceEdit'), onClick: () => setOpen(true), children: [t('orderConfidenceLabel'), " ", _jsx("span", { children: view.typed ? view.effective : fill(t('orderConfidenceDefault'), { c: view.effective }) })] }), help] });
    }
    return _jsxs("span", { className: view.quiet && !invalid ? 'wsp-conf' : 'wsp-conf wsp-conf-on', "data-wsp-confidence": "set", children: [_jsx("label", { className: "wsp-conf-label", htmlFor: 'wsp-conf-' + info.id, children: t('orderConfidenceLabel') }), _jsx(TextInput, { id: 'wsp-conf-' + info.id, small: true, numeric: true, value: text, placeholder: String(dflt), invalid: invalid || view.invalid, disabled: disabled, ariaLabel: name, autoFocus: open, onBlur: () => setOpen(false), onChange: value => card.edit(field, value) }), help] });
}
/** One row of an ordered list: its place, name, readiness and confidence, and the buttons that move it. */
function OrderItem(props) {
    const { card, info, index, count, state } = props;
    const { t } = card;
    return _jsx("div", { className: props.muted ? 'wsp-order-row wsp-order-default' : 'wsp-order-row', "data-wsp-order-item": info.id, children: _jsx(Item, { data: info.id, title: _jsxs(_Fragment, { children: [_jsx("span", { className: "wsp-order-no", children: index + 1 }), _jsx("strong", { children: info.name }), info.name !== info.id ? _jsx("code", { children: info.id }) : null] }), badges: _jsxs(_Fragment, { children: [info.kind === 'custom' ? _jsx(Badge, { tone: "outline", children: t('kindCustom') }) : null, _jsx(Badge, { tone: state.tone, children: state.label })] }), meta: state.reason, actions: _jsxs(_Fragment, { children: [_jsx(ConfidenceBox, { card: card, info: info, adapters: props.adapters, fallback: props.fallback }), _jsx(Btn, { ariaLabel: t('orderUp'), title: t('orderUp'), disabled: props.disabled || index === 0, onClick: () => props.onMove(-1), data: "order-up", children: "\u2191" }), _jsx(Btn, { ariaLabel: t('orderDown'), title: t('orderDown'), disabled: props.disabled || index === count - 1, onClick: () => props.onMove(1), data: "order-down", children: "\u2193" }), _jsx(Btn, { ariaLabel: t('orderRemove'), title: t('orderRemove'), danger: true, disabled: props.disabled, onClick: props.onRemove, data: "order-remove", children: "\u00D7" })] }) }) });
}
/** A closed drop-down that adds the source picked (it snaps back to its title). */
function AddSelect({ label, title, choices, onAdd, disabled, name }) {
    return _jsx("span", { "data-wsp-add": name, children: _jsx(Select, { ariaLabel: label, value: "", options: [{ value: '', label: title }, ...choices], disabled: disabled || choices.length === 0, onChange: value => { if (value)
                onAdd(value); } }) });
}
// ── the order a search would really use ─────────────────────────────────────────────────────────────────────────────────
function whyText(t, reasons) {
    if (!reasons.length)
        return t('orderWhySame');
    const text = (reason) => {
        const ids = reason.ids.join(', ');
        switch (reason.kind) {
            case 'common': return fill(t('orderWhyCommon'), { ids });
            case 'disabled': return fill(t('orderWhyDisabled'), { ids });
            case 'priority': return fill(t('orderWhyPriority'), { ids });
            case 'anonymous-only': return fill(t('orderWhyAnonymous'), { ids });
            case 'own-list': return fill(t('orderWhyOwn'), { ids });
        }
    };
    return reasons.map(text).join(' ');
}
/** The chain a plain search would try, from the draft, and one sentence on why it is not the list as written. */
export function EffectiveChain({ card }) {
    const { t } = card;
    const view = card.useWebSearchPro(snapshot => explainChain(chainInputOf(snapshot)));
    return _jsxs("div", { "data-wsp-effective": true, children: [_jsxs("p", { className: css.chain, role: "status", "data-wsp-chain": true, children: [_jsx("span", { children: t('chainNow') }), view.chain?.length ? view.chain.map((id, index) => _jsxs("span", { children: [index ? '› ' : '', _jsx("code", { children: id })] }, id + index)) : _jsx("span", { children: t('chainEmpty') })] }), _jsxs("p", { className: css.why, "data-wsp-why": true, children: [_jsx("strong", { children: t('orderWhy') }), " ", view.chain ? whyText(t, view.reasons) : t('orderWhyNone')] })] });
}
// ── the general engine list ────────────────────────────────────────────────────────────────────────────────────────────────
export function EngineOrder({ card }) {
    const { t } = card;
    const field = useField(card, 'engines');
    const adapters = card.useWebSearchPro(snapshot => snapshot.fields.cliAdapters.text);
    const adaptersValue = adaptersOf(adapters);
    const ids = idsOf(field.state.text);
    const st = field.state;
    const set = (next) => field.edit(textOf(next));
    const choices = engineChoices(ids, adaptersValue).map(id => ({ value: id, label: sourceInfo(id, adaptersValue).name + (sourceInfo(id, adaptersValue).name !== id ? ' (' + id + ')' : '') }));
    return _jsx(Row, { field: "engines", label: t('engines'), hint: t('enginesHint'), help: hasHelp('engines') ? t(`${labelKey('engines')}Help`) : undefined, overridden: st.overridden, invalid: st.invalid || !!st.message, problem: st.message ?? t('invalid'), warning: st.warning, disabled: field.disabled, labels: rowLabels(t), wide: true, children: _jsxs("div", { className: css.stack, "data-wsp-order": "engines", children: [_jsx("div", { className: css.list, role: "list", "aria-label": t('orderListLabel'), children: ids.length === 0 ? _jsx("p", { className: css.empty, children: t('orderEmpty') }) : ids.map((id, index) => _jsx(EngineRow, { card: card, id: id, index: index, ids: ids, adapters: adaptersValue, disabled: field.disabled, onChange: set }, id)) }), _jsxs("div", { className: css.orderBar, children: [_jsx(AddSelect, { name: "engine", label: t('orderAddLabel'), title: t('orderAdd'), choices: choices, disabled: field.disabled, onAdd: id => set(addId(ids, id)) }), _jsx(Btn, { disabled: field.disabled || !st.overridden, onClick: field.reset, data: "order-restore", children: t('orderRestore') })] }), _jsx(EffectiveChain, { card: card })] }) });
}
function EngineRow({ card, id, index, ids, adapters, disabled, onChange }) {
    const { t } = card;
    const info = sourceInfo(id, adapters);
    const state = card.useWebSearchPro(snapshot => sourceState(snapshot, info, t));
    return _jsx(OrderItem, { card: card, info: info, index: index, count: ids.length, adapters: adapters, state: state, disabled: disabled, onMove: delta => onChange(moveId(ids, id, delta)), onRemove: () => onChange(removeId(ids, id)) });
}
// ── platforms ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The chain a platform uses now: the override when there is one, else the built-in default. */
function chainFor(text, platform) {
    const chains = chainsOf(text);
    if (!chains)
        return { ids: [...defaultChainOf(platform)], overridden: false, valid: false };
    const own = chains[platform];
    return own ? { ids: own, overridden: true, valid: true } : { ids: [...defaultChainOf(platform)], overridden: false, valid: true };
}
function PlatformItem({ card, platform, onEdit }) {
    const { t } = card;
    const text = card.useWebSearchPro(snapshot => snapshot.fields.platformBackends.text);
    const disabled = card.useWebSearchPro(snapshot => !snapshot.writable);
    const chain = chainFor(text, platform);
    return _jsx(Item, { data: platform, title: _jsx("strong", { children: PLATFORM_NAMES[platform] ?? platform }), badges: _jsxs(_Fragment, { children: [platform in PLATFORM_NAMES && PLATFORM_NAMES[platform] !== platform ? _jsx("code", { children: platform }) : null, _jsx(Badge, { tone: chain.overridden ? 'info' : 'outline', children: chain.overridden ? t('overridden') : t('orderDefaultBadge') })] }), meta: _jsx("span", { className: chain.overridden ? undefined : css.muted, children: chain.ids.map(backendName).join(' › ') || t('platformEmpty') }), actions: _jsx(Btn, { disabled: disabled, onClick: onEdit, data: "platform-edit", children: t('edit') }) });
}
/** The body of the platform dialog: the chain as a list with its buttons, the backends that can still be added, and "Restore default". */
export function PlatformForm({ card, platform }) {
    const { t } = card;
    const field = useField(card, 'platformBackends');
    const adapters = card.useWebSearchPro(snapshot => snapshot.fields.cliAdapters.text);
    const adaptersValue = adaptersOf(adapters);
    const chain = chainFor(field.state.text, platform);
    const write = (ids) => {
        const next = withChain(field.state.text, platform, ids);
        if (next !== undefined)
            field.edit(next);
    };
    if (!chain.valid)
        return _jsx("p", { className: `${css.rowHint} wsp-bad`, role: "alert", children: t('platformChainBad') });
    const choices = backendChoices(platform, chain.ids, adaptersValue).map(id => ({ value: id, label: backendName(id) + (backendName(id) !== id ? ' (' + id + ')' : '') }));
    return _jsxs("div", { className: css.stack, "data-wsp-order": 'platform:' + platform, children: [_jsx("div", { className: css.list, role: "list", "aria-label": t('orderListLabel'), children: chain.ids.length === 0 ? _jsx("p", { className: css.empty, children: t('platformEmpty') }) : chain.ids.map((id, index) => _jsx(BackendRow, { card: card, platform: platform, id: id, index: index, ids: chain.ids, muted: !chain.overridden, adapters: adaptersValue, disabled: field.disabled, onChange: write }, id)) }), _jsxs("div", { className: css.orderBar, children: [_jsx(AddSelect, { name: "backend", label: t('orderAddLabel'), title: choices.length ? t('orderAdd') : t('platformAddNone'), choices: choices, disabled: field.disabled, onAdd: id => write(addId(chain.ids, id)) }), _jsx(Btn, { disabled: field.disabled || !chain.overridden, onClick: () => write(undefined), data: "platform-restore", children: t('orderRestore') }), !chain.overridden ? _jsx(Badge, { tone: "outline", children: t('orderDefaultBadge') }) : null] })] });
}
function BackendRow({ card, platform, id, index, ids, muted, adapters, disabled, onChange }) {
    const { t } = card;
    const custom = isCustomId(id);
    const base = custom ? sourceInfo(id, adapters) : { id, name: backendName(id), kind: 'unknown' };
    const info = custom ? base : { ...base, kind: 'anonymous' };
    const leg = card.useWebSearchPro(snapshot => snapshot.server.status?.legs[platform + '/' + id]);
    const state = card.useWebSearchPro((snapshot) => {
        if (custom)
            return sourceState(snapshot, info, t);
        return leg ? (leg.ready ? { tone: 'success', label: t('stateReady') } : { tone: 'warning', label: t('stateNotReady'), ...leg.reason ? { reason: leg.reason } : {} }) : { tone: 'neutral', label: t('backendUnknown') };
    });
    return _jsx(OrderItem, { card: card, info: info, index: index, count: ids.length, adapters: adapters, state: state, fallback: leg?.confidence, muted: muted, disabled: disabled, onMove: delta => onChange(moveId(ids, id, delta)), onRemove: () => onChange(removeId(ids, id)) });
}
export function PlatformList({ card }) {
    const { t } = card;
    const [editing, setEditing] = useState();
    const [query, setQuery] = useState('');
    const split = card.useWebSearchPro(snapshot => splitPlatforms(ORDER_PLATFORMS, snapshot.fields.platformBackends.text, adaptersOf(snapshot.fields.cliAdapters.text)));
    const row = (platform) => _jsx(PlatformItem, { card: card, platform: platform, onEdit: () => setEditing(platform) }, platform);
    const filtering = query.trim() !== '';
    const found = filterPlatforms(ORDER_PLATFORMS, query);
    return _jsxs(_Fragment, { children: [_jsxs("div", { className: "wsp-filter", "data-wsp-platform-filter": true, children: [_jsx(TextInput, { value: query, onChange: setQuery, placeholder: t('orderPlatformFilter'), ariaLabel: t('orderPlatformFilterLabel') }), filtering ? _jsx("span", { className: css.rowHint, children: fill(t('orderPlatformFound'), { n: found.length, total: ORDER_PLATFORMS.length }) }) : null] }), filtering
                ? _jsx("div", { className: css.list, "data-wsp-platform-list": true, children: found.length ? found.map(row) : _jsx("p", { className: css.empty, children: t('orderPlatformNone') }) })
                : _jsxs(_Fragment, { children: [_jsx("div", { className: css.list, "data-wsp-platform-list": true, children: split.shown.map(row) }), split.rest.length ? _jsx(Fold, { id: "platforms-more", title: fill(t('orderPlatformsMore'), { n: split.rest.length }), hint: t('orderPlatformsMoreHint'), children: _jsx("div", { className: css.list, "data-wsp-platform-rest": true, children: split.rest.map(row) }) }) : null] }), editing ? _jsxs(Dialog, { open: true, title: fill(t('platformDialogTitle'), { name: PLATFORM_NAMES[editing] ?? editing }), closeLabel: t('close'), description: t('platformDialogNote'), onClose: () => setEditing(undefined), footer: _jsx(Btn, { primary: true, onClick: () => setEditing(undefined), data: "platform-done", children: t('done') }), children: [_jsx("p", { className: css.rowHint, children: t('dialogStagesNote') }), _jsx(PlatformForm, { card: card, platform: editing })] }) : null] });
}
// ── the group ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Open another group of the card (the "Sources" group holds `sources.priority` / `sources.disabled`) and scroll to it. */
function openGroup(id) {
    const node = document.querySelector(`[data-wsp-group="${id}"]`);
    if (!node)
        return;
    node.open = true;
    node.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
}
export function OrderGroup({ card }) {
    const { t } = card;
    const count = useOverriddenCount(card, ORDER_FIELDS) + card.useWebSearchPro(snapshot => Object.keys(snapshot.fields).filter(field => field.startsWith(CONFIDENCE_PREFIX) && snapshot.fields[field]?.overridden).length);
    const rules = card.useWebSearchPro(snapshot => ({ priority: (snapshot.fields['sources.priority']?.text ?? '').trim(), disabled: (snapshot.fields['sources.disabled']?.text ?? '').trim() }));
    return _jsxs(Group, { id: "order", title: t('groupOrder'), summary: t('groupOrderSub'), badges: count ? _jsx(Badge, { tone: "info", children: fill(t('overriddenCount'), { n: count }) }) : null, children: [_jsx(SubHead, { children: t('orderEnginesTitle') }), _jsx(EngineOrder, { card: card }), _jsxs("p", { className: css.rowHint, "data-wsp-order-rules": true, children: [_jsxs("strong", { children: [t('orderRulesTitle'), "."] }), " ", t('orderRulesNote'), " ", fill(t('orderPriorityNow'), { ids: rules.priority || t('orderNone') }), " \u00B7 ", fill(t('orderDisabledNow'), { ids: rules.disabled || t('orderNone') }), " \u00B7 ", _jsx("button", { type: "button", className: css.link, onClick: () => openGroup('sources'), "data-wsp-open-sources": true, children: t('orderRulesLink') })] }), _jsx(SubHead, { children: t('orderPlatformsTitle') }), _jsx("p", { className: css.rowHint, children: t('orderPlatformsNote') }), _jsx(PlatformList, { card: card })] });
}
//# sourceMappingURL=group-order.js.map