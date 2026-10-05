/**
 * Page-UI noise stripping for evidence excerpts (dev-plan M2c). Extracted page
 * text carries the labels of copy buttons, language tabs and collapsers as
 * standalone lines (`JS`, `COPY`, `CJS`, `复制代码`, `展开` ...). They waste
 * excerpt budget and confuse the reader, so excerpts are built from a cleaned
 * copy of the block text. `Block.text` itself stays raw: it is an exact slice of
 * the page text (see blocks.ts) and is what scorers and `expand` work with.
 *
 * Conservative by construction: a line is dropped only when, after trimming,
 * it consists solely of labels from `UI_LABELS` (so `CJS MJS` goes, a sentence
 * that merely contains the word "copy" stays); lines with digits are never
 * labels; fenced code blocks are left untouched.
 * @module web-search-pro/pipeline/clean
 */
/** Standalone UI labels, lower-cased; matching is case-insensitive and ignores surrounding whitespace / trailing colon. */
export declare const UI_LABELS: ReadonlySet<string>;
/**
 * Drop standalone UI-label lines and collapse runs of blank lines to one.
 * Lines inside fenced code blocks are never touched. Returns trimmed text.
 */
export declare function stripUiNoise(text: string): string;
