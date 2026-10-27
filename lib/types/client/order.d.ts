/**
 * The pure side of the "Search order" group: the lists it edits (engines, the backend chain of a platform), the sources one can
 * add to them, what a source is called and whether the card can tell it is ready, and the edits as text patches. No Host, no DOM:
 * the editors call these and stage the resulting text into the form model, the tests call the same functions.
 * @module web-search-pro/client/order
 */
import { type SourceDef } from './field-keys.ts';
/** Dictionary-independent facts the list rows show; the names are proper names, the same in every language. */
export type SourceKind = 'keyed' | 'anonymous' | 'seam' | 'custom' | 'unknown';
export interface SourceInfo {
    id: string;
    name: string;
    kind: SourceKind;
    /** The row of the sources list this source is (key reference, request budget), when it has one. */
    def?: SourceDef;
}
/** The ctx.web engine of the Host: the default `engines` list names it (`seam`). */
export declare const SEAM_SOURCE: {
    readonly id: "seam";
    readonly name: "ctx.web (seam)";
};
/** The route ids a general engine list may name: every keyed and anonymous source of the card, plus the ctx.web engine. */
export declare const BUILTIN_ENGINE_IDS: readonly string[];
/** Id of a custom CLI as `engines` and `platformBackends` write it. */
export declare const customId: (id: string) => string;
export declare const isCustomId: (id: string) => boolean;
/** The custom CLI entries of the (staged) `cliAdapters` value, by id, in the order they were written. */
export declare function customEntries(cliAdapters: unknown): [string, Record<string, unknown>][];
/** What the list needs to know of a source id: its name and what kind it is. `cliAdapters` is the staged value (custom ids are looked up in it). */
export declare function sourceInfo(id: string, cliAdapters?: unknown): SourceInfo;
/** The ids of a list value written as comma-separated text (`engines`), de-duplicated, in order. */
export declare const idsOf: (text: string) => string[];
/** The text form of a list of ids. */
export declare const textOf: (ids: readonly string[]) => string;
export declare function addId(ids: readonly string[], id: string): string[];
export declare function removeId(ids: readonly string[], id: string): string[];
/** Move `id` one place towards the front (`-1`) or the back (`1`); at an end, or when absent, the list comes back unchanged. */
export declare function moveId(ids: readonly string[], id: string, delta: -1 | 1): string[];
/**
 * The sources that can be added to the general engine list: the built-in ones and the custom CLIs marked `engine`, those already in
 * the list left out. A custom CLI whose spec is invalid is not offered (the server would not register it).
 */
export declare function engineChoices(current: readonly string[], cliAdapters: unknown): string[];
/** Display names of the platforms that have a backend chain (proper names; the ids are what `platformBackends` is keyed by). */
export declare const PLATFORM_NAMES: Readonly<Record<string, string>>;
/** Display names of the fixed (non-CLI) backends. */
export declare const BACKEND_NAMES: Readonly<Record<string, string>>;
/** The platforms the card lists: every one with a backend chain. */
export declare const ORDER_PLATFORMS: readonly string[];
/** The built-in default chain of a platform. */
export declare const defaultChainOf: (platform: string) => readonly string[];
/**
 * The backends that can sit in the chain of `platform`: the built-in ones that serve it (CLI specs and the fixed backends) and the
 * custom CLIs whose spec declares the platform; those already in `current` are left out.
 */
export declare function backendChoices(platform: string, current: readonly string[], cliAdapters: unknown): string[];
/** The name a backend row shows: the fixed backends and custom CLIs by name, a CLI spec by its command. */
export declare function backendName(id: string): string;
/** The `platformBackends` value of the staged text as an object (undefined when it is empty or not an object). */
export declare function chainsOf(text: string): Record<string, string[]> | undefined;
/**
 * `platformBackends` text with the chain of `platform` set to `ids`, or the platform's key removed (`ids` undefined: back to the
 * default chain). Other platforms, and keys this card does not know, are kept as they were. The empty object comes back as
 * the empty text, which the form model stores as "not set".
 */
export declare function withChain(text: string, platform: string, ids: readonly string[] | undefined): string | undefined;
export interface CustomRow {
    id: string;
    bin: string;
    engine: boolean;
    platforms: string[];
    confidence: number;
    /** The validation problems of the entry (empty = the spec is valid and the server registers it). */
    problems: string[];
}
/** One row per custom CLI of the staged `cliAdapters` value: what the list shows, with the server's own validation. */
export declare function customRows(cliAdapters: unknown): CustomRow[];
/** The platforms people reach for most: listed even when nothing was changed for them. */
export declare const COMMON_PLATFORMS: readonly string[];
/**
 * Which platforms the list shows up front, and which fold into "show the rest": a platform is shown when its chain was changed
 * (`platformBackends` has its key), when a valid custom CLI declares it, or when it is one of the common ones. Both halves keep the
 * order of `platforms`. `platformBackends` is the staged text; when it is not valid JSON nothing counts as changed.
 */
export declare function splitPlatforms(platforms: readonly string[], platformBackends: string, cliAdapters: unknown): {
    shown: string[];
    rest: string[];
};
/** The platforms whose display name or id contains `query` (case-insensitive, surrounding spaces ignored); an empty query keeps all. */
export declare function filterPlatforms(platforms: readonly string[], query: string): string[];
export interface ConfidenceView {
    /** The value the row runs with: the typed override when it is a number, else the source's default. */
    effective: number;
    /** The text is not a number in 0-1. */
    invalid: boolean;
    /** Whether the row has its own value in the draft (the box is not empty). */
    typed: boolean;
    /** The value changes nothing (it is 1) and is not wrong: the row shows it as a quiet "default" until someone opens it. */
    quiet: boolean;
}
/** What the confidence box of a row shows, from the staged text of `sources.confidence.<id>` and the default of the source. */
export declare function confidenceView(text: string, defaultValue: number): ConfidenceView;
