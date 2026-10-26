import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * "Advanced: text mode": the settings as one commented YAML text, to read or copy. It is a view of the controls (it prints
 * the staged state, secrets excluded), not a second place the settings live. Every key has a comment in front of it.
 * @module web-search-pro/client/group-advanced
 */
import { useState } from 'react';
import { ALL_SPECS } from "./form.js";
import { renderTextView } from "./text-view.js";
import { styles as css } from "./styles.js";
import { Btn, Group } from "./ui-kit.js";
export function AdvancedGroup({ card }) {
    const { t } = card;
    const fields = card.useWebSearchPro(snapshot => snapshot.fields);
    const [copied, setCopied] = useState(false);
    const text = renderTextView(fields, ALL_SPECS, t('lang'));
    const id = 'web-search-pro-text-view';
    return _jsx(Group, { id: "advanced", title: t('groupAdvanced'), summary: t('groupAdvancedSub'), children: _jsxs("div", { className: css.stack, "data-wsp-text-view": true, children: [_jsx("p", { className: css.rowHint, children: t('textViewHint') }), _jsx("textarea", { id: id, className: `${css.input} ${css.textarea} ${css.code}`, rows: 26, readOnly: true, spellCheck: false, "aria-label": t('textViewTitle'), value: text, onFocus: event => event.currentTarget.select() }), _jsx("div", { children: _jsx(Btn, { onClick: () => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => undefined); }, data: "text-copy", children: copied ? t('textViewCopied') : t('textViewCopy') }) }), _jsx("p", { className: css.notice, role: "note", children: t('textViewNote') })] }) });
}
//# sourceMappingURL=group-advanced.js.map