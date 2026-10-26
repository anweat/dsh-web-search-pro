import { jsx as _jsx } from "react/jsx-runtime";
import { hasHelp, labelKey } from "./field-keys.js";
import { Chips, Row, Select, TextInput, Toggle, UnitInput } from "./ui-kit.js";
/** Fill `{name}` placeholders of a dictionary entry. */
export const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? ''));
export function rowLabels(t) {
    return { overridden: t('overridden'), reset: t('reset'), help: t('helpLabel'), invalid: t('invalid') };
}
/** The id of a field's control, tied to its label. */
export const controlId = (field) => `web-search-pro-${field}`;
/** The units a number field is written with. */
const UNIT_KEYS = { ms: 'unitMs', sec: 'unitSeconds', chars: 'unitChars', count: 'unitCount', tokens: 'unitTokens', days: 'unitDays', rounds: 'unitCount' };
/** How many of these fields carry an override: the number a group's badge shows. */
export function useOverriddenCount(card, fields) {
    return card.useWebSearchPro(snapshot => fields.filter(field => snapshot.fields[field]?.overridden).length);
}
/** The staged state of a field. */
export const stateOf = (snapshot, field) => snapshot.fields[field];
export function useField(card, field) {
    const state = card.useWebSearchPro(snapshot => stateOf(snapshot, field));
    const disabled = card.useWebSearchPro(snapshot => !snapshot.writable || snapshot.saving);
    return { state, disabled, edit: (text) => card.edit(field, text), reset: () => card.resetField(field) };
}
function rowFor(props, field, children, extra = {}) {
    const { card } = props;
    const { t } = card;
    const key = labelKey(props.field);
    const st = field.state;
    return _jsx(Row, { field: props.field, id: extra.id, label: props.label ?? t(key), hint: props.hint ?? t(`${key}Hint`), help: hasHelp(props.field) ? t(`${key}Help`) : undefined, risk: props.risk, overridden: st.overridden, invalid: st.invalid || !!st.message, problem: st.message ?? t('invalid'), warning: st.warning, disabled: field.disabled, labels: rowLabels(t), onReset: field.reset, inline: extra.inline, wide: extra.wide, children: children });
}
/** A boolean field as a switch. */
export function SwitchRow(props) {
    const field = useField(props.card, props.field);
    const label = props.label ?? props.card.t(labelKey(props.field));
    return rowFor(props, field, _jsx(Toggle, { label: label, checked: field.state.text === 'true', disabled: field.disabled, onChange: next => field.edit(String(next)) }), { inline: true });
}
/** An enumerated field as a drop-down. */
export function SelectRow(props) {
    const field = useField(props.card, props.field);
    const id = controlId(props.field);
    return rowFor(props, field, _jsx(Select, { id: id, value: field.state.text, options: props.options, disabled: field.disabled, muted: !field.state.overridden, invalid: field.state.invalid, onChange: field.edit }), { id });
}
/** A free-text field. */
export function TextRow(props) {
    const field = useField(props.card, props.field);
    const id = controlId(props.field);
    return rowFor(props, field, _jsx(TextInput, { id: id, value: field.state.text, placeholder: props.placeholder, code: props.code, disabled: field.disabled, muted: !field.state.overridden, invalid: field.state.invalid, onChange: field.edit }), { id });
}
/** A number field with its unit written after the input. */
export function NumberRow(props) {
    const field = useField(props.card, props.field);
    const id = controlId(props.field);
    const input = props.unit
        ? _jsx(UnitInput, { id: id, value: field.state.text, unit: props.card.t(UNIT_KEYS[props.unit]), placeholder: props.placeholder, disabled: field.disabled, muted: !field.state.overridden, invalid: field.state.invalid, onChange: field.edit })
        : _jsx(TextInput, { id: id, value: field.state.text, placeholder: props.placeholder, numeric: true, disabled: field.disabled, muted: !field.state.overridden, invalid: field.state.invalid, onChange: field.edit });
    return rowFor(props, field, input, { id });
}
const parseList = (text) => [...new Set(text.split(',').map(item => item.trim()).filter(Boolean))];
/** A comma-separated list (engine ids, domains) as removable chips with an add box. */
export function ListRow(props) {
    const field = useField(props.card, props.field);
    const id = controlId(props.field);
    const { t } = props.card;
    return rowFor(props, field, _jsx(Chips, { id: id, values: parseList(field.state.text), placeholder: props.placeholder, disabled: field.disabled, removeLabel: t('chipRemove'), addLabel: t(labelKey(props.field)), onChange: values => field.edit(values.join(', ')) }), { id, wide: true });
}
export { parseList };
//# sourceMappingURL=field-rows.js.map