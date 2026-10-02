/**
 * The evidence pipeline (dev-plan §4.3): S1 plan -> S2 recall -> S3/S4 merge,
 * fuse, gate -> S5 read and split -> S6 score -> S7 select -> S8 coverage ->
 * EvidencePack. One round, plus (S8) at most one follow-up round for critical
 * gaps while the round, query and time budgets allow.
 *
 * Every side effect is injected (`PipelineDeps`), so the same stages run
 * against live engines and fetchers (service.ts), against test doubles, and
 * offline over frozen snapshots (bench/src/eval-pack.ts calls
 * `runEvidenceStages` directly with the snapshot's candidates and pages).
 *
 * Cancellation: the caller's signal aborts everything and is rethrown. The
 * run's own deadline is different: when it passes, in-flight work is cut, the
 * stages that need no network still run on what exists, and the pack comes
 * back with `partial: true`.
 * @module web-search-pro/pipeline/run
 */
import crypto from 'node:crypto';
import { mergeCandidates } from "./candidates.js";
import { adaptivePreRankLimit, splitBlocks, preRankBlocks } from "./blocks.js";
import { compileQuery, gapQueryText } from "./compile.js";
import { fuseCandidates } from "./fusion.js";
import { applyFloor, DEFAULT_MIN_KEEP, gateCandidates } from "./gate.js";
import { PROFILE_PROVIDERS, planSources } from "./plan.js";
import { capDiscussionGrades, RuleScorer } from "./score.js";
import { computeCoverage, selectEvidence, DEFAULT_SELECT_OPTIONS } from "./select.js";
export const DEFAULT_DEADLINE_MS = 60_000;
export const DEFAULT_MAX_ROUNDS = 2;
export const DEFAULT_MAX_QUERIES = 4;
/** Gap needs one follow-up round searches for. */
const MAX_GAP_NEEDS = 3;
const REFINE_FETCH_TOP_K = 2;
const REFINE_MIN_REMAINING_MS = 15_000;
const TRUNCATION_MARKER = /\n*\(Content truncated at \d+ characters\.\)\s*$/;
// ── helpers ─────────────────────────────────────────────────────────────────
const rubricStats = (scorer) => (scorer.rubricRef ? { rubric: scorer.rubricRef.key, rubricOverridden: scorer.rubricRef.overridden } : {});
/** Provider / protocol / model / calibration of a model scorer (absent for a bare scorer built outside the provider layer). */
const providerStats = (scorer) => (scorer.provider ? { provider: scorer.provider.id, protocol: scorer.provider.protocol, model: scorer.provider.model, ...scorer.provider.calibration ? { calibration: scorer.provider.calibration } : {} } : {});
/** `provider|protocol|model[|calibration]`: what an evidence row records about the judge behind its grade. */
export const judgeKey = (scorer) => (scorer.provider ? [scorer.provider.id, scorer.provider.protocol, scorer.provider.model, ...scorer.provider.calibration ? [scorer.provider.calibration] : []].join('|') : undefined);
const usageStats = (u) => (u?.estimated ? { estimated: true } : {});
const abortReason = (signal) => signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
/** Run `worker` over `items` with at most `limit` in flight; results keep input order. */
async function pool(items, limit, worker) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        for (;;) {
            const i = next++;
            if (i >= items.length)
                return;
            out[i] = await worker(items[i], i);
        }
    }));
    return out;
}
export function verificationOf(task, compiled) {
    const label = (c) => c.kind + '=' + c.value;
    const native = new Map();
    for (const q of compiled)
        for (const id of q.native)
            (native.get(id) ?? native.set(id, new Set()).get(id)).add(q.providerId);
    return {
        native: task.constraints.filter(c => native.has(c.id)).map(c => label(c) + ' (' + [...native.get(c.id)].join(',') + ')'),
        local: task.constraints.filter(c => !native.has(c.id)).map(label),
    };
}
export async function runPipeline(task, deps, options = {}) {
    const deadlineMs = options.deadlineMs ?? task.budget.deadlineMs ?? DEFAULT_DEADLINE_MS;
    const deadlineAt = Date.now() + deadlineMs;
    const deadlineSignal = AbortSignal.timeout(deadlineMs);
    const stage = options.signal ? AbortSignal.any([options.signal, deadlineSignal]) : deadlineSignal;
    const checkUser = () => { if (options.signal?.aborted)
        throw abortReason(options.signal); };
    const notes = [];
    const now = deps.now?.() ?? new Date();
    // S1
    const allIds = [...new Set([...options.engines ?? [], ...Object.values(PROFILE_PROVIDERS).flat(), ...deps.configuredEngines])];
    const statuses = deps.providerStatus ? await deps.providerStatus(allIds) : undefined;
    checkUser();
    const plan = planSources(task, {
        ...options.engines ? { engines: options.engines } : {},
        configured: deps.configuredEngines,
        ...statuses ? { status: (id) => statuses.get(id) } : {},
        now,
    });
    notes.push(...plan.notes);
    // S2: one provider with one compiled query (and its broader fallbacks while the answer is empty). The provider call
    // counts as ONE query however many fallback variants it needs. `take` meters the queries of a follow-up round.
    const failures = [];
    let cut = false;
    let queries = 0;
    const searchOne = async (id, compiled, sink, take) => {
        const search = deps.searchProvider;
        if (!take())
            return undefined;
        queries++;
        for (const query of [compiled.query, ...compiled.fallbacks ?? []]) {
            let outcome;
            try {
                outcome = await search({ id, query, count: options.perProviderCount ?? 10, ...compiled.options ? { options: compiled.options } : {}, signal: stage });
            }
            catch (error) {
                if (options.signal?.aborted)
                    throw error;
                if (deadlineSignal.aborted) {
                    cut = true;
                    return undefined;
                }
                sink.push(id + ': ' + (error instanceof Error ? error.message : String(error)));
                return undefined;
            }
            if (outcome.state === 'ok' && outcome.sources.length)
                return { providerId: id, query, sources: outcome.sources };
            if (outcome.state === 'empty' || outcome.state === 'ok')
                continue; // a broader fallback query may still answer
            if (outcome.state === 'error')
                sink.push(id + ': ' + outcome.message);
            else
                notes.push('provider ' + id + ' skipped: ' + outcome.reason);
            return undefined;
        }
        return undefined;
    };
    // Round 1 leaves one query for a follow-up round whenever one may run (explicit engines are the caller's choice and stay whole).
    const maxQueries = Math.max(options.maxQueries ?? DEFAULT_MAX_QUERIES, 1);
    const round1Cap = (options.maxRounds ?? DEFAULT_MAX_ROUNDS) > 1 && !options.engines?.length ? Math.max(maxQueries - 1, 1) : Infinity;
    const firstRound = plan.providers.slice(0, round1Cap);
    if (firstRound.length < plan.providers.length)
        notes.push('round 1 limited to ' + firstRound.length + ' provider(s) to keep a query for a second round (' + plan.providers.slice(round1Cap).map(p => p.id).join(',') + ' held back; evidence.maxQueries=' + maxQueries + ')');
    const outputs = [];
    if (firstRound.length && deps.searchProvider) {
        const found = await Promise.all(firstRound.map(({ id, compiled }) => searchOne(id, compiled, failures, () => true)));
        for (const output of found)
            if (output)
                outputs.push(output);
        checkUser();
    }
    // Keep plan order regardless of which provider answered first.
    const planned = firstRound.map(p => p.id);
    outputs.sort((a, b) => planned.indexOf(a.providerId) - planned.indexOf(b.providerId));
    if (failures.length)
        notes.push('provider failures: ' + failures.join('; '));
    if (!outputs.length && failures.length && !cut && !deadlineSignal.aborted)
        throw new Error('all providers failed: ' + failures.join('; '));
    if (cut)
        notes.push('deadline reached while searching');
    // S8 follow-up round (dev-plan M4): a query per gap need, compiled per provider, on providers not used yet first.
    const refine = async (request) => {
        if (!deps.searchProvider)
            return { state: 'skipped', reason: 'no search provider' };
        const left = request.maxQueries - queries;
        if (left <= 0)
            return { state: 'skipped', reason: 'query budget used up (' + queries + '/' + request.maxQueries + ')' };
        const wanted = options.engines?.length ? options.engines : plan.profile === 'general' ? deps.configuredEngines : PROFILE_PROVIDERS[plan.profile];
        const usable = (id) => (statuses ? statuses.get(id)?.state === 'ready' : true);
        const roundOne = new Set(planned);
        const answered = new Set(outputs.map(o => o.providerId));
        const order = [...new Set([
                ...wanted.filter(id => !roundOne.has(id) && usable(id)), // providers the first round did not use
                ...planned.filter(id => answered.has(id) && usable(id)), // then the ones that answered: a new query gets new results
                ...planned.filter(id => !answered.has(id) && usable(id)),
            ])];
        if (!order.length)
            return { state: 'skipped', reason: 'no usable provider' };
        const tried = new Set(outputs.map(o => o.providerId + '|' + o.query));
        const jobs = [];
        for (let i = 0; i < left && i < request.needs.length * order.length; i++) {
            const need = request.needs[i % request.needs.length];
            const id = order[i % order.length];
            const compiled = compileQuery({ ...task, query: gapQueryText(task, need), needs: [need] }, id, now);
            const key = id + '|' + compiled.query;
            if (tried.has(key))
                continue;
            tried.add(key);
            jobs.push({ id, compiled });
        }
        if (!jobs.length)
            return { state: 'skipped', reason: 'no new query to try' };
        const before = queries;
        let budget = left;
        const sink = [];
        const found = await Promise.all(jobs.map(job => searchOne(job.id, job.compiled, sink, () => (budget > 0 ? (budget--, true) : false))));
        return {
            state: 'ok',
            outputs: found.filter((o) => o !== undefined),
            providers: [...new Set(jobs.map(j => j.id))],
            queries: queries - before,
            notes: sink.length ? ['round 2 provider failures: ' + sink.join('; ')] : [],
            cut,
        };
    };
    return runEvidenceStages(task, outputs, deps, options, {
        plan: { ...plan, providers: firstRound }, notes, partial: cut || deadlineSignal.aborted, signal: options.signal, stage, deadline: deadlineAt, now,
        verification: verificationOf(task, firstRound.map(p => p.compiled)), deadlineSignal,
        refine, queryCount: () => queries,
    });
}
const addUsage = (a, b) => (a ? { ...b, requests: a.requests + b.requests, questions: a.questions + b.questions, inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, ...a.estimated || b.estimated ? { estimated: true } : {} } : b);
/** S3–S8 over provider outputs that already exist (live S2, or frozen snapshot results). */
export async function runEvidenceStages(task, outputs, deps, options, ctx) {
    const notes = ctx.notes;
    let partial = ctx.partial;
    const checkUser = () => { if (ctx.signal?.aborted)
        throw abortReason(ctx.signal); };
    const deadlineAt = ctx.deadline;
    const topK = Math.max(options.fetchTopK ?? task.budget.fetchTopK ?? 4, 0);
    const rule = new RuleScorer();
    const control = deps.scorers.control ?? rule;
    // S3/S4: merge, fuse, gate (recall first: only definite violations and clearly off-topic items are dropped).
    const retrieve = (all) => {
        const merged = mergeCandidates(all);
        const answered = new Set(all.filter(o => o.sources.length).map(o => o.providerId));
        const fused = fuseCandidates(merged, { ...deps.fusion, nProviders: Math.max(answered.size, 1), now: ctx.now });
        const gated = gateCandidates(task, fused.map(r => r.candidate));
        const { kept, added } = applyFloor(gated, options.minKeep ?? DEFAULT_MIN_KEEP);
        return { merged, answered, kept, floor: { added, of: gated.length } };
    };
    let allOutputs = outputs;
    let { merged, answered, kept, floor } = retrieve(allOutputs);
    // State shared by the rounds.
    const pages = new Map();
    const seenText = new Set();
    const attempted = new Set();
    const pageBlocks = [];
    const scoredMap = new Map();
    const scorerByBlock = new Map();
    let scorerUsed = 'none';
    let jevUsage;
    let shadow;
    // S5: read the top-K candidates of `pool` (concurrency 2); failures and shell pages stay navigation-only.
    const readPages = async (pool, limit) => {
        const added = [];
        let slots = 0;
        let fetchFailures = 0;
        let next = 0;
        const worker = async () => {
            for (;;) {
                if (ctx.stage.aborted || slots >= limit)
                    return;
                const i = next++;
                if (i >= pool.length)
                    return;
                const candidate = pool[i];
                slots++;
                attempted.add(candidate.candidateId);
                let page;
                try {
                    page = await deps.fetchPage(candidate.url, ctx.stage);
                }
                catch {
                    checkUser();
                    if (!ctx.stage.aborted)
                        fetchFailures++;
                    continue;
                }
                if (page === undefined) {
                    slots--;
                    continue;
                }
                const text = page.text.replace(TRUNCATION_MARKER, '');
                if (page.shellPage || !text.trim())
                    continue;
                const hash = crypto.createHash('sha1').update(text).digest('hex');
                if (seenText.has(hash))
                    continue;
                seenText.add(hash);
                const read = { candidate, page, blocks: page.blocks ?? splitBlocks(text, candidate.url, options.blocks) };
                pages.set(candidate.candidateId, read);
                added.push(read);
            }
        };
        if (limit > 0 && pool.length)
            await Promise.all(Array.from({ length: Math.max(options.fetchConcurrency ?? 2, 1) }, worker));
        checkUser();
        if (ctx.deadlineSignal.aborted && !partial) {
            partial = true;
            notes.push('deadline reached while reading pages');
        }
        if (fetchFailures)
            notes.push(fetchFailures + ' page(s) could not be read and stay navigation-only');
        return added;
    };
    // S5 (blocks) + per-need lexical pre-rank (top N per need) + S6 for `needs` over the blocks of `fresh` pages.
    const scoreRound = async (needs, fresh, first) => {
        const blocks = [];
        for (const { candidate, page, blocks: split } of fresh) {
            const providers = [...new Set(candidate.contributions.map(c => c.providerId))];
            const low = candidate.gate?.lowConfidence === true;
            for (const block of split)
                blocks.push({ candidateId: candidate.candidateId, url: candidate.url, title: candidate.title || page.title || '', ...candidate.publishedAt ? { publishedAt: candidate.publishedAt } : {}, providers, ...low ? { lowConfidence: true } : {}, block });
        }
        pageBlocks.push(...blocks);
        const longestPage = Math.max(0, ...fresh.map(p => p.blocks.length));
        const perNeed = Math.max(options.blocksPerNeed ?? adaptivePreRankLimit(longestPage), 1);
        const ranked = needs.map(need => ({ need, ranked: preRankBlocks(need, task.query, blocks.map(pb => ({ pb, heading: pb.block.heading, text: pb.block.text })), perNeed) }));
        const toJob = (need, rows) => ({
            need,
            blocks: rows.map(({ item }) => ({ blockId: item.pb.block.blockId, url: item.pb.url, text: item.pb.block.text, ...item.pb.block.heading ? { heading: item.pb.block.heading } : {} })),
        });
        const fullJobs = ranked.filter(r => r.ranked.length).map(r => toJob(r.need, r.ranked));
        // `none`: no page produced a block, so nothing was scored.
        let used = fullJobs.length ? control.id : 'none';
        let outcome;
        const corpus = pageBlocks.map(pb => ({ url: pb.url, ...pb.block.heading ? { heading: pb.block.heading } : {}, text: pb.block.text }));
        const scoreCtx = { signal: ctx.stage, corpus, ...deadlineAt !== undefined ? { deadline: deadlineAt } : {} };
        if (fullJobs.length) {
            if (control.id !== 'rule' && !ctx.stage.aborted) {
                // The hybrid scorer picks (and caps) the pairs it sends to Jev itself; a plain remote scorer gets the first `maxScoreQuestions`.
                const limited = control.id === 'hybrid' ? fullJobs : limitQuestions(fullJobs, options.maxScoreQuestions ?? 64);
                try {
                    outcome = await control.score(task, limited, scoreCtx);
                    if (outcome.usage)
                        jevUsage = addUsage(jevUsage, { requests: outcome.usage.requests, questions: outcome.usage.questions + outcome.usage.cacheHits, inputTokens: outcome.usage.inputTokens, outputTokens: outcome.usage.outputTokens, mode: control.id === 'hybrid' ? 'hybrid' : 'control', ...rubricStats(control), ...providerStats(control), ...usageStats(outcome.usage) });
                    if (outcome.notes?.length)
                        notes.push(...outcome.notes.map(n => control.id + ': ' + n));
                }
                catch (error) {
                    checkUser();
                    notes.push('scorer ' + control.id + ' failed, used the rule scorer: ' + (error instanceof Error ? error.message : String(error)));
                    outcome = undefined;
                }
            }
            else if (control.id !== 'rule')
                notes.push('scorer ' + control.id + ' skipped after the deadline, used the rule scorer');
            if (!outcome) {
                outcome = await (control.id === 'rule' ? control : rule).score(task, fullJobs, scoreCtx);
                used = 'rule';
            }
            capDiscussionGrades(ctx.plan.profile, fullJobs, outcome);
        }
        if (first)
            scorerUsed = used;
        if (ctx.deadlineSignal.aborted && !partial) {
            partial = true;
            notes.push('deadline reached while scoring');
        }
        // Shadow scorer (first round only): scores the same blocks as the rule decision; recorded, never applied.
        if (first && deps.scorers.shadow && fullJobs.length && !ctx.stage.aborted) {
            const shadowScorer = deps.scorers.shadow;
            try {
                const reference = used === 'rule' ? outcome : await rule.score(task, fullJobs, scoreCtx);
                const limited = limitQuestions(fullJobs, options.maxScoreQuestions ?? 64);
                const out = await shadowScorer.score(task, limited, scoreCtx);
                const rows = [];
                for (const [needId, byBlock] of out.grades)
                    for (const [blockId, g] of byBlock)
                        rows.push({ needId, blockId, shadow: Number(g.grade.toFixed(3)), control: Number((reference.grades.get(needId)?.get(blockId)?.grade ?? 0).toFixed(3)) });
                shadow = { scorer: shadowScorer.id, model: shadowScorer.model, ...shadowScorer.rubricRef ? { rubric: shadowScorer.rubricRef.key } : {}, ...judgeKey(shadowScorer) ? { judge: judgeKey(shadowScorer) } : {}, rows };
                if (out.usage)
                    jevUsage = { requests: out.usage.requests, questions: out.usage.questions + out.usage.cacheHits, inputTokens: out.usage.inputTokens, outputTokens: out.usage.outputTokens, mode: 'shadow', ...rubricStats(shadowScorer), ...providerStats(shadowScorer), ...usageStats(out.usage) };
            }
            catch (error) {
                checkUser();
                notes.push('shadow scorer ' + shadowScorer.id + ' failed: ' + (error instanceof Error ? error.message : String(error)));
            }
        }
        // Scored blocks (blocks Jev did not answer have no grade and are simply not eligible).
        const byId = new Map(pageBlocks.map(pb => [pb.block.blockId + '|' + pb.url, pb]));
        for (const job of fullJobs) {
            const byBlock = outcome?.grades.get(job.need.id);
            for (const b of job.blocks) {
                const g = byBlock?.get(b.blockId);
                if (!g)
                    continue;
                const key = b.blockId + '|' + b.url;
                const entry = scoredMap.get(key) ?? { pb: byId.get(key), grades: new Map() };
                entry.grades.set(job.need.id, g);
                scoredMap.set(key, entry);
                scorerByBlock.set(key, used);
            }
        }
    };
    // S7 + S8 over everything scored so far.
    const select = { ...task.budget.chars !== undefined ? { charBudget: task.budget.chars } : {}, ...task.budget.maxPerUrl !== undefined ? { maxPerUrl: task.budget.maxPerUrl } : {}, ...options.select };
    const finalize = () => {
        const scored = [...scoredMap.values()].map(({ pb, grades }) => ({ ...pb, grades }));
        const selection = selectEvidence(task, scored, select);
        const coverage = computeCoverage({ needs: task.needs, selected: selection.selected, scored, coverGrade: select.coverGrade ?? DEFAULT_SELECT_OPTIONS.coverGrade, keptCandidates: kept.length, pagesRead: pages.size });
        return { scored, selection, coverage };
    };
    // Round 1.
    await scoreRound(task.needs, await readPages(kept, topK), true);
    let { scored, selection, coverage } = finalize();
    // Round 2 (S8): a critical need without support, budget left (rounds, queries, time): search once more for exactly
    // those needs, read the best new pages, score only the gap needs on them, and select again over the merged pool.
    let rounds = 1;
    let extraEngines = [];
    const targets = coverage.gaps.filter(g => g.critical && g.reason !== 'budget').map(g => task.needs.find(n => n.id === g.needId)).slice(0, MAX_GAP_NEEDS);
    if (ctx.refine && (options.maxRounds ?? DEFAULT_MAX_ROUNDS) > 1 && targets.length && !ctx.stage.aborted) {
        const remaining = deadlineAt === undefined ? Infinity : deadlineAt - Date.now();
        if (remaining < (options.refineMinRemainingMs ?? REFINE_MIN_REMAINING_MS)) {
            notes.push('second round skipped: ' + Math.max(Math.round(remaining / 1000), 0) + ' s left before the deadline');
        }
        else {
            const outcome = await ctx.refine({ needs: targets, maxQueries: options.maxQueries ?? DEFAULT_MAX_QUERIES });
            checkUser();
            if (outcome.state === 'skipped') {
                notes.push('second round skipped: ' + outcome.reason);
            }
            else {
                rounds = 2;
                notes.push(...outcome.notes);
                if (outcome.cut)
                    notes.push('deadline reached during the second round search');
                extraEngines = outcome.providers;
                const known = new Set(merged.map(c => c.candidateId));
                allOutputs = [...allOutputs, ...outcome.outputs];
                ({ merged, answered, kept, floor } = retrieve(allOutputs));
                // New candidates first (they came from the gap queries), then unread ones of the first round, each in fused order.
                const pool = kept.filter(c => !attempted.has(c.candidateId)).sort((a, b) => Number(known.has(a.candidateId)) - Number(known.has(b.candidateId)));
                const fresh = await readPages(pool, Math.min(topK, options.refineFetchTopK ?? REFINE_FETCH_TOP_K));
                await scoreRound(targets, fresh, false);
                const before = coverage.covered.length;
                ({ scored, selection, coverage } = finalize());
                const gained = coverage.covered.length - before;
                notes.push('second round: ' + outcome.queries + ' search(es) for ' + targets.map(n => n.id).join(',') + ' via ' + outcome.providers.join(',') + ' -> ' + (merged.length - known.size) + ' new candidate(s), ' + fresh.length + ' new page(s) read, ' + (gained > 0 ? gained + ' more need(s) covered' : 'no new need covered'));
            }
        }
    }
    if (floor.added)
        notes.push('relevance gate left ' + (kept.length - floor.added) + ' of ' + floor.of + ' candidate(s): kept the ' + floor.added + ' best-ranked one(s) as low relevance (floor ' + (options.minKeep ?? DEFAULT_MIN_KEEP) + ')');
    const resultId = deps.newId?.() ?? 'r_' + crypto.randomBytes(5).toString('hex');
    const evidence = [];
    const evidenceBlocks = [];
    for (const s of selection.selected) {
        const evidenceId = 'e_' + crypto.createHash('sha1').update(resultId + ':' + s.block.block.blockId).digest('hex').slice(0, 10);
        const heading = s.block.block.heading;
        const scorer = scorerByBlock.get(s.block.block.blockId + '|' + s.block.url) ?? scorerUsed;
        evidence.push({
            evidenceId, blockId: s.block.block.blockId, url: s.block.url,
            ...s.block.title ? { title: s.block.title } : {},
            excerpt: s.excerpt,
            ...heading ? { heading } : {},
            ...s.block.publishedAt ? { publishedAt: s.block.publishedAt } : {},
            needIds: s.needIds, grade: Number(s.grade.toFixed(2)), source: s.block.providers.join('+'),
            ...s.block.lowConfidence ? { lowConfidence: true } : {},
        });
        evidenceBlocks.push({ evidenceId, url: s.block.url, blockId: s.block.block.blockId, ...heading ? { heading } : {}, text: s.block.block.text, hash: s.block.block.hash, grade: Number(s.grade.toFixed(3)), scorer, ...scorer !== 'rule' && scorer !== 'none' && control.rubricRef ? { rubric: control.rubricRef.key } : {}, ...scorer !== 'rule' && scorer !== 'none' && judgeKey(control) ? { judge: judgeKey(control) } : {} });
    }
    const sourcesCount = options.sourcesCount ?? 8;
    const used = [...answered];
    const pack = {
        resultId,
        profile: ctx.plan.profile,
        profileInferred: ctx.plan.profileInferred,
        needs: task.needs.map(n => ({ ...n })),
        evidence,
        coveredNeeds: coverage.covered,
        gaps: coverage.gaps,
        sources: kept.slice(0, sourcesCount).map(c => ({ url: c.url, ...c.title ? { title: c.title } : {}, ...c.snippet ? { snippet: c.snippet } : {}, ...c.publishedAt ? { publishedAt: c.publishedAt } : {}, ...c.gate?.lowConfidence ? { lowConfidence: true } : {} })),
        engine: 'pipeline(' + (used.length ? used.join('+') : 'none') + ')',
        enginesTried: [...new Set([...ctx.plan.providers.map(p => p.id), ...extraEngines])],
        partial,
        notes,
        verification: ctx.verification,
        stats: {
            candidates: merged.length, kept: kept.length, ...floor.added ? { lowConfidence: floor.added } : {}, fetched: pages.size, blocksScored: scored.length,
            excerptChars: selection.usedChars, scorer: scorerUsed, ...jevUsage ? { jev: jevUsage } : {},
            rounds, queries: ctx.queryCount?.() ?? allOutputs.length,
        },
    };
    return { pack, task, pagesRead: [...pages.values()].map(p => p.candidate.canonicalUrl), scored, evidenceBlocks, ...shadow ? { shadow } : {} };
}
/** Cap the number of (need, block) questions for a paid scorer: round-robin over the needs, keeping each need's pre-rank order. */
export function limitQuestions(jobs, max) {
    const total = jobs.reduce((n, j) => n + j.blocks.length, 0);
    if (total <= max)
        return [...jobs];
    const take = jobs.map(() => 0);
    let left = Math.max(max, 0);
    for (let round = 0; left > 0; round++) {
        let progressed = false;
        jobs.forEach((job, i) => { if (left > 0 && round < job.blocks.length) {
            take[i]++;
            left--;
            progressed = true;
        } });
        if (!progressed)
            break;
    }
    return jobs.map((job, i) => ({ need: job.need, blocks: job.blocks.slice(0, take[i]) })).filter(job => job.blocks.length);
}
//# sourceMappingURL=run.js.map