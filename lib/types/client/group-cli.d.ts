/**
 * "Custom CLI": the command-line tools the user adds, as a list (id, command, purpose, confidence, whether the spec is valid) and one
 * edit dialog per tool. The dialog is a form over the same spec the JSON box holds ("View JSON" at the bottom): editing either side
 * rewrites the other, every problem is the server's own message shown by the control it is about, "Done" puts the spec into the
 * draft (only when it is valid), and "Try it" runs the draft once through the plugin. The entries live inside `cliAdapters`.
 * @module web-search-pro/client/group-cli
 */
import { type CliCheck, type CliForm } from './cli-form.ts';
import { type Card } from './field-rows.tsx';
type Json = Record<string, unknown>;
/** What the dialog holds: the spec (the source of truth), the form fields read from it, the JSON box text, and the trial's sample query. */
export interface CliDraft {
    mode: 'new' | 'edit';
    id: string;
    spec: Json;
    form: CliForm;
    jsonText: string;
    jsonError?: string;
    query: string;
}
export declare function draftOf(mode: 'new' | 'edit', id: string, spec: Json): CliDraft;
/** The draft after a form edit: the spec is rebuilt from the fields on top of the spec as it was, the JSON text follows. */
export declare function editForm(draft: CliDraft, patch: Partial<CliForm>): CliDraft;
/** A new entry's id; an existing one cannot be renamed (copy it instead). */
export declare function editId(draft: CliDraft, id: string): CliDraft;
/** The draft after the JSON box changed: a text that parses becomes the spec and the form is read from it; one that does not leaves both alone. */
export declare function editJson(draft: CliDraft, text: string): CliDraft;
/** What the form of one custom CLI shows and edits; presentational (the dialog and the render test both mount it). */
export declare function CliBody({ card, draft, check, disabled, onForm, onId, onJson, onQuery, onTrial }: {
    card: Card;
    draft: CliDraft;
    check: CliCheck;
    disabled: boolean;
    onForm: (patch: Partial<CliForm>) => void;
    onId: (id: string) => void;
    onJson: (text: string) => void;
    onQuery: (text: string) => void;
    onTrial: () => void;
}): import("react").JSX.Element;
export declare function CliDialog({ card, initial, taken, onClose }: {
    card: Card;
    initial: CliDraft;
    taken: readonly string[];
    onClose: () => void;
}): import("react").JSX.Element;
export declare function CliList({ card }: {
    card: Card;
}): import("react").JSX.Element;
export declare function CliGroup({ card }: {
    card: Card;
}): import("react").JSX.Element;
export {};
