/**
 * Which dictionary entry names a field, which fields carry a `?` text of their own, and the facts about the sources the
 * card lists. Pure data (no imports): the rows, the text view and the tests all read it.
 * @module web-search-pro/client/field-keys
 */
export declare function labelKey(field: string): string;
/** The fields whose dictionary has a `<key>Help` text (a longer explanation behind the `?`). */
export declare const WITH_HELP: ReadonlySet<string>;
/** `?` text applies to the generic budget keys too. */
export declare const hasHelp: (field: string) => boolean;
export type SourceTier = 'paid' | 'free-quota' | 'anonymous';
/** One source the "Sources" list shows and its edit dialog is made of. */
export interface SourceDef {
    id: string;
    name: string;
    tier: SourceTier;
    /** "常用": the plugin's recommended source (pinned to the registry descriptors by a test). */
    common?: boolean;
    /** The write-only key of the source (`CredentialId`), and the field naming the credential / variable it is stored under. */
    credential?: string;
    envField?: string;
    defaultEnv?: string;
    baseUrlField?: string;
    /** Other fields the dialog holds, in order. */
    extra?: readonly string[];
    /** The request budget of the source (`sources.budget.<id>.total|daily`). */
    budget?: boolean;
}
export declare const SOURCE_DEFS: readonly SourceDef[];
/** Fields of a source dialog in display order (the key itself is a credential, not a field). */
export declare function sourceFields(def: SourceDef): string[];
/** Fields shown as JSON objects, each in its own dialog: the field, the group it sits in. */
export declare const JSON_FIELDS: readonly {
    field: string;
    group: 'judge' | 'runtime' | 'platform';
}[];
/** Group of the text view each plain field is printed under (the others are listed explicitly where they are built). */
export declare const TEXT_GROUP: Readonly<Record<string, string>>;
/** Group of the text view of any field (judge, budget, keyed and rubric families included). */
export declare function textGroupOf(field: string): string;
