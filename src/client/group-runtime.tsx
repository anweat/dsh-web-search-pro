/**
 * "Runtime and backends": the CLI / OpenCLI / Agent Reach switches, the Twitter / X login values (a dialog), the JSON objects
 * that shape backends (Playwright, platform backend chains, CLI adapters) and the platform settings (custom platforms,
 * selectors, browser bindings), each as a list with its own dialog. The backend order of the platforms and the custom CLIs have their own
 * groups ("Search order", "Custom CLI"); their raw JSON is under "Advanced".
 * @module web-search-pro/client/group-runtime
 */

import { useState } from 'react'
import { fill, SwitchRow, TextRow, useOverriddenCount, type Card } from './field-rows.tsx'
import { SecretRow } from './group-sources.tsx'
import { JsonList, jsonFieldsOf } from './json-list.tsx'
import { styles as css } from './styles.ts'
import { Badge, Btn, Dialog, Group, Item, SubHead } from './ui-kit.tsx'

const RUNTIME = ['enableCliBackends', 'opencliEnabled', 'agentReachEnabled', 'twitterAuthTokenEnv', 'twitterCt0Env', 'playwright', 'customPlatforms', 'platformRules', 'browserBindings'] as const

/** The two values twitter-cli needs: the controls of the dialog. */
export function TwitterForm({ card }: { card: Card }) {
  const { t } = card
  return <>
    <TextRow card={card} field="twitterAuthTokenEnv" code placeholder="TWITTER_AUTH_TOKEN" />
    <SecretRow card={card} id="twitter-auth-token" label={t('twitterAuthToken')} />
    <TextRow card={card} field="twitterCt0Env" code placeholder="TWITTER_CT0" />
    <SecretRow card={card} id="twitter-ct0" label={t('twitterCt0')} />
  </>
}

function TwitterItem({ card }: { card: Card }) {
  const { t } = card
  const [open, setOpen] = useState(false)
  const view = card.useWebSearchPro(snapshot => ({ a: snapshot.credentials['twitter-auth-token'], b: snapshot.credentials['twitter-ct0'], writable: snapshot.writable }))
  const both = view.a.configured && view.b.configured
  return <>
    <div className={css.list} data-wsp-twitter>
      <Item data="twitter" title={<strong>{t('twitterGroup')}</strong>}
        badges={<Badge tone={both ? 'success' : view.a.configured || view.b.configured ? 'warning' : 'neutral'}>{both ? t('credentialSet') : view.a.configured || view.b.configured ? t('twitterPartial') : t('credentialUnset')}</Badge>}
        meta={t('twitterGroupHint')} actions={<Btn disabled={!view.writable} onClick={() => setOpen(true)} data="twitter-edit">{t('edit')}</Btn>} />
    </div>
    {open ? <Dialog open title={t('twitterGroup')} closeLabel={t('close')} description={t('twitterGroupHint')} onClose={() => setOpen(false)} footer={<Btn primary onClick={() => setOpen(false)}>{t('done')}</Btn>}>
      <p className={css.rowHint}>{t('dialogStagesNote')}</p>
      <TwitterForm card={card} />
    </Dialog> : null}
  </>
}

export function RuntimeGroup({ card }: { card: Card }) {
  const { t } = card
  const n = useOverriddenCount(card, RUNTIME)
  return <Group id="runtime" title={t('groupRuntime')} summary={t('groupRuntimeSub')} badges={n ? <Badge tone="info">{fill(t('overriddenCount'), { n })}</Badge> : null}>
    <SwitchRow card={card} field="enableCliBackends" />
    <SwitchRow card={card} field="opencliEnabled" />
    <SwitchRow card={card} field="agentReachEnabled" />
    <SubHead>{t('runtimeLoginTitle')}</SubHead>
    <TwitterItem card={card} />
    <SubHead>{t('runtimeBackendsTitle')}</SubHead>
    <JsonList card={card} fields={jsonFieldsOf('runtime')} />
    <SubHead>{t('runtimePlatformsTitle')}</SubHead>
    <JsonList card={card} fields={jsonFieldsOf('platform')} />
  </Group>
}
