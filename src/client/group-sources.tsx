/**
 * "Sources": how sources are ranked (policy, priority, disabled) and a list of the sources that need a key or an address: a
 * row per source (name, tier, whether its key is set, and the "常用" mark), and one edit dialog per source holding its key
 * reference, write-only key, endpoint and request budget. The anonymous sources are a folded reference table. Edits stage into
 * the same draft the sticky save bar writes; a dialog has no save button of its own.
 * @module web-search-pro/client/group-sources
 */

import { useState } from 'react'
import { fill, rowLabels, useOverriddenCount, type Card, type LabelKey, ListRow, NumberRow, SelectRow, SwitchRow, TextRow } from './field-rows.tsx'
import { SOURCE_DEFS, sourceFields, type SourceDef } from './field-keys.ts'
import type { CredentialId } from './form.ts'
import { ANONYMOUS_SOURCES } from './sources-table.ts'
import { styles as css } from './styles.ts'
import { Badge, Btn, Dialog, Fold, Group, Item, Row, SecretInput, SubHead } from './ui-kit.tsx'

/** The write-only key of a source. It shows whether a key is stored, never the key. */
export function SecretRow({ card, id, label }: { card: Card; id: CredentialId; label: string }) {
  const { t } = card
  const cred = card.useWebSearchPro(snapshot => snapshot.credentials[id])
  const disabled = card.useWebSearchPro(snapshot => !snapshot.writable || snapshot.saving)
  const status = cred.loading ? t('credentialChecking') : cred.configured ? t('credentialSet') : t('credentialUnset')
  const inputId = `web-search-pro-credential-${id}`
  return <div data-wsp-credential={id}>
    <Row id={inputId} label={label} hint={cred.writable ? t('credentialWriteOnlyHint') : t('credentialReadOnlyHint')} labels={rowLabels(t)}>
      <SecretInput id={inputId} value={cred.text} onChange={text => card.editCredential(id, text)} status={status} configured={cred.configured} disabled={disabled || !cred.writable} ariaLabel={label} />
    </Row>
  </div>
}

/** Whether a source is usable as far as the card can tell: its key is stored, or (SearXNG) its address is set. */
export function useSourceReady(card: Card, def: SourceDef): { ready: boolean; loading: boolean } {
  return card.useWebSearchPro(snapshot => {
    if (def.credential) { const cred = snapshot.credentials[def.credential as CredentialId]; return { ready: cred.configured, loading: cred.loading } }
    return { ready: (snapshot.fields.searxngUrl?.text ?? '') !== '', loading: false }
  })
}

const NOTE_KEYS: Record<string, string> = {
  deepseek: 'sourceNoteDeepseek', bocha: 'sourceNoteBocha', exa: 'sourceNoteExa', jina: 'sourceNoteJina', github: 'sourceNoteGithub', searxng: 'sourceNoteSearxng',
}

/** The controls of one source: reference name, write-only key, endpoint, extras and request budget. */
export function SourceForm({ card, def }: { card: Card; def: SourceDef }) {
  const { t } = card
  const keyedFields = def.id === 'bocha' || def.id === 'exa' || def.id === 'jina' || def.id === 'github'
  return <>
    {def.envField ? <TextRow card={card} field={def.envField} placeholder={def.defaultEnv} code
      hint={`${t('keyedEnvHint')} ${def.defaultEnv}`} label={keyedFields ? t(def.envField as LabelKey) : t('keyedEnv')} /> : null}
    {def.credential ? <SecretRow card={card} id={def.credential as CredentialId} label={t('keyedApiKey')} /> : null}
    {def.baseUrlField ? <TextRow card={card} field={def.baseUrlField} code placeholder={def.id === 'bocha' ? 'https://api.bocha.cn' : def.id === 'deepseek' ? 'https://api.deepseek.com/v1/tools' : ''}
      label={t(def.baseUrlField === 'bochaBaseUrl' ? 'bochaBaseUrl' : 'keyedBaseUrl')} hint={def.baseUrlField === 'bochaBaseUrl' ? t('bochaBaseUrlHint') : t('keyedBaseUrlHint')} /> : null}
    {def.extra?.map(field => field === 'bochaSummary' ? <SwitchRow key={field} card={card} field={field} />
      : <TextRow key={field} card={card} field={field} code placeholder="http://127.0.0.1:8080" />)}
    {def.budget ? <>
      <SubHead>{t('reqBudgetGroup')}</SubHead>
      <p className={css.rowHint}>{t('reqBudgetNote')}</p>
      <NumberRow card={card} field={`sources.budget.${def.id}.total`} unit="count" />
      <NumberRow card={card} field={`sources.budget.${def.id}.daily`} unit="count" />
    </> : null}
  </>
}

/** One source's edit dialog. */
export function SourceDialog({ card, def, onClose }: { card: Card; def: SourceDef; onClose: () => void }) {
  const { t } = card
  const fields = sourceFields(def)
  const overridden = card.useWebSearchPro(snapshot => fields.filter(field => snapshot.fields[field as keyof typeof snapshot.fields]?.overridden))
  const disabled = card.useWebSearchPro(snapshot => !snapshot.writable || snapshot.saving)
  const note = NOTE_KEYS[def.id]
  return <Dialog open wide={false} title={fill(t('sourceDialogTitle'), { name: def.name })} closeLabel={t('close')} description={t((note ?? 'sourceNoteKeyed') as LabelKey)} onClose={onClose}
    footer={<>
      <Btn disabled={disabled || overridden.length === 0} onClick={() => { for (const field of overridden) card.resetField(field as never) }} data="source-reset">{t('sourceResetAll')}</Btn>
      <Btn primary onClick={onClose} data="source-done">{t('done')}</Btn>
    </>}>
    <p className={css.rowHint}>{t('dialogStagesNote')}</p>
    <SourceForm card={card} def={def} />
  </Dialog>
}

const TIER_KEYS = { paid: 'tierPaid', 'free-quota': 'tierFree', anonymous: 'tierAnonymous' } as const

/** One row of the sources list. */
export function SourceItem({ card, def, onEdit }: { card: Card; def: SourceDef; onEdit: () => void }) {
  const { t } = card
  const { ready, loading } = useSourceReady(card, def)
  const disabled = card.useWebSearchPro(snapshot => !snapshot.writable)
  const view = card.useWebSearchPro(snapshot => ({
    ref: def.envField ? (snapshot.fields[def.envField as keyof typeof snapshot.fields]?.text || def.defaultEnv || '') : '',
    url: def.id === 'searxng' ? snapshot.fields.searxngUrl.text : '',
    capped: def.budget ? ['total', 'daily'].some(axis => snapshot.fields[`sources.budget.${def.id}.${axis}` as keyof typeof snapshot.fields]?.text) : false,
  }))
  const meta = def.id === 'searxng' ? (view.url || t('sourceMetaNoUrl')) : [view.ref ? fill(t('sourceMetaRef'), { ref: view.ref }) : '', view.capped ? t('sourceMetaCapped') : ''].filter(Boolean).join(' · ')
  return <Item data={def.id} title={<strong>{def.name}</strong>}
    badges={<>
      {def.common ? <Badge tone="info">{t('commonBadge')}</Badge> : null}
      <Badge tone={def.tier === 'paid' ? 'warning' : 'outline'}>{t(TIER_KEYS[def.tier])}</Badge>
      <Badge tone={ready ? 'success' : 'neutral'}>{loading ? t('credentialChecking') : ready ? (def.credential ? t('credentialSet') : t('sourceConfigured')) : (def.credential ? t('credentialUnset') : t('sourceNotConfigured'))}</Badge>
    </>}
    meta={meta} actions={<Btn disabled={disabled} onClick={onEdit} data="source-edit">{t('edit')}</Btn>} />
}

/** Open dialog state shared by the Common and Sources groups: one source at a time. */
export function SourceList({ card, only }: { card: Card; only?: readonly string[] }) {
  const [editing, setEditing] = useState<string | undefined>()
  const defs = SOURCE_DEFS.filter(def => !only || only.includes(def.id))
  const def = SOURCE_DEFS.find(entry => entry.id === editing)
  return <>
    <div className={css.list} data-wsp-source-list>
      {defs.map(entry => <SourceItem key={entry.id} card={card} def={entry} onEdit={() => setEditing(entry.id)} />)}
    </div>
    {def ? <SourceDialog key={def.id} card={card} def={def} onClose={() => setEditing(undefined)} /> : null}
  </>
}

const FIELD_NAMES: readonly string[] = [
  'evidence.sourcePolicy', 'sources.priority', 'sources.disabled', 'openalexMailto',
]

export function SourcesGroup({ card }: { card: Card }) {
  const { t } = card
  const count = useOverriddenCount(card, [...FIELD_NAMES, ...SOURCE_DEFS.flatMap(sourceFields)])
  return <Group id="sources" title={t('groupSources')} summary={t('groupSourcesSub')} badges={count ? <Badge tone="info">{fill(t('overriddenCount'), { n: count })}</Badge> : null}>
    <SubHead>{t('strategyGroup')}</SubHead>
    <p className={css.rowHint} data-wsp-strategy>{t('strategyNote')}</p>
    <SelectRow card={card} field="evidence.sourcePolicy" options={[{ value: 'default', label: t('optPolicyDefault') }, { value: 'anonymous-only', label: t('optPolicyAnonymousOnly') }]} />
    <ListRow card={card} field="sources.priority" placeholder="deepseek, exa" />
    <ListRow card={card} field="sources.disabled" placeholder="bing" />
    <SubHead>{t('sourcesListTitle')}</SubHead>
    <p className={css.rowHint}>{t('sourcesListHint')}</p>
    <SourceList card={card} />
    <Fold id="anonymous" title={t('anonymousTitle')} hint={t('anonymousHint')}>
      <table className={css.table} data-wsp-anonymous>
        <thead><tr><th scope="col">{t('anonymousName')}</th><th scope="col">id</th><th scope="col">{t('anonymousUse')}</th></tr></thead>
        <tbody>{ANONYMOUS_SOURCES.map(source => <tr key={source.id}><td>{source.name}</td><td><code>{source.id}</code></td><td>{t(source.use)}</td></tr>)}</tbody>
      </table>
      <TextRow card={card} field="openalexMailto" />
      <p className={css.rowHint} data-wsp-status-line>{t('sourcesStatusLine')}</p>
    </Fold>
  </Group>
}
