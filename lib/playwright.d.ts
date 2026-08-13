/**
 * Playwright integration (MediaCrawler-style): headless browser rendering
 * with optional persistent login state (storageState), used as the last-resort
 * fetch backend and for page snapshots. The browser is launched lazily and
 * reused within the plugin lifetime; the plugin disposes it on unload.
 *
 * The page-side extractor is a raw JS string (not a closure): tsx/esbuild
 * injects a __name helper into compiled closures, which does not exist in the
 * page context. Strings pass through unevaluated.
 * @module web-search-pro/playwright
 */
import type { ExtractRule } from './extract.ts';
export interface PlaywrightConfig {
    enabled: boolean;
    headless: boolean;
    /** 'chromium' (bundled) or 'msedge' (system Edge). */
    channel: string;
    /** Path to a Playwright storageState JSON (persisted login, like MediaCrawler). */
    storageStatePath?: string;
    /** Explicit module path override. */
    modulePath?: string;
}
export interface RenderResult {
    title: string;
    text: string;
    html: string;
    usedRule: string | undefined;
}
export declare class PlaywrightManager {
    private readonly config;
    private browser;
    private launching;
    constructor(config: PlaywrightConfig);
    private ensure;
    close(): Promise<void>;
    /** Render one page: goto, settle, extract via rules in the page itself. */
    render(url: string, rules: readonly ExtractRule[], opts?: {
        signal: AbortSignal | undefined;
        maxChars?: number;
        waitMs?: number;
    }): Promise<RenderResult>;
    /** Render + save a screenshot and HTML snapshot to disk (web_snapshot tool). */
    snapshot(url: string, rules: readonly ExtractRule[], opts: {
        signal: AbortSignal | undefined;
        outDir: string;
        maxChars?: number;
    }): Promise<{
        title: string;
        text: string;
        screenshotPath: string;
        htmlPath: string;
        usedRule: string | undefined;
    }>;
}
