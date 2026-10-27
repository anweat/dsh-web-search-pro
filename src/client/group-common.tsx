/**
 * "Common": what nearly everyone touches, open by default (every other group starts closed): the default engine chain with the
 * order a search would really try, the result count, parallel fusion, the tool surface, the proxy fake-IP switch, and the
 * DeepSeek Search source (常用) with its page-reading switch.
 * @module web-search-pro/client/group-common
 */

import { chainOf } from './card-frame.tsx'
import { fill, NumberRow, SelectRow, SwitchRow, useOverriddenCount, type Card } from './field-rows.tsx'
import { SourceList } from './group-sources.tsx'
import { styles as css } from './styles.ts'
import { Badge, Group, SubHead } from './ui-kit.tsx'

/** The names of the common group's fields, in order. */
export const COMMON_FIELDS = ['searchMaxResults', 'parallelEngines', 'toolSurface', 'allowProxyFakeIp', 'deepseekFetch'] as const

/** The chain a plain search would try, computed from the staged settings by the router's own function. */
function ChainLine({ card }: { card: Card }) {
  const { t } = card
  const chain = card.useWebSearchPro(snapshot => chainOf(snapshot)?.join(' › ') ?? '')
  return <p className={css.chain} role="status" data-wsp-chain>
    <span>{t('chainNow')}</span>{chain ? chain.split(' › ').map((id, index) => <span key={id + index}>{index ? '› ' : ''}<code>{id}</code></span>) : <span>{t('chainEmpty')}</span>}
    <button type="button" className={css.link} onClick={() => { const node = document.querySelector<HTMLDetailsElement>('[data-wsp-group="order"]'); if (node) { node.open = true; node.scrollIntoView?.({ block: 'start', behavior: 'smooth' }) } }} data-wsp-open-order>{t('chainEdit')}</button>
  </p>
}

export function CommonGroup({ card }: { card: Card }) {
  const { t } = card
  const count = useOverriddenCount(card, COMMON_FIELDS)
  return <Group id="common" title={t('groupCommon')} summary={t('groupCommonSub')} defaultOpen badges={count ? <Badge tone="info">{fill(t('overriddenCount'), { n: count })}</Badge> : null}>
    <ChainLine card={card} />
    <NumberRow card={card} field="searchMaxResults" unit="count" />
    <SwitchRow card={card} field="parallelEngines" />
    <SelectRow card={card} field="toolSurface" options={[{ value: 'indexed', label: t('optIndexed') }, { value: 'flat', label: t('optFlat') }]} />
    <SwitchRow card={card} field="allowProxyFakeIp" risk={t('riskNetwork')} />
    <SubHead>{t('commonDeepseekTitle')}</SubHead>
    <SourceList card={card} only={['deepseek']} />
    <SwitchRow card={card} field="deepseekFetch" risk={t('riskBilled')} />
  </Group>
}
