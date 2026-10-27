/**
 * Conservative parsing of the time texts CLI tools print (a field source `{ time }` of the adapter spec): an exact format is
 * turned into an ISO date or timestamp, anything else gives nothing, so a result never carries a guessed time. Pure; the clock is
 * a parameter. Chinese relative and calendar texts are read in China time (UTC+8), which is what the sites print.
 *  - ISO 8601 (`2026-10-27T08:38:08Z`, with or without a zone offset or fraction) -> normalized timestamp;
 *  - the `created_at` of the X API (`Tue Oct 27 08:38:08 +0000 2026`) -> timestamp;
 *  - `YYYY-MM-DD` -> that date; `MM-DD` -> the latest such date that is not after today (a date in the future means last year);
 *  - `N分钟前` / `N小时前` -> timestamp (now minus N); `N天前` -> date; `昨天 HH:MM` -> timestamp (China time).
 * @module web-search-pro/cli/time-text
 */
/** The text as an ISO date (`YYYY-MM-DD`) or timestamp, or undefined when it is not one of the formats above. */
export declare function normalizeTimeText(raw: string, now?: number): string | undefined;
