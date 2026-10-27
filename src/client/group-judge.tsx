/**
 * "Scoring model": the optional model judge (mode, provider, coverage judge, usage caps), its custom providers as a JSON list,
 * and the judge prompts (rubrics) as a list: a row each (name, active version, default or overridden) and an edit dialog that
 * puts the built-in text beside your override. The dialog edits the same staged entry the rest of the card writes on save.
 * @module web-search-pro/client/group-judge
 */

import { useState } from 'react'
import { BUILTIN_RUBRIC_IDS } from '../pipeline/rubrics-spec.ts'
import { fill, NumberRow, SelectRow, SwitchRow, TextRow, useOverriddenCount, type Card, type LabelKey } from './field-rows.tsx'
import type { RubricCardState, RubricTextKey } from './form.ts'
import { JsonList, jsonFieldsOf } from './json-list.tsx'
import { styles as css } from './styles.ts'
import { Badge, Btn, Dialog, Fold, Group, Item, SubHead, TextInput } from './ui-kit.tsx'

const MODE_FIELDS = ['evidence.judge.mode', 'evidence.judge.provider', 'evidence.hybridBorderline', 'evidence.maxJevQuestions', 'evidence.judge.allowLlm',
  'evidence.coverage.mode', 'evidence.coverage.provider', 'evidence.coverage.thresholds.weak', 'evidence.coverage.thresholds.covered',
  'evidence.budget.perSearchInputTokens', 'evidence.budget.dailyInputTokens', 'evidence.budget.timezone', 'evidence.judge.providers', 'evidence.budget.providers'] as const

const CONTROLS: readonly { key: RubricTextKey; label: LabelKey; hint: LabelKey; kind: 'line' | 'area' | 'number' }[] = [
  { key: 'version', label: 'rubricVersion', hint: 'rubricVersionHint', kind: 'line' },
  { key: 'instructions', label: 'rubricInstructions', hint: 'rubricInstructionsHint', kind: 'area' },
  { key: 'criteria', label: 'rubricCriteria', hint: 'rubricCriteriaHint', kind: 'area' },
  { key: 'maxStateChars', label: 'rubricMaxState', hint: 'rubricMaxStateHint', kind: 'number' },
  { key: 'maxCandidateChars', label: 'rubricMaxCandidate', hint: 'rubricMaxCandidateHint', kind: 'number' },
]

/** The built-in value of a control. */
function builtinText(rubric: RubricCardState, key: RubricTextKey): string {
  switch (key) {
    case 'version': return rubric.builtin.version
    case 'instructions': return rubric.builtin.instructions
    case 'criteria': return rubric.builtin.criteria.join('\n')
    case 'maxStateChars': return String(rubric.builtin.maxStateChars)
    case 'maxCandidateChars': return String(rubric.builtin.maxCandidateChars)
  }
}

/** The controls of one rubric override: each is a view of the one staged entry; the built-in text sits beside it. */
export function RubricForm({ card, id }: { card: Card; id: string }) {
  const { t } = card
  const rubric = card.useWebSearchPro(snapshot => snapshot.rubrics.find(entry => entry.id === id)!)
  const disabled = card.useWebSearchPro(snapshot => !snapshot.writable || snapshot.saving)
  return <div className={css.stack} data-wsp-field={`evidence.rubrics.${id}`} data-wsp-rubric={id}>
    <p className={css.rowHint}>{rubric.description}</p>
    {!rubric.editing
      ? <>
        <div className={css.compareCol}><strong>{t('promptDefaultCol')}</strong><pre className={css.preview}>{rubric.builtin.instructions}</pre></div>
        <div><Btn disabled={disabled} onClick={() => card.startRubric(id)} data="rubric-start">{t('rubricCreate')}</Btn></div>
      </>
      : <>
        {CONTROLS.filter(control => control.key !== 'criteria' || rubric.kind === 'score').map(control => {
          const inputId = `web-search-pro-rubric-${id}-${control.key}`
          const value = rubric.entry[control.key]
          const invalid = rubric.invalid
          return <div className={css.compare} key={control.key}>
            <div className={css.compareCol}><strong>{t(control.label)} · {t('promptDefaultCol')}</strong><pre className={css.preview}>{builtinText(rubric, control.key)}</pre></div>
            <div className={css.compareCol}>
              <label htmlFor={inputId}>{t(control.label)} · {t('promptMineCol')}</label>
              {control.kind === 'area'
                ? <textarea id={inputId} className={`${css.input} ${css.textarea} ${css.code} ${invalid ? css.invalidInput : ''}`} rows={control.key === 'criteria' ? 5 : 10} spellCheck={false} value={value} disabled={disabled}
                  placeholder={t('promptEmptyIsDefault')} aria-invalid={invalid || undefined} onChange={event => card.editRubric(id, control.key, event.currentTarget.value)} />
                : <TextInput id={inputId} value={value} code disabled={disabled} invalid={invalid} numeric={control.kind === 'number'} placeholder={t('promptEmptyIsDefault')} onChange={text => card.editRubric(id, control.key, text)} />}
              <p className={css.rowHint}>{t(control.hint)}</p>
            </div>
          </div>
        })}
        <div><button type="button" className={css.link} disabled={disabled} onClick={() => card.restoreRubric(id)} data-wsp-reset={`evidence.rubrics.${id}`}>{t('rubricRestore')}</button></div>
      </>}
    {rubric.problems.length ? <ul className={rubric.invalid ? 'wsp-bad' : css.rowHint} role="alert" data-wsp-rubric-problems>{rubric.problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul> : null}
  </div>
}

function RubricList({ card }: { card: Card }) {
  const { t } = card
  const rubrics = card.useWebSearchPro(snapshot => snapshot.rubrics)
  const unknown = card.useWebSearchPro(snapshot => snapshot.unknownRubrics)
  const disabled = card.useWebSearchPro(snapshot => !snapshot.writable || snapshot.saving)
  const [editing, setEditing] = useState<string | undefined>()
  return <>
    <SubHead>{t('rubricsTitle')}</SubHead>
    <p className={css.rowHint}>{t('rubricNotes')}</p>
    <div className={css.list} data-wsp-rubrics>
      {rubrics.map(rubric => <Item key={rubric.id} data={rubric.id} title={<code>{rubric.id}</code>}
        badges={<>
          <Badge tone="neutral">{t('rubricActive')} {rubric.activeVersion}</Badge>
          <Badge tone={rubric.invalid ? 'danger' : rubric.editing ? 'info' : 'outline'}>{rubric.invalid ? t('invalid') : rubric.editing ? t('rubricOverrideOn') : t('promptStateDefault')}</Badge>
        </>}
        meta={rubric.description}
        actions={<>
          {rubric.editing ? <button type="button" className={css.link} disabled={disabled} onClick={() => card.restoreRubric(rubric.id)}>{t('rubricRestore')}</button> : null}
          <Btn disabled={disabled} onClick={() => setEditing(rubric.id)} data="rubric-edit">{t('edit')}</Btn>
        </>} />)}
    </div>
    {unknown.length ? <p className={css.rowHint} role="note">{t('rubricUnknown')} {unknown.join(', ')}</p> : null}
    {editing ? <Dialog open wide title={fill(t('rubricDialogTitle'), { name: editing })} closeLabel={t('close')} description={t('dialogStagesNote')} onClose={() => setEditing(undefined)}
      footer={<Btn primary onClick={() => setEditing(undefined)} data="rubric-done">{t('done')}</Btn>}>
      <RubricForm card={card} id={editing} />
    </Dialog> : null}
  </>
}

export { BUILTIN_RUBRIC_IDS }

export function JudgeGroup({ card }: { card: Card }) {
  const { t } = card
  const count = useOverriddenCount(card, [...MODE_FIELDS, ...BUILTIN_RUBRIC_IDS.map(id => `evidence.rubrics.${id}`)])
  const providers = card.useWebSearchPro(snapshot => snapshot.providerChoices)
  const options = [{ value: '', label: t('emptyDefault') }, ...providers.map(id => ({ value: id, label: id }))]
  const off = { value: 'off', label: t('optionOff') }
  return <Group id="judge" title={t('groupJudge')} summary={t('groupJudgeSub')} badges={count ? <Badge tone="info">{fill(t('overriddenCount'), { n: count })}</Badge> : null}>
    <SelectRow card={card} field="evidence.judge.mode" risk={t('riskModel')} options={[off, { value: 'shadow', label: t('optShadow') }, { value: 'control', label: t('optControl') }, { value: 'hybrid', label: t('optHybrid') }]} />
    <SelectRow card={card} field="evidence.judge.provider" options={options} />
    <SwitchRow card={card} field="evidence.hybridBorderline" />
    <NumberRow card={card} field="evidence.maxJevQuestions" unit="count" />
    <SwitchRow card={card} field="evidence.judge.allowLlm" risk={t('riskModel')} />
    <Fold id="judge-coverage" title={t('judgeGroupCoverage')} hint={t('judgeGroupCoverageHint')}>
      <SelectRow card={card} field="evidence.coverage.mode" options={[off, { value: 'shadow', label: t('optShadow') }, { value: 'control', label: t('optControl') }]} />
      <SelectRow card={card} field="evidence.coverage.provider" options={options} />
      <NumberRow card={card} field="evidence.coverage.thresholds.weak" />
      <NumberRow card={card} field="evidence.coverage.thresholds.covered" />
    </Fold>
    <Fold id="judge-budget" title={t('judgeGroupBudget')} hint={t('judgeGroupBudgetHint')}>
      <NumberRow card={card} field="evidence.budget.perSearchInputTokens" unit="tokens" />
      <NumberRow card={card} field="evidence.budget.dailyInputTokens" unit="tokens" />
      <TextRow card={card} field="evidence.budget.timezone" placeholder="Asia/Shanghai" />
    </Fold>
    <SubHead>{t('judgeGroupProviders')}</SubHead>
    <JsonList card={card} fields={jsonFieldsOf('judge')} />
    <RubricList card={card} />
  </Group>
}
