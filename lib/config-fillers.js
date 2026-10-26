/**
 * Removal of the empty containers the Host's schema parser fills in (see the comment on `withoutFillers`). Pure and free of
 * imports: the server's config resolution and the settings card's validation (client bundle) use the same functions.
 * @module web-search-pro/config-fillers
 */
/**
 * The Host parses the plugin config with the schema above, and schemastery fills every optional nested container it was not
 * given with an empty one (`calibration: { points: [] }`, `price: {}`, `limits: {}`, `criteria: []`, `thresholds: {}`).
 * The validators of the judge settings (providers, rubric overrides, coverage thresholds) read "present" as "given", so
 * those fillers would reject every custom provider / rubric override and report empty thresholds as invalid. They are
 * removed here, on exactly the keys the schema fills, and nowhere inside user data (`extraBody` is passed through as is).
 */
const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isEmptyContainer = (value) => Array.isArray(value) ? value.length === 0 : isPlain(value) && Object.keys(value).length === 0;
export function withoutFillers(value, keys) {
    if (!isPlain(value))
        return value;
    const out = { ...value };
    for (const key of keys)
        if (key in out && isEmptyContainer(out[key]))
            delete out[key];
    return out;
}
export function normalizeJudge(judge) {
    const base = withoutFillers(judge, ['providers']);
    if (!isPlain(base) || !isPlain(base.providers))
        return base;
    const providers = {};
    for (const [id, entry] of Object.entries(base.providers)) {
        let next = withoutFillers(entry, ['limits', 'extraBody', 'price', 'calibration']);
        // `calibration: { points: [] }` is the schema's filler; a calibration the user wrote has at least a version or points.
        if (isPlain(next) && isPlain(next.calibration)) {
            const calibration = withoutFillers(next.calibration, ['points']);
            const rest = { ...next };
            if (Object.keys(calibration).length > 0)
                rest.calibration = calibration;
            else
                delete rest.calibration;
            next = rest;
        }
        providers[id] = next;
    }
    return { ...base, providers };
}
export function normalizeRubrics(rubrics) {
    if (!isPlain(rubrics))
        return rubrics;
    return Object.fromEntries(Object.entries(rubrics).map(([id, entry]) => [id, withoutFillers(entry, ['criteria'])]));
}
export function normalizeCoverage(coverage) {
    return withoutFillers(coverage, ['thresholds']);
}
//# sourceMappingURL=config-fillers.js.map