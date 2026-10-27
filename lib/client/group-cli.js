import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * "Custom CLI": the command-line tools the user adds, as a list (id, command, purpose, confidence, whether the spec is valid) and one
 * edit dialog per tool. The dialog is a form over the same spec the JSON box holds ("View JSON" at the bottom): editing either side
 * rewrites the other, every problem is the server's own message shown by the control it is about, "Done" puts the spec into the
 * draft (only when it is valid), and "Try it" runs the draft once through the plugin. The entries live inside `cliAdapters`.
 * @module web-search-pro/client/group-cli
 */
import { useState } from 'react';
import { WHOLE_OUTPUT_DEFAULT_CHARS, OUTPUT_FORMATS, DEFAULT_CUSTOM_CONFIDENCE } from "../cli/spec.js";
import { adaptersOf, checkSpec, derivedSubcommands, echoSpec, FIELD_KEYS, formToSpec, freeId, LINE_MODES, newSpec, parseSpecText, specText, specToForm, withAdapter, } from "./cli-form.js";
import { fill, rowLabels, useOverriddenCount } from "./field-rows.js";
import { AgentMark } from "./agent-mark.js";
import { customEntries, customRows, ORDER_PLATFORMS } from "./order.js";
import { styles as css } from "./styles.js";
import { Badge, Btn, Chips, Dialog, Fold, Group, Item, Row, Select, SubHead, TextInput, Toggle, UnitInput } from "./ui-kit.js";
export function draftOf(mode, id, spec) {
    return { mode, id, spec, form: specToForm(id, spec), jsonText: specText(spec), query: '' };
}
/** The draft after a form edit: the spec is rebuilt from the fields on top of the spec as it was, the JSON text follows. */
export function editForm(draft, patch) {
    const form = { ...draft.form, ...patch };
    const spec = formToSpec(form, draft.spec);
    return { ...draft, form, spec, jsonText: specText(spec), jsonError: undefined };
}
/** A new entry's id; an existing one cannot be renamed (copy it instead). */
export function editId(draft, id) {
    return draft.mode === 'new' ? { ...draft, id, form: { ...draft.form, id } } : draft;
}
/** The draft after the JSON box changed: a text that parses becomes the spec and the form is read from it; one that does not leaves both alone. */
export function editJson(draft, text) {
    const parsed = parseSpecText(text);
    if ('error' in parsed)
        return { ...draft, jsonText: text, jsonError: parsed.error };
    const spec = parsed.spec;
    return { ...draft, spec, form: specToForm(draft.id, spec), jsonText: text };
}
// ── the pieces of the form ───────────────────────────────────────────────────────────────────────────────────────────────────
const FIELD_LABELS = {
    url: { label: 'cliFieldUrl', hint: 'cliFieldUrlHint' }, title: { label: 'cliFieldTitle', hint: 'cliFieldTitleHint' },
    snippet: { label: 'cliFieldSnippet', hint: 'cliFieldSnippetHint' }, publishedAt: { label: 'cliFieldPublishedAt', hint: 'cliFieldPublishedAtHint' },
};
/** One setting of the dialog: the card's own row with the control, and the server's messages for it in place of the hint. */
function FormRow(props) {
    const { card } = props;
    const bad = (props.errors?.length ?? 0) > 0;
    return _jsx(Row, { field: props.field, id: props.id, label: props.label, hint: props.hint, invalid: bad, problem: props.errors?.join('\n'), labels: rowLabels(card.t), wide: props.wide, inline: props.inline, children: props.children });
}
/** The argument template: one box per token, buttons to add one, to add a placeholder, and to drop one. */
function Tokens({ card, tokens, onChange, disabled, invalid }) {
    const { t } = card;
    const edit = (index, value) => onChange(tokens.map((token, i) => (i === index ? value : token)));
    return _jsxs("div", { className: css.tokens, "data-wsp-tokens": true, children: [tokens.map((token, index) => _jsxs("div", { className: css.tokenRow, children: [_jsx("span", { className: "wsp-token-no", children: index + 1 }), _jsx(TextInput, { code: true, value: token, invalid: invalid && token === '', disabled: disabled, ariaLabel: fill(t('cliArgvToken'), { n: index + 1 }), onChange: value => edit(index, value) }), _jsx(Btn, { ariaLabel: t('cliArgvRemove'), title: t('cliArgvRemove'), danger: true, disabled: disabled, onClick: () => onChange(tokens.filter((_, i) => i !== index)), data: "token-remove", children: "\u00D7" })] }, index)), _jsxs("div", { className: css.actions, children: [_jsxs(Btn, { disabled: disabled, onClick: () => onChange([...tokens, '']), data: "token-add", children: ["\uFF0B ", t('cliArgvAdd')] }), _jsx(Btn, { disabled: disabled || tokens.includes('{query}'), onClick: () => onChange([...tokens, '{query}']), data: "token-query", children: '{query}' }), _jsx(Btn, { disabled: disabled, onClick: () => onChange([...tokens, '{count}']), data: "token-count", children: '{count}' })] })] });
}
/** What the form of one custom CLI shows and edits; presentational (the dialog and the render test both mount it). */
export function CliBody({ card, draft, check, disabled, onForm, onId, onJson, onQuery, onTrial }) {
    const { t } = card;
    const { form } = draft;
    const errors = (field) => check.byField[field] ?? [];
    const allowed = derivedSubcommands(draft.spec);
    const server = card.useWebSearchPro(snapshot => snapshot.server);
    const trial = server.trial.id === draft.id ? server.trial : { state: 'idle' };
    const format = form.format;
    const pathFormat = format === 'json' || format === 'yaml';
    const platformCheck = (value) => (ORDER_PLATFORMS.includes(value) ? undefined : t('cliPlatformUnknown') + ': ' + ORDER_PLATFORMS.join(', '));
    return _jsxs("div", { className: css.stack, "data-wsp-cli-form": draft.id, children: [_jsx("p", { className: css.rowHint, children: t('cliDialogNote') }), errors('general').length ? _jsx("p", { className: `${css.rowHint} wsp-bad`, role: "alert", children: errors('general').join('\n') }) : null, _jsx(FormRow, { card: card, id: "web-search-pro-cli-id", label: t('cliId'), hint: t('cliIdHint'), errors: errors('id'), children: _jsx(TextInput, { id: "web-search-pro-cli-id", code: true, value: draft.id, disabled: disabled || draft.mode === 'edit', invalid: errors('id').length > 0, onChange: onId }) }), _jsx(FormRow, { card: card, id: "web-search-pro-cli-bin", label: t('cliBin'), hint: t('cliBinHint'), errors: errors('bin'), children: _jsx(TextInput, { id: "web-search-pro-cli-bin", code: true, value: form.bin, disabled: disabled, placeholder: "mytool", invalid: errors('bin').length > 0, onChange: bin => onForm({ bin }) }) }), _jsxs(FormRow, { card: card, label: t('cliArgv'), hint: t('cliArgvHint'), errors: errors('argv'), wide: true, children: [_jsx(Tokens, { card: card, tokens: form.argv, disabled: disabled, invalid: errors('argv').length > 0, onChange: argv => onForm({ argv }) }), _jsx("p", { className: css.rowHint, children: t('cliArgvNote') })] }), _jsx(FormRow, { card: card, label: t('cliAllowed'), hint: t('cliAllowedHint'), errors: errors('probe'), children: _jsx("span", { className: "wsp-allowed", "data-wsp-allowed": true, children: allowed.length ? allowed.map(word => _jsxs("code", { children: [word, " "] }, word)) : _jsx("span", { className: css.muted, children: t('cliAllowedNone') }) }) }), _jsx(SubHead, { children: t('cliOutput') }), _jsx(FormRow, { card: card, id: "web-search-pro-cli-format", label: t('cliFormat'), hint: t('cliFormatHint'), errors: errors('format'), children: _jsx(Select, { id: "web-search-pro-cli-format", value: format, disabled: disabled, options: OUTPUT_FORMATS.map(value => ({ value, label: value })), onChange: value => onForm({ format: value }) }) }), format === 'text' ? _jsx(FormRow, { card: card, label: t('cliWhole'), hint: t('cliWholeHint'), inline: true, children: _jsx(Toggle, { label: t('cliWhole'), checked: form.whole, disabled: disabled, onChange: whole => onForm({ whole }) }) }) : null, format === 'text' && form.whole ? _jsxs(_Fragment, { children: [_jsx(FormRow, { card: card, id: "web-search-pro-cli-whole-max", label: t('cliWholeMax'), hint: t('cliWholeMaxHint'), errors: errors('lines'), children: _jsx(UnitInput, { id: "web-search-pro-cli-whole-max", value: form.wholeMax, unit: t('unitChars'), placeholder: String(WHOLE_OUTPUT_DEFAULT_CHARS), disabled: disabled, invalid: errors('lines').length > 0, onChange: wholeMax => onForm({ wholeMax }) }) }), _jsx("p", { className: css.rowHint, "data-wsp-whole-note": true, children: t('cliWholeNote') })] }) : null, format === 'text' && !form.whole ? _jsxs(_Fragment, { children: [_jsx(FormRow, { card: card, id: "web-search-pro-cli-lines", label: t('cliLinesMode'), hint: t('cliLinesModeHint'), errors: form.linesMode === 'tsv' ? [] : errors('lines'), children: _jsx(Select, { id: "web-search-pro-cli-lines", value: form.linesMode, disabled: disabled, options: LINE_MODES.map(value => ({ value, label: value === 'tsv' ? t('cliOptTsv') : t('cliOptUrlLines') })), onChange: value => onForm({ linesMode: value }) }) }), form.linesMode === 'tsv' ? _jsx(FormRow, { card: card, id: "web-search-pro-cli-columns", label: t('cliColumns'), hint: t('cliColumnsHint'), errors: errors('lines'), children: _jsx(TextInput, { id: "web-search-pro-cli-columns", code: true, value: form.columns, disabled: disabled, placeholder: "id, title, link", invalid: errors('lines').length > 0, onChange: columns => onForm({ columns }) }) }) : null] }) : null, pathFormat ? _jsx(FormRow, { card: card, id: "web-search-pro-cli-items", label: t('cliItemsPath'), hint: t('cliItemsPathHint'), errors: errors('itemsPath'), children: _jsx(TextInput, { id: "web-search-pro-cli-items", code: true, value: form.itemsPath, disabled: disabled, placeholder: "data.items", invalid: errors('itemsPath').length > 0, onChange: itemsPath => onForm({ itemsPath }) }) }) : null, !(format === 'text' && form.whole) ? _jsxs(_Fragment, { children: [_jsx("p", { className: css.rowHint, children: t('cliFieldsNote') }), errors('fields').length ? _jsx("p", { className: `${css.rowHint} wsp-bad`, role: "alert", children: errors('fields').join('\n') }) : null, FIELD_KEYS.map(key => _jsx(FormRow, { card: card, id: `web-search-pro-cli-field-${key}`, label: t(FIELD_LABELS[key].label), hint: form.complex.includes(key) ? t('cliFieldComplex') : t(FIELD_LABELS[key].hint), errors: errors(key), children: _jsx(TextInput, { id: `web-search-pro-cli-field-${key}`, code: true, value: form.fields[key], disabled: disabled || form.complex.includes(key), placeholder: form.complex.includes(key) ? '{…}' : key === 'url' ? 'link' : key === 'title' ? 'title' : key === 'snippet' ? 'summary' : 'published_at', invalid: errors(key).length > 0, onChange: value => onForm({ fields: { ...form.fields, [key]: value } }) }) }, key))] }) : null, _jsx(FormRow, { card: card, id: "web-search-pro-cli-timeout", label: t('cliTimeout'), hint: t('cliTimeoutHint'), errors: errors('timeoutMs'), children: _jsx(UnitInput, { id: "web-search-pro-cli-timeout", value: form.timeoutMs, unit: t('unitMs'), disabled: disabled, invalid: errors('timeoutMs').length > 0, onChange: timeoutMs => onForm({ timeoutMs }) }) }), _jsx(SubHead, { children: t('cliPurpose') }), _jsx(FormRow, { card: card, label: t('cliEngine'), hint: t('cliEngineHint'), errors: errors('engine'), inline: true, children: _jsx(Toggle, { label: t('cliEngine'), checked: form.engine, disabled: disabled, onChange: engine => onForm({ engine }) }) }), _jsx(FormRow, { card: card, id: "web-search-pro-cli-platforms", label: t('cliPlatforms'), hint: t('cliPlatformsHint'), errors: errors('platforms'), wide: true, children: _jsx(Chips, { id: "web-search-pro-cli-platforms", values: form.platforms, disabled: disabled, placeholder: t('cliPlatformsAdd'), removeLabel: t('chipRemove'), addLabel: t('cliPlatforms'), check: platformCheck, onChange: platforms => onForm({ platforms }) }) }), _jsx(FormRow, { card: card, id: "web-search-pro-cli-confidence", label: t('cliConfidenceLabel'), hint: t('cliConfidenceHint'), errors: errors('confidence'), children: _jsx(TextInput, { id: "web-search-pro-cli-confidence", numeric: true, value: form.confidence, disabled: disabled, placeholder: String(DEFAULT_CUSTOM_CONFIDENCE), invalid: errors('confidence').length > 0, onChange: confidence => onForm({ confidence }) }) }), _jsx("p", { className: css.rowHint, children: t('cliConfidenceNote') }), _jsxs(Fold, { id: "cli-advanced", title: t('cliAdvanced'), children: [_jsx(FormRow, { card: card, id: "web-search-pro-cli-package", label: t('cliPackageNote'), hint: t('cliPackageNoteHint'), errors: errors('packageNote'), children: _jsx(TextInput, { id: "web-search-pro-cli-package", value: form.packageNote, disabled: disabled, placeholder: form.bin ? form.bin + ' (installed by you)' : '', invalid: errors('packageNote').length > 0, onChange: packageNote => onForm({ packageNote }) }) }), _jsx(FormRow, { card: card, id: "web-search-pro-cli-help", label: t('cliHelpArgs'), hint: t('cliHelpArgsHint'), errors: errors('probe'), children: _jsx(TextInput, { id: "web-search-pro-cli-help", code: true, value: form.helpArgs, disabled: disabled, placeholder: "--help", onChange: helpArgs => onForm({ helpArgs }) }) }), _jsx(FormRow, { card: card, id: "web-search-pro-cli-must", label: t('cliMustContain'), hint: t('cliMustContainHint'), wide: true, children: _jsx(Chips, { id: "web-search-pro-cli-must", values: form.mustContain, disabled: disabled, removeLabel: t('chipRemove'), addLabel: t('cliMustContain'), onChange: mustContain => onForm({ mustContain }) }) }), _jsx(FormRow, { card: card, id: "web-search-pro-cli-max", label: t('cliMaxOutput'), hint: t('cliMaxOutputHint'), errors: errors('maxOutputBytes'), children: _jsx(UnitInput, { id: "web-search-pro-cli-max", value: form.maxOutputBytes, unit: t('unitBytes'), disabled: disabled, invalid: errors('maxOutputBytes').length > 0, onChange: maxOutputBytes => onForm({ maxOutputBytes }) }) })] }), _jsx(Fold, { id: "cli-trial", title: t('cliTrial'), children: _jsxs("div", { className: css.stack, "data-wsp-trial": true, children: [_jsx("p", { className: css.rowHint, children: t('cliTrialNote') }), server.available ? _jsxs(_Fragment, { children: [_jsxs("div", { className: css.trialBar, children: [_jsx(TextInput, { value: draft.query, placeholder: t('cliTrialQueryDefault'), ariaLabel: t('cliTrialQuery'), disabled: disabled, onChange: onQuery }), _jsx(Btn, { disabled: disabled || !check.ok || trial.state === 'running', onClick: onTrial, data: "trial-run", children: trial.state === 'running' ? t('cliTrialRunning') : t('cliTrialRun') })] }), !check.ok ? _jsx("p", { className: css.rowHint, children: t('cliTrialInvalid') }) : null, _jsx(TrialOutput, { card: card, trial: trial })] }) : _jsx("p", { className: css.notice, role: "note", "data-wsp-trial-unavailable": true, children: t('cliTrialUnavailable') })] }) }), _jsx(Fold, { id: "cli-json", title: t('cliJson'), children: _jsxs("div", { className: css.stack, "data-wsp-json-view": true, children: [_jsx("p", { className: css.rowHint, children: t('cliJsonNote') }), _jsx("textarea", { className: `${css.input} ${css.textarea} ${css.code} ${draft.jsonError ? css.invalidInput : ''}`, rows: 14, spellCheck: false, value: draft.jsonText, disabled: disabled, "aria-label": t('cliJson'), "aria-invalid": draft.jsonError ? true : undefined, onChange: event => onJson(event.currentTarget.value) }), draft.jsonError ? _jsx("p", { className: `${css.rowHint} wsp-bad`, role: "alert", children: fill(t('cliJsonBad'), { why: draft.jsonError }) }) : null] }) }), _jsx("p", { className: check.ok ? css.rowHint : `${css.rowHint} wsp-bad`, role: check.ok ? 'status' : 'alert', "data-wsp-cli-check": check.ok ? 'ok' : 'bad', children: check.ok ? t('cliValid') : t('cliProblems') + ': ' + check.errors.length })] });
}
/** What a trial run found: the first results and the tool's own words, or where it stopped and why. */
function TrialOutput({ card, trial }) {
    const { t } = card;
    if (trial.state === 'failed')
        return _jsx("p", { className: `${css.rowHint} wsp-bad`, role: "alert", children: fill(t('cliTrialRpcFailed'), { why: trial.error ?? '' }) });
    const result = trial.result;
    if (trial.state !== 'done' || !result)
        return null;
    const stages = { disabled: t('cliTrialStageDisabled'), validate: t('cliTrialStageValidate'), probe: t('cliTrialStageProbe'), search: t('cliTrialStageSearch') };
    if (!result.ok) {
        return _jsxs("div", { className: css.trialOut, "data-wsp-trial-result": "failed", children: [_jsx("strong", { className: "wsp-bad", children: fill(t('cliTrialFailed'), { stage: stages[result.stage] }) }), _jsx("span", { children: result.message }), result.errors?.length ? _jsx("ul", { children: result.errors.map((error, index) => _jsx("li", { children: error }, index)) }) : null, result.hint ? _jsx("span", { className: css.rowHint, children: fill(t('cliTrialHint'), { hint: result.hint }) }) : null, result.raw ? _jsxs(_Fragment, { children: [_jsx("strong", { children: t('cliTrialRaw') }), _jsx("pre", { className: css.codeBlock, children: result.raw })] }) : null] });
    }
    return _jsxs("div", { className: css.trialOut, "data-wsp-trial-result": "ok", children: [_jsx("strong", { children: fill(t('cliTrialOk'), { n: result.total, m: result.sources.length, ms: result.elapsedMs }) }), _jsx(Badge, { tone: "outline", children: t('cliTrialLabel') }), _jsx("span", { className: css.rowHint, children: t('cliTrialResults') }), _jsx("ul", { children: result.sources.map((source, index) => _jsxs("li", { children: [_jsx("strong", { children: source.title ?? source.url }), " ", _jsx("code", { children: source.url }), source.snippet ? _jsxs(_Fragment, { children: [" \u2014 ", source.snippet] }) : null, source.publishedAt ? _jsxs(_Fragment, { children: [" (", source.publishedAt, ")"] }) : null] }, index)) }), _jsx("strong", { children: t('cliTrialRaw') }), _jsx("pre", { className: css.codeBlock, children: result.raw })] });
}
// ── the dialog ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function CliDialog({ card, initial, taken, onClose }) {
    const { t } = card;
    const [draft, setDraft] = useState(initial);
    const text = card.useWebSearchPro(snapshot => snapshot.fields.cliAdapters.text);
    const disabled = card.useWebSearchPro(snapshot => !snapshot.writable || snapshot.saving);
    const check = checkSpec(draft.id, draft.spec, draft.mode === 'new' ? taken : []);
    const apply = () => {
        const next = withAdapter(text, draft.id, draft.spec);
        if (next === undefined)
            return;
        card.edit('cliAdapters', next);
        card.clearTrial();
        onClose();
    };
    const close = () => { card.clearTrial(); onClose(); };
    return _jsx(Dialog, { open: true, wide: true, title: draft.mode === 'new' ? t('cliDialogNew') : fill(t('cliDialogEdit'), { id: draft.id }), closeLabel: t('close'), onClose: close, footer: _jsxs(_Fragment, { children: [_jsx(Btn, { onClick: close, data: "cli-cancel", children: t('cliCancel') }), _jsx(Btn, { primary: true, disabled: disabled || !check.ok || adaptersOf(text) === undefined, title: check.ok ? undefined : t('cliApplyBlocked'), onClick: apply, data: "cli-apply", children: t('cliApply') })] }), children: _jsx(CliBody, { card: card, draft: draft, check: check, disabled: disabled, onForm: patch => setDraft(current => editForm(current, patch)), onId: id => setDraft(current => editId(current, id)), onJson: value => setDraft(current => editJson(current, value)), onQuery: query => setDraft(current => ({ ...current, query })), onTrial: () => card.runTrial({ id: draft.id, spec: draft.spec, query: draft.query.trim() || t('cliTrialQueryDefault') }) }) });
}
// ── the list ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function CliList({ card }) {
    const { t } = card;
    const text = card.useWebSearchPro(snapshot => snapshot.fields.cliAdapters.text);
    const disabled = card.useWebSearchPro(snapshot => !snapshot.writable);
    const [editing, setEditing] = useState();
    const adapters = adaptersOf(text);
    const rows = customRows(adapters);
    const taken = rows.map(row => row.id);
    const open = (mode, id, spec) => setEditing(draftOf(mode, id, spec));
    const entry = (id) => customEntries(adapters).find(([key]) => key === id)?.[1] ?? {};
    const remove = (id) => { const next = withAdapter(text, id, undefined); if (next !== undefined)
        card.edit('cliAdapters', next); };
    return _jsxs(_Fragment, { children: [adapters === undefined ? _jsx("p", { className: `${css.rowHint} wsp-bad`, role: "alert", children: t('platformChainBad').replace('platformBackends', 'cliAdapters') }) : null, _jsx("div", { className: css.list, "data-wsp-cli-list": true, children: rows.length === 0 ? _jsx("p", { className: css.empty, children: t('cliEmpty') }) : rows.map(row => _jsx(Item, { data: row.id, title: _jsx("code", { children: row.id }), badges: _jsxs(_Fragment, { children: [row.engine ? _jsx(Badge, { tone: "info", children: t('cliPurposeEngine') }) : null, row.platforms.length ? _jsx(Badge, { tone: "neutral", children: fill(t('cliPurposePlatforms'), { list: row.platforms.join(', ') }) }) : null, !row.engine && !row.platforms.length ? _jsx(Badge, { tone: "warning", children: t('cliPurposeNone') }) : null, _jsx(Badge, { tone: "neutral", children: fill(t('orderConfidenceBadge'), { c: row.confidence }) }), _jsx(Badge, { tone: row.problems.length ? 'danger' : 'success', children: row.problems.length ? t('stateSpecBad') + ' · ' + row.problems.length : t('stateSpecOk') }), _jsx(AgentMark, { card: card, itemKey: 'cliAdapters.' + row.id, compact: true })] }), meta: row.problems.length ? row.problems[0] : row.bin + ' ' + argvPreview(entry(row.id)), actions: _jsxs(_Fragment, { children: [_jsx(Btn, { disabled: disabled, onClick: () => open('edit', row.id, entry(row.id)), data: "cli-edit", children: t('edit') }), _jsx(Btn, { disabled: disabled, onClick: () => open('new', freeId(row.id + '-copy', taken), structuredClone(entry(row.id))), data: "cli-copy", children: t('cliCopy') }), _jsx(Btn, { danger: true, disabled: disabled, title: t('cliDeleteNote'), onClick: () => remove(row.id), data: "cli-delete", children: t('cliDelete') })] }) }, row.id)) }), _jsxs("div", { className: css.actions, children: [_jsxs(Btn, { disabled: disabled || adapters === undefined, onClick: () => open('new', freeId('mycli', taken), newSpec()), data: "cli-add", children: ["\uFF0B ", t('cliAdd')] }), _jsx(Btn, { disabled: disabled || adapters === undefined, onClick: () => open('new', freeId('echo', taken), echoSpec()), data: "cli-add-example", children: t('cliAddExample') })] }), _jsx(AgentClis, { card: card, baseline: taken }), editing ? _jsx(CliDialog, { card: card, initial: editing, taken: taken, onClose: () => setEditing(undefined) }, editing.mode + editing.id) : null] });
}
/**
 * The custom CLIs an agent added with `config.upsert_cli` that the configuration does not hold: they live only in the overlay, so the list
 * above (which is the configuration) cannot show them. Each carries the same two buttons as in "Agent changes".
 */
function AgentClis({ card, baseline }) {
    const { t } = card;
    const items = card.useWebSearchPro(snapshot => (snapshot.server.overlay.view?.items ?? []).filter(item => item.kind === 'cli' && item.target !== undefined && !baseline.includes(item.target)));
    if (items.length === 0)
        return null;
    return _jsxs("div", { "data-wsp-agent-clis": true, children: [_jsx(SubHead, { children: t('agentCliTitle') }), _jsx("p", { className: css.rowHint, children: t('agentCliNote') }), _jsx("div", { className: css.list, children: items.map(item => _jsx(Item, { data: item.target, title: _jsx("code", { children: item.target }), badges: _jsx(AgentMark, { card: card, itemKey: item.key, compact: true }), meta: _jsxs(_Fragment, { children: [_jsx("div", { children: _jsx("code", { children: item.summary }) }), item.reason ? _jsxs("div", { className: css.muted, children: ["\u201C", item.reason, "\u201D"] }) : null] }), actions: _jsxs(_Fragment, { children: [_jsx(Btn, { primary: true, onClick: () => card.adoptOverlay(item.key), data: "agent-adopt", children: t('agentAdopt') }), _jsx(Btn, { danger: true, onClick: () => card.revokeOverlay([item.key]), data: "agent-revoke", children: t('agentRevoke') })] }) }, item.key)) })] });
}
/** The argument template as one line, for the list's meta text. */
function argvPreview(spec) {
    const search = spec.search;
    return Array.isArray(search?.argv) ? search.argv.filter((token) => typeof token === 'string').join(' ') : '';
}
export function CliGroup({ card }) {
    const { t } = card;
    const n = useOverriddenCount(card, ['cliAdapters']);
    return _jsxs(Group, { id: "cli", title: t('groupCli'), summary: t('groupCliSub'), badges: n ? _jsx(Badge, { tone: "info", children: fill(t('overriddenCount'), { n }) }) : null, children: [_jsx("p", { className: css.rowHint, children: t('cliIntroNote') }), _jsx(CliList, { card: card })] });
}
//# sourceMappingURL=group-cli.js.map