/**
 * The form side of the custom CLI editor: a `cliAdapters` entry (the JSON spec) as the fields of the edit dialog and back. Two
 * views of one object: the form writes the keys it has controls for onto a copy of the spec and leaves every other key as it
 * was (searches, read, env, login, errorCodes, a field mapping that is not a plain path), and the JSON box edits the whole spec.
 * Validation is `validateCliAdapterSpec`, the function the server registers specs with; its messages are sorted to the field they
 * are about. `allowedSubcommands` is derived from the command words of the argv templates, never typed.
 * Pure: no Host, no DOM.
 * @module web-search-pro/client/cli-form
 */

import { commandWords, DEFAULT_CUSTOM_CONFIDENCE, OUTPUT_FORMATS, validateCliAdapterSpec, WHOLE_OUTPUT_DEFAULT_CHARS, type OutputFormat } from '../cli/spec.ts'

type Json = Record<string, unknown>
const isRecord = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [])

/** The result fields the form maps, in display order; each takes a dotted path into one item of the tool's output. */
export const FIELD_KEYS = ['url', 'title', 'snippet', 'publishedAt'] as const
export type FieldKey = typeof FIELD_KEYS[number]

/** How a plain text tool's lines become items (`whole` is a switch of its own). */
export const LINE_MODES = ['url-lines', 'tsv'] as const
export type LineMode = typeof LINE_MODES[number]

export interface CliForm {
  /** The key in `cliAdapters` (`custom-cli:<id>` everywhere else). */
  id: string
  /** The command: a name on PATH, never a path. */
  bin: string
  /** The argument template, one token per entry; `{query}`, `{count}` and `{terms}` are filled in. */
  argv: string[]
  format: OutputFormat
  /** Text output only: the whole stdout is one result (no field mapping). */
  whole: boolean
  wholeMax: string
  /** json / yaml: dotted path of the result array (empty = the root array or the first array found). */
  itemsPath: string
  linesMode: LineMode
  /** tsv: the column names, comma separated. */
  columns: string
  /** A plain dotted path per result field; a mapping that is more than a path is kept as it is and listed in `complex`. */
  fields: Record<FieldKey, string>
  complex: FieldKey[]
  timeoutMs: string
  maxOutputBytes: string
  /** The purposes: a general search engine, and/or the platforms whose backend chain it may sit in. */
  engine: boolean
  platforms: string[]
  /** Empty = the default (0.5). */
  confidence: string
  packageNote: string
  /** The probe: the help command (space separated) and the fragments its output must contain. */
  helpArgs: string
  mustContain: string[]
}

/** The spec a new entry starts from: a JSON-printing tool mapped url / title / snippet. The form fills the command in. */
export function newSpec(): Json {
  return {
    bins: [''], packageNote: '', platforms: [], engine: true,
    probe: { versionArgs: ['--version'], helpArgs: ['--help'], mustContain: [] },
    allowedSubcommands: [],
    search: { argv: ['{query}'], output: { format: 'json', fields: { url: 'url', title: 'title', snippet: 'snippet' } } },
    env: {}, needsLogin: false, timeoutMs: 15_000, maxOutputBytes: 1_048_576,
  }
}

/** The example of the dialog: `echo`, whose whole output is the result (no field mapping), a way to see the pieces work without a real tool. */
export function echoSpec(): Json {
  return {
    bins: ['echo'], packageNote: 'echo (part of the system)', platforms: [], engine: true, confidence: 0.5,
    probe: { versionArgs: ['--version'], helpArgs: ['--help'], mustContain: [] },
    allowedSubcommands: [],
    search: { argv: ['{query}'], output: { format: 'text', lines: { mode: 'whole' } } },
    env: {}, needsLogin: false, timeoutMs: 5_000, maxOutputBytes: 65_536,
  }
}

const pathText = (value: unknown): string => (typeof value === 'string' ? value : '')

/** The form fields of a spec (plain or not): everything the dialog shows, as text. */
export function specToForm(id: string, raw: unknown): CliForm {
  const spec = isRecord(raw) ? raw : {}
  const search = isRecord(spec.search) ? spec.search : {}
  const output = isRecord(search.output) ? search.output : {}
  const lines = isRecord(output.lines) ? output.lines : undefined
  const fields = isRecord(output.fields) ? output.fields : {}
  const probe = isRecord(spec.probe) ? spec.probe : {}
  const complex = FIELD_KEYS.filter(key => fields[key] !== undefined && typeof fields[key] !== 'string')
  const numberText = (value: unknown): string => (typeof value === 'number' || typeof value === 'string' ? String(value) : '')
  return {
    id,
    bin: strings(spec.bins)[0] ?? '',
    argv: strings(search.argv),
    format: (OUTPUT_FORMATS as readonly unknown[]).includes(output.format) ? output.format as OutputFormat : 'json',
    whole: lines?.mode === 'whole',
    wholeMax: lines?.mode === 'whole' && lines.maxChars !== undefined ? numberText(lines.maxChars) : '',
    itemsPath: pathText(output.itemsPath),
    linesMode: lines?.mode === 'tsv' ? 'tsv' : 'url-lines',
    columns: lines?.mode === 'tsv' ? strings(lines.columns).join(', ') : '',
    fields: Object.fromEntries(FIELD_KEYS.map(key => [key, pathText(fields[key])])) as Record<FieldKey, string>,
    complex,
    timeoutMs: numberText(spec.timeoutMs),
    maxOutputBytes: numberText(spec.maxOutputBytes),
    engine: spec.engine === true,
    platforms: strings(spec.platforms),
    confidence: spec.confidence === undefined ? '' : numberText(spec.confidence),
    packageNote: typeof spec.packageNote === 'string' ? spec.packageNote : '',
    helpArgs: strings(probe.helpArgs).join(' '),
    mustContain: strings(probe.mustContain),
  }
}

/** A number typed in a box: the number when it is one, else the text itself, so the validation says what is wrong with it. */
const numberOrText = (text: string): unknown => {
  const trimmed = text.trim()
  return trimmed !== '' && Number.isFinite(Number(trimmed)) ? Number(trimmed) : trimmed
}

/** The command words the argv templates of a spec use, in order, without repeats: what `allowedSubcommands` must list. */
export function derivedSubcommands(spec: Json): string[] {
  const argvs: string[][] = []
  const probe = isRecord(spec.probe) ? spec.probe : {}
  argvs.push(strings(probe.versionArgs), strings(probe.helpArgs))
  const searchArgv = (value: unknown): void => { if (isRecord(value)) argvs.push(strings(value.argv)) }
  searchArgv(spec.search)
  searchArgv(spec.read)
  if (isRecord(spec.searches)) for (const entry of Object.values(spec.searches)) searchArgv(entry)
  return [...new Set(argvs.flatMap(argv => commandWords(argv)))]
}

/**
 * The spec the form describes, built on `base` (the entry as it was: every key the form has no control for is kept). Nothing is
 * validated here; a value that is not what its box wants is written as typed so `validateCliAdapterSpec` names it.
 */
export function formToSpec(form: CliForm, base: Json = {}): Json {
  const spec: Json = structuredClone(base)
  delete spec.id
  const bins = strings(spec.bins)
  spec.bins = [form.bin.trim(), ...bins.slice(1)]
  spec.packageNote = form.packageNote.trim() || (form.bin.trim() ? form.bin.trim() + ' (installed by you)' : '')
  spec.platforms = [...form.platforms]
  if (form.engine) spec.engine = true; else delete spec.engine
  if (form.confidence.trim() === '') delete spec.confidence; else spec.confidence = numberOrText(form.confidence)
  spec.needsLogin = typeof spec.needsLogin === 'boolean' ? spec.needsLogin : false
  if (!isRecord(spec.env)) spec.env = {}
  if (form.timeoutMs.trim() === '') delete spec.timeoutMs; else spec.timeoutMs = numberOrText(form.timeoutMs)
  if (form.maxOutputBytes.trim() === '') delete spec.maxOutputBytes; else spec.maxOutputBytes = numberOrText(form.maxOutputBytes)

  const probe: Json = isRecord(spec.probe) ? { ...spec.probe } : {}
  probe.versionArgs = Array.isArray(probe.versionArgs) ? probe.versionArgs : ['--version']
  probe.helpArgs = form.helpArgs.trim() === '' ? ['--help'] : form.helpArgs.trim().split(/\s+/)
  probe.mustContain = [...form.mustContain]
  spec.probe = probe

  const search: Json = isRecord(spec.search) ? { ...spec.search } : {}
  search.argv = [...form.argv]
  const previous = isRecord(search.output) ? search.output : {}
  const output: Json = { ...previous, format: form.format }
  delete output.lines
  const fields: Json = isRecord(previous.fields) ? { ...previous.fields } : {}
  if (form.format === 'text') {
    if (form.whole) {
      output.lines = form.wholeMax.trim() === '' ? { mode: 'whole' } : { mode: 'whole', maxChars: numberOrText(form.wholeMax) }
    } else {
      output.lines = form.linesMode === 'tsv' ? { mode: 'tsv', columns: form.columns.split(',').map(column => column.trim()).filter(Boolean) } : { mode: 'url-lines' }
    }
  }
  // The result array path belongs to json / yaml only (ndjson has one item per line).
  if (form.format === 'json' || form.format === 'yaml') {
    if (form.itemsPath.trim() !== '') output.itemsPath = form.itemsPath.trim(); else delete output.itemsPath
  } else delete output.itemsPath
  if (form.format === 'text' && form.whole) {
    // A whole-output result maps nothing: the field mapping goes away (the JSON view of an old mapping is not kept as dead weight).
    delete output.fields
  } else {
    for (const key of FIELD_KEYS) {
      if (form.complex.includes(key)) continue
      const text = form.fields[key].trim()
      if (text === '') delete fields[key]; else fields[key] = text
    }
    output.fields = fields
  }
  search.output = output
  spec.search = search
  spec.allowedSubcommands = derivedSubcommands(spec)
  return spec
}

/** The names of the dialog's fields that an error message can be about. */
export type ErrorField =
  | 'id' | 'bin' | 'argv' | 'format' | 'itemsPath' | 'lines' | 'fields' | FieldKey | 'timeoutMs' | 'maxOutputBytes' | 'platforms' | 'engine' | 'confidence' | 'packageNote' | 'probe' | 'general'

/** Sort the validator's messages (`cliAdapters.<id>.<path>: ...`) to the dialog field they are about. */
export function errorsByField(id: string, errors: readonly string[]): Partial<Record<ErrorField, string[]>> {
  const out: Partial<Record<ErrorField, string[]>> = {}
  const add = (field: ErrorField, message: string): void => { (out[field] ??= []).push(message) }
  const prefix = 'cliAdapters.' + id
  for (const error of errors) {
    // `cliAdapters.<id>.search.argv: ...` -> `search.argv: ...`; `cliAdapters.<id>: needsLogin ...` -> `needsLogin ...`
    const message = error.startsWith(prefix) ? error.slice(prefix.length).replace(/^[.:]\s*/, '') : error
    const rule: [RegExp, ErrorField][] = [
      [/^id\b/, 'id'], [/^bins\b/, 'bin'], [/^packageNote\b/, 'packageNote'], [/^platforms\b/, 'platforms'], [/^engine\b/, 'engine'], [/^confidence\b/, 'confidence'],
      [/^timeoutMs\b/, 'timeoutMs'], [/^maxOutputBytes\b/, 'maxOutputBytes'], [/^probe\b/, 'probe'],
      [/^search\.argv\b/, 'argv'], [/^search\.output\.format\b/, 'format'], [/^search\.output\.itemsPath\b/, 'itemsPath'], [/^search\.output\.lines\b/, 'lines'],
      [/^search\.output\.fields\.url\b/, 'url'], [/^search\.output\.fields\.title\b/, 'title'], [/^search\.output\.fields\.snippet\b/, 'snippet'], [/^search\.output\.fields\.publishedAt\b/, 'publishedAt'], [/^search\.output\.fields\b/, 'fields'],
    ]
    const hit = rule.find(([pattern]) => pattern.test(message))
    add(hit ? hit[1] : 'general', message)
  }
  return out
}

export interface CliCheck {
  spec: Json
  /** The validator's messages (empty = valid). */
  errors: string[]
  byField: Partial<Record<ErrorField, string[]>>
  ok: boolean
}

/** Build the spec of a form and validate it the way the server does; `taken` are the ids of the other entries (a new id may not repeat one). */
export function checkForm(form: CliForm, base: Json, taken: readonly string[] = []): CliCheck {
  const spec = formToSpec(form, base)
  return checkSpec(form.id, spec, taken)
}

/** Validate a spec (the JSON view): the server's function, plus the one rule only the editor has (an id is not used twice). */
export function checkSpec(id: string, spec: Json, taken: readonly string[] = []): CliCheck {
  const result = validateCliAdapterSpec({ ...spec, id }, 'user')
  const errors = [...result.errors]
  if (taken.includes(id)) errors.push('cliAdapters.' + id + '.id: "' + id + '" is already used by another entry')
  return { spec, errors, byField: errorsByField(id, errors), ok: errors.length === 0 }
}

/** The confidence the entry has: its own, else the default. */
export const confidenceOfForm = (form: CliForm): number => {
  const n = Number(form.confidence)
  return form.confidence.trim() !== '' && Number.isFinite(n) ? n : DEFAULT_CUSTOM_CONFIDENCE
}

export { WHOLE_OUTPUT_DEFAULT_CHARS }

// ── the JSON view ──────────────────────────────────────────────────────────

/** The JSON text of a spec as the dialog's raw box prints it. */
export const specText = (spec: Json): string => JSON.stringify(spec, null, 2)

/** The spec a raw JSON text holds, or the reason it is not one. */
export function parseSpecText(text: string): { spec: Json } | { error: string } {
  try {
    const value = JSON.parse(text) as unknown
    return isRecord(value) ? { spec: value } : { error: 'the spec must be a JSON object' }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

// ── the entries inside the `cliAdapters` text ──────────────────────────────

/** The `cliAdapters` object of the staged text (empty text = no entries); undefined when it is not an object. */
export function adaptersOf(text: string): Json | undefined {
  if (text.trim() === '') return {}
  try {
    const value = JSON.parse(text) as unknown
    return isRecord(value) ? value : undefined
  } catch { return undefined }
}

/**
 * The `cliAdapters` text with entry `id` set to `spec` (a new key goes last), or removed when `spec` is undefined. The other
 * entries are kept as they were. The object with no entries comes back as the empty text, which the form model stores as "not set".
 * Undefined when the current text is not an object (the raw JSON box has to be fixed first).
 */
export function withAdapter(text: string, id: string, spec: Json | undefined): string | undefined {
  const all = adaptersOf(text)
  if (!all) return undefined
  const next: Json = { ...all }
  if (spec === undefined) delete next[id]
  else next[id] = spec
  return Object.keys(next).length === 0 ? '' : JSON.stringify(next, null, 2)
}

/** A free id for a copy or a new entry: `base`, `base-2`, `base-3`, ... */
export function freeId(base: string, taken: readonly string[]): string {
  const stem = base.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+|-+$/g, '').slice(0, 36) || 'mycli'
  if (!taken.includes(stem)) return stem
  for (let n = 2; ; n++) if (!taken.includes(stem + '-' + n)) return stem + '-' + n
}
