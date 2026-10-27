/**
 * The mark beside a setting that an agent changed with `config.*`: "Changed by agent", whose tooltip says what the agent set, what the
 * configuration holds, why and when, and (outside the cramped list rows) the two buttons that settle it: adopt the value into the
 * configuration, or revoke it. The data is the plugin's overlay, read once over the card's RPC channel when the panel opens and again
 * on the refresh button (see group-agent.tsx).
 * @module web-search-pro/client/agent-mark
 */

import type { OverlayItem } from '../overlay-types.ts'
import type { Card } from './field-rows.tsx'
import { fill } from './fill.ts'
import { formatTime } from './overlay-ops.ts'
import { styles as css } from './styles.ts'
import { AgentTag } from './ui-kit.tsx'

/** The overlay item of a key in the card's state, or undefined. */
export function useOverlayItem(card: Card, key: string): OverlayItem | undefined {
  return card.useWebSearchPro(snapshot => snapshot.server.overlay.view?.items.find(item => item.key === key))
}

/** One sentence for the tooltip: the value the agent set, the one in the configuration, the reason, who and when. */
export function agentTip(t: Card['t'], item: OverlayItem): string {
  const who = item.actor === 'user' ? t('agentActorUser') : t('agentActorAgent')
  return fill(t('agentTip'), { value: item.summary, baseline: item.baseline, reason: item.reason ?? t('agentNoReason'), at: item.at ? formatTime(item.at) : '', who })
}

/**
 * `compact` shows the tag only (list rows have no room for buttons; the "Agent changes" group holds them); otherwise the tag is followed
 * by "Adopt into configuration" and "Revoke".
 */
export function AgentMark({ card, itemKey, compact }: { card: Card; itemKey: string; compact?: boolean }) {
  const { t } = card
  const item = useOverlayItem(card, itemKey)
  const busy = card.useWebSearchPro(snapshot => !snapshot.writable || snapshot.saving || snapshot.server.overlay.busy)
  if (!item) return null
  return <span className="wsp-agent" data-wsp-agent={itemKey}>
    <AgentTag label={t('agentBadge')} tip={agentTip(t, item)} />
    {compact ? null : <>
      <button type="button" className={css.link} disabled={busy} onClick={() => card.adoptOverlay(itemKey)} data-wsp-agent-adopt={itemKey}>{t('agentAdopt')}</button>
      <button type="button" className={css.link} disabled={busy} onClick={() => card.revokeOverlay([itemKey])} data-wsp-agent-revoke={itemKey}>{t('agentRevoke')}</button>
    </>}
  </span>
}
