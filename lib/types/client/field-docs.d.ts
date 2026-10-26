/**
 * The comment printed in front of every key of the text view ("Advanced: text mode"), in the language of the card: what the
 * setting is for, its allowed values or range, its default, and the risk when there is one. Comment lines start with `#`, so
 * the text stays valid YAML and a round trip never reads a comment as data. Pure and free of imports: the text view and the
 * tests read it, and the client bundle includes it. Nothing here names a secret value: keys are only ever referenced by name.
 * @module web-search-pro/client/field-docs
 */
export type DocLang = 'en' | 'zh';
/** The doc of a config field in a language; undefined only for a field the card does not know. */
export declare function fieldDoc(field: string, lang?: DocLang | string): string | undefined;
/** The docs of the groups of keys and the header of the text view. */
export declare function textViewDocs(lang?: DocLang | string): {
    header: readonly string[];
    group: Readonly<Record<string, string>>;
};
