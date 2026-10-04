import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsCard } from '../../src/client/SettingsCard.tsx'
import { en, zh } from '../../src/client/locales.ts'

/** Render the real card with a controller snapshot and one of the shipped dictionaries; report the keys it asked for that the dictionary lacks. */
export function renderCard(state: unknown, lang: 'zh' | 'en', view: 'page' | 'summary' = 'page'): { html: string; missingKeys: string[] } {
  const dictionary = (lang === 'zh' ? zh : en) as Record<string, string>
  const missingKeys: string[] = []
  const t = (key: string): string => {
    if (!(key in dictionary)) missingKeys.push(key)
    return dictionary[key] ?? key
  }
  const noop = (): void => {}
  const props = {
    t, view, useWebSearchPro: (selector: (snapshot: unknown) => unknown) => selector(state),
    edit: noop, resetField: noop, editCredential: noop, editRubric: noop, startRubric: noop, restoreRubric: noop,
    save: noop, discard: noop, refreshCredentials: noop,
  }
  return { html: renderToStaticMarkup(createElement(SettingsCard as never, props as never)), missingKeys }
}
