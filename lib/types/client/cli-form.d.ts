/**
 * The form side of the custom CLI editor: a `cliAdapters` entry (the JSON spec) as the fields of the edit dialog and back. Two
 * views of one object: the form writes the keys it has controls for onto a copy of the spec and leaves every other key as it
 * was (searches, read, env, login, errorCodes, a field mapping that is not a plain path), and the JSON box edits the whole spec.
 * Validation is `validateCliAdapterSpec`, the function the server registers specs with; its messages are sorted to the field they
 * are about. `allowedSubcommands` is derived from the command words of the argv templates, never typed.
 * Pure: no Host, no DOM.
 * @module web-search-pro/client/cli-form
 */
import { WHOLE_OUTPUT_DEFAULT_CHARS, type OutputFormat } from '../cli/spec.ts';
type Json = Record<string, unknown>;
/** The result fields the form maps, in display order; each takes a dotted path into one item of the tool's output. */
export declare const FIELD_KEYS: readonly ["url", "title", "snippet", "publishedAt"];
export type FieldKey = typeof FIELD_KEYS[number];
/** How a plain text tool's lines become items (`whole` is a switch of its own). */
export declare const LINE_MODES: readonly ["url-lines", "tsv"];
export type LineMode = typeof LINE_MODES[number];
export interface CliForm {
    /** The key in `cliAdapters` (`custom-cli:<id>` everywhere else). */
    id: string;
    /** The command: a name on PATH, never a path. */
    bin: string;
    /** The argument template, one token per entry; `{query}`, `{count}` and `{terms}` are filled in. */
    argv: string[];
    format: OutputFormat;
    /** Text output only: the whole stdout is one result (no field mapping). */
    whole: boolean;
    wholeMax: string;
    /** json / yaml: dotted path of the result array (empty = the root array or the first array found). */
    itemsPath: string;
    linesMode: LineMode;
    /** tsv: the column names, comma separated. */
    columns: string;
    /** A plain dotted path per result field; a mapping that is more than a path is kept as it is and listed in `complex`. */
    fields: Record<FieldKey, string>;
    complex: FieldKey[];
    timeoutMs: string;
    maxOutputBytes: string;
    /** The purposes: a general search engine, and/or the platforms whose backend chain it may sit in. */
    engine: boolean;
    platforms: string[];
    /** Empty = the default (0.5). */
    confidence: string;
    packageNote: string;
    /** The probe: the help command (space separated) and the fragments its output must contain. */
    helpArgs: string;
    mustContain: string[];
}
/** The spec a new entry starts from: a JSON-printing tool mapped url / title / snippet. The form fills the command in. */
export declare function newSpec(): Json;
/** The example of the dialog: `echo`, whose whole output is the result (no field mapping), a way to see the pieces work without a real tool. */
export declare function echoSpec(): Json;
/** The form fields of a spec (plain or not): everything the dialog shows, as text. */
export declare function specToForm(id: string, raw: unknown): CliForm;
/** The command words the argv templates of a spec use, in order, without repeats: what `allowedSubcommands` must list. */
export declare function derivedSubcommands(spec: Json): string[];
/**
 * The spec the form describes, built on `base` (the entry as it was: every key the form has no control for is kept). Nothing is
 * validated here; a value that is not what its box wants is written as typed so `validateCliAdapterSpec` names it.
 */
export declare function formToSpec(form: CliForm, base?: Json): Json;
/** The names of the dialog's fields that an error message can be about. */
export type ErrorField = 'id' | 'bin' | 'argv' | 'format' | 'itemsPath' | 'lines' | 'fields' | FieldKey | 'timeoutMs' | 'maxOutputBytes' | 'platforms' | 'engine' | 'confidence' | 'packageNote' | 'probe' | 'general';
/** Sort the validator's messages (`cliAdapters.<id>.<path>: ...`) to the dialog field they are about. */
export declare function errorsByField(id: string, errors: readonly string[]): Partial<Record<ErrorField, string[]>>;
export interface CliCheck {
    spec: Json;
    /** The validator's messages (empty = valid). */
    errors: string[];
    byField: Partial<Record<ErrorField, string[]>>;
    ok: boolean;
}
/** Build the spec of a form and validate it the way the server does; `taken` are the ids of the other entries (a new id may not repeat one). */
export declare function checkForm(form: CliForm, base: Json, taken?: readonly string[]): CliCheck;
/** Validate a spec (the JSON view): the server's function, plus the one rule only the editor has (an id is not used twice). */
export declare function checkSpec(id: string, spec: Json, taken?: readonly string[]): CliCheck;
/** The confidence the entry has: its own, else the default. */
export declare const confidenceOfForm: (form: CliForm) => number;
export { WHOLE_OUTPUT_DEFAULT_CHARS };
/** The JSON text of a spec as the dialog's raw box prints it. */
export declare const specText: (spec: Json) => string;
/** The spec a raw JSON text holds, or the reason it is not one. */
export declare function parseSpecText(text: string): {
    spec: Json;
} | {
    error: string;
};
/** The `cliAdapters` object of the staged text (empty text = no entries); undefined when it is not an object. */
export declare function adaptersOf(text: string): Json | undefined;
/**
 * The `cliAdapters` text with entry `id` set to `spec` (a new key goes last), or removed when `spec` is undefined. The other
 * entries are kept as they were. The object with no entries comes back as the empty text, which the form model stores as "not set".
 * Undefined when the current text is not an object (the raw JSON box has to be fixed first).
 */
export declare function withAdapter(text: string, id: string, spec: Json | undefined): string | undefined;
/** A free id for a copy or a new entry: `base`, `base-2`, `base-3`, ... */
export declare function freeId(base: string, taken: readonly string[]): string;
