import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { Context } from './context-types.ts'
import {
  WebSearchSettingsController,
  type CredentialId,
  type SettingField,
  type WebSearchCardState,
} from './form.ts'
import { SettingsCard } from './SettingsCard.tsx'
import { en, zh } from './locales.ts'
import { ensureStyles } from './styles.ts'

export const name = 'web-search-pro-client'
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']
export const NS = 'web-search-pro.card'

export type SettingsCardProps = PropsLocale<typeof NS> & {
  useWebSearchPro: <R>(selector: (snapshot: WebSearchCardState) => R) => R
  edit: (field: SettingField, text: string) => void
  resetField: (field: SettingField) => void
  editCredential: (id: CredentialId, text: string) => void
  save: () => void
  discard: () => void
  refreshCredentials: () => void
}
export function apply(ctx: Context): void {
  ensureStyles()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'web-search-pro: settings dictionaries')

  const form = ctx.configForms.get<Record<string, unknown>>('web-search-pro')
  const controller = new WebSearchSettingsController(form, ctx)
  ctx.effect(() => () => { controller.dispose() }, 'web-search-pro: settings controller')

  // The label thunk re-reads the active locale on every shell render, so no
  // re-registration is needed when the user switches languages.
  ctx.slots.inject('settings.plugins.tab', () => {
    const options = {
      name: 'settings.plugins.tab' as const,
      id: 'web-search-pro',
      order: 10,
      label: () => (ctx.locale.getLocale().active === 'en' ? en.tab : zh.tab),
      locale: NS,
      inject: () => controller.inject(),
    } as const
    return ctx.slots.register(options, SettingsCard)
  })

  // Legacy Hosts (pre-0.1.7) expose the settings.plugin.item seat; register
  // there too so the card renders on both generations. The cast bypasses the
  // 0.1.7 SlotMap, which no longer declares that key.
  const legacySlots = ctx.slots as unknown as {
    inject: (name: string, fn: () => unknown) => void
    register: (options: Record<string, unknown>, component: unknown) => () => void
  }
  legacySlots.inject('settings.plugin.item', () => {
    return legacySlots.register({
      name: 'settings.plugin.item',
      key: 'web-search-pro',
      id: 'web-search-pro',
      locale: NS,
      inject: () => controller.inject(),
    }, SettingsCard)
  })
}
