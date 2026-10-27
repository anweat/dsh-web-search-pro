import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * "Scoring model": the optional model judge (mode, provider, coverage judge, usage caps), its custom providers as a JSON list,
 * and the judge prompts (rubrics) as a list: a row each (name, active version, default or overridden) and an edit dialog that
 * puts the built-in text beside your override. The dialog edits the same staged entry the rest of the card writes on save.
 * @module web-search-pro/client/group-judge
 */
import { useState } from 'react';
import { BUILTIN_RUBRIC_IDS } from "../pipeline/rubrics-spec.js";
import { fill, NumberRow, SelectRow, SwitchRow, TextRow, useOverriddenCount } from "./field-rows.js";
import { JsonList, jsonFieldsOf } from "./json-list.js";
import { styles as css } from "./styles.js";
import { Badge, Btn, Dialog, Fold, Group, Item, SubHead, TextInput } from "./ui-kit.js";
const MODE_FIELDS = ['evidence.judge.mode', 'evidence.judge.provider', 'evidence.hybridBorderline', 'evidence.maxJevQuestions', 'evidence.judge.allowLlm',
    'evidence.coverage.mode', 'evidence.coverage.provider', 'evidence.coverage.thresholds.weak', 'evidence.coverage.thresholds.covered',
    'evidence.budget.perSearchInputTokens', 'evidence.budget.dailyInputTokens', 'evidence.budget.timezone', 'evidence.judge.providers', 'evidence.budget.providers'];
const CONTROLS = [
    { key: 'version', label: 'rubricVersion', hint: 'rubricVersionHint', kind: 'line' },
    { key: 'instructions', label: 'rubricInstructions', hint: 'rubricInstructionsHint', kind: 'area' },
    { key: 'criteria', label: 'rubricCriteria', hint: 'rubricCriteriaHint', kind: 'area' },
    { key: 'maxStateChars', label: 'rubricMaxState', hint: 'rubricMaxStateHint', kind: 'number' },
    { key: 'maxCandidateChars', label: 'rubricMaxCandidate', hint: 'rubricMaxCandidateHint', kind: 'number' },
];
/** The built-in value of a control. */
function builtinText(rubric, key) {
    switch (key) {
        case 'version': return rubric.builtin.version;
        case 'instructions': return rubric.builtin.instructions;
        case 'criteria': return rubric.builtin.criteria.join('\n');
        case 'maxStateChars': return String(rubric.builtin.maxStateChars);
        case 'maxCandidateChars': return String(rubric.builtin.maxCandidateChars);
    }
}
/** The controls of one rubric override: each is a view of the one staged entry; the built-in text sits beside it. */
export function RubricForm({ card, id }) {
    const { t } = card;
    const rubric = card.useWebSearchPro(snapshot => snapshot.rubrics.find(entry => entry.id === id));
    const disabled = card.useWebSearchPro(snapshot => !snapshot.writable || snapshot.saving);
    return _jsxs("div", { className: css.stack, "data-wsp-field": `evidence.rubrics.${id}`, "data-wsp-rubric": id, children: [_jsx("p", { className: css.rowHint, children: rubric.description }), !rubric.editing
                ? _jsxs(_Fragment, { children: [_jsxs("div", { className: css.compareCol, children: [_jsx("strong", { children: t('promptDefaultCol') }), _jsx("pre", { className: css.preview, children: rubric.builtin.instructions })] }), _jsx("div", { children: _jsx(Btn, { disabled: disabled, onClick: () => card.startRubric(id), data: "rubric-start", children: t('rubricCreate') }) })] })
                : _jsxs(_Fragment, { children: [CONTROLS.filter(control => control.key !== 'criteria' || rubric.kind === 'score').map(control => {
                            const inputId = `web-search-pro-rubric-${id}-${control.key}`;
                            const value = rubric.entry[control.key];
                            const invalid = rubric.invalid;
                            return _jsxs("div", { className: css.compare, children: [_jsxs("div", { className: css.compareCol, children: [_jsxs("strong", { children: [t(control.label), " \u00B7 ", t('promptDefaultCol')] }), _jsx("pre", { className: css.preview, children: builtinText(rubric, control.key) })] }), _jsxs("div", { className: css.compareCol, children: [_jsxs("label", { htmlFor: inputId, children: [t(control.label), " \u00B7 ", t('promptMineCol')] }), control.kind === 'area'
                                                ? _jsx("textarea", { id: inputId, className: `${css.input} ${css.textarea} ${css.code} ${invalid ? css.invalidInput : ''}`, rows: control.key === 'criteria' ? 5 : 10, spellCheck: false, value: value, disabled: disabled, placeholder: t('promptEmptyIsDefault'), "aria-invalid": invalid || undefined, onChange: event => card.editRubric(id, control.key, event.currentTarget.value) })
                                                : _jsx(TextInput, { id: inputId, value: value, code: true, disabled: disabled, invalid: invalid, numeric: control.kind === 'number', placeholder: t('promptEmptyIsDefault'), onChange: text => card.editRubric(id, control.key, text) }), _jsx("p", { className: css.rowHint, children: t(control.hint) })] })] }, control.key);
                        }), _jsx("div", { children: _jsx("button", { type: "button", className: css.link, disabled: disabled, onClick: () => card.restoreRubric(id), "data-wsp-reset": `evidence.rubrics.${id}`, children: t('rubricRestore') }) })] }), rubric.problems.length ? _jsx("ul", { className: rubric.invalid ? 'wsp-bad' : css.rowHint, role: "alert", "data-wsp-rubric-problems": true, children: rubric.problems.map((problem, index) => _jsx("li", { children: problem }, index)) }) : null] });
}
function RubricList({ card }) {
    const { t } = card;
    const rubrics = card.useWebSearchPro(snapshot => snapshot.rubrics);
    const unknown = card.useWebSearchPro(snapshot => snapshot.unknownRubrics);
    const disabled = card.useWebSearchPro(snapshot => !snapshot.writable || snapshot.saving);
    const [editing, setEditing] = useState();
    return _jsxs(_Fragment, { children: [_jsx(SubHead, { children: t('rubricsTitle') }), _jsx("p", { className: css.rowHint, children: t('rubricNotes') }), _jsx("div", { className: css.list, "data-wsp-rubrics": true, children: rubrics.map(rubric => _jsx(Item, { data: rubric.id, title: _jsx("code", { children: rubric.id }), badges: _jsxs(_Fragment, { children: [_jsxs(Badge, { tone: "neutral", children: [t('rubricActive'), " ", rubric.activeVersion] }), _jsx(Badge, { tone: rubric.invalid ? 'danger' : rubric.editing ? 'info' : 'outline', children: rubric.invalid ? t('invalid') : rubric.editing ? t('rubricOverrideOn') : t('promptStateDefault') })] }), meta: rubric.description, actions: _jsxs(_Fragment, { children: [rubric.editing ? _jsx("button", { type: "button", className: css.link, disabled: disabled, onClick: () => card.restoreRubric(rubric.id), children: t('rubricRestore') }) : null, _jsx(Btn, { disabled: disabled, onClick: () => setEditing(rubric.id), data: "rubric-edit", children: t('edit') })] }) }, rubric.id)) }), unknown.length ? _jsxs("p", { className: css.rowHint, role: "note", children: [t('rubricUnknown'), " ", unknown.join(', ')] }) : null, editing ? _jsx(Dialog, { open: true, wide: true, title: fill(t('rubricDialogTitle'), { name: editing }), closeLabel: t('close'), description: t('dialogStagesNote'), onClose: () => setEditing(undefined), footer: _jsx(Btn, { primary: true, onClick: () => setEditing(undefined), data: "rubric-done", children: t('done') }), children: _jsx(RubricForm, { card: card, id: editing }) }) : null] });
}
export { BUILTIN_RUBRIC_IDS };
export function JudgeGroup({ card }) {
    const { t } = card;
    const count = useOverriddenCount(card, [...MODE_FIELDS, ...BUILTIN_RUBRIC_IDS.map(id => `evidence.rubrics.${id}`)]);
    const providers = card.useWebSearchPro(snapshot => snapshot.providerChoices);
    const options = [{ value: '', label: t('emptyDefault') }, ...providers.map(id => ({ value: id, label: id }))];
    const off = { value: 'off', label: t('optionOff') };
    return _jsxs(Group, { id: "judge", title: t('groupJudge'), summary: t('groupJudgeSub'), badges: count ? _jsx(Badge, { tone: "info", children: fill(t('overriddenCount'), { n: count }) }) : null, children: [_jsx(SelectRow, { card: card, field: "evidence.judge.mode", risk: t('riskModel'), options: [off, { value: 'shadow', label: t('optShadow') }, { value: 'control', label: t('optControl') }, { value: 'hybrid', label: t('optHybrid') }] }), _jsx(SelectRow, { card: card, field: "evidence.judge.provider", options: options }), _jsx(SwitchRow, { card: card, field: "evidence.hybridBorderline" }), _jsx(NumberRow, { card: card, field: "evidence.maxJevQuestions", unit: "count" }), _jsx(SwitchRow, { card: card, field: "evidence.judge.allowLlm", risk: t('riskModel') }), _jsxs(Fold, { id: "judge-coverage", title: t('judgeGroupCoverage'), hint: t('judgeGroupCoverageHint'), children: [_jsx(SelectRow, { card: card, field: "evidence.coverage.mode", options: [off, { value: 'shadow', label: t('optShadow') }, { value: 'control', label: t('optControl') }] }), _jsx(SelectRow, { card: card, field: "evidence.coverage.provider", options: options }), _jsx(NumberRow, { card: card, field: "evidence.coverage.thresholds.weak" }), _jsx(NumberRow, { card: card, field: "evidence.coverage.thresholds.covered" })] }), _jsxs(Fold, { id: "judge-budget", title: t('judgeGroupBudget'), hint: t('judgeGroupBudgetHint'), children: [_jsx(NumberRow, { card: card, field: "evidence.budget.perSearchInputTokens", unit: "tokens" }), _jsx(NumberRow, { card: card, field: "evidence.budget.dailyInputTokens", unit: "tokens" }), _jsx(TextRow, { card: card, field: "evidence.budget.timezone", placeholder: "Asia/Shanghai" })] }), _jsx(SubHead, { children: t('judgeGroupProviders') }), _jsx(JsonList, { card: card, fields: jsonFieldsOf('judge') }), _jsx(RubricList, { card: card })] });
}
//# sourceMappingURL=group-judge.js.map