/**
 * `systemone` protocol: the Jev-compatible decision API (`POST /v1/systemone`):
 * a shared `state` plus up to 32 `questions` (type noul | score | choice, free-text
 * `instructions`, `criteria`), answered per question (`noul` probability, `score` grade
 * expectation, `choice` label + probabilities) with `usage.input_tokens`. Spoken by the
 * hosted Bocha Jev, other Jev deployments (TypeSafe) and the local Laya sidecar.
 *
 * S6 asks `score` questions, one per (need, block), worded by the `score.support`
 * rubric. Requests are chunked to the service limits and to a conservative
 * expanded-token budget per REQUEST (experiment r1 saw 422 token_budget_exceeded at
 * 33k tokens in one 12-question request: the limit acts on the request total); every
 * question's state and block text are trimmed, retries are bounded, and the API key only
 * ever goes into the Authorization header.
 * @module web-search-pro/pipeline/judges/protocols/systemone
 */
import { blockScoringText } from "../../blocks.js";
import { builtinRubric, refOf, renderTemplate } from "../../rubrics.js";
import { BudgetExceededError, JudgeError } from "../errors.js";
import { ModelScorerBase } from "../model-scorer.js";
import { cut, estimateJevTokens, estimatePlainTokens, JEV_QUESTION_OVERHEAD_TOKENS, squash } from "../tokens.js";
export const SYSTEMONE_PATH = '/v1/systemone';
/** Candidate options one question presents: noul 2, score = number of levels, choice = number of options. */
export function candidatesFor(q) {
    if (q.kind === 'noul')
        return 2;
    if (q.kind === 'score')
        return q.criteria?.length ?? 4;
    return Object.keys(q.options ?? {}).length;
}
/** Split items into request-sized groups: question count, candidate total and body size bounds. */
export function chunkItems(items, q, size, limits) {
    const perQuestion = candidatesFor(q);
    const chunks = [];
    let cur = [];
    let bytes = limits.baseBytes;
    for (const item of items) {
        const itemBytes = size(item);
        const full = cur.length >= limits.maxQuestions
            || (cur.length + 1) * perQuestion > limits.maxCandidates
            || bytes + itemBytes > limits.maxBodyBytes;
        if (cur.length && full) {
            chunks.push(cur);
            cur = [];
            bytes = limits.baseBytes;
        }
        cur.push(item);
        bytes += itemBytes;
    }
    if (cur.length)
        chunks.push(cur);
    return chunks;
}
/** One question object of the request body. */
export function encodeQuestion(kind, instructions, criteria) {
    const body = { type: kind, instructions };
    if (kind === 'score')
        body.criteria = criteria;
    if (kind === 'choice')
        body.criteria = criteria;
    return body;
}
/** The request body: `model`, `state`, `questions`, then the provider's extra fields. */
export function encodeRequest(model, state, questions, extraBody) {
    return JSON.stringify({ model, state, questions, ...extraBody });
}
export function decodeAnswer(kind, answer) {
    if (!answer)
        return { error: 'missing answer' };
    if (kind === 'noul') {
        const prob = Number(answer.noul);
        return Number.isFinite(prob) ? { kind, prob } : { error: 'bad noul answer' };
    }
    if (kind === 'score') {
        const grade = Number(answer.score);
        return Number.isFinite(grade) ? { kind, grade, ...answer.probabilities ? { probabilities: answer.probabilities } : {} } : { error: 'bad score answer' };
    }
    const probabilities = (answer.probabilities ?? {});
    const choice = String(answer.choice ?? '');
    if (!choice)
        return { error: 'bad choice answer' };
    return { kind, choice, prob: probabilities[choice] ?? Number(answer.answer_confidence ?? answer.confidence), probabilities };
}
const numeric = (v) => {
    if (v === undefined || v === null)
        return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};
export const usageOfSystemOne = (json) => ({ input: numeric(json?.usage?.input_tokens), output: numeric(json?.usage?.output_tokens) });
export class SystemOneScorer extends ModelScorerBase {
    rubricRef;
    rubric;
    tokenModel;
    lim;
    constructor(options) {
        super(options);
        this.rubric = options.rubric ?? builtinRubric('score.support');
        if (this.rubric.kind !== 'score')
            throw new Error(options.label + ' scorer needs a score rubric, got ' + this.rubric.id + ' (' + this.rubric.kind + ')');
        this.rubricRef = refOf(this.rubric);
        this.tokenModel = options.tokenModel ?? 'expanded';
        this.lim = {
            maxQuestionsPerRequest: options.maxQuestionsPerRequest ?? 32, requestTokenBudget: options.requestTokenBudget ?? 26_000,
            blockChars: options.blockChars ?? this.rubric.maxCandidateChars, maxNeedChars: options.maxNeedChars ?? 200,
            maxStateChars: options.maxStateChars ?? this.rubric.maxStateChars, maxBodyBytes: options.maxBodyBytes ?? 200_000,
        };
    }
    /** The task description as `{task}` renders it. */
    taskText(task) {
        return cut(task.goal.trim().replace(/\s+/g, ' '), this.lim.maxStateChars);
    }
    /** Grade as the pipeline reads it: criteria with another level count than the built-in 4 are rescaled onto 0..3, then calibrated. */
    normalized(grade) {
        const levels = this.rubric.criteria.length;
        return this.shape(levels === 4 ? grade : (grade * 3) / (levels - 1));
    }
    /** Shared state: a short task description only (it is billed again inside every question). */
    stateFor(task) {
        return renderTemplate(this.rubric.state, { task: this.taskText(task) });
    }
    instructionsFor(need, candidate, task) {
        return renderTemplate(this.rubric.instructions, { need, candidate, task });
    }
    estimate(state, instructions) {
        return this.tokenModel === 'expanded' ? JEV_QUESTION_OVERHEAD_TOKENS + estimateJevTokens(state + instructions) : estimatePlainTokens(state + instructions) + 80;
    }
    buildQuestions(task, jobs) {
        const state = this.stateFor(task);
        const taskText = this.taskText(task);
        const out = [];
        for (const job of jobs) {
            const need = squash(job.need.text, this.lim.maxNeedChars);
            for (const block of job.blocks) {
                const full = blockScoringText(block);
                const candidate = cut(full, this.lim.blockChars);
                out.push({
                    needId: job.need.id, blockId: block.blockId,
                    probe: { state, need, candidate: full, task: taskText, rubric: this.rubric.key, ...this.providerKey ? { provider: this.providerKey } : {} },
                    candidate, tokens: this.estimate(state, this.instructionsFor(need, candidate, taskText)),
                });
            }
        }
        return out;
    }
    /** Greedy request chunks bounded by question count, estimated tokens and body bytes. */
    chunk(questions, state, tokenBudget) {
        const chunks = [];
        let cur = [];
        let tokens = 0;
        let bytes = Buffer.byteLength(state) + 200;
        for (const q of questions) {
            const qBytes = Buffer.byteLength(this.instructionsFor(q.probe.need, q.candidate, q.probe.task ?? '')) + 120;
            if (cur.length && (cur.length >= this.lim.maxQuestionsPerRequest || tokens + q.tokens > tokenBudget || bytes + qBytes > this.lim.maxBodyBytes)) {
                chunks.push(cur);
                cur = [];
                tokens = 0;
                bytes = Buffer.byteLength(state) + 200;
            }
            cur.push(q);
            tokens += q.tokens;
            bytes += qBytes;
        }
        if (cur.length)
            chunks.push(cur);
        return chunks;
    }
    async score(task, jobs, ctx = {}) {
        const state = this.stateFor(task);
        const questions = this.buildQuestions(task, jobs);
        const usage = { requests: 0, questions: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0 };
        const grades = new Map();
        for (const job of jobs)
            grades.set(job.need.id, new Map());
        const put = (q, grade) => { const g = this.normalized(grade); grades.get(q.needId).set(q.blockId, { grade: g, rank: g }); };
        const misses = [];
        for (const q of questions) {
            const hit = this.cache?.get(q.probe);
            if (hit) {
                put(q, hit.grade);
                usage.cacheHits++;
            }
            else
                misses.push(q);
        }
        const requestsBefore = this.requests;
        // Requests are sized so one of them can fit the remaining usage headroom.
        const tokenBudget = Math.min(this.lim.requestTokenBudget, Math.max(this.http.headroom(), 1));
        const dispatched = await this.dispatch(this.chunk(misses, state, tokenBudget), chunk => this.run(state, chunk, ctx, usage, put), ctx);
        const notes = this.conclude(dispatched, usage, { total: questions.length, asked: misses.length, requestsBefore });
        return { grades, usage, notes };
    }
    /** Send one chunk; splits it when the service reports the token budget exceeded. Returns the number of unanswered questions. */
    async run(state, chunk, ctx, usage, put, depth = 0) {
        const questions = {};
        chunk.forEach((q, i) => { questions['q' + i] = encodeQuestion('score', this.instructionsFor(q.probe.need, q.candidate, q.probe.task ?? ''), this.rubric.criteria); });
        let result;
        try {
            result = await this.http.post(encodeRequest(this.model, state, questions, this.extraBody), ctx, { estimatedInputTokens: chunk.reduce((n, q) => n + q.tokens, 0), usageOf: usageOfSystemOne });
        }
        catch (error) {
            if (error instanceof JudgeError && error.status === 422 && /token_budget_exceeded/.test(error.message) && depth < 6) {
                if (chunk.length > 1) {
                    const mid = Math.ceil(chunk.length / 2);
                    let missing = 0;
                    for (const half of [chunk.slice(0, mid), chunk.slice(mid)]) {
                        try {
                            missing += await this.run(state, half, ctx, usage, put, depth + 1);
                        }
                        catch (inner) {
                            if (ctx.signal?.aborted || (inner instanceof JudgeError && inner.fatal) || inner instanceof BudgetExceededError)
                                throw inner;
                            missing += half.length;
                        }
                    }
                    return missing;
                }
                // One question alone is too long: halve its text once.
                const only = chunk[0];
                if (only.candidate.length > 200)
                    return this.run(state, [{ ...only, candidate: cut(only.candidate, Math.floor(only.candidate.length / 2)) }], ctx, usage, put, depth + 1);
            }
            throw error;
        }
        const { json } = result;
        usage.inputTokens += result.inputTokens;
        usage.outputTokens += result.outputTokens;
        if (result.estimated)
            usage.estimated = true;
        let missing = 0;
        chunk.forEach((q, i) => {
            const answer = json?.answers?.['q' + i];
            const grade = Number(answer?.score);
            if (!answer || !Number.isFinite(grade)) {
                missing++;
                return;
            }
            put(q, grade);
            this.cache?.set(q.probe, { grade, ...answer.probabilities ? { probabilities: answer.probabilities } : {} });
        });
        return missing;
    }
}
//# sourceMappingURL=systemone.js.map