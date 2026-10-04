/**
 * The pure part of the judge rubrics (dev-plan M10): the variable whitelist, limits, the built-in definitions and the
 * validation rules of an override. No Node imports, so the settings panel (client bundle) and the server validate a
 * rubric override with the very same code; hashing and resolution live in ./rubrics.ts.
 * @module web-search-pro/pipeline/rubrics-spec
 */

/** Variables a template may use; anything else rejects the rubric. */
export const RUBRIC_VARIABLES = ['task', 'need', 'constraint', 'candidate'] as const
export type RubricVariable = typeof RUBRIC_VARIABLES[number]
export type RubricKind = 'noul' | 'score' | 'choice'

export const RUBRIC_LIMITS = {
  versionPattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/,
  instructionsChars: 2000,
  criteriaMin: 2,
  criteriaMax: 10,
  criterionChars: 200,
  stateChars: [20, 2000],
  candidateChars: [100, 8000],
} as const

export interface RubricDef {
  /** Stable id without the version, e.g. `score.support`. */
  id: string
  version: string
  lang: 'zh'
  kind: RubricKind
  description: string
  /** Template; `{candidate}` is bound per item. */
  instructions: string
  /** score / noul: template of the shared state (billed again inside every question). */
  state?: string
  /** score: ordered level descriptions, lowest first (index = grade). */
  criteria?: readonly string[]
  /** choice: label -> description. */
  options?: Readonly<Record<string, string>>
  /** The task description inside the shared state / `{task}` is cut to this many characters. */
  maxStateChars: number
  /** The candidate (heading + block) is cut to this many characters. */
  maxCandidateChars: number
  /** Variables this rubric's template may use (a subset of the whitelist). */
  allowed: readonly RubricVariable[]
  /** Variables the template must contain. */
  required: readonly RubricVariable[]
}

/** What a user may set per rubric. */
export interface RubricOverride {
  version: string
  instructions?: string
  criteria?: string[]
  maxStateChars?: number
  maxCandidateChars?: number
}

// ── built-ins ───────────────────────────────────────────────────────────────

const BUILTIN: readonly RubricDef[] = [
  {
    id: 'score.support', version: 'v1', lang: 'zh', kind: 'score',
    description: '(需求, 文本块) 对：文本块对需求的支撑程度，0–3。',
    instructions: '下面的文本块对该需求的支撑程度如何？\n需求：{need}\n文本块：{candidate}',
    state: '搜索任务：{task}',
    criteria: ['无关或只有同名词', '同主题但不回答', '部分回答', '直接回答且含可定位证据'],
    maxStateChars: 200, maxCandidateChars: 1200,
    allowed: ['task', 'need', 'candidate'], required: ['need', 'candidate'],
  },
  {
    id: 'gate.relevance', version: 'v1', lang: 'zh', kind: 'noul',
    description: '只问主题相关，忽略约束。',
    instructions: '候选材料的主题是否与下列需求相关？只看主题，不考虑版本、时间、来源等限制条件。\n需求：{need}\n候选：{candidate}',
    maxStateChars: 200, maxCandidateChars: 1200,
    allowed: ['task', 'need', 'candidate'], required: ['need', 'candidate'],
  },
  {
    id: 'gate.constraint', version: 'v1', lang: 'zh', kind: 'noul',
    description: '逐条语义约束：候选是否满足该约束；材料中看不出时应偏向否定。',
    instructions: '候选材料是否满足下面这条约束？只判断这一条约束，不判断其他方面。\n约束：{constraint}\n候选：{candidate}',
    maxStateChars: 200, maxCandidateChars: 1200,
    allowed: ['task', 'constraint', 'candidate'], required: ['constraint', 'candidate'],
  },
  {
    id: 'cover.sufficient', version: 'v1', lang: 'zh', kind: 'noul',
    description: '(需求, 证据视图) 对：这些摘录本身是否足以回答需求（M9 覆盖判定）。',
    instructions: '下面的证据摘录本身是否已经明确给出了该需求的答案？只提到相同主题、相关名词或相邻内容不算。如果需求问的是某事物是否存在、是否被支持，摘录中明确说“有”或明确说“没有”都算足够。\n需求：{need}\n证据摘录：{candidate}',
    state: '搜索任务：{task}',
    maxStateChars: 200, maxCandidateChars: 2400,
    allowed: ['task', 'need', 'candidate'], required: ['need', 'candidate'],
  },
]

export const BUILTIN_RUBRIC_IDS: readonly string[] = BUILTIN.map(r => r.id)

export const variablesOf = (template: string): string[] => [...template.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map(m => m[1]!)

// ── validation ──────────────────────────────────────────────────────────────

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)

/** Problems of a candidate rubric content; empty = valid. `base` supplies the kind and the allowed variables. */
export function rubricProblems(base: RubricDef, fields: { version?: unknown; instructions?: unknown; criteria?: unknown; maxStateChars?: unknown; maxCandidateChars?: unknown }): string[] {
  const out: string[] = []
  if (typeof fields.version !== 'string' || !RUBRIC_LIMITS.versionPattern.test(fields.version)) out.push('version must be a label like "v2" (letters, digits, . _ -, at most 32 characters)')
  if (fields.instructions !== undefined) {
    const t = fields.instructions
    if (typeof t !== 'string' || !t.trim()) out.push('instructions must be a non-empty string')
    else {
      if (t.length > RUBRIC_LIMITS.instructionsChars) out.push('instructions longer than ' + RUBRIC_LIMITS.instructionsChars + ' characters')
      const used = new Set(variablesOf(t))
      for (const name of used) {
        if (!(RUBRIC_VARIABLES as readonly string[]).includes(name)) out.push('unknown variable {' + name + '} (allowed: ' + base.allowed.map(v => '{' + v + '}').join(' ') + ')')
        else if (!base.allowed.includes(name as RubricVariable)) out.push('variable {' + name + '} is not available in ' + base.id + ' (allowed: ' + base.allowed.map(v => '{' + v + '}').join(' ') + ')')
      }
      for (const name of base.required) if (!used.has(name)) out.push('instructions must contain {' + name + '}')
    }
  }
  if (fields.criteria !== undefined) {
    const c = fields.criteria
    if (base.kind !== 'score') out.push('criteria only apply to score rubrics')
    else if (!Array.isArray(c) || c.length < RUBRIC_LIMITS.criteriaMin || c.length > RUBRIC_LIMITS.criteriaMax) out.push('criteria needs ' + RUBRIC_LIMITS.criteriaMin + '-' + RUBRIC_LIMITS.criteriaMax + ' levels, lowest first')
    else if (c.some(x => typeof x !== 'string' || !x.trim() || x.length > RUBRIC_LIMITS.criterionChars)) out.push('each criterion must be a non-empty string of at most ' + RUBRIC_LIMITS.criterionChars + ' characters')
  }
  for (const [name, range] of [['maxStateChars', RUBRIC_LIMITS.stateChars], ['maxCandidateChars', RUBRIC_LIMITS.candidateChars]] as const) {
    const n = fields[name]
    if (n !== undefined && (!isInt(n) || n < range[0] || n > range[1])) out.push(name + ' must be an integer in ' + range[0] + '..' + range[1])
  }
  return out
}


/** The built-in definition of a rubric id, if it is one. */
export const builtinDef = (id: string): RubricDef | undefined => BUILTIN.find(r => r.id === id)

/** Keys an override may carry. */
export const RUBRIC_OVERRIDE_KEYS = ['version', 'instructions', 'criteria', 'maxStateChars', 'maxCandidateChars'] as const

/** Whether an override changes anything the question is made of, compared with the built-in. */
function changesContent(base: RubricDef, f: { instructions?: unknown; criteria?: unknown; maxStateChars?: unknown; maxCandidateChars?: unknown }): boolean {
  return (f.instructions !== undefined && f.instructions !== base.instructions)
    || (f.criteria !== undefined && JSON.stringify(f.criteria) !== JSON.stringify(base.criteria ?? null))
    || (f.maxStateChars !== undefined && f.maxStateChars !== base.maxStateChars)
    || (f.maxCandidateChars !== undefined && f.maxCandidateChars !== base.maxCandidateChars)
}

/**
 * Every reason an override entry of rubric `id` would be ignored; empty = it takes effect. The one rule set behind
 * `resolveRubric` (server) and the settings panel's rubric editor.
 */
export function overrideProblems(id: string, raw: unknown): string[] {
  const base = builtinDef(id)
  if (!base) return ['unknown rubric id "' + id + '" (known: ' + BUILTIN_RUBRIC_IDS.join(', ') + ')']
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return ['not an object']
  const o = raw as Record<string, unknown>
  const unknownKeys = Object.keys(o).filter(k => !(RUBRIC_OVERRIDE_KEYS as readonly string[]).includes(k))
  const problems = [...unknownKeys.map(k => 'unknown field "' + k + '"'), ...rubricProblems(base, o)]
  // Changed content under the shipped version label would look like the old rubric in logs: demand a new label.
  if (!problems.length && o.version === base.version && changesContent(base, o)) problems.push('changed content needs a new version (not "' + base.version + '")')
  return problems
}
