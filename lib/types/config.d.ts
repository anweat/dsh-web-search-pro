/**
 * Plugin configuration (schemastery) and the resolved runtime shape.
 * @module web-search-pro/config
 */
import z from '@deepseek-ai/schemastery';
import type { JudgeSettings } from './pipeline/judges/providers.ts';
import type { BudgetInput } from './pipeline/ledger.ts';
import type { RubricOverride } from './pipeline/rubrics.ts';
/** A user-defined custom platform: search URL template + result selectors + optional login cookie. */
export interface CustomPlatformSpec {
    name: string;
    /** Search-page URL template; `{query}` is replaced with the URL-encoded query. */
    url: string;
    item: string;
    title: string;
    link: string;
    text?: string;
    /** Legacy raw Cookie header; prefer a domain-scoped dsh-browser AuthProfile. */
    cookie?: string;
}
export interface BrowserBinding {
    /** Named dsh-browser auth profile. */
    authProfile?: string;
    /** Named dsh-browser enhancement rule pack. */
    rulePack?: string;
}
/** Evidence-pipeline settings (web_search_pro with `task` / `profile`; dev-plan M2b). */
export interface EvidenceConfig {
    /**
     * Scorer for S6 decisions. `jev` only takes effect with `jevMode: 'control'`:
     * Jev is a paid hosted service, so it needs both keys turned.
     */
    scorer: 'rule' | 'jev';
    /**
     * `off`: never call Jev. `shadow`: the rule scorer decides, Jev scores are recorded for comparison.
     * `control`: Jev decides when `scorer` is `jev`; any Jev failure falls back to the rule scorer.
     * `hybrid`: the rule scorer grades everything and Jev re-scores only the (need, block) pairs whose languages differ
     * (plus rule-borderline ones with `hybridBorderline`), within `maxJevQuestions`; a Jev failure keeps the rule grades. Ignores `scorer`.
     */
    jevMode: 'off' | 'shadow' | 'control' | 'hybrid';
    /** `hybrid` only: also let Jev re-score pairs whose rule grade is 1 (borderline), after the language-mismatch pairs. */
    hybridBorderline: boolean;
    /** Upper bound of (need, block) questions sent to Jev per search. */
    maxJevQuestions: number;
    /**
     * S1 promotes registry providers that are strong in the task's language (Bocha for Chinese, Exa for English) and ready
     * (key configured) ahead of the profile table. Default true; false keeps the profile table / configured `engines` as they are.
     */
    autoProviders: boolean;
    /** Retrieval rounds per task (S8 bounded re-search): 1 disables the second round. Default 2. */
    maxRounds: number;
    /** Search requests per task over all rounds (a second round only runs while this is not used up). Default 4. */
    maxQueries: number;
    /**
     * Per-rubric overrides of the judge prompts, keyed by rubric id (`score.support`, `gate.relevance`, `gate.constraint`).
     * Each carries its own `version`; an override that fails validation is ignored and the built-in used (see pipeline/rubrics.ts).
     * Remove the entry to restore the default.
     */
    rubrics?: Record<string, RubricOverride>;
    /**
     * Which model judge S6 uses and where it lives (dev-plan M5). Absent = the built-in `bocha-jev` preset.
     * `mode` is the provider-neutral name of `jevMode` (it wins when both are set; `control` then needs no `scorer`).
     */
    judge?: JudgeSettings & {
        mode?: EvidenceConfig['jevMode'];
    };
    /** Model usage caps (input tokens) per search and per day, with per-provider overrides. Absent = 60k per search, 1M per day. */
    budget?: BudgetInput;
}
export interface Config {
    /** SQLite database path; defaults to $DSH_HOME/data/web-search-pro/store.db */
    dbPath?: string;
    /** Cache freshness window in seconds. */
    ttlSeconds: number;
    /** In-process LRU entry cap (hot queries resolve without touching SQLite). */
    memoryCacheEntries: number;
    /** Reciprocal Rank Fusion constant for multi-engine merging. */
    rrfConstant: number;
    /**
     * Recency bonus, as a fraction (0..1) of ONE TOP-RANK STEP on the normalised
     * fusion scale (pipeline/fusion.ts): added once per URL, so even at 1 a fresh
     * result gains about one rank position, and at the default it is a tie-breaker.
     */
    freshnessBoost: number;
    /** Days over which the recency bonus decays to zero. */
    freshnessDays: number;
    /**
     * Authority-domain bonus, same scale and once-per-URL rule as `freshnessBoost`:
     * it cannot lift a rank-10 result over a rank-1 result of the same engine.
     */
    authorityBoost: number;
    /** Extra authority domains (beyond the built-in .edu/.gov/.org and the curated list). */
    authorityDomains: string[];
    /** Default cap on returned sources per search. */
    searchMaxResults: number;
    /**
     * Default output cap (characters) of one `web_fetch_pro` call. Longer pages are cut here and
     * continued with `offset`; the ctx.web fetch provider (which cannot be told a size) uses twice this.
     */
    fetchDefaultChars: number;
    /** `web_exa_contents`: output cap per URL (characters). */
    exaContentsPerUrlChars: number;
    /** `web_exa_contents`: output cap over all URLs of one call (characters); shared fairly between them. */
    exaContentsTotalChars: number;
    /** Cooperative per-call timeout budget in ms. */
    timeoutMs: number;
    /** Trust Clash/TUN fake-IP DNS answers (198.18/15, fdfe:dcba:9876::/64, 2001:2::/48) while retaining all other SSRF checks. */
    allowProxyFakeIp: boolean;
    /** Ordered engine list for web_search_pro. */
    engines: string[];
    /** Query all requested engines in parallel and merge. */
    parallelEngines: boolean;
    /** Exa API key (falls back to $EXA_API_KEY / credentials ref). */
    exaApiKey?: string;
    /** Credential/env reference for the Exa key; defaults to EXA_API_KEY. */
    exaApiKeyEnv?: string;
    /** Jina AI API key (falls back to $JINA_API_KEY / credentials ref). */
    jinaApiKey?: string;
    /** Credential/env reference for the Jina key; defaults to JINA_API_KEY. */
    jinaApiKeyEnv?: string;
    /** Bocha web-search API key (falls back to the credentials ref / $BOCHA_SEARCH_API_KEY, then $BOCHA_JEV_API_KEY of the same account). */
    bochaApiKey?: string;
    /** Credential/env reference for the Bocha search key; defaults to BOCHA_SEARCH_API_KEY. */
    bochaApiKeyEnv?: string;
    /** Bocha endpoint base (`/v1/web-search` is appended); defaults to https://api.bochaai.com. */
    bochaBaseUrl?: string;
    /** Ask Bocha for its longer per-page summary (default true). */
    bochaSummary?: boolean;
    /** Self-hosted SearXNG instance URL (JSON format enabled); the `searxng` engine is available only when set. No public instance is built in. */
    searxngUrl?: string;
    /** Contact address put in the User-Agent of OpenAlex requests (etiquette; optional). */
    openalexMailto?: string;
    /** GitHub API token for the REST search engines (falls back to $GITHUB_TOKEN / $GH_TOKEN / credentials ref). */
    githubToken?: string;
    /** Credential/env reference for the GitHub token; defaults to GITHUB_TOKEN. */
    githubTokenEnv?: string;
    /** Allow CLI backends (bili / yt-dlp / opencli / agent-reach). */
    enableCliBackends: boolean;
    /** Allow opencli browser-session backends. */
    opencliEnabled: boolean;
    /** Allow agent-reach backends. */
    agentReachEnabled: boolean;
    /** Provider id registered into ctx.web for the built-in web_search tool. */
    providerId: string;
    /** Register the ctx.web provider (set DSH_WEB_SEARCH_PROVIDER to use it). */
    registerProvider: boolean;
    /** Per-platform search-page selector overrides (item/title/link/text). Overrides built-in specs. */
    platformRules?: Record<string, {
        item: string;
        title: string;
        link: string;
        text?: string;
    }>;
    /** User-defined custom platform search: url template + selectors + optional cookie. */
    customPlatforms?: Record<string, CustomPlatformSpec>;
    /** Per-platform binding to domain-scoped dsh-browser auth/rule profiles. */
    browserBindings?: Record<string, BrowserBinding>;
    /** Snapshot options. The browser runtime itself (channel/headless/storageStatePath) is provided by the dsh-browser plugin via the `browser` service. */
    playwright: {
        /** Gate the playwright fallback backend in web_fetch_pro. */
        enabled: boolean;
        /** Directory for web_snapshot artifacts; defaults to <dbDir>/snapshots. */
        snapshotDir?: string;
    };
    /** Evidence pipeline (S6 scoring). */
    evidence?: Partial<EvidenceConfig>;
    verbose: boolean;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    dbPath: z<string, string, "volatile">;
    ttlSeconds: z<number, number, "volatile-defined">;
    memoryCacheEntries: z<number, number, "volatile-defined">;
    rrfConstant: z<number, number, "volatile-defined">;
    freshnessBoost: z<number, number, "volatile-defined">;
    freshnessDays: z<number, number, "volatile-defined">;
    authorityBoost: z<number, number, "volatile-defined">;
    authorityDomains: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    searchMaxResults: z<number, number, "volatile-defined">;
    fetchDefaultChars: z<number, number, "volatile-defined">;
    exaContentsPerUrlChars: z<number, number, "volatile-defined">;
    exaContentsTotalChars: z<number, number, "volatile-defined">;
    timeoutMs: z<number, number, "volatile-defined">;
    allowProxyFakeIp: z<boolean, boolean, "volatile-defined">;
    engines: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    parallelEngines: z<boolean, boolean, "volatile-defined">;
    exaApiKey: z<string, string, "volatile">;
    exaApiKeyEnv: z<string, string, "volatile-defined">;
    jinaApiKey: z<string, string, "volatile">;
    jinaApiKeyEnv: z<string, string, "volatile-defined">;
    bochaApiKey: z<string, string, "volatile">;
    bochaApiKeyEnv: z<string, string, "volatile-defined">;
    bochaBaseUrl: z<string, string, "volatile-defined">;
    bochaSummary: z<boolean, boolean, "volatile-defined">;
    searxngUrl: z<string, string, "volatile">;
    openalexMailto: z<string, string, "volatile">;
    githubToken: z<string, string, "volatile">;
    githubTokenEnv: z<string, string, "volatile-defined">;
    enableCliBackends: z<boolean, boolean, "volatile-defined">;
    opencliEnabled: z<boolean, boolean, "volatile-defined">;
    agentReachEnabled: z<boolean, boolean, "volatile-defined">;
    providerId: z<string, string, "volatile-defined">;
    registerProvider: z<boolean, boolean, "volatile-defined">;
    platformRules: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
        item?: string | null | undefined;
        title?: string | null | undefined;
        link?: string | null | undefined;
        text?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        item: z<string, string, "plain">;
        title: z<string, string, "plain">;
        link: z<string, string, "plain">;
        text: z<string, string, "plain">;
    }>>, string>>, "volatile">;
    customPlatforms: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
        name?: string | null | undefined;
        url?: string | null | undefined;
        item?: string | null | undefined;
        title?: string | null | undefined;
        link?: string | null | undefined;
        text?: string | null | undefined;
        cookie?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        name: z<string, string, "plain">;
        url: z<string, string, "plain">;
        item: z<string, string, "plain">;
        title: z<string, string, "plain">;
        link: z<string, string, "plain">;
        text: z<string, string, "plain">;
        cookie: z<string, string, "plain">;
    }>>, string>>, "volatile">;
    browserBindings: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
        authProfile?: string | null | undefined;
        rulePack?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        authProfile: z<string, string, "plain">;
        rulePack: z<string, string, "plain">;
    }>>, string>>, "volatile">;
    playwright: z<Schemastery.ObjectS<NoInfer<{
        enabled: z<boolean, boolean, "volatile-defined">;
        snapshotDir: z<string, string, "plain">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: z<boolean, boolean, "volatile-defined">;
        snapshotDir: z<string, string, "plain">;
    }>>, "plain">;
    evidence: z<Schemastery.ObjectS<NoInfer<{
        scorer: z<"jev" | "rule", "jev" | "rule", "volatile-defined">;
        jevMode: z<"control" | "shadow" | "hybrid" | "off", "control" | "shadow" | "hybrid" | "off", "volatile-defined">;
        hybridBorderline: z<boolean, boolean, "volatile-defined">;
        maxJevQuestions: z<number, number, "volatile-defined">;
        autoProviders: z<boolean, boolean, "volatile-defined">;
        maxRounds: z<number, number, "volatile-defined">;
        maxQueries: z<number, number, "volatile-defined">;
        rubrics: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
            version?: string | null | undefined;
            instructions?: string | null | undefined;
            criteria?: string[] | null | undefined;
            maxStateChars?: number | null | undefined;
            maxCandidateChars?: number | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            version: z<string, string, "plain">;
            instructions: z<string, string, "plain">;
            criteria: z<string[], string[], "plain">;
            maxStateChars: z<number, number, "plain">;
            maxCandidateChars: z<number, number, "plain">;
        }>>, string>>, "volatile">;
        judge: z<NoInfer<Schemastery.ObjectS<NoInfer<{
            provider: z<string, string, "plain">;
            mode: z<"control" | "shadow" | "hybrid" | "off", "control" | "shadow" | "hybrid" | "off", "plain">;
            allowLlm: z<boolean, boolean, "plain">;
            providers: z<import("@deepseek-ai/cosmokit").Dict<{
                protocol?: "systemone" | "rerank" | "llm" | null | undefined;
                baseUrl?: string | null | undefined;
                model?: string | null | undefined;
                keyRef?: string | null | undefined;
                path?: string | null | undefined;
                rubricId?: string | null | undefined;
                tokenModel?: "expanded" | "plain" | null | undefined;
                label?: string | null | undefined;
                limits?: import("@deepseek-ai/cosmokit").Dict<number, string> | null | undefined;
                calibration?: ({
                    version?: string | null | undefined;
                    points?: number[][] | null | undefined;
                } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
                extraBody?: import("@deepseek-ai/cosmokit").Dict<any, string> | null | undefined;
                price?: ({
                    inputPerMTokens?: number | null | undefined;
                    outputPerMTokens?: number | null | undefined;
                    currency?: string | null | undefined;
                } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                protocol: z<"systemone" | "rerank" | "llm", "systemone" | "rerank" | "llm", "plain">;
                baseUrl: z<string, string, "plain">;
                model: z<string, string, "plain">;
                keyRef: z<string, string, "plain">;
                path: z<string, string, "plain">;
                rubricId: z<string, string, "plain">;
                tokenModel: z<"expanded" | "plain", "expanded" | "plain", "plain">;
                label: z<string, string, "plain">;
                limits: z<import("@deepseek-ai/cosmokit").Dict<number, string>, import("@deepseek-ai/cosmokit").Dict<number, string>, "plain">;
                calibration: z<Schemastery.ObjectS<NoInfer<{
                    version: z<string, string, "plain">;
                    points: z<number[][], number[][], "plain">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    version: z<string, string, "plain">;
                    points: z<number[][], number[][], "plain">;
                }>>, "plain">;
                extraBody: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "plain">;
                price: z<Schemastery.ObjectS<NoInfer<{
                    inputPerMTokens: z<number, number, "plain">;
                    outputPerMTokens: z<number, number, "plain">;
                    currency: z<string, string, "plain">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    inputPerMTokens: z<number, number, "plain">;
                    outputPerMTokens: z<number, number, "plain">;
                    currency: z<string, string, "plain">;
                }>>, "plain">;
            }>>, string>, "plain">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            provider: z<string, string, "plain">;
            mode: z<"control" | "shadow" | "hybrid" | "off", "control" | "shadow" | "hybrid" | "off", "plain">;
            allowLlm: z<boolean, boolean, "plain">;
            providers: z<import("@deepseek-ai/cosmokit").Dict<{
                protocol?: "systemone" | "rerank" | "llm" | null | undefined;
                baseUrl?: string | null | undefined;
                model?: string | null | undefined;
                keyRef?: string | null | undefined;
                path?: string | null | undefined;
                rubricId?: string | null | undefined;
                tokenModel?: "expanded" | "plain" | null | undefined;
                label?: string | null | undefined;
                limits?: import("@deepseek-ai/cosmokit").Dict<number, string> | null | undefined;
                calibration?: ({
                    version?: string | null | undefined;
                    points?: number[][] | null | undefined;
                } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
                extraBody?: import("@deepseek-ai/cosmokit").Dict<any, string> | null | undefined;
                price?: ({
                    inputPerMTokens?: number | null | undefined;
                    outputPerMTokens?: number | null | undefined;
                    currency?: string | null | undefined;
                } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                protocol: z<"systemone" | "rerank" | "llm", "systemone" | "rerank" | "llm", "plain">;
                baseUrl: z<string, string, "plain">;
                model: z<string, string, "plain">;
                keyRef: z<string, string, "plain">;
                path: z<string, string, "plain">;
                rubricId: z<string, string, "plain">;
                tokenModel: z<"expanded" | "plain", "expanded" | "plain", "plain">;
                label: z<string, string, "plain">;
                limits: z<import("@deepseek-ai/cosmokit").Dict<number, string>, import("@deepseek-ai/cosmokit").Dict<number, string>, "plain">;
                calibration: z<Schemastery.ObjectS<NoInfer<{
                    version: z<string, string, "plain">;
                    points: z<number[][], number[][], "plain">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    version: z<string, string, "plain">;
                    points: z<number[][], number[][], "plain">;
                }>>, "plain">;
                extraBody: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "plain">;
                price: z<Schemastery.ObjectS<NoInfer<{
                    inputPerMTokens: z<number, number, "plain">;
                    outputPerMTokens: z<number, number, "plain">;
                    currency: z<string, string, "plain">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    inputPerMTokens: z<number, number, "plain">;
                    outputPerMTokens: z<number, number, "plain">;
                    currency: z<string, string, "plain">;
                }>>, "plain">;
            }>>, string>, "plain">;
        }>>>, "volatile">;
        budget: z<NoInfer<Schemastery.ObjectS<NoInfer<{
            perSearchInputTokens: z<number, number, "plain">;
            dailyInputTokens: z<number, number, "plain">;
            timezone: z<string, string, "plain">;
            providers: z<import("@deepseek-ai/cosmokit").Dict<{
                perSearchInputTokens?: number | null | undefined;
                dailyInputTokens?: number | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                perSearchInputTokens: z<number, number, "plain">;
                dailyInputTokens: z<number, number, "plain">;
            }>>, string>, "plain">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            perSearchInputTokens: z<number, number, "plain">;
            dailyInputTokens: z<number, number, "plain">;
            timezone: z<string, string, "plain">;
            providers: z<import("@deepseek-ai/cosmokit").Dict<{
                perSearchInputTokens?: number | null | undefined;
                dailyInputTokens?: number | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                perSearchInputTokens: z<number, number, "plain">;
                dailyInputTokens: z<number, number, "plain">;
            }>>, string>, "plain">;
        }>>>, "volatile">;
    }>>, Schemastery.ObjectT<NoInfer<{
        scorer: z<"jev" | "rule", "jev" | "rule", "volatile-defined">;
        jevMode: z<"control" | "shadow" | "hybrid" | "off", "control" | "shadow" | "hybrid" | "off", "volatile-defined">;
        hybridBorderline: z<boolean, boolean, "volatile-defined">;
        maxJevQuestions: z<number, number, "volatile-defined">;
        autoProviders: z<boolean, boolean, "volatile-defined">;
        maxRounds: z<number, number, "volatile-defined">;
        maxQueries: z<number, number, "volatile-defined">;
        rubrics: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
            version?: string | null | undefined;
            instructions?: string | null | undefined;
            criteria?: string[] | null | undefined;
            maxStateChars?: number | null | undefined;
            maxCandidateChars?: number | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            version: z<string, string, "plain">;
            instructions: z<string, string, "plain">;
            criteria: z<string[], string[], "plain">;
            maxStateChars: z<number, number, "plain">;
            maxCandidateChars: z<number, number, "plain">;
        }>>, string>>, "volatile">;
        judge: z<NoInfer<Schemastery.ObjectS<NoInfer<{
            provider: z<string, string, "plain">;
            mode: z<"control" | "shadow" | "hybrid" | "off", "control" | "shadow" | "hybrid" | "off", "plain">;
            allowLlm: z<boolean, boolean, "plain">;
            providers: z<import("@deepseek-ai/cosmokit").Dict<{
                protocol?: "systemone" | "rerank" | "llm" | null | undefined;
                baseUrl?: string | null | undefined;
                model?: string | null | undefined;
                keyRef?: string | null | undefined;
                path?: string | null | undefined;
                rubricId?: string | null | undefined;
                tokenModel?: "expanded" | "plain" | null | undefined;
                label?: string | null | undefined;
                limits?: import("@deepseek-ai/cosmokit").Dict<number, string> | null | undefined;
                calibration?: ({
                    version?: string | null | undefined;
                    points?: number[][] | null | undefined;
                } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
                extraBody?: import("@deepseek-ai/cosmokit").Dict<any, string> | null | undefined;
                price?: ({
                    inputPerMTokens?: number | null | undefined;
                    outputPerMTokens?: number | null | undefined;
                    currency?: string | null | undefined;
                } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                protocol: z<"systemone" | "rerank" | "llm", "systemone" | "rerank" | "llm", "plain">;
                baseUrl: z<string, string, "plain">;
                model: z<string, string, "plain">;
                keyRef: z<string, string, "plain">;
                path: z<string, string, "plain">;
                rubricId: z<string, string, "plain">;
                tokenModel: z<"expanded" | "plain", "expanded" | "plain", "plain">;
                label: z<string, string, "plain">;
                limits: z<import("@deepseek-ai/cosmokit").Dict<number, string>, import("@deepseek-ai/cosmokit").Dict<number, string>, "plain">;
                calibration: z<Schemastery.ObjectS<NoInfer<{
                    version: z<string, string, "plain">;
                    points: z<number[][], number[][], "plain">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    version: z<string, string, "plain">;
                    points: z<number[][], number[][], "plain">;
                }>>, "plain">;
                extraBody: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "plain">;
                price: z<Schemastery.ObjectS<NoInfer<{
                    inputPerMTokens: z<number, number, "plain">;
                    outputPerMTokens: z<number, number, "plain">;
                    currency: z<string, string, "plain">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    inputPerMTokens: z<number, number, "plain">;
                    outputPerMTokens: z<number, number, "plain">;
                    currency: z<string, string, "plain">;
                }>>, "plain">;
            }>>, string>, "plain">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            provider: z<string, string, "plain">;
            mode: z<"control" | "shadow" | "hybrid" | "off", "control" | "shadow" | "hybrid" | "off", "plain">;
            allowLlm: z<boolean, boolean, "plain">;
            providers: z<import("@deepseek-ai/cosmokit").Dict<{
                protocol?: "systemone" | "rerank" | "llm" | null | undefined;
                baseUrl?: string | null | undefined;
                model?: string | null | undefined;
                keyRef?: string | null | undefined;
                path?: string | null | undefined;
                rubricId?: string | null | undefined;
                tokenModel?: "expanded" | "plain" | null | undefined;
                label?: string | null | undefined;
                limits?: import("@deepseek-ai/cosmokit").Dict<number, string> | null | undefined;
                calibration?: ({
                    version?: string | null | undefined;
                    points?: number[][] | null | undefined;
                } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
                extraBody?: import("@deepseek-ai/cosmokit").Dict<any, string> | null | undefined;
                price?: ({
                    inputPerMTokens?: number | null | undefined;
                    outputPerMTokens?: number | null | undefined;
                    currency?: string | null | undefined;
                } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                protocol: z<"systemone" | "rerank" | "llm", "systemone" | "rerank" | "llm", "plain">;
                baseUrl: z<string, string, "plain">;
                model: z<string, string, "plain">;
                keyRef: z<string, string, "plain">;
                path: z<string, string, "plain">;
                rubricId: z<string, string, "plain">;
                tokenModel: z<"expanded" | "plain", "expanded" | "plain", "plain">;
                label: z<string, string, "plain">;
                limits: z<import("@deepseek-ai/cosmokit").Dict<number, string>, import("@deepseek-ai/cosmokit").Dict<number, string>, "plain">;
                calibration: z<Schemastery.ObjectS<NoInfer<{
                    version: z<string, string, "plain">;
                    points: z<number[][], number[][], "plain">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    version: z<string, string, "plain">;
                    points: z<number[][], number[][], "plain">;
                }>>, "plain">;
                extraBody: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "plain">;
                price: z<Schemastery.ObjectS<NoInfer<{
                    inputPerMTokens: z<number, number, "plain">;
                    outputPerMTokens: z<number, number, "plain">;
                    currency: z<string, string, "plain">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    inputPerMTokens: z<number, number, "plain">;
                    outputPerMTokens: z<number, number, "plain">;
                    currency: z<string, string, "plain">;
                }>>, "plain">;
            }>>, string>, "plain">;
        }>>>, "volatile">;
        budget: z<NoInfer<Schemastery.ObjectS<NoInfer<{
            perSearchInputTokens: z<number, number, "plain">;
            dailyInputTokens: z<number, number, "plain">;
            timezone: z<string, string, "plain">;
            providers: z<import("@deepseek-ai/cosmokit").Dict<{
                perSearchInputTokens?: number | null | undefined;
                dailyInputTokens?: number | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                perSearchInputTokens: z<number, number, "plain">;
                dailyInputTokens: z<number, number, "plain">;
            }>>, string>, "plain">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            perSearchInputTokens: z<number, number, "plain">;
            dailyInputTokens: z<number, number, "plain">;
            timezone: z<string, string, "plain">;
            providers: z<import("@deepseek-ai/cosmokit").Dict<{
                perSearchInputTokens?: number | null | undefined;
                dailyInputTokens?: number | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                perSearchInputTokens: z<number, number, "plain">;
                dailyInputTokens: z<number, number, "plain">;
            }>>, string>, "plain">;
        }>>>, "volatile">;
    }>>, "plain">;
    verbose: z<boolean, boolean, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    dbPath: z<string, string, "volatile">;
    ttlSeconds: z<number, number, "volatile-defined">;
    memoryCacheEntries: z<number, number, "volatile-defined">;
    rrfConstant: z<number, number, "volatile-defined">;
    freshnessBoost: z<number, number, "volatile-defined">;
    freshnessDays: z<number, number, "volatile-defined">;
    authorityBoost: z<number, number, "volatile-defined">;
    authorityDomains: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    searchMaxResults: z<number, number, "volatile-defined">;
    fetchDefaultChars: z<number, number, "volatile-defined">;
    exaContentsPerUrlChars: z<number, number, "volatile-defined">;
    exaContentsTotalChars: z<number, number, "volatile-defined">;
    timeoutMs: z<number, number, "volatile-defined">;
    allowProxyFakeIp: z<boolean, boolean, "volatile-defined">;
    engines: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    parallelEngines: z<boolean, boolean, "volatile-defined">;
    exaApiKey: z<string, string, "volatile">;
    exaApiKeyEnv: z<string, string, "volatile-defined">;
    jinaApiKey: z<string, string, "volatile">;
    jinaApiKeyEnv: z<string, string, "volatile-defined">;
    bochaApiKey: z<string, string, "volatile">;
    bochaApiKeyEnv: z<string, string, "volatile-defined">;
    bochaBaseUrl: z<string, string, "volatile-defined">;
    bochaSummary: z<boolean, boolean, "volatile-defined">;
    searxngUrl: z<string, string, "volatile">;
    openalexMailto: z<string, string, "volatile">;
    githubToken: z<string, string, "volatile">;
    githubTokenEnv: z<string, string, "volatile-defined">;
    enableCliBackends: z<boolean, boolean, "volatile-defined">;
    opencliEnabled: z<boolean, boolean, "volatile-defined">;
    agentReachEnabled: z<boolean, boolean, "volatile-defined">;
    providerId: z<string, string, "volatile-defined">;
    registerProvider: z<boolean, boolean, "volatile-defined">;
    platformRules: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
        item?: string | null | undefined;
        title?: string | null | undefined;
        link?: string | null | undefined;
        text?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        item: z<string, string, "plain">;
        title: z<string, string, "plain">;
        link: z<string, string, "plain">;
        text: z<string, string, "plain">;
    }>>, string>>, "volatile">;
    customPlatforms: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
        name?: string | null | undefined;
        url?: string | null | undefined;
        item?: string | null | undefined;
        title?: string | null | undefined;
        link?: string | null | undefined;
        text?: string | null | undefined;
        cookie?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        name: z<string, string, "plain">;
        url: z<string, string, "plain">;
        item: z<string, string, "plain">;
        title: z<string, string, "plain">;
        link: z<string, string, "plain">;
        text: z<string, string, "plain">;
        cookie: z<string, string, "plain">;
    }>>, string>>, "volatile">;
    browserBindings: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
        authProfile?: string | null | undefined;
        rulePack?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        authProfile: z<string, string, "plain">;
        rulePack: z<string, string, "plain">;
    }>>, string>>, "volatile">;
    playwright: z<Schemastery.ObjectS<NoInfer<{
        enabled: z<boolean, boolean, "volatile-defined">;
        snapshotDir: z<string, string, "plain">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: z<boolean, boolean, "volatile-defined">;
        snapshotDir: z<string, string, "plain">;
    }>>, "plain">;
    evidence: z<Schemastery.ObjectS<NoInfer<{
        scorer: z<"jev" | "rule", "jev" | "rule", "volatile-defined">;
        jevMode: z<"control" | "shadow" | "hybrid" | "off", "control" | "shadow" | "hybrid" | "off", "volatile-defined">;
        hybridBorderline: z<boolean, boolean, "volatile-defined">;
        maxJevQuestions: z<number, number, "volatile-defined">;
        autoProviders: z<boolean, boolean, "volatile-defined">;
        maxRounds: z<number, number, "volatile-defined">;
        maxQueries: z<number, number, "volatile-defined">;
        rubrics: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
            version?: string | null | undefined;
            instructions?: string | null | undefined;
            criteria?: string[] | null | undefined;
            maxStateChars?: number | null | undefined;
            maxCandidateChars?: number | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            version: z<string, string, "plain">;
            instructions: z<string, string, "plain">;
            criteria: z<string[], string[], "plain">;
            maxStateChars: z<number, number, "plain">;
            maxCandidateChars: z<number, number, "plain">;
        }>>, string>>, "volatile">;
        judge: z<NoInfer<Schemastery.ObjectS<NoInfer<{
            provider: z<string, string, "plain">;
            mode: z<"control" | "shadow" | "hybrid" | "off", "control" | "shadow" | "hybrid" | "off", "plain">;
            allowLlm: z<boolean, boolean, "plain">;
            providers: z<import("@deepseek-ai/cosmokit").Dict<{
                protocol?: "systemone" | "rerank" | "llm" | null | undefined;
                baseUrl?: string | null | undefined;
                model?: string | null | undefined;
                keyRef?: string | null | undefined;
                path?: string | null | undefined;
                rubricId?: string | null | undefined;
                tokenModel?: "expanded" | "plain" | null | undefined;
                label?: string | null | undefined;
                limits?: import("@deepseek-ai/cosmokit").Dict<number, string> | null | undefined;
                calibration?: ({
                    version?: string | null | undefined;
                    points?: number[][] | null | undefined;
                } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
                extraBody?: import("@deepseek-ai/cosmokit").Dict<any, string> | null | undefined;
                price?: ({
                    inputPerMTokens?: number | null | undefined;
                    outputPerMTokens?: number | null | undefined;
                    currency?: string | null | undefined;
                } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                protocol: z<"systemone" | "rerank" | "llm", "systemone" | "rerank" | "llm", "plain">;
                baseUrl: z<string, string, "plain">;
                model: z<string, string, "plain">;
                keyRef: z<string, string, "plain">;
                path: z<string, string, "plain">;
                rubricId: z<string, string, "plain">;
                tokenModel: z<"expanded" | "plain", "expanded" | "plain", "plain">;
                label: z<string, string, "plain">;
                limits: z<import("@deepseek-ai/cosmokit").Dict<number, string>, import("@deepseek-ai/cosmokit").Dict<number, string>, "plain">;
                calibration: z<Schemastery.ObjectS<NoInfer<{
                    version: z<string, string, "plain">;
                    points: z<number[][], number[][], "plain">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    version: z<string, string, "plain">;
                    points: z<number[][], number[][], "plain">;
                }>>, "plain">;
                extraBody: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "plain">;
                price: z<Schemastery.ObjectS<NoInfer<{
                    inputPerMTokens: z<number, number, "plain">;
                    outputPerMTokens: z<number, number, "plain">;
                    currency: z<string, string, "plain">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    inputPerMTokens: z<number, number, "plain">;
                    outputPerMTokens: z<number, number, "plain">;
                    currency: z<string, string, "plain">;
                }>>, "plain">;
            }>>, string>, "plain">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            provider: z<string, string, "plain">;
            mode: z<"control" | "shadow" | "hybrid" | "off", "control" | "shadow" | "hybrid" | "off", "plain">;
            allowLlm: z<boolean, boolean, "plain">;
            providers: z<import("@deepseek-ai/cosmokit").Dict<{
                protocol?: "systemone" | "rerank" | "llm" | null | undefined;
                baseUrl?: string | null | undefined;
                model?: string | null | undefined;
                keyRef?: string | null | undefined;
                path?: string | null | undefined;
                rubricId?: string | null | undefined;
                tokenModel?: "expanded" | "plain" | null | undefined;
                label?: string | null | undefined;
                limits?: import("@deepseek-ai/cosmokit").Dict<number, string> | null | undefined;
                calibration?: ({
                    version?: string | null | undefined;
                    points?: number[][] | null | undefined;
                } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
                extraBody?: import("@deepseek-ai/cosmokit").Dict<any, string> | null | undefined;
                price?: ({
                    inputPerMTokens?: number | null | undefined;
                    outputPerMTokens?: number | null | undefined;
                    currency?: string | null | undefined;
                } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                protocol: z<"systemone" | "rerank" | "llm", "systemone" | "rerank" | "llm", "plain">;
                baseUrl: z<string, string, "plain">;
                model: z<string, string, "plain">;
                keyRef: z<string, string, "plain">;
                path: z<string, string, "plain">;
                rubricId: z<string, string, "plain">;
                tokenModel: z<"expanded" | "plain", "expanded" | "plain", "plain">;
                label: z<string, string, "plain">;
                limits: z<import("@deepseek-ai/cosmokit").Dict<number, string>, import("@deepseek-ai/cosmokit").Dict<number, string>, "plain">;
                calibration: z<Schemastery.ObjectS<NoInfer<{
                    version: z<string, string, "plain">;
                    points: z<number[][], number[][], "plain">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    version: z<string, string, "plain">;
                    points: z<number[][], number[][], "plain">;
                }>>, "plain">;
                extraBody: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "plain">;
                price: z<Schemastery.ObjectS<NoInfer<{
                    inputPerMTokens: z<number, number, "plain">;
                    outputPerMTokens: z<number, number, "plain">;
                    currency: z<string, string, "plain">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    inputPerMTokens: z<number, number, "plain">;
                    outputPerMTokens: z<number, number, "plain">;
                    currency: z<string, string, "plain">;
                }>>, "plain">;
            }>>, string>, "plain">;
        }>>>, "volatile">;
        budget: z<NoInfer<Schemastery.ObjectS<NoInfer<{
            perSearchInputTokens: z<number, number, "plain">;
            dailyInputTokens: z<number, number, "plain">;
            timezone: z<string, string, "plain">;
            providers: z<import("@deepseek-ai/cosmokit").Dict<{
                perSearchInputTokens?: number | null | undefined;
                dailyInputTokens?: number | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                perSearchInputTokens: z<number, number, "plain">;
                dailyInputTokens: z<number, number, "plain">;
            }>>, string>, "plain">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            perSearchInputTokens: z<number, number, "plain">;
            dailyInputTokens: z<number, number, "plain">;
            timezone: z<string, string, "plain">;
            providers: z<import("@deepseek-ai/cosmokit").Dict<{
                perSearchInputTokens?: number | null | undefined;
                dailyInputTokens?: number | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                perSearchInputTokens: z<number, number, "plain">;
                dailyInputTokens: z<number, number, "plain">;
            }>>, string>, "plain">;
        }>>>, "volatile">;
    }>>, Schemastery.ObjectT<NoInfer<{
        scorer: z<"jev" | "rule", "jev" | "rule", "volatile-defined">;
        jevMode: z<"control" | "shadow" | "hybrid" | "off", "control" | "shadow" | "hybrid" | "off", "volatile-defined">;
        hybridBorderline: z<boolean, boolean, "volatile-defined">;
        maxJevQuestions: z<number, number, "volatile-defined">;
        autoProviders: z<boolean, boolean, "volatile-defined">;
        maxRounds: z<number, number, "volatile-defined">;
        maxQueries: z<number, number, "volatile-defined">;
        rubrics: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
            version?: string | null | undefined;
            instructions?: string | null | undefined;
            criteria?: string[] | null | undefined;
            maxStateChars?: number | null | undefined;
            maxCandidateChars?: number | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            version: z<string, string, "plain">;
            instructions: z<string, string, "plain">;
            criteria: z<string[], string[], "plain">;
            maxStateChars: z<number, number, "plain">;
            maxCandidateChars: z<number, number, "plain">;
        }>>, string>>, "volatile">;
        judge: z<NoInfer<Schemastery.ObjectS<NoInfer<{
            provider: z<string, string, "plain">;
            mode: z<"control" | "shadow" | "hybrid" | "off", "control" | "shadow" | "hybrid" | "off", "plain">;
            allowLlm: z<boolean, boolean, "plain">;
            providers: z<import("@deepseek-ai/cosmokit").Dict<{
                protocol?: "systemone" | "rerank" | "llm" | null | undefined;
                baseUrl?: string | null | undefined;
                model?: string | null | undefined;
                keyRef?: string | null | undefined;
                path?: string | null | undefined;
                rubricId?: string | null | undefined;
                tokenModel?: "expanded" | "plain" | null | undefined;
                label?: string | null | undefined;
                limits?: import("@deepseek-ai/cosmokit").Dict<number, string> | null | undefined;
                calibration?: ({
                    version?: string | null | undefined;
                    points?: number[][] | null | undefined;
                } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
                extraBody?: import("@deepseek-ai/cosmokit").Dict<any, string> | null | undefined;
                price?: ({
                    inputPerMTokens?: number | null | undefined;
                    outputPerMTokens?: number | null | undefined;
                    currency?: string | null | undefined;
                } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                protocol: z<"systemone" | "rerank" | "llm", "systemone" | "rerank" | "llm", "plain">;
                baseUrl: z<string, string, "plain">;
                model: z<string, string, "plain">;
                keyRef: z<string, string, "plain">;
                path: z<string, string, "plain">;
                rubricId: z<string, string, "plain">;
                tokenModel: z<"expanded" | "plain", "expanded" | "plain", "plain">;
                label: z<string, string, "plain">;
                limits: z<import("@deepseek-ai/cosmokit").Dict<number, string>, import("@deepseek-ai/cosmokit").Dict<number, string>, "plain">;
                calibration: z<Schemastery.ObjectS<NoInfer<{
                    version: z<string, string, "plain">;
                    points: z<number[][], number[][], "plain">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    version: z<string, string, "plain">;
                    points: z<number[][], number[][], "plain">;
                }>>, "plain">;
                extraBody: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "plain">;
                price: z<Schemastery.ObjectS<NoInfer<{
                    inputPerMTokens: z<number, number, "plain">;
                    outputPerMTokens: z<number, number, "plain">;
                    currency: z<string, string, "plain">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    inputPerMTokens: z<number, number, "plain">;
                    outputPerMTokens: z<number, number, "plain">;
                    currency: z<string, string, "plain">;
                }>>, "plain">;
            }>>, string>, "plain">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            provider: z<string, string, "plain">;
            mode: z<"control" | "shadow" | "hybrid" | "off", "control" | "shadow" | "hybrid" | "off", "plain">;
            allowLlm: z<boolean, boolean, "plain">;
            providers: z<import("@deepseek-ai/cosmokit").Dict<{
                protocol?: "systemone" | "rerank" | "llm" | null | undefined;
                baseUrl?: string | null | undefined;
                model?: string | null | undefined;
                keyRef?: string | null | undefined;
                path?: string | null | undefined;
                rubricId?: string | null | undefined;
                tokenModel?: "expanded" | "plain" | null | undefined;
                label?: string | null | undefined;
                limits?: import("@deepseek-ai/cosmokit").Dict<number, string> | null | undefined;
                calibration?: ({
                    version?: string | null | undefined;
                    points?: number[][] | null | undefined;
                } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
                extraBody?: import("@deepseek-ai/cosmokit").Dict<any, string> | null | undefined;
                price?: ({
                    inputPerMTokens?: number | null | undefined;
                    outputPerMTokens?: number | null | undefined;
                    currency?: string | null | undefined;
                } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                protocol: z<"systemone" | "rerank" | "llm", "systemone" | "rerank" | "llm", "plain">;
                baseUrl: z<string, string, "plain">;
                model: z<string, string, "plain">;
                keyRef: z<string, string, "plain">;
                path: z<string, string, "plain">;
                rubricId: z<string, string, "plain">;
                tokenModel: z<"expanded" | "plain", "expanded" | "plain", "plain">;
                label: z<string, string, "plain">;
                limits: z<import("@deepseek-ai/cosmokit").Dict<number, string>, import("@deepseek-ai/cosmokit").Dict<number, string>, "plain">;
                calibration: z<Schemastery.ObjectS<NoInfer<{
                    version: z<string, string, "plain">;
                    points: z<number[][], number[][], "plain">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    version: z<string, string, "plain">;
                    points: z<number[][], number[][], "plain">;
                }>>, "plain">;
                extraBody: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "plain">;
                price: z<Schemastery.ObjectS<NoInfer<{
                    inputPerMTokens: z<number, number, "plain">;
                    outputPerMTokens: z<number, number, "plain">;
                    currency: z<string, string, "plain">;
                }>>, Schemastery.ObjectT<NoInfer<{
                    inputPerMTokens: z<number, number, "plain">;
                    outputPerMTokens: z<number, number, "plain">;
                    currency: z<string, string, "plain">;
                }>>, "plain">;
            }>>, string>, "plain">;
        }>>>, "volatile">;
        budget: z<NoInfer<Schemastery.ObjectS<NoInfer<{
            perSearchInputTokens: z<number, number, "plain">;
            dailyInputTokens: z<number, number, "plain">;
            timezone: z<string, string, "plain">;
            providers: z<import("@deepseek-ai/cosmokit").Dict<{
                perSearchInputTokens?: number | null | undefined;
                dailyInputTokens?: number | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                perSearchInputTokens: z<number, number, "plain">;
                dailyInputTokens: z<number, number, "plain">;
            }>>, string>, "plain">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            perSearchInputTokens: z<number, number, "plain">;
            dailyInputTokens: z<number, number, "plain">;
            timezone: z<string, string, "plain">;
            providers: z<import("@deepseek-ai/cosmokit").Dict<{
                perSearchInputTokens?: number | null | undefined;
                dailyInputTokens?: number | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
                perSearchInputTokens: z<number, number, "plain">;
                dailyInputTokens: z<number, number, "plain">;
            }>>, string>, "plain">;
        }>>>, "volatile">;
    }>>, "plain">;
    verbose: z<boolean, boolean, "volatile-defined">;
}>>, "plain">;
export interface ResolvedConfig extends Config {
    dbPath: string;
    exaApiKey?: string;
    exaApiKeyEnv: string;
    jinaApiKey?: string;
    jinaApiKeyEnv: string;
    githubTokenEnv: string;
    bochaApiKey?: string;
    bochaApiKeyEnv: string;
    bochaBaseUrl: string;
    bochaSummary: boolean;
    searxngUrl?: string;
    openalexMailto?: string;
    playwright: Required<Pick<Config['playwright'], 'enabled' | 'snapshotDir'>>;
    evidence: EvidenceConfig;
}
/** Default database path under the harness home. */
export declare function defaultDbPath(): string;
/** Resolve a fully-defaulted config from user input. Unwraps volatile fields (schemastery `Volatile<T>`) into plain values so consumers never see the wrapper. */
export declare function resolveConfig(config: Config): ResolvedConfig;
