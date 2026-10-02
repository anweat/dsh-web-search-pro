/**
 * Per-provider calibration of raw scores onto grades 0..3 (design §7: scores of
 * different models are never mixed without calibration).
 * @module web-search-pro/pipeline/judges/calibration
 */
import crypto from 'node:crypto';
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
/** Problems of a calibration definition; empty = valid. */
export function calibrationProblems(c) {
    if (c === null || typeof c !== 'object' || Array.isArray(c))
        return ['calibration must be an object { version, points }'];
    const out = [];
    const { version, points } = c;
    if (typeof version !== 'string' || !VERSION.test(version))
        out.push('calibration.version must be a label like "v1" (letters, digits, . _ -, at most 32 characters)');
    if (!Array.isArray(points) || points.length < 2 || points.length > 32) {
        out.push('calibration.points needs 2-32 [raw, grade] pairs');
        return out;
    }
    let prev;
    points.forEach((p, i) => {
        if (!Array.isArray(p) || p.length !== 2 || !p.every(n => typeof n === 'number' && Number.isFinite(n))) {
            out.push('calibration.points[' + i + '] must be [raw, grade] with finite numbers');
            return;
        }
        const [x, g] = p;
        if (g < 0 || g > 3)
            out.push('calibration.points[' + i + '] grade must be within 0..3');
        if (prev) {
            if (x <= prev[0])
                out.push('calibration.points[' + i + '] raw value must be greater than the previous one');
            if (g < prev[1])
                out.push('calibration.points[' + i + '] grade must not decrease');
        }
        prev = [x, g];
    });
    return out;
}
/** Raw score -> grade 0..3 (linear between points, constant outside). Assumes a valid calibration. */
export function applyCalibration(c, raw) {
    const pts = c.points;
    if (!Number.isFinite(raw))
        return 0;
    if (raw <= pts[0][0])
        return pts[0][1];
    const last = pts[pts.length - 1];
    if (raw >= last[0])
        return last[1];
    for (let i = 1; i < pts.length; i++) {
        const [x1, g1] = pts[i];
        if (raw <= x1) {
            const [x0, g0] = pts[i - 1];
            return g0 + ((raw - x0) / (x1 - x0)) * (g1 - g0);
        }
    }
    return last[1];
}
/** `version#hash`: what results and cache keys record (a changed point changes the hash). */
export function calibrationKey(c) {
    return c.version + '#' + crypto.createHash('sha256').update(JSON.stringify(c.points)).digest('hex').slice(0, 8);
}
//# sourceMappingURL=calibration.js.map