/**
 * Versioned judge rubrics (dev-plan §4.4, design §7): the wording, the ordered
 * levels and the length caps of the questions the plugin puts to Jev, as data.
 *
 * Built-in rubrics reproduce the wording the offline evaluation was calibrated
 * with (bench/rubrics/*.v1.json; a bench test pins the two together). A user can
 * override one in `evidence.rubrics` (settings.yaml) without a code change:
 *
 *   evidence:
 *     rubrics:
 *       score.support: { version: v2, instructions: "...{need}...{candidate}" }
 *
 * An override must carry its own `version`; the rubric's id, version and a hash
 * of its full content go into every Jev result record and into the judge cache
 * keys, so a changed prompt never reuses an old answer. An override that fails
 * validation is ignored (the built-in is used) and the reason is reported.
 * Online models never rewrite rubrics: they only change through the settings.
 * @module web-search-pro/pipeline/rubrics
 */

import crypto from 'node:crypto'

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
  /** score: template of the shared state (billed again inside every question). */
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

export interface ResolvedRubric extends RubricDef {
  /** The content differs from the built-in (new version or changed text). */
  overridden: boolean
  /** First 12 hex of a SHA-256 over everything that shapes the question. */
  hash: string
  /** `id@version#hash`: the key recorded with results and mixed into cache keys. */
  key: string
}

/** Compact reference stored with scorer output. */
export interface RubricRef { id: string; version: string; overridden: boolean; hash: string; key: string }

export const refOf = (r: ResolvedRubric): RubricRef => ({ id: r.id, version: r.version, overridden: r.overridden, hash: r.hash, key: r.key })

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
]

export const BUILTIN_RUBRIC_IDS: readonly string[] = BUILTIN.map(r => r.id)

export const variablesOf = (template: string): string[] => [...template.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map(m => m[1]!)

/** Fill the variables in ONE pass (inserted text is never rescanned); variables not in `vars` stay open. */
export function renderTemplate(template: string, vars: Partial<Record<RubricVariable, string>>): string {
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (whole, name: string) => (Object.hasOwn(vars, name) ? vars[name as RubricVariable]! : whole))
}

function hashOf(def: RubricDef): string {
  const material = JSON.stringify([def.id, def.version, def.kind, def.lang, def.instructions, def.state ?? null, def.criteria ?? null, def.options ?? null, def.maxStateChars, def.maxCandidateChars])
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 12)
}

function seal(def: RubricDef, builtinHash: string | undefined): ResolvedRubric {
  const hash = hashOf(def)
  return { ...def, overridden: builtinHash !== undefined && hash !== builtinHash, hash, key: def.id + '@' + def.version + '#' + hash }
}

const builtinOf = (id: string): RubricDef | undefined => BUILTIN.find(r => r.id === id)

/** The built-in rubric as shipped. */
export function builtinRubric(id: string): ResolvedRubric {
  const def = builtinOf(id)
  if (!def) throw new Error('unknown rubric ' + id)
  return seal(def, hashOf(def))
}

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

/** Build a rubric from a built-in plus new content; throws nothing, returns the problems instead. */
export function buildRubric(id: string, fields: { version: string; instructions?: string; criteria?: readonly string[]; maxStateChars?: number; maxCandidateChars?: number }): { rubric: ResolvedRubric; problems?: undefined } | { rubric?: undefined; problems: string[] } {
  const base = builtinOf(id)
  if (!base) return { problems: ['unknown rubric id "' + id + '" (known: ' + BUILTIN_RUBRIC_IDS.join(', ') + ')'] }
  const problems = rubricProblems(base, fields)
  if (problems.length) return { problems }
  const def: RubricDef = {
    ...base,
    version: fields.version,
    ...fields.instructions !== undefined ? { instructions: fields.instructions } : {},
    ...fields.criteria !== undefined ? { criteria: [...fields.criteria] } : {},
    ...fields.maxStateChars !== undefined ? { maxStateChars: fields.maxStateChars } : {},
    ...fields.maxCandidateChars !== undefined ? { maxCandidateChars: fields.maxCandidateChars } : {},
  }
  const builtinHash = hashOf(base)
  const sealed = seal(def, builtinHash)
  // Changed content under the shipped version label would look like the old rubric in logs: demand a new label.
  if (sealed.overridden && fields.version === base.version) return { problems: ['changed content needs a new version (not "' + base.version + '")'] }
  return { rubric: sealed }
}

export interface RubricResolution {
  rubric: ResolvedRubric
  /** Why an override was ignored (empty when none was given or it is valid). */
  diagnostics: string[]
}

/** The active rubric for `id`: the valid override from `overrides`, else the built-in. */
export function resolveRubric(id: string, overrides?: Readonly<Record<string, unknown>> | undefined): RubricResolution {
  const raw = overrides?.[id]
  if (raw === undefined || raw === null) return { rubric: builtinRubric(id), diagnostics: [] }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { rubric: builtinRubric(id), diagnostics: [id + ': override ignored: not an object'] }
  const o = raw as Record<string, unknown>
  const unknownKeys = Object.keys(o).filter(k => !['version', 'instructions', 'criteria', 'maxStateChars', 'maxCandidateChars'].includes(k))
  const base = builtinOf(id)!
  const problems = [...unknownKeys.map(k => 'unknown field "' + k + '"'), ...rubricProblems(base, o)]
  if (!problems.length) {
    const built = buildRubric(id, o as unknown as RubricOverride)
    if (built.rubric) return { rubric: built.rubric, diagnostics: [] }
    problems.push(...built.problems)
  }
  return { rubric: builtinRubric(id), diagnostics: problems.map(p => id + ': override ignored, built-in ' + base.version + ' used: ' + p) }
}

/** Every built-in rubric resolved against the overrides, plus override ids that name no rubric. */
export function resolveAllRubrics(overrides?: Readonly<Record<string, unknown>> | undefined): { rubrics: ResolvedRubric[]; diagnostics: string[] } {
  const rubrics: ResolvedRubric[] = []
  const diagnostics: string[] = []
  for (const id of BUILTIN_RUBRIC_IDS) {
    const r = resolveRubric(id, overrides)
    rubrics.push(r.rubric)
    diagnostics.push(...r.diagnostics)
  }
  for (const id of Object.keys(overrides ?? {})) if (!BUILTIN_RUBRIC_IDS.includes(id)) diagnostics.push(id + ': override ignored: unknown rubric id (known: ' + BUILTIN_RUBRIC_IDS.join(', ') + ')')
  return { rubrics, diagnostics }
}
