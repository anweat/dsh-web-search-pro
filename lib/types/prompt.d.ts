/**
 * System prompt text for web-search-pro: one line for this plugin's tools, plus one line when the optional
 * dsh-browser service is present (evaluated at prompt-assembly time). Everything else lives in the
 * `dsh-web-search-pro` skill and in the `web_index` root, so it costs context only when it is needed.
 * @module web-search-pro/prompt
 */
export declare function buildPromptText(hasBrowser: boolean): string;
