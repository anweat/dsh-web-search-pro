/**
 * Shared types of the provider-agnostic judge layer (dev-plan M5, design §7).
 *
 * A judge is split in two: a PROTOCOL (how a request is encoded and the answer
 * decoded: `systemone`, `rerank`, `llm`) and a PROVIDER (where it is sent: base
 * URL, model, credentials reference, limits, calibration). Any provider that
 * speaks a supported protocol can serve S6; nothing else in the pipeline knows
 * which one is configured.
 * @module web-search-pro/pipeline/judges/types
 */
export const PROTOCOLS = ['systemone', 'rerank', 'llm'];
//# sourceMappingURL=types.js.map