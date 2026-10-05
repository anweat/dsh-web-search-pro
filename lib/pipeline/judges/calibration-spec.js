/**
 * Validation of a provider calibration, with no Node imports so the settings panel validates it too.
 * @module web-search-pro/pipeline/judges/calibration-spec
 */
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
//# sourceMappingURL=calibration-spec.js.map