import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
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
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'settingsScope']
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

  const scope = ctx.settingsScope.bind({ namespace: 'web-search-pro' }) as SettingsScope<Record<string, unknown>>
  const controller = new WebSearchSettingsController(scope, ctx)
  ctx.effect(() => () => { controller.dispose() }, 'web-search-pro: settings controller')

  ctx.slots.inject('settings.plugin.item', () => {
    const options = {
      name: 'settings.plugin.item',
      key: 'web-search-pro',
      id: 'web-search-pro',
      locale: NS,
      inject: () => controller.inject(),
    } as const
    return ctx.slots.register(options, SettingsCard)
  })
}
