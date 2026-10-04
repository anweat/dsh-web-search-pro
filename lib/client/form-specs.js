/**
 * Field specs of the settings card: how each control converts between the stored value and the draft text, and where
 * the value lives in the plugin config.
 *
 * The Host writes TOP-LEVEL config fields, so a nested option (`evidence.maxRounds`, `keyedSources.tavily.baseUrl`) is
 * a "path field": a view of one entry inside the staged object of its root (`evidence`, `provider`, `keyedSources`).
 * The controller applies the path ops of every staged field of a root to the raw user layer of that root and writes the
 * root once, so siblings the card knows nothing about (a literal `apiKey`, an unknown key) are carried through.
 *
 * Pure: no Host, no DOM, no Node, and only shared pure modules, so the client bundle stays free of server code.
 * @module web-search-pro/client/form-specs
 */
import { JUDGE_MODES, PROVIDER_EVIDENCE_MODES, SOURCE_POLICIES, TOOL_SURFACES } from "../config-enums.js";
import { COVERAGE_MODES } from "../pipeline/coverage.js";
import { DEFAULT_BUDGET } from "../pipeline/budget-spec.js";
import { KEY_REF_PATTERN } from "../pipeline/judges/providers-spec.js";
import { KEYED_SOURCE_ENVS, KEYED_SOURCE_IDS } from "../providers/keyed-meta.js";
export const isPathSpec = (spec) => 'root' in spec;
// ── value helpers ───────────────────────────────────────────────────────────
export const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export function getAt(root, path) {
    let node = root;
    for (const key of path) {
        if (!isRecord(node))
            return undefined;
        node = node[key];
    }
    return node;
}
export function hasAt(root, path) {
    let node = root;
    for (const key of path) {
        if (!isRecord(node) || !Object.hasOwn(node, key))
            return false;
        node = node[key];
    }
    return true;
}
/** Apply ops to `root` in place; an `unset` also removes the parents it leaves empty. */
export function applyOps(root, ops) {
    for (const op of ops) {
        if (op.op === 'set') {
            let node = root;
            for (const key of op.path.slice(0, -1)) {
                const next = node[key];
                node = isRecord(next) ? next : (node[key] = {});
            }
            node[op.path[op.path.length - 1]] = structuredClone(op.value);
            continue;
        }
        const trail = [root];
        let node = root;
        for (const key of op.path.slice(0, -1)) {
            node = isRecord(node) ? node[key] : undefined;
            if (!isRecord(node))
                break;
            trail.push(node);
        }
        if (trail.length !== op.path.length)
            continue;
        delete trail[trail.length - 1][op.path[op.path.length - 1]];
        for (let depth = trail.length - 1; depth > 0; depth--) {
            if (Object.keys(trail[depth]).length === 0)
                delete trail[depth - 1][op.path[depth - 1]];
        }
    }
}
/** Recursive merge, `over` winning; arrays and scalars are replaced (how a user layer sits on its base). */
export function deepMerge(base, over) {
    if (!isRecord(base) || !isRecord(over))
        return over === undefined ? base : over;
    const out = { ...base };
    for (const [key, value] of Object.entries(over))
        out[key] = key in base ? deepMerge(base[key], value) : value;
    return out;
}
const isHttpUrl = (text) => {
    try {
        const url = new URL(text);
        return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password && !url.hash;
    }
    catch {
        return false;
    }
};
const textField = (field, options = {}) => ({
    field,
    format: value => typeof value === 'string' ? value : '',
    parse(text) {
        const value = text.trim();
        if (value.length === 0)
            return options.required ? undefined : { kind: 'clear' };
        if (options.pattern && !options.pattern.test(value))
            return undefined;
        if (options.url && !isHttpUrl(value))
            return undefined;
        if (options.email && !/^[^\s@]+@[^\s@]+$/.test(value))
            return undefined;
        return { kind: 'set', value };
    },
});
const numberField = (field, options = {}) => ({
    field,
    format: value => typeof value === 'number' && Number.isFinite(value) ? String(value) : '',
    parse(text) {
        if (text.trim() === '')
            return { kind: 'clear' };
        const value = Number(text);
        if (!Number.isFinite(value))
            return undefined;
        if (options.integer && !Number.isInteger(value))
            return undefined;
        if (options.min !== undefined && value < options.min)
            return undefined;
        if (options.max !== undefined && value > options.max)
            return undefined;
        return { kind: 'set', value };
    },
});
const booleanField = (field, fallback = false) => ({
    field,
    format: value => (value === undefined ? fallback : value === true) ? 'true' : 'false',
    parse: text => text === 'true' || text === 'false'
        ? { kind: 'set', value: text === 'true' }
        : undefined,
});
/** A closed list of values; with `allowEmpty` the empty draft clears the field (the default applies). */
const enumField = (field, values, fallback, allowEmpty = false) => ({
    field,
    format: value => typeof value === 'string' ? value : fallback ?? '',
    parse(text) {
        if (text === '')
            return allowEmpty ? { kind: 'clear' } : undefined;
        return values.includes(text) ? { kind: 'set', value: text } : undefined;
    },
});
const csvField = (field, required = false) => ({
    field,
    format: value => Array.isArray(value) ? value.filter(item => typeof item === 'string').join(', ') : '',
    parse(text) {
        const values = [...new Set(text.split(',').map(item => item.trim()).filter(Boolean))];
        if (values.length === 0 && required)
            return undefined;
        return { kind: 'set', value: values };
    },
});
const jsonField = (field, required = false) => ({
    field,
    format: value => isRecord(value) ? JSON.stringify(value, null, 2) : '',
    parse(text) {
        if (text.trim() === '')
            return required ? undefined : { kind: 'clear' };
        try {
            const value = JSON.parse(text);
            return isRecord(value) ? { kind: 'set', value } : undefined;
        }
        catch {
            return undefined;
        }
    },
});
const path = (spec, root, at, extra = {}) => ({ ...spec, root, path: at, ...extra });
// ── defaults the card shows when the Host section carries none (pinned to config.ts by a test) ──
export const DEFAULTS = {
    evidence: { autoProviders: true, sourcePolicy: 'default', maxRounds: 2, maxQueries: 4, hybridBorderline: false, maxJevQuestions: 64, scorer: 'rule', jevMode: 'off' },
    judge: { allowLlm: false },
    coverage: { mode: 'off' },
    provider: { evidence: 'auto', deadlineMs: 25_000 },
    budget: { ...DEFAULT_BUDGET },
    toolSurface: 'indexed',
    bochaApiKeyEnv: 'BOCHA_SEARCH_API_KEY',
    bochaBaseUrl: 'https://api.bocha.cn',
    bochaSummary: true,
};
// ── the specs ───────────────────────────────────────────────────────────────
/** Top-level fields, in display order. */
export const FIELD_SPECS = [
    csvField('engines', true),
    booleanField('parallelEngines'),
    numberField('searchMaxResults', { min: 1, max: 20, integer: true }),
    numberField('timeoutMs', { min: 1_000, integer: true }),
    numberField('fetchDefaultChars', { min: 1_000, max: 500_000, integer: true }),
    numberField('exaContentsPerUrlChars', { min: 500, integer: true }),
    numberField('exaContentsTotalChars', { min: 1_000, integer: true }),
    textField('exaApiKeyEnv', { required: true }),
    textField('jinaApiKeyEnv', { required: true }),
    textField('githubTokenEnv', { required: true }),
    textField('bochaApiKeyEnv', { pattern: KEY_REF_PATTERN }),
    textField('bochaBaseUrl', { url: true }),
    booleanField('bochaSummary', true),
    textField('searxngUrl', { url: true }),
    textField('openalexMailto', { email: true }),
    booleanField('enableCliBackends'),
    booleanField('opencliEnabled'),
    booleanField('agentReachEnabled'),
    textField('providerId', { required: true }),
    booleanField('registerProvider'),
    enumField('toolSurface', TOOL_SURFACES, DEFAULTS.toolSurface),
    jsonField('playwright', true),
    numberField('ttlSeconds', { min: 0, integer: true }),
    numberField('memoryCacheEntries', { min: 1, integer: true }),
    numberField('rrfConstant', { min: 1 }),
    numberField('freshnessBoost', { min: 0, max: 1 }),
    numberField('freshnessDays', { min: 1 }),
    numberField('authorityBoost', { min: 0, max: 1 }),
    csvField('authorityDomains'),
    textField('dbPath'),
    booleanField('allowProxyFakeIp'),
    jsonField('platformRules'),
    jsonField('customPlatforms'),
    jsonField('browserBindings'),
    booleanField('verbose'),
];
/** The effective judge mode: the neutral `judge.mode` wins over the legacy `jevMode`. */
const judgeModeOf = (ev) => {
    const mode = getAt(ev, ['judge', 'mode']) ?? ev.jevMode;
    return typeof mode === 'string' ? mode : DEFAULTS.evidence.jevMode;
};
/**
 * Editing the mode keeps the legacy pair in step, so a settings file read by an older plugin version or by a person means
 * the same thing: `judge.mode` and `jevMode` both get the mode, and `scorer` is `jev` exactly for `control` (the legacy
 * control needs it; any other mode ignores it, so a stale `jev` is put back to `rule`). Clearing reverts all three.
 */
const modeOps = (write, ctx) => {
    if (write.kind === 'clear')
        return [{ op: 'unset', path: ['judge', 'mode'] }, { op: 'unset', path: ['jevMode'] }, { op: 'unset', path: ['scorer'] }];
    const mode = write.value;
    const ops = [{ op: 'set', path: ['judge', 'mode'], value: mode }, { op: 'set', path: ['jevMode'], value: mode }];
    if (mode === 'control')
        ops.push({ op: 'set', path: ['scorer'], value: 'jev' });
    else if (ctx.resolved.scorer === 'jev')
        ops.push({ op: 'set', path: ['scorer'], value: 'rule' });
    return ops;
};
const E = 'evidence';
/** Fields inside `evidence` and `provider`, in display order. */
export const PATH_SPECS = [
    path(booleanField('evidence.autoProviders', DEFAULTS.evidence.autoProviders), E, ['autoProviders']),
    path(enumField('evidence.sourcePolicy', SOURCE_POLICIES, DEFAULTS.evidence.sourcePolicy), E, ['sourcePolicy']),
    path(numberField('evidence.maxRounds', { min: 1, integer: true }), E, ['maxRounds'], { read: ev => ev.maxRounds ?? DEFAULTS.evidence.maxRounds }),
    path(numberField('evidence.maxQueries', { min: 1, integer: true }), E, ['maxQueries'], { read: ev => ev.maxQueries ?? DEFAULTS.evidence.maxQueries }),
    path(enumField('evidence.judge.mode', JUDGE_MODES, DEFAULTS.evidence.jevMode), E, ['judge', 'mode'], {
        read: judgeModeOf,
        ops: modeOps,
        stored: user => hasAt(user, ['judge', 'mode']) || hasAt(user, ['jevMode']),
    }),
    path(booleanField('evidence.hybridBorderline', DEFAULTS.evidence.hybridBorderline), E, ['hybridBorderline']),
    path(textField('evidence.judge.provider'), E, ['judge', 'provider']),
    path(numberField('evidence.maxJevQuestions', { min: 1, integer: true }), E, ['maxJevQuestions'], { read: ev => ev.maxJevQuestions ?? DEFAULTS.evidence.maxJevQuestions }),
    path(booleanField('evidence.judge.allowLlm', DEFAULTS.judge.allowLlm), E, ['judge', 'allowLlm']),
    path(jsonField('evidence.judge.providers'), E, ['judge', 'providers']),
    path(enumField('evidence.coverage.mode', COVERAGE_MODES, DEFAULTS.coverage.mode), E, ['coverage', 'mode']),
    path(textField('evidence.coverage.provider'), E, ['coverage', 'provider']),
    path(numberField('evidence.coverage.thresholds.weak', { min: 0, max: 1 }), E, ['coverage', 'thresholds', 'weak']),
    path(numberField('evidence.coverage.thresholds.covered', { min: 0, max: 1 }), E, ['coverage', 'thresholds', 'covered']),
    path(numberField('evidence.budget.perSearchInputTokens', { min: 0, integer: true }), E, ['budget', 'perSearchInputTokens'], { read: ev => getAt(ev, ['budget', 'perSearchInputTokens']) ?? DEFAULTS.budget.perSearchInputTokens }),
    path(numberField('evidence.budget.dailyInputTokens', { min: 0, integer: true }), E, ['budget', 'dailyInputTokens'], { read: ev => getAt(ev, ['budget', 'dailyInputTokens']) ?? DEFAULTS.budget.dailyInputTokens }),
    path(textField('evidence.budget.timezone'), E, ['budget', 'timezone']),
    path(jsonField('evidence.budget.providers'), E, ['budget', 'providers']),
    path(enumField('provider.evidence', PROVIDER_EVIDENCE_MODES, DEFAULTS.provider.evidence), 'provider', ['evidence']),
    path(numberField('provider.deadlineMs', { min: 100, integer: true }), 'provider', ['deadlineMs'], { read: p => getAt(p, ['deadlineMs']) ?? DEFAULTS.provider.deadlineMs }),
    path(csvField('sources.priority'), 'sources', ['priority']),
    path(csvField('sources.disabled'), 'sources', ['disabled']),
];
/** The keyed sources the card has controls for: route id and the environment variable its key is read from by default. */
export const KEYED_SOURCES = KEYED_SOURCE_IDS.map(id => ({ id, defaultEnv: KEYED_SOURCE_ENVS[id][0] }));
export const KEYED_SPECS = KEYED_SOURCES.flatMap(({ id }) => [
    path(textField(`keyedSources.${id}.apiKeyEnv`, { pattern: KEY_REF_PATTERN }), 'keyedSources', [id, 'apiKeyEnv']),
    path(textField(`keyedSources.${id}.baseUrl`, { url: true }), 'keyedSources', [id, 'baseUrl']),
]);
/** The sources the card has a request budget for: Bocha and the keyed sources (any registered id works in settings.yaml). */
export const BUDGETED_SOURCES = ['bocha', ...KEYED_SOURCE_IDS];
export const BUDGET_SPECS = BUDGETED_SOURCES.flatMap(id => ['total', 'daily'].map(axis => path(numberField(`sources.budget.${id}.${axis}`, { min: 0, integer: true }), 'sources', ['budget', id, axis])));
/** The spec of a rubric override entry: the whole object as one JSON draft, which the rubric editor builds field by field. */
export const rubricSpec = (id) => path(jsonField(`evidence.rubrics.${id}`), E, ['rubrics', id]);
export const rubricField = (id) => `evidence.rubrics.${id}`;
/** Fields that a Host write can never take as text (credentials go through the credentials remote). */
export const CREDENTIAL_IDS = ['exa', 'jina', 'github', 'bocha', ...KEYED_SOURCE_IDS.map(id => `keyed:${id}`)];
/** The settings field holding the credentials ref / environment variable name of each credential, and its default name. */
export function credentialRef(id) {
    switch (id) {
        case 'exa': return { field: 'exaApiKeyEnv', default: 'EXA_API_KEY' };
        case 'jina': return { field: 'jinaApiKeyEnv', default: 'JINA_API_KEY' };
        case 'github': return { field: 'githubTokenEnv', default: 'GITHUB_TOKEN' };
        case 'bocha': return { field: 'bochaApiKeyEnv', default: DEFAULTS.bochaApiKeyEnv };
        default: {
            const source = id.slice('keyed:'.length);
            return { field: `keyedSources.${source}.apiKeyEnv`, default: KEYED_SOURCE_ENVS[source][0] };
        }
    }
}
//# sourceMappingURL=form-specs.js.map