import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsCard } from '../../src/client/SettingsCard.tsx'
import { JSON_FIELDS, SOURCE_DEFS } from '../../src/client/field-keys.ts'
import { checkSpec, echoSpec } from '../../src/client/cli-form.ts'
import { CliBody, draftOf } from '../../src/client/group-cli.tsx'
import { RubricForm } from '../../src/client/group-judge.tsx'
import { PlatformForm } from '../../src/client/group-order.tsx'
import { TwitterForm } from '../../src/client/group-runtime.tsx'
import { SourceForm } from '../../src/client/group-sources.tsx'
import { JsonForm } from '../../src/client/json-list.tsx'
import { BUILTIN_RUBRIC_IDS } from '../../src/pipeline/rubrics-spec.ts'
import { en, zh } from '../../src/client/locales.ts'

const noop = (): void => {}

/** The props the Plugins page injects, over a controller snapshot and one of the shipped dictionaries; reports the keys asked for that the dictionary lacks. */
function propsFor(state: unknown, lang: 'zh' | 'en', view: 'page' | 'summary' = 'page') {
  const dictionary = (lang === 'zh' ? zh : en) as Record<string, string>
  const missingKeys: string[] = []
  const t = (key: string): string => {
    if (!(key in dictionary)) missingKeys.push(key)
    return dictionary[key] ?? key
  }
  const props = {
    t, view, useWebSearchPro: (selector: (snapshot: unknown) => unknown) => selector(state),
    edit: noop, resetField: noop, editCredential: noop, editRubric: noop, startRubric: noop, restoreRubric: noop,
    save: noop, discard: noop, refreshCredentials: noop, refreshStatus: noop, refreshOverlay: noop, revokeOverlay: noop, adoptOverlay: noop, runTrial: noop, clearTrial: noop,
  }
  return { props, missingKeys }
}

/** Render the real card. */
export function renderCard(state: unknown, lang: 'zh' | 'en', view: 'page' | 'summary' = 'page'): { html: string; missingKeys: string[] } {
  const { props, missingKeys } = propsFor(state, lang, view)
  return { html: renderToStaticMarkup(createElement(SettingsCard as never, props as never)), missingKeys }
}

/**
 * The controls that live inside dialogs (a source's key, address and budget, a rubric override, a JSON object, the Twitter values),
 * rendered open, one block per owner: a closed dialog renders nothing, so these are the only way to read them from markup.
 */
export function renderForms(state: unknown, lang: 'zh' | 'en', clis: Record<string, Record<string, unknown>> = { echo: echoSpec() }): { html: string; missingKeys: string[] } {
  const { props, missingKeys } = propsFor(state, lang)
  const card = props as never
  const block = (kind: string, id: string, body: unknown) => createElement('section', { 'data-form': kind, 'data-id': id }, body as never)
  const tree = createElement('div', null,
    ...SOURCE_DEFS.map(def => block('source', def.id, createElement(SourceForm as never, { card, def } as never))),
    ...BUILTIN_RUBRIC_IDS.map(id => block('rubric', id, createElement(RubricForm as never, { card, id } as never))),
    ...JSON_FIELDS.map(entry => block('json', entry.field, createElement(JsonForm as never, { card, field: entry.field } as never))),
    block('twitter', 'twitter', createElement(TwitterForm as never, { card } as never)),
    ...['xiaohongshu', 'weibo'].map(platform => block('platform', platform, createElement(PlatformForm as never, { card, platform } as never))),
    ...Object.entries(clis).map(([id, spec]) => block('cli', id, createElement(CliBody as never, { card, draft: draftOf('new', id, spec), check: checkSpec(id, spec), disabled: false, onForm: noop, onId: noop, onJson: noop, onQuery: noop, onTrial: noop } as never))))
  return { html: renderToStaticMarkup(tree), missingKeys }
}
