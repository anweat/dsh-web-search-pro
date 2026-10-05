import type { RubricCardState, RubricTextKey, WebSearchCardState } from './form.ts'
import type { SettingsCardProps } from './index.ts'
import { styles as css } from './styles.ts'

type Translator = SettingsCardProps['t']

/** Label and hint keys of each rubric text control. */
const CONTROLS: readonly { key: RubricTextKey; label: Parameters<Translator>[0]; hint: Parameters<Translator>[0]; kind: 'line' | 'area' | 'number' }[] = [
  { key: 'version', label: 'rubricVersion', hint: 'rubricVersionHint', kind: 'line' },
  { key: 'instructions', label: 'rubricInstructions', hint: 'rubricInstructionsHint', kind: 'area' },
  { key: 'criteria', label: 'rubricCriteria', hint: 'rubricCriteriaHint', kind: 'area' },
  { key: 'maxStateChars', label: 'rubricMaxState', hint: 'rubricMaxStateHint', kind: 'number' },
  { key: 'maxCandidateChars', label: 'rubricMaxCandidate', hint: 'rubricMaxCandidateHint', kind: 'number' },
]

/** The built-in value of a control, shown as the placeholder while the entry leaves it blank. */
function builtinText(rubric: RubricCardState, key: RubricTextKey): string {
  switch (key) {
    case 'version': return rubric.builtin.version
    case 'instructions': return rubric.builtin.instructions
    case 'criteria': return rubric.builtin.criteria.join('\n')
    case 'maxStateChars': return String(rubric.builtin.maxStateChars)
    case 'maxCandidateChars': return String(rubric.builtin.maxCandidateChars)
  }
}

/**
 * One built-in rubric: its active version, and an override editor whose controls are views of one staged entry
 * (version, instructions, levels, limits). The problems shown are the ones the server would act on: it ignores an
 * invalid override and uses the built-in, so the card refuses to save one.
 */
function Rubric(props: Pick<SettingsCardProps, 't' | 'editRubric' | 'startRubric' | 'restoreRubric'> & { rubric: RubricCardState; disabled: boolean }) {
  const { t, rubric, disabled } = props
  const idBase = `web-search-pro-rubric-${rubric.id}`
  return (
    <div className={css.rubric} data-web-search-pro-rubric={rubric.id}>
      <div className={css.rubricHead}>
        <span>
          <strong>{rubric.id}</strong>
          <span className={css.badge}>{t('rubricActive')}: {rubric.activeVersion}</span>
          <span className={css.badge} data-on={rubric.editing || undefined}>{rubric.editing ? t('rubricOverrideOn') : `${t('rubricBuiltin')} ${rubric.builtin.version}`}</span>
        </span>
        <span>
          {rubric.editing
            ? <button type="button" className={css.linkButton} disabled={disabled} onClick={() => { props.restoreRubric(rubric.id) }}>{t('rubricRestore')}</button>
            : <button type="button" className={css.linkButton} disabled={disabled} onClick={() => { props.startRubric(rubric.id) }}>{t('rubricCreate')}</button>}
        </span>
      </div>
      <p className={css.hint}>{rubric.description}</p>
      {rubric.editing ? (
        <div className={css.grid}>
          {CONTROLS.filter(control => control.key !== 'criteria' || rubric.kind === 'score').map((control) => {
            const id = `${idBase}-${control.key}`
            const value = rubric.entry[control.key]
            const common = {
              id, value, disabled, placeholder: builtinText(rubric, control.key), spellCheck: false,
              'aria-invalid': rubric.invalid || undefined,
            }
            return (
              <div key={control.key} className={`${css.field} ${control.kind === 'area' ? css.fullRow : ''}`}>
                <label className={css.label} htmlFor={id}>{t(control.label)}</label>
                {control.kind === 'area'
                  ? <textarea {...common} className={`${css.input} ${css.textarea} ${css.code}`} rows={control.key === 'criteria' ? 5 : 6} onChange={event => { props.editRubric(rubric.id, control.key, event.currentTarget.value) }} />
                  : <input {...common} className={css.input} type="text" inputMode={control.kind === 'number' ? 'numeric' : undefined} onChange={event => { props.editRubric(rubric.id, control.key, event.currentTarget.value) }} />}
                <p className={css.hint}>{t(control.hint)}</p>
              </div>
            )
          })}
        </div>
      ) : null}
      {rubric.problems.length > 0 ? (
        <ul className={rubric.invalid ? css.problem : css.warning} role="alert" data-web-search-pro-rubric-problems>
          {rubric.problems.map((problem, index) => <li key={index}>{problem}</li>)}
        </ul>
      ) : null}
    </div>
  )
}

export function RubricEditor(props: Pick<SettingsCardProps, 't' | 'editRubric' | 'startRubric' | 'restoreRubric'> & { state: WebSearchCardState; disabled: boolean }) {
  const { t, state } = props
  return (
    <div data-web-search-pro-rubrics>
      <p className={css.hint}>{t('rubricNotes')}</p>
      {state.rubrics.map(rubric => <Rubric key={rubric.id} t={t} rubric={rubric} disabled={props.disabled} editRubric={props.editRubric} startRubric={props.startRubric} restoreRubric={props.restoreRubric} />)}
      {state.unknownRubrics.length > 0 ? <p className={css.warning} role="note">{t('rubricUnknown')} {state.unknownRubrics.join(', ')}</p> : null}
    </div>
  )
}
