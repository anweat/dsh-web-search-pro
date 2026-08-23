import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { styles as css } from "./styles.js";
function FieldShell(props) {
    return (_jsxs("div", { className: `${css.field} ${props.state?.invalid ? css.fieldInvalid : ''}`, children: [_jsxs("div", { className: css.fieldHeading, children: [_jsx("label", { className: css.label, htmlFor: props.id, children: props.label }), props.field && props.state?.overridden ? (_jsx("button", { type: "button", className: css.reset, disabled: props.disabled, onClick: () => { props.onReset?.(props.field); }, children: props.resetLabel })) : null] }), props.children, _jsx("p", { className: css.hint, children: props.state?.invalid ? props.invalidLabel : props.hint })] }));
}
export function TextField(props) {
    const id = `web-search-pro-${props.field}`;
    return (_jsx(FieldShell, { id: id, label: props.label, hint: props.hint, field: props.field, state: props.state, disabled: props.disabled, resetLabel: props.t('reset'), invalidLabel: props.t('invalid'), onReset: props.reset, children: _jsx("input", { id: id, className: css.input, type: props.type ?? 'text', inputMode: props.type === 'number' ? 'decimal' : undefined, value: props.state.text, disabled: props.disabled, "aria-invalid": props.state.invalid || undefined, onChange: event => { props.edit(props.field, event.currentTarget.value); } }) }));
}
export function JsonField(props) {
    const id = `web-search-pro-${props.field}`;
    return (_jsx(FieldShell, { id: id, label: props.label, hint: props.hint, field: props.field, state: props.state, disabled: props.disabled, resetLabel: props.t('reset'), invalidLabel: props.t('invalidJson'), onReset: props.reset, children: _jsx("textarea", { id: id, className: `${css.input} ${css.textarea} ${css.code}`, rows: props.rows ?? 5, value: props.state.text, disabled: props.disabled, spellCheck: false, "aria-invalid": props.state.invalid || undefined, onChange: event => { props.edit(props.field, event.currentTarget.value); } }) }));
}
export function ToggleField(props) {
    const checked = props.state.text === 'true';
    return (_jsxs("div", { className: css.toggleField, children: [_jsxs("label", { className: css.toggleLabel, children: [_jsx("input", { className: css.checkbox, type: "checkbox", checked: checked, disabled: props.disabled, onChange: event => { props.edit(props.field, String(event.currentTarget.checked)); } }), _jsxs("span", { className: css.toggleCopy, children: [_jsx("span", { className: css.label, children: props.label }), _jsx("span", { className: css.hint, children: props.hint })] })] }), props.state.overridden ? (_jsx("button", { type: "button", className: css.reset, disabled: props.disabled, onClick: () => { props.reset(props.field); }, children: props.t('reset') })) : null] }));
}
export function CredentialField(props) {
    const inputId = `web-search-pro-credential-${props.id}`;
    const status = props.state.loading
        ? props.t('credentialChecking')
        : props.state.configured ? props.t('credentialSet') : props.t('credentialUnset');
    return (_jsx(FieldShell, { id: inputId, label: props.label, hint: props.hint, disabled: props.disabled || !props.state.writable, resetLabel: props.t('reset'), invalidLabel: props.t('invalid'), children: _jsxs("div", { className: css.secretRow, children: [_jsx("input", { id: inputId, className: css.input, type: "password", autoComplete: "new-password", value: props.state.text, placeholder: status, disabled: props.disabled || !props.state.writable, onChange: event => { props.edit(props.id, event.currentTarget.value); } }), _jsx("span", { className: css.credentialStatus, "data-configured": props.state.configured ? 'true' : undefined, children: status })] }) }));
}
//# sourceMappingURL=fields.js.map