/**
 * The coverage judge (dev-plan M9): "do these excerpts, by themselves, state the
 * answer to the need?" asked as one `noul` question per need over the `systemone`
 * protocol (Bocha Jev and compatible services), worded by the `cover.sufficient`
 * rubric. The answer is the probability of "yes" (the raw `noul` value); how it is
 * read (bands, thresholds) lives in ../coverage.ts, because a probability is only
 * meaningful against thresholds calibrated for one provider and one rubric.
 *
 * Transport, metering, retries and the request cap are the judge layer's own
 * (ModelClientBase); questions are chunked like S6's and a failed chunk only loses
 * its own needs. Nothing here falls back silently: the caller keeps the rule
 * coverage for every need without a verdict and says so.
 * @module web-search-pro/pipeline/judges/coverage
 */
import { builtinRubric, refOf, renderTemplate } from "../rubrics.js";
import { BudgetExceededError, JudgeError } from "./errors.js";
import { ModelClientBase } from "./model-scorer.js";
import { decodeAnswer, encodeQuestion, encodeRequest, usageOfSystemOne } from "./protocols/systemone.js";
import { cut, estimatePlainTokens, squash } from "./tokens.js";
/** Fixed input-token overhead of one noul question (measured on r1: ~250 tokens for a short gate question; 2x margin). */
const NOUL_QUESTION_OVERHEAD_TOKENS = 300;
export class SystemOneCoverageJudge extends ModelClientBase {
    rubricRef;
    rubric;
    tokenModel;
    lim;
    constructor(options) {
        super(options);
        this.rubric = options.rubric ?? builtinRubric('cover.sufficient');
        if (this.rubric.kind !== 'noul')
            throw new Error(options.label + ' coverage judge needs a noul rubric, got ' + this.rubric.id + ' (' + this.rubric.kind + ')');
        this.rubricRef = refOf(this.rubric);
        this.tokenModel = options.tokenModel ?? 'expanded';
        this.lim = {
            maxQuestionsPerRequest: options.maxQuestionsPerRequest ?? 32, requestTokenBudget: options.requestTokenBudget ?? 26_000,
            blockChars: options.blockChars ?? this.rubric.maxCandidateChars, maxNeedChars: options.maxNeedChars ?? 200,
            maxStateChars: options.maxStateChars ?? this.rubric.maxStateChars, maxBodyBytes: options.maxBodyBytes ?? 200_000,
        };
    }
    taskText(task) {
        return cut(task.goal.trim().replace(/\s+/g, ' '), this.lim.maxStateChars);
    }
    /** Shared state: the short task description (billed again inside every question). */
    stateFor(task) {
        return renderTemplate(this.rubric.state ?? '搜索任务：{task}', { task: this.taskText(task) });
    }
    instructionsFor(need, candidate, task) {
        return renderTemplate(this.rubric.instructions, { need, candidate, task });
    }
    estimate(state, instructions) {
        const plain = estimatePlainTokens(state + instructions);
        return this.tokenModel === 'expanded' ? NOUL_QUESTION_OVERHEAD_TOKENS + plain * 2 : plain + 80;
    }
    buildQuestions(task, items) {
        const state = this.stateFor(task);
        const taskText = this.taskText(task);
        return items.map(item => {
            const need = squash(item.need, this.lim.maxNeedChars);
            const candidate = cut(item.evidence, this.lim.blockChars);
            return {
                needId: item.needId, candidate,
                probe: { state, need, candidate: item.evidence, task: taskText, rubric: this.rubric.key, ...this.providerKey ? { provider: this.providerKey } : {} },
                tokens: this.estimate(state, this.instructionsFor(need, candidate, taskText)),
            };
        });
    }
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
    async judge(task, items, ctx = {}) {
        const state = this.stateFor(task);
        const questions = this.buildQuestions(task, items);
        const usage = { requests: 0, questions: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0 };
        const probs = new Map();
        const misses = [];
        for (const q of questions) {
            const hit = this.cache?.get(q.probe);
            if (hit && Number.isFinite(hit.grade)) {
                probs.set(q.needId, hit.grade);
                usage.cacheHits++;
            }
            else
                misses.push(q);
        }
        const requestsBefore = this.requests;
        const tokenBudget = Math.min(this.lim.requestTokenBudget, Math.max(this.http.headroom(), 1));
        const dispatched = await this.dispatch(this.chunk(misses, state, tokenBudget), chunk => this.run(state, chunk, ctx, usage, probs), ctx);
        const notes = this.conclude(dispatched, usage, { total: questions.length, asked: misses.length, requestsBefore });
        return { probs, usage, notes };
    }
    /** Send one chunk; splits it when the service reports the token budget exceeded. Returns the number of unanswered questions. */
    async run(state, chunk, ctx, usage, probs, depth = 0) {
        const body = {};
        chunk.forEach((q, i) => { body['q' + i] = encodeQuestion('noul', this.instructionsFor(q.probe.need, q.candidate, q.probe.task ?? '')); });
        let result;
        try {
            result = await this.http.post(encodeRequest(this.model, state, body, this.extraBody), ctx, { estimatedInputTokens: chunk.reduce((n, q) => n + q.tokens, 0), usageOf: usageOfSystemOne });
        }
        catch (error) {
            if (error instanceof JudgeError && error.status === 422 && /token_budget_exceeded/.test(error.message) && depth < 6) {
                if (chunk.length > 1) {
                    const mid = Math.ceil(chunk.length / 2);
                    let missing = 0;
                    for (const half of [chunk.slice(0, mid), chunk.slice(mid)]) {
                        try {
                            missing += await this.run(state, half, ctx, usage, probs, depth + 1);
                        }
                        catch (inner) {
                            if (ctx.signal?.aborted || (inner instanceof JudgeError && inner.fatal) || inner instanceof BudgetExceededError)
                                throw inner;
                            missing += half.length;
                        }
                    }
                    return missing;
                }
                // One question alone is too long: halve its evidence once.
                const only = chunk[0];
                if (only.candidate.length > 400)
                    return this.run(state, [{ ...only, candidate: cut(only.candidate, Math.floor(only.candidate.length / 2)) }], ctx, usage, probs, depth + 1);
            }
            throw error;
        }
        usage.inputTokens += result.inputTokens;
        usage.outputTokens += result.outputTokens;
        if (result.estimated)
            usage.estimated = true;
        let missing = 0;
        chunk.forEach((q, i) => {
            const d = decodeAnswer('noul', result.json?.answers?.['q' + i]);
            const prob = 'prob' in d ? d.prob : undefined;
            if (prob === undefined || !(prob >= 0 && prob <= 1)) {
                missing++;
                return;
            }
            probs.set(q.needId, prob);
            this.cache?.set(q.probe, { grade: prob });
        });
        return missing;
    }
}
//# sourceMappingURL=coverage.js.map