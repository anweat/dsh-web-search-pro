/**
 * Rows for the configuration fields the groups edit, wired to the card's staged form state.
 *
 * One component per control kind (switch, select, text, number, list of ids). Each is the single entry of its field: it renders
 * `data-wsp-field="<field>"`, which test/settings-card-render.test.ts counts, and it reads the label, the one-line hint and the
 * optional `?` text from the dictionary by the field's name (`<key>`, `<key>Hint`, `<key>Help`, see field-keys.ts).
 * @module web-search-pro/client/field-rows
 */

import type { ReactNode } from 'react'
import type { SettingsCardProps } from './index.ts'
import type { CardFieldState, WebSearchCardState } from './form.ts'
import { hasHelp, labelKey } from './field-keys.ts'
import { Chips, Row, Select, TextInput, Toggle, UnitInput, type RowLabels, type SelectOption } from './ui-kit.tsx'

export type Card = SettingsCardProps
export type Translator = Card['t']
export type LabelKey = Parameters<Translator>[0]

/** Fill `{name}` placeholders of a dictionary entry. */
export const fill = (text: string, values: Record<string, string | number>): string => text.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ''))

export function rowLabels(t: Translator): RowLabels {
  return { overridden: t('overridden'), reset: t('reset'), help: t('helpLabel'), invalid: t('invalid') }
}

/** The id of a field's control, tied to its label. */
export const controlId = (field: string): string => `web-search-pro-${field}`

/** The units a number field is written with. */
const UNIT_KEYS = { ms: 'unitMs', sec: 'unitSeconds', chars: 'unitChars', count: 'unitCount', tokens: 'unitTokens', days: 'unitDays', rounds: 'unitCount' } as const
export type Unit = keyof typeof UNIT_KEYS

export interface FieldProps {
  card: Card
  /** The setting field this row is the entry of. */
  field: string
  /** Replaces the dictionary hint. */
  hint?: string
  placeholder?: string
  /** Replaces the dictionary label. */
  label?: string
  /** A short warning badge beside the label. */
  risk?: string
  /** Hide the "overridden" badge and reset: for fields whose "default" is a computed one. */
  code?: boolean
}

/** How many of these fields carry an override: the number a group's badge shows. */
export function useOverriddenCount(card: Card, fields: readonly string[]): number {
  return card.useWebSearchPro(snapshot => fields.filter(field => snapshot.fields[field as keyof typeof snapshot.fields]?.overridden).length)
}

/** The staged state of a field. */
export const stateOf = (snapshot: WebSearchCardState, field: string): CardFieldState | undefined => snapshot.fields[field as keyof typeof snapshot.fields]

export function useField(card: Card, field: string) {
  const state = card.useWebSearchPro(snapshot => stateOf(snapshot, field)!)
  const disabled = card.useWebSearchPro(snapshot => !snapshot.writable || snapshot.saving)
  return { state, disabled, edit: (text: string) => card.edit(field as never, text), reset: () => card.resetField(field as never) }
}

function rowFor(props: FieldProps, field: ReturnType<typeof useField>, children: ReactNode, extra: { id?: string; inline?: boolean; wide?: boolean } = {}) {
  const { card } = props
  const { t } = card
  const key = labelKey(props.field)
  const st = field.state
  return <Row field={props.field} id={extra.id} label={props.label ?? t(key as LabelKey)} hint={props.hint ?? t(`${key}Hint` as LabelKey)}
    help={hasHelp(props.field) ? t(`${key}Help` as LabelKey) : undefined} risk={props.risk}
    overridden={st.overridden} invalid={st.invalid || !!st.message} problem={st.message ?? t('invalid')} warning={st.warning} disabled={field.disabled}
    labels={rowLabels(t)} onReset={field.reset} inline={extra.inline} wide={extra.wide}>{children}</Row>
}

/** A boolean field as a switch. */
export function SwitchRow(props: FieldProps) {
  const field = useField(props.card, props.field)
  const label = props.label ?? props.card.t(labelKey(props.field) as LabelKey)
  return rowFor(props, field, <Toggle label={label} checked={field.state.text === 'true'} disabled={field.disabled} onChange={next => field.edit(String(next))} />, { inline: true })
}

/** An enumerated field as a drop-down. */
export function SelectRow(props: FieldProps & { options: readonly SelectOption[] }) {
  const field = useField(props.card, props.field)
  const id = controlId(props.field)
  return rowFor(props, field, <Select id={id} value={field.state.text} options={props.options} disabled={field.disabled} muted={!field.state.overridden} invalid={field.state.invalid} onChange={field.edit} />, { id })
}

/** A free-text field. */
export function TextRow(props: FieldProps) {
  const field = useField(props.card, props.field)
  const id = controlId(props.field)
  return rowFor(props, field, <TextInput id={id} value={field.state.text} placeholder={props.placeholder} code={props.code} disabled={field.disabled} muted={!field.state.overridden} invalid={field.state.invalid} onChange={field.edit} />, { id })
}

/** A number field with its unit written after the input. */
export function NumberRow(props: FieldProps & { unit?: Unit }) {
  const field = useField(props.card, props.field)
  const id = controlId(props.field)
  const input = props.unit
    ? <UnitInput id={id} value={field.state.text} unit={props.card.t(UNIT_KEYS[props.unit] as LabelKey)} placeholder={props.placeholder} disabled={field.disabled} muted={!field.state.overridden} invalid={field.state.invalid} onChange={field.edit} />
    : <TextInput id={id} value={field.state.text} placeholder={props.placeholder} numeric disabled={field.disabled} muted={!field.state.overridden} invalid={field.state.invalid} onChange={field.edit} />
  return rowFor(props, field, input, { id })
}

const parseList = (text: string): string[] => [...new Set(text.split(',').map(item => item.trim()).filter(Boolean))]

/** A comma-separated list (engine ids, domains) as removable chips with an add box. */
export function ListRow(props: FieldProps) {
  const field = useField(props.card, props.field)
  const id = controlId(props.field)
  const { t } = props.card
  return rowFor(props, field, <Chips id={id} values={parseList(field.state.text)} placeholder={props.placeholder} disabled={field.disabled} removeLabel={t('chipRemove')} addLabel={t(labelKey(props.field) as LabelKey)}
    onChange={values => field.edit(values.join(', '))} />, { id, wide: true })
}

export { parseList }
