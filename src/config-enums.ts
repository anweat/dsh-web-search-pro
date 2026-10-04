/**
 * Closed value lists of the plugin configuration, with no imports so the settings panel (client bundle) offers
 * exactly the values the server accepts. config.ts re-exports them.
 * @module web-search-pro/config-enums
 */

/** `evidence.judge.mode` / the legacy `evidence.jevMode`. */
export const JUDGE_MODES = ['off', 'shadow', 'control', 'hybrid'] as const

export const PROVIDER_EVIDENCE_MODES = ['auto', 'off'] as const

/** `indexed` registers web_index + web_call; `flat` registers one tool per action (comparison and debugging only). */
export const TOOL_SURFACES = ['indexed', 'flat'] as const
export type ToolSurface = typeof TOOL_SURFACES[number]
