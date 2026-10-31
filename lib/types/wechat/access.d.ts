/**
 * Access profiles: what a backend asks of the user and what it risks, stated once so `sources.status` can show it per chain leg
 * and the notices can refer to it. The plugin never logs anyone in: `login` says what the backend itself needs ('none' = nothing,
 * 'browser-session' = the user's own browser login, 'cli-login' = a CLI the user logged in, 'qr-scan' = a QR scan in the user's own
 * service, 'api-key' = a paid / keyed API). Pure, no imports.
 * @module web-search-pro/wechat/access
 */
export type AccessLogin = 'none' | 'browser-session' | 'cli-login' | 'qr-scan' | 'api-key';
export type AccessRisk = 'low' | 'medium' | 'high';
export interface AccessProfile {
    login: AccessLogin;
    /** How long the login lasts (`约 4 天`), when it expires. */
    loginTtl?: string;
    risk: AccessRisk;
    /** What can go wrong: anti-bot measures, account bans, copyright. */
    riskNotes: readonly string[];
    /** What it costs (`元宝搜索 14-20 元/千次`), when it is billed. */
    billing?: string;
}
/** Profiles by `<platform>:<backend id>`; `wechat:history` is the user's own wechat-download-api service (not a chain leg: the wechat.* actions use it). */
export declare const ACCESS_PROFILES: Readonly<Record<string, AccessProfile>>;
/** The access profile of a backend as a leg of a platform chain, when it has one. */
export declare function accessProfileOf(platform: string, backend: string): AccessProfile | undefined;
/** One line for `sources.status`: login, risk, billing, and the first reasons. */
export declare function renderAccess(profile: AccessProfile): string;
/** Output schema node of an access profile (closed). */
export declare const ACCESS_SCHEMA: {
    type: "object";
    additionalProperties: boolean;
    properties: {
        login: {
            type: "string";
            required: true;
        };
        loginTtl: {
            type: "string";
        };
        risk: {
            type: "string";
            required: true;
        };
        riskNotes: {
            type: "array";
            required: true;
            items: {
                type: "string";
            };
        };
        billing: {
            type: "string";
        };
    };
};
