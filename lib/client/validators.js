/**
 * Validation behind the settings card. Every rule that has a server counterpart is the server's own function
 * (providers-spec, rubrics-spec, coverage, budget-spec): the card calls it, it does not restate it. Pure and free of
 * Node imports, so it ships in the client bundle.
 * @module web-search-pro/client/validators
 */
import { resolveBudget } from "../pipeline/budget-spec.js";
import { resolveSources } from "../pipeline/sources-spec.js";
import { CALIBRATED_THRESHOLDS, thresholdKey, thresholdsProblems } from "../pipeline/coverage.js";
import { DEFAULT_PROVIDER_ID, PRESETS, resolveProviders, unusableReason } from "../pipeline/judges/providers-spec.js";
import { BUILTIN_RUBRIC_IDS, builtinDef, overrideProblems } from "../pipeline/rubrics-spec.js";
import { platformBackendIssues } from "../cli/chains-spec.js";
import { resolveCliAdapters } from "../cli/spec.js";
import { getAt, isRecord, rubricField } from "./form-specs.js";
/** Key names that mean "a secret lives here": a provider definition carries a `keyRef` name, never the key. */
const SECRET_KEY = /(^|[^a-z])(api[-_]?key|apikey|token|secret|password|passwd|authorization|bearer)([^a-z]|$)/i;
function secretPaths(value, trail, out) {
    if (Array.isArray(value)) {
        value.forEach((item, index) => { secretPaths(item, trail + '[' + index + ']', out); });
        return;
    }
    if (!isRecord(value))
        return;
    for (const [key, entry] of Object.entries(value)) {
        const here = trail ? trail + '.' + key : key;
        if (key !== 'keyRef' && SECRET_KEY.test(key))
            out.push(here);
        else
            secretPaths(entry, here, out);
    }
}
/**
 * `evidence.judge.providers`: the server's own `resolveProviders` over the draft, plus a refusal to carry secrets in a
 * definition (the card never shows or stores a key value: `keyRef` names the environment variable / credentials entry).
 */
export function customProviders(providers) {
    if (providers === undefined)
        return { problems: [], ids: [] };
    if (!isRecord(providers))
        return { problems: ['evidence.judge.providers must be an object keyed by provider id'], ids: [] };
    const { providers: catalog, diagnostics } = resolveProviders({ providers });
    const problems = [...diagnostics];
    const secret = new Set();
    for (const [id, entry] of Object.entries(providers)) {
        const found = [];
        secretPaths(entry, '', found);
        for (const where of found)
            problems.push('evidence.judge.providers.' + id + '.' + where + ' looks like a secret: keep the key in the environment or DSH credentials and name it with keyRef');
        if (found.length)
            secret.add(id);
    }
    // The server's diagnostics read `evidence.judge.providers.<id> ignored...`: an entry named there is not usable.
    const ignored = (id) => diagnostics.some(message => message.startsWith('evidence.judge.providers.' + id + ' ignored'));
    return { problems, ids: Object.keys(providers).filter(id => catalog.has(id) && !secret.has(id) && !ignored(id)) };
}
/** Ids the judge provider selects can name: the presets and the valid custom entries. */
export function providerChoices(providers) {
    return [...new Set([...Object.keys(PRESETS), ...customProviders(providers).ids])];
}
/** The version a new override of a rubric starts with: the built-in label counted up (`v1` -> `v2`). */
export function nextVersion(version) {
    const match = /^(.*?)(\d+)$/.exec(version);
    return match ? match[1] + String(Number(match[2]) + 1) : version + '2';
}
/**
 * Problems of one rubric override entry: the server's `overrideProblems`, plus the card's stricter rule that the version
 * label must differ from the built-in one (an override on the shipped label is indistinguishable from the default in logs).
 */
export function rubricEntryProblems(id, entry) {
    const problems = overrideProblems(id, entry);
    const base = builtinDef(id);
    if (base && isRecord(entry) && entry.version === base.version && !problems.some(p => p.startsWith('changed content')))
        problems.push('version must differ from the built-in "' + base.version + '"');
    return problems;
}
/** The rubric entries of an evidence object that carry any problem, by rubric id. */
export function rubricIssues(rubrics) {
    const out = {};
    if (!isRecord(rubrics))
        return out;
    for (const [id, entry] of Object.entries(rubrics)) {
        const problems = rubricEntryProblems(id, entry);
        if (problems.length)
            out[id] = problems;
    }
    return out;
}
/**
 * Everything wrong or doubtful in an effective `evidence` object, per control. Errors are values the server would
 * ignore; warnings are accepted values that cannot do what the mode asks (a placeholder provider, no thresholds).
 */
export function evidenceIssues(ev) {
    const issues = [];
    const add = (field, message, level = 'error', related) => { issues.push({ field, message, level, ...related ? { related } : {} }); };
    const judge = isRecord(ev.judge) ? ev.judge : {};
    const custom = customProviders(judge.providers);
    if (custom.problems.length)
        add('evidence.judge.providers', custom.problems.join('\n'));
    const settings = { ...typeof judge.provider === 'string' ? { provider: judge.provider } : {}, allowLlm: judge.allowLlm === true, ...isRecord(judge.providers) ? { providers: judge.providers } : {} };
    const catalog = resolveProviders(settings).providers;
    const selected = typeof judge.provider === 'string' && judge.provider ? judge.provider : DEFAULT_PROVIDER_ID;
    const mode = typeof getAt(ev, ['judge', 'mode']) === 'string' ? getAt(ev, ['judge', 'mode']) : ev.jevMode;
    if (typeof judge.provider === 'string' && judge.provider && !catalog.has(judge.provider))
        add('evidence.judge.provider', 'provider "' + judge.provider + '" is not defined (known: ' + [...catalog.keys()].join(', ') + ')', 'error', ['evidence.judge.providers']);
    else if (mode !== undefined && mode !== 'off') {
        const why = unusableReason(catalog.get(selected), settings);
        if (why)
            add('evidence.judge.provider', why, 'warning');
    }
    const coverage = isRecord(ev.coverage) ? ev.coverage : {};
    const thresholds = coverage.thresholds;
    if (thresholds !== undefined) {
        const problems = thresholdsProblems(thresholds);
        const both = ['evidence.coverage.thresholds.weak', 'evidence.coverage.thresholds.covered'];
        for (const problem of problems) {
            // Each message names the threshold it is about; the relation between the two (weak above covered) belongs to both.
            const fields = problem.includes('exceed') ? both : [problem.includes('thresholds.weak') ? both[0] : both[1]];
            for (const field of fields)
                add(field, problem, 'error', both);
        }
    }
    if (coverage.mode === 'shadow' || coverage.mode === 'control') {
        const providerId = typeof coverage.provider === 'string' && coverage.provider ? coverage.provider : selected;
        const provider = catalog.get(providerId);
        if (typeof coverage.provider === 'string' && coverage.provider && !provider)
            add('evidence.coverage.provider', 'provider "' + coverage.provider + '" is not defined (known: ' + [...catalog.keys()].join(', ') + ')', 'error', ['evidence.judge.providers']);
        else if (provider && provider.protocol !== 'systemone')
            add('evidence.coverage.provider', 'the coverage judge needs a provider speaking the systemone protocol; ' + providerId + ' speaks ' + provider.protocol, 'warning');
        if (thresholds === undefined) {
            const rubric = isRecord(ev.rubrics) && isRecord(ev.rubrics['cover.sufficient']) && rubricEntryProblems('cover.sufficient', ev.rubrics['cover.sufficient']).length === 0
                ? String(ev.rubrics['cover.sufficient'].version)
                : builtinDef('cover.sufficient').version;
            const key = thresholdKey(providerId, { id: 'cover.sufficient', version: rubric });
            if (!CALIBRATED_THRESHOLDS[key])
                add('evidence.coverage.thresholds.weak', 'no calibrated thresholds for ' + key + ': set both thresholds (fitted on your own labels) or the judge stays off', 'warning');
        }
    }
    if (ev.budget !== undefined) {
        const diagnostics = resolveBudget(isRecord(ev.budget) ? ev.budget : {}).diagnostics;
        for (const message of diagnostics) {
            const field = message.includes('.timezone') ? 'evidence.budget.timezone'
                : message.includes('.providers') ? 'evidence.budget.providers'
                    : message.includes('dailyInputTokens') ? 'evidence.budget.dailyInputTokens' : 'evidence.budget.perSearchInputTokens';
            add(field, message);
        }
    }
    for (const [id, problems] of Object.entries(rubricIssues(ev.rubrics)))
        add(rubricField(id), problems.join('\n'));
    return issues;
}
/**
 * Problems of the effective `sources` object (priority / disabled / budget), from the server's own `resolveSources`. A source that is
 * both prioritised and disabled is accepted (disabled wins) but is probably not what was meant.
 */
export function sourcesIssues(sources) {
    const issues = [];
    for (const message of resolveSources(sources).diagnostics) {
        if (message.includes('both prioritised and disabled')) {
            for (const field of ['sources.priority', 'sources.disabled'])
                issues.push({ field, message, level: 'warning', related: ['sources.priority', 'sources.disabled'] });
            continue;
        }
        const budget = /^sources\.budget\.([^.\s]+)\.(total|daily)\b/.exec(message);
        const field = budget ? `sources.budget.${budget[1]}.${budget[2]}` : message.includes('sources.disabled') ? 'sources.disabled' : 'sources.priority';
        issues.push({ field, message, level: 'error' });
    }
    return issues;
}
/** Rubric override ids in a settings object that name no built-in rubric (the server ignores them). */
export function unknownRubricIds(rubrics) {
    return isRecord(rubrics) ? Object.keys(rubrics).filter(id => !BUILTIN_RUBRIC_IDS.includes(id)) : [];
}
/**
 * Problems of the CLI adapter settings, from the server's own functions: `cliAdapters` entries the server would ignore
 * (read-only guard, bad argv, secrets in env) and `platformBackends` that name an unknown platform or a backend that
 * cannot serve it.
 */
export function cliIssues(platformBackends, cliAdapters) {
    const issues = [];
    for (const message of resolveCliAdapters(cliAdapters).diagnostics)
        issues.push({ field: 'cliAdapters', message, level: 'error' });
    for (const message of platformBackendIssues(platformBackends, cliAdapters))
        issues.push({ field: 'platformBackends', message, level: 'error', related: ['cliAdapters'] });
    return issues;
}
//# sourceMappingURL=validators.js.map