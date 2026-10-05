/**
 * Conservative input-token estimates: used to reserve usage before a call and,
 * flagged `estimated`, when a service reports no usage. They err high.
 * @module web-search-pro/pipeline/judges/tokens
 */
export const HAN = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/g;
/**
 * Conservative estimate of the EXPANDED input tokens Jev bills for a `score`
 * question's text. Jev expands each question once per level (4 for score), so
 * the cost is about four times the plain token count: a regression over the
 * 122 r1 requests gave 3.8 per Han character, 0.97 per other character and
 * 706 per question. The constants here (5 / 1.3 / 950) sit above the fit and
 * above the worst r1 request (nf-07, 33,331 counted tokens against an estimate
 * of 38,052), so an estimate within budget never meets the 32,768 limit. A
 * generic "chars / 1.5" would be far too low for CJK-heavy text.
 */
export function estimateJevTokens(text) {
    const han = text.match(HAN)?.length ?? 0;
    return Math.ceil(han * 5 + (text.length - han) * 1.3);
}
/** Fixed expanded-token overhead of one `score` question (the level descriptions; r1 fit: 706). */
export const JEV_QUESTION_OVERHEAD_TOKENS = 950;
/** Plain (unexpanded) token estimate: 1.6 per Han character, 0.35 per other character (English runs about 0.25). */
export function estimatePlainTokens(text) {
    const han = text.match(HAN)?.length ?? 0;
    return Math.ceil(han * 1.6 + (text.length - han) * 0.35);
}
export const cut = (text, max) => (text.length <= max ? text : text.slice(0, Math.max(max - 1, 1)) + '…');
/** Trim, collapse whitespace, cut. */
export const squash = (text, max) => cut(text.trim().replace(/\s+/g, ' '), max);
//# sourceMappingURL=tokens.js.map