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

import { useState, type ReactNode } from 'react'
import { Button, Modal, Switch, Tag, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { styles as css } from './styles.ts'

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'outline'

/** A read-only badge. */
export function Badge(props: { tone?: Tone; children: ReactNode }) {
  return <Tag tone={props.tone ?? 'neutral'}>{props.children}</Tag>
}

/** The mark of a setting an agent changed: a warning badge whose tooltip carries the value, the reason and the time. */
export function AgentTag(props: { label: string; tip: string }) {
  return <Tooltip label={props.tip} portal maxWidth={360} side="top">
    <span className="wsp-agent-tag" tabIndex={0} aria-label={props.tip}><Badge tone="warning">{props.label}</Badge></span>
  </Tooltip>
}

/** The `?` button: its text opens on click, so a long explanation costs one glyph until someone asks. */
export function Help(props: { label: string; text: string }) {
  return <Tooltip label={props.text} openOnClick portal maxWidth={360} side="top">
    <button type="button" className={css.help} aria-label={props.label} data-wsp-help>?</button>
  </Tooltip>
}

/** Labels every row shares, so a row does not need the dictionary itself. */
export interface RowLabels {
  overridden: string
  reset: string
  help: string
  invalid: string
}

export interface RowProps {
  /** The configuration field this row is the entry of (one per public field; the render test counts them). */
  field?: string
  /** The id of the control, so the label is tied to it. */
  id?: string
  label: string
  /** One short sentence. Anything longer belongs in `help`. */
  hint?: string
  help?: string
  overridden?: boolean
  invalid?: boolean
  /** Replaces the hint while the value is invalid. */
  problem?: string
  /** Accepted, but unlikely to do what was meant: a second line under the hint. */
  warning?: string
  /** A small grey line under the hint: a range, a default. */
  meta?: string
  /** A short warning badge beside the label, for a setting that widens what an agent may do. */
  risk?: string
  /** The setting is read when the plugin starts: a badge saying so, with a `?` explaining why; `touched` picks it out while an edit of it is waiting to be saved. */
  restart?: { badge: string; why: string; touched?: boolean }
  /** Extra controls beside the label (the "changed by the agent" mark with its adopt / revoke buttons). */
  mark?: ReactNode
  disabled?: boolean
  labels: RowLabels
  onReset?: () => void
  /** Control placement: beside the text (default) or on its own line. */
  wide?: boolean
  inline?: boolean
  children: ReactNode
}

/** One setting: label, one-line hint, an optional `?`, the "overridden" badge with its reset, and the control. */
export function Row(props: RowProps) {
  const { labels } = props
  return <div className={`${css.row} ${props.wide ? 'wsp-row-wide' : ''}`} data-wsp-field={props.field} data-wsp-overridden={props.overridden ? 'true' : undefined}>
    <div className={css.rowText}>
      <div className={css.rowLabel}>
        {props.id ? <label htmlFor={props.id}>{props.label}</label> : <span>{props.label}</span>}
        {props.help ? <Help label={labels.help} text={props.help} /> : null}
        {props.risk ? <Badge tone="warning">{props.risk}</Badge> : null}
        {props.restart ? <span className="wsp-restart" data-wsp-restart={props.field}><Badge tone={props.restart.touched ? 'warning' : 'outline'}>{props.restart.badge}</Badge><Help label={labels.help} text={props.restart.why} /></span> : null}
        {props.mark}
        {props.overridden ? <Badge tone="info">{labels.overridden}</Badge> : null}
        {props.overridden && props.onReset ? <button type="button" className={css.link} disabled={props.disabled} onClick={props.onReset} data-wsp-reset={props.field}>{labels.reset}</button> : null}
      </div>
      {props.invalid && props.problem
        ? <p className={`${css.rowHint} wsp-bad`} role="alert">{props.problem}</p>
        : props.hint || props.meta ? <p className={css.rowHint}>{props.hint}{props.meta ? <span className={css.rowMeta}>{props.hint ? ' · ' : ''}{props.meta}</span> : null}</p> : null}
      {props.warning ? <p className={css.rowHint} role="note" data-wsp-warning>! {props.warning}</p> : null}
    </div>
    <div className={`${css.rowControl} ${props.inline ? 'wsp-inline' : ''}`}>{props.children}</div>
  </div>
}

/** A closed-by-default fold inside a group, for the items few people need. */
export function Fold(props: { id: string; title: string; hint?: string; children: ReactNode }) {
  return <details className={css.fold} data-wsp-fold={props.id}>
    <summary>{props.title}{props.hint ? <span className={css.foldHint}> · {props.hint}</span> : null}</summary>
    <div className={css.foldBody}>{props.children}</div>
  </details>
}

/** A small heading inside a group, for sets of rows that belong together. */
export function SubHead(props: { children: ReactNode }) {
  return <div className={css.subHead} role="presentation">{props.children}</div>
}

/**
 * One group of the card, an accordion item. `<details>` keeps every control in the document while the group is
 * closed (so a server-rendered check still sees them) and gives keyboard and screen-reader behavior for free.
 */
export function Group(props: { id: string; title: string; summary?: string; badges?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  return <details className={css.group} open={props.defaultOpen ? true : undefined} data-wsp-group={props.id}>
    <summary className={css.groupHead}>
      <span className={css.groupTitle}><strong>{props.title}</strong>{props.summary ? <span className={css.groupSub}>{props.summary}</span> : null}</span>
      {props.badges ? <span className={css.groupBadges}>{props.badges}</span> : null}
    </summary>
    <div className={css.groupBody}>{props.children}</div>
  </details>
}

export interface SelectOption { value: string; label: string }

/**
 * A native select. A stored value that is not among the options (a channel the list does not know, an older
 * enum value) is shown as its own entry instead of being silently replaced by the first option.
 */
export function Select(props: { id?: string; value: string; options: readonly SelectOption[]; onChange: (value: string) => void; disabled?: boolean; muted?: boolean; invalid?: boolean; ariaLabel?: string }) {
  const known = props.options.some(option => option.value === props.value)
  const options = known || props.value === '' ? props.options : [{ value: props.value, label: props.value }, ...props.options]
  return <select id={props.id} className={`${css.select} ${props.muted ? css.muted : ''}`} value={props.value} disabled={props.disabled} aria-label={props.ariaLabel} aria-invalid={props.invalid || undefined}
    onChange={event => props.onChange(event.currentTarget.value)}>
    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>
}

/** A single-line text input; `muted` greys the value while it is only the inherited default. */
export function TextInput(props: { id?: string; value: string; onChange: (value: string) => void; placeholder?: string; disabled?: boolean; muted?: boolean; invalid?: boolean; list?: string; numeric?: boolean; ariaLabel?: string; code?: boolean; small?: boolean; autoFocus?: boolean; onBlur?: () => void }) {
  return <input id={props.id} type="text" className={`${css.input} ${props.muted ? css.muted : ''} ${props.invalid ? css.invalidInput : ''} ${props.code ? css.code : ''} ${props.numeric ? 'wsp-num' : ''} ${props.small ? 'wsp-sm' : ''}`}
    value={props.value} placeholder={props.placeholder} disabled={props.disabled} list={props.list} inputMode={props.numeric ? 'numeric' : undefined} spellCheck={false}
    aria-label={props.ariaLabel} aria-invalid={props.invalid || undefined} autoFocus={props.autoFocus} onBlur={props.onBlur} onChange={event => props.onChange(event.currentTarget.value)} />
}

/** A text input followed by a fixed unit. */
export function UnitInput(props: { id?: string; value: string; unit: string; onChange: (value: string) => void; placeholder?: string; disabled?: boolean; muted?: boolean; invalid?: boolean; ariaLabel?: string }) {
  return <span className={css.unitInput}>
    <TextInput id={props.id} value={props.value} onChange={props.onChange} placeholder={props.placeholder} disabled={props.disabled} muted={props.muted} invalid={props.invalid} numeric ariaLabel={props.ariaLabel} />
    <span className={css.unit}>{props.unit}</span>
  </span>
}

/** The Host's switch, named by its row. */
export function Toggle(props: { label: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return <Switch label={props.label} checked={props.checked} disabled={props.disabled} onChange={props.onChange} />
}

/** A list of short strings as removable chips with an add box (Enter or comma adds; Backspace on an empty box removes the last). */
export function Chips(props: {
  id?: string; values: readonly string[]; onChange: (values: string[]) => void; placeholder?: string; disabled?: boolean
  /** Why a new entry is refused, or undefined. */
  check?: (value: string, existing: readonly string[]) => string | undefined
  removeLabel: string; addLabel: string
}) {
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | undefined>()
  const commit = (raw: string) => {
    const value = raw.trim()
    if (value === '') { setDraft(''); setProblem(undefined); return }
    const refused = props.check?.(value, props.values)
    if (refused) { setProblem(refused); return }
    if (!props.values.includes(value)) props.onChange([...props.values, value])
    setDraft(''); setProblem(undefined)
  }
  return <div className={css.stack}>
    <div className={css.chips} data-wsp-chips>
      {props.values.map(value => <span key={value} className={css.chip}><span>{value}</span>
        <button type="button" className={css.chipRemove} disabled={props.disabled} aria-label={`${props.removeLabel}: ${value}`} onClick={() => props.onChange(props.values.filter(entry => entry !== value))}>×</button></span>)}
      <input id={props.id} className={css.chipInput} value={draft} placeholder={props.placeholder} disabled={props.disabled} aria-label={props.addLabel} spellCheck={false}
        onChange={event => { const text = event.currentTarget.value; if (text.endsWith(',')) commit(text.slice(0, -1)); else setDraft(text) }}
        onBlur={() => { if (draft.trim() !== '') commit(draft) }}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); commit(draft) }
          else if (event.key === 'Backspace' && draft === '' && props.values.length) props.onChange(props.values.slice(0, -1))
        }} />
    </div>
    {problem ? <p className={`${css.rowHint} wsp-bad`} role="alert">{problem}</p> : null}
  </div>
}

/** A dialog on the Host's modal: a title, a scrolling body, and a footer of actions. */
export function Dialog(props: { open: boolean; title: string; closeLabel: string; description?: string; onClose: () => void; footer?: ReactNode; wide?: boolean; children: ReactNode }) {
  return <Modal open={props.open} onClose={props.onClose} title={props.title} closeLabel={props.closeLabel} description={props.description} footer={props.footer}
    className={`wsp-modal ${props.wide ? 'wsp-modal-wide' : ''}`} contentClassName="wsp-modal-content">
    <div className={css.dialogBody}>{props.children}</div>
  </Modal>
}

/** Primary and secondary buttons at the card's size. */
export function Btn(props: { children: ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean; danger?: boolean; title?: string; data?: string; ariaLabel?: string }) {
  return <Button type="button" variant={props.primary ? 'primary' : 'outline'} size="sm" disabled={props.disabled} title={props.title} aria-label={props.ariaLabel} className={props.danger ? css.danger : undefined} onClick={props.onClick} data-wsp-action={props.data}>{props.children}</Button>
}

/** A list row: a title with badges, a meta line, and actions on the right. */
export function Item(props: { title: ReactNode; badges?: ReactNode; meta?: ReactNode; actions?: ReactNode; data?: string }) {
  return <div className={css.item} data-wsp-item={props.data}>
    <div className={css.itemMain}>
      <div className={css.itemTitle}>{props.title}{props.badges}</div>
      {props.meta ? <div className={css.itemMeta}>{props.meta}</div> : null}
    </div>
    {props.actions ? <div className={css.itemActions}>{props.actions}</div> : null}
  </div>
}

/** A write-only secret input: it never shows a stored value, only whether one is configured. */
export function SecretInput(props: { id: string; value: string; onChange: (value: string) => void; status: string; configured: boolean; disabled?: boolean; ariaLabel?: string }) {
  return <span className={css.secretRow}>
    <input id={props.id} type="password" className={css.input} autoComplete="new-password" value={props.value} placeholder={props.status} disabled={props.disabled} spellCheck={false}
      aria-label={props.ariaLabel} onChange={event => props.onChange(event.currentTarget.value)} />
    <Badge tone={props.configured ? 'success' : 'neutral'}>{props.status}</Badge>
  </span>
}
