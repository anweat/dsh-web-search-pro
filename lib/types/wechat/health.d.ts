/**
 * What the WeChat layers did last, kept in memory for `wechat.status`: per layer id (`sogou`, `tencent-wsa`, `history`, `album`, ...)
 * the time of the last success and the last failure with its text. Process-wide like the Sogou throttle, never persisted, and the
 * text is cut short: it is a pointer to "why did it stop", not a log.
 * @module web-search-pro/wechat/health
 */
export interface LayerHealth {
    /** ISO time of the last success. */
    lastOk?: string;
    lastFailure?: {
        at: string;
        message: string;
    };
}
export declare function noteLayerOk(id: string, at?: Date): void;
export declare function noteLayerFailure(id: string, error: unknown, at?: Date): void;
export declare function layerHealth(id: string): LayerHealth;
/** Forget everything (tests). */
export declare function resetLayerHealth(): void;
