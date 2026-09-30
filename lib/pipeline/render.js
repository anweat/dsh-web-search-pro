/**
 * Text rendering of an EvidencePack for the model (tool output `render`) and
 * for size accounting in the offline eval. Compact on purpose: one card per
 * excerpt, gaps in one line, remaining sources as bare links.
 * @module web-search-pro/pipeline/render
 */
const hostOf = (url) => { try {
    return new URL(url).hostname;
}
catch {
    return url;
} };
/** One line under the header (dev-plan M3b): "covered" is a lexical judgement, and a missing passage proves nothing. */
export const COVERAGE_CAVEAT = 'Coverage is heuristic: no evidence here does not mean it does not exist; fetch/expand before concluding.';
export function renderEvidencePack(pack, sources, engineLine) {
    const parts = [];
    const covered = new Set(pack.coveredNeeds);
    parts.push('Evidence pack ' + pack.resultId + ' (' + pack.profile + (pack.partial ? ', PARTIAL: deadline reached' : '') + '): ' + pack.evidence.length + ' excerpt(s); needs covered ' + pack.coveredNeeds.length + '/' + pack.needs.length + '.\n' + COVERAGE_CAVEAT);
    if (pack.evidence.length) {
        parts.push(pack.evidence.map((e, i) => {
            const lines = ['[' + (i + 1) + '] ' + e.evidenceId + ' — ' + (e.title ? e.title + ' — ' : '') + e.url + (e.publishedAt ? ' (' + e.publishedAt + ')' : '')];
            if (e.heading)
                lines.push('    § ' + e.heading);
            lines.push('    ' + e.excerpt.replace(/\n+/g, '\n    '));
            lines.push('    needs ' + e.needIds.join(',') + ' · grade ' + e.grade + (e.source ? ' · via ' + e.source : ''));
            return lines.join('\n');
        }).join('\n\n'));
    }
    else {
        parts.push('No evidence excerpt reached the required support level.');
    }
    parts.push('Needs: ' + pack.needs.map(n => n.id + ' "' + n.text + '"' + (covered.has(n.id) ? ' ✓' : ' ✗')).join('; '));
    if (pack.gaps.length) {
        parts.push('Gaps: ' + pack.gaps.map(g => g.needId + ' ' + g.reason + (g.bestGrade !== undefined ? ' (best grade ' + g.bestGrade + ')' : '') + (g.critical ? '' : ' [optional]')).join('; ')
            + '. Fetch a listed source with web_fetch_pro, or search again with a different query.');
    }
    const shown = new Set(pack.evidence.map(e => e.url));
    const others = sources.filter(s => !shown.has(s.url));
    if (others.length)
        parts.push('Other sources:\n' + others.map(s => '- [' + (s.title || hostOf(s.url)) + '](' + s.url + ')' + (s.publishedAt ? ' (' + s.publishedAt + ')' : '')).join('\n'));
    const v = pack.verification;
    if (v.native.length || v.local.length)
        parts.push('Constraints — enforced by the search provider: ' + (v.native.join(', ') || 'none') + '; checked locally only: ' + (v.local.join(', ') || 'none') + '.');
    parts.push(engineLine + (pack.notes.length ? '\nNotes: ' + pack.notes.join(' | ') : ''));
    if (pack.evidence.length)
        parts.push('To read around an excerpt: web_history action=expand evidenceId=<id>.');
    return parts.join('\n\n');
}
//# sourceMappingURL=render.js.map