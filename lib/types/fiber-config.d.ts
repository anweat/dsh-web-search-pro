/**
 * Where the live, resolved plugin configuration is read from.
 *
 * Cordis 4.0.x (DSH 0.2.0 / 0.2.1 lines): `fiber.config` is the RESOLVED object (schema defaults applied,
 * `internal/config` hooks run) and there is no `effectiveConfig`. A volatile update swaps its fields in place.
 *
 * Cordis 4.1.x (DSH 0.2.2 line): `fiber.config` is the RAW input - no schema defaults, no hook results, and
 * `undefined` for an entry that has no configuration. The resolved object handed to `apply` is published as
 * `fiber.effectiveConfig` after every successful update. Reading `fiber.config` there skips defaults (nested
 * ones included) and credential/hook resolution, which is why `?? {}` alone only fixes the crash.
 *
 * So: prefer `effectiveConfig`, fall back to `config` (4.0.x), and never hand `undefined` onward.
 */
export interface FiberConfigSource {
    readonly effectiveConfig?: unknown;
    readonly config?: unknown;
}
export declare function liveFiberConfig<T extends object>(fiber: FiberConfigSource | undefined): T;
