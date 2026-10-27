/**
 * "Search order": the order a plain search tries its engines, and the order each platform tries its backends, as lists one
 * moves, adds to and removes from (not as a comma text). Below the engine list sits the order a search would really use, with a
 * sentence on why it differs from the list; the platforms are rows with a dialog. Everything stages into the same draft the sticky
 * save bar writes: `engines` and `platformBackends` as they are, `sources.confidence.<id>` for the confidence box of a row.
 * @module web-search-pro/client/group-order
 */

import { useState } from 'react'
import type { ChainReason } from '../default-chain.ts'
import { explainChain } from '../default-chain.ts'
import { adaptersOf } from './cli-form.ts'
import { chainInputOf } from './card-frame.tsx'
import { fill, rowLabels, useField, useOverriddenCount, type Card, type LabelKey } from './field-rows.tsx'
import { hasHelp, labelKey } from './field-keys.ts'
import { confidenceField, CONFIDENCE_PREFIX } from './form-specs.ts'
import {
  addId, backendChoices, backendName, chainsOf, confidenceView, customEntries, customRows, defaultChainOf, engineChoices, filterPlatforms, idsOf, isCustomId, moveId, ORDER_PLATFORMS, PLATFORM_NAMES, removeId,
  sourceInfo, splitPlatforms, textOf, withChain, type SourceInfo,
} from './order.ts'
import type { WebSearchCardState } from './form.ts'
import { styles as css } from './styles.ts'
import { Badge, Btn, Dialog, Fold, Group, Help, Item, Row, Select, SubHead, TextInput, type Tone } from './ui-kit.tsx'
import { DEFAULT_CUSTOM_CONFIDENCE } from '../cli/spec.ts'

/** The fields of this group, for its "N overridden" badge (the confidence entries are counted by their prefix). */
const ORDER_FIELDS = ['engines', 'platformBackends'] as const

// ── a source row: what it is, whether it can run, how far it is trusted ────────────────────────────────────────────────────

interface RowState { tone: Tone; label: string; reason?: string }

/** Whether the card can tell a source runs: its key, its address, its spec, or (when the plugin answers) the plugin's own probe. */
function sourceState(snapshot: WebSearchCardState, info: SourceInfo, t: Card['t']): RowState {
  const live = snapshot.server.status?.sources[info.id]
  if (info.kind === 'keyed' && info.def) {
    const def = info.def
    if (def.credential) {
      const cred = snapshot.credentials[def.credential as keyof typeof snapshot.credentials]
      return cred.loading ? { tone: 'neutral', label: t('credentialChecking') } : cred.configured ? { tone: 'success', label: t('stateReady') } : { tone: 'warning', label: t('stateNoKey') }
    }
    return (snapshot.fields.searxngUrl?.text ?? '') !== '' ? { tone: 'success', label: t('stateReady') } : { tone: 'warning', label: t('stateNoUrl') }
  }
  if (info.kind === 'custom') {
    const problems = customRows(adaptersOf(snapshot.fields.cliAdapters.text)).find(row => row.id === info.id.slice('custom-cli:'.length))?.problems ?? []
    if (problems.length) return { tone: 'danger', label: t('stateSpecBad'), reason: problems[0]! }
    // A saved CLI is probed by the plugin: installed or not. One that is only in the draft is just a valid spec so far.
    if (live) return live.available ? { tone: 'success', label: t('stateReady') } : { tone: 'warning', label: t('stateNotReady'), ...live.reason ? { reason: live.reason } : {} }
    return { tone: 'neutral', label: t('stateSpecOk') }
  }
  if (info.kind === 'unknown') return info.id.startsWith('custom-cli:') ? { tone: 'danger', label: t('stateNoSpec') } : { tone: 'warning', label: t('stateUnknown') }
  if (live && !live.available) return { tone: 'warning', label: t('stateNotReady'), ...live.reason ? { reason: live.reason } : {} }
  return { tone: 'success', label: t('stateReady') }
}

/** Confidence a source has when nothing is set for it. */
const defaultConfidence = (info: SourceInfo, adapters: unknown): number => {
  if (info.kind !== 'custom') return 1
  const raw = customEntries(adapters).find(([key]) => key === info.id.slice('custom-cli:'.length))?.[1]
  return typeof raw?.confidence === 'number' ? raw.confidence : DEFAULT_CUSTOM_CONFIDENCE
}

/**
 * The confidence of a source, as a labelled box. While it is 1 (the built-in default, which changes nothing) it is only a quiet
 * "Confidence · default 1" that opens into the box on a click; any other value, or a wrong one, keeps the box open and picked out.
 */
function ConfidenceBox({ card, info, adapters, fallback }: { card: Card; info: SourceInfo; adapters: unknown; fallback?: number }) {
  const { t } = card
  const [open, setOpen] = useState(false)
  const field = confidenceField(info.id)
  const text = card.useWebSearchPro(snapshot => snapshot.fields[field]?.text ?? '')
  const invalid = card.useWebSearchPro(snapshot => snapshot.fields[field]?.invalid ?? false)
  const disabled = card.useWebSearchPro(snapshot => !snapshot.writable || snapshot.saving)
  const dflt = fallback ?? defaultConfidence(info, adapters)
  const view = confidenceView(text, dflt)
  const name = fill(t('orderConfidenceOf'), { name: info.name })
  const help = <Help label={t('helpLabel')} text={t('orderConfidenceHelp')} />
  if (view.quiet && !open && !invalid) {
    return <span className="wsp-conf" data-wsp-confidence="quiet">
      <button type="button" className="wsp-conf-quiet" disabled={disabled} aria-label={name} title={t('orderConfidenceEdit')} onClick={() => setOpen(true)}>
        {t('orderConfidenceLabel')} <span>{view.typed ? view.effective : fill(t('orderConfidenceDefault'), { c: view.effective })}</span>
      </button>{help}
    </span>
  }
  return <span className={view.quiet && !invalid ? 'wsp-conf' : 'wsp-conf wsp-conf-on'} data-wsp-confidence="set">
    <label className="wsp-conf-label" htmlFor={'wsp-conf-' + info.id}>{t('orderConfidenceLabel')}</label>
    <TextInput id={'wsp-conf-' + info.id} small numeric value={text} placeholder={String(dflt)} invalid={invalid || view.invalid} disabled={disabled} ariaLabel={name} autoFocus={open}
      onBlur={() => setOpen(false)} onChange={value => card.edit(field as never, value)} />
    {help}
  </span>
}

/** One row of an ordered list: its place, name, readiness and confidence, and the buttons that move it. */
function OrderItem(props: { card: Card; info: SourceInfo; index: number; count: number; adapters: unknown; state: RowState; fallback?: number; muted?: boolean; onMove: (delta: -1 | 1) => void; onRemove: () => void; disabled: boolean }) {
  const { card, info, index, count, state } = props
  const { t } = card
  return <div className={props.muted ? 'wsp-order-row wsp-order-default' : 'wsp-order-row'} data-wsp-order-item={info.id}>
    <Item data={info.id}
      title={<><span className="wsp-order-no">{index + 1}</span><strong>{info.name}</strong>{info.name !== info.id ? <code>{info.id}</code> : null}</>}
      badges={<>
        {info.kind === 'custom' ? <Badge tone="outline">{t('kindCustom')}</Badge> : null}
        <Badge tone={state.tone}>{state.label}</Badge>
      </>}
      meta={state.reason}
      actions={<>
        {<ConfidenceBox card={card} info={info} adapters={props.adapters} fallback={props.fallback} />}
        <Btn ariaLabel={t('orderUp')} title={t('orderUp')} disabled={props.disabled || index === 0} onClick={() => props.onMove(-1)} data="order-up">↑</Btn>
        <Btn ariaLabel={t('orderDown')} title={t('orderDown')} disabled={props.disabled || index === count - 1} onClick={() => props.onMove(1)} data="order-down">↓</Btn>
        <Btn ariaLabel={t('orderRemove')} title={t('orderRemove')} danger disabled={props.disabled} onClick={props.onRemove} data="order-remove">×</Btn>
      </>} />
  </div>
}

/** A closed drop-down that adds the source picked (it snaps back to its title). */
function AddSelect({ label, title, choices, onAdd, disabled, name }: { label: string; title: string; choices: readonly { value: string; label: string }[]; onAdd: (id: string) => void; disabled: boolean; name: string }) {
  return <span data-wsp-add={name}><Select ariaLabel={label} value="" options={[{ value: '', label: title }, ...choices]} disabled={disabled || choices.length === 0} onChange={value => { if (value) onAdd(value) }} /></span>
}

// ── the order a search would really use ─────────────────────────────────────────────────────────────────────────────────

function whyText(t: Card['t'], reasons: readonly ChainReason[]): string {
  if (!reasons.length) return t('orderWhySame')
  const text = (reason: ChainReason): string => {
    const ids = reason.ids.join(', ')
    switch (reason.kind) {
      case 'common': return fill(t('orderWhyCommon'), { ids })
      case 'disabled': return fill(t('orderWhyDisabled'), { ids })
      case 'priority': return fill(t('orderWhyPriority'), { ids })
      case 'anonymous-only': return fill(t('orderWhyAnonymous'), { ids })
      case 'own-list': return fill(t('orderWhyOwn'), { ids })
    }
  }
  return reasons.map(text).join(' ')
}

/** The chain a plain search would try, from the draft, and one sentence on why it is not the list as written. */
export function EffectiveChain({ card }: { card: Card }) {
  const { t } = card
  const view = card.useWebSearchPro(snapshot => explainChain(chainInputOf(snapshot)))
  return <div data-wsp-effective>
    <p className={css.chain} role="status" data-wsp-chain>
      <span>{t('chainNow')}</span>{view.chain?.length ? view.chain.map((id, index) => <span key={id + index}>{index ? '› ' : ''}<code>{id}</code></span>) : <span>{t('chainEmpty')}</span>}
    </p>
    <p className={css.why} data-wsp-why><strong>{t('orderWhy')}</strong> {view.chain ? whyText(t, view.reasons) : t('orderWhyNone')}</p>
  </div>
}

// ── the general engine list ────────────────────────────────────────────────────────────────────────────────────────────────

export function EngineOrder({ card }: { card: Card }) {
  const { t } = card
  const field = useField(card, 'engines')
  const adapters = card.useWebSearchPro(snapshot => snapshot.fields.cliAdapters.text)
  const adaptersValue = adaptersOf(adapters)
  const ids = idsOf(field.state.text)
  const st = field.state
  const set = (next: string[]): void => field.edit(textOf(next))
  const choices = engineChoices(ids, adaptersValue).map(id => ({ value: id, label: sourceInfo(id, adaptersValue).name + (sourceInfo(id, adaptersValue).name !== id ? ' (' + id + ')' : '') }))
  return <Row field="engines" label={t('engines')} hint={t('enginesHint')} help={hasHelp('engines') ? t(`${labelKey('engines')}Help` as LabelKey) : undefined}
    overridden={st.overridden} invalid={st.invalid || !!st.message} problem={st.message ?? t('invalid')} warning={st.warning} disabled={field.disabled} labels={rowLabels(t)} wide>
    <div className={css.stack} data-wsp-order="engines">
      <div className={css.list} role="list" aria-label={t('orderListLabel')}>
        {ids.length === 0 ? <p className={css.empty}>{t('orderEmpty')}</p> : ids.map((id, index) => <EngineRow key={id} card={card} id={id} index={index} ids={ids} adapters={adaptersValue} disabled={field.disabled} onChange={set} />)}
      </div>
      <div className={css.orderBar}>
        <AddSelect name="engine" label={t('orderAddLabel')} title={t('orderAdd')} choices={choices} disabled={field.disabled} onAdd={id => set(addId(ids, id))} />
        <Btn disabled={field.disabled || !st.overridden} onClick={field.reset} data="order-restore">{t('orderRestore')}</Btn>
      </div>
      <EffectiveChain card={card} />
    </div>
  </Row>
}

function EngineRow({ card, id, index, ids, adapters, disabled, onChange }: { card: Card; id: string; index: number; ids: string[]; adapters: unknown; disabled: boolean; onChange: (next: string[]) => void }) {
  const { t } = card
  const info = sourceInfo(id, adapters)
  const state = card.useWebSearchPro(snapshot => sourceState(snapshot, info, t))
  return <OrderItem card={card} info={info} index={index} count={ids.length} adapters={adapters} state={state} disabled={disabled}
    onMove={delta => onChange(moveId(ids, id, delta))} onRemove={() => onChange(removeId(ids, id))} />
}

// ── platforms ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The chain a platform uses now: the override when there is one, else the built-in default. */
function chainFor(text: string, platform: string): { ids: string[]; overridden: boolean; valid: boolean } {
  const chains = chainsOf(text)
  if (!chains) return { ids: [...defaultChainOf(platform)], overridden: false, valid: false }
  const own = chains[platform]
  return own ? { ids: own, overridden: true, valid: true } : { ids: [...defaultChainOf(platform)], overridden: false, valid: true }
}

function PlatformItem({ card, platform, onEdit }: { card: Card; platform: string; onEdit: () => void }) {
  const { t } = card
  const text = card.useWebSearchPro(snapshot => snapshot.fields.platformBackends.text)
  const disabled = card.useWebSearchPro(snapshot => !snapshot.writable)
  const chain = chainFor(text, platform)
  return <Item data={platform} title={<strong>{PLATFORM_NAMES[platform] ?? platform}</strong>}
    badges={<>{platform in PLATFORM_NAMES && PLATFORM_NAMES[platform] !== platform ? <code>{platform}</code> : null}<Badge tone={chain.overridden ? 'info' : 'outline'}>{chain.overridden ? t('overridden') : t('orderDefaultBadge')}</Badge></>}
    meta={<span className={chain.overridden ? undefined : css.muted}>{chain.ids.map(backendName).join(' › ') || t('platformEmpty')}</span>}
    actions={<Btn disabled={disabled} onClick={onEdit} data="platform-edit">{t('edit')}</Btn>} />
}

/** The body of the platform dialog: the chain as a list with its buttons, the backends that can still be added, and "Restore default". */
export function PlatformForm({ card, platform }: { card: Card; platform: string }) {
  const { t } = card
  const field = useField(card, 'platformBackends')
  const adapters = card.useWebSearchPro(snapshot => snapshot.fields.cliAdapters.text)
  const adaptersValue = adaptersOf(adapters)
  const chain = chainFor(field.state.text, platform)
  const write = (ids: string[] | undefined): void => {
    const next = withChain(field.state.text, platform, ids)
    if (next !== undefined) field.edit(next)
  }
  if (!chain.valid) return <p className={`${css.rowHint} wsp-bad`} role="alert">{t('platformChainBad')}</p>
  const choices = backendChoices(platform, chain.ids, adaptersValue).map(id => ({ value: id, label: backendName(id) + (backendName(id) !== id ? ' (' + id + ')' : '') }))
  return <div className={css.stack} data-wsp-order={'platform:' + platform}>
    <div className={css.list} role="list" aria-label={t('orderListLabel')}>
      {chain.ids.length === 0 ? <p className={css.empty}>{t('platformEmpty')}</p> : chain.ids.map((id, index) => <BackendRow key={id} card={card} platform={platform} id={id} index={index} ids={chain.ids} muted={!chain.overridden} adapters={adaptersValue} disabled={field.disabled} onChange={write} />)}
    </div>
    <div className={css.orderBar}>
      <AddSelect name="backend" label={t('orderAddLabel')} title={choices.length ? t('orderAdd') : t('platformAddNone')} choices={choices} disabled={field.disabled} onAdd={id => write(addId(chain.ids, id))} />
      <Btn disabled={field.disabled || !chain.overridden} onClick={() => write(undefined)} data="platform-restore">{t('orderRestore')}</Btn>
      {!chain.overridden ? <Badge tone="outline">{t('orderDefaultBadge')}</Badge> : null}
    </div>
  </div>
}

function BackendRow({ card, platform, id, index, ids, muted, adapters, disabled, onChange }: { card: Card; platform: string; id: string; index: number; ids: string[]; muted: boolean; adapters: unknown; disabled: boolean; onChange: (next: string[]) => void }) {
  const { t } = card
  const custom = isCustomId(id)
  const base: SourceInfo = custom ? sourceInfo(id, adapters) : { id, name: backendName(id), kind: 'unknown' }
  const info: SourceInfo = custom ? base : { ...base, kind: 'anonymous' }
  const leg = card.useWebSearchPro(snapshot => snapshot.server.status?.legs[platform + '/' + id])
  const state = card.useWebSearchPro((snapshot): RowState => {
    if (custom) return sourceState(snapshot, info, t)
    return leg ? (leg.ready ? { tone: 'success', label: t('stateReady') } : { tone: 'warning', label: t('stateNotReady'), ...leg.reason ? { reason: leg.reason } : {} }) : { tone: 'neutral', label: t('backendUnknown') }
  })
  return <OrderItem card={card} info={info} index={index} count={ids.length} adapters={adapters} state={state} fallback={leg?.confidence} muted={muted} disabled={disabled}
    onMove={delta => onChange(moveId(ids, id, delta))} onRemove={() => onChange(removeId(ids, id))} />
}

export function PlatformList({ card }: { card: Card }) {
  const { t } = card
  const [editing, setEditing] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  const split = card.useWebSearchPro(snapshot => splitPlatforms(ORDER_PLATFORMS, snapshot.fields.platformBackends.text, adaptersOf(snapshot.fields.cliAdapters.text)))
  const row = (platform: string) => <PlatformItem key={platform} card={card} platform={platform} onEdit={() => setEditing(platform)} />
  const filtering = query.trim() !== ''
  const found = filterPlatforms(ORDER_PLATFORMS, query)
  return <>
    <div className="wsp-filter" data-wsp-platform-filter>
      <TextInput value={query} onChange={setQuery} placeholder={t('orderPlatformFilter')} ariaLabel={t('orderPlatformFilterLabel')} />
      {filtering ? <span className={css.rowHint}>{fill(t('orderPlatformFound'), { n: found.length, total: ORDER_PLATFORMS.length })}</span> : null}
    </div>
    {filtering
      ? <div className={css.list} data-wsp-platform-list>{found.length ? found.map(row) : <p className={css.empty}>{t('orderPlatformNone')}</p>}</div>
      : <>
        <div className={css.list} data-wsp-platform-list>{split.shown.map(row)}</div>
        {split.rest.length ? <Fold id="platforms-more" title={fill(t('orderPlatformsMore'), { n: split.rest.length })} hint={t('orderPlatformsMoreHint')}>
          <div className={css.list} data-wsp-platform-rest>{split.rest.map(row)}</div>
        </Fold> : null}
      </>}
    {editing ? <Dialog open title={fill(t('platformDialogTitle'), { name: PLATFORM_NAMES[editing] ?? editing })} closeLabel={t('close')} description={t('platformDialogNote')} onClose={() => setEditing(undefined)}
      footer={<Btn primary onClick={() => setEditing(undefined)} data="platform-done">{t('done')}</Btn>}>
      <p className={css.rowHint}>{t('dialogStagesNote')}</p>
      <PlatformForm card={card} platform={editing} />
    </Dialog> : null}
  </>
}

// ── the group ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Open another group of the card (the "Sources" group holds `sources.priority` / `sources.disabled`) and scroll to it. */
function openGroup(id: string): void {
  const node = document.querySelector<HTMLDetailsElement>(`[data-wsp-group="${id}"]`)
  if (!node) return
  node.open = true
  node.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
}

export function OrderGroup({ card }: { card: Card }) {
  const { t } = card
  const count = useOverriddenCount(card, ORDER_FIELDS) + card.useWebSearchPro(snapshot => Object.keys(snapshot.fields).filter(field => field.startsWith(CONFIDENCE_PREFIX) && snapshot.fields[field as keyof typeof snapshot.fields]?.overridden).length)
  const rules = card.useWebSearchPro(snapshot => ({ priority: (snapshot.fields['sources.priority']?.text ?? '').trim(), disabled: (snapshot.fields['sources.disabled']?.text ?? '').trim() }))
  return <Group id="order" title={t('groupOrder')} summary={t('groupOrderSub')} badges={count ? <Badge tone="info">{fill(t('overriddenCount'), { n: count })}</Badge> : null}>
    <SubHead>{t('orderEnginesTitle')}</SubHead>
    <EngineOrder card={card} />
    <p className={css.rowHint} data-wsp-order-rules><strong>{t('orderRulesTitle')}.</strong> {t('orderRulesNote')} {fill(t('orderPriorityNow'), { ids: rules.priority || t('orderNone') })} · {fill(t('orderDisabledNow'), { ids: rules.disabled || t('orderNone') })} · <button type="button" className={css.link} onClick={() => openGroup('sources')} data-wsp-open-sources>{t('orderRulesLink')}</button></p>
    <SubHead>{t('orderPlatformsTitle')}</SubHead>
    <p className={css.rowHint}>{t('orderPlatformsNote')}</p>
    <PlatformList card={card} />
  </Group>
}
