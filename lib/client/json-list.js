import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The settings that are whole JSON objects (custom providers, platform backend chains, CLI adapters, custom platforms, ...) as a
 * list: a row each (name, how many entries it holds, "default" while it is empty) and one dialog with a code box and the
 * server's own validation message. Nothing here is a second place the data lives: the box edits the same staged field.
 * @module web-search-pro/client/json-list
 */
import { useState } from 'react';
import { fill, rowLabels, stateOf, useField } from "./field-rows.js";
import { hasHelp, JSON_FIELDS, labelKey } from "./field-keys.js";
import { styles as css } from "./styles.js";
import { Badge, Btn, Dialog, Help, Item, Row } from "./ui-kit.js";
/** How many entries a JSON object text holds; undefined when it is not an object. */
export function entryCount(text) {
    if (text.trim() === '')
        return 0;
    try {
        const value = JSON.parse(text);
        return value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : undefined;
    }
    catch {
        return undefined;
    }
}
/** The code box of one JSON field. */
export function JsonForm({ card, field }) {
    const { t } = card;
    const f = useField(card, field);
    const key = labelKey(field);
    const id = `web-search-pro-${field}`;
    const st = f.state;
    return _jsx(Row, { field: field, id: id, label: t(key), hint: t(`${key}Hint`), help: hasHelp(field) ? t(`${key}Help`) : undefined, overridden: st.overridden, invalid: st.invalid || !!st.message, problem: st.message ?? t('invalidJson'), warning: st.warning, disabled: f.disabled, labels: rowLabels(t), onReset: f.reset, wide: true, children: _jsx("textarea", { id: id, className: `${css.input} ${css.textarea} ${css.code} ${st.invalid ? css.invalidInput : ''}`, rows: 12, spellCheck: false, value: st.text, disabled: f.disabled, "aria-invalid": st.invalid || undefined, onChange: event => f.edit(event.currentTarget.value) }) });
}
function JsonItem({ card, field, onEdit }) {
    const { t } = card;
    const st = card.useWebSearchPro(snapshot => stateOf(snapshot, field));
    const disabled = card.useWebSearchPro(snapshot => !snapshot.writable);
    const n = entryCount(st.text);
    const key = labelKey(field);
    return _jsx(Item, { data: field, title: t(key), badges: _jsxs(_Fragment, { children: [_jsx(Badge, { tone: st.invalid ? 'danger' : st.overridden ? 'info' : 'outline', children: st.invalid ? t('invalid') : st.overridden ? t('overridden') : t('promptStateDefault') }), n ? _jsx(Badge, { tone: "neutral", children: fill(t('jsonEntries'), { n }) }) : null, field === 'playwright' ? _jsxs("span", { className: "wsp-restart", "data-wsp-restart": "playwright.snapshotDir", children: [_jsx(Badge, { tone: "outline", children: t('restartBadgeSnapshot') }), _jsx(Help, { label: t('helpLabel'), text: t('restartWhyPlaywright') })] }) : null] }), meta: t(`${key}Hint`), actions: _jsx(Btn, { disabled: disabled, onClick: onEdit, data: "json-edit", children: t('edit') }) });
}
/** A list of JSON-object settings with its dialog. `fields` names which ones (see JSON_FIELDS). */
export function JsonList({ card, fields }) {
    const { t } = card;
    const [editing, setEditing] = useState();
    return _jsxs(_Fragment, { children: [_jsx("div", { className: css.list, "data-wsp-json-list": true, children: fields.map(field => _jsx(JsonItem, { card: card, field: field, onEdit: () => setEditing(field) }, field)) }), editing ? _jsx(Dialog, { open: true, wide: true, title: fill(t('jsonDialogTitle'), { name: t(labelKey(editing)) }), closeLabel: t('close'), description: t('jsonDialogHint'), onClose: () => setEditing(undefined), footer: _jsx(Btn, { primary: true, onClick: () => setEditing(undefined), data: "json-done", children: t('done') }), children: _jsx(JsonForm, { card: card, field: editing }) }) : null] });
}
/** The fields of one group of JSON settings. */
export const jsonFieldsOf = (group) => JSON_FIELDS.filter(entry => entry.group === group).map(entry => entry.field);
//# sourceMappingURL=json-list.js.map