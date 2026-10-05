import { useState, type ReactNode } from 'react'
import type { SettingsCardProps } from './index.ts'
import { CredentialField, JsonField, SelectField, TextField, ToggleField } from './fields.tsx'
import { KEYED_SOURCES, type SettingField } from './form-specs.ts'
import { RubricEditor } from './RubricEditor.tsx'
import { ANONYMOUS_SOURCES, KEYED_NAMES } from './sources-table.ts'
import { styles as css } from './styles.ts'

type Label = Parameters<SettingsCardProps['t']>[0]

/** A collapsible group of settings; `defaultOpen` only decides how it starts. */
function Section(props: { id: string; title: string; hint: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className={css.section} open={props.defaultOpen || undefined} data-web-search-pro-section={props.id}>
      <summary className={css.sectionSummary}>
        <div className={css.sectionHeading}>
          <h3>{props.title}</h3>
          <p>{props.hint}</p>
        </div>
      </summary>
      <div className={css.sectionBody}>{props.children}</div>
    </details>
  )
}

export function SettingsCard(props: SettingsCardProps) {
  const { t } = props
  const state = props.useWebSearchPro(snapshot => snapshot)
  const [open, setOpen] = useState(true)

  if (props.view === 'summary') return t('description')

  if (!state.available) return null
  const disabled = !state.writable || state.saving
  const text = (field: SettingField, label: Label, hint: Label, type?: 'text' | 'number', placeholder?: string) => (
    <TextField field={field} state={state.fields[field]} label={t(label)} hint={t(hint)} disabled={disabled} t={t} edit={props.edit} reset={props.resetField} type={type} placeholder={placeholder} />
  )
  const toggle = (field: SettingField, label: Label, hint: Label) => (
    <ToggleField field={field} state={state.fields[field]} label={t(label)} hint={t(hint)} disabled={disabled} t={t} edit={props.edit} reset={props.resetField} />
  )
  const json = (field: SettingField, label: Label, hint: Label, rows?: number) => (
    <JsonField field={field} state={state.fields[field]} label={t(label)} hint={t(hint)} disabled={disabled} t={t} edit={props.edit} reset={props.resetField} rows={rows} />
  )
  const select = (field: SettingField, label: Label, hint: Label, options: readonly { value: string; label: string }[], emptyLabel?: string) => (
    <SelectField field={field} state={state.fields[field]} label={t(label)} hint={t(hint)} disabled={disabled} options={options} emptyLabel={emptyLabel} t={t} edit={props.edit} reset={props.resetField} />
  )
  const providers = state.providerChoices.map(id => ({ value: id, label: id }))
  const off = { value: 'off', label: t('optionOff') }
  const routeId = state.fields.providerId.text.trim() || 'web-search-pro'
  const credential = (id: Parameters<typeof props.editCredential>[0], label: Label, hint: Label = 'credentialWriteOnlyHint') => (
    <CredentialField id={id} label={t(label)} hint={t(hint)} state={state.credentials[id]} disabled={disabled} t={t} edit={props.editCredential} />
  )

  return (
    <div className={`${css.card} ${open ? css.cardOpen : ''}`} data-web-search-pro-settings>
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

          <Section id="search" title={t('searchSection')} hint={t('searchSectionHint')} defaultOpen>
            <div className={css.grid}>
              {text('engines', 'engines', 'enginesHint')}
              {text('searchMaxResults', 'searchMaxResults', 'searchMaxResultsHint', 'number')}
              {toggle('parallelEngines', 'parallelEngines', 'parallelEnginesHint')}
            </div>
          </Section>

          <Section id="network" title={t('networkSection')} hint={t('networkSectionHint')}>
            <div className={css.grid}>
              {toggle('allowProxyFakeIp', 'allowProxyFakeIp', 'allowProxyFakeIpHint')}
              {text('timeoutMs', 'timeoutMs', 'timeoutMsHint', 'number')}
            </div>
          </Section>

          <Section id="tool-surface" title={t('toolSurfaceSection')} hint={t('toolSurfaceSectionHint')}>
            <div className={css.grid}>
              {select('toolSurface', 'toolSurface', 'toolSurfaceHint', [{ value: 'indexed', label: t('optIndexed') }, { value: 'flat', label: t('optFlat') }])}
            </div>
          </Section>

          <Section id="route" title={t('routeSection')} hint={t('routeSectionHint')}>
            <div className={css.grid}>
              {toggle('registerProvider', 'registerProvider', 'registerProviderHint')}
              {text('providerId', 'providerId', 'providerIdHint')}
              {select('provider.evidence', 'providerEvidence', 'providerEvidenceHint', [{ value: 'auto', label: t('optAuto') }, { value: 'off', label: t('optOff') }])}
              {text('provider.deadlineMs', 'providerDeadlineMs', 'providerDeadlineMsHint', 'number')}
            </div>
            <div className={css.note} data-web-search-pro-route-help>
              <p><strong>{t('routeHelpTitle')}</strong></p>
              <p>{t('routeHelpIntro')}</p>
              <pre className={css.codeBlock}>{`- id: web\n  name: '@deepseek-ai/dsh-web'\n  config:\n    searchProvider: ${routeId}\n    fetchProvider: ${routeId}`}</pre>
              <p>{t('routeHelpAfter')}</p>
            </div>
          </Section>

          <Section id="evidence" title={t('evidenceSection')} hint={t('evidenceSectionHint')}>
            <div className={css.grid}>
              {toggle('evidence.autoProviders', 'evAutoProviders', 'evAutoProvidersHint')}
              {text('evidence.maxRounds', 'evMaxRounds', 'evMaxRoundsHint', 'number')}
              {text('evidence.maxQueries', 'evMaxQueries', 'evMaxQueriesHint', 'number')}
              {text('fetchDefaultChars', 'fetchDefaultChars', 'fetchDefaultCharsHint', 'number')}
              {text('exaContentsPerUrlChars', 'exaContentsPerUrlChars', 'exaContentsPerUrlCharsHint', 'number')}
              {text('exaContentsTotalChars', 'exaContentsTotalChars', 'exaContentsTotalCharsHint', 'number')}
            </div>
            <p className={css.note}>{t('evidenceNote')}</p>
          </Section>

          <Section id="judge" title={t('judgeSection')} hint={t('judgeSectionHint')}>
            <h4 className={css.subheading}>{t('judgeGroupModel')}</h4>
            <div className={css.grid}>
              {select('evidence.judge.mode', 'judgeMode', 'judgeModeHint', [off, { value: 'shadow', label: t('optShadow') }, { value: 'control', label: t('optControl') }, { value: 'hybrid', label: t('optHybrid') }])}
              {select('evidence.judge.provider', 'judgeProvider', 'judgeProviderHint', providers, t('emptyDefault'))}
              {toggle('evidence.hybridBorderline', 'hybridBorderline', 'hybridBorderlineHint')}
              {text('evidence.maxJevQuestions', 'maxJevQuestions', 'maxJevQuestionsHint', 'number')}
              {toggle('evidence.judge.allowLlm', 'allowLlm', 'allowLlmHint')}
            </div>
            <h4 className={css.subheading}>{t('judgeGroupCoverage')}</h4>
            <div className={css.grid}>
              {select('evidence.coverage.mode', 'coverageMode', 'coverageModeHint', [off, { value: 'shadow', label: t('optShadow') }, { value: 'control', label: t('optControl') }])}
              {select('evidence.coverage.provider', 'coverageProvider', 'coverageProviderHint', providers, t('emptyDefault'))}
              {text('evidence.coverage.thresholds.weak', 'thresholdWeak', 'thresholdWeakHint', 'number')}
              {text('evidence.coverage.thresholds.covered', 'thresholdCovered', 'thresholdCoveredHint', 'number')}
            </div>
            <h4 className={css.subheading}>{t('judgeGroupBudget')}</h4>
            <div className={css.grid}>
              {text('evidence.budget.perSearchInputTokens', 'budgetPerSearch', 'budgetPerSearchHint', 'number')}
              {text('evidence.budget.dailyInputTokens', 'budgetDaily', 'budgetDailyHint', 'number')}
              {text('evidence.budget.timezone', 'budgetTimezone', 'budgetTimezoneHint')}
              {json('evidence.budget.providers', 'budgetProviders', 'budgetProvidersHint', 4)}
            </div>
            <h4 className={css.subheading}>{t('judgeGroupProviders')}</h4>
            <div className={css.grid}>
              <div className={css.fullRow}>{json('evidence.judge.providers', 'judgeProviders', 'judgeProvidersHint', 9)}</div>
            </div>
          </Section>

          <Section id="prompts" title={t('promptsSection')} hint={t('promptsSectionHint')}>
            <RubricEditor t={t} state={state} disabled={disabled} editRubric={props.editRubric} startRubric={props.startRubric} restoreRubric={props.restoreRubric} />
          </Section>

          <Section id="sources" title={t('sourcesSection')} hint={t('sourcesSectionHint')}>
            <h4 className={css.subheading}>{t('strategyGroup')}</h4>
            <p className={css.hint} data-web-search-pro-strategy>{t('strategyNote')}</p>
            <div className={css.grid}>
              {select('evidence.sourcePolicy', 'sourcePolicy', 'sourcePolicyHint', [{ value: 'default', label: t('optPolicyDefault') }, { value: 'anonymous-only', label: t('optPolicyAnonymousOnly') }])}
              {text('sources.priority', 'srcPriority', 'srcPriorityHint', 'text', 'bocha, exa')}
              {text('sources.disabled', 'srcDisabled', 'srcDisabledHint')}
            </div>
            <h4 className={css.subheading}>{t('bochaGroup')}</h4>
            <div className={css.grid}>
              {text('bochaApiKeyEnv', 'bochaApiKeyEnv', 'bochaApiKeyEnvHint', 'text', 'BOCHA_SEARCH_API_KEY')}
              {credential('bocha', 'bochaApiKey')}
              {text('bochaBaseUrl', 'bochaBaseUrl', 'bochaBaseUrlHint', 'text', 'https://api.bocha.cn')}
              {toggle('bochaSummary', 'bochaSummary', 'bochaSummaryHint')}
              {text('sources.budget.bocha.total', 'reqTotal', 'reqTotalHint', 'number')}
              {text('sources.budget.bocha.daily', 'reqDaily', 'reqDailyHint', 'number')}
            </div>
            <p className={css.note} data-web-search-pro-req-budget>{t('reqBudgetGroup')}: {t('reqBudgetNote')}</p>
            <h4 className={css.subheading}>{t('keyedGroup')}</h4>
            <p className={css.hint}>{t('keyedGroupHint')}</p>
            {KEYED_SOURCES.map(({ id, defaultEnv }) => {
              const envField = `keyedSources.${id}.apiKeyEnv` as const
              const urlField = `keyedSources.${id}.baseUrl` as const
              const status = state.credentials[`keyed:${id}`]
              return (
                <details key={id} className={css.keyedSource} open={state.fields[envField].overridden || state.fields[urlField].overridden || state.fields[`sources.budget.${id}.total`].overridden || state.fields[`sources.budget.${id}.daily`].overridden || status.configured || undefined} data-web-search-pro-keyed={id}>
                  <summary>{KEYED_NAMES[id] ?? id}<span className={css.badge} data-on={status.configured || undefined}>{status.loading ? t('credentialChecking') : status.configured ? t('credentialSet') : t('credentialUnset')}</span></summary>
                  <div className={css.grid}>
                    <TextField field={envField} state={state.fields[envField]} label={t('keyedEnv')} hint={`${t('keyedEnvHint')}${defaultEnv}`} disabled={disabled} t={t} edit={props.edit} reset={props.resetField} placeholder={defaultEnv} />
                    {credential(`keyed:${id}`, 'keyedApiKey')}
                    <TextField field={urlField} state={state.fields[urlField]} label={t('keyedBaseUrl')} hint={t('keyedBaseUrlHint')} disabled={disabled} t={t} edit={props.edit} reset={props.resetField} />
                    {text(`sources.budget.${id}.total`, 'reqTotal', 'reqTotalHint', 'number')}
                    {text(`sources.budget.${id}.daily`, 'reqDaily', 'reqDailyHint', 'number')}
                  </div>
                </details>
              )
            })}
            <h4 className={css.subheading}>SearXNG · OpenAlex</h4>
            <div className={css.grid}>
              {text('searxngUrl', 'searxngUrl', 'searxngUrlHint', 'text', 'http://127.0.0.1:8080')}
              {text('openalexMailto', 'openalexMailto', 'openalexMailtoHint')}
            </div>
            <h4 className={css.subheading}>{t('anonymousTitle')}</h4>
            <p className={css.hint}>{t('anonymousHint')}</p>
            <table className={css.table} data-web-search-pro-anonymous>
              <thead><tr><th scope="col">{t('anonymousName')}</th><th scope="col">id</th><th scope="col">{t('anonymousUse')}</th></tr></thead>
              <tbody>
                {ANONYMOUS_SOURCES.map(source => (
                  <tr key={source.id}>
                    <td>{source.name}</td>
                    <td><code>{source.id}</code></td>
                    <td>{t(source.use)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={css.note} data-web-search-pro-status-line>{t('sourcesStatusLine')}</p>
          </Section>

          <Section id="credentials" title={t('credentialsSection')} hint={t('credentialsSectionHint')} defaultOpen>
            <div className={css.grid}>
              {text('exaApiKeyEnv', 'exaApiKeyEnv', 'credentialRefHint')}
              {credential('exa', 'exaApiKey')}
              {text('jinaApiKeyEnv', 'jinaApiKeyEnv', 'credentialRefHint')}
              {credential('jina', 'jinaApiKey')}
              {text('githubTokenEnv', 'githubTokenEnv', 'credentialRefHint')}
              {credential('github', 'githubToken')}
            </div>
          </Section>

          <Section id="runtime" title={t('runtimeSection')} hint={t('runtimeSectionHint')} defaultOpen>
            <div className={css.grid}>
              {toggle('enableCliBackends', 'enableCliBackends', 'enableCliBackendsHint')}
              {toggle('opencliEnabled', 'opencliEnabled', 'opencliEnabledHint')}
              {toggle('agentReachEnabled', 'agentReachEnabled', 'agentReachEnabledHint')}
              {json('playwright', 'playwright', 'playwrightHint', 4)}
            </div>
          </Section>

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
    </div>
  )
}
