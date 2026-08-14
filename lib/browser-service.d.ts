/**
 * Consumer-side contract for the `browser` service provided by the dsh-browser
 * plugin. web-search-pro injects it (inject: ['browser']) and calls these
 * methods instead of its former local PlaywrightManager / global opencli.
 * @module web-search-pro/browser-service
 */
export interface RenderRule {
    hostname: string;
    contentSelectors: string[];
    removeSelectors?: string[];
}
export interface BrowserRenderResult {
    title: string;
    text: string;
    html: string;
    usedRule?: string;
}
export interface BrowserSnapshotResult {
    title: string;
    text: string;
    screenshotPath: string;
    htmlPath: string;
    usedRule?: string;
}
export interface BrowserSearchItem {
    url: string;
    title: string;
    snippet?: string;
}
export interface BrowserCliResult {
    code: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
}
export interface BrowserService {
    render(url: string, rules: readonly RenderRule[], opts?: {
        signal?: AbortSignal;
        maxChars?: number;
        waitMs?: number;
    }): Promise<BrowserRenderResult>;
    snapshot(url: string, rules: readonly RenderRule[], opts: {
        signal?: AbortSignal;
        outDir: string;
        maxChars?: number;
    }): Promise<BrowserSnapshotResult>;
    searchResults(url: string, spec: {
        item: string;
        title: string;
        link: string;
        text?: string;
    }, opts?: {
        signal?: AbortSignal;
        count?: number;
        waitMs?: number;
        cookies?: {
            name: string;
            value: string;
            domain: string;
            path: string;
        }[];
    }): Promise<BrowserSearchItem[]>;
    opencli(args: string[], opts?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<BrowserCliResult>;
    close(): Promise<void>;
}
