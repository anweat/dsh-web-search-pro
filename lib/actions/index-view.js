/**
 * The progressive-disclosure views behind `web_index`.
 *
 * L1 is the group list (root) and one group's actions; L2 is one action's full
 * schema. Actions that cannot run right now (read.snapshot without dsh-browser)
 * collapse into one line with the reason.
 * @module web-search-pro/actions/index-view
 */
import { ACTIONS, CALL_TOOL, GROUP_SUMMARIES, INDEX_TOOL, actionsInGroup, findAction, isActionGroup, similarActions } from "./registry.js";
import { ACTION_GROUPS } from "./types.js";
import { compactParams, describeParams } from "./schema.js";
import { isLegacyToolName, legacyLine, mapLegacyCall } from "./legacy.js";
export const SKILL_NAME = 'dsh-web-search-pro';
/** The fallback guide shown at the root when no skill service is present (kept under ~300 tokens). */
export const COMPACT_GUIDE = [
    'Guide: (1) Research: search.run with task (one sentence) + profile (docs_code, news_fact, academic, experience, compare, general) returns an evidence pack of only the passages that answer your needs, plus gaps.',
    '(2) Coverage is heuristic: read gaps; expand an excerpt with history.expand {evidenceId} or read.fetch {url} before concluding something is absent.',
    '(3) Use 1-2 sources: search.recommend {task} names them (search.run engines=<id>); never query every source. Add constraints (JSON) for must-have terms, sites, versions, time windows.',
    '(4) Long pages: read.fetch continues with offset=nextOffset. Rendering or login pages need the dsh-browser plugin (read.snapshot, search.run platform=...).',
    '(5) Errors carry code+hint; INVALID_ARGS includes the schema. cache.clear, history.delete, rules.upsert|remove|import and sources.install ask the user first.',
].join('\n');
const MAX_LINE = 170;
function approvalNote(action) {
    const notes = { none: '', install: 'asks', 'local-write': 'asks' };
    return notes[action.approval];
}
function line(action) {
    const note = approvalNote(action);
    const params = compactParams(action.params);
    const head = `${action.name} - ${action.summary}`;
    const tail = ` | ${params || 'no args'}${note ? ` | ${note}` : ''}`;
    const text = head + tail;
    return text.length > MAX_LINE * 3 ? text.slice(0, MAX_LINE * 3 - 1) + '…' : text;
}
function split(actions, env) {
    const usable = [];
    const blocked = [];
    for (const action of actions) {
        const reason = action.unavailable?.(env);
        if (reason)
            blocked.push({ action, reason });
        else
            usable.push(action);
    }
    return { usable, blocked };
}
function blockedLine(blocked) {
    if (!blocked.length)
        return undefined;
    const reasons = [...new Set(blocked.map(entry => entry.reason))].join('; ');
    return `Unavailable (${reasons}): ${blocked.map(entry => entry.action.name).join(', ')}`;
}
export function renderRoot(env) {
    const { usable, blocked } = split(ACTIONS, env);
    const lines = [
        `dsh-web-search-pro: run actions with ${CALL_TOOL}({action, args}); ${INDEX_TOOL}({group}) lists a group, ${INDEX_TOOL}({action}) gives one action's schema, ${INDEX_TOOL}({query}) searches.`,
        'Groups:',
    ];
    for (const group of ACTION_GROUPS) {
        const count = usable.filter(action => action.group === group).length;
        if (count === 0)
            continue;
        lines.push(`  ${group} (${count}) ${GROUP_SUMMARIES[group]}: ${usable.filter(action => action.group === group).map(action => action.name.split('.')[1]).join('|')}`);
    }
    lines.push('Everyday calls (no schema lookup needed):', `  ${CALL_TOOL}({action:"search.run",args:{query:"...",task:"one-sentence goal",profile:"docs_code"}})  // evidence pack; omit task/profile for a plain list`, `  ${CALL_TOOL}({action:"read.fetch",args:{url:"https://...",offset:20000}})  // offset only to continue a truncated page`);
    lines.push('Old tool names no longer exist: ' + legacyLine() + '.');
    const note = blockedLine(blocked);
    if (note)
        lines.push(note);
    lines.push(env.skillAvailable ? `Load skill "${SKILL_NAME}" for evidence-mode, source-selection and failure guidance.` : COMPACT_GUIDE);
    return lines.join('\n');
}
export function renderGroup(group, env) {
    if (!isActionGroup(group))
        return `Unknown group "${group}". Groups: ${ACTION_GROUPS.join(', ')}.`;
    const { usable, blocked } = split(actionsInGroup(group), env);
    const lines = [`${group} - ${GROUP_SUMMARIES[group]}`, ...usable.map(line)];
    const note = blockedLine(blocked);
    if (note)
        lines.push(note);
    return lines.join('\n');
}
function exampleLines(action) {
    return (action.examples ?? []).slice(0, 3).map(example => `example: ${CALL_TOOL}(${JSON.stringify({ action: action.name, args: example.args })})${example.note ? ` // ${example.note}` : ''}`);
}
export function renderAction(name, env) {
    const action = findAction(name);
    if (!action) {
        if (isLegacyToolName(name)) {
            const mapped = mapLegacyCall(name);
            return `${name} is an old tool name (gone). It is now ${mapped.action}: ${INDEX_TOOL}({action:"${mapped.action}"}). Old names: ${legacyLine()}.`;
        }
        if (isActionGroup(name))
            return renderGroup(name, env);
        const hits = [...new Set([...searchActions(name, env).map(hit => hit.name), ...similarActions(name)])].slice(0, 5);
        return `Unknown action "${name}".${hits.length ? ' Similar: ' + hits.join(', ') + '.' : ''} ${INDEX_TOOL}() lists the groups.`;
    }
    const reason = action.unavailable?.(env);
    const note = approvalNote(action);
    const lines = [
        `${action.name} - ${action.summary}`,
        `group ${action.group} | ${action.mutating ? 'changes stored data or the machine' : 'read-only'} | ${action.concurrencySafe ? 'may run in parallel with other calls' : 'runs alone'} | ${reason ? `UNAVAILABLE: ${reason}` : note ? `approval: ${note}` : 'no approval needed'}`,
        ...action.notes ? [action.notes] : [],
        'args:',
        ...describeParams(action.params),
        ...exampleLines(action),
        `errors: INVALID_ARGS, DEADLINE, CANCELLED${action.errors?.length ? ', ' + action.errors.join(', ') : ''}${action.mutating ? ' (a DEADLINE on this action means the outcome is unknown: verify before retrying)' : ''}`,
    ];
    return lines.join('\n');
}
function score(action, terms) {
    const name = action.name.toLowerCase();
    const summary = (action.summary + ' ' + (action.notes ?? '')).toLowerCase();
    const params = Object.keys(action.params).join(' ').toLowerCase();
    let total = 0;
    for (const term of terms) {
        if (name === term)
            total += 10;
        else if (name.includes(term))
            total += 5;
        if (summary.includes(term))
            total += 2;
        if (action.group === term)
            total += 3;
        if (params.includes(term))
            total += 1;
    }
    return total;
}
export function searchActions(query, env) {
    const terms = query.toLowerCase().split(/[^a-z0-9_.]+/).filter(Boolean);
    if (!terms.length)
        return [];
    const { usable } = split(ACTIONS, env);
    return usable.map(action => ({ action, score: score(action, terms) })).filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.action.name.localeCompare(b.action.name)).slice(0, 8).map(entry => entry.action);
}
export function renderSearch(query, env) {
    const hits = searchActions(query, env);
    if (!hits.length)
        return `No usable action matches "${query}". ${INDEX_TOOL}() lists the groups.`;
    return [`${hits.length} match${hits.length === 1 ? '' : 'es'} for "${query}":`, ...hits.map(line)].join('\n');
}
/** Resolve a `web_index` call to text. `action` wins over `group`, which wins over `query`. */
export function renderIndex(args, env) {
    if (args.action)
        return { level: 'action', text: renderAction(args.action, env) };
    if (args.group)
        return { level: 'group', text: renderGroup(args.group, env) };
    if (args.query) {
        // A query that is an old tool name answers with where it went.
        if (isLegacyToolName(args.query.trim()))
            return { level: 'search', text: renderAction(args.query.trim(), env) };
        return { level: 'search', text: renderSearch(args.query, env) };
    }
    return { level: 'root', text: renderRoot(env) };
}
//# sourceMappingURL=index-view.js.map