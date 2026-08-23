import { useState } from 'react'
import type { SettingsCardProps } from './index.ts'
import { CredentialField, JsonField, TextField, ToggleField } from './fields.tsx'
import { styles as css } from './styles.ts'

export function SettingsCard(props: SettingsCardProps) {
  const { t } = props
  const state = props.useWebSearchPro(snapshot => snapshot)
  const [open, setOpen] = useState(false)

  if (!state.available) return null
  const disabled = !state.writable || state.saving
  const text = (field: keyof typeof state.fields, label: Parameters<typeof t>[0], hint: Parameters<typeof t>[0], type?: 'text' | 'number') => (
    <TextField field={field} state={state.fields[field]} label={t(label)} hint={t(hint)} disabled={disabled} t={t} edit={props.edit} reset={props.resetField} type={type} />
  )
  const toggle = (field: keyof typeof state.fields, label: Parameters<typeof t>[0], hint: Parameters<typeof t>[0]) => (
    <ToggleField field={field} state={state.fields[field]} label={t(label)} hint={t(hint)} disabled={disabled} t={t} edit={props.edit} reset={props.resetField} />
  )
  const json = (field: keyof typeof state.fields, label: Parameters<typeof t>[0], hint: Parameters<typeof t>[0], rows?: number) => (
    <JsonField field={field} state={state.fields[field]} label={t(label)} hint={t(hint)} disabled={disabled} t={t} edit={props.edit} reset={props.resetField} rows={rows} />
  )

  return (
    <li className={`${css.card} ${open ? css.cardOpen : ''}`} data-web-search-pro-settings>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.titleRow}>
            <span className={css.name}>{t('title')}</span>
            {state.dirty ? <span className={css.dirtyBadge}>{t('unsaved')}</span> : null}
          </span>
          <span className={css.description}>{t('description')}</span>
        </span>
        <svg className={`${css.chevron} ${open ? css.chevronOpen : ''}`} viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
          <path d="M3.5 5.5 7 9l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className={css.body}>
          {!state.writable ? <p className={css.notice} role="status">{t('readOnly')}</p> : null}

          <section className={css.section} aria-labelledby="web-search-pro-search-heading">
            <div className={css.sectionHeading}>
              <h3 id="web-search-pro-search-heading">{t('searchSection')}</h3>
              <p>{t('searchSectionHint')}</p>
            </div>
            <div className={css.grid}>
              {text('engines', 'engines', 'enginesHint')}
              {text('searchMaxResults', 'searchMaxResults', 'searchMaxResultsHint', 'number')}
              {text('timeoutMs', 'timeoutMs', 'timeoutMsHint', 'number')}
              {toggle('parallelEngines', 'parallelEngines', 'parallelEnginesHint')}
            </div>
          </section>

          <section className={css.section} aria-labelledby="web-search-pro-credentials-heading">
            <div className={css.sectionHeading}>
              <h3 id="web-search-pro-credentials-heading">{t('credentialsSection')}</h3>
              <p>{t('credentialsSectionHint')}</p>
            </div>
            <div className={css.grid}>
              {text('exaApiKeyEnv', 'exaApiKeyEnv', 'credentialRefHint')}
              <CredentialField id="exa" label={t('exaApiKey')} hint={t('credentialWriteOnlyHint')} state={state.credentials.exa} disabled={disabled} t={t} edit={props.editCredential} />
              {text('jinaApiKeyEnv', 'jinaApiKeyEnv', 'credentialRefHint')}
              <CredentialField id="jina" label={t('jinaApiKey')} hint={t('credentialWriteOnlyHint')} state={state.credentials.jina} disabled={disabled} t={t} edit={props.editCredential} />
              {text('githubTokenEnv', 'githubTokenEnv', 'credentialRefHint')}
              <CredentialField id="github" label={t('githubToken')} hint={t('credentialWriteOnlyHint')} state={state.credentials.github} disabled={disabled} t={t} edit={props.editCredential} />
            </div>
          </section>

          <section className={css.section} aria-labelledby="web-search-pro-runtime-heading">
            <div className={css.sectionHeading}>
              <h3 id="web-search-pro-runtime-heading">{t('runtimeSection')}</h3>
              <p>{t('runtimeSectionHint')}</p>
            </div>
            <div className={css.grid}>
              {toggle('enableCliBackends', 'enableCliBackends', 'enableCliBackendsHint')}
              {toggle('opencliEnabled', 'opencliEnabled', 'opencliEnabledHint')}
              {toggle('agentReachEnabled', 'agentReachEnabled', 'agentReachEnabledHint')}
              {toggle('registerProvider', 'registerProvider', 'registerProviderHint')}
              {text('providerId', 'providerId', 'providerIdHint')}
              {json('playwright', 'playwright', 'playwrightHint', 4)}
            </div>
          </section>

          <details className={css.advanced}>
            <summary>{t('advancedSection')}</summary>
            <p className={css.advancedHint}>{t('advancedSectionHint')}</p>
            <div className={css.grid}>
              {text('ttlSeconds', 'ttlSeconds', 'ttlSecondsHint', 'number')}
              {text('memoryCacheEntries', 'memoryCacheEntries', 'memoryCacheEntriesHint', 'number')}
              {text('rrfConstant', 'rrfConstant', 'rrfConstantHint', 'number')}
              {text('freshnessBoost', 'freshnessBoost', 'boostHint', 'number')}
              {text('freshnessDays', 'freshnessDays', 'freshnessDaysHint', 'number')}
              {text('authorityBoost', 'authorityBoost', 'boostHint', 'number')}
              {text('authorityDomains', 'authorityDomains', 'authorityDomainsHint')}
              {text('dbPath', 'dbPath', 'dbPathHint')}
              {json('platformRules', 'platformRules', 'platformRulesHint')}
              {json('customPlatforms', 'customPlatforms', 'customPlatformsHint', 7)}
              {json('browserBindings', 'browserBindings', 'browserBindingsHint', 7)}
              {toggle('verbose', 'verbose', 'verboseHint')}
            </div>
          </details>

          <div className={css.footer}>
            <p className={state.failed ? css.failed : css.status} role="status" aria-live="polite">
              {state.failed ? t('saveFailed') : state.invalid ? t('invalidSave') : state.dirty ? t('pendingSave') : t('saved')}
            </p>
            <div className={css.actions}>
              <button type="button" className={css.secondaryButton} disabled={!state.dirty || state.saving} onClick={props.discard}>{t('discard')}</button>
              <button type="button" className={css.primaryButton} disabled={!state.dirty || state.invalid || state.saving || !state.writable} onClick={props.save}>
                {t(state.saving ? 'saving' : 'save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </li>
  )
}
