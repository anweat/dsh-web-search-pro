/**
 * Provider registry of the judge layer: built-in presets, user-defined providers
 * (`evidence.judge.providers`), validation and the factory that turns a provider
 * into a Scorer. A provider is `{ id, protocol, baseUrl, model, keyRef, limits,
 * calibration?, rubricId? }`; supporting another decision / rerank model means adding
 * an entry here (or in settings), not code, as long as it speaks a known protocol.
 * @module web-search-pro/pipeline/judges/providers
 */
import { SystemOneCoverageJudge } from "./coverage.js";
import { LLM_PATH, LlmScorer } from "./protocols/llm.js";
import { RERANK_PATH, RerankScorer } from "./protocols/rerank.js";
import { SYSTEMONE_PATH, SystemOneScorer } from "./protocols/systemone.js";
import { DEFAULT_PROVIDER_ID, JEV_BASE_URL, PRESETS, providerProblems, resolveProviders, unusableReason } from "./providers-spec.js";
export { DEFAULT_PROVIDER_ID, PRESETS, providerProblems, resolveProviders, unusableReason };
export { JEV_BASE_URL, JEV_KEY_REF, JEV_MODEL } from "./providers-spec.js";
export const JEV_URL = JEV_BASE_URL + SYSTEMONE_PATH;
const DEFAULT_PATH = { systemone: SYSTEMONE_PATH, rerank: RERANK_PATH, llm: LLM_PATH };
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
/**
 * The coverage judge (dev-plan M9) of a provider: one `noul` question per need, so only the `systemone` protocol
 * can serve it. Throws for any other protocol and for a provider that needs a key it was not given.
 */
export function createCoverageJudge(p, deps = {}) {
    if (p.protocol !== 'systemone')
        throw new Error('provider ' + p.id + ' speaks ' + p.protocol + ': the coverage judge needs the systemone protocol (noul questions)');
    if (p.keyRef && !deps.apiKey)
        throw new Error('provider ' + p.id + ' needs ' + p.keyRef + ' (credentials ref or environment)');
    return new SystemOneCoverageJudge({
        id: p.recordedId ?? p.id, label: p.label ?? p.id, model: p.model, url: endpointOf(p),
        apiKey: p.keyRef ? deps.apiKey : undefined, extraBody: p.extraBody,
        provider: { id: p.id, protocol: p.protocol },
        fetchImpl: deps.fetchImpl, sleep: deps.sleep, meter: deps.meter, cache: deps.cache,
        requestCap: deps.requestCap ?? p.limits?.requestCap,
        rubric: deps.rubric, tokenModel: p.tokenModel ?? 'expanded',
        ...pick(p.limits, 'maxRetries', 'timeoutMs', 'maxQuestionsPerRequest', 'requestTokenBudget', 'blockChars', 'maxNeedChars', 'maxStateChars', 'maxBodyBytes'),
    });
}
//# sourceMappingURL=providers.js.map