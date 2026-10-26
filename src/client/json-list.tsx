/**
 * The settings that are whole JSON objects (custom providers, platform backend chains, CLI adapters, custom platforms, ...) as a
 * list: a row each (name, how many entries it holds, "default" while it is empty) and one dialog with a code box and the
 * server's own validation message. Nothing here is a second place the data lives: the box edits the same staged field.
 * @module web-search-pro/client/json-list
 */

import { useState } from 'react'
import { fill, rowLabels, stateOf, useField, type Card, type LabelKey } from './field-rows.tsx'
import { hasHelp, JSON_FIELDS, labelKey } from './field-keys.ts'
import { styles as css } from './styles.ts'
import { Badge, Btn, Dialog, Item, Row } from './ui-kit.tsx'

/** How many entries a JSON object text holds; undefined when it is not an object. */
export function entryCount(text: string): number | undefined {
  if (text.trim() === '') return 0
  try {
    const value = JSON.parse(text) as unknown
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : undefined
  } catch { return undefined }
}

/** The code box of one JSON field. */
export function JsonForm({ card, field }: { card: Card; field: string }) {
  const { t } = card
  const f = useField(card, field)
  const key = labelKey(field)
  const id = `web-search-pro-${field}`
  const st = f.state
  return <Row field={field} id={id} label={t(key as LabelKey)} hint={t(`${key}Hint` as LabelKey)} help={hasHelp(field) ? t(`${key}Help` as LabelKey) : undefined}
    overridden={st.overridden} invalid={st.invalid || !!st.message} problem={st.message ?? t('invalidJson')} warning={st.warning} disabled={f.disabled} labels={rowLabels(t)} onReset={f.reset} wide>
    <textarea id={id} className={`${css.input} ${css.textarea} ${css.code} ${st.invalid ? css.invalidInput : ''}`} rows={12} spellCheck={false} value={st.text} disabled={f.disabled}
      aria-invalid={st.invalid || undefined} onChange={event => f.edit(event.currentTarget.value)} />
  </Row>
}

function JsonItem({ card, field, onEdit }: { card: Card; field: string; onEdit: () => void }) {
  const { t } = card
  const st = card.useWebSearchPro(snapshot => stateOf(snapshot, field)!)
  const disabled = card.useWebSearchPro(snapshot => !snapshot.writable)
  const n = entryCount(st.text)
  const key = labelKey(field)
  return <Item data={field} title={t(key as LabelKey)}
    badges={<>
      <Badge tone={st.invalid ? 'danger' : st.overridden ? 'info' : 'outline'}>{st.invalid ? t('invalid') : st.overridden ? t('overridden') : t('promptStateDefault')}</Badge>
      {n ? <Badge tone="neutral">{fill(t('jsonEntries'), { n })}</Badge> : null}
    </>}
    meta={t(`${key}Hint` as LabelKey)} actions={<Btn disabled={disabled} onClick={onEdit} data="json-edit">{t('edit')}</Btn>} />
}

/** A list of JSON-object settings with its dialog. `fields` names which ones (see JSON_FIELDS). */
export function JsonList({ card, fields }: { card: Card; fields: readonly string[] }) {
  const { t } = card
  const [editing, setEditing] = useState<string | undefined>()
  return <>
    <div className={css.list} data-wsp-json-list>
      {fields.map(field => <JsonItem key={field} card={card} field={field} onEdit={() => setEditing(field)} />)}
    </div>
    {editing ? <Dialog open wide title={fill(t('jsonDialogTitle'), { name: t(labelKey(editing) as LabelKey) })} closeLabel={t('close')} description={t('jsonDialogHint')} onClose={() => setEditing(undefined)}
      footer={<Btn primary onClick={() => setEditing(undefined)} data="json-done">{t('done')}</Btn>}>
      <JsonForm card={card} field={editing} />
    </Dialog> : null}
  </>
}

/** The fields of one group of JSON settings. */
export const jsonFieldsOf = (group: 'judge' | 'runtime' | 'platform'): string[] => JSON_FIELDS.filter(entry => entry.group === group).map(entry => entry.field)
