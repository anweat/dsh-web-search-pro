import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { Context } from './context-types.ts'
import {
  WebSearchSettingsController,
  type CredentialId,
  type RubricTextKey,
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
  view: 'summary' | 'page'
  useWebSearchPro: <R>(selector: (snapshot: WebSearchCardState) => R) => R
  edit: (field: SettingField, text: string) => void
  resetField: (field: SettingField) => void
  editCredential: (id: CredentialId, text: string) => void
  editRubric: (id: string, key: RubricTextKey, text: string) => void
  startRubric: (id: string) => void
  restoreRubric: (id: string) => void
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

  // External bundles contribute configuration to their own Plugins detail
  // page, and only while the Host serves this entry's Config schema.
  ctx.effect(() => ctx.configForms.whileServed(['web-search-pro'], () =>
    ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
      name: 'plugins.bundle.config',
      key: 'dsh-web-search-pro',
      locale: NS,
      inject: () => controller.inject(),
    }, SettingsCard))), 'web-search-pro: bundle configuration')
}
