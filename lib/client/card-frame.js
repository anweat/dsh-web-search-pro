import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The frame around the groups: the status summary on top (with the warnings dialog) and the save bar at the bottom.
 *
 * The Host's `SettingsForm` offers one save button below the controls. This card needs the bar to stay in view while a long
 * page scrolls, to say how many edits are waiting, and to offer "Discard", so the frame is built here; the behaviors a
 * settings form has are kept: it says so when the settings are not served or read-only, and it drops the staged edits when
 * the page is left.
 * @module web-search-pro/client/card-frame
 */
import { useEffect, useRef, useState } from 'react';
import { COMMON_SOURCE_IDS } from "../providers/keyed-meta.js";
import { effectiveChain } from "../default-chain.js";
import { fill, parseList } from "./field-rows.js";
import { labelKey, SOURCE_DEFS } from "./field-keys.js";
import { styles as css } from "./styles.js";
import { Badge, Btn, Dialog } from "./ui-kit.js";
/** Sources whose key is a credential the card can see (searxng and the like have none). */
const KEYED_DEFS = SOURCE_DEFS.filter(def => def.credential);
/** What the default chain rule reads from the staged settings: the list, the preferences, the ready common sources, the policy. */
export function chainInputOf(snapshot) {
    const text = (field) => snapshot.fields[field]?.text ?? '';
    const commonReady = SOURCE_DEFS.filter(def => def.common && def.credential && COMMON_SOURCE_IDS.includes(def.id) && snapshot.credentials[def.credential]?.configured).map(def => def.id);
    return { engines: parseList(text('engines')), priority: parseList(text('sources.priority')), disabled: parseList(text('sources.disabled')), commonReady, anonymousOnly: text('evidence.sourcePolicy') === 'anonymous-only' };
}
/** The chain a plain search would try, from the staged settings; undefined when the draft leaves nothing to try. */
export function chainOf(snapshot) {
    try {
        return effectiveChain(chainInputOf(snapshot));
    }
    catch {
        return undefined;
    }
}
/**
 * The chain a plain search tries once the agent's changes (engines, priority, disabled of the overlay) are on top of the staged settings,
 * by the same rule; undefined while the agent changed none of the three, an empty list when it would leave nothing to try.
 */
export function agentChainOf(snapshot) {
    const items = snapshot.server.overlay.view?.items ?? [];
    const listOf = (key) => { const value = items.find(item => item.key === key)?.value; return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : undefined; };
    const engines = listOf('engines');
    const priority = listOf('sources.priority');
    const disabled = listOf('sources.disabled');
    if (!engines && !priority && !disabled)
        return undefined;
    const base = chainInputOf(snapshot);
    try {
        return effectiveChain({ ...base, engines: engines ?? base.engines, priority: priority ?? base.priority, disabled: disabled ?? base.disabled });
    }
    catch {
        return [];
    }
}
/** Everything the warnings badge counts: what the validation says about a field, and the rubric problems. */
export function warningsOf(snapshot, t) {
    const out = [];
    for (const [field, state] of Object.entries(snapshot.fields)) {
        if (field.startsWith('evidence.rubrics.'))
            continue;
        const name = field.startsWith('keyedSources.') || field.startsWith('sources.budget.') ? field : t(labelKey(field));
        if (state.message)
            out.push(name + ': ' + state.message);
        if (state.warning)
            out.push(name + ': ' + state.warning);
    }
    for (const rubric of snapshot.rubrics)
        for (const problem of rubric.problems)
            out.push(rubric.id + ': ' + problem);
    for (const entry of snapshot.server.status?.pendingRestart ?? [])
        out.push(entry.field + ': ' + fill(t('pendingRestartLine'), { running: entry.running || t('pendingEmpty'), configured: entry.configured || t('pendingEmpty') }));
    if (snapshot.unknownRubrics.length)
        out.push(t('rubricUnknown') + ' ' + snapshot.unknownRubrics.join(', '));
    return out;
}
const JUDGE_TONE = { off: 'neutral', shadow: 'info', control: 'warning', hybrid: 'warning' };
export function SummaryBar({ card }) {
    const { t } = card;
    const [open, setOpen] = useState(false);
    const view = card.useWebSearchPro(snapshot => ({
        chain: chainOf(snapshot)?.join(' › ') ?? '',
        keyed: KEYED_DEFS.filter(def => snapshot.credentials[def.credential]?.configured).length,
        common: SOURCE_DEFS.filter(def => def.common).map(def => ({ id: def.id, name: def.name, ready: !!snapshot.credentials[def.credential]?.configured })),
        route: snapshot.fields.registerProvider.text === 'true', surface: snapshot.fields.toolSurface.text || 'indexed',
        judge: snapshot.fields['evidence.judge.mode'].text || 'off',
        pending: snapshot.server.status?.pendingRestart ?? [],
        agent: snapshot.server.overlay.view?.items.length ?? 0,
        warnings: warningsOf(snapshot, t),
    }));
    const chain = view.chain.split(' › ');
    const shown = chain.length > 5 ? [...chain.slice(0, 5), '…'] : chain;
    return _jsxs("div", { className: css.summaryBar, role: "group", "aria-label": t('summaryTitle'), "data-wsp-summary": true, children: [_jsx("strong", { children: t('summaryTitle') }), _jsxs(Badge, { tone: "neutral", children: [t('summaryChain'), " ", view.chain ? shown.join(' › ') : t('summaryChainEmpty')] }), _jsx(Badge, { tone: view.keyed ? 'success' : 'neutral', children: fill(t('summaryKeys'), { n: view.keyed, m: KEYED_DEFS.length }) }), view.common.map(source => _jsxs(Badge, { tone: source.ready ? 'success' : 'warning', children: [source.name, " \u00B7 ", t('commonBadge'), " \u00B7 ", source.ready ? t('summaryReady') : t('summaryNoKey')] }, source.id)), _jsx(Badge, { tone: view.route ? 'info' : 'neutral', children: view.route ? t('summaryRouteOn') : t('summaryRouteOff') }), _jsxs(Badge, { tone: JUDGE_TONE[view.judge] ?? 'neutral', children: [t('summaryJudge'), " ", view.judge] }), _jsxs(Badge, { tone: "neutral", children: [t('summarySurface'), " ", view.surface] }), view.agent ? _jsxs("button", { type: "button", className: css.link, onClick: () => { const node = document.querySelector('[data-wsp-group="agent"]'); if (node) {
                    node.open = true;
                    node.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
                } }, "data-wsp-agent-summary": view.agent, children: [_jsx(Badge, { tone: "warning", children: fill(t('summaryAgent'), { n: view.agent }) }), " \u00B7 ", t('summaryAgentOpen')] }) : null, view.pending.length ? _jsx("span", { "data-wsp-pending-restart": view.pending.map(entry => entry.field).join(','), title: view.pending.map(entry => entry.field + ': ' + fill(t('pendingRestartLine'), { running: entry.running || t('pendingEmpty'), configured: entry.configured || t('pendingEmpty') })).join('\n'), children: _jsxs(Badge, { tone: "warning", children: [fill(t('summaryPendingRestart'), { n: view.pending.length }), ": ", view.pending.map(entry => entry.field).join(', ')] }) }) : null, _jsxs("button", { type: "button", className: css.link, onClick: () => setOpen(true), "data-wsp-warnings-count": view.warnings.length, children: [view.warnings.length ? _jsx(Badge, { tone: "warning", children: fill(t('summaryWarnings'), { n: view.warnings.length }) }) : _jsx("span", { className: css.muted, children: t('summaryNoWarnings') }), " \u00B7 ", t('summaryDetails')] }), _jsx(Dialog, { open: open, title: t('warningsTitle'), closeLabel: t('close'), onClose: () => setOpen(false), footer: _jsx(Btn, { onClick: () => setOpen(false), primary: true, children: t('close') }), children: view.warnings.length === 0 ? _jsx("p", { className: css.rowHint, children: t('warningsNone') }) : _jsx("ul", { "data-wsp-warning-list": true, children: view.warnings.map((warning, index) => _jsx("li", { children: warning }, index)) }) })] });
}
export function SaveBar({ card }) {
    const { t } = card;
    const state = card.useWebSearchPro(snapshot => snapshot);
    const count = state.changes;
    const blocked = !state.dirty || state.invalid || state.saving || !state.writable;
    // The bar floats at the bottom of the window only while there is something to act on (unsaved edits, a save running or failed).
    // Otherwise it sits in the page flow after the last group, so it cannot cover a group heading the user is about to click.
    const floating = state.dirty || state.saving || state.failed;
    return _jsxs("div", { className: css.savebar, role: "region", "aria-label": t('save'), "data-wsp-savebar": true, "data-wsp-floating": floating ? '' : undefined, children: [_jsxs("div", { className: css.saveText, children: [_jsx("span", { "data-wsp-unsaved": count, children: state.invalid ? t('savebarInvalid') : count ? fill(t('savebarDirty'), { n: count }) : t('savebarClean') }), state.restartTouched.length ? _jsx("span", { className: "wsp-bad-soft", role: "note", "data-wsp-restart-note": state.restartTouched.join(','), children: fill(t('savebarRestart'), { fields: state.restartTouched.join(', ') }) }) : null, state.failed ? _jsx("span", { className: "wsp-bad", role: "status", children: t('saveFailed') }) : null] }), _jsxs("div", { className: css.actions, children: [_jsx(Btn, { onClick: card.discard, disabled: !state.dirty || state.saving, data: "discard", children: t('discardChanges') }), _jsx(Btn, { primary: true, onClick: card.save, disabled: blocked, data: "save", children: state.saving ? t('saving') : t('save') })] })] });
}
/** The page frame: nothing but a notice while the settings are not served; the staged edits are dropped when the page is left. */
export function Frame({ card, children }) {
    const { t } = card;
    const state = card.useWebSearchPro(snapshot => ({ available: snapshot.available, writable: snapshot.writable }));
    const discard = useRef(card.discard);
    discard.current = card.discard;
    useEffect(() => () => { discard.current(); }, []);
    if (!state.available)
        return _jsx("p", { className: css.notice, role: "status", children: t('unavailable') });
    return _jsxs("div", { className: css.root, "data-wsp-root": true, "data-web-search-pro-settings": true, children: [!state.writable ? _jsx("p", { className: css.notice, role: "status", children: t('readOnly') }) : null, children] });
}
//# sourceMappingURL=card-frame.js.map