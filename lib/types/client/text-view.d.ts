/**
 * The "Advanced: text mode" view: the plugin's settings as one commented YAML text. It is a read-only print of the controls'
 * staged state, not a second place the settings live. Every key has a comment in front of it (see field-docs.ts); keys you have
 * overridden are plain lines, the others are commented `# key: value` lines showing the value in force; secrets never appear
 * (only the names of the credentials that hold them). Comment lines start with `#`, so stripping them leaves exactly the
 * overrides as valid YAML.
 * @module web-search-pro/client/text-view
 */
import { type DocLang } from './field-docs.ts';
import { type FieldSpec, type Json } from './form-specs.ts';
interface FieldView {
    text: string;
    overridden: boolean;
}
/**
 * The text of the card's current (staged) settings in `lang`. `views` is the staged text and override flag of every field, as the
 * card state carries them; `specs` are the field specs of the form model.
 */
export declare function renderTextView(views: Readonly<Record<string, FieldView | undefined>>, specs: readonly FieldSpec[], lang?: DocLang | string): string;
/** The text of the lines that are data: every comment line and blank line dropped (what a YAML reader sees). */
export declare function stripComments(text: string): string;
export type { Json };
