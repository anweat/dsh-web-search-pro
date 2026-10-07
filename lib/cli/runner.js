/**
 * The runner of CLI adapter specs (dev-plan M12): spawns the tool without a shell, decodes its output as UTF-8, caps
 * time and size, maps the output to search sources and every failure to a structured error. It never logs or echoes
 * environment values (error text is scrubbed of any value of a variable the spec names) and never runs a login.
 * @module web-search-pro/cli/runner
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { capText, htmlDecode, jsYaml, runCli, stripTags } from "../util.js";
import { EngineError } from "../engine-error.js";
import { searchSpecFor, } from "./spec.js";
/** A structured failure of a CLI adapter: `code` is one of {@link CliErrorCode}; `hint` says what the user can do. */
export class CliAdapterError extends EngineError {
    hint;
    constructor(message, code, hint, retryable = false) {
        super(message, code, retryable);
        this.hint = hint;
        this.name = 'CliAdapterError';
    }
}
/** Variables every tool needs to start and reach the network; nothing else of the process environment is handed over. */
const BASE_ENV = [
    'PATH', 'PATHEXT', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'SYSTEMROOT', 'SystemRoot', 'COMSPEC', 'WINDIR',
    'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME',
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
    'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE', 'NODE_EXTRA_CA_CERTS',
];
/** UTF-8 for Python tools (the Windows console otherwise answers in the system code page; dev issue #28). */
const UTF8_ENV = { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
/** The environment a spec's command runs with: the base set, what the spec lists, and the fixed UTF-8 / `env.set` values. */
export function buildCliEnv(spec, source = process.env) {
    const out = {};
    const take = (name) => { const value = source[name]; if (value !== undefined)
        out[name] = value; };
    for (const name of BASE_ENV)
        take(name);
    for (const name of spec.env.required ?? [])
        take(name);
    for (const name of spec.env.passthrough ?? [])
        take(name);
    return { ...out, ...UTF8_ENV, ...spec.env.set };
}
/** Names of the credential variables a spec relies on that are not set. */
export function missingEnv(spec, source = process.env) {
    return (spec.env.required ?? []).filter(name => !source[name]);
}
/** The home-relative saved-login files of a spec that exist (existence only; the content is never read). */
export function savedLoginPresent(spec, opts = {}) {
    const files = spec.login?.savedCredentialPaths;
    if (!files?.length)
        return undefined;
    const home = opts.home ?? os.homedir();
    const exists = opts.exists ?? ((file) => { try {
        return fs.existsSync(file);
    }
    catch {
        return false;
    } });
    return files.some(file => exists(path.join(home, file.replace(/^~\//, ''))));
}
/** What the user must do to log in: the tool's own command run by them, or the environment variables they set. Never run by the plugin. */
export function loginHint(spec) {
    if (spec.login?.command)
        return 'run `' + spec.login.command + '` yourself' + (spec.env.required?.length ? ' (or set ' + spec.env.required.join(' / ') + ')' : '');
    if (spec.env.required?.length)
        return 'set ' + spec.env.required.join(' / ') + ' in your environment (and run `' + spec.bins[0] + ' login` yourself if the tool has one)';
    return 'run `' + spec.bins[0] + ' login` yourself';
}
// ── output → sources ────────────────────────────────────────────────────────
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export function getPath(root, dotted) {
    let node = root;
    for (const key of dotted.split('.')) {
        if (Array.isArray(node))
            node = node[Number(key)];
        else if (isObject(node))
            node = node[key];
        else
            return undefined;
    }
    return node;
}
function asText(value, empty) {
    if (typeof value === 'string' || typeof value === 'number') {
        const text = String(value).trim();
        return text.length === 0 || empty.has(text) ? undefined : text;
    }
    return undefined;
}
function joinPart(part, item, empty) {
    const p = typeof part === 'string' ? { path: part } : part;
    const text = asText(getPath(item, p.path), empty);
    return text === undefined ? undefined : (p.prefix ?? '') + text + (p.suffix ?? '');
}
function fillTemplate(source, item, empty) {
    if (source.when && getPath(item, source.when.path) !== source.when.equals)
        return undefined;
    let missing = false;
    const text = source.template.replace(/\{([^}]+)\}/g, (_m, p) => { const v = asText(getPath(item, p), empty); if (v === undefined)
        missing = true; return v ?? ''; });
    return missing ? undefined : text;
}
export function resolveField(source, item, empty = new Set()) {
    if (source === undefined)
        return undefined;
    if (typeof source === 'string')
        return asText(getPath(item, source), empty);
    if (Array.isArray(source)) {
        for (const entry of source) {
            const text = typeof entry === 'string' ? asText(getPath(item, entry), empty) : fillTemplate(entry, item, empty);
            if (text !== undefined)
                return text;
        }
        return undefined;
    }
    if ('template' in source)
        return fillTemplate(source, item, empty);
    if ('epoch' in source) {
        const raw = Number(getPath(item, source.epoch));
        const date = Number.isFinite(raw) && raw > 0 ? new Date(raw * 1000) : undefined;
        return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
    }
    if ('date' in source)
        return asText(getPath(item, source.date), empty)?.slice(0, 10);
    const joined = source;
    const parts = joined.join.map(part => joinPart(part, item, empty)).filter((v) => v !== undefined);
    return parts.length ? parts.join(joined.sep ?? ' | ') : undefined;
}
function firstArray(value) {
    if (Array.isArray(value))
        return value;
    if (!isObject(value))
        return undefined;
    for (const entry of Object.values(value))
        if (Array.isArray(entry))
            return entry;
    const data = value.data;
    if (isObject(data))
        for (const entry of Object.values(data))
            if (Array.isArray(entry))
                return entry;
    return undefined;
}
/** The label of a spec in messages (`bili`). */
const labelOf = (spec) => spec.bins[0];
/**
 * Parse a tool's stdout into the items its output spec describes. A broken payload is CLI_CONTRACT_MISMATCH (the tool is not
 * what the spec says); a payload that says it failed (`expect` not met) is CLI_FAILED with the tool's own message.
 */
export function parseCliItems(spec, output, stdout) {
    const label = labelOf(spec);
    const text = stdout.replace(/^﻿/, '');
    if (output.format === 'text') {
        const lines = text.split(/\r?\n/);
        if (output.lines?.mode === 'url-lines') {
            const items = [];
            for (const line of lines) {
                const m = /(https?:\/\/[^\s]+)/.exec(line);
                if (!m)
                    continue;
                const title = stripTags(line).replace(m[1], '').trim();
                if (title)
                    items.push({ url: m[1], title });
            }
            return items;
        }
        const columns = output.lines?.mode === 'tsv' ? output.lines.columns : [];
        return lines.filter(line => line.length > 0).map(line => Object.fromEntries(line.split('\t').map((cell, index) => [columns[index] ?? 'c' + index, cell])));
    }
    let parsed;
    if (output.format === 'ndjson') {
        const rows = [];
        for (const line of text.split(/\r?\n/)) {
            if (!line.trim())
                continue;
            try {
                rows.push(JSON.parse(line));
            }
            catch { /* a progress or log line between records */ }
        }
        if (!rows.length && text.trim())
            throw new CliAdapterError(label + ' output is not valid UTF-8 NDJSON', 'CLI_CONTRACT_MISMATCH', 'the installed ' + label + ' does not match this adapter: check `sources.deps`');
        return rows;
    }
    if (output.format === 'yaml') {
        try {
            parsed = jsYaml.load(text);
        }
        catch {
            throw new CliAdapterError(label + ' output is not valid YAML', 'CLI_CONTRACT_MISMATCH', 'the installed ' + label + ' does not match this adapter: check `sources.deps`');
        }
    }
    else {
        try {
            parsed = JSON.parse(text);
        }
        catch {
            throw new CliAdapterError(label + ' output is not valid UTF-8 JSON', 'CLI_CONTRACT_MISMATCH', 'the installed ' + label + ' does not match this adapter: check `sources.deps`');
        }
    }
    for (const rule of output.expect ?? []) {
        if (getPath(parsed, rule.path) !== rule.equals) {
            const detail = (output.errorPaths ?? []).map(p => asText(getPath(parsed, p), new Set())).find(v => v !== undefined);
            if (detail)
                throw new CliAdapterError(label + ' search failed: ' + capText(detail, 200), 'CLI_FAILED');
            throw new CliAdapterError(label + ' search failed: unexpected response envelope', 'CLI_CONTRACT_MISMATCH', 'the installed ' + label + ' does not match this adapter: check `sources.deps`');
        }
    }
    const items = output.itemsPath !== undefined ? getPath(parsed, output.itemsPath) : firstArray(parsed);
    if (!Array.isArray(items))
        throw new CliAdapterError(label + ' output has no result list' + (output.itemsPath ? ' at ' + output.itemsPath : ''), 'CLI_CONTRACT_MISMATCH', 'the installed ' + label + ' does not match this adapter: check `sources.deps`');
    return items;
}
/** The tool's own error text from a parsed json / yaml payload (`errorPaths`), when it carries one. */
export function payloadError(output, stdout) {
    if (!output.errorPaths?.length || (output.format !== 'json' && output.format !== 'yaml'))
        return undefined;
    try {
        const parsed = output.format === 'json' ? JSON.parse(stdout.replace(/^\uFEFF/, '')) : jsYaml.load(stdout);
        return output.errorPaths.map(p => asText(getPath(parsed, p), new Set())).find(v => v !== undefined);
    }
    catch {
        return undefined;
    }
}
/**
 * Strip markup from a field. Highlight tags (`<em>备案</em>`) vanish without leaving a space (Chinese words must not be split),
 * block-level tags become a space, entities are decoded.
 */
export function stripMarkup(input) {
    return htmlDecode(input.replace(/<\/?(?:p|div|br|li|ul|ol|tr|td|th|h[1-6]|section|article|blockquote)\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}
/**
 * Map parsed items to sources by the output spec: http(s) URLs only, snippets and titles capped, tags stripped when asked.
 * `skipped` counts the items (objects) that had no usable link, so the caller can say so instead of silently returning fewer.
 */
export function mapCliItemsDetailed(output, items, count) {
    const empty = new Set(output.emptyValues ?? []);
    const clean = (text) => (text === undefined ? undefined : output.stripTags ? stripMarkup(text) : text);
    const sources = [];
    let skipped = 0;
    for (const item of items) {
        if (!isObject(item))
            continue;
        const url = resolveField(output.fields.url, item, empty);
        if (!url || !/^https?:\/\//i.test(url)) {
            skipped++;
            continue;
        }
        const rawTitle = clean(resolveField(output.fields.title, item, empty));
        const title = rawTitle ? capText(rawTitle, output.titleMax ?? 300) : undefined;
        if (output.requireTitle && !title)
            continue;
        const snippet = clean(resolveField(output.fields.snippet, item, empty));
        const publishedAt = resolveField(output.fields.publishedAt, item, empty);
        sources.push({
            url,
            ...title ? { title } : {},
            ...snippet ? { snippet: capText(snippet, output.snippetMax ?? 400) } : {},
            ...publishedAt ? { publishedAt } : {},
        });
        if (sources.length >= count)
            break;
    }
    return { sources, skipped };
}
export function mapCliItems(output, items, count) {
    return mapCliItemsDetailed(output, items, count).sources;
}
/** Parse and map in one go (what the fixtures tests call). */
export function parseCliOutput(spec, search, stdout, count = 20) {
    return mapCliItems(search.output, parseCliItems(spec, search.output, stdout), count);
}
// ── argv ────────────────────────────────────────────────────────────────────
/** Fill the placeholders of an argv template. A value that would read as a flag gets a leading space (the tool then takes it as the query). */
export function buildArgv(search, input) {
    const count = Math.min(Math.max(Math.trunc(input.count) || 1, 1), search.maxCount ?? 50);
    const dashdash = (index) => search.argv.slice(0, index).includes('--');
    return search.argv.map((token, index) => {
        const withCount = token.replace(/\{count\}/g, () => String(count));
        if (withCount === '{query}' || withCount === '{url}')
            return input.query.startsWith('-') && !dashdash(index) ? ' ' + input.query : input.query;
        return withCount.replace(/\{(?:query|url)\}/g, () => input.query);
    });
}
function redactor(spec, source) {
    const secrets = [...spec.env.required ?? [], ...spec.env.passthrough ?? []].map(name => source[name]).filter((v) => typeof v === 'string' && v.length >= 6);
    return text => secrets.reduce((acc, secret) => acc.split(secret).join('[redacted]'), text);
}
const includesAny = (text, fragments) => {
    const lower = text.toLowerCase();
    return !!fragments?.some(fragment => lower.includes(fragment.toLowerCase()));
};
/**
 * Run one spec command for a query and return its sources. Throws {@link CliAdapterError} (CLI_NOT_FOUND,
 * CLI_CONTRACT_MISMATCH, CLI_NOT_LOGGED_IN, CLI_FAILED), ENGINE_EMPTY for a valid empty answer, ENGINE_TIMEOUT, or the
 * abort reason when the caller's signal fires. Nothing is run when the spec's credentials are missing.
 */
export async function runCliSearch(spec, input, options = {}) {
    return (await runCliSearchDetailed(spec, input, options)).sources;
}
/** {@link runCliSearch} that also reports how many results had no usable link and were skipped. */
export async function runCliSearchDetailed(spec, input, options = {}) {
    const operation = options.operation ?? 'search';
    const search = operation === 'read' ? spec.read : searchSpecFor(spec, options.platform ?? spec.platforms[0] ?? '');
    const label = labelOf(spec);
    if (!search)
        throw new CliAdapterError(label + ' has no ' + operation + ' command in this adapter', 'CLI_CONTRACT_MISMATCH');
    const source = options.env ?? process.env;
    const redact = redactor(spec, source);
    if (!options.skipCredentialGate) {
        const missing = missingEnv(spec, source);
        if (missing.length)
            throw new CliAdapterError(label + ' is not logged in: ' + missing.join(' / ') + ' not set', 'CLI_NOT_LOGGED_IN', loginHint(spec));
        if (savedLoginPresent(spec, options) === false) {
            throw new CliAdapterError(label + ' has no saved login' + (spec.login?.readsBrowserCookiesWithoutLogin ? ' (it would read your browser cookies by itself, so it is not run)' : ''), 'CLI_NOT_LOGGED_IN', loginHint(spec));
        }
    }
    const argv = buildArgv(search, input);
    const run = options.run ?? runCli;
    const result = await run(options.bin ?? spec.bins[0], argv, {
        timeoutMs: spec.timeoutMs,
        signal: input.signal,
        env: buildCliEnv(spec, source),
        cleanEnv: true,
        maxOutput: spec.maxOutputBytes,
        outputEncoding: 'utf-8',
    });
    if (input.signal?.aborted)
        throw input.signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
    if (result.spawnFailed || (result.code === -1 && !result.timedOut && !result.stderr.trim() && !result.stdout.trim())) {
        throw new CliAdapterError('the ' + label + ' command could not be started: install it (' + spec.packageNote + ')', 'CLI_NOT_FOUND', 'install: ' + spec.packageNote);
    }
    if (result.timedOut)
        throw new EngineError(label + ' timed out after ' + Math.round(spec.timeoutMs / 1000) + 's', 'ENGINE_TIMEOUT', true);
    if (result.truncated)
        throw new CliAdapterError(label + ' output exceeded the ' + spec.maxOutputBytes + ' byte cap', 'CLI_FAILED', 'raise maxOutputBytes of the adapter or ask for fewer results');
    const combined = result.stderr + '\n' + result.stdout;
    const notLoggedIn = () => new CliAdapterError(label + ' is not logged in', 'CLI_NOT_LOGGED_IN', loginHint(spec));
    if (result.code !== 0) {
        if (includesAny(combined, search.notLoggedInPatterns))
            throw notLoggedIn();
        if (includesAny(combined, search.emptyWhen))
            throw new EngineError(label + ' returned no results', 'ENGINE_EMPTY', false);
        throw new CliAdapterError(label + ' ' + operation + ' failed: ' + redact(capText((result.stderr.trim() || result.stdout.trim() || 'exit ' + result.code), 200)), 'CLI_FAILED', undefined, true);
    }
    let sources;
    let skipped = 0;
    try {
        const items = parseCliItems(spec, search.output, result.stdout);
        ({ sources, skipped } = mapCliItemsDetailed(search.output, items, Math.min(Math.max(Math.trunc(input.count) || 1, 1), search.maxCount ?? input.count)));
    }
    catch (error) {
        if (error instanceof CliAdapterError && error.code === 'CLI_FAILED' && includesAny(combined, search.notLoggedInPatterns))
            throw notLoggedIn();
        if (error instanceof CliAdapterError)
            throw new CliAdapterError(redact(error.message), error.code, error.hint, error.retryable);
        throw error;
    }
    if (!sources.length) {
        if (includesAny(combined, search.notLoggedInPatterns))
            throw notLoggedIn();
        if (includesAny(combined, search.emptyWhen))
            throw new EngineError(label + ' returned no results', 'ENGINE_EMPTY', false);
        // A payload that carries the tool's own error list (omnireach `errors`) and no results is a failure, not an empty answer.
        const detail = payloadError(search.output, result.stdout);
        if (detail)
            throw new CliAdapterError(label + ' ' + operation + ' failed: ' + redact(capText(detail, 200)), 'CLI_FAILED', undefined, true);
        throw new EngineError(label + ' returned no results', 'ENGINE_EMPTY', false);
    }
    return { sources, skipped };
}
//# sourceMappingURL=runner.js.map