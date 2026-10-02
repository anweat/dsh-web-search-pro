/**
 * web-search-pro — 增强型、可持久化的扩展网页搜索插件 for DeepSeek Harness.
 *
 * - Multi-backend search routing with automatic fallback (agent-reach style):
 *   ctx.web seam / Exa / DuckDuckGo / Bing / Jina + platform backends
 *   (bili-cli, yt-dlp, sov2ex, opencli, agent-reach).
 * - Persistent SQLite store (MediaCrawler style): search queries + results,
 *   page snapshots, and user-extended per-site extraction rules survive
 *   restarts and are reused within a configurable TTL.
 * - Userscript-style per-site extraction rules ("脚本猫/油猴" style) applied
 *   by the fetch pipeline (Jina Reader → HTTP+extraction → Playwright).
 * - Optional ctx.web provider registration so the built-in web_search /
 *   web_fetch tools can route through this plugin.
 *
 * @module web-search-pro
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.ts';
export declare const name = "web-search-pro";
export declare const inject: string[];
export { Config };
export type { Config as WebSearchProConfig } from './config.ts';
export { ExaClient } from './exa-client.ts';
export type { ExaSearchRequest, ExaSearchType, ExaResult } from './exa-client.ts';
export { BackendRegistry } from './backend-registry.ts';
export type { Backend, BackendDiagnostic, BackendProbe } from './backend-registry.ts';
export declare function apply(ctx: Context, config: Config): void;
declare const _default: {
    name: string;
    inject: string[];
    Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        dbPath: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        ttlSeconds: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        memoryCacheEntries: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        rrfConstant: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        freshnessBoost: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        freshnessDays: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        authorityBoost: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        authorityDomains: import("@deepseek-ai/schemastery").default<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
        searchMaxResults: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        allowProxyFakeIp: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        engines: import("@deepseek-ai/schemastery").default<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
        parallelEngines: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        exaApiKey: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        exaApiKeyEnv: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        jinaApiKey: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        jinaApiKeyEnv: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        githubToken: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        githubTokenEnv: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        enableCliBackends: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        opencliEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        agentReachEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        providerId: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        registerProvider: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        platformRules: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
            item?: string | null | undefined;
            title?: string | null | undefined;
            link?: string | null | undefined;
            text?: string | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            item: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            title: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            link: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            text: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        }>>, string>>, "volatile">;
        customPlatforms: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
            name?: string | null | undefined;
            url?: string | null | undefined;
            item?: string | null | undefined;
            title?: string | null | undefined;
            link?: string | null | undefined;
            text?: string | null | undefined;
            cookie?: string | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            name: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            url: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            item: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            title: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            link: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            text: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            cookie: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        }>>, string>>, "volatile">;
        browserBindings: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
            authProfile?: string | null | undefined;
            rulePack?: string | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            authProfile: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            rulePack: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        }>>, string>>, "volatile">;
        playwright: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            snapshotDir: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            snapshotDir: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        }>>, "plain">;
        evidence: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            scorer: import("@deepseek-ai/schemastery").default<"rule" | "jev", "rule" | "jev", "volatile-defined">;
            jevMode: import("@deepseek-ai/schemastery").default<"off" | "shadow" | "control" | "hybrid", "off" | "shadow" | "control" | "hybrid", "volatile-defined">;
            hybridBorderline: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            maxJevQuestions: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            rubrics: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
                version?: string | null | undefined;
                instructions?: string | null | undefined;
                criteria?: string[] | null | undefined;
                maxStateChars?: number | null | undefined;
                maxCandidateChars?: number | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                version: import("@deepseek-ai/schemastery").default<string, string, "plain">;
                instructions: import("@deepseek-ai/schemastery").default<string, string, "plain">;
                criteria: import("@deepseek-ai/schemastery").default<string[], string[], "plain">;
                maxStateChars: import("@deepseek-ai/schemastery").default<number, number, "plain">;
                maxCandidateChars: import("@deepseek-ai/schemastery").default<number, number, "plain">;
            }>>, string>>, "volatile">;
        }>>, Schemastery.ObjectT<NoInfer<{
            scorer: import("@deepseek-ai/schemastery").default<"rule" | "jev", "rule" | "jev", "volatile-defined">;
            jevMode: import("@deepseek-ai/schemastery").default<"off" | "shadow" | "control" | "hybrid", "off" | "shadow" | "control" | "hybrid", "volatile-defined">;
            hybridBorderline: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            maxJevQuestions: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            rubrics: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
                version?: string | null | undefined;
                instructions?: string | null | undefined;
                criteria?: string[] | null | undefined;
                maxStateChars?: number | null | undefined;
                maxCandidateChars?: number | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                version: import("@deepseek-ai/schemastery").default<string, string, "plain">;
                instructions: import("@deepseek-ai/schemastery").default<string, string, "plain">;
                criteria: import("@deepseek-ai/schemastery").default<string[], string[], "plain">;
                maxStateChars: import("@deepseek-ai/schemastery").default<number, number, "plain">;
                maxCandidateChars: import("@deepseek-ai/schemastery").default<number, number, "plain">;
            }>>, string>>, "volatile">;
        }>>, "plain">;
        verbose: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        dbPath: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        ttlSeconds: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        memoryCacheEntries: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        rrfConstant: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        freshnessBoost: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        freshnessDays: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        authorityBoost: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        authorityDomains: import("@deepseek-ai/schemastery").default<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
        searchMaxResults: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        allowProxyFakeIp: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        engines: import("@deepseek-ai/schemastery").default<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
        parallelEngines: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        exaApiKey: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        exaApiKeyEnv: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        jinaApiKey: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        jinaApiKeyEnv: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        githubToken: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        githubTokenEnv: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        enableCliBackends: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        opencliEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        agentReachEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        providerId: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        registerProvider: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        platformRules: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
            item?: string | null | undefined;
            title?: string | null | undefined;
            link?: string | null | undefined;
            text?: string | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            item: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            title: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            link: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            text: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        }>>, string>>, "volatile">;
        customPlatforms: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
            name?: string | null | undefined;
            url?: string | null | undefined;
            item?: string | null | undefined;
            title?: string | null | undefined;
            link?: string | null | undefined;
            text?: string | null | undefined;
            cookie?: string | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            name: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            url: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            item: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            title: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            link: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            text: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            cookie: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        }>>, string>>, "volatile">;
        browserBindings: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
            authProfile?: string | null | undefined;
            rulePack?: string | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            authProfile: import("@deepseek-ai/schemastery").default<string, string, "plain">;
            rulePack: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        }>>, string>>, "volatile">;
        playwright: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            snapshotDir: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            snapshotDir: import("@deepseek-ai/schemastery").default<string, string, "plain">;
        }>>, "plain">;
        evidence: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
            scorer: import("@deepseek-ai/schemastery").default<"rule" | "jev", "rule" | "jev", "volatile-defined">;
            jevMode: import("@deepseek-ai/schemastery").default<"off" | "shadow" | "control" | "hybrid", "off" | "shadow" | "control" | "hybrid", "volatile-defined">;
            hybridBorderline: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            maxJevQuestions: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            rubrics: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
                version?: string | null | undefined;
                instructions?: string | null | undefined;
                criteria?: string[] | null | undefined;
                maxStateChars?: number | null | undefined;
                maxCandidateChars?: number | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                version: import("@deepseek-ai/schemastery").default<string, string, "plain">;
                instructions: import("@deepseek-ai/schemastery").default<string, string, "plain">;
                criteria: import("@deepseek-ai/schemastery").default<string[], string[], "plain">;
                maxStateChars: import("@deepseek-ai/schemastery").default<number, number, "plain">;
                maxCandidateChars: import("@deepseek-ai/schemastery").default<number, number, "plain">;
            }>>, string>>, "volatile">;
        }>>, Schemastery.ObjectT<NoInfer<{
            scorer: import("@deepseek-ai/schemastery").default<"rule" | "jev", "rule" | "jev", "volatile-defined">;
            jevMode: import("@deepseek-ai/schemastery").default<"off" | "shadow" | "control" | "hybrid", "off" | "shadow" | "control" | "hybrid", "volatile-defined">;
            hybridBorderline: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
            maxJevQuestions: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
            rubrics: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
                version?: string | null | undefined;
                instructions?: string | null | undefined;
                criteria?: string[] | null | undefined;
                maxStateChars?: number | null | undefined;
                maxCandidateChars?: number | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                version: import("@deepseek-ai/schemastery").default<string, string, "plain">;
                instructions: import("@deepseek-ai/schemastery").default<string, string, "plain">;
                criteria: import("@deepseek-ai/schemastery").default<string[], string[], "plain">;
                maxStateChars: import("@deepseek-ai/schemastery").default<number, number, "plain">;
                maxCandidateChars: import("@deepseek-ai/schemastery").default<number, number, "plain">;
            }>>, string>>, "volatile">;
        }>>, "plain">;
        verbose: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
    }>>, "plain">;
    apply: typeof apply;
};
export default _default;
