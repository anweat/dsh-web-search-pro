/**
 * "Custom CLI": the command-line tools the user adds, as a list (id, command, purpose, confidence, whether the spec is valid) and one
 * edit dialog per tool. The dialog is a form over the same spec the JSON box holds ("View JSON" at the bottom): editing either side
 * rewrites the other, every problem is the server's own message shown by the control it is about, "Done" puts the spec into the
 * draft (only when it is valid), and "Try it" runs the draft once through the plugin. The entries live inside `cliAdapters`.
 * @module web-search-pro/client/group-cli
 */

import { useState, type ReactNode } from 'react'
import { WHOLE_OUTPUT_DEFAULT_CHARS, OUTPUT_FORMATS, DEFAULT_CUSTOM_CONFIDENCE } from '../cli/spec.ts'
import {
  adaptersOf, checkSpec, derivedSubcommands, echoSpec, FIELD_KEYS, formToSpec, freeId, LINE_MODES, newSpec, parseSpecText, specText, specToForm, withAdapter,
  type CliCheck, type CliForm, type ErrorField, type FieldKey, type LineMode,
} from './cli-form.ts'
import type { TrialResult } from '../rpc-types.ts'
import { fill, rowLabels, useOverriddenCount, type Card } from './field-rows.tsx'
import { customEntries, customRows, ORDER_PLATFORMS } from './order.ts'
import { styles as css } from './styles.ts'
import { Badge, Btn, Chips, Dialog, Fold, Group, Item, Row, Select, SubHead, TextInput, Toggle, UnitInput } from './ui-kit.tsx'

type Json = Record<string, unknown>

// ── the dialog's state ────────────────────────────────────────────────────────────────────────────────────────────────────

/** What the dialog holds: the spec (the source of truth), the form fields read from it, the JSON box text, and the trial's sample query. */
export interface CliDraft {
  mode: 'new' | 'edit'
  id: string
  spec: Json
  form: CliForm
  jsonText: string
  jsonError?: string
  query: string
}

export function draftOf(mode: 'new' | 'edit', id: string, spec: Json): CliDraft {
  return { mode, id, spec, form: specToForm(id, spec), jsonText: specText(spec), query: '' }
}

/** The draft after a form edit: the spec is rebuilt from the fields on top of the spec as it was, the JSON text follows. */
export function editForm(draft: CliDraft, patch: Partial<CliForm>): CliDraft {
  const form = { ...draft.form, ...patch }
  const spec = formToSpec(form, draft.spec)
  return { ...draft, form, spec, jsonText: specText(spec), jsonError: undefined }
}

/** A new entry's id; an existing one cannot be renamed (copy it instead). */
export function editId(draft: CliDraft, id: string): CliDraft {
  return draft.mode === 'new' ? { ...draft, id, form: { ...draft.form, id } } : draft
}

/** The draft after the JSON box changed: a text that parses becomes the spec and the form is read from it; one that does not leaves both alone. */
export function editJson(draft: CliDraft, text: string): CliDraft {
  const parsed = parseSpecText(text)
  if ('error' in parsed) return { ...draft, jsonText: text, jsonError: parsed.error }
  const spec = parsed.spec
  return { ...draft, spec, form: specToForm(draft.id, spec), jsonText: text }
}

// ── the pieces of the form ───────────────────────────────────────────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<FieldKey, { label: 'cliFieldUrl' | 'cliFieldTitle' | 'cliFieldSnippet' | 'cliFieldPublishedAt'; hint: 'cliFieldUrlHint' | 'cliFieldTitleHint' | 'cliFieldSnippetHint' | 'cliFieldPublishedAtHint' }> = {
  url: { label: 'cliFieldUrl', hint: 'cliFieldUrlHint' }, title: { label: 'cliFieldTitle', hint: 'cliFieldTitleHint' },
  snippet: { label: 'cliFieldSnippet', hint: 'cliFieldSnippetHint' }, publishedAt: { label: 'cliFieldPublishedAt', hint: 'cliFieldPublishedAtHint' },
}

/** One setting of the dialog: the card's own row with the control, and the server's messages for it in place of the hint. */
function FormRow(props: { card: Card; field?: string; id?: string; label: string; hint?: string; errors?: readonly string[]; wide?: boolean; inline?: boolean; children: ReactNode }) {
  const { card } = props
  const bad = (props.errors?.length ?? 0) > 0
  return <Row field={props.field} id={props.id} label={props.label} hint={props.hint} invalid={bad} problem={props.errors?.join('\n')} labels={rowLabels(card.t)} wide={props.wide} inline={props.inline}>{props.children}</Row>
}

/** The argument template: one box per token, buttons to add one, to add a placeholder, and to drop one. */
function Tokens({ card, tokens, onChange, disabled, invalid }: { card: Card; tokens: readonly string[]; onChange: (next: string[]) => void; disabled: boolean; invalid: boolean }) {
  const { t } = card
  const edit = (index: number, value: string): void => onChange(tokens.map((token, i) => (i === index ? value : token)))
  return <div className={css.tokens} data-wsp-tokens>
    {tokens.map((token, index) => <div className={css.tokenRow} key={index}>
      <span className="wsp-token-no">{index + 1}</span>
      <TextInput code value={token} invalid={invalid && token === ''} disabled={disabled} ariaLabel={fill(t('cliArgvToken'), { n: index + 1 })} onChange={value => edit(index, value)} />
      <Btn ariaLabel={t('cliArgvRemove')} title={t('cliArgvRemove')} danger disabled={disabled} onClick={() => onChange(tokens.filter((_, i) => i !== index))} data="token-remove">×</Btn>
    </div>)}
    <div className={css.actions}>
      <Btn disabled={disabled} onClick={() => onChange([...tokens, ''])} data="token-add">＋ {t('cliArgvAdd')}</Btn>
      <Btn disabled={disabled || tokens.includes('{query}')} onClick={() => onChange([...tokens, '{query}'])} data="token-query">{'{query}'}</Btn>
      <Btn disabled={disabled} onClick={() => onChange([...tokens, '{count}'])} data="token-count">{'{count}'}</Btn>
    </div>
  </div>
}

/** What the form of one custom CLI shows and edits; presentational (the dialog and the render test both mount it). */
export function CliBody({ card, draft, check, disabled, onForm, onId, onJson, onQuery, onTrial }: {
  card: Card; draft: CliDraft; check: CliCheck; disabled: boolean
  onForm: (patch: Partial<CliForm>) => void; onId: (id: string) => void; onJson: (text: string) => void; onQuery: (text: string) => void; onTrial: () => void
}) {
  const { t } = card
  const { form } = draft
  const errors = (field: ErrorField): readonly string[] => check.byField[field] ?? []
  const allowed = derivedSubcommands(draft.spec)
  const server = card.useWebSearchPro(snapshot => snapshot.server)
  const trial = server.trial.id === draft.id ? server.trial : { state: 'idle' as const }
  const format = form.format
  const pathFormat = format === 'json' || format === 'yaml'
  const platformCheck = (value: string): string | undefined => (ORDER_PLATFORMS.includes(value) ? undefined : t('cliPlatformUnknown') + ': ' + ORDER_PLATFORMS.join(', '))
  return <div className={css.stack} data-wsp-cli-form={draft.id}>
    <p className={css.rowHint}>{t('cliDialogNote')}</p>
    {errors('general').length ? <p className={`${css.rowHint} wsp-bad`} role="alert">{errors('general').join('\n')}</p> : null}
    <FormRow card={card} id="web-search-pro-cli-id" label={t('cliId')} hint={t('cliIdHint')} errors={errors('id')}>
      <TextInput id="web-search-pro-cli-id" code value={draft.id} disabled={disabled || draft.mode === 'edit'} invalid={errors('id').length > 0} onChange={onId} />
    </FormRow>
    <FormRow card={card} id="web-search-pro-cli-bin" label={t('cliBin')} hint={t('cliBinHint')} errors={errors('bin')}>
      <TextInput id="web-search-pro-cli-bin" code value={form.bin} disabled={disabled} placeholder="mytool" invalid={errors('bin').length > 0} onChange={bin => onForm({ bin })} />
    </FormRow>
    <FormRow card={card} label={t('cliArgv')} hint={t('cliArgvHint')} errors={errors('argv')} wide>
      <Tokens card={card} tokens={form.argv} disabled={disabled} invalid={errors('argv').length > 0} onChange={argv => onForm({ argv })} />
      <p className={css.rowHint}>{t('cliArgvNote')}</p>
    </FormRow>
    <FormRow card={card} label={t('cliAllowed')} hint={t('cliAllowedHint')} errors={errors('probe')}>
      <span data-wsp-allowed>{allowed.length ? allowed.map(word => <code key={word}>{word} </code>) : <span className={css.muted}>{t('cliAllowedNone')}</span>}</span>
    </FormRow>

    <SubHead>{t('cliFields')}</SubHead>
    <FormRow card={card} id="web-search-pro-cli-format" label={t('cliFormat')} hint={t('cliFormatHint')} errors={errors('format')}>
      <Select id="web-search-pro-cli-format" value={format} disabled={disabled} options={OUTPUT_FORMATS.map(value => ({ value, label: value }))} onChange={value => onForm({ format: value as CliForm['format'] })} />
    </FormRow>
    {format === 'text' ? <FormRow card={card} label={t('cliWhole')} hint={t('cliWholeHint')} inline>
      <Toggle label={t('cliWhole')} checked={form.whole} disabled={disabled} onChange={whole => onForm({ whole })} />
    </FormRow> : null}
    {format === 'text' && form.whole ? <>
      <FormRow card={card} id="web-search-pro-cli-whole-max" label={t('cliWholeMax')} hint={t('cliWholeMaxHint')} errors={errors('lines')}>
        <UnitInput id="web-search-pro-cli-whole-max" value={form.wholeMax} unit={t('unitChars')} placeholder={String(WHOLE_OUTPUT_DEFAULT_CHARS)} disabled={disabled} invalid={errors('lines').length > 0} onChange={wholeMax => onForm({ wholeMax })} />
      </FormRow>
      <p className={css.rowHint} data-wsp-whole-note>{t('cliWholeNote')}</p>
    </> : null}
    {format === 'text' && !form.whole ? <>
      <FormRow card={card} id="web-search-pro-cli-lines" label={t('cliLinesMode')} hint={t('cliLinesModeHint')} errors={form.linesMode === 'tsv' ? [] : errors('lines')}>
        <Select id="web-search-pro-cli-lines" value={form.linesMode} disabled={disabled} options={LINE_MODES.map(value => ({ value, label: value === 'tsv' ? t('cliOptTsv') : t('cliOptUrlLines') }))} onChange={value => onForm({ linesMode: value as LineMode })} />
      </FormRow>
      {form.linesMode === 'tsv' ? <FormRow card={card} id="web-search-pro-cli-columns" label={t('cliColumns')} hint={t('cliColumnsHint')} errors={errors('lines')}>
        <TextInput id="web-search-pro-cli-columns" code value={form.columns} disabled={disabled} placeholder="id, title, link" invalid={errors('lines').length > 0} onChange={columns => onForm({ columns })} />
      </FormRow> : null}
    </> : null}
    {pathFormat ? <FormRow card={card} id="web-search-pro-cli-items" label={t('cliItemsPath')} hint={t('cliItemsPathHint')} errors={errors('itemsPath')}>
      <TextInput id="web-search-pro-cli-items" code value={form.itemsPath} disabled={disabled} placeholder="data.items" invalid={errors('itemsPath').length > 0} onChange={itemsPath => onForm({ itemsPath })} />
    </FormRow> : null}
    {!(format === 'text' && form.whole) ? <>
      <p className={css.rowHint}>{t('cliFieldsNote')}</p>
      {errors('fields').length ? <p className={`${css.rowHint} wsp-bad`} role="alert">{errors('fields').join('\n')}</p> : null}
      {FIELD_KEYS.map(key => <FormRow key={key} card={card} id={`web-search-pro-cli-field-${key}`} label={t(FIELD_LABELS[key].label)} hint={form.complex.includes(key) ? t('cliFieldComplex') : t(FIELD_LABELS[key].hint)} errors={errors(key)}>
        <TextInput id={`web-search-pro-cli-field-${key}`} code value={form.fields[key]} disabled={disabled || form.complex.includes(key)} placeholder={form.complex.includes(key) ? '{…}' : key === 'url' ? 'link' : key === 'title' ? 'title' : key === 'snippet' ? 'summary' : 'published_at'} invalid={errors(key).length > 0}
          onChange={value => onForm({ fields: { ...form.fields, [key]: value } })} />
      </FormRow>)}
    </> : null}
    <FormRow card={card} id="web-search-pro-cli-timeout" label={t('cliTimeout')} hint={t('cliTimeoutHint')} errors={errors('timeoutMs')}>
      <UnitInput id="web-search-pro-cli-timeout" value={form.timeoutMs} unit={t('unitMs')} disabled={disabled} invalid={errors('timeoutMs').length > 0} onChange={timeoutMs => onForm({ timeoutMs })} />
    </FormRow>

    <SubHead>{t('cliPurpose')}</SubHead>
    <FormRow card={card} label={t('cliEngine')} hint={t('cliEngineHint')} errors={errors('engine')} inline>
      <Toggle label={t('cliEngine')} checked={form.engine} disabled={disabled} onChange={engine => onForm({ engine })} />
    </FormRow>
    <FormRow card={card} id="web-search-pro-cli-platforms" label={t('cliPlatforms')} hint={t('cliPlatformsHint')} errors={errors('platforms')} wide>
      <Chips id="web-search-pro-cli-platforms" values={form.platforms} disabled={disabled} placeholder={t('cliPlatformsAdd')} removeLabel={t('chipRemove')} addLabel={t('cliPlatforms')} check={platformCheck} onChange={platforms => onForm({ platforms })} />
    </FormRow>
    <FormRow card={card} id="web-search-pro-cli-confidence" label={t('cliConfidenceLabel')} hint={t('cliConfidenceHint')} errors={errors('confidence')}>
      <TextInput id="web-search-pro-cli-confidence" numeric value={form.confidence} disabled={disabled} placeholder={String(DEFAULT_CUSTOM_CONFIDENCE)} invalid={errors('confidence').length > 0} onChange={confidence => onForm({ confidence })} />
    </FormRow>
    <p className={css.rowHint}>{t('cliConfidenceNote')}</p>

    <Fold id="cli-advanced" title={t('cliAdvanced')}>
      <FormRow card={card} id="web-search-pro-cli-package" label={t('cliPackageNote')} hint={t('cliPackageNoteHint')} errors={errors('packageNote')}>
        <TextInput id="web-search-pro-cli-package" value={form.packageNote} disabled={disabled} placeholder={form.bin ? form.bin + ' (installed by you)' : ''} invalid={errors('packageNote').length > 0} onChange={packageNote => onForm({ packageNote })} />
      </FormRow>
      <FormRow card={card} id="web-search-pro-cli-help" label={t('cliHelpArgs')} hint={t('cliHelpArgsHint')} errors={errors('probe')}>
        <TextInput id="web-search-pro-cli-help" code value={form.helpArgs} disabled={disabled} placeholder="--help" onChange={helpArgs => onForm({ helpArgs })} />
      </FormRow>
      <FormRow card={card} id="web-search-pro-cli-must" label={t('cliMustContain')} hint={t('cliMustContainHint')} wide>
        <Chips id="web-search-pro-cli-must" values={form.mustContain} disabled={disabled} removeLabel={t('chipRemove')} addLabel={t('cliMustContain')} onChange={mustContain => onForm({ mustContain })} />
      </FormRow>
      <FormRow card={card} id="web-search-pro-cli-max" label={t('cliMaxOutput')} hint={t('cliMaxOutputHint')} errors={errors('maxOutputBytes')}>
        <UnitInput id="web-search-pro-cli-max" value={form.maxOutputBytes} unit={t('unitBytes')} disabled={disabled} invalid={errors('maxOutputBytes').length > 0} onChange={maxOutputBytes => onForm({ maxOutputBytes })} />
      </FormRow>
    </Fold>

    <Fold id="cli-trial" title={t('cliTrial')}>
      <div className={css.stack} data-wsp-trial>
        <p className={css.rowHint}>{t('cliTrialNote')}</p>
        {server.available ? <>
          <div className={css.trialBar}>
            <TextInput value={draft.query} placeholder={t('cliTrialQueryDefault')} ariaLabel={t('cliTrialQuery')} disabled={disabled} onChange={onQuery} />
            <Btn disabled={disabled || !check.ok || trial.state === 'running'} onClick={onTrial} data="trial-run">{trial.state === 'running' ? t('cliTrialRunning') : t('cliTrialRun')}</Btn>
          </div>
          {!check.ok ? <p className={css.rowHint}>{t('cliTrialInvalid')}</p> : null}
          <TrialOutput card={card} trial={trial} />
        </> : <p className={css.notice} role="note" data-wsp-trial-unavailable>{t('cliTrialUnavailable')}</p>}
      </div>
    </Fold>

    <Fold id="cli-json" title={t('cliJson')}>
      <div className={css.stack} data-wsp-json-view>
        <p className={css.rowHint}>{t('cliJsonNote')}</p>
        <textarea className={`${css.input} ${css.textarea} ${css.code} ${draft.jsonError ? css.invalidInput : ''}`} rows={14} spellCheck={false} value={draft.jsonText} disabled={disabled} aria-label={t('cliJson')} aria-invalid={draft.jsonError ? true : undefined} onChange={event => onJson(event.currentTarget.value)} />
        {draft.jsonError ? <p className={`${css.rowHint} wsp-bad`} role="alert">{fill(t('cliJsonBad'), { why: draft.jsonError })}</p> : null}
      </div>
    </Fold>
    <p className={check.ok ? css.rowHint : `${css.rowHint} wsp-bad`} role={check.ok ? 'status' : 'alert'} data-wsp-cli-check={check.ok ? 'ok' : 'bad'}>{check.ok ? t('cliValid') : t('cliProblems') + ': ' + check.errors.length}</p>
  </div>
}

/** What a trial run found: the first results and the tool's own words, or where it stopped and why. */
function TrialOutput({ card, trial }: { card: Card; trial: { state: 'idle' | 'running' | 'done' | 'failed'; result?: TrialResult; error?: string } }) {
  const { t } = card
  if (trial.state === 'failed') return <p className={`${css.rowHint} wsp-bad`} role="alert">{fill(t('cliTrialRpcFailed'), { why: trial.error ?? '' })}</p>
  const result = trial.result
  if (trial.state !== 'done' || !result) return null
  const stages = { disabled: t('cliTrialStageDisabled'), validate: t('cliTrialStageValidate'), probe: t('cliTrialStageProbe'), search: t('cliTrialStageSearch') }
  if (!result.ok) {
    return <div className={css.trialOut} data-wsp-trial-result="failed">
      <strong className="wsp-bad">{fill(t('cliTrialFailed'), { stage: stages[result.stage] })}</strong>
      <span>{result.message}</span>
      {result.errors?.length ? <ul>{result.errors.map((error, index) => <li key={index}>{error}</li>)}</ul> : null}
      {result.hint ? <span className={css.rowHint}>{fill(t('cliTrialHint'), { hint: result.hint })}</span> : null}
      {result.raw ? <><strong>{t('cliTrialRaw')}</strong><pre className={css.codeBlock}>{result.raw}</pre></> : null}
    </div>
  }
  return <div className={css.trialOut} data-wsp-trial-result="ok">
    <strong>{fill(t('cliTrialOk'), { n: result.total, m: result.sources.length, ms: result.elapsedMs })}</strong>
    <Badge tone="outline">{t('cliTrialLabel')}</Badge>
    <span className={css.rowHint}>{t('cliTrialResults')}</span>
    <ul>{result.sources.map((source, index) => <li key={index}><strong>{source.title ?? source.url}</strong> <code>{source.url}</code>{source.snippet ? <> — {source.snippet}</> : null}{source.publishedAt ? <> ({source.publishedAt})</> : null}</li>)}</ul>
    <strong>{t('cliTrialRaw')}</strong>
    <pre className={css.codeBlock}>{result.raw}</pre>
  </div>
}

// ── the dialog ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function CliDialog({ card, initial, taken, onClose }: { card: Card; initial: CliDraft; taken: readonly string[]; onClose: () => void }) {
  const { t } = card
  const [draft, setDraft] = useState<CliDraft>(initial)
  const text = card.useWebSearchPro(snapshot => snapshot.fields.cliAdapters.text)
  const disabled = card.useWebSearchPro(snapshot => !snapshot.writable || snapshot.saving)
  const check = checkSpec(draft.id, draft.spec, draft.mode === 'new' ? taken : [])
  const apply = (): void => {
    const next = withAdapter(text, draft.id, draft.spec)
    if (next === undefined) return
    card.edit('cliAdapters', next)
    card.clearTrial()
    onClose()
  }
  const close = (): void => { card.clearTrial(); onClose() }
  return <Dialog open wide title={draft.mode === 'new' ? t('cliDialogNew') : fill(t('cliDialogEdit'), { id: draft.id })} closeLabel={t('close')} onClose={close}
    footer={<>
      <Btn onClick={close} data="cli-cancel">{t('cliCancel')}</Btn>
      <Btn primary disabled={disabled || !check.ok || adaptersOf(text) === undefined} title={check.ok ? undefined : t('cliApplyBlocked')} onClick={apply} data="cli-apply">{t('cliApply')}</Btn>
    </>}>
    <CliBody card={card} draft={draft} check={check} disabled={disabled}
      onForm={patch => setDraft(current => editForm(current, patch))} onId={id => setDraft(current => editId(current, id))} onJson={value => setDraft(current => editJson(current, value))} onQuery={query => setDraft(current => ({ ...current, query }))}
      onTrial={() => card.runTrial({ id: draft.id, spec: draft.spec, query: draft.query.trim() || t('cliTrialQueryDefault') })} />
  </Dialog>
}

// ── the list ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function CliList({ card }: { card: Card }) {
  const { t } = card
  const text = card.useWebSearchPro(snapshot => snapshot.fields.cliAdapters.text)
  const disabled = card.useWebSearchPro(snapshot => !snapshot.writable)
  const [editing, setEditing] = useState<CliDraft | undefined>()
  const adapters = adaptersOf(text)
  const rows = customRows(adapters)
  const taken = rows.map(row => row.id)
  const open = (mode: 'new' | 'edit', id: string, spec: Json): void => setEditing(draftOf(mode, id, spec))
  const entry = (id: string): Json => customEntries(adapters).find(([key]) => key === id)?.[1] ?? {}
  const remove = (id: string): void => { const next = withAdapter(text, id, undefined); if (next !== undefined) card.edit('cliAdapters', next) }
  return <>
    {adapters === undefined ? <p className={`${css.rowHint} wsp-bad`} role="alert">{t('platformChainBad').replace('platformBackends', 'cliAdapters')}</p> : null}
    <div className={css.list} data-wsp-cli-list>
      {rows.length === 0 ? <p className={css.empty}>{t('cliEmpty')}</p> : rows.map(row => <Item key={row.id} data={row.id}
        title={<code>{row.id}</code>}
        badges={<>
          {row.engine ? <Badge tone="info">{t('cliPurposeEngine')}</Badge> : null}
          {row.platforms.length ? <Badge tone="neutral">{fill(t('cliPurposePlatforms'), { list: row.platforms.join(', ') })}</Badge> : null}
          {!row.engine && !row.platforms.length ? <Badge tone="warning">{t('cliPurposeNone')}</Badge> : null}
          <Badge tone="neutral">{fill(t('orderConfidenceBadge'), { c: row.confidence })}</Badge>
          <Badge tone={row.problems.length ? 'danger' : 'success'}>{row.problems.length ? t('stateSpecBad') + ' · ' + row.problems.length : t('stateSpecOk')}</Badge>
        </>}
        meta={row.problems.length ? row.problems[0] : row.bin + ' ' + argvPreview(entry(row.id))}
        actions={<>
          <Btn disabled={disabled} onClick={() => open('edit', row.id, entry(row.id))} data="cli-edit">{t('edit')}</Btn>
          <Btn disabled={disabled} onClick={() => open('new', freeId(row.id + '-copy', taken), structuredClone(entry(row.id)))} data="cli-copy">{t('cliCopy')}</Btn>
          <Btn danger disabled={disabled} title={t('cliDeleteNote')} onClick={() => remove(row.id)} data="cli-delete">{t('cliDelete')}</Btn>
        </>} />)}
    </div>
    <div className={css.actions}>
      <Btn disabled={disabled || adapters === undefined} onClick={() => open('new', freeId('mycli', taken), newSpec())} data="cli-add">＋ {t('cliAdd')}</Btn>
      <Btn disabled={disabled || adapters === undefined} onClick={() => open('new', freeId('echo', taken), echoSpec())} data="cli-add-example">{t('cliAddExample')}</Btn>
    </div>
    {editing ? <CliDialog key={editing.mode + editing.id} card={card} initial={editing} taken={taken} onClose={() => setEditing(undefined)} /> : null}
  </>
}

/** The argument template as one line, for the list's meta text. */
function argvPreview(spec: Json): string {
  const search = spec.search as { argv?: unknown } | undefined
  return Array.isArray(search?.argv) ? search.argv.filter((token): token is string => typeof token === 'string').join(' ') : ''
}

export function CliGroup({ card }: { card: Card }) {
  const { t } = card
  const n = useOverriddenCount(card, ['cliAdapters'])
  return <Group id="cli" title={t('groupCli')} summary={t('groupCliSub')} badges={n ? <Badge tone="info">{fill(t('overriddenCount'), { n })}</Badge> : null}>
    <p className={css.rowHint}>{t('cliIntroNote')}</p>
    <CliList card={card} />
  </Group>
}
