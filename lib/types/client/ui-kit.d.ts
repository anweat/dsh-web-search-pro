/**
 * The small set of controls the settings card is made of.
 *
 * Switches, buttons, badges, dialogs and the click-to-read help bubble are the Host's own
 * (`@deepseek-ai/dsh-client-ui-primitives`). The Host ships no select, no chip input, no accordion and no
 * list-row, so those four are built here from native elements (`<select>`, `<details>`, `<input>`) and the
 * `--dsw-alias-*` tokens, which makes them follow the light and dark themes without a color of their own.
 * Nothing in this file knows about a configuration field: callers pass text and callbacks.
 * @module web-search-pro/client/ui-kit
 */
import { type ReactNode } from 'react';
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'outline';
/** A read-only badge. */
export declare function Badge(props: {
    tone?: Tone;
    children: ReactNode;
}): import("react").JSX.Element;
/** The mark of a setting an agent changed: a warning badge whose tooltip carries the value, the reason and the time. */
export declare function AgentTag(props: {
    label: string;
    tip: string;
}): import("react").JSX.Element;
/** The `?` button: its text opens on click, so a long explanation costs one glyph until someone asks. */
export declare function Help(props: {
    label: string;
    text: string;
}): import("react").JSX.Element;
/** Labels every row shares, so a row does not need the dictionary itself. */
export interface RowLabels {
    overridden: string;
    reset: string;
    help: string;
    invalid: string;
}
export interface RowProps {
    /** The configuration field this row is the entry of (one per public field; the render test counts them). */
    field?: string;
    /** The id of the control, so the label is tied to it. */
    id?: string;
    label: string;
    /** One short sentence. Anything longer belongs in `help`. */
    hint?: string;
    help?: string;
    overridden?: boolean;
    invalid?: boolean;
    /** Replaces the hint while the value is invalid. */
    problem?: string;
    /** Accepted, but unlikely to do what was meant: a second line under the hint. */
    warning?: string;
    /** A small grey line under the hint: a range, a default. */
    meta?: string;
    /** A short warning badge beside the label, for a setting that widens what an agent may do. */
    risk?: string;
    /** The setting is read when the plugin starts: a badge saying so, with a `?` explaining why; `touched` picks it out while an edit of it is waiting to be saved. */
    restart?: {
        badge: string;
        why: string;
        touched?: boolean;
    };
    /** Extra controls beside the label (the "changed by the agent" mark with its adopt / revoke buttons). */
    mark?: ReactNode;
    disabled?: boolean;
    labels: RowLabels;
    onReset?: () => void;
    /** Control placement: beside the text (default) or on its own line. */
    wide?: boolean;
    inline?: boolean;
    children: ReactNode;
}
/** One setting: label, one-line hint, an optional `?`, the "overridden" badge with its reset, and the control. */
export declare function Row(props: RowProps): import("react").JSX.Element;
/** A closed-by-default fold inside a group, for the items few people need. */
export declare function Fold(props: {
    id: string;
    title: string;
    hint?: string;
    children: ReactNode;
}): import("react").JSX.Element;
/** A small heading inside a group, for sets of rows that belong together. */
export declare function SubHead(props: {
    children: ReactNode;
}): import("react").JSX.Element;
/**
 * One group of the card, an accordion item. `<details>` keeps every control in the document while the group is
 * closed (so a server-rendered check still sees them) and gives keyboard and screen-reader behavior for free.
 */
export declare function Group(props: {
    id: string;
    title: string;
    summary?: string;
    badges?: ReactNode;
    defaultOpen?: boolean;
    children: ReactNode;
}): import("react").JSX.Element;
export interface SelectOption {
    value: string;
    label: string;
}
/**
 * A native select. A stored value that is not among the options (a channel the list does not know, an older
 * enum value) is shown as its own entry instead of being silently replaced by the first option.
 */
export declare function Select(props: {
    id?: string;
    value: string;
    options: readonly SelectOption[];
    onChange: (value: string) => void;
    disabled?: boolean;
    muted?: boolean;
    invalid?: boolean;
    ariaLabel?: string;
}): import("react").JSX.Element;
/** A single-line text input; `muted` greys the value while it is only the inherited default. */
export declare function TextInput(props: {
    id?: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    muted?: boolean;
    invalid?: boolean;
    list?: string;
    numeric?: boolean;
    ariaLabel?: string;
    code?: boolean;
    small?: boolean;
    autoFocus?: boolean;
    onBlur?: () => void;
}): import("react").JSX.Element;
/** A text input followed by a fixed unit. */
export declare function UnitInput(props: {
    id?: string;
    value: string;
    unit: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    muted?: boolean;
    invalid?: boolean;
    ariaLabel?: string;
}): import("react").JSX.Element;
/** The Host's switch, named by its row. */
export declare function Toggle(props: {
    label: string;
    checked: boolean;
    onChange: (next: boolean) => void;
    disabled?: boolean;
}): import("react").JSX.Element;
/** A list of short strings as removable chips with an add box (Enter or comma adds; Backspace on an empty box removes the last). */
export declare function Chips(props: {
    id?: string;
    values: readonly string[];
    onChange: (values: string[]) => void;
    placeholder?: string;
    disabled?: boolean;
    /** Why a new entry is refused, or undefined. */
    check?: (value: string, existing: readonly string[]) => string | undefined;
    removeLabel: string;
    addLabel: string;
}): import("react").JSX.Element;
/** A dialog on the Host's modal: a title, a scrolling body, and a footer of actions. */
export declare function Dialog(props: {
    open: boolean;
    title: string;
    closeLabel: string;
    description?: string;
    onClose: () => void;
    footer?: ReactNode;
    wide?: boolean;
    children: ReactNode;
}): import("react").JSX.Element;
/** Primary and secondary buttons at the card's size. */
export declare function Btn(props: {
    children: ReactNode;
    onClick?: () => void;
    primary?: boolean;
    disabled?: boolean;
    danger?: boolean;
    title?: string;
    data?: string;
    ariaLabel?: string;
}): import("react").JSX.Element;
/** A list row: a title with badges, a meta line, and actions on the right. */
export declare function Item(props: {
    title: ReactNode;
    badges?: ReactNode;
    meta?: ReactNode;
    actions?: ReactNode;
    data?: string;
}): import("react").JSX.Element;
/** A write-only secret input: it never shows a stored value, only whether one is configured. */
export declare function SecretInput(props: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    status: string;
    configured: boolean;
    disabled?: boolean;
    ariaLabel?: string;
}): import("react").JSX.Element;
