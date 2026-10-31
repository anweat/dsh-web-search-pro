/**
 * Notices: short messages the agent must pass on to the USER (a rate limit, a link that expires, copyright), as opposed to `notes`
 * (diagnostics for the model). A notice is `{ level, code, message }`: `info` is worth a sentence, `warn` changes what the user can
 * expect, `action` needs the user to do something (re-scan a QR code, configure a key). Codes are English and stable; messages are
 * Chinese because the people reading them are.
 *
 * Notices travel next to the data: an engine returns them on its outcome (or on the error it throws, see {@link attachNotices}),
 * a service passes them up, and the action layer runs them through the plugin instance's {@link NoticeBoard}, which implements
 * the `wechat.notices` mode (`once` by default: each code is shown once per plugin instance). Pure, no imports: phase B (the
 * `wechat.*` actions and the tencent-wsa / history legs) adds its codes to {@link NOTICE_TABLE} and nothing else changes.
 * @module web-search-pro/wechat/notices
 */
export type NoticeLevel = 'info' | 'warn' | 'action';
export interface Notice {
    level: NoticeLevel;
    code: string;
    message: string;
}
/** `once`: each code once per plugin instance (a `warn` / `action` again when its message differs, i.e. a new failure). `always`: every time. `off`: never. */
export type NoticeMode = 'once' | 'always' | 'off';
export declare const NOTICE_MODES: readonly NoticeMode[];
/**
 * The known notices. Phase B adds `wechat.paid`, `wechat.login-expired` (action), `wechat.account-risk` and `wechat.rate-limited`
 * (see docs/dev/wechat-design.md section 1) here; `notice(code)` builds one with its default level and text.
 */
export declare const NOTICE_TABLE: {
    readonly 'wechat.antispider': {
        readonly level: "warn";
        readonly message: "搜狗微信搜索触发了反爬验证，这次没有拿到完整结果。请降低搜索频率、换一个出口 IP 或稍后再试；公众号搜索的稳定性取决于搜狗，不是关键词的问题。";
    };
    readonly 'wechat.signed-url': {
        readonly level: "info";
        readonly message: "公众号搜索结果里的链接带有签名，几分钟到几小时后会失效。要读正文请尽快用 read.fetch 读取；过期后需要重新搜索，不要把这类链接当作永久地址保存或转发。";
    };
    readonly 'wechat.bare-url': {
        readonly level: "info";
        readonly message: "这个公众号链接没有签名（裸链接），服务器直接抓取通常只能得到验证页或空壳页，读不到正文。请改用 search.run platform=wechat 搜索结果里的签名链接，或让用户在微信里复制文章的分享链接。";
    };
    readonly 'wechat.copyright': {
        readonly level: "info";
        readonly message: "公众号文章的版权归原作者所有，正文仅限个人研究与摘要引用；转述时请注明公众号名称和原文标题，不要大段转载。";
    };
};
export type KnownNoticeCode = keyof typeof NOTICE_TABLE;
/** A notice with the default level and text of its code; `message` replaces the text when the caller knows more (a count, a reason). */
export declare function notice(code: KnownNoticeCode, message?: string): Notice;
/** Notices without duplicates (same code and text), the ones that need the user first. */
export declare function uniqueNotices(list: readonly Notice[] | undefined): Notice[];
/** Normalise the setting `wechat.notices`; anything unknown is the default. */
export declare function noticeModeOf(value: unknown): NoticeMode;
/**
 * The per-instance memory behind the `wechat.notices` mode. `take` returns what is to be shown now (undefined when nothing):
 * `once` remembers codes (a `warn` / `action` is remembered by code AND text, so a different failure is shown again), `always`
 * shows everything, `off` nothing. `reset(code)` forgets a code (e.g. after the user fixed it) so it can be shown again.
 */
export declare class NoticeBoard {
    private readonly mode;
    private readonly shown;
    constructor(mode?: () => NoticeMode);
    take(raw: readonly Notice[] | undefined): Notice[] | undefined;
    reset(code?: string): void;
}
/** Optional dedupe hook of the services: the board when there is one, else the notices as they are (still without duplicates). */
export declare function takeNotices(board: Pick<NoticeBoard, 'take'> | undefined, raw: readonly Notice[] | undefined): Notice[] | undefined;
/** Hang notices on an error so they survive the trip up (a chain leg that failed, a pipeline that found nothing). Returns the same error. */
export declare function attachNotices<E>(error: E, notices: readonly Notice[] | undefined): E;
/** The notices hung on an error by {@link attachNotices} (or the `notices` of an `EngineError`). */
export declare function noticesOf(error: unknown): Notice[];
export declare function isNotice(value: unknown): value is Notice;
/**
 * The block the text output ends with: "提醒用户 / Tell the user:" and one line per notice. `action` lines say so up front; the
 * header tells the model to pass them on in its answer rather than keep them to itself.
 */
export declare function renderNotices(notices: readonly Notice[] | undefined): string;
/** Output schema node of a `notices` field (closed, like every output schema of the actions). */
export declare const NOTICES_SCHEMA: {
    type: "array";
    items: {
        type: "object";
        additionalProperties: boolean;
        properties: {
            level: {
                type: "string";
                required: true;
            };
            code: {
                type: "string";
                required: true;
            };
            message: {
                type: "string";
                required: true;
            };
        };
    };
};
