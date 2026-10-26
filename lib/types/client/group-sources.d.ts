/**
 * "Sources": how sources are ranked (policy, priority, disabled) and a list of the sources that need a key or an address: a
 * row per source (name, tier, whether its key is set, and the "常用" mark), and one edit dialog per source holding its key
 * reference, write-only key, endpoint and request budget. The anonymous sources are a folded reference table. Edits stage into
 * the same draft the sticky save bar writes; a dialog has no save button of its own.
 * @module web-search-pro/client/group-sources
 */
import { type Card } from './field-rows.tsx';
import { type SourceDef } from './field-keys.ts';
import type { CredentialId } from './form.ts';
/** The write-only key of a source. It shows whether a key is stored, never the key. */
export declare function SecretRow({ card, id, label }: {
    card: Card;
    id: CredentialId;
    label: string;
}): import("react").JSX.Element;
/** Whether a source is usable as far as the card can tell: its key is stored, or (SearXNG) its address is set. */
export declare function useSourceReady(card: Card, def: SourceDef): {
    ready: boolean;
    loading: boolean;
};
/** The controls of one source: reference name, write-only key, endpoint, extras and request budget. */
export declare function SourceForm({ card, def }: {
    card: Card;
    def: SourceDef;
}): import("react").JSX.Element;
/** One source's edit dialog. */
export declare function SourceDialog({ card, def, onClose }: {
    card: Card;
    def: SourceDef;
    onClose: () => void;
}): import("react").JSX.Element;
/** One row of the sources list. */
export declare function SourceItem({ card, def, onEdit }: {
    card: Card;
    def: SourceDef;
    onEdit: () => void;
}): import("react").JSX.Element;
/** Open dialog state shared by the Common and Sources groups: one source at a time. */
export declare function SourceList({ card, only }: {
    card: Card;
    only?: readonly string[];
}): import("react").JSX.Element;
export declare function SourcesGroup({ card }: {
    card: Card;
}): import("react").JSX.Element;
