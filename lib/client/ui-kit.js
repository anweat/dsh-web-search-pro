import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The small set of controls the settings card is made of.
 *
 * Switches, buttons, badges, dialogs and the click-to-read help bubble are the Host's own
 * (`@deepseek-ai/dsh-client-ui-primitives`). The Host ships no select, no chip input, no accordion and no
 * list-row, so those four are built here from native elements (`<select>`, `<details>`, `<input>`) and the
 * `--dsw-alias-*` tokens, which makes them follow the light and dark themes without a color of their own.
 * Nothing in this file knows about a configuration field: callers pass text and callbacks.
 * @module web-search-pro/client/ui-kit
 */
import { useState } from 'react';
import { Button, Modal, Switch, Tag, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import { styles as css } from "./styles.js";
/** A read-only badge. */
export function Badge(props) {
    return _jsx(Tag, { tone: props.tone ?? 'neutral', children: props.children });
}
/** The `?` button: its text opens on click, so a long explanation costs one glyph until someone asks. */
export function Help(props) {
    return _jsx(Tooltip, { label: props.text, openOnClick: true, portal: true, maxWidth: 360, side: "top", children: _jsx("button", { type: "button", className: css.help, "aria-label": props.label, "data-wsp-help": true, children: "?" }) });
}
/** One setting: label, one-line hint, an optional `?`, the "overridden" badge with its reset, and the control. */
export function Row(props) {
    const { labels } = props;
    return _jsxs("div", { className: `${css.row} ${props.wide ? 'wsp-row-wide' : ''}`, "data-wsp-field": props.field, "data-wsp-overridden": props.overridden ? 'true' : undefined, children: [_jsxs("div", { className: css.rowText, children: [_jsxs("div", { className: css.rowLabel, children: [props.id ? _jsx("label", { htmlFor: props.id, children: props.label }) : _jsx("span", { children: props.label }), props.help ? _jsx(Help, { label: labels.help, text: props.help }) : null, props.risk ? _jsx(Badge, { tone: "warning", children: props.risk }) : null, props.overridden ? _jsx(Badge, { tone: "info", children: labels.overridden }) : null, props.overridden && props.onReset ? _jsx("button", { type: "button", className: css.link, disabled: props.disabled, onClick: props.onReset, "data-wsp-reset": props.field, children: labels.reset }) : null] }), props.invalid && props.problem
                        ? _jsx("p", { className: `${css.rowHint} wsp-bad`, role: "alert", children: props.problem })
                        : props.hint || props.meta ? _jsxs("p", { className: css.rowHint, children: [props.hint, props.meta ? _jsxs("span", { className: css.rowMeta, children: [props.hint ? ' · ' : '', props.meta] }) : null] }) : null, props.warning ? _jsxs("p", { className: css.rowHint, role: "note", "data-wsp-warning": true, children: ["! ", props.warning] }) : null] }), _jsx("div", { className: `${css.rowControl} ${props.inline ? 'wsp-inline' : ''}`, children: props.children })] });
}
/** A closed-by-default fold inside a group, for the items few people need. */
export function Fold(props) {
    return _jsxs("details", { className: css.fold, "data-wsp-fold": props.id, children: [_jsxs("summary", { children: [props.title, props.hint ? _jsxs("span", { className: css.foldHint, children: [" \u00B7 ", props.hint] }) : null] }), _jsx("div", { className: css.foldBody, children: props.children })] });
}
/** A small heading inside a group, for sets of rows that belong together. */
export function SubHead(props) {
    return _jsx("div", { className: css.subHead, role: "presentation", children: props.children });
}
/**
 * One group of the card, an accordion item. `<details>` keeps every control in the document while the group is
 * closed (so a server-rendered check still sees them) and gives keyboard and screen-reader behavior for free.
 */
export function Group(props) {
    return _jsxs("details", { className: css.group, open: props.defaultOpen ? true : undefined, "data-wsp-group": props.id, children: [_jsxs("summary", { className: css.groupHead, children: [_jsxs("span", { className: css.groupTitle, children: [_jsx("strong", { children: props.title }), props.summary ? _jsx("span", { className: css.groupSub, children: props.summary }) : null] }), props.badges ? _jsx("span", { className: css.groupBadges, children: props.badges }) : null] }), _jsx("div", { className: css.groupBody, children: props.children })] });
}
/**
 * A native select. A stored value that is not among the options (a channel the list does not know, an older
 * enum value) is shown as its own entry instead of being silently replaced by the first option.
 */
export function Select(props) {
    const known = props.options.some(option => option.value === props.value);
    const options = known || props.value === '' ? props.options : [{ value: props.value, label: props.value }, ...props.options];
    return _jsx("select", { id: props.id, className: `${css.select} ${props.muted ? css.muted : ''}`, value: props.value, disabled: props.disabled, "aria-label": props.ariaLabel, "aria-invalid": props.invalid || undefined, onChange: event => props.onChange(event.currentTarget.value), children: options.map(option => _jsx("option", { value: option.value, children: option.label }, option.value)) });
}
/** A single-line text input; `muted` greys the value while it is only the inherited default. */
export function TextInput(props) {
    return _jsx("input", { id: props.id, type: "text", className: `${css.input} ${props.muted ? css.muted : ''} ${props.invalid ? css.invalidInput : ''} ${props.code ? css.code : ''} ${props.numeric ? 'wsp-num' : ''} ${props.small ? 'wsp-sm' : ''}`, value: props.value, placeholder: props.placeholder, disabled: props.disabled, list: props.list, inputMode: props.numeric ? 'numeric' : undefined, spellCheck: false, "aria-label": props.ariaLabel, "aria-invalid": props.invalid || undefined, onChange: event => props.onChange(event.currentTarget.value) });
}
/** A text input followed by a fixed unit. */
export function UnitInput(props) {
    return _jsxs("span", { className: css.unitInput, children: [_jsx(TextInput, { id: props.id, value: props.value, onChange: props.onChange, placeholder: props.placeholder, disabled: props.disabled, muted: props.muted, invalid: props.invalid, numeric: true, ariaLabel: props.ariaLabel }), _jsx("span", { className: css.unit, children: props.unit })] });
}
/** The Host's switch, named by its row. */
export function Toggle(props) {
    return _jsx(Switch, { label: props.label, checked: props.checked, disabled: props.disabled, onChange: props.onChange });
}
/** A list of short strings as removable chips with an add box (Enter or comma adds; Backspace on an empty box removes the last). */
export function Chips(props) {
    const [draft, setDraft] = useState('');
    const [problem, setProblem] = useState();
    const commit = (raw) => {
        const value = raw.trim();
        if (value === '') {
            setDraft('');
            setProblem(undefined);
            return;
        }
        const refused = props.check?.(value, props.values);
        if (refused) {
            setProblem(refused);
            return;
        }
        if (!props.values.includes(value))
            props.onChange([...props.values, value]);
        setDraft('');
        setProblem(undefined);
    };
    return _jsxs("div", { className: css.stack, children: [_jsxs("div", { className: css.chips, "data-wsp-chips": true, children: [props.values.map(value => _jsxs("span", { className: css.chip, children: [_jsx("span", { children: value }), _jsx("button", { type: "button", className: css.chipRemove, disabled: props.disabled, "aria-label": `${props.removeLabel}: ${value}`, onClick: () => props.onChange(props.values.filter(entry => entry !== value)), children: "\u00D7" })] }, value)), _jsx("input", { id: props.id, className: css.chipInput, value: draft, placeholder: props.placeholder, disabled: props.disabled, "aria-label": props.addLabel, spellCheck: false, onChange: event => { const text = event.currentTarget.value; if (text.endsWith(','))
                            commit(text.slice(0, -1));
                        else
                            setDraft(text); }, onBlur: () => { if (draft.trim() !== '')
                            commit(draft); }, onKeyDown: event => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                commit(draft);
                            }
                            else if (event.key === 'Backspace' && draft === '' && props.values.length)
                                props.onChange(props.values.slice(0, -1));
                        } })] }), problem ? _jsx("p", { className: `${css.rowHint} wsp-bad`, role: "alert", children: problem }) : null] });
}
/** A dialog on the Host's modal: a title, a scrolling body, and a footer of actions. */
export function Dialog(props) {
    return _jsx(Modal, { open: props.open, onClose: props.onClose, title: props.title, closeLabel: props.closeLabel, description: props.description, footer: props.footer, className: `wsp-modal ${props.wide ? 'wsp-modal-wide' : ''}`, contentClassName: "wsp-modal-content", children: _jsx("div", { className: css.dialogBody, children: props.children }) });
}
/** Primary and secondary buttons at the card's size. */
export function Btn(props) {
    return _jsx(Button, { type: "button", variant: props.primary ? 'primary' : 'outline', size: "sm", disabled: props.disabled, title: props.title, "aria-label": props.ariaLabel, className: props.danger ? css.danger : undefined, onClick: props.onClick, "data-wsp-action": props.data, children: props.children });
}
/** A list row: a title with badges, a meta line, and actions on the right. */
export function Item(props) {
    return _jsxs("div", { className: css.item, "data-wsp-item": props.data, children: [_jsxs("div", { className: css.itemMain, children: [_jsxs("div", { className: css.itemTitle, children: [props.title, props.badges] }), props.meta ? _jsx("div", { className: css.itemMeta, children: props.meta }) : null] }), props.actions ? _jsx("div", { className: css.itemActions, children: props.actions }) : null] });
}
/** A write-only secret input: it never shows a stored value, only whether one is configured. */
export function SecretInput(props) {
    return _jsxs("span", { className: css.secretRow, children: [_jsx("input", { id: props.id, type: "password", className: css.input, autoComplete: "new-password", value: props.value, placeholder: props.status, disabled: props.disabled, spellCheck: false, "aria-label": props.ariaLabel, onChange: event => props.onChange(event.currentTarget.value) }), _jsx(Badge, { tone: props.configured ? 'success' : 'neutral', children: props.status })] });
}
//# sourceMappingURL=ui-kit.js.map