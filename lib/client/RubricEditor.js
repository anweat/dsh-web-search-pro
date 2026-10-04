import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { styles as css } from "./styles.js";
/** Label and hint keys of each rubric text control. */
const CONTROLS = [
    { key: 'version', label: 'rubricVersion', hint: 'rubricVersionHint', kind: 'line' },
    { key: 'instructions', label: 'rubricInstructions', hint: 'rubricInstructionsHint', kind: 'area' },
    { key: 'criteria', label: 'rubricCriteria', hint: 'rubricCriteriaHint', kind: 'area' },
    { key: 'maxStateChars', label: 'rubricMaxState', hint: 'rubricMaxStateHint', kind: 'number' },
    { key: 'maxCandidateChars', label: 'rubricMaxCandidate', hint: 'rubricMaxCandidateHint', kind: 'number' },
];
/** The built-in value of a control, shown as the placeholder while the entry leaves it blank. */
function builtinText(rubric, key) {
    switch (key) {
        case 'version': return rubric.builtin.version;
        case 'instructions': return rubric.builtin.instructions;
        case 'criteria': return rubric.builtin.criteria.join('\n');
        case 'maxStateChars': return String(rubric.builtin.maxStateChars);
        case 'maxCandidateChars': return String(rubric.builtin.maxCandidateChars);
    }
}
/**
 * One built-in rubric: its active version, and an override editor whose controls are views of one staged entry
 * (version, instructions, levels, limits). The problems shown are the ones the server would act on: it ignores an
 * invalid override and uses the built-in, so the card refuses to save one.
 */
function Rubric(props) {
    const { t, rubric, disabled } = props;
    const idBase = `web-search-pro-rubric-${rubric.id}`;
    return (_jsxs("div", { className: css.rubric, "data-web-search-pro-rubric": rubric.id, children: [_jsxs("div", { className: css.rubricHead, children: [_jsxs("span", { children: [_jsx("strong", { children: rubric.id }), _jsxs("span", { className: css.badge, children: [t('rubricActive'), ": ", rubric.activeVersion] }), _jsx("span", { className: css.badge, "data-on": rubric.editing || undefined, children: rubric.editing ? t('rubricOverrideOn') : `${t('rubricBuiltin')} ${rubric.builtin.version}` })] }), _jsx("span", { children: rubric.editing
                            ? _jsx("button", { type: "button", className: css.linkButton, disabled: disabled, onClick: () => { props.restoreRubric(rubric.id); }, children: t('rubricRestore') })
                            : _jsx("button", { type: "button", className: css.linkButton, disabled: disabled, onClick: () => { props.startRubric(rubric.id); }, children: t('rubricCreate') }) })] }), _jsx("p", { className: css.hint, children: rubric.description }), rubric.editing ? (_jsx("div", { className: css.grid, children: CONTROLS.filter(control => control.key !== 'criteria' || rubric.kind === 'score').map((control) => {
                    const id = `${idBase}-${control.key}`;
                    const value = rubric.entry[control.key];
                    const common = {
                        id, value, disabled, placeholder: builtinText(rubric, control.key), spellCheck: false,
                        'aria-invalid': rubric.invalid || undefined,
                    };
                    return (_jsxs("div", { className: `${css.field} ${control.kind === 'area' ? css.fullRow : ''}`, children: [_jsx("label", { className: css.label, htmlFor: id, children: t(control.label) }), control.kind === 'area'
                                ? _jsx("textarea", { ...common, className: `${css.input} ${css.textarea} ${css.code}`, rows: control.key === 'criteria' ? 5 : 6, onChange: event => { props.editRubric(rubric.id, control.key, event.currentTarget.value); } })
                                : _jsx("input", { ...common, className: css.input, type: "text", inputMode: control.kind === 'number' ? 'numeric' : undefined, onChange: event => { props.editRubric(rubric.id, control.key, event.currentTarget.value); } }), _jsx("p", { className: css.hint, children: t(control.hint) })] }, control.key));
                }) })) : null, rubric.problems.length > 0 ? (_jsx("ul", { className: rubric.invalid ? css.problem : css.warning, role: "alert", "data-web-search-pro-rubric-problems": true, children: rubric.problems.map((problem, index) => _jsx("li", { children: problem }, index)) })) : null] }));
}
export function RubricEditor(props) {
    const { t, state } = props;
    return (_jsxs("div", { "data-web-search-pro-rubrics": true, children: [_jsx("p", { className: css.hint, children: t('rubricNotes') }), state.rubrics.map(rubric => _jsx(Rubric, { t: t, rubric: rubric, disabled: props.disabled, editRubric: props.editRubric, startRubric: props.startRubric, restoreRubric: props.restoreRubric }, rubric.id)), state.unknownRubrics.length > 0 ? _jsxs("p", { className: css.warning, role: "note", children: [t('rubricUnknown'), " ", state.unknownRubrics.join(', ')] }) : null] }));
}
//# sourceMappingURL=RubricEditor.js.map