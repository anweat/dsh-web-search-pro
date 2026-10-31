/**
 * What the WeChat layers did last, kept in memory for `wechat.status`: per layer id (`sogou`, `tencent-wsa`, `history`, `album`, ...)
 * the time of the last success and the last failure with its text. Process-wide like the Sogou throttle, never persisted, and the
 * text is cut short: it is a pointer to "why did it stop", not a log.
 * @module web-search-pro/wechat/health
 */
const layers = new Map();
const MAX_MESSAGE = 240;
function entry(id) {
    let e = layers.get(id);
    if (!e) {
        e = {};
        layers.set(id, e);
    }
    return e;
}
export function noteLayerOk(id, at = new Date()) {
    const e = entry(id);
    e.lastOk = at.toISOString();
}
export function noteLayerFailure(id, error, at = new Date()) {
    const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE);
    entry(id).lastFailure = { at: at.toISOString(), message };
}
export function layerHealth(id) {
    const e = layers.get(id);
    return e ? { ...e.lastOk ? { lastOk: e.lastOk } : {}, ...e.lastFailure ? { lastFailure: { ...e.lastFailure } } : {} } : {};
}
/** Forget everything (tests). */
export function resetLayerHealth() { layers.clear(); }
//# sourceMappingURL=health.js.map