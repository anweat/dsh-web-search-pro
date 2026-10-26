import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * "Sources": how sources are ranked (policy, priority, disabled) and a list of the sources that need a key or an address: a
 * row per source (name, tier, whether its key is set, and the "常用" mark), and one edit dialog per source holding its key
 * reference, write-only key, endpoint and request budget. The anonymous sources are a folded reference table. Edits stage into
 * the same draft the sticky save bar writes; a dialog has no save button of its own.
 * @module web-search-pro/client/group-sources
 */
import { useState } from 'react';
import { fill, rowLabels, useOverriddenCount, ListRow, NumberRow, SelectRow, SwitchRow, TextRow } from "./field-rows.js";
import { SOURCE_DEFS, sourceFields } from "./field-keys.js";
import { ANONYMOUS_SOURCES } from "./sources-table.js";
import { styles as css } from "./styles.js";
import { Badge, Btn, Dialog, Fold, Group, Item, Row, SecretInput, SubHead } from "./ui-kit.js";
/** The write-only key of a source. It shows whether a key is stored, never the key. */
export function SecretRow({ card, id, label }) {
    const { t } = card;
    const cred = card.useWebSearchPro(snapshot => snapshot.credentials[id]);
    const disabled = card.useWebSearchPro(snapshot => !snapshot.writable || snapshot.saving);
    const status = cred.loading ? t('credentialChecking') : cred.configured ? t('credentialSet') : t('credentialUnset');
    const inputId = `web-search-pro-credential-${id}`;
    return _jsx("div", { "data-wsp-credential": id, children: _jsx(Row, { id: inputId, label: label, hint: cred.writable ? t('credentialWriteOnlyHint') : t('credentialReadOnlyHint'), labels: rowLabels(t), children: _jsx(SecretInput, { id: inputId, value: cred.text, onChange: text => card.editCredential(id, text), status: status, configured: cred.configured, disabled: disabled || !cred.writable, ariaLabel: label }) }) });
}
/** Whether a source is usable as far as the card can tell: its key is stored, or (SearXNG) its address is set. */
export function useSourceReady(card, def) {
    return card.useWebSearchPro(snapshot => {
        if (def.credential) {
            const cred = snapshot.credentials[def.credential];
            return { ready: cred.configured, loading: cred.loading };
        }
        return { ready: (snapshot.fields.searxngUrl?.text ?? '') !== '', loading: false };
    });
}
const NOTE_KEYS = {
    deepseek: 'sourceNoteDeepseek', bocha: 'sourceNoteBocha', exa: 'sourceNoteExa', jina: 'sourceNoteJina', github: 'sourceNoteGithub', searxng: 'sourceNoteSearxng',
};
/** The controls of one source: reference name, write-only key, endpoint, extras and request budget. */
export function SourceForm({ card, def }) {
    const { t } = card;
    const keyedFields = def.id === 'bocha' || def.id === 'exa' || def.id === 'jina' || def.id === 'github';
    return _jsxs(_Fragment, { children: [def.envField ? _jsx(TextRow, { card: card, field: def.envField, placeholder: def.defaultEnv, code: true, hint: `${t('keyedEnvHint')} ${def.defaultEnv}`, label: keyedFields ? t(def.envField) : t('keyedEnv') }) : null, def.credential ? _jsx(SecretRow, { card: card, id: def.credential, label: t('keyedApiKey') }) : null, def.baseUrlField ? _jsx(TextRow, { card: card, field: def.baseUrlField, code: true, placeholder: def.id === 'bocha' ? 'https://api.bocha.cn' : def.id === 'deepseek' ? 'https://api.deepseek.com/v1/tools' : '', label: t(def.baseUrlField === 'bochaBaseUrl' ? 'bochaBaseUrl' : 'keyedBaseUrl'), hint: def.baseUrlField === 'bochaBaseUrl' ? t('bochaBaseUrlHint') : t('keyedBaseUrlHint') }) : null, def.extra?.map(field => field === 'bochaSummary' ? _jsx(SwitchRow, { card: card, field: field }, field)
                : _jsx(TextRow, { card: card, field: field, code: true, placeholder: "http://127.0.0.1:8080" }, field)), def.budget ? _jsxs(_Fragment, { children: [_jsx(SubHead, { children: t('reqBudgetGroup') }), _jsx("p", { className: css.rowHint, children: t('reqBudgetNote') }), _jsx(NumberRow, { card: card, field: `sources.budget.${def.id}.total`, unit: "count" }), _jsx(NumberRow, { card: card, field: `sources.budget.${def.id}.daily`, unit: "count" })] }) : null] });
}
/** One source's edit dialog. */
export function SourceDialog({ card, def, onClose }) {
    const { t } = card;
    const fields = sourceFields(def);
    const overridden = card.useWebSearchPro(snapshot => fields.filter(field => snapshot.fields[field]?.overridden));
    const disabled = card.useWebSearchPro(snapshot => !snapshot.writable || snapshot.saving);
    const note = NOTE_KEYS[def.id];
    return _jsxs(Dialog, { open: true, wide: false, title: fill(t('sourceDialogTitle'), { name: def.name }), closeLabel: t('close'), description: t((note ?? 'sourceNoteKeyed')), onClose: onClose, footer: _jsxs(_Fragment, { children: [_jsx(Btn, { disabled: disabled || overridden.length === 0, onClick: () => { for (const field of overridden)
                        card.resetField(field); }, data: "source-reset", children: t('sourceResetAll') }), _jsx(Btn, { primary: true, onClick: onClose, data: "source-done", children: t('done') })] }), children: [_jsx("p", { className: css.rowHint, children: t('dialogStagesNote') }), _jsx(SourceForm, { card: card, def: def })] });
}
const TIER_KEYS = { paid: 'tierPaid', 'free-quota': 'tierFree', anonymous: 'tierAnonymous' };
/** One row of the sources list. */
export function SourceItem({ card, def, onEdit }) {
    const { t } = card;
    const { ready, loading } = useSourceReady(card, def);
    const disabled = card.useWebSearchPro(snapshot => !snapshot.writable);
    const view = card.useWebSearchPro(snapshot => ({
        ref: def.envField ? (snapshot.fields[def.envField]?.text || def.defaultEnv || '') : '',
        url: def.id === 'searxng' ? snapshot.fields.searxngUrl.text : '',
        capped: def.budget ? ['total', 'daily'].some(axis => snapshot.fields[`sources.budget.${def.id}.${axis}`]?.text) : false,
    }));
    const meta = def.id === 'searxng' ? (view.url || t('sourceMetaNoUrl')) : [view.ref ? fill(t('sourceMetaRef'), { ref: view.ref }) : '', view.capped ? t('sourceMetaCapped') : ''].filter(Boolean).join(' · ');
    return _jsx(Item, { data: def.id, title: _jsx("strong", { children: def.name }), badges: _jsxs(_Fragment, { children: [def.common ? _jsx(Badge, { tone: "info", children: t('commonBadge') }) : null, _jsx(Badge, { tone: def.tier === 'paid' ? 'warning' : 'outline', children: t(TIER_KEYS[def.tier]) }), _jsx(Badge, { tone: ready ? 'success' : 'neutral', children: loading ? t('credentialChecking') : ready ? (def.credential ? t('credentialSet') : t('sourceConfigured')) : (def.credential ? t('credentialUnset') : t('sourceNotConfigured')) })] }), meta: meta, actions: _jsx(Btn, { disabled: disabled, onClick: onEdit, data: "source-edit", children: t('edit') }) });
}
/** Open dialog state shared by the Common and Sources groups: one source at a time. */
export function SourceList({ card, only }) {
    const [editing, setEditing] = useState();
    const defs = SOURCE_DEFS.filter(def => !only || only.includes(def.id));
    const def = SOURCE_DEFS.find(entry => entry.id === editing);
    return _jsxs(_Fragment, { children: [_jsx("div", { className: css.list, "data-wsp-source-list": true, children: defs.map(entry => _jsx(SourceItem, { card: card, def: entry, onEdit: () => setEditing(entry.id) }, entry.id)) }), def ? _jsx(SourceDialog, { card: card, def: def, onClose: () => setEditing(undefined) }, def.id) : null] });
}
const FIELD_NAMES = [
    'evidence.sourcePolicy', 'sources.priority', 'sources.disabled', 'openalexMailto',
];
export function SourcesGroup({ card }) {
    const { t } = card;
    const count = useOverriddenCount(card, [...FIELD_NAMES, ...SOURCE_DEFS.flatMap(sourceFields)]);
    return _jsxs(Group, { id: "sources", title: t('groupSources'), summary: t('groupSourcesSub'), badges: count ? _jsx(Badge, { tone: "info", children: fill(t('overriddenCount'), { n: count }) }) : null, children: [_jsx(SubHead, { children: t('strategyGroup') }), _jsx("p", { className: css.rowHint, "data-wsp-strategy": true, children: t('strategyNote') }), _jsx(SelectRow, { card: card, field: "evidence.sourcePolicy", options: [{ value: 'default', label: t('optPolicyDefault') }, { value: 'anonymous-only', label: t('optPolicyAnonymousOnly') }] }), _jsx(ListRow, { card: card, field: "sources.priority", placeholder: "deepseek, exa" }), _jsx(ListRow, { card: card, field: "sources.disabled", placeholder: "bing" }), _jsx(SubHead, { children: t('sourcesListTitle') }), _jsx("p", { className: css.rowHint, children: t('sourcesListHint') }), _jsx(SourceList, { card: card }), _jsxs(Fold, { id: "anonymous", title: t('anonymousTitle'), hint: t('anonymousHint'), children: [_jsxs("table", { className: css.table, "data-wsp-anonymous": true, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: t('anonymousName') }), _jsx("th", { scope: "col", children: "id" }), _jsx("th", { scope: "col", children: t('anonymousUse') })] }) }), _jsx("tbody", { children: ANONYMOUS_SOURCES.map(source => _jsxs("tr", { children: [_jsx("td", { children: source.name }), _jsx("td", { children: _jsx("code", { children: source.id }) }), _jsx("td", { children: t(source.use) })] }, source.id)) })] }), _jsx(TextRow, { card: card, field: "openalexMailto" }), _jsx("p", { className: css.rowHint, "data-wsp-status-line": true, children: t('sourcesStatusLine') })] })] });
}
//# sourceMappingURL=group-sources.js.map