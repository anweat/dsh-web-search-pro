/**
 * The agent overlay, pure half: the shapes the overlay file, the `config.*` actions and the settings card's RPC channel carry, and
 * the small helpers that name an overlay entry. The store that reads and writes the file is overlay.ts (Node); the card bundle
 * includes only this file. No imports.
 *
 * The overlay is a small managed file next to the plugin's database. It sits on top of the configuration the user owns (the
 * profile) and can hold only the settings an agent may change at run time: the engine order, the source priority and disabled
 * lists, the confidence of a source, the backend chain of a platform, and custom CLI adapter specs. Everything else stays
 * the user's: an agent cannot reach a key, a path, a switch or a budget through it.
 * @module web-search-pro/overlay-types
 */
export declare const OVERLAY_VERSION = 1;
export declare const OVERLAY_FILE = "overlay.json";
/** The audit trail is cut to the newest entries, so the file stays small however long it lives. */
export declare const MAX_AUDIT_ENTRIES = 50;
export declare const MIN_REASON = 3;
export declare const MAX_REASON = 300;
/** What `config.reset` can drop. */
export declare const RESET_SCOPES: readonly ["all", "order", "confidence", "cli", "platform"];
export type ResetScope = typeof RESET_SCOPES[number];
/** The overlaid values, in the shape of the configuration fields they sit on. Absent = the baseline applies. */
export interface OverlayValues {
    /** The whole `engines` list. */
    engines?: string[];
    sources?: {
        priority?: string[];
        disabled?: string[];
        /** Per source or backend id. */
        confidence?: Record<string, number>;
    };
    /** Per platform, the whole backend chain. */
    platformBackends?: Record<string, string[]>;
    /** Per id, the whole adapter spec (without its `id`, which is the key). */
    cliAdapters?: Record<string, Record<string, unknown>>;
}
/** One line of the audit trail: what a key was before and after, as short text. */
export interface AuditChange {
    key: string;
    before: string;
    after: string;
}
export interface AuditEntry {
    /** The revision this change produced. */
    revision: number;
    at: string;
    /** `agent`: a `config.*` action. `user`: the settings card. */
    actor: 'agent' | 'user';
    action: string;
    sessionId?: string;
    reason: string;
    changes: AuditChange[];
}
export type OverlayItemKind = 'engines' | 'priority' | 'disabled' | 'confidence' | 'platform' | 'cli';
/** One overridden key, for the card and `config.inspect`. */
export interface OverlayItem {
    /** `engines`, `sources.priority`, `sources.disabled`, `sources.confidence.<id>`, `platformBackends.<platform>`, `cliAdapters.<id>`. */
    key: string;
    kind: OverlayItemKind;
    /** The id, platform or adapter id the key is about. */
    target?: string;
    /** The overlaid value. */
    value: unknown;
    /** Short text of the overlaid value. */
    summary: string;
    /** Short text of what the baseline holds there, for the card. */
    baseline: string;
    /** The newest audit entry that touched this key (absent when it has rotated out of the trail). */
    at?: string;
    reason?: string;
    actor?: AuditEntry['actor'];
    sessionId?: string;
}
/** What the card reads over RPC (`overlay` endpoint) and `config.inspect` extends. */
export interface OverlayView {
    file: string;
    revision: number;
    updatedAt: string;
    /** The overlay file loads and agrees with the baseline; false = it is being ignored as a whole. */
    valid: boolean;
    problem?: string;
    items: OverlayItem[];
    audit: AuditEntry[];
}
/** The keys an overlay holds, in a stable order. */
export declare function overlayKeys(values: OverlayValues): string[];
/** Kind and target of an overlay key; undefined for a name that is not one. */
export declare function describeKey(key: string): {
    kind: OverlayItemKind;
    target?: string;
} | undefined;
export declare function clipText(text: string, max: number): string;
/**
 * Short text of a value for the audit trail and the card: a list is its items joined with `>` (order matters), a number is itself,
 * a CLI spec is its command and search arguments (what the program is and what it is asked), nothing is `(none)`.
 */
export declare function summarizeValue(key: string, value: unknown, max?: number): string;
/** `<bins[0]> <search.argv...>`: the command a custom CLI spec would run for a search, with the placeholders as written. */
export declare function cliCommandLine(spec: Record<string, unknown>): string;
