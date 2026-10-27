/**
 * "Agent changes": what an agent changed with the `config.*` actions, kept apart from the user's configuration. The plugin keeps those
 * changes in a managed overlay file that takes effect at once and never edits the profile; this group lists every entry with the reason
 * and time the agent gave, the newest audit records, and for each entry two buttons: "Adopt into configuration" (write the value into
 * the profile with the card's atomic write, then drop the overlay entry) and "Revoke" (drop it). "Revoke all" empties the overlay, which
 * also repairs a file the plugin had to ignore. The card reads the overlay once when it opens and on the refresh button.
 * @module web-search-pro/client/group-agent
 */

import type { OverlayItem, OverlayItemKind } from '../overlay-types.ts'
import { agentTip } from './agent-mark.tsx'
import { fill, type Card, type LabelKey } from './field-rows.tsx'
import { formatTime } from './overlay-ops.ts'
import { styles as css } from './styles.ts'
import { AgentTag, Badge, Btn, Fold, Group, Item } from './ui-kit.tsx'

const KIND_LABEL: Record<OverlayItemKind, LabelKey> = {
  engines: 'agentKindEngines', priority: 'agentKindPriority', disabled: 'agentKindDisabled', confidence: 'agentKindConfidence', platform: 'agentKindPlatform', cli: 'agentKindCli',
}

/** One overlay entry: what it is, the value the agent set against the one in the configuration, why and when, and the two buttons. */
export function AgentItem({ card, item, busy }: { card: Card; item: OverlayItem; busy: boolean }) {
  const { t } = card
  const who = item.actor === 'user' ? t('agentActorUser') : t('agentActorAgent')
  return <Item data={item.key}
    title={<><strong>{t(KIND_LABEL[item.kind])}</strong>{item.target ? <code>{item.target}</code> : null}</>}
    badges={<AgentTag label={t('agentBadge')} tip={agentTip(t, item)} />}
    meta={<>
      <div><span className={css.muted}>{t('agentNow')}</span> <code>{item.summary}</code></div>
      <div><span className={css.muted}>{t('agentConfigHolds')}</span> <code>{item.baseline}</code></div>
      <div className={css.muted}>{item.reason ? '“' + item.reason + '”' : t('agentNoReason')}{item.at ? ' · ' + formatTime(item.at) : ''} · {who}{item.sessionId ? ' · ' + item.sessionId : ''}</div>
    </>}
    actions={<>
      <Btn primary disabled={busy} onClick={() => card.adoptOverlay(item.key)} data="agent-adopt">{t('agentAdopt')}</Btn>
      <Btn danger disabled={busy} onClick={() => card.revokeOverlay([item.key])} data="agent-revoke">{t('agentRevoke')}</Btn>
    </>} />
}

export function AgentGroup({ card }: { card: Card }) {
  const { t } = card
  const state = card.useWebSearchPro(snapshot => ({ overlay: snapshot.server.overlay, busy: !snapshot.writable || snapshot.saving || snapshot.server.overlay.busy, writable: snapshot.writable }))
  const { overlay } = state
  const view = overlay.view
  const items = view?.items ?? []
  const audit = view?.audit ?? []
  return <Group id="agent" title={t('groupAgent')} summary={t('groupAgentSub')} badges={items.length ? <Badge tone="warning">{fill(t('agentCount'), { n: items.length })}</Badge> : null}>
    <p className={css.rowHint}>{t('agentNote')}</p>
    {overlay.failed && !view ? <p className={css.notice} role="status" data-wsp-agent-unavailable>{t('agentUnavailable')}</p> : null}
    {view && !view.valid ? <p className={`${css.rowHint} wsp-bad`} role="alert" data-wsp-agent-invalid>{fill(t('agentInvalid'), { problem: view.problem ?? '' })}</p> : null}
    {overlay.error ? <p className={`${css.rowHint} wsp-bad`} role="alert" data-wsp-agent-error={overlay.error.key}>{fill(t(overlay.error.key), { why: overlay.error.why ?? '' })}</p> : null}
    <div className={css.list} data-wsp-agent-list>
      {view === undefined ? <p className={css.empty}>{overlay.loading ? t('agentLoading') : t('agentNotLoaded')}</p>
        : items.length === 0 ? <p className={css.empty}>{t('agentEmpty')}</p>
          : items.map(item => <AgentItem key={item.key} card={card} item={item} busy={state.busy} />)}
    </div>
    <div className={css.actions}>
      <Btn disabled={overlay.loading} onClick={card.refreshOverlay} data="agent-refresh">{overlay.loading ? t('agentRefreshing') : t('agentRefresh')}</Btn>
      <Btn danger disabled={state.busy || !view || (items.length === 0 && view.valid)} onClick={() => card.revokeOverlay('all')} data="agent-revoke-all">{t('agentRevokeAll')}</Btn>
    </div>
    {view ? <p className={css.rowHint} data-wsp-agent-file>{fill(t('agentFile'), { file: view.file, revision: view.revision })}</p> : null}
    {view ? <Fold id="agent-audit" title={fill(t('agentAuditTitle'), { n: audit.length })} hint={t('agentAuditHint')}>
      <div className={css.list} data-wsp-agent-audit>
        {audit.length === 0 ? <p className={css.empty}>{t('agentAuditEmpty')}</p> : audit.map(entry => <Item key={entry.revision} data={'#' + entry.revision}
          title={<><span className="wsp-order-no">{entry.revision}</span><strong>{entry.action}</strong></>}
          badges={<Badge tone="outline">{entry.actor === 'user' ? t('agentActorUser') : t('agentActorAgent')}</Badge>}
          meta={<>
            <div className={css.muted}>{formatTime(entry.at)}{entry.sessionId ? ' · ' + entry.sessionId : ''} · “{entry.reason}”</div>
            {entry.changes.map((change, index) => <div key={index}><code>{change.key}</code> {change.before} → {change.after}</div>)}
          </>} />)}
      </div>
    </Fold> : null}
  </Group>
}
