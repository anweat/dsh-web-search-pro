/**
 * Read-only description of the judge layer for `web_backend_status`: which provider is
 * configured and whether it is usable, plus today's model usage against the caps.
 * Makes no network request and never shows a credential.
 * @module web-search-pro/pipeline/judge-status
 */
import type { EvidenceConfig } from '../config.ts';
import type { Store } from '../store.ts';
export interface JudgeStatus {
    provider: {
        id: string;
        protocol?: string;
        model?: string;
        usable: boolean;
        reason?: string;
        unverified?: boolean;
        calibration?: string;
        keyConfigured?: boolean;
    };
    /** Ids of every defined provider (presets and custom). */
    providers: string[];
    /** Absent when the store cannot be read. */
    usage?: {
        day: string;
        timezone?: string;
        requests: number;
        inputTokens: number;
        outputTokens: number;
        /** Some of today's token figures are estimates. */
        estimated: boolean;
        /** Every call of the day has a price (the provider declares one); false = money spent is unknown, not zero. */
        amountKnown: boolean;
        amount?: number;
        currency?: string;
        caps: {
            perSearchInputTokens: number;
            dailyInputTokens: number;
        };
        byProvider: {
            provider: string;
            requests: number;
            inputTokens: number;
            outputTokens: number;
            estimated: boolean;
        }[];
    };
    diagnostics: string[];
}
export declare function judgeStatus(cfg: EvidenceConfig, store: Store, options?: {
    now?: (() => number) | undefined;
    hasSecret?: ((ref: string) => Promise<boolean>) | undefined;
}): Promise<JudgeStatus>;
