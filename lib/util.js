/**
 * Shared helpers for the dsh-web-search-pro plugin (published bundle).
 * Dependencies (js-yaml, jsdom) are normal npm imports; playwright resolves
 * from the global npm root or config playwright.modulePath.
 * @module dsh-web-search-pro/util
 */
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { JSDOM } from 'jsdom';
import { assertResolvedPublicUrl, readBoundedBody, stripSensitiveHeadersForRedirect } from "./safe-http.js";
/** js-yaml parser (npm dep). */
export const jsYaml = { load: (input) => yamlLoad(input) };
/** jsdom constructor (npm dep) for HTML parsing in extraction rules. */
export const jsdom = JSDOM;
let cachedPlaywright;
/** Resolve the playwright module: explicit config path first, then the global npm root. */
export function resolvePlaywright(modulePath) {
    if (cachedPlaywright)
        return cachedPlaywright;
    const anchors = [];
    if (modulePath)
        anchors.push(path.join(modulePath, 'package.json'));
    anchors.push(path.join(globalNpmRoot(), 'playwright', 'package.json'));
    for (const anchor of anchors) {
        try {
            const req = createRequire(anchor);
            cachedPlaywright = req('playwright');
            return cachedPlaywright;
        }
        catch { /* try next anchor */ }
    }
    throw new Error('dsh-web-search-pro: playwright not found; install it globally (npm i -g playwright) or set config playwright.modulePath');
}
let cachedNpmRoot;
/** npm root -g, computed once. */
export function globalNpmRoot() {
    if (cachedNpmRoot)
        return cachedNpmRoot;
    try {
        cachedNpmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
    }
    catch {
        cachedNpmRoot = path.join(process.env.APPDATA ?? '', 'npm', 'node_modules');
    }
    return cachedNpmRoot;
}
export function uid() {
    return crypto.randomUUID();
}
export function sha1(input) {
    return crypto.createHash('sha1').update(input).digest('hex');
}
/** Normalize a query for cache keys: collapse whitespace, lowercase. */
export function normQuery(query) {
    return query.trim().replace(/\s+/g, ' ').toLowerCase();
}
/** Rotating browser user agents. */
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];
let uaIndex = 0;
export function userAgent() {
    uaIndex = (uaIndex + 1) % USER_AGENTS.length;
    return USER_AGENTS[uaIndex];
}
/**
 * One HTTP request (GET by default) with UA spoofing, cooperative timeout,
 * and abort forwarding. Supports method/body for API POSTs.
 */
export async function httpGet(url, opts = { signal: undefined }) {
    const controller = new AbortController();
    const timer = opts.timeoutMs ? setTimeout(() => controller.abort(new Error('dsh-web-search-pro: request timed out')), opts.timeoutMs) : undefined;
    const onAbort = () => controller.abort(opts.signal?.reason ?? new Error('aborted'));
    if (opts.signal?.aborted)
        onAbort();
    else
        opts.signal?.addEventListener('abort', onAbort);
    try {
        let current = (await assertResolvedPublicUrl(url)).href;
        let method = opts.method ?? 'GET';
        let body = opts.body;
        let requestHeaders = { ...opts.headers };
        let res;
        for (let redirects = 0; redirects <= 5; redirects++) {
            res = await fetch(current, {
                redirect: 'manual', signal: controller.signal, method,
                ...body !== undefined ? { body } : {},
                headers: {
                    'user-agent': userAgent(),
                    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
                    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    ...requestHeaders,
                },
            });
            const location = res.headers.get('location');
            if (![301, 302, 303, 307, 308].includes(res.status) || !location)
                break;
            if (opts.redirect === 'error')
                throw new Error('HTTP redirect is not allowed');
            if (redirects === 5)
                throw new Error('too many HTTP redirects');
            const from = new URL(current);
            const target = await assertResolvedPublicUrl(new URL(location, current));
            requestHeaders = stripSensitiveHeadersForRedirect(requestHeaders, from, target);
            current = target.href;
            if (res.status === 303 || ((res.status === 301 || res.status === 302) && method !== 'GET' && method !== 'HEAD')) {
                method = 'GET';
                body = undefined;
            }
        }
        if (!res)
            throw new Error('HTTP request did not produce a response');
        const buf = await readBoundedBody(res, opts.maxBytes ?? 8 * 1024 * 1024);
        const contentType = res.headers.get('content-type');
        const text = decodeText(buf, contentType ?? undefined);
        return {
            status: res.status,
            ok: res.ok,
            text,
            finalUrl: current,
            ...contentType != null ? { contentType } : {},
        };
    }
    finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
    }
}
/** Decode bytes honoring charset; UTF-8 first with GBK fallback on garbage. */
export function decodeText(buf, contentType) {
    const charset = /charset=([\w-]+)/i.exec(contentType ?? '')?.[1]?.toLowerCase();
    const candidates = charset ? [charset] : ['utf-8', 'gbk'];
    for (const enc of candidates) {
        try {
            const text = new TextDecoder(enc).decode(buf);
            if (enc === 'utf-8' || !text.includes('\uFFFD'))
                return text;
        }
        catch { /* unsupported encoding */ }
    }
    return new TextDecoder('utf-8').decode(buf);
}
/** Decode common HTML entities in a string. */
export function htmlDecode(input) {
    return input
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}
/** Strip HTML tags (used for titles / snippets inside already-scoped strings). */
export function stripTags(input) {
    return htmlDecode(input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}
/** Quote one argument for cmd.exe /c command lines. */
function quoteArg(arg) {
    if (/[^\w@%+=:,./-]/.test(arg)) {
        return '"' + arg.replace(/"/g, '\\"') + '"';
    }
    return arg;
}
/**
 * Run an external CLI (opencli / gh / bili / yt-dlp / agent-reach / npm).
 * Windows cmd wrappers are handled via ComSpec.
 */
export function runCli(bin, args, opts = { signal: undefined }) {
    return new Promise((resolve) => {
        const maxOutput = opts.maxOutput ?? 4 * 1024 * 1024;
        let stdout = '';
        let stderr = '';
        let child;
        let settled = false;
        const finish = (code, timedOut) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            opts.signal?.removeEventListener('abort', onAbort);
            if (child.exitCode === null)
                child.kill();
            resolve({ code, stdout, stderr, timedOut });
        };
        const timer = opts.timeoutMs ? setTimeout(() => finish(-1, true), opts.timeoutMs) : undefined;
        const onAbort = () => {
            if (child.exitCode === null)
                child.kill();
            finish(-1, false);
        };
        if (process.platform === 'win32') {
            const cmd = [quoteArg(bin), ...args.map(quoteArg)].join(' ');
            child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmd], {
                windowsVerbatimArguments: true,
                env: { ...process.env, ...opts.env },
                cwd: opts.cwd,
                windowsHide: true,
            });
        }
        else {
            child = spawn(bin, args, { env: { ...process.env, ...opts.env }, cwd: opts.cwd });
        }
        child.stdout?.on('data', (d) => { if (stdout.length < maxOutput)
            stdout += d.toString('utf8'); });
        child.stderr?.on('data', (d) => { if (stderr.length < maxOutput)
            stderr += d.toString('utf8'); });
        child.on('error', () => finish(-1, false));
        child.on('close', (code) => finish(code ?? -1, false));
        if (opts.signal?.aborted)
            onAbort();
        else
            opts.signal?.addEventListener('abort', onAbort);
    });
}
/** Extract the first URL from a DuckDuckGo / Google style redirect parameter. */
export function decodeRedirectUrl(href) {
    const m = /[?&]uddg=([^&]+)/.exec(href);
    if (m) {
        try {
            return decodeURIComponent(m[1]);
        }
        catch { /* fall through */ }
    }
    const g = /[?&]url=([^&]+)/.exec(href);
    if (g) {
        try {
            return decodeURIComponent(g[1]);
        }
        catch { /* fall through */ }
    }
    return href;
}
/** Cap a string to maxChars while keeping whole lines near the boundary. */
export function capText(text, maxChars) {
    if (text.length <= maxChars)
        return text;
    return text.slice(0, maxChars) + '\n\n(Content truncated at ' + maxChars + ' characters.)';
}
//# sourceMappingURL=util.js.map