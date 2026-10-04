/**
 * Closed value lists of the plugin configuration, with no imports so the settings panel (client bundle) offers
 * exactly the values the server accepts. config.ts re-exports them.
 * @module web-search-pro/config-enums
 */
/** `evidence.judge.mode` / the legacy `evidence.jevMode`. */
export declare const JUDGE_MODES: readonly ["off", "shadow", "control", "hybrid"];
export declare const PROVIDER_EVIDENCE_MODES: readonly ["auto", "off"];
/** `indexed` registers web_index + web_call; `flat` registers one tool per action (comparison and debugging only). */
export declare const TOOL_SURFACES: readonly ["indexed", "flat"];
export type ToolSurface = typeof TOOL_SURFACES[number];
