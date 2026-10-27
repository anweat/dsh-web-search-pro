/**
 * `config` group: let the agent read, and change at run time, the few settings that are about how a search is routed. The user's
 * configuration stays the baseline; these actions write the agent overlay (see ../overlay.ts), a managed file merged on top of it.
 *
 * `config.inspect` reads what is in force and where each value comes from. The writes need a `reason` (kept in the audit trail),
 * can pass `expectedRevision` to refuse a change made on a stale view, are validated with the same functions as the settings card,
 * and take effect on the next call. Only `config.upsert_cli` asks the user: it lets the plugin run a local program.
 * @module web-search-pro/actions/config
 */
import { type AuditEntry } from '../overlay-types.ts';
import { type ActionContext, type ActionDef } from './types.ts';
import type { ResolvedConfig } from '../config.ts';
/** Everything `config.inspect` reports, from the store and the two configurations. */
export declare function inspectOverlay(ctx: ActionContext, limit: number): {
    pendingRestart?: import("../restart.ts").PendingRestart[] | undefined;
    engines: {
        value: string[];
        source: "overlay" | "baseline";
    };
    priority: {
        value: string[];
        source: "overlay" | "baseline";
    };
    disabled: {
        value: string[];
        source: "overlay" | "baseline";
    };
    confidence: {
        id: string;
        value: number;
        source: "overlay" | "baseline";
    }[];
    platforms: {
        platform: string;
        backends: string[];
        source: "overlay" | "baseline";
    }[];
    cli: {
        confidence?: number | undefined;
        platforms: string[];
        engine?: boolean | undefined;
        id: string;
        source: "overlay" | "baseline";
        command: string;
    }[];
    audit: AuditEntry[];
    problem?: string | undefined;
    revision: number;
    file: string;
    valid: boolean;
};
/** The overridable settings of the effective configuration as YAML the user can paste into the entry's `config:` in a profile. */
export declare function exportYaml(config: ResolvedConfig, revision: number): string;
export declare const CONFIG_ACTIONS: ActionDef[];
