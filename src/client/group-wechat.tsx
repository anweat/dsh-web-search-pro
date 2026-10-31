/**
 * "WeChat official accounts": the reminder mode, the built-in Sogou leg, the paid 元宝搜索 (Tencent WSA) leg with its write-only
 * key, and the address of the user's own wechat-download-api service. Nothing here logs in anywhere: the key is a credential
 * (stored by reference name, never shown), the history service is one the user runs and logs in to themselves.
 * @module web-search-pro/client/group-wechat
 */

import { fill, NumberRow, SelectRow, SwitchRow, TextRow, useOverriddenCount, type Card } from './field-rows.tsx'
import { SecretRow } from './group-sources.tsx'
import { styles as css } from './styles.ts'
import { Badge, Group, SubHead } from './ui-kit.tsx'

const FIELDS = [
  'wechat.notices', 'wechat.sogou.enabled', 'wechat.sogou.resolveLinks', 'wechat.sogou.minIntervalMs',
  'wechat.wsa.enabled', 'wechat.wsa.apiKeyEnv', 'wechat.wsa.baseUrl', 'wechat.wsa.edition', 'wechat.wsa.mode', 'wechat.wsa.dailyLimit',
  'wechat.history.baseUrl', 'wechat.history.minIntervalMs',
] as const

export function WechatGroup({ card }: { card: Card }) {
  const { t } = card
  const count = useOverriddenCount(card, FIELDS)
  return <Group id="wechat" title={t('groupWechat')} summary={t('groupWechatSub')} badges={count ? <Badge tone="info">{fill(t('overriddenCount'), { n: count })}</Badge> : null}>
    <p className={css.rowHint} data-wsp-wechat-note>{t('wxNote')}</p>
    <SelectRow card={card} field="wechat.notices" options={[{ value: 'once', label: t('optNoticeOnce') }, { value: 'always', label: t('optNoticeAlways') }, { value: 'off', label: t('optNoticeOff') }]} />
    <SubHead>{t('wxSogouTitle')}</SubHead>
    <SwitchRow card={card} field="wechat.sogou.enabled" />
    <NumberRow card={card} field="wechat.sogou.resolveLinks" unit="count" />
    <NumberRow card={card} field="wechat.sogou.minIntervalMs" unit="ms" />
    <SubHead>{t('wxWsaTitle')}</SubHead>
    <p className={css.rowHint} data-wsp-wsa-note>{t('wxWsaNote')}</p>
    <SwitchRow card={card} field="wechat.wsa.enabled" risk={t('riskBilled')} />
    <TextRow card={card} field="wechat.wsa.apiKeyEnv" code placeholder="TENCENT_WSA_API_KEY" />
    <SecretRow card={card} id="wechat-wsa" label={t('wxApiKey')} />
    <SelectRow card={card} field="wechat.wsa.edition" options={[{ value: 'lite', label: t('optEditionLite') }, { value: 'standard', label: t('optEditionStandard') }, { value: 'flagship', label: t('optEditionFlagship') }]} />
    <SelectRow card={card} field="wechat.wsa.mode" options={[{ value: '0', label: t('optMode0') }, { value: '1', label: t('optMode1') }, { value: '2', label: t('optMode2') }]} />
    <NumberRow card={card} field="wechat.wsa.dailyLimit" unit="count" />
    <TextRow card={card} field="wechat.wsa.baseUrl" code placeholder="https://api.wsa.cloud.tencent.com" />
    <SubHead>{t('wxHistTitle')}</SubHead>
    <p className={css.rowHint} data-wsp-history-note>{t('wxHistNote')}</p>
    <TextRow card={card} field="wechat.history.baseUrl" code placeholder="http://127.0.0.1:5000" />
    <NumberRow card={card} field="wechat.history.minIntervalMs" unit="ms" />
  </Group>
}
