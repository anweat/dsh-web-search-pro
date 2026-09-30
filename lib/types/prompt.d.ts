/**
 * System prompt text for web-search-pro. The base part only describes this
 * plugin's own tools; browser_* guidance is appended when the optional
 * dsh-browser service is present (evaluated at prompt-assembly time).
 * @module web-search-pro/prompt
 */
export declare function buildPromptText(hasBrowser: boolean): string;
