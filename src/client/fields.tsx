import type { ReactNode } from 'react'
import type { CredentialId, CardFieldState, SettingField } from './form.ts'
import type { SettingsCardProps } from './index.ts'
import { styles as css } from './styles.ts'

interface FieldShellProps {
  id: string
  label: string
  hint: string
  field?: SettingField
  state?: CardFieldState
  disabled: boolean
  resetLabel: string
  invalidLabel: string
  onReset?: (field: SettingField) => void
  children: ReactNode
}
function FieldShell(props: FieldShellProps) {
  return (
    <div className={`${css.field} ${props.state?.invalid ? css.fieldInvalid : ''}`}>
      <div className={css.fieldHeading}>
        <label className={css.label} htmlFor={props.id}>{props.label}</label>
        {props.field && props.state?.overridden ? (
          <button
            type="button"
            className={css.reset}
            disabled={props.disabled}
            onClick={() => { props.onReset?.(props.field as SettingField) }}
          >
            {props.resetLabel}
          </button>
        ) : null}
      </div>
      {props.children}
      <p className={css.hint}>{props.state?.invalid ? props.invalidLabel : props.hint}</p>
    </div>
  )
}

export function TextField(props: {
  field: SettingField
  state: CardFieldState
  label: string
  hint: string
  disabled: boolean
  t: SettingsCardProps['t']
  edit: SettingsCardProps['edit']
  reset: SettingsCardProps['resetField']
  type?: 'text' | 'number'
}) {
  const id = `web-search-pro-${props.field}`
  return (
    <FieldShell
      id={id}
      label={props.label}
      hint={props.hint}
      field={props.field}
      state={props.state}
      disabled={props.disabled}
      resetLabel={props.t('reset')}
      invalidLabel={props.t('invalid')}
      onReset={props.reset}
    >
      <input
        id={id}
        className={css.input}
        type={props.type ?? 'text'}
        inputMode={props.type === 'number' ? 'decimal' : undefined}
        value={props.state.text}
        disabled={props.disabled}
        aria-invalid={props.state.invalid || undefined}
        onChange={event => { props.edit(props.field, event.currentTarget.value) }}
      />
    </FieldShell>
  )
}

export function JsonField(props: {
  field: SettingField
  state: CardFieldState
  label: string
  hint: string
  disabled: boolean
  rows?: number
  t: SettingsCardProps['t']
  edit: SettingsCardProps['edit']
  reset: SettingsCardProps['resetField']
}) {
  const id = `web-search-pro-${props.field}`
  return (
    <FieldShell
      id={id}
      label={props.label}
      hint={props.hint}
      field={props.field}
      state={props.state}
      disabled={props.disabled}
      resetLabel={props.t('reset')}
      invalidLabel={props.t('invalidJson')}
      onReset={props.reset}
    >
      <textarea
        id={id}
        className={`${css.input} ${css.textarea} ${css.code}`}
        rows={props.rows ?? 5}
        value={props.state.text}
        disabled={props.disabled}
        spellCheck={false}
        aria-invalid={props.state.invalid || undefined}
        onChange={event => { props.edit(props.field, event.currentTarget.value) }}
      />
    </FieldShell>
  )
}

export function ToggleField(props: {
  field: SettingField
  state: CardFieldState
  label: string
  hint: string
  disabled: boolean
  t: SettingsCardProps['t']
  edit: SettingsCardProps['edit']
  reset: SettingsCardProps['resetField']
}) {
  const checked = props.state.text === 'true'
  return (
    <div className={css.toggleField}>
      <label className={css.toggleLabel}>
        <input
          className={css.checkbox}
          type="checkbox"
          checked={checked}
          disabled={props.disabled}
          onChange={event => { props.edit(props.field, String(event.currentTarget.checked)) }}
        />
        <span className={css.toggleCopy}>
          <span className={css.label}>{props.label}</span>
          <span className={css.hint}>{props.hint}</span>
        </span>
      </label>
      {props.state.overridden ? (
        <button type="button" className={css.reset} disabled={props.disabled} onClick={() => { props.reset(props.field) }}>
          {props.t('reset')}
        </button>
      ) : null}
    </div>
  )
}

export function CredentialField(props: {
  id: CredentialId
  label: string
  hint: string
  state: { text: string; configured: boolean; writable: boolean; loading: boolean }
  disabled: boolean
  t: SettingsCardProps['t']
  edit: SettingsCardProps['editCredential']
}) {
  const inputId = `web-search-pro-credential-${props.id}`
  const status = props.state.loading
    ? props.t('credentialChecking')
    : props.state.configured ? props.t('credentialSet') : props.t('credentialUnset')
  return (
    <FieldShell
      id={inputId}
      label={props.label}
      hint={props.hint}
      disabled={props.disabled || !props.state.writable}
      resetLabel={props.t('reset')}
      invalidLabel={props.t('invalid')}
    >
      <div className={css.secretRow}>
        <input
          id={inputId}
          className={css.input}
          type="password"
          autoComplete="new-password"
          value={props.state.text}
          placeholder={status}
          disabled={props.disabled || !props.state.writable}
          onChange={event => { props.edit(props.id, event.currentTarget.value) }}
        />
        <span className={css.credentialStatus} data-configured={props.state.configured ? 'true' : undefined}>{status}</span>
      </div>
    </FieldShell>
  )
}
