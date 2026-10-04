/**
 * Versioned judge rubrics (dev-plan §4.4, design §7): the wording, the ordered
 * levels and the length caps of the questions the plugin puts to Jev, as data.
 *
 * Built-in rubrics reproduce the wording the offline evaluation was calibrated
 * with (bench/rubrics/*.v1.json; a bench test pins the two together). A user can
 * override one in `evidence.rubrics` (settings.yaml) without a code change:
 *
 *   evidence:
 *     rubrics:
 *       score.support: { version: v2, instructions: "...{need}...{candidate}" }
 *
 * An override must carry its own `version`; the rubric's id, version and a hash
 * of its full content go into every Jev result record and into the judge cache
 * keys, so a changed prompt never reuses an old answer. An override that fails
 * validation is ignored (the built-in is used) and the reason is reported.
 * Online models never rewrite rubrics: they only change through the settings.
 * @module web-search-pro/pipeline/rubrics
 */
import crypto from 'node:crypto';
import { BUILTIN_RUBRIC_IDS, RUBRIC_LIMITS, RUBRIC_VARIABLES, builtinDef, overrideProblems, rubricProblems, variablesOf, } from "./rubrics-spec.js";
export { BUILTIN_RUBRIC_IDS, RUBRIC_LIMITS, RUBRIC_VARIABLES, overrideProblems, rubricProblems, variablesOf };
export const refOf = (r) => ({ id: r.id, version: r.version, overridden: r.overridden, hash: r.hash, key: r.key });
/** Fill the variables in ONE pass (inserted text is never rescanned); variables not in `vars` stay open. */
export function renderTemplate(template, vars) {
    return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (whole, name) => (Object.hasOwn(vars, name) ? vars[name] : whole));
}
function hashOf(def) {
    const material = JSON.stringify([def.id, def.version, def.kind, def.lang, def.instructions, def.state ?? null, def.criteria ?? null, def.options ?? null, def.maxStateChars, def.maxCandidateChars]);
    return crypto.createHash('sha256').update(material).digest('hex').slice(0, 12);
}
function seal(def, builtinHash) {
    const hash = hashOf(def);
    return { ...def, overridden: builtinHash !== undefined && hash !== builtinHash, hash, key: def.id + '@' + def.version + '#' + hash };
}
const builtinOf = builtinDef;
/** The built-in rubric as shipped. */
export function builtinRubric(id) {
    const def = builtinOf(id);
    if (!def)
        throw new Error('unknown rubric ' + id);
    return seal(def, hashOf(def));
}
/** Build a rubric from a built-in plus new content; throws nothing, returns the problems instead. */
export function buildRubric(id, fields) {
    const base = builtinOf(id);
    if (!base)
        return { problems: ['unknown rubric id "' + id + '" (known: ' + BUILTIN_RUBRIC_IDS.join(', ') + ')'] };
    const problems = rubricProblems(base, fields);
    if (problems.length)
        return { problems };
    const def = {
        ...base,
        version: fields.version,
        ...fields.instructions !== undefined ? { instructions: fields.instructions } : {},
        ...fields.criteria !== undefined ? { criteria: [...fields.criteria] } : {},
        ...fields.maxStateChars !== undefined ? { maxStateChars: fields.maxStateChars } : {},
        ...fields.maxCandidateChars !== undefined ? { maxCandidateChars: fields.maxCandidateChars } : {},
    };
    const builtinHash = hashOf(base);
    const sealed = seal(def, builtinHash);
    // Changed content under the shipped version label would look like the old rubric in logs: demand a new label.
    if (sealed.overridden && fields.version === base.version)
        return { problems: ['changed content needs a new version (not "' + base.version + '")'] };
    return { rubric: sealed };
}
/** The active rubric for `id`: the valid override from `overrides`, else the built-in. */
export function resolveRubric(id, overrides) {
    const raw = overrides?.[id];
    if (raw === undefined || raw === null)
        return { rubric: builtinRubric(id), diagnostics: [] };
    if (typeof raw !== 'object' || Array.isArray(raw))
        return { rubric: builtinRubric(id), diagnostics: [id + ': override ignored: not an object'] };
    const base = builtinOf(id);
    // One rule set with the settings panel (rubrics-spec.ts); the sealed build below is the hashing, not a second validation.
    const problems = overrideProblems(id, raw);
    if (!problems.length) {
        const built = buildRubric(id, raw);
        if (built.rubric)
            return { rubric: built.rubric, diagnostics: [] };
        problems.push(...built.problems);
    }
    return { rubric: builtinRubric(id), diagnostics: problems.map(p => id + ': override ignored, built-in ' + base.version + ' used: ' + p) };
}
/** Every built-in rubric resolved against the overrides, plus override ids that name no rubric. */
export function resolveAllRubrics(overrides) {
    const rubrics = [];
    const diagnostics = [];
    for (const id of BUILTIN_RUBRIC_IDS) {
        const r = resolveRubric(id, overrides);
        rubrics.push(r.rubric);
        diagnostics.push(...r.diagnostics);
    }
    for (const id of Object.keys(overrides ?? {}))
        if (!BUILTIN_RUBRIC_IDS.includes(id))
            diagnostics.push(id + ': override ignored: unknown rubric id (known: ' + BUILTIN_RUBRIC_IDS.join(', ') + ')');
    return { rubrics, diagnostics };
}
//# sourceMappingURL=rubrics.js.map