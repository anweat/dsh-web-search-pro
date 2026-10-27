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
  field: string
  /** The value in force: what the plugin started with. */
  running: string
  /** The value the configuration holds now. */
  configured: string
}

/** Why each field is read at start-up only (shown in the docs and the card's `?` text). */
export const RESTART_FIELDS = {
  toolSurface: 'the tools (web_index + web_call, or one tool per action) are registered at start-up',
  'playwright.snapshotDir': 'the snapshot folder of read.snapshot is resolved at start-up',
  providerId: 'the id of the ctx.web provider is given to the Host at registration',
  registerProvider: 'the ctx.web provider is registered at start-up',
  timeoutMs: 'the per-action deadlines and the Host tool ceiling are fixed at start-up (the cooperative time budget of a search reads it live)',
  memoryCacheEntries: 'the in-process LRU cache is sized at start-up',
  dbPath: 'the SQLite store and the overlay file are opened at start-up',
  verbose: 'the load marker is written at start-up',
} as const satisfies Record<string, string>

export type RestartField = keyof typeof RESTART_FIELDS

/** The field names, in the order of the configuration groups (config-groups.ts). */
export const RESTART_FIELD_LIST = Object.keys(RESTART_FIELDS) as RestartField[]

export const isRestartField = (field: string): field is RestartField => Object.hasOwn(RESTART_FIELDS, field)

/** The slice of the resolved configuration the restart check reads. */
export interface RestartSource {
  dbPath: string
  toolSurface: string
  registerProvider: boolean
  providerId: string
  verbose: boolean
  memoryCacheEntries: number
  timeoutMs: number
  playwright: { snapshotDir?: string }
}

/** The values of the restart fields as short text, from a resolved configuration. */
export function restartValues(config: RestartSource): Record<RestartField, string> {
  return {
    dbPath: config.dbPath,
    toolSurface: config.toolSurface,
    registerProvider: String(config.registerProvider),
    providerId: config.providerId,
    verbose: String(config.verbose),
    memoryCacheEntries: String(config.memoryCacheEntries),
    timeoutMs: String(config.timeoutMs),
    'playwright.snapshotDir': config.playwright.snapshotDir ?? '',
  }
}

/** The restart fields whose configured value differs from the one the running plugin started with. */
export function pendingRestart(mounted: Readonly<Record<RestartField, string>>, current: Readonly<Record<RestartField, string>>): PendingRestart[] {
  return RESTART_FIELD_LIST.filter(field => mounted[field] !== current[field]).map(field => ({ field, running: mounted[field], configured: current[field] }))
}

/** `待重启：toolSurface（当前生效 indexed，配置为 flat）`, one line per field. */
export function pendingRestartLine(entry: PendingRestart): string {
  return '待重启：' + entry.field + '（当前生效 ' + (entry.running || '(空)') + '，配置为 ' + (entry.configured || '(空)') + '）'
}
