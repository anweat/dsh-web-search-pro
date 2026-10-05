import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { styles as css } from "./styles.js";
function FieldShell(props) {
    return (_jsxs("div", { className: `${css.field} ${props.state?.invalid ? css.fieldInvalid : ''}`, children: [_jsxs("div", { className: css.fieldHeading, children: [_jsx("label", { className: css.label, htmlFor: props.id, children: props.label }), props.field && props.state?.overridden ? (_jsx("button", { type: "button", className: css.reset, disabled: props.disabled, onClick: () => { props.onReset?.(props.field); }, children: props.resetLabel })) : null] }), props.children, props.state?.message ? _jsx("p", { className: css.problem, role: "alert", "data-web-search-pro-problem": true, children: props.state.message }) : null, _jsx("p", { className: css.hint, children: props.state?.invalid && !props.state.message ? props.invalidLabel : props.hint }), props.state?.warning ? _jsx("p", { className: css.warning, role: "note", "data-web-search-pro-warning": true, children: props.state.warning }) : null] }));
}
export function TextField(props) {
    const id = `web-search-pro-${props.field}`;
    return (_jsx(FieldShell, { id: id, label: props.label, hint: props.hint, field: props.field, state: props.state, disabled: props.disabled, resetLabel: props.t('reset'), invalidLabel: props.t('invalid'), onReset: props.reset, children: _jsx("input", { id: id, className: css.input, type: props.type ?? 'text', inputMode: props.type === 'number' ? 'decimal' : undefined, value: props.state.text, placeholder: props.placeholder, disabled: props.disabled, "aria-invalid": props.state.invalid || undefined, onChange: event => { props.edit(props.field, event.currentTarget.value); } }) }));
}
export function JsonField(props) {
    const id = `web-search-pro-${props.field}`;
    return (_jsx(FieldShell, { id: id, label: props.label, hint: props.hint, field: props.field, state: props.state, disabled: props.disabled, resetLabel: props.t('reset'), invalidLabel: props.t('invalidJson'), onReset: props.reset, children: _jsx("textarea", { id: id, className: `${css.input} ${css.textarea} ${css.code}`, rows: props.rows ?? 5, value: props.state.text, disabled: props.disabled, spellCheck: false, "aria-invalid": props.state.invalid || undefined, onChange: event => { props.edit(props.field, event.currentTarget.value); } }) }));
}
export function SelectField(props) {
    const id = `web-search-pro-${props.field}`;
    // A stored value no option names (a provider id of a settings file the draft no longer defines) stays selectable, so it is never lost silently.
    const known = props.options.some(option => option.value === props.state.text);
    return (_jsx(FieldShell, { id: id, label: props.label, hint: props.hint, field: props.field, state: props.state, disabled: props.disabled, resetLabel: props.t('reset'), invalidLabel: props.t('invalid'), onReset: props.reset, children: _jsxs("select", { id: id, className: `${css.input} ${css.select}`, value: props.state.text, disabled: props.disabled, "aria-invalid": props.state.invalid || undefined, onChange: event => { props.edit(props.field, event.currentTarget.value); }, children: [props.emptyLabel !== undefined ? _jsx("option", { value: "", children: props.emptyLabel }) : null, !known && props.state.text !== '' ? _jsx("option", { value: props.state.text, children: props.state.text }) : null, props.options.map(option => _jsx("option", { value: option.value, children: option.label }, option.value))] }) }));
}
export function ToggleField(props) {
    const checked = props.state.text === 'true';
    return (_jsxs("div", { className: css.toggleField, children: [_jsxs("label", { className: css.toggleLabel, children: [_jsx("input", { id: `web-search-pro-${props.field}`, className: css.checkbox, type: "checkbox", checked: checked, disabled: props.disabled, onChange: event => { props.edit(props.field, String(event.currentTarget.checked)); } }), _jsxs("span", { className: css.toggleCopy, children: [_jsx("span", { className: css.label, children: props.label }), _jsx("span", { className: css.hint, children: props.hint }), props.state.message ? _jsx("span", { className: css.problem, role: "alert", children: props.state.message }) : null, props.state.warning ? _jsx("span", { className: css.warning, role: "note", children: props.state.warning }) : null] })] }), props.state.overridden ? (_jsx("button", { type: "button", className: css.reset, disabled: props.disabled, onClick: () => { props.reset(props.field); }, children: props.t('reset') })) : null] }));
}
export function CredentialField(props) {
    const inputId = `web-search-pro-credential-${props.id}`;
    const status = props.state.loading
        ? props.t('credentialChecking')
        : props.state.configured ? props.t('credentialSet') : props.t('credentialUnset');
    return (_jsx(FieldShell, { id: inputId, label: props.label, hint: props.hint, disabled: props.disabled || !props.state.writable, resetLabel: props.t('reset'), invalidLabel: props.t('invalid'), children: _jsxs("div", { className: css.secretRow, children: [_jsx("input", { id: inputId, className: css.input, type: "password", autoComplete: "new-password", value: props.state.text, placeholder: status, disabled: props.disabled || !props.state.writable, onChange: event => { props.edit(props.id, event.currentTarget.value); } }), _jsx("span", { className: css.credentialStatus, "data-configured": props.state.configured ? 'true' : undefined, children: status })] }) }));
}
//# sourceMappingURL=fields.js.map