/**
 * The settings that are read once, when the plugin starts. Almost every field of `Config` is live (the Host updates the entry's
 * configuration in place and every call reads it through `dynamic()`), but these few are applied while the plugin is mounted:
 * a database opened, a tool registered, a cache sized, a deadline fixed. The Host lets them be edited (they are volatile in
 * the schema), so without a marker the edit looks like it was ignored until the next restart.
 *
 * One constant lists them; the settings card marks them, the save bar says so when a save touches one, and `sources.status` /
 * `config.inspect` report "待重启" when the configured value differs from the one the running plugin started with. Pure and
 * free of imports: the client bundle includes this file.
 * @module web-search-pro/restart
 */
export interface PendingRestart {
    field: string;
    /** The value in force: what the plugin started with. */
    running: string;
    /** The value the configuration holds now. */
    configured: string;
}
/** Why each field is read at start-up only (shown in the docs and the card's `?` text). */
export declare const RESTART_FIELDS: {
    readonly toolSurface: "the tools (web_index + web_call, or one tool per action) are registered at start-up";
    readonly 'playwright.snapshotDir': "the snapshot folder of read.snapshot is resolved at start-up";
    readonly providerId: "the id of the ctx.web provider is given to the Host at registration";
    readonly registerProvider: "the ctx.web provider is registered at start-up";
    readonly timeoutMs: "the per-action deadlines and the Host tool ceiling are fixed at start-up (the cooperative time budget of a search reads it live)";
    readonly memoryCacheEntries: "the in-process LRU cache is sized at start-up";
    readonly dbPath: "the SQLite store and the overlay file are opened at start-up";
    readonly verbose: "the load marker is written at start-up";
};
export type RestartField = keyof typeof RESTART_FIELDS;
/** The field names, in the order of the configuration groups (config-groups.ts). */
export declare const RESTART_FIELD_LIST: RestartField[];
export declare const isRestartField: (field: string) => field is RestartField;
/** The slice of the resolved configuration the restart check reads. */
export interface RestartSource {
    dbPath: string;
    toolSurface: string;
    registerProvider: boolean;
    providerId: string;
    verbose: boolean;
    memoryCacheEntries: number;
    timeoutMs: number;
    playwright: {
        snapshotDir?: string;
    };
}
/** The values of the restart fields as short text, from a resolved configuration. */
export declare function restartValues(config: RestartSource): Record<RestartField, string>;
/** The restart fields whose configured value differs from the one the running plugin started with. */
export declare function pendingRestart(mounted: Readonly<Record<RestartField, string>>, current: Readonly<Record<RestartField, string>>): PendingRestart[];
/** `待重启：toolSurface（当前生效 indexed，配置为 flat）`, one line per field. */
export declare function pendingRestartLine(entry: PendingRestart): string;
