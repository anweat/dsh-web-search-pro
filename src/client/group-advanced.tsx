/**
 * "Advanced: text mode": the settings as one commented YAML text, to read or copy. It is a view of the controls (it prints
 * the staged state, secrets excluded), not a second place the settings live. Every key has a comment in front of it.
 * @module web-search-pro/client/group-advanced
 */

import { useState } from 'react'
import { ALL_SPECS } from './form.ts'
import type { Card } from './field-rows.tsx'
import { renderTextView } from './text-view.ts'
import { styles as css } from './styles.ts'
import { Btn, Group } from './ui-kit.tsx'

export function AdvancedGroup({ card }: { card: Card }) {
  const { t } = card
  const fields = card.useWebSearchPro(snapshot => snapshot.fields)
  const [copied, setCopied] = useState(false)
  const text = renderTextView(fields, ALL_SPECS, t('lang'))
  const id = 'web-search-pro-text-view'
  return <Group id="advanced" title={t('groupAdvanced')} summary={t('groupAdvancedSub')}>
    <div className={css.stack} data-wsp-text-view>
      <p className={css.rowHint}>{t('textViewHint')}</p>
      <textarea id={id} className={`${css.input} ${css.textarea} ${css.code}`} rows={26} readOnly spellCheck={false} aria-label={t('textViewTitle')} value={text} onFocus={event => event.currentTarget.select()} />
      <div><Btn onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => undefined) }} data="text-copy">{copied ? t('textViewCopied') : t('textViewCopy')}</Btn></div>
      <p className={css.notice} role="note">{t('textViewNote')}</p>
    </div>
  </Group>
}
