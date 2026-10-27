/**
 * The agent overlay: the settings an agent may change at run time without hand-editing the configuration.
 *
 * The profile configuration stays the user's baseline. The overlay is a small managed file next to the plugin's database
 * (`$DSH_HOME/data/web-search-pro/overlay.json`, or beside `dbPath` when the user moved it) that `dynamic()` merges on top of the
 * baseline on every read, so every consumer sees the change at once, with no watcher and no restart. It holds only what
 * overlay-types.ts lists (engine order, source priority / disabled, confidence, platform backend chains, custom CLI specs),
 * carries a revision for optimistic locking, a checksum, and an audit trail cut to {@link MAX_AUDIT_ENTRIES} entries.
 *
 * The same functions validate a change before it is written and the whole file when it is loaded: a file that does not parse,
 * fails its checksum, holds a value the validators refuse, or no longer agrees with the baseline (a chain naming a CLI the user
 * removed) is ignored as a whole and reported, never half applied. Validation reuses the functions the settings card and
 * `sources.status` use (`cliIssues`, `sourcesIssues`, the CLI spec validator, the source id rules).
 *
 * Adding or replacing only: the overlay never deletes a baseline entry. Taking a baseline CLI out of service is
 * `sources.disabled`; removing a CLI the overlay added is `config.remove_cli`.
 * @module web-search-pro/overlay
 */
import type { ResolvedConfig } from './config.ts';
import { MAX_AUDIT_ENTRIES, OVERLAY_FILE, OVERLAY_VERSION, type AuditChange, type AuditEntry, type OverlayItem, type OverlayValues, type OverlayView, type ResetScope } from './overlay-types.ts';
export { MAX_AUDIT_ENTRIES, OVERLAY_FILE, OVERLAY_VERSION };
export interface Overlay {
    version: 1;
    revision: number;
    updatedAt: string;
    values: OverlayValues;
    audit: AuditEntry[];
}
export declare function emptyOverlay(): Overlay;
export declare function checksumOf(overlay: Pick<Overlay, 'version' | 'revision' | 'updatedAt' | 'values' | 'audit'>): string;
/** `<dir of dbPath>/overlay.json`: the overlay sits beside the database, wherever the user put it. */
export declare function overlayFileFor(dbPath: string): string;
/** The baseline with the overlay merged on top. Never mutates its inputs. */
export declare function mergeOverlay(base: ResolvedConfig, values: OverlayValues): ResolvedConfig;
/** Where the effective value of an overlay key comes from, and what it is. */
export declare function effectiveValueOf(config: ResolvedConfig, key: string): unknown;
/** The id rules of the sources the baseline knows; supplied by the router (`registry.routeId(id) !== undefined`). */
export type KnownSource = (id: string) => boolean;
/** Problems the overlay values add to what the baseline already has (the user's own mistakes are not the overlay's to answer for). */
export declare function overlayErrors(base: ResolvedConfig, values: OverlayValues, known: KnownSource): string[];
/** Reason rule shared by every write: a real sentence, not a placeholder. */
export declare function checkReason(reason: unknown): string;
export type OverlayChange = {
    kind: 'order';
    engines?: unknown;
    priority?: unknown;
    disabled?: unknown;
    platform?: unknown;
    backends?: unknown;
} | {
    kind: 'confidence';
    id: unknown;
    value: unknown;
} | {
    kind: 'upsertCli';
    id: unknown;
    spec: unknown;
} | {
    kind: 'removeCli';
    id: unknown;
} | {
    kind: 'reset';
    scope: ResetScope;
    id?: unknown;
}
/** The settings card: drop these keys (one or several), or everything when `keys` is `'all'`. */
 | {
    kind: 'revoke';
    keys: readonly string[] | 'all';
};
export interface ChangeMeta {
    actor: 'agent' | 'user';
    /** The action name (`config.set_order`) or the card's button. */
    action: string;
    reason: string;
    sessionId?: string;
    /** When given, the change only applies if the overlay is still at this revision. */
    expectedRevision?: number;
}
export interface AppliedChange {
    /** False when the change left the overlay as it was (nothing was written, the revision is unchanged). */
    changed: boolean;
    revision: number;
    keys: string[];
    changes: AuditChange[];
    audit?: AuditEntry;
}
export interface OverlayStoreOptions {
    file: string;
    /** The configuration the user owns (the profile), re-read on every call. */
    baseline: () => ResolvedConfig;
    known: KnownSource;
    /** Changes whenever the answer of `known` can have changed (the router's registry revision), so a cached verdict is not kept past it. */
    knownSignature?: () => string;
    now?: () => Date;
}
export declare class OverlayStore {
    private readonly options;
    private overlay;
    private signature;
    private loadProblem;
    private compat;
    constructor(options: OverlayStoreOptions);
    get file(): string;
    private stat;
    /** Re-read the file when its mtime or size changed. No watcher: every read of the effective config asks. */
    private refresh;
    private reload;
    private readFile;
    /** Strict parse: unknown keys, wrong types, a failed checksum or any value the validators refuse reject the whole file. */
    private parse;
    /** Why the overlay is being ignored, if it is: a broken file, or values that no longer agree with the baseline. */
    get problem(): string | undefined;
    private incompatibility;
    /** The loaded overlay (an empty one while the file is missing or ignored). */
    current(): Overlay;
    /** The configuration as the plugin runs it: the baseline with the overlay on top, or the baseline alone while the overlay is ignored. */
    effective(): ResolvedConfig;
    baselineConfig(): ResolvedConfig;
    /** The overlaid keys with the newest audit entry that touched each, for the card and `config.inspect`. */
    items(): OverlayItem[];
    view(limit?: number): OverlayView;
    /** Compute the values a change leads to without writing anything. Throws {@link ActionArgError} for an invalid change. */
    private plan;
    /** Drop empty containers, and entries equal to the baseline (an override that changes nothing is not one). */
    private normalize;
    /**
     * Plan, validate and write a change: re-reads the file first, checks the revision, validates the merged result with the
     * server's own functions, writes atomically (0600) and appends the audit entry. A failed change leaves the file as it was.
     */
    apply(change: OverlayChange, meta: ChangeMeta): AppliedChange;
    private write;
    /** Move an unreadable file aside (kept for inspection) so a fresh overlay can start. */
    private quarantine;
}
