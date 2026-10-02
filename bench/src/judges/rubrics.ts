/**
 * Rubric loading and rendering with a variable whitelist.
 * @module bench/judges/rubrics
 */

import fs from 'node:fs'
import path from 'node:path'
import { buildRubric, type ResolvedRubric } from '../../../src/pipeline/rubrics.ts'
import { BENCH_ROOT } from '../tasks.ts'
import { RUBRIC_VARIABLES, type JudgeContext, type JudgeQuestion, type Rubric } from './types.ts'

export const RUBRICS_DIR = path.join(BENCH_ROOT, 'rubrics')

export function validateRubric(raw: unknown): string[] {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') return ['not an object']
  const r = raw as Record<string, unknown>
  for (const k of ['id', 'version', 'description', 'instructions']) {
    if (typeof r[k] !== 'string' || !(r[k] as string).trim()) errors.push(k + ' must be a non-empty string')
  }
  if (r.lang !== 'zh') errors.push('lang must be zh')
  if (r.kind !== 'noul' && r.kind !== 'score' && r.kind !== 'choice') errors.push('bad kind: ' + String(r.kind))
  if (typeof r.id === 'string' && typeof r.version === 'string' && !r.id.endsWith('.' + r.version)) errors.push('id must end with .' + r.version)
  if (r.kind === 'score' && (!Array.isArray(r.criteria) || r.criteria.length < 2 || r.criteria.length > 10)) errors.push('score rubric needs criteria[] with 2-10 levels')
  if (r.kind === 'choice' && (!r.options || typeof r.options !== 'object' || Object.keys(r.options).length < 2)) errors.push('choice rubric needs options{}')
  if (typeof r.instructions === 'string') {
    for (const name of variablesOf(r.instructions)) {
      if (!(RUBRIC_VARIABLES as readonly string[]).includes(name)) errors.push('unknown template variable {' + name + '}')
    }
    if (!r.instructions.includes('{candidate}')) errors.push('instructions must contain {candidate}')
  }
  return errors
}

export function variablesOf(template: string): string[] {
  return [...template.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map(m => m[1]!)
}

export function loadRubrics(dir = RUBRICS_DIR): Map<string, Rubric> {
  const out = new Map<string, Rubric>()
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as unknown
    const errors = validateRubric(raw)
    if (errors.length) throw new Error('invalid rubric ' + file + ': ' + errors.join('; '))
    const rubric = raw as Rubric
    if (out.has(rubric.id)) throw new Error('duplicate rubric id ' + rubric.id)
    out.set(rubric.id, rubric)
  }
  return out
}

export interface RubricFile {
  /** The file as a bench rubric (id like `score.support.v2`): what the judge cache keys are built from. */
  bench: Rubric
  /** The same content as the plugin's runtime rubric (id `score.support`): what a JevScorer asks with. */
  resolved: ResolvedRubric
}

/**
 * Load an alternative rubric version (e.g. bench/rubrics/variants/score.support.v2-example.json) to
 * evaluate offline. Validated like a built-in rubric AND against the plugin's override rules, so a
 * file that passes here is also accepted by `evidence.rubrics` (its `id` minus `.<version>` names the
 * built-in rubric). Throws with every problem; makes no request.
 */
export function loadRubricFile(file: string): RubricFile {
  let raw: unknown
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (error) { throw new Error('cannot read rubric file ' + file + ': ' + (error as Error).message) }
  const errors = validateRubric(raw)
  if (errors.length) throw new Error('invalid rubric file ' + file + ': ' + errors.join('; '))
  const bench = raw as Rubric
  if (bench.kind !== 'score') throw new Error('invalid rubric file ' + file + ': only score rubrics can be evaluated by the Jev arm (kind is ' + bench.kind + ')')
  const base = bench.id.slice(0, -(bench.version.length + 1))
  const built = buildRubric(base, { version: bench.version, instructions: bench.instructions, ...bench.criteria ? { criteria: bench.criteria } : {}, ...bench.maxStateChars !== undefined ? { maxStateChars: bench.maxStateChars } : {}, ...bench.maxCandidateChars !== undefined ? { maxCandidateChars: bench.maxCandidateChars } : {} })
  if (!built.rubric) throw new Error('invalid rubric file ' + file + ': ' + built.problems.join('; '))
  return { bench, resolved: built.rubric }
}

export interface RenderVars { task?: string; need?: string; constraint?: string }

/** Render a rubric to a question: fills task/need/constraint, leaves `{candidate}` open. */
export function renderQuestion(rubric: Rubric, vars: RenderVars, context?: JudgeContext): JudgeQuestion {
  const instructions = rubric.instructions.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (whole, name: string) => {
    if (name === 'candidate') return whole
    if (name === 'task' || name === 'need' || name === 'constraint') return vars[name] ?? ''
    throw new Error('rubric ' + rubric.id + ': variable {' + name + '} is not whitelisted')
  })
  return {
    kind: rubric.kind,
    rubricId: rubric.id,
    rubricVersion: rubric.version,
    instructions,
    criteria: rubric.criteria,
    options: rubric.options,
    context,
  }
}

/** Bind the candidate text; a function replacer keeps `$` sequences in candidate text literal. */
export function bindCandidate(instructions: string, candidate: string): string {
  return instructions.includes('{candidate}') ? instructions.replace('{candidate}', () => candidate) : instructions
}
