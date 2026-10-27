/**
 * The frame around the groups: the status summary on top (with the warnings dialog) and the save bar at the bottom.
 *
 * The Host's `SettingsForm` offers one save button below the controls. This card needs the bar to stay in view while a long
 * page scrolls, to say how many edits are waiting, and to offer "Discard", so the frame is built here; the behaviors a
 * settings form has are kept: it says so when the settings are not served or read-only, and it drops the staged edits when
 * the page is left.
 * @module web-search-pro/client/card-frame
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { COMMON_SOURCE_IDS } from '../providers/keyed-meta.ts'
import { effectiveChain, type ChainInput } from '../default-chain.ts'
import { fill, parseList, type Card, type LabelKey } from './field-rows.tsx'
import { labelKey, SOURCE_DEFS } from './field-keys.ts'
import type { WebSearchCardState } from './form.ts'
import { styles as css } from './styles.ts'
import { Badge, Btn, Dialog, type Tone } from './ui-kit.tsx'

/** Sources whose key is a credential the card can see (searxng and the like have none). */
const KEYED_DEFS = SOURCE_DEFS.filter(def => def.credential)

/** What the default chain rule reads from the staged settings: the list, the preferences, the ready common sources, the policy. */
export function chainInputOf(snapshot: Pick<WebSearchCardState, 'fields' | 'credentials'>): ChainInput {
  const text = (field: string): string => snapshot.fields[field as keyof typeof snapshot.fields]?.text ?? ''
  const commonReady = SOURCE_DEFS.filter(def => def.common && def.credential && COMMON_SOURCE_IDS.includes(def.id) && snapshot.credentials[def.credential as keyof typeof snapshot.credentials]?.configured).map(def => def.id)
  return { engines: parseList(text('engines')), priority: parseList(text('sources.priority')), disabled: parseList(text('sources.disabled')), commonReady, anonymousOnly: text('evidence.sourcePolicy') === 'anonymous-only' }
}

/** The chain a plain search would try, from the staged settings; undefined when the draft leaves nothing to try. */
export function chainOf(snapshot: Pick<WebSearchCardState, 'fields' | 'credentials'>): string[] | undefined {
  try { return effectiveChain(chainInputOf(snapshot)) } catch { return undefined }
}

/** Everything the warnings badge counts: what the validation says about a field, and the rubric problems. */
export function warningsOf(snapshot: WebSearchCardState, t: Card['t']): string[] {
  const out: string[] = []
  for (const [field, state] of Object.entries(snapshot.fields)) {
    if (field.startsWith('evidence.rubrics.')) continue
    const name = field.startsWith('keyedSources.') || field.startsWith('sources.budget.') ? field : t(labelKey(field) as LabelKey)
    if (state.message) out.push(name + ': ' + state.message)
    if (state.warning) out.push(name + ': ' + state.warning)
  }
  for (const rubric of snapshot.rubrics) for (const problem of rubric.problems) out.push(rubric.id + ': ' + problem)
  for (const entry of snapshot.server.status?.pendingRestart ?? []) out.push(entry.field + ': ' + fill(t('pendingRestartLine'), { running: entry.running || t('pendingEmpty'), configured: entry.configured || t('pendingEmpty') }))
  if (snapshot.unknownRubrics.length) out.push(t('rubricUnknown') + ' ' + snapshot.unknownRubrics.join(', '))
  return out
}

const JUDGE_TONE: Record<string, Tone> = { off: 'neutral', shadow: 'info', control: 'warning', hybrid: 'warning' }

export function SummaryBar({ card }: { card: Card }) {
  const { t } = card
  const [open, setOpen] = useState(false)
  const view = card.useWebSearchPro(snapshot => ({
    chain: chainOf(snapshot)?.join(' › ') ?? '',
    keyed: KEYED_DEFS.filter(def => snapshot.credentials[def.credential as keyof typeof snapshot.credentials]?.configured).length,
    common: SOURCE_DEFS.filter(def => def.common).map(def => ({ id: def.id, name: def.name, ready: !!snapshot.credentials[def.credential as keyof typeof snapshot.credentials]?.configured })),
    route: snapshot.fields.registerProvider.text === 'true', surface: snapshot.fields.toolSurface.text || 'indexed',
    judge: snapshot.fields['evidence.judge.mode'].text || 'off',
    pending: snapshot.server.status?.pendingRestart ?? [],
    warnings: warningsOf(snapshot, t),
  }))
  const chain = view.chain.split(' › ')
  const shown = chain.length > 5 ? [...chain.slice(0, 5), '…'] : chain
  return <div className={css.summaryBar} role="group" aria-label={t('summaryTitle')} data-wsp-summary>
    <strong>{t('summaryTitle')}</strong>
    <Badge tone="neutral">{t('summaryChain')} {view.chain ? shown.join(' › ') : t('summaryChainEmpty')}</Badge>
    <Badge tone={view.keyed ? 'success' : 'neutral'}>{fill(t('summaryKeys'), { n: view.keyed, m: KEYED_DEFS.length })}</Badge>
    {view.common.map(source => <Badge key={source.id} tone={source.ready ? 'success' : 'warning'}>{source.name} · {t('commonBadge')} · {source.ready ? t('summaryReady') : t('summaryNoKey')}</Badge>)}
    <Badge tone={view.route ? 'info' : 'neutral'}>{view.route ? t('summaryRouteOn') : t('summaryRouteOff')}</Badge>
    <Badge tone={JUDGE_TONE[view.judge] ?? 'neutral'}>{t('summaryJudge')} {view.judge}</Badge>
    <Badge tone="neutral">{t('summarySurface')} {view.surface}</Badge>
    {view.pending.length ? <span data-wsp-pending-restart={view.pending.map(entry => entry.field).join(',')} title={view.pending.map(entry => entry.field + ': ' + fill(t('pendingRestartLine'), { running: entry.running || t('pendingEmpty'), configured: entry.configured || t('pendingEmpty') })).join('\n')}>
      <Badge tone="warning">{fill(t('summaryPendingRestart'), { n: view.pending.length })}: {view.pending.map(entry => entry.field).join(', ')}</Badge></span> : null}
    <button type="button" className={css.link} onClick={() => setOpen(true)} data-wsp-warnings-count={view.warnings.length}>
      {view.warnings.length ? <Badge tone="warning">{fill(t('summaryWarnings'), { n: view.warnings.length })}</Badge> : <span className={css.muted}>{t('summaryNoWarnings')}</span>} · {t('summaryDetails')}
    </button>
    <Dialog open={open} title={t('warningsTitle')} closeLabel={t('close')} onClose={() => setOpen(false)} footer={<Btn onClick={() => setOpen(false)} primary>{t('close')}</Btn>}>
      {view.warnings.length === 0 ? <p className={css.rowHint}>{t('warningsNone')}</p> : <ul data-wsp-warning-list>{view.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    </Dialog>
  </div>
}

export function SaveBar({ card }: { card: Card }) {
  const { t } = card
  const state = card.useWebSearchPro(snapshot => snapshot)
  const count = state.changes
  const blocked = !state.dirty || state.invalid || state.saving || !state.writable
  // The bar floats at the bottom of the window only while there is something to act on (unsaved edits, a save running or failed).
  // Otherwise it sits in the page flow after the last group, so it cannot cover a group heading the user is about to click.
  const floating = state.dirty || state.saving || state.failed
  return <div className={css.savebar} role="region" aria-label={t('save')} data-wsp-savebar data-wsp-floating={floating ? '' : undefined}>
    <div className={css.saveText}>
      <span data-wsp-unsaved={count}>{state.invalid ? t('savebarInvalid') : count ? fill(t('savebarDirty'), { n: count }) : t('savebarClean')}</span>
      {state.restartTouched.length ? <span className="wsp-bad-soft" role="note" data-wsp-restart-note={state.restartTouched.join(',')}>{fill(t('savebarRestart'), { fields: state.restartTouched.join(', ') })}</span> : null}
      {state.failed ? <span className="wsp-bad" role="status">{t('saveFailed')}</span> : null}
    </div>
    <div className={css.actions}>
      <Btn onClick={card.discard} disabled={!state.dirty || state.saving} data="discard">{t('discardChanges')}</Btn>
      <Btn primary onClick={card.save} disabled={blocked} data="save">{state.saving ? t('saving') : t('save')}</Btn>
    </div>
  </div>
}

/** The page frame: nothing but a notice while the settings are not served; the staged edits are dropped when the page is left. */
export function Frame({ card, children }: { card: Card; children: ReactNode }) {
  const { t } = card
  const state = card.useWebSearchPro(snapshot => ({ available: snapshot.available, writable: snapshot.writable }))
  const discard = useRef(card.discard)
  discard.current = card.discard
  useEffect(() => () => { discard.current() }, [])
  if (!state.available) return <p className={css.notice} role="status">{t('unavailable')}</p>
  return <div className={css.root} data-wsp-root data-web-search-pro-settings>
    {!state.writable ? <p className={css.notice} role="status">{t('readOnly')}</p> : null}
    {children}
  </div>
}
