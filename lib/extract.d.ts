/**
 * Userscript-style page extraction ("脚本猫/油猴" inspired): declarative
 * per-hostname rules (content + removal selectors) applied over a jsdom
 * parse, with generic readability fallbacks and a DOM→text walker.
 * Built-in rules cover common Chinese/global sites; users can add persistent
 * rules through the web_rule tool (stored in SQLite).
 * @module web-search-pro/extract
 */
export interface ExtractRule {
    hostname: string;
    contentSelectors: string[];
    removeSelectors?: string[];
}
/** Built-in extraction rules, applied after user rules (user rules win). */
export declare const BUILTIN_RULES: ExtractRule[];
/** Normalize a hostname for matching (strip www. and port). */
export declare function normalizeHost(hostname: string): string;
/**
 * Find the best rule for a hostname: longest suffix match against user +
 * built-in rules.
 */
export declare function matchRule(hostname: string, rules: readonly ExtractRule[]): ExtractRule | undefined;
export interface ExtractResult {
    title: string;
    text: string;
    usedRule: string | undefined;
}
/**
 * Extract readable text + title from an HTML document.
 * @param html - raw HTML.
 * @param url - page URL (for hostname rule matching).
 * @param rules - merged rule list (user rules first, built-ins appended).
 * @param maxChars - output cap.
 */
export declare function extractText(html: string, url: string, rules: readonly ExtractRule[], maxChars?: number): ExtractResult;
/** Extract titles + links from HTML search result lists (generic). */
export declare function extractResultLinks(html: string): {
    title: string;
    url: string;
}[];
