/**
 * S6 evidence scoring (dev-plan §4.3, §4.4): (need, block) pairs get a support
 * grade 0..3 (score.support.v1: 0 unrelated, 1 same topic only, 2 partly
 * answers, 3 answers directly with locatable evidence).
 *
 *  - RuleScorer: lexical relevance bucketed like the bench rule judge, with
 *    cross-lingual / identifier alignment (align.ts, dev-plan M3a).
 *  - HybridScorer: the rule scorer grades everything; Jev re-scores only the
 *    pairs the rule scorer is structurally weak on (need and block in different
 *    languages, optionally rule-borderline ones); any Jev failure keeps the
 *    rule grades.
 *  - JevScorer: hosted Bocha Jev `score` questions in Chinese (experiment r1:
 *    nDCG@5 0.565 vs 0.378 for the rule scorer). Questions are chunked to the
 *    service limits and to a conservative expanded-token budget per REQUEST
 *    (r1 saw 422 token_budget_exceeded at 33k tokens in one 12-question
 *    request: the limit acts on the request total), every question's state and
 *    block text are trimmed, retries are bounded, and the API key only ever
 *    goes into the Authorization header.
 *
 * The plan's Judge interface (evaluate(state, question, items)) is adapted to
 * what S6 actually needs: one call scores every need's blocks of a run.
 * @module web-search-pro/pipeline/score
 */
import { alignedRelevance, languagesDiffer } from "./align.js";
import { blockScoringText } from "./blocks.js";
import { lexicalRelevance } from "./gate.js";
// ── rule scorer ─────────────────────────────────────────────────────────────
/** Relevance -> grade buckets: [0,T1) 0, [T1,T2) 1, [T2,T3) 2, >=T3 3 (bench rule judge, r1). */
export const GRADE_THRESHOLDS = [0.12, 0.3, 0.55];
export function bucketGrade(relevance) {
    if (relevance < GRADE_THRESHOLDS[0])
        return 0;
    if (relevance < GRADE_THRESHOLDS[1])
        return 1;
    if (relevance < GRADE_THRESHOLDS[2])
        return 2;
    return 3;
}
export class RuleScorer {
    id = 'rule';
    model;
    align;
    constructor(options = {}) {
        this.align = options.align ?? true;
        this.model = this.align ? 'lexical-v2-aligned' : 'lexical-v1';
    }
    async score(task, jobs) {
        const grades = new Map();
        for (const job of jobs) {
            const ctx = { goal: task.goal, query: task.query, needs: [job.need.text], constraints: task.constraints };
            const byBlock = new Map();
            for (const block of job.blocks) {
                // Same-language pairs keep the calibrated lexical-v1 relevance (an offline sweep showed no gain from identifier splitting there).
                const aligned = this.align && languagesDiffer(job.need.text, blockScoringText(block));
                const relevance = aligned
                    ? alignedRelevance({ goal: task.goal, query: task.query, need: job.need.text, constraints: task.constraints }, { ...block.heading ? { heading: block.heading } : {}, text: block.text })
                    : lexicalRelevance(ctx, { url: block.url, text: blockScoringText(block), ...block.heading ? { heading: block.heading } : {} }, true);
                byBlock.set(block.blockId, { grade: bucketGrade(relevance), rank: relevance });
            }
            grades.set(job.need.id, byBlock);
        }
        return { grades };
    }
}
/**
 * Rule scorer for everything, Jev for the pairs where the rule scorer is
 * structurally weak: need and block written in different languages (both
 * detected, see `detectLang`), plus optionally the rule-borderline pairs
 * (grade 1). Jev answers replace the rule grades; unanswered questions and
 * any Jev failure keep the rule grades (the outcome then says so in `notes`).
 */
export class HybridScorer {
    id = 'hybrid';
    model;
    jev;
    rule;
    borderline;
    maxQuestions;
    constructor(options) {
        this.jev = options.jev;
        this.rule = options.rule ?? new RuleScorer();
        this.borderline = options.borderline ?? false;
        this.maxQuestions = Math.max(options.maxQuestions ?? 64, 0);
        this.model = 'rule+' + this.jev.id + (this.borderline ? '+borderline' : '');
    }
    /** Pairs to re-score, ordered by priority (mismatch first), capped round-robin over the needs. */
    select(jobs, rule) {
        const rows = jobs.map(job => {
            const byBlock = rule.grades.get(job.need.id);
            const mismatch = [];
            const border = [];
            for (const block of job.blocks) {
                const g = byBlock?.get(block.blockId);
                const rank = g?.rank ?? 0;
                if (languagesDiffer(job.need.text, blockScoringText(block)))
                    mismatch.push({ block, rank });
                else if (this.borderline && g?.grade === 1)
                    border.push({ block, rank });
            }
            const byRank = (a, b) => b.rank - a.rank;
            return { need: job.need, queue: [...mismatch.sort(byRank), ...border.sort(byRank)].map(x => x.block) };
        });
        const take = rows.map(() => 0);
        let left = this.maxQuestions;
        for (let round = 0; left > 0; round++) {
            let progressed = false;
            rows.forEach((row, i) => { if (left > 0 && round < row.queue.length) {
                take[i]++;
                left--;
                progressed = true;
            } });
            if (!progressed)
                break;
        }
        return rows.map((row, i) => ({ need: row.need, blocks: row.queue.slice(0, take[i]) })).filter(job => job.blocks.length);
    }
    async score(task, jobs, ctx = {}) {
        const base = await this.rule.score(task, jobs, ctx);
        const grades = new Map([...base.grades].map(([needId, byBlock]) => [needId, new Map(byBlock)]));
        const notes = [];
        const picked = this.select(jobs, base);
        if (!picked.length)
            return { grades, notes };
        try {
            const out = await this.jev.score(task, picked, ctx);
            for (const [needId, byBlock] of out.grades)
                for (const [blockId, g] of byBlock)
                    grades.get(needId)?.set(blockId, { grade: g.grade, rank: g.grade / 3 });
            if (out.notes?.length)
                notes.push(...out.notes);
            return { grades, ...out.usage ? { usage: out.usage } : {}, notes };
        }
        catch (error) {
            if (ctx.signal?.aborted)
                throw error;
            notes.push('Jev re-scoring failed, kept the rule grades: ' + (error instanceof Error ? error.message : String(error)));
            return { grades, notes };
        }
    }
}
// ── Jev scorer ──────────────────────────────────────────────────────────────
export const JEV_URL = 'https://jev.bocha.cn/v1/systemone';
export const JEV_MODEL = 'bocha-jev-v1';
/** Credentials ref / environment variable holding the Bocha Jev key. */
export const JEV_KEY_REF = 'BOCHA_JEV_API_KEY';
/** Wording of bench/rubrics/score.support.v1.json (a bench test pins the two together). */
export const JEV_STATE_PREFIX = '搜索任务：';
export const JEV_INSTRUCTIONS = '下面的文本块对该需求的支撑程度如何？\n需求：{need}\n文本块：{candidate}';
export const JEV_CRITERIA = ['无关或只有同名词', '同主题但不回答', '部分回答', '直接回答且含可定位证据'];
const HAN = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/g;
/**
 * Conservative estimate of the EXPANDED input tokens Jev bills for a `score`
 * question's text. Jev expands each question once per level (4 for score), so
 * the cost is about four times the plain token count: a regression over the
 * 122 r1 requests gave 3.8 per Han character, 0.97 per other character and
 * 706 per question. The constants here (5 / 1.3 / 950) sit above the fit and
 * above the worst r1 request (nf-07, 33,331 counted tokens against an estimate
 * of 38,052), so an estimate within budget never meets the 32,768 limit. A
 * generic "chars / 1.5" would be far too low for CJK-heavy text.
 */
export function estimateJevTokens(text) {
    const han = text.match(HAN)?.length ?? 0;
    return Math.ceil(han * 5 + (text.length - han) * 1.3);
}
/** Fixed expanded-token overhead of one `score` question (the level descriptions; r1 fit: 706). */
export const JEV_QUESTION_OVERHEAD_TOKENS = 950;
export class JevError extends Error {
    status;
    fatal;
    constructor(message, status, fatal = false) {
        super(message);
        this.status = status;
        this.fatal = fatal;
        this.name = 'JevError';
    }
}
const RETRY_STATUSES = new Set([429, 503, 529]);
const MAX_RETRY_WAIT_MS = 10_000;
const cut = (text, max) => (text.length <= max ? text : text.slice(0, Math.max(max - 1, 1)) + '…');
const sleepMs = (ms) => new Promise(resolve => setTimeout(resolve, ms));
function parseRetryAfter(value) {
    if (!value)
        return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds))
        return Math.max(0, seconds * 1000);
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}
export class JevScorer {
    id = 'jev';
    model;
    /** HTTP attempts made so far (retries and splits included). */
    requests = 0;
    cfg;
    apiKey;
    constructor(options) {
        if (!options.apiKey)
            throw new Error('JevScorer needs an API key');
        this.apiKey = options.apiKey;
        this.cfg = {
            url: JEV_URL, model: JEV_MODEL, fetchImpl: globalThis.fetch, sleep: sleepMs,
            maxQuestionsPerRequest: 32, requestTokenBudget: 26_000, blockChars: 1200, maxNeedChars: 200, maxStateChars: 200,
            maxBodyBytes: 200_000, maxRetries: 2, timeoutMs: 20_000,
            ...options,
        };
        this.model = this.cfg.model;
    }
    /** Shared state: a short task description only (it is billed again inside every question). */
    stateFor(task) {
        return JEV_STATE_PREFIX + cut(task.goal.trim().replace(/\s+/g, ' '), this.cfg.maxStateChars);
    }
    instructionsFor(need, candidate) {
        return JEV_INSTRUCTIONS.replace('{need}', () => need).replace('{candidate}', () => candidate);
    }
    buildQuestions(task, jobs) {
        const state = this.stateFor(task);
        const out = [];
        for (const job of jobs) {
            const need = cut(job.need.text.trim().replace(/\s+/g, ' '), this.cfg.maxNeedChars);
            for (const block of job.blocks) {
                const full = blockScoringText(block);
                const candidate = cut(full, this.cfg.blockChars);
                const tokens = JEV_QUESTION_OVERHEAD_TOKENS + estimateJevTokens(state + this.instructionsFor(need, candidate));
                out.push({ needId: job.need.id, blockId: block.blockId, probe: { state, need, candidate: full }, candidate, tokens });
            }
        }
        return out;
    }
    /** Greedy request chunks bounded by question count, estimated tokens and body bytes. */
    chunk(questions, state) {
        const chunks = [];
        let cur = [];
        let tokens = 0;
        let bytes = Buffer.byteLength(state) + 200;
        for (const q of questions) {
            const qBytes = Buffer.byteLength(this.instructionsFor(q.probe.need, q.candidate)) + 120;
            if (cur.length && (cur.length >= this.cfg.maxQuestionsPerRequest || tokens + q.tokens > this.cfg.requestTokenBudget || bytes + qBytes > this.cfg.maxBodyBytes)) {
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
        const put = (q, grade) => { grades.get(q.needId).set(q.blockId, { grade, rank: grade }); };
        const misses = [];
        for (const q of questions) {
            const hit = this.cfg.cache?.get(q.probe);
            if (hit) {
                put(q, hit.grade);
                usage.cacheHits++;
            }
            else
                misses.push(q);
        }
        const notes = [];
        let failed = 0;
        const requestsBefore = this.requests;
        for (const chunk of this.chunk(misses, state)) {
            try {
                failed += await this.run(state, chunk, ctx, usage, put);
            }
            catch (error) {
                if (ctx.signal?.aborted)
                    throw error;
                if (error instanceof JevError && error.fatal)
                    throw error;
                failed += chunk.length;
                notes.push(error.message);
            }
        }
        usage.requests = this.requests - requestsBefore;
        usage.questions = misses.length - failed;
        if (failed)
            notes.push(failed + ' of ' + questions.length + ' Jev questions got no answer');
        if (questions.length && failed / questions.length > 0.5)
            throw new JevError('Jev answered only ' + (questions.length - failed) + ' of ' + questions.length + ' questions' + (notes[0] ? ' (' + notes[0] + ')' : ''));
        return { grades, usage, notes };
    }
    /** Send one chunk; splits it when the service reports the token budget exceeded. Returns the number of unanswered questions. */
    async run(state, chunk, ctx, usage, put, depth = 0) {
        const questions = {};
        chunk.forEach((q, i) => { questions['q' + i] = { type: 'score', instructions: this.instructionsFor(q.probe.need, q.candidate), criteria: JEV_CRITERIA }; });
        let json;
        try {
            json = await this.post(JSON.stringify({ model: this.cfg.model, state, questions }), ctx);
        }
        catch (error) {
            if (error instanceof JevError && error.status === 422 && /token_budget_exceeded/.test(error.message) && depth < 6) {
                if (chunk.length > 1) {
                    const mid = Math.ceil(chunk.length / 2);
                    let missing = 0;
                    for (const half of [chunk.slice(0, mid), chunk.slice(mid)]) {
                        try {
                            missing += await this.run(state, half, ctx, usage, put, depth + 1);
                        }
                        catch (inner) {
                            if (ctx.signal?.aborted || (inner instanceof JevError && inner.fatal))
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
        usage.inputTokens += Number(json?.usage?.input_tokens ?? 0);
        usage.outputTokens += Number(json?.usage?.output_tokens ?? 0);
        let missing = 0;
        chunk.forEach((q, i) => {
            const answer = json?.answers?.['q' + i];
            const grade = Number(answer?.score);
            if (!answer || !Number.isFinite(grade)) {
                missing++;
                return;
            }
            put(q, grade);
            this.cfg.cache?.set(q.probe, { grade, ...answer.probabilities ? { probabilities: answer.probabilities } : {} });
        });
        return missing;
    }
    /** POST with bounded retries (429 / 503 / 529 / network); 401 is fatal, other statuses fail the request. */
    async post(body, ctx) {
        for (let attempt = 0;; attempt++) {
            if (this.cfg.requestCap !== undefined && this.requests >= this.cfg.requestCap)
                throw new JevError('Jev request cap reached (' + this.cfg.requestCap + ')', undefined, true);
            if (ctx.deadline !== undefined && Date.now() >= ctx.deadline)
                throw new JevError('Jev skipped: deadline reached');
            if (ctx.signal?.aborted)
                throw ctx.signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
            this.requests++;
            const signal = ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(this.cfg.timeoutMs)]) : AbortSignal.timeout(this.cfg.timeoutMs);
            let res;
            try {
                res = await this.cfg.fetchImpl(this.cfg.url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.apiKey },
                    body,
                    signal,
                });
            }
            catch (error) {
                if (ctx.signal?.aborted)
                    throw error;
                if (attempt < this.cfg.maxRetries) {
                    await this.wait(1_000 * 2 ** attempt, ctx);
                    continue;
                }
                throw new JevError('Jev network error: ' + error.message);
            }
            if (res.ok)
                return res.json();
            const text = (await res.text().catch(() => '')).slice(0, 300);
            if (RETRY_STATUSES.has(res.status) && attempt < this.cfg.maxRetries) {
                await this.wait(parseRetryAfter(res.headers.get('retry-after')) ?? 1_000 * 2 ** attempt, ctx);
                continue;
            }
            throw new JevError('Jev HTTP ' + res.status + ' ' + text, res.status, res.status === 401 || res.status === 403);
        }
    }
    async wait(ms, ctx) {
        const wait = Math.min(ms, MAX_RETRY_WAIT_MS);
        if (ctx.deadline !== undefined && Date.now() + wait >= ctx.deadline)
            throw new JevError('Jev retry would pass the deadline');
        await this.cfg.sleep(wait);
    }
}
//# sourceMappingURL=score.js.map