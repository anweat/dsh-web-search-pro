/**
 * The groups the configuration is laid out in, and the order of its fields. One definition serves four readers: the order of
 * the keys of the `Config` schema (what the Host's generic configuration view and `--dump-config` print), the sections of the
 * settings card's text view, the group a field belongs to in the card's tests, and the docs. A test pins the schema to this
 * list, so a new field cannot be added without choosing its group.
 *
 * The groups follow the settings page, most used first: common, search order, sources and keys, custom CLI, reading and
 * evidence, platforms and runtime, advanced and diagnostics. Only top-level `Config` keys are listed; a key that is an object
 * (`sources`, `evidence`, `provider`, `keyedSources`, `playwright`) takes all of its nested options with it.
 *
 * Pure and free of imports: the client bundle includes this file.
 * @module web-search-pro/config-groups
 */
export declare const CONFIG_GROUP_IDS: readonly ["common", "order", "sources", "cli", "evidence", "runtime", "advanced"];
export type ConfigGroupId = typeof CONFIG_GROUP_IDS[number];
/** Top-level `Config` keys by group, in display order. */
export declare const CONFIG_GROUPS: Readonly<Record<ConfigGroupId, readonly string[]>>;
/** Titles of the groups, as the text view prints them (the card's own group titles live in its dictionary). */
export declare const CONFIG_GROUP_TITLES: Readonly<Record<'en' | 'zh', Readonly<Record<ConfigGroupId, string>>>>;
/** Every top-level key in display order. */
export declare const CONFIG_FIELD_ORDER: readonly string[];
/** The group of a top-level key, or of a dotted field (`sources.priority`, `evidence.judge.mode`) by its first segment. */
export declare function groupOf(field: string): ConfigGroupId | undefined;
