/**
 * What "Adopt into configuration" writes, and the small formatting the agent section needs. Pure and free of the Host: the
 * controller calls these, the tests call the same functions.
 *
 * Adopting an overlay entry means the user takes the agent's value as their own: it is written into the profile (the baseline) with
 * the same atomic `mutate` the save bar uses, at the leaf the entry is about (`sources.confidence.<id>`, `cliAdapters.<id>`,
 * `platformBackends.<platform>`, `engines`, `sources.priority`, `sources.disabled`), and only then is the overlay entry dropped, so there
 * is never a moment when the value is in neither place. Revoking only drops the entry.
 * @module web-search-pro/client/overlay-ops
 */
import type { OverlayItem } from '../overlay-types.ts';
export type SectionOp = {
    op: 'set';
    path: string[];
    value: unknown;
} | {
    op: 'unset';
    path: string[];
};
export interface Adoption {
    /** The Host ops that write the value into the configuration. */
    ops: SectionOp[];
    /** Card fields whose staged draft the adopted value replaces (the draft would otherwise be shown against a changed baseline). */
    drop: string[];
}
/** The ops that write an overlay item into the configuration; undefined for a key that is none of the overridable ones. */
export declare function adoptionOf(item: Pick<OverlayItem, 'kind' | 'target' | 'value'>): Adoption | undefined;
/** The overlay key a card field is the baseline of (the row that shows it carries the "changed by the agent" mark), or undefined. */
export declare function overlayKeyOfField(field: string): string | undefined;
/** `2026-10-27 22:35` in the viewer's time zone; the text itself when it is no date. */
export declare function formatTime(iso: string): string;
/**
 * The custom CLIs an overlay item leans on that only the overlay holds: an engine list or a platform chain that names `custom-cli:<id>`
 * where `cliAdapters.<id>` is itself an overlay entry. Adopting such an item alone would leave the configuration naming a CLI it does not
 * define, so the card says to adopt the CLI too.
 */
export declare function overlayCliDependencies(item: Pick<OverlayItem, 'kind' | 'value'>, items: readonly Pick<OverlayItem, 'key'>[]): string[];
