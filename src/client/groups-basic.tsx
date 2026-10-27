/**
 * The small groups: "Reading and evidence", "Network and cache", "Ranking weights" (advanced) and the built-in web tool
 * "Route". Each is a handful of rows built from the same controls; the long explanations sit behind the `?`.
 * @module web-search-pro/client/groups-basic
 */

import { fill, ListRow, NumberRow, SelectRow, SwitchRow, TextRow, useOverriddenCount, type Card } from './field-rows.tsx'
import { styles as css } from './styles.ts'
import { Badge, Fold, Group } from './ui-kit.tsx'

const count = (card: Card, fields: readonly string[], t: Card['t']) => {
  const n = useOverriddenCount(card, fields)
  return n ? <Badge tone="info">{fill(t('overriddenCount'), { n })}</Badge> : null
}

const READING = ['fetchDefaultChars', 'exaContentsPerUrlChars', 'exaContentsTotalChars', 'evidence.autoProviders', 'evidence.maxRounds', 'evidence.maxQueries'] as const
export function ReadingGroup({ card }: { card: Card }) {
  const { t } = card
  return <Group id="reading" title={t('groupReading')} summary={t('groupReadingSub')} badges={count(card, READING, t)}>
    <NumberRow card={card} field="fetchDefaultChars" unit="chars" />
    <NumberRow card={card} field="exaContentsPerUrlChars" unit="chars" />
    <NumberRow card={card} field="exaContentsTotalChars" unit="chars" />
    <SwitchRow card={card} field="evidence.autoProviders" />
    <NumberRow card={card} field="evidence.maxRounds" unit="rounds" />
    <NumberRow card={card} field="evidence.maxQueries" unit="count" />
    <p className={css.notice} role="note">{t('evidenceNote')}</p>
  </Group>
}

const NETWORK = ['timeoutMs', 'ttlSeconds', 'memoryCacheEntries', 'dbPath', 'verbose'] as const
export function NetworkGroup({ card }: { card: Card }) {
  const { t } = card
  return <Group id="network" title={t('groupNetwork')} summary={t('groupNetworkSub')} badges={count(card, NETWORK, t)}>
    <NumberRow card={card} field="timeoutMs" unit="ms" />
    <NumberRow card={card} field="ttlSeconds" unit="sec" />
    <NumberRow card={card} field="memoryCacheEntries" unit="count" />
    <TextRow card={card} field="dbPath" code />
    <SwitchRow card={card} field="verbose" />
  </Group>
}

const RANKING = ['rrfConstant', 'freshnessBoost', 'freshnessDays', 'authorityBoost', 'authorityDomains'] as const
export function RankingGroup({ card }: { card: Card }) {
  const { t } = card
  return <Group id="ranking" title={t('groupRanking')} summary={t('groupRankingSub')} badges={count(card, RANKING, t)}>
    <NumberRow card={card} field="rrfConstant" />
    <NumberRow card={card} field="freshnessBoost" />
    <NumberRow card={card} field="freshnessDays" unit="days" />
    <NumberRow card={card} field="authorityBoost" />
    <ListRow card={card} field="authorityDomains" placeholder="docs.example.com" />
    <p className={css.notice} role="note">{t('rankingNote')}</p>
  </Group>
}

const ROUTE = ['registerProvider', 'providerId', 'provider.evidence', 'provider.deadlineMs'] as const
export function RouteGroup({ card }: { card: Card }) {
  const { t } = card
  const on = card.useWebSearchPro(snapshot => snapshot.fields.registerProvider.text === 'true')
  const routeId = card.useWebSearchPro(snapshot => snapshot.fields.providerId.text.trim() || 'web-search-pro')
  return <Group id="route" title={t('groupRoute')} summary={t('groupRouteSub')} badges={count(card, ROUTE, t)}>
    <SwitchRow card={card} field="registerProvider" />
    {on ? <>
      <TextRow card={card} field="providerId" code />
      <SelectRow card={card} field="provider.evidence" options={[{ value: 'auto', label: t('optAuto') }, { value: 'off', label: t('optOff') }]} />
      <NumberRow card={card} field="provider.deadlineMs" unit="ms" />
    </> : <p className={css.rowHint}>{t('routeOffNote')}</p>}
    <Fold id="route-patch" title={t('routeHelpTitle')} hint={t('routeHelpFoldHint')}>
      <div data-wsp-route-help>
        <p className={css.rowHint}>{t('routeHelpIntro')}</p>
        <pre className={css.codeBlock}>{`- id: web\n  name: '@deepseek-ai/dsh-web'\n  config:\n    searchProvider: ${routeId}\n    fetchProvider: ${routeId}`}</pre>
        <p className={css.rowHint}>{t('routeHelpAfter')}</p>
      </div>
    </Fold>
  </Group>
}
