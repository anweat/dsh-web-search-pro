/**
 * Rows for the configuration fields the groups edit, wired to the card's staged form state.
 *
 * One component per control kind (switch, select, text, number, list of ids). Each is the single entry of its field: it renders
 * `data-wsp-field="<field>"`, which test/settings-card-render.test.ts counts, and it reads the label, the one-line hint and the
 * optional `?` text from the dictionary by the field's name (`<key>`, `<key>Hint`, `<key>Help`, see field-keys.ts).
 * @module web-search-pro/client/field-rows
 */
import type { SettingsCardProps } from './index.ts';
import type { CardFieldState, WebSearchCardState } from './form.ts';
import { fill } from './fill.ts';
import { type RowLabels, type SelectOption } from './ui-kit.tsx';
export type Card = SettingsCardProps;
export type Translator = Card['t'];
export type LabelKey = Parameters<Translator>[0];
export { fill };
export declare function rowLabels(t: Translator): RowLabels;
/** The id of a field's control, tied to its label. */
export declare const controlId: (field: string) => string;
/** The units a number field is written with. */
declare const UNIT_KEYS: {
    readonly ms: "unitMs";
    readonly sec: "unitSeconds";
    readonly chars: "unitChars";
    readonly count: "unitCount";
    readonly tokens: "unitTokens";
    readonly days: "unitDays";
    readonly rounds: "unitCount";
};
export type Unit = keyof typeof UNIT_KEYS;
export interface FieldProps {
    card: Card;
    /** The setting field this row is the entry of. */
    field: string;
    /** Replaces the dictionary hint. */
    hint?: string;
    placeholder?: string;
    /** Replaces the dictionary label. */
    label?: string;
    /** A short warning badge beside the label. */
    risk?: string;
    /** Hide the "overridden" badge and reset: for fields whose "default" is a computed one. */
    code?: boolean;
}
/** How many of these fields carry an override: the number a group's badge shows. */
export declare function useOverriddenCount(card: Card, fields: readonly string[]): number;
/** The staged state of a field. */
export declare const stateOf: (snapshot: WebSearchCardState, field: string) => CardFieldState | undefined;
export declare function useField(card: Card, field: string): {
    state: CardFieldState;
    disabled: boolean;
    edit: (text: string) => void;
    reset: () => void;
};
/** A boolean field as a switch. */
export declare function SwitchRow(props: FieldProps): import("react").JSX.Element;
/** An enumerated field as a drop-down. */
export declare function SelectRow(props: FieldProps & {
    options: readonly SelectOption[];
}): import("react").JSX.Element;
/** A free-text field. */
export declare function TextRow(props: FieldProps): import("react").JSX.Element;
/** A number field with its unit written after the input. */
export declare function NumberRow(props: FieldProps & {
    unit?: Unit;
}): import("react").JSX.Element;
declare const parseList: (text: string) => string[];
/** A comma-separated list (engine ids, domains) as removable chips with an add box. */
export declare function ListRow(props: FieldProps): import("react").JSX.Element;
export { parseList };
