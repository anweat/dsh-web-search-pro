/**
 * The evidence pipeline (dev-plan §4.3): S1 plan -> S2 recall -> S3/S4 merge,
 * fuse, gate -> S5 read and split -> S6 score -> S7 select -> S8 coverage ->
 * EvidencePack. Single round; no re-search loop yet.
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
import { fuseCandidates } from "./fusion.js";
import { gateCandidates, keptCandidates } from "./gate.js";
import { PROFILE_PROVIDERS, planSources } from "./plan.js";
import { RuleScorer } from "./score.js";
import { computeCoverage, selectEvidence, DEFAULT_SELECT_OPTIONS } from "./select.js";
export const DEFAULT_DEADLINE_MS = 60_000;
const TRUNCATION_MARKER = /\n*\(Content truncated at \d+ characters\.\)\s*$/;
// ── helpers ─────────────────────────────────────────────────────────────────
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
    // S2
    const outputs = [];
    const failures = [];
    let cut = false;
    if (plan.providers.length && deps.searchProvider) {
        const search = deps.searchProvider;
        await Promise.all(plan.providers.map(async ({ id, compiled }) => {
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
                        return;
                    }
                    failures.push(id + ': ' + (error instanceof Error ? error.message : String(error)));
                    return;
                }
                if (outcome.state === 'ok' && outcome.sources.length) {
                    outputs.push({ providerId: id, query, sources: outcome.sources });
                    return;
                }
                if (outcome.state === 'empty' || outcome.state === 'ok')
                    continue; // a broader fallback query may still answer
                if (outcome.state === 'error')
                    failures.push(id + ': ' + outcome.message);
                else
                    notes.push('provider ' + id + ' skipped: ' + outcome.reason);
                return;
            }
        }));
        checkUser();
    }
    // Keep plan order regardless of which provider answered first.
    const planned = plan.providers.map(p => p.id);
    outputs.sort((a, b) => planned.indexOf(a.providerId) - planned.indexOf(b.providerId));
    if (failures.length)
        notes.push('provider failures: ' + failures.join('; '));
    if (!outputs.length && failures.length && !cut && !deadlineSignal.aborted)
        throw new Error('all providers failed: ' + failures.join('; '));
    if (cut)
        notes.push('deadline reached while searching');
    return runEvidenceStages(task, outputs, deps, options, {
        plan, notes, partial: cut || deadlineSignal.aborted, signal: options.signal, stage, deadline: deadlineAt, now,
        verification: verificationOf(task, plan.providers.map(p => p.compiled)), deadlineSignal,
    });
}
/** S3–S8 over provider outputs that already exist (live S2, or frozen snapshot results). */
export async function runEvidenceStages(task, outputs, deps, options, ctx) {
    const notes = ctx.notes;
    let partial = ctx.partial;
    const checkUser = () => { if (ctx.signal?.aborted)
        throw abortReason(ctx.signal); };
    const deadlineAt = ctx.deadline;
    // S3/S4: merge, fuse, gate (recall first: only definite violations and clearly off-topic items are dropped).
    const merged = mergeCandidates(outputs);
    const answered = new Set(outputs.filter(o => o.sources.length).map(o => o.providerId));
    const fused = fuseCandidates(merged, { ...deps.fusion, nProviders: Math.max(answered.size, 1), now: ctx.now });
    const gated = gateCandidates(task, fused.map(r => r.candidate));
    const kept = keptCandidates(gated);
    // S5: read the top-K kept candidates (concurrency 2); failures and shell pages stay navigation-only.
    const topK = Math.max(options.fetchTopK ?? task.budget.fetchTopK ?? 4, 0);
    const pages = new Map();
    const seenText = new Set();
    let slots = 0;
    let fetchFailures = 0;
    let next = 0;
    const worker = async () => {
        for (;;) {
            if (ctx.stage.aborted || slots >= topK)
                return;
            const i = next++;
            if (i >= kept.length)
                return;
            const candidate = kept[i];
            slots++;
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
            pages.set(candidate.candidateId, { candidate, page, blocks: page.blocks ?? splitBlocks(text, candidate.url, options.blocks) });
        }
    };
    if (topK > 0 && kept.length)
        await Promise.all(Array.from({ length: Math.max(options.fetchConcurrency ?? 2, 1) }, worker));
    checkUser();
    if (ctx.deadlineSignal.aborted && !partial) {
        partial = true;
        notes.push('deadline reached while reading pages');
    }
    if (fetchFailures)
        notes.push(fetchFailures + ' page(s) could not be read and stay navigation-only');
    // Per-need lexical pre-rank (top N per need), then S6.
    const pageBlocks = [];
    for (const { candidate, page, blocks } of pages.values()) {
        const providers = [...new Set(candidate.contributions.map(c => c.providerId))];
        for (const block of blocks)
            pageBlocks.push({ candidateId: candidate.candidateId, url: candidate.url, title: candidate.title || page.title || '', ...candidate.publishedAt ? { publishedAt: candidate.publishedAt } : {}, providers, block });
    }
    const longestPage = Math.max(0, ...[...pages.values()].map(p => p.blocks.length));
    const perNeed = Math.max(options.blocksPerNeed ?? adaptivePreRankLimit(longestPage), 1);
    const ranked = task.needs.map(need => ({ need, ranked: preRankBlocks(need, task.query, pageBlocks.map(pb => ({ pb, heading: pb.block.heading, text: pb.block.text })), perNeed) }));
    const toJob = (need, rows) => ({
        need,
        blocks: rows.map(({ item }) => ({ blockId: item.pb.block.blockId, url: item.pb.url, text: item.pb.block.text, ...item.pb.block.heading ? { heading: item.pb.block.heading } : {} })),
    });
    const fullJobs = ranked.filter(r => r.ranked.length).map(r => toJob(r.need, r.ranked));
    const rule = new RuleScorer();
    const control = deps.scorers.control ?? rule;
    // `none`: no page produced a block, so nothing was scored.
    let scorerUsed = fullJobs.length ? control.id : 'none';
    let outcome;
    let jevUsage;
    const scoreCtx = { signal: ctx.stage, ...deadlineAt !== undefined ? { deadline: deadlineAt } : {} };
    if (fullJobs.length) {
        if (control.id !== 'rule' && !ctx.stage.aborted) {
            const limited = limitQuestions(fullJobs, options.maxScoreQuestions ?? 64);
            try {
                outcome = await control.score(task, limited, scoreCtx);
                if (outcome.usage)
                    jevUsage = { requests: outcome.usage.requests, questions: outcome.usage.questions + outcome.usage.cacheHits, inputTokens: outcome.usage.inputTokens, outputTokens: outcome.usage.outputTokens, mode: 'control' };
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
            outcome = await rule.score(task, fullJobs);
            scorerUsed = 'rule';
        }
    }
    if (ctx.deadlineSignal.aborted && !partial) {
        partial = true;
        notes.push('deadline reached while scoring');
    }
    // Shadow scorer: scores the same blocks as the rule decision; recorded, never applied.
    let shadow;
    if (deps.scorers.shadow && fullJobs.length && !ctx.stage.aborted) {
        const shadowScorer = deps.scorers.shadow;
        try {
            const reference = scorerUsed === 'rule' ? outcome : await rule.score(task, fullJobs);
            const limited = limitQuestions(fullJobs, options.maxScoreQuestions ?? 64);
            const out = await shadowScorer.score(task, limited, scoreCtx);
            const rows = [];
            for (const [needId, byBlock] of out.grades)
                for (const [blockId, g] of byBlock)
                    rows.push({ needId, blockId, shadow: Number(g.grade.toFixed(3)), control: Number((reference.grades.get(needId)?.get(blockId)?.grade ?? 0).toFixed(3)) });
            shadow = { scorer: shadowScorer.id, model: shadowScorer.model, rows };
            if (out.usage)
                jevUsage = { requests: out.usage.requests, questions: out.usage.questions + out.usage.cacheHits, inputTokens: out.usage.inputTokens, outputTokens: out.usage.outputTokens, mode: 'shadow' };
        }
        catch (error) {
            checkUser();
            notes.push('shadow scorer ' + shadowScorer.id + ' failed: ' + (error instanceof Error ? error.message : String(error)));
        }
    }
    // Scored blocks (blocks Jev did not answer have no grade and are simply not eligible).
    const byId = new Map(pageBlocks.map(pb => [pb.block.blockId + '|' + pb.url, pb]));
    const scoredMap = new Map();
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
        }
    }
    const scored = [...scoredMap.values()].map(({ pb, grades }) => ({ ...pb, grades }));
    // S7 + S8.
    const select = { ...task.budget.chars !== undefined ? { charBudget: task.budget.chars } : {}, ...task.budget.maxPerUrl !== undefined ? { maxPerUrl: task.budget.maxPerUrl } : {}, ...options.select };
    const selection = selectEvidence(task, scored, select);
    const coverage = computeCoverage({ needs: task.needs, selected: selection.selected, scored, coverGrade: select.coverGrade ?? DEFAULT_SELECT_OPTIONS.coverGrade, keptCandidates: kept.length, pagesRead: pages.size });
    const resultId = deps.newId?.() ?? 'r_' + crypto.randomBytes(5).toString('hex');
    const evidence = [];
    const evidenceBlocks = [];
    for (const s of selection.selected) {
        const evidenceId = 'e_' + crypto.createHash('sha1').update(resultId + ':' + s.block.block.blockId).digest('hex').slice(0, 10);
        const heading = s.block.block.heading;
        evidence.push({
            evidenceId, blockId: s.block.block.blockId, url: s.block.url,
            ...s.block.title ? { title: s.block.title } : {},
            excerpt: s.excerpt,
            ...heading ? { heading } : {},
            ...s.block.publishedAt ? { publishedAt: s.block.publishedAt } : {},
            needIds: s.needIds, grade: Number(s.grade.toFixed(2)), source: s.block.providers.join('+'),
        });
        evidenceBlocks.push({ evidenceId, url: s.block.url, blockId: s.block.block.blockId, ...heading ? { heading } : {}, text: s.block.block.text, hash: s.block.block.hash, grade: Number(s.grade.toFixed(3)), scorer: scorerUsed });
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
        sources: kept.slice(0, sourcesCount).map(c => ({ url: c.url, ...c.title ? { title: c.title } : {}, ...c.snippet ? { snippet: c.snippet } : {}, ...c.publishedAt ? { publishedAt: c.publishedAt } : {} })),
        engine: 'pipeline(' + (used.length ? used.join('+') : 'none') + ')',
        enginesTried: ctx.plan.providers.map(p => p.id),
        partial,
        notes,
        verification: ctx.verification,
        stats: {
            candidates: merged.length, kept: kept.length, fetched: pages.size, blocksScored: scored.length,
            excerptChars: selection.usedChars, scorer: scorerUsed, ...jevUsage ? { jev: jevUsage } : {},
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