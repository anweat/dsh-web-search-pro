/**
 * Provider registry of the judge layer: built-in presets, user-defined providers
 * (`evidence.judge.providers`), validation and the factory that turns a provider
 * into a Scorer. A provider is `{ id, protocol, baseUrl, model, keyRef, limits,
 * calibration?, rubricId? }`; supporting another decision / rerank model means adding
 * an entry here (or in settings), not code, as long as it speaks a known protocol.
 * @module web-search-pro/pipeline/judges/providers
 */
import { BUILTIN_RUBRIC_IDS, builtinRubric } from "../rubrics.js";
import { calibrationProblems } from "./calibration.js";
import { LLM_PATH, LlmScorer } from "./protocols/llm.js";
import { RERANK_PATH, RerankScorer } from "./protocols/rerank.js";
import { SYSTEMONE_PATH, SystemOneScorer } from "./protocols/systemone.js";
import { PROTOCOLS } from "./types.js";
/** Credentials ref / environment variable holding the Bocha Jev key. */
export const JEV_KEY_REF = 'BOCHA_JEV_API_KEY';
export const JEV_BASE_URL = 'https://jev.bocha.cn';
export const JEV_MODEL = 'bocha-jev-v1';
export const JEV_URL = JEV_BASE_URL + SYSTEMONE_PATH;
export const DEFAULT_PROVIDER_ID = 'bocha-jev';
const DEFAULT_PATH = { systemone: SYSTEMONE_PATH, rerank: RERANK_PATH, llm: LLM_PATH };
/** Built-in presets. Only `bocha-jev` is exercised by the plugin's own experiments; the others are unverified starting points. */
export const PRESETS = {
    'bocha-jev': {
        id: 'bocha-jev', protocol: 'systemone', baseUrl: JEV_BASE_URL, model: JEV_MODEL, keyRef: JEV_KEY_REF,
        label: 'Jev', recordedId: 'jev',
        notes: 'Hosted Bocha Jev (the default when a model scorer is switched on).',
    },
    'typesafe-jev': {
        id: 'typesafe-jev', protocol: 'systemone', baseUrl: 'https://typesafe-jev.invalid', model: 'typesafe-jev-v1', keyRef: 'TYPESAFE_JEV_API_KEY',
        label: 'TypeSafe Jev', unverified: true, placeholders: ['baseUrl', 'model'],
        notes: 'Placeholder: another hosted Jev deployment. Set baseUrl and model (evidence.judge.providers.typesafe-jev) before use; never called by the plugin authors.',
    },
    'laya-local': {
        id: 'laya-local', protocol: 'systemone', baseUrl: 'http://127.0.0.1:8765', model: 'multilingual',
        label: 'Laya', tokenModel: 'plain', extraBody: { max_len: 1024 }, limits: { blockChars: 700 },
        notes: 'Local Laya sidecar (experiments/laya, Jev-compatible). Experiment r1 found it near random with the current prompts: it needs a calibration fitted on your own labels (calibration.points) before it is trusted for control.',
    },
    'jina-rerank': {
        id: 'jina-rerank', protocol: 'rerank', baseUrl: 'https://api.jina.ai/v1', model: 'jina-reranker-v2-base-multilingual', keyRef: 'JINA_API_KEY',
        label: 'Jina rerank', extraBody: { return_documents: false }, unverified: true,
        notes: 'Jina-style rerank API; never called by the plugin authors. Needs calibration.points: relevance scores are not grades.',
    },
    'cohere-rerank': {
        id: 'cohere-rerank', protocol: 'rerank', baseUrl: 'https://api.cohere.com/v2', model: 'rerank-v3.5', keyRef: 'COHERE_API_KEY',
        label: 'Cohere rerank', unverified: true,
        notes: 'Cohere-style rerank API; never called by the plugin authors. Needs calibration.points: relevance scores are not grades.',
    },
};
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,47}$/;
/** Scorer ids the pipeline gives meaning to. */
const RESERVED_IDS = ['rule', 'hybrid', 'none'];
const KEY_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$/;
const LIMIT_KEYS = ['maxQuestionsPerRequest', 'requestTokenBudget', 'blockChars', 'maxNeedChars', 'maxStateChars', 'maxBodyBytes', 'maxDocumentsPerRequest', 'maxRetries', 'timeoutMs', 'requestCap'];
const FIELDS = ['protocol', 'baseUrl', 'model', 'keyRef', 'path', 'limits', 'calibration', 'rubricId', 'extraBody', 'price', 'tokenModel', 'label'];
const RESERVED_BODY_KEYS = ['model', 'state', 'questions', 'query', 'documents', 'messages'];
const isLoopback = (host) => host === 'localhost' || host.endsWith('.localhost') || /^127\./.test(host) || host === '[::1]';
/** Problems of a complete provider definition; empty = usable. */
export function providerProblems(p) {
    const out = [];
    if (typeof p.protocol !== 'string' || !PROTOCOLS.includes(p.protocol))
        out.push('protocol must be one of ' + PROTOCOLS.join(', '));
    if (typeof p.model !== 'string' || !p.model.trim())
        out.push('model must be a non-empty string');
    if (typeof p.baseUrl !== 'string')
        out.push('baseUrl must be a URL string');
    else {
        let url;
        try {
            url = new URL(p.baseUrl);
        }
        catch {
            out.push('baseUrl "' + p.baseUrl + '" is not a URL');
        }
        if (url) {
            if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname)))
                out.push('baseUrl must be https (http is only allowed for localhost: the API key would travel in clear text)');
            if (url.username || url.password)
                out.push('baseUrl must not carry credentials: use keyRef');
            if (url.search || url.hash)
                out.push('baseUrl must not carry a query or fragment');
        }
    }
    if (p.keyRef !== undefined && (typeof p.keyRef !== 'string' || !KEY_REF_PATTERN.test(p.keyRef)))
        out.push('keyRef must be a credentials ref / environment variable name (not the key itself)');
    if (p.path !== undefined && (typeof p.path !== 'string' || !/^\/[A-Za-z0-9._~\/-]*$/.test(p.path)))
        out.push('path must look like /v1/endpoint');
    if (p.tokenModel !== undefined && p.tokenModel !== 'expanded' && p.tokenModel !== 'plain')
        out.push('tokenModel must be expanded or plain');
    if (p.label !== undefined && (typeof p.label !== 'string' || !p.label.trim() || p.label.length > 40))
        out.push('label must be a short string');
    if (p.rubricId !== undefined) {
        if (typeof p.rubricId !== 'string' || !BUILTIN_RUBRIC_IDS.includes(p.rubricId))
            out.push('rubricId must be a known rubric (' + BUILTIN_RUBRIC_IDS.join(', ') + ')');
        else if (builtinRubric(p.rubricId).kind !== 'score')
            out.push('rubricId ' + p.rubricId + ' is not a score rubric');
        else if (p.protocol === 'rerank')
            out.push('rubricId does not apply to the rerank protocol (the need text is the query)');
    }
    if (p.limits !== undefined) {
        if (p.limits === null || typeof p.limits !== 'object' || Array.isArray(p.limits))
            out.push('limits must be an object');
        else
            for (const [k, v] of Object.entries(p.limits)) {
                if (!LIMIT_KEYS.includes(k))
                    out.push('unknown limit "' + k + '" (known: ' + LIMIT_KEYS.join(', ') + ')');
                else if (typeof v !== 'number' || !Number.isInteger(v) || v < 1)
                    out.push('limits.' + k + ' must be a positive integer');
            }
    }
    if (p.calibration !== undefined)
        out.push(...calibrationProblems(p.calibration));
    if (p.extraBody !== undefined) {
        if (p.extraBody === null || typeof p.extraBody !== 'object' || Array.isArray(p.extraBody))
            out.push('extraBody must be an object');
        else
            for (const k of Object.keys(p.extraBody))
                if (RESERVED_BODY_KEYS.includes(k))
                    out.push('extraBody must not set "' + k + '" (the protocol owns it)');
    }
    if (p.price !== undefined) {
        const price = p.price;
        if (price === null || typeof price !== 'object' || typeof price.inputPerMTokens !== 'number' || !(price.inputPerMTokens >= 0) || typeof price.currency !== 'string' || !price.currency
            || (price.outputPerMTokens !== undefined && !(typeof price.outputPerMTokens === 'number' && price.outputPerMTokens >= 0)))
            out.push('price must be { inputPerMTokens, outputPerMTokens?, currency } with non-negative numbers');
    }
    return out;
}
/** Preset (when `id` names one) overlaid with the user's fields; limits and extraBody merge key by key. */
function merge(id, raw) {
    const base = PRESETS[id];
    const out = { ...base, ...raw, id };
    if (base) {
        if (base.limits || raw.limits)
            out.limits = { ...base.limits, ...raw.limits };
        if (base.extraBody || raw.extraBody)
            out.extraBody = { ...base.extraBody, ...raw.extraBody };
        // A user who points a preset at another endpoint or model has replaced its placeholders.
        const placeholders = (base.placeholders ?? []).filter(f => raw[f] === undefined);
        if (placeholders.length)
            out.placeholders = placeholders;
        else
            delete out.placeholders;
    }
    return out;
}
/** Every usable provider: the presets, overridden / extended by `settings.providers`. */
export function resolveProviders(settings) {
    const providers = new Map(Object.entries(PRESETS));
    const diagnostics = [];
    for (const [id, raw] of Object.entries(settings?.providers ?? {})) {
        const where = 'evidence.judge.providers.' + id;
        if (!ID_PATTERN.test(id) || RESERVED_IDS.includes(id)) {
            diagnostics.push(where + ' ignored: the id must be lowercase letters, digits, . _ - (at most 48 characters) and not rule / hybrid / none');
            continue;
        }
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
            diagnostics.push(where + ' ignored: not an object');
            continue;
        }
        const unknown = Object.keys(raw).filter(k => !FIELDS.includes(k));
        const merged = merge(id, raw);
        const problems = [...unknown.map(k => 'unknown field "' + k + '"'), ...providerProblems(merged)];
        if (problems.length) {
            diagnostics.push(where + ' ignored' + (PRESETS[id] ? ', the built-in preset is kept' : '') + ': ' + problems.join('; '));
            continue;
        }
        providers.set(id, merged);
    }
    return { providers, diagnostics };
}
/** The configured provider (default bocha-jev), checked for being usable at all. */
export function selectProvider(settings) {
    const { providers, diagnostics } = resolveProviders(settings);
    const id = settings?.provider ?? DEFAULT_PROVIDER_ID;
    const provider = providers.get(id);
    if (!provider)
        return { unusable: 'evidence.judge.provider "' + id + '" is not defined (known: ' + [...providers.keys()].join(', ') + ')', diagnostics };
    const why = unusableReason(provider, settings);
    return why ? { unusable: why, diagnostics } : { provider, diagnostics };
}
export function unusableReason(p, settings) {
    if (p.placeholders?.length)
        return 'provider ' + p.id + ' is a placeholder preset: set ' + p.placeholders.join(' and ') + ' in evidence.judge.providers.' + p.id;
    if (p.protocol === 'rerank' && !p.calibration)
        return 'provider ' + p.id + ' is a rerank provider: set calibration.points (raw score -> grade 0..3), its scores are not grades';
    if (p.protocol === 'llm' && settings?.allowLlm !== true)
        return 'provider ' + p.id + ' uses the llm protocol, which is off: set evidence.judge.allowLlm to true';
    return undefined;
}
/** Full endpoint URL of a provider. */
export function endpointOf(p) {
    return p.baseUrl.replace(/\/+$/, '') + (p.path ?? DEFAULT_PATH[p.protocol]);
}
const pick = (limits, ...keys) => {
    const out = {};
    for (const k of keys)
        if (limits?.[k] !== undefined)
            out[k] = limits[k];
    return out;
};
/** The scorer for a provider: ModelScorer over its protocol. Throws when the provider cannot be built (e.g. an uncalibrated reranker). */
export function createModelScorer(p, deps = {}) {
    if (p.keyRef && !deps.apiKey)
        throw new Error('provider ' + p.id + ' needs ' + p.keyRef + ' (credentials ref or environment)');
    const common = {
        id: p.recordedId ?? p.id, label: p.label ?? p.id, model: p.model, url: endpointOf(p),
        apiKey: p.keyRef ? deps.apiKey : undefined, extraBody: p.extraBody, calibration: p.calibration,
        provider: { id: p.id, protocol: p.protocol },
        fetchImpl: deps.fetchImpl, sleep: deps.sleep, meter: deps.meter, cache: deps.cache,
        requestCap: deps.requestCap ?? p.limits?.requestCap,
        ...pick(p.limits, 'maxRetries', 'timeoutMs'),
    };
    const rubric = deps.rubric;
    switch (p.protocol) {
        case 'systemone':
            return new SystemOneScorer({ ...common, rubric, tokenModel: p.tokenModel ?? 'expanded', ...pick(p.limits, 'maxQuestionsPerRequest', 'requestTokenBudget', 'blockChars', 'maxNeedChars', 'maxStateChars', 'maxBodyBytes') });
        case 'rerank':
            return new RerankScorer({ ...common, ...pick(p.limits, 'maxDocumentsPerRequest', 'requestTokenBudget', 'blockChars', 'maxNeedChars') });
        case 'llm':
            return new LlmScorer({ ...common, rubric, ...pick(p.limits, 'maxQuestionsPerRequest', 'requestTokenBudget', 'blockChars', 'maxNeedChars', 'maxStateChars') });
    }
}
//# sourceMappingURL=providers.js.map