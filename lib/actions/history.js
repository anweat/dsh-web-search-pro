/**
 * `history` group: list, replay, expand (evidence), export and delete what the plugin stored.
 * @module web-search-pro/actions/history
 */
import fs from 'node:fs';
import path from 'node:path';
import { expandEvidence, replayHistory } from "../history.js";
import { capText } from "../util.js";
import { ActionArgError, ActionNotFoundError } from "./types.js";
const KINDS = ['search', 'fetch', 'platform', 'snapshot', 'all'];
const RECORD_SCHEMA = { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, kind: { type: 'string' }, query: { type: 'string' }, engine: { type: 'string' }, platform: { type: 'string' }, url: { type: 'string' }, status: { type: 'string' }, ts: { type: 'string' } } };
const SOURCE_SCHEMA = { type: 'object', additionalProperties: false, properties: { url: { type: 'string', required: true }, title: { type: 'string' }, snippet: { type: 'string' }, publishedAt: { type: 'string' } } };
const FILTER_PARAMS = {
    kind: { type: 'string', enum: KINDS, description: 'search, fetch, platform, snapshot or all (default all).' },
    query: { type: 'string', description: 'Substring of the query or URL.' },
    engine: { type: 'string', description: 'Engine id (ddg, github, multi(...), pipeline).' },
    platform: { type: 'string', description: 'Platform (github, zhihu, arxiv).' },
    limit: { type: 'number', description: 'Max rows (1-200, default 20).' },
};
function listFiltered(args, store) {
    const requestedKind = args.kind;
    if (requestedKind && !KINDS.includes(requestedKind))
        throw new ActionArgError('kind must be search, fetch, platform, snapshot, all, or omitted');
    const kind = requestedKind === 'all' ? undefined : requestedKind;
    const records = store.listQueries({
        ...kind ? { kind } : {},
        ...args.query ? { query: args.query } : {},
        ...args.engine ? { engine: args.engine } : {},
        ...args.platform ? { platform: args.platform } : {},
        limit: args.limit ?? 20,
    });
    return records.map(r => ({
        id: r.id,
        kind: r.kind,
        ...r.query ? { query: r.query } : {},
        ...r.engine ? { engine: r.engine } : {},
        ...r.platform ? { platform: r.platform } : {},
        ...r.url ? { url: r.url } : {},
        status: r.status,
        ts: r.ts,
    }));
}
function renderRecords(records) {
    if (!records.length)
        return 'No history records found.';
    return records.map(r => {
        const what = r.query ?? r.url ?? '';
        const via = r.engine ?? r.platform ?? '';
        return '- [' + r.kind + '] ' + r.ts + ' · ' + (r.status === 'ok' ? 'ok' : r.status) + ' · ' + what + (via ? ' (' + via + ')' : '') + (r.id ? ' · id=' + r.id : '');
    }).join('\n');
}
export const HISTORY_ACTIONS = [
    {
        name: 'history.list',
        group: 'history',
        summary: 'List stored search / fetch / platform / snapshot records (newest first) with their ids.',
        params: { ...FILTER_PARAMS },
        output: { type: 'object', additionalProperties: false, properties: { records: { type: 'array', required: true, items: RECORD_SCHEMA } } },
        approval: 'none', mutating: false, concurrencySafe: true,
        timeoutMs: () => 15_000,
        examples: [{ args: { kind: 'search', query: 'sqlite', limit: 5 } }],
        async execute(args, ctx) {
            return { records: listFiltered(args, ctx.store) };
        },
        render: value => renderRecords(value.records),
    },
    {
        name: 'history.replay',
        group: 'history',
        summary: 'Return the saved sources (search/platform) or the saved page (fetch/snapshot) of one history record; page text is capped like read.fetch.',
        params: { id: { type: 'string', required: true, description: 'Record id from history.list.' } },
        output: {
            type: 'object', additionalProperties: false,
            properties: {
                replayedSources: { type: 'array', items: SOURCE_SCHEMA },
                replayedPage: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', required: true }, title: { type: 'string' }, text: { type: 'string' }, htmlPath: { type: 'string' }, screenshotPath: { type: 'string' }, status: { type: 'number' }, fetchedAt: { type: 'string', required: true }, source: { type: 'string' } } },
            },
        },
        approval: 'none', mutating: false, concurrencySafe: true,
        timeoutMs: () => 15_000,
        errors: ['NOT_FOUND'],
        examples: [{ args: { id: 'q_123' } }],
        async execute(args, ctx) {
            const replay = replayHistory(ctx.store, args.id);
            if (replay.sources)
                return { replayedSources: replay.sources };
            const page = replay.page;
            return { replayedPage: { url: page.url, ...page.title ? { title: page.title } : {}, ...page.text ? { text: capText(page.text, ctx.outputCap()) } : {}, ...page.htmlPath ? { htmlPath: page.htmlPath } : {}, ...page.screenshotPath ? { screenshotPath: page.screenshotPath } : {}, ...typeof page.status === 'number' ? { status: page.status } : {}, fetchedAt: page.fetchedAt, ...page.source ? { source: page.source } : {} } };
        },
        render(value) {
            const v = value;
            if (v.replayedSources)
                return 'Replayed sources:\n' + (v.replayedSources.map(s => '- [' + (s.title ?? s.url) + '](' + s.url + ')' + (s.snippet ? ' — ' + s.snippet : '')).join('\n') || 'none');
            const page = v.replayedPage;
            return [
                page.title ? 'Title: ' + page.title : undefined,
                page.text,
                '— Replayed page: ' + page.url + (page.source ? ' · ' + page.source : ''),
                page.htmlPath ? 'HTML: ' + page.htmlPath : undefined,
                page.screenshotPath ? 'Screenshot: ' + page.screenshotPath : undefined,
            ].filter(Boolean).join('\n\n');
        },
    },
    {
        name: 'history.expand',
        group: 'history',
        summary: 'Read an evidence excerpt in context: the stored text of the block behind an evidenceId plus its neighbouring blocks.',
        notes: 'Use it before concluding from a short excerpt, or when a need shows as a gap but the excerpt looks related.',
        params: { evidenceId: { type: 'string', required: true, description: 'Evidence id from an evidence pack.' } },
        output: {
            type: 'object', additionalProperties: false,
            properties: { expanded: { type: 'object', required: true, additionalProperties: false, properties: { evidenceId: { type: 'string', required: true }, url: { type: 'string', required: true }, title: { type: 'string' }, heading: { type: 'string' }, note: { type: 'string' }, blocks: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { blockId: { type: 'string', required: true }, position: { type: 'string', required: true }, text: { type: 'string', required: true }, truncated: { type: 'boolean' } } } } } } },
        },
        approval: 'none', mutating: false, concurrencySafe: true,
        timeoutMs: () => 15_000,
        errors: ['NOT_FOUND'],
        examples: [{ args: { evidenceId: 'e_1' } }],
        async execute(args, ctx) {
            return { expanded: expandEvidence(ctx.store, args.evidenceId) };
        },
        render(value) {
            const expanded = value.expanded;
            const lines = ['Evidence ' + expanded.evidenceId + ' — ' + (expanded.title ? expanded.title + ' — ' : '') + expanded.url + (expanded.heading ? '\n§ ' + expanded.heading : '')];
            for (const b of expanded.blocks)
                lines.push((b.position === 'match' ? '>>> matched block' : '(' + b.position + ' block)') + (b.truncated ? ' [truncated]' : '') + '\n' + b.text);
            if (expanded.note)
                lines.push('Note: ' + expanded.note);
            return lines.join('\n\n');
        },
    },
    {
        name: 'history.export',
        group: 'history',
        summary: 'Write the filtered history (with saved sources and pages) to a JSON file next to the database and return its path.',
        params: { ...FILTER_PARAMS },
        output: { type: 'object', additionalProperties: false, properties: { exportPath: { type: 'string', required: true }, count: { type: 'number' } } },
        approval: 'none', mutating: false, concurrencySafe: true,
        timeoutMs: () => 15_000,
        examples: [{ args: { kind: 'search', limit: 50 } }],
        async execute(args, ctx) {
            const mapped = listFiltered(args, ctx.store);
            const outDir = path.dirname(ctx.config.dbPath);
            fs.mkdirSync(outDir, { recursive: true });
            const exportPath = path.join(outDir, 'history-export-' + Date.now() + '.json');
            const payload = mapped.map(r => {
                const page = ctx.store.pageForQuery(r.id);
                return {
                    ...r,
                    results: ctx.store.resultsForQuery(r.id).map(s => ({ url: s.url, ...s.title ? { title: s.title } : {}, ...s.snippet ? { snippet: s.snippet } : {} })),
                    ...page ? { page } : {},
                };
            });
            fs.writeFileSync(exportPath, JSON.stringify(payload, null, 2), 'utf8');
            return { exportPath, count: mapped.length };
        },
        render: value => 'Exported ' + (value.count ?? 0) + ' record(s) to: ' + value.exportPath,
    },
    {
        name: 'history.delete',
        group: 'history',
        summary: 'Delete one stored query with its results and pages (id from history.list). To purge by age or engine use cache.clear.',
        params: { id: { type: 'string', required: true, description: 'Record id from history.list.' } },
        output: { type: 'object', additionalProperties: false, properties: { removedQueries: { type: 'number', required: true }, removedResults: { type: 'number', required: true }, removedPages: { type: 'number', required: true } } },
        approval: 'local-write', mutating: true, concurrencySafe: false,
        timeoutMs: () => 20_000,
        errors: ['NOT_FOUND'],
        examples: [{ args: { id: 'q_123' } }],
        async execute(args, ctx) {
            const removed = ctx.store.deleteQuery(args.id);
            if (!removed)
                throw new ActionNotFoundError('query id not found: ' + args.id);
            return { removedQueries: removed.queries, removedResults: removed.results, removedPages: removed.pages };
        },
        render: value => removedText(value),
    },
];
export function removedText(v) {
    return 'Removed ' + v.removedQueries + ' queries, ' + v.removedResults + ' result rows, ' + v.removedPages + ' page snapshots.';
}
//# sourceMappingURL=history.js.map