/**
 * Declarative CLI adapter spec (dev-plan M12): what a standalone command-line tool is, which of its commands the plugin
 * may run, and how its output maps to search sources. Pure data plus validation, no Node imports, so the settings card
 * (client bundle) validates `cliAdapters` with the very function the server uses.
 *
 * The read-only guarantee lives here and applies to built-in and user-defined specs alike:
 *  - argv is an array of tokens, never a shell string (the runner spawns without a shell);
 *  - a spec declares `allowedSubcommands`, and every command word its argv uses (the leading literal tokens before the
 *    first flag or placeholder) must be in that list;
 *  - no command word, declared subcommand or flag may match the global deny-list (login, post, delete*, like, ...,
 *    and the flags that make a CLI read browser cookies or carry secrets in argv).
 * @module web-search-pro/cli/spec
 */
export const OUTPUT_FORMATS = ['json', 'ndjson', 'yaml', 'text'];
/** How far a spec has been checked against the real tool (recorded in the spec and shown in `sources.status`). */
export const CLI_VERIFICATIONS = ['live', 'contract-only', 'docs-only'];
export const CLI_ERROR_CODES = ['CLI_NOT_FOUND', 'CLI_CONTRACT_MISMATCH', 'CLI_NOT_LOGGED_IN', 'ENGINE_EMPTY', 'CLI_FAILED'];
// ── the read-only guard ─────────────────────────────────────────────────────
/** Command words that write, log in, or change local or remote state. Matched exactly, or as `<word>-...` / `<word>_...`. */
export const DENIED_SUBCOMMANDS = [
    'login', 'logout', 'signin', 'signout', 'sign-in', 'sign-out', 'auth', 'whoami-login',
    'post', 'comment', 'reply', 'publish', 'ask', 'article', 'pin', 'draft', 'upload', 'send', 'create', 'edit', 'write', 'add',
    'like', 'unlike', 'dislike', 'upvote', 'downvote', 'vote', 'follow', 'unfollow', 'subscribe', 'unsubscribe', 'favorite', 'unfavorite', 'bookmark', 'unbookmark', 'save', 'unsave',
    'retweet', 'unretweet', 'quote', 'share', 'block', 'unblock', 'mute', 'accept', 'forward',
    'setup', 'init', 'install', 'uninstall', 'update', 'upgrade', 'config', 'configure', 'register', 'set', 'import', 'export', 'bridge', 'daemon', 'plugin', 'adapter', 'external', 'profile', 'mcp', 'serve',
];
/** Command words denied by prefix alone (`delete`, `delete-note`, `deleteNote`, `remove...`). */
export const DENIED_PREFIXES = ['delete', 'remove', 'destroy', 'drop', 'purge', 'revoke'];
/** Flags (without leading dashes) that read browser cookies or carry credentials in argv. */
export const DENIED_FLAGS = [
    'cookie-source', 'cookie', 'cookies', 'cookies-from-browser', 'browser-cookies', 'from-browser', 'browser',
    'password', 'passwd', 'secret', 'token', 'access-token', 'auth-token', 'api-key', 'apikey', 'key', 'username', 'user-token', 'ap-password', 'netrc', 'client-secret', 'authorization', 'auth',
];
function matchesDeniedSubcommand(word) {
    const w = word.toLowerCase();
    if (DENIED_PREFIXES.some(prefix => w.startsWith(prefix)))
        return true;
    return DENIED_SUBCOMMANDS.some(denied => w === denied || w.startsWith(denied + '-') || w.startsWith(denied + '_'));
}
const flagName = (token) => token.replace(/^-+/, '').split('=')[0].toLowerCase();
const isFlag = (token) => token.startsWith('-') && token.length > 1;
const hasPlaceholder = (token) => /\{[A-Za-z0-9_.]+\}/.test(token);
/** The command words of an argv: leading literal tokens before the first flag or placeholder token. */
export function commandWords(argv) {
    const words = [];
    for (const token of argv) {
        if (isFlag(token) || hasPlaceholder(token))
            break;
        words.push(token);
    }
    return words;
}
/** Problems of one argv template with respect to the read-only guard (empty = fine). */
export function argvProblems(argv, allowed, where) {
    const problems = [];
    for (const word of commandWords(argv)) {
        if (matchesDeniedSubcommand(word))
            problems.push(where + ': "' + word + '" is a write / login command (read-only guard)');
        else if (!allowed.includes(word))
            problems.push(where + ': command word "' + word + '" is not in allowedSubcommands');
    }
    for (const token of argv) {
        if (isFlag(token) && DENIED_FLAGS.includes(flagName(token)))
            problems.push(where + ': flag "' + token + '" reads cookies or carries credentials (read-only guard)');
    }
    return problems;
}
// ── validation ──────────────────────────────────────────────────────────────
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;
const strList = (v, maxItems, maxLen = 200) => Array.isArray(v) && v.length <= maxItems && v.every(x => isStr(x, maxLen));
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const BIN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const PATH_RE = /^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/;
const VERSION_RE = /^\d+(\.\d+){0,3}$/;
const PLACEHOLDERS = new Set(['query', 'count', 'url']);
const MAX_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const SPEC_KEYS = new Set(['id', 'bins', 'packageNote', 'platforms', 'probe', 'allowedSubcommands', 'search', 'searches', 'read', 'env', 'needsLogin', 'login', 'timeoutMs', 'maxOutputBytes', 'verification']);
const PROBE_KEYS = new Set(['versionArgs', 'minVersion', 'helpArgs', 'mustContain']);
const SEARCH_KEYS = new Set(['argv', 'maxCount', 'output', 'emptyWhen', 'notLoggedInPatterns']);
const OUTPUT_KEYS = new Set(['format', 'itemsPath', 'expect', 'errorPaths', 'lines', 'fields', 'stripTags', 'emptyValues', 'snippetMax', 'titleMax', 'requireTitle']);
const FIELD_KEYS = new Set(['url', 'title', 'snippet', 'publishedAt']);
const ENV_KEYS = new Set(['required', 'passthrough', 'set']);
const LOGIN_KEYS = new Set(['command', 'savedCredentialPaths', 'readsBrowserCookiesWithoutLogin']);
function closed(obj, keys, where, errors) {
    for (const key of Object.keys(obj))
        if (!keys.has(key))
            errors.push(where + '.' + key + ' is not a spec field');
}
function templateProblems(text, where, allowedPlaceholders, errors) {
    for (const match of text.matchAll(/\{([^}]*)\}/g)) {
        const name = match[1];
        if (allowedPlaceholders ? !allowedPlaceholders.has(name) : !PATH_RE.test(name))
            errors.push(where + ': unknown placeholder {' + name + '}');
    }
    if (/\{[^}]*$/.test(text) || /^[^{]*\}/.test(text))
        errors.push(where + ': unbalanced brace');
}
function checkFieldSource(value, where, errors) {
    if (typeof value === 'string') {
        if (!PATH_RE.test(value))
            errors.push(where + ': "' + value + '" is not a dotted path');
        return;
    }
    if (Array.isArray(value)) {
        if (!value.length || value.length > 12)
            errors.push(where + ': a source list needs 1..12 entries');
        for (const entry of value) {
            if (typeof entry === 'string') {
                if (!PATH_RE.test(entry))
                    errors.push(where + ': "' + entry + '" is not a dotted path');
            }
            else if (isObject(entry) && typeof entry.template === 'string')
                checkFieldSource(entry, where, errors);
            else
                errors.push(where + ': list entries are paths or { template, when? }');
        }
        return;
    }
    if (!isObject(value)) {
        errors.push(where + ' must be a path, a list, { template }, { join }, { epoch } or { date }');
        return;
    }
    const keys = Object.keys(value);
    if (keys.length === 1 && (keys[0] === 'epoch' || keys[0] === 'date')) {
        if (typeof value[keys[0]] !== 'string' || !PATH_RE.test(value[keys[0]]))
            errors.push(where + '.' + keys[0] + ' must be a dotted path');
        return;
    }
    if (keys.every(k => k === 'template' || k === 'when') && 'template' in value) {
        if (!isStr(value.template, 300))
            errors.push(where + '.template must be a string');
        else
            templateProblems(value.template, where + '.template', undefined, errors);
        if (value.when !== undefined) {
            const w = value.when;
            if (!(isObject(w) && typeof w.path === 'string' && PATH_RE.test(w.path) && ['string', 'number', 'boolean'].includes(typeof w.equals) && Object.keys(w).every(k => k === 'path' || k === 'equals')))
                errors.push(where + '.when must be { path, equals }');
        }
        return;
    }
    if (keys.every(k => k === 'join' || k === 'sep') && Array.isArray(value.join)) {
        if (!value.join.length || value.join.length > 8)
            errors.push(where + '.join needs 1..8 parts');
        for (const part of value.join) {
            if (typeof part === 'string') {
                if (!PATH_RE.test(part))
                    errors.push(where + '.join: "' + part + '" is not a dotted path');
            }
            else if (isObject(part) && typeof part.path === 'string' && PATH_RE.test(part.path) && Object.keys(part).every(k => ['path', 'prefix', 'suffix'].includes(k))) {
                for (const k of ['prefix', 'suffix'])
                    if (part[k] !== undefined && !(typeof part[k] === 'string' && part[k].length <= 40))
                        errors.push(where + '.join.' + k + ' must be a short string');
            }
            else
                errors.push(where + '.join: each part is a path or { path, prefix?, suffix? }');
        }
        if (value.sep !== undefined && !(typeof value.sep === 'string' && value.sep.length <= 16))
            errors.push(where + '.sep must be a short string');
        return;
    }
    errors.push(where + ' must be a path, a list, { template }, { join }, { epoch } or { date }');
}
function checkOutput(value, where, errors) {
    if (!isObject(value)) {
        errors.push(where + ' must be an object');
        return;
    }
    closed(value, OUTPUT_KEYS, where, errors);
    if (!OUTPUT_FORMATS.includes(value.format))
        errors.push(where + '.format must be one of ' + OUTPUT_FORMATS.join('|'));
    if (value.itemsPath !== undefined && !(typeof value.itemsPath === 'string' && PATH_RE.test(value.itemsPath)))
        errors.push(where + '.itemsPath must be a dotted path');
    if (value.expect !== undefined) {
        if (!Array.isArray(value.expect) || value.expect.length > 8)
            errors.push(where + '.expect must be a list of { path, equals }');
        else
            for (const e of value.expect) {
                if (!(isObject(e) && typeof e.path === 'string' && PATH_RE.test(e.path) && ['string', 'number', 'boolean'].includes(typeof e.equals) && Object.keys(e).every(k => k === 'path' || k === 'equals')))
                    errors.push(where + '.expect entries are { path, equals }');
            }
    }
    if (value.errorPaths !== undefined && !(Array.isArray(value.errorPaths) && value.errorPaths.length <= 6 && value.errorPaths.every(p => typeof p === 'string' && PATH_RE.test(p))))
        errors.push(where + '.errorPaths must be dotted paths');
    if (value.lines !== undefined) {
        const l = value.lines;
        if (isObject(l) && l.mode === 'url-lines' && Object.keys(l).length === 1) { /* fine */ }
        else if (isObject(l) && l.mode === 'tsv' && strList(l.columns, 24, 40) && l.columns.length >= 2 && l.columns.every(c => /^[A-Za-z0-9_]+$/.test(c)) && Object.keys(l).every(k => k === 'mode' || k === 'columns')) { /* fine */ }
        else
            errors.push(where + '.lines must be { mode: "url-lines" } or { mode: "tsv", columns: [...] }');
    }
    if (value.format === 'text' && value.lines === undefined)
        errors.push(where + '.lines is required for format text');
    if (value.format !== 'text' && value.lines !== undefined)
        errors.push(where + '.lines is only for format text');
    if (!isObject(value.fields))
        errors.push(where + '.fields must be an object');
    else {
        closed(value.fields, FIELD_KEYS, where + '.fields', errors);
        if (value.fields.url === undefined)
            errors.push(where + '.fields.url is required');
        for (const key of Object.keys(value.fields))
            if (FIELD_KEYS.has(key))
                checkFieldSource(value.fields[key], where + '.fields.' + key, errors);
    }
    if (value.stripTags !== undefined && typeof value.stripTags !== 'boolean')
        errors.push(where + '.stripTags must be a boolean');
    if (value.emptyValues !== undefined && !strList(value.emptyValues, 8, 20))
        errors.push(where + '.emptyValues must be short strings');
    for (const key of ['snippetMax', 'titleMax'])
        if (value[key] !== undefined && !(Number.isInteger(value[key]) && value[key] >= 40 && value[key] <= 2000))
            errors.push(where + '.' + key + ' must be an integer 40..2000');
    if (value.requireTitle !== undefined && typeof value.requireTitle !== 'boolean')
        errors.push(where + '.requireTitle must be a boolean');
}
function checkSearch(value, where, allowed, errors) {
    if (!isObject(value)) {
        errors.push(where + ' must be an object');
        return;
    }
    closed(value, SEARCH_KEYS, where, errors);
    if (!Array.isArray(value.argv) || !value.argv.length || value.argv.length > 24 || !value.argv.every(t => typeof t === 'string' && t.length > 0 && t.length <= 200)) {
        errors.push(where + '.argv must be an array of 1..24 non-empty strings (never a shell string)');
    }
    else {
        const argv = value.argv;
        argv.forEach(token => templateProblems(token, where + '.argv', PLACEHOLDERS, errors));
        if (!argv.some(t => /\{(query|url)\}/.test(t)))
            errors.push(where + '.argv must carry a {query} (or {url}) placeholder');
        errors.push(...argvProblems(argv, allowed, where + '.argv'));
    }
    if (value.maxCount !== undefined && !(Number.isInteger(value.maxCount) && value.maxCount >= 1 && value.maxCount <= 100))
        errors.push(where + '.maxCount must be an integer 1..100');
    checkOutput(value.output, where + '.output', errors);
    for (const key of ['emptyWhen', 'notLoggedInPatterns'])
        if (value[key] !== undefined && !strList(value[key], 12, 120))
            errors.push(where + '.' + key + ' must be a list of short strings');
}
/**
 * Validate one adapter spec (built-in or user-defined). Never throws. A user-defined spec (`origin: 'user'`) may not carry a
 * `verification` (it is unverified by definition) and its `platforms` are ignored: it is registered as `custom-cli:<id>`.
 */
export function validateCliAdapterSpec(raw, origin = 'user') {
    const errors = [];
    if (!isObject(raw))
        return { ok: false, errors: ['spec must be an object'] };
    const id = typeof raw.id === 'string' ? raw.id : '(no id)';
    const at = 'cliAdapters.' + id;
    closed(raw, SPEC_KEYS, at, errors);
    if (typeof raw.id !== 'string' || !ID_RE.test(raw.id))
        errors.push(at + '.id must match ' + String(ID_RE));
    if (!Array.isArray(raw.bins) || !raw.bins.length || raw.bins.length > 4 || !raw.bins.every(b => typeof b === 'string' && BIN_RE.test(b)))
        errors.push(at + '.bins must be 1..4 command names (no paths)');
    if (!isStr(raw.packageNote, 240))
        errors.push(at + '.packageNote must be a short string (what the package is called, which can differ from the command)');
    if (!strList(raw.platforms, 8, 40) || !raw.platforms.length)
        errors.push(at + '.platforms must list 1..8 platform ids');
    if (typeof raw.needsLogin !== 'boolean')
        errors.push(at + '.needsLogin must be a boolean');
    if (!(Number.isInteger(raw.timeoutMs) && raw.timeoutMs >= 1_000 && raw.timeoutMs <= MAX_TIMEOUT_MS))
        errors.push(at + '.timeoutMs must be an integer 1000..' + MAX_TIMEOUT_MS);
    if (!(Number.isInteger(raw.maxOutputBytes) && raw.maxOutputBytes >= 1_024 && raw.maxOutputBytes <= MAX_OUTPUT_BYTES))
        errors.push(at + '.maxOutputBytes must be an integer 1024..' + MAX_OUTPUT_BYTES);
    const allowed = strList(raw.allowedSubcommands, 12, 60) ? raw.allowedSubcommands : undefined;
    if (!allowed)
        errors.push(at + '.allowedSubcommands must list the command words the spec uses (up to 12; empty for a tool without subcommands)');
    else
        for (const word of allowed)
            if (matchesDeniedSubcommand(word))
                errors.push(at + '.allowedSubcommands: "' + word + '" is a write / login command (read-only guard)');
    if (!isObject(raw.probe))
        errors.push(at + '.probe must be an object');
    else {
        const p = raw.probe;
        closed(p, PROBE_KEYS, at + '.probe', errors);
        for (const key of ['versionArgs', 'helpArgs']) {
            if (!Array.isArray(p[key]) || !p[key].every(t => typeof t === 'string' && t.length > 0 && t.length <= 80) || p[key].length > 6)
                errors.push(at + '.probe.' + key + ' must be an array of short strings');
            else if (allowed)
                errors.push(...argvProblems(p[key], allowed, at + '.probe.' + key));
        }
        if (!(Array.isArray(p.helpArgs) && p.helpArgs.length))
            errors.push(at + '.probe.helpArgs must not be empty');
        if (p.minVersion !== undefined && !(typeof p.minVersion === 'string' && VERSION_RE.test(p.minVersion)))
            errors.push(at + '.probe.minVersion must look like 1.2.3');
        if (!strList(p.mustContain, 12, 80))
            errors.push(at + '.probe.mustContain must be a list of short strings (the subcommands / flags that prove the contract)');
    }
    const searchWhere = (key) => at + '.' + key;
    if (allowed) {
        checkSearch(raw.search, searchWhere('search'), allowed, errors);
        if (raw.searches !== undefined) {
            if (!isObject(raw.searches))
                errors.push(at + '.searches must be an object keyed by platform id');
            else
                for (const [platform, s] of Object.entries(raw.searches)) {
                    if (!ID_RE.test(platform))
                        errors.push(at + '.searches: "' + platform + '" is not a platform id');
                    checkSearch(s, at + '.searches.' + platform, allowed, errors);
                }
        }
        if (raw.read !== undefined)
            checkSearch(raw.read, searchWhere('read'), allowed, errors);
    }
    if (!isObject(raw.env))
        errors.push(at + '.env must be an object');
    else {
        closed(raw.env, ENV_KEYS, at + '.env', errors);
        for (const key of ['required', 'passthrough']) {
            const list = raw.env[key];
            if (list !== undefined && !(Array.isArray(list) && list.length <= 16 && list.every(n => typeof n === 'string' && ENV_RE.test(n))))
                errors.push(at + '.env.' + key + ' must be environment variable NAMES (never values)');
        }
        if (raw.env.set !== undefined) {
            const set = raw.env.set;
            if (!isObject(set) || Object.keys(set).length > 8 || !Object.entries(set).every(([k, val]) => ENV_RE.test(k) && typeof val === 'string' && val.length <= 80))
                errors.push(at + '.env.set must be a few NAME: short literal pairs');
            else if (Object.keys(set).some(k => /key|token|secret|password|cookie/i.test(k)))
                errors.push(at + '.env.set must not set credentials: name them in env.required / env.passthrough and keep the value in your environment');
        }
    }
    if (raw.login !== undefined) {
        const l = raw.login;
        if (!isObject(l))
            errors.push(at + '.login must be an object');
        else {
            closed(l, LOGIN_KEYS, at + '.login', errors);
            if (!isStr(l.command, 120))
                errors.push(at + '.login.command must be a short string (what the user runs themselves)');
            if (l.savedCredentialPaths !== undefined && !(strList(l.savedCredentialPaths, 4, 160) && l.savedCredentialPaths.every(p => /^~\/[^\0]+$/.test(p) && !p.includes('..'))))
                errors.push(at + '.login.savedCredentialPaths must be paths starting with ~/ (no ..)');
            if (l.readsBrowserCookiesWithoutLogin !== undefined && typeof l.readsBrowserCookiesWithoutLogin !== 'boolean')
                errors.push(at + '.login.readsBrowserCookiesWithoutLogin must be a boolean');
            if (l.readsBrowserCookiesWithoutLogin === true && !(Array.isArray(l.savedCredentialPaths) && l.savedCredentialPaths.length))
                errors.push(at + '.login: a tool that reads browser cookies without a login needs savedCredentialPaths, so the plugin can refuse to run it without one');
        }
    }
    if (raw.needsLogin === true && !isObject(raw.login) && !(isObject(raw.env) && Array.isArray(raw.env.required) && raw.env.required.length))
        errors.push(at + ': needsLogin without login.command or env.required gives the user nothing to run');
    if (raw.verification !== undefined) {
        const v = raw.verification;
        if (origin === 'user')
            errors.push(at + '.verification is for built-in specs only');
        else if (!(isObject(v) && CLI_VERIFICATIONS.includes(v.status) && Object.keys(v).every(k => ['status', 'version', 'date', 'note'].includes(k))))
            errors.push(at + '.verification must be { status, version?, date?, note? }');
        else if (v.status === 'live' && !(isStr(v.version, 40) && typeof v.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.date)))
            errors.push(at + '.verification: live needs the verified version and a YYYY-MM-DD date');
    }
    if (errors.length)
        return { ok: false, errors };
    const spec = raw;
    // Every platform the spec lists has a search command.
    return { ok: true, errors: [], spec };
}
/** Validate the `cliAdapters` setting: the valid specs by id and the problems of the rest (an invalid entry is ignored, never fatal). */
export function resolveCliAdapters(input) {
    const specs = new Map();
    const diagnostics = [];
    if (input === undefined || input === null)
        return { specs, diagnostics };
    if (!isObject(input))
        return { specs, diagnostics: ['cliAdapters must be an object keyed by adapter id'] };
    for (const [key, raw] of Object.entries(input)) {
        if (isObject(raw) && raw.id !== undefined && raw.id !== key) {
            diagnostics.push('cliAdapters.' + key + ' ignored: its id "' + String(raw.id) + '" must equal its key');
            continue;
        }
        const result = validateCliAdapterSpec(isObject(raw) ? { ...raw, id: key } : raw, 'user');
        if (!result.ok) {
            diagnostics.push('cliAdapters.' + key + ' ignored: ' + result.errors.slice(0, 4).join('; ') + (result.errors.length > 4 ? ' (+' + (result.errors.length - 4) + ' more)' : ''));
            continue;
        }
        specs.set(key, result.spec);
    }
    return { specs, diagnostics };
}
/** Search spec of one platform: the platform's override, else the default. */
export function searchSpecFor(spec, platform) {
    return spec.searches?.[platform] ?? spec.search;
}
// ── versions ────────────────────────────────────────────────────────────────
export function compareVersions(left, right) {
    const a = left.split('.').map(Number);
    const b = right.split('.').map(Number);
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
        const delta = (a[index] ?? 0) - (b[index] ?? 0);
        if (delta !== 0)
            return delta;
    }
    return 0;
}
/** The first `X.Y.Z` (or `X.Y`) in a tool's version output. */
export function parseVersion(output) {
    return /\b(\d+\.\d+(?:\.\d+)?)\b/.exec(output)?.[1];
}
// ── platform backend settings (`platformBackends`) ──────────────────────────
/** `platformBackends`: ordered backend ids per platform. Pure shape check; ids are checked against the known backends by the caller. */
export function platformBackendProblems(input) {
    if (input === undefined || input === null)
        return [];
    if (!isObject(input))
        return ['platformBackends must be an object: { <platform>: [backend ids] }'];
    const problems = [];
    for (const [platform, ids] of Object.entries(input)) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$/.test(platform))
            problems.push('platformBackends: "' + platform + '" is not a platform id');
        if (!(Array.isArray(ids) && ids.length <= 12 && ids.every(id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$/.test(id))))
            problems.push('platformBackends.' + platform + ' must be a list of backend ids');
        else if (new Set(ids).size !== ids.length)
            problems.push('platformBackends.' + platform + ' lists a backend twice');
    }
    return problems;
}
//# sourceMappingURL=spec.js.map