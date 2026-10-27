import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * "Advanced: text mode": the settings as one commented YAML text, to read or copy. It is a view of the controls (it prints
 * the staged state, secrets excluded), not a second place the settings live. Every key has a comment in front of it.
 * @module web-search-pro/client/group-advanced
 */
import { useState } from 'react';
import { ALL_SPECS, dynamicSpecsOf } from "./form.js";
import { fill, useOverriddenCount } from "./field-rows.js";
import { JsonList, jsonFieldsOf } from "./json-list.js";
import { renderTextView } from "./text-view.js";
import { styles as css } from "./styles.js";
import { Badge, Btn, Fold, Group } from "./ui-kit.js";
export function AdvancedGroup({ card }) {
    const { t } = card;
    const fields = card.useWebSearchPro(snapshot => snapshot.fields);
    const [copied, setCopied] = useState(false);
    const text = renderTextView(fields, [...ALL_SPECS, ...dynamicSpecsOf(fields)], t('lang'));
    const id = 'web-search-pro-text-view';
    const n = useOverriddenCount(card, jsonFieldsOf('advanced'));
    return _jsxs(Group, { id: "advanced", title: t('groupAdvanced'), summary: t('groupAdvancedSub'), badges: n ? _jsx(Badge, { tone: "info", children: fill(t('overriddenCount'), { n }) }) : null, children: [_jsxs("div", { className: css.stack, "data-wsp-text-view": true, children: [_jsx("p", { className: css.rowHint, children: t('textViewHint') }), _jsx("textarea", { id: id, className: `${css.input} ${css.textarea} ${css.code}`, rows: 26, readOnly: true, spellCheck: false, "aria-label": t('textViewTitle'), value: text, onFocus: event => event.currentTarget.select() }), _jsx("div", { children: _jsx(Btn, { onClick: () => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => undefined); }, data: "text-copy", children: copied ? t('textViewCopied') : t('textViewCopy') }) }), _jsx("p", { className: css.notice, role: "note", children: t('textViewNote') })] }), _jsx(Fold, { id: "raw-json", title: t('advancedRawTitle'), hint: t('advancedRawHint'), children: _jsx(JsonList, { card: card, fields: jsonFieldsOf('advanced') }) })] });
}
//# sourceMappingURL=group-advanced.js.map