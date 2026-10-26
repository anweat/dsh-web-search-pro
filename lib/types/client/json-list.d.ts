/**
 * The settings that are whole JSON objects (custom providers, platform backend chains, CLI adapters, custom platforms, ...) as a
 * list: a row each (name, how many entries it holds, "default" while it is empty) and one dialog with a code box and the
 * server's own validation message. Nothing here is a second place the data lives: the box edits the same staged field.
 * @module web-search-pro/client/json-list
 */
import { type Card } from './field-rows.tsx';
/** How many entries a JSON object text holds; undefined when it is not an object. */
export declare function entryCount(text: string): number | undefined;
/** The code box of one JSON field. */
export declare function JsonForm({ card, field }: {
    card: Card;
    field: string;
}): import("react").JSX.Element;
/** A list of JSON-object settings with its dialog. `fields` names which ones (see JSON_FIELDS). */
export declare function JsonList({ card, fields }: {
    card: Card;
    fields: readonly string[];
}): import("react").JSX.Element;
/** The fields of one group of JSON settings. */
export declare const jsonFieldsOf: (group: "judge" | "runtime" | "platform") => string[];
