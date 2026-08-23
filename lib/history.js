/** Resolve a history id according to its operation kind. */
export function replayHistory(store, id) {
    const record = store.queryById(id);
    if (!record)
        throw new Error('history query id not found: ' + id);
    if (record.kind === 'search' || record.kind === 'platform') {
        const sources = store.resultsForQuery(id).map(row => ({
            url: row.url,
            ...row.title ? { title: row.title } : {},
            ...row.snippet ? { snippet: row.snippet } : {},
            ...row.published ? { publishedAt: row.published } : {},
        }));
        return { record, sources };
    }
    const page = store.pageForQuery(id);
    if (!page)
        throw new Error('no saved page for ' + record.kind + ' query id ' + id);
    return { record, page };
}
//# sourceMappingURL=history.js.map