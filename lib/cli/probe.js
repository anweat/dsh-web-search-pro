/**
 * Contract probes of CLI adapter specs (dev-plan M12, design §4.3 / §4.4): local only, cached with a TTL. A probe finds
 * the command on PATH and runs ONLY the spec's version and help commands, then checks the contract the spec needs: a
 * minimum version and the subcommands / flags that must appear in the help text. A same-named program with another
 * contract is `incompatible`, not `detected`. A probe never runs a search and never logs in.
 * @module web-search-pro/cli/probe
 */
import fs from 'node:fs';
import path from 'node:path';
import { runCli } from "../util.js";
import { buildCliEnv } from "./runner.js";
import { locateOpencliBin, realMachine, withPathPrefix } from "./opencli-locate.js";
import { compareVersions, parseVersion } from "./spec.js";
const DEFAULT_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 8_000;
const cache = new Map();
const flights = new Map();
export function clearProbeCache() {
    cache.clear();
    flights.clear();
}
/** The executable `cmd` resolves to on PATH (no process is spawned; Windows tries PATHEXT). */
export function findOnPath(cmd, env = process.env) {
    const win = process.platform === 'win32';
    const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
    const exts = win ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : [''];
    for (const dir of dirs) {
        for (const ext of exts) {
            const file = path.join(dir, cmd + ext);
            try {
                const stat = fs.statSync(file);
                if (stat.isFile() && (win || (stat.mode & 0o111) !== 0))
                    return file;
            }
            catch { /* not here */ }
        }
    }
    return undefined;
}
/**
 * Where a command is: on PATH, and for the standalone `opencli` also in the usual global install places (see opencli-locate.ts),
 * with the PATH directories its runs need. `problem` is set for an unusable `DSH_BROWSER_OPENCLI`.
 */
export function resolveBin(bin, env = process.env) {
    if (bin === 'opencli') {
        const { location, problem } = locateOpencliBin(realMachine(env));
        return location ? { path: location.path, pathPrefix: location.pathPrefix } : { ...problem ? { problem } : {} };
    }
    const found = findOnPath(bin, env);
    return found ? { path: found, pathPrefix: [] } : {};
}
const keyOf = (spec) => [spec.id, spec.bins.join(','), JSON.stringify(spec.probe), process.env.PATH ?? '', process.env.DSH_BROWSER_OPENCLI ?? ''].join('\u0000');
/** The cached probe of a spec, when one is fresh (no spawn: `Engine.available()` is synchronous). */
export function cachedProbe(spec, ttlMs = DEFAULT_TTL_MS, now = Date.now) {
    const hit = cache.get(keyOf(spec));
    return hit && now() - hit.at <= ttlMs ? hit.result : undefined;
}
/**
 * Decide whether version and help output satisfy a spec's contract. Pure (the fixtures tests call it directly).
 * The version command may fail or print nothing unless the spec asks for a minimum version.
 */
export function evaluateCliContract(spec, bin, version, help) {
    const { probe } = spec;
    const versionCmd = [bin, ...probe.versionArgs].join(' ');
    const detected = version.code === 0 ? parseVersion(version.output) : undefined;
    if (probe.minVersion !== undefined || probe.maxVersion !== undefined) {
        if (version.code !== 0)
            return { state: 'incompatible', reason: versionCmd + ' failed with exit ' + version.code };
        if (!detected)
            return { state: 'incompatible', reason: versionCmd + ' returned no semantic version' };
        if (probe.minVersion !== undefined && compareVersions(detected, probe.minVersion) < 0)
            return { state: 'incompatible', version: detected, reason: bin + ' ' + detected + ' is older than required ' + probe.minVersion };
        // The upper bound is exclusive: a newer major was never checked against this adapter, so it is reported, not adapted to.
        if (probe.maxVersion !== undefined && compareVersions(detected, probe.maxVersion) >= 0) {
            return { state: 'incompatible', version: detected, reason: bin + ' ' + detected + ' is newer than this adapter supports (below ' + probe.maxVersion + ' only)' + (probe.maxVersionHint ? ': install the tested version with `' + probe.maxVersionHint + '`' : '') };
        }
    }
    const withVersion = detected ? { version: detected } : {};
    const helpCmd = [bin, ...probe.helpArgs].join(' ');
    if (help.code !== 0)
        return { state: 'incompatible', ...withVersion, reason: helpCmd + ' failed with exit ' + help.code };
    const lower = help.output.toLowerCase();
    const missing = probe.mustContain.filter(fragment => !lower.includes(fragment.toLowerCase()));
    if (missing.length) {
        const words = probe.helpArgs.filter(arg => !arg.startsWith('-')).join(' ') || 'help';
        return { state: 'incompatible', ...withVersion, reason: bin + ' ' + words + ' contract missing ' + missing.join(', ') + ' (a different program with the same name' + (probe.contractHint ? ', or an older version: ' + probe.contractHint : '?') + ')' };
    }
    return { state: 'detected', ...withVersion };
}
async function probeUncached(spec, options) {
    const run = options.run ?? runCli;
    const now = options.now ?? Date.now;
    const call = async (bin, args, prefix) => {
        const res = await run(bin, [...args], { timeoutMs: PROBE_TIMEOUT_MS, signal: undefined, env: withPathPrefix(buildCliEnv(spec), prefix), cleanEnv: true, maxOutput: 128 * 1024, outputEncoding: 'utf-8' });
        return { code: res.timedOut || res.spawnFailed ? -1 : res.code, output: res.stdout + '\n' + res.stderr };
    };
    let firstBad;
    let problem;
    for (const bin of spec.bins) {
        const resolved = resolveBin(bin);
        problem ??= resolved.problem;
        if (!resolved.path)
            continue;
        const found = resolved.path;
        const version = await call(found, spec.probe.versionArgs, resolved.pathPrefix);
        const help = await call(found, spec.probe.helpArgs, resolved.pathPrefix);
        const verdict = evaluateCliContract(spec, bin, version, help);
        const result = { state: verdict.state, bin, path: found, ...resolved.pathPrefix.length ? { pathPrefix: resolved.pathPrefix } : {}, ...verdict.version ? { version: verdict.version } : {}, ...verdict.reason ? { reason: verdict.reason } : {}, checkedAt: now() };
        if (verdict.state === 'detected')
            return result;
        firstBad ??= result;
    }
    const places = spec.bins.includes('opencli') ? ' or in the usual global install folders (Homebrew, ~/.npm-global, nvm, fnm, Volta; DSH_BROWSER_OPENCLI names it explicitly)' : '';
    return firstBad ?? { state: 'missing', reason: (problem ? problem + '; ' : '') + spec.bins.join(' / ') + ' not found on PATH' + places + ' (' + spec.packageNote + ')', checkedAt: now() };
}
/** Probe one spec (cached; concurrent calls for the same spec share one run). */
export async function probeCli(spec, options = {}) {
    const key = keyOf(spec);
    const now = options.now ?? Date.now;
    if (!options.force) {
        const hit = cache.get(key);
        if (hit && now() - hit.at <= (options.ttlMs ?? DEFAULT_TTL_MS))
            return hit.result;
        const flight = flights.get(key);
        if (flight)
            return flight;
    }
    const flight = probeUncached(spec, options).then(result => { cache.set(key, { at: now(), result }); return result; }).finally(() => { if (flights.get(key) === flight)
        flights.delete(key); });
    flights.set(key, flight);
    return flight;
}
/** Probe many specs with a small concurrency bound (a settings refresh must not spawn dozens of processes at once). */
export async function probeAll(specs, options = {}, concurrency = 4) {
    const out = new Map();
    let next = 0;
    const worker = async () => {
        for (;;) {
            const spec = specs[next++];
            if (!spec)
                return;
            out.set(spec.id, await probeCli(spec, options));
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, specs.length) }, worker));
    return out;
}
//# sourceMappingURL=probe.js.map