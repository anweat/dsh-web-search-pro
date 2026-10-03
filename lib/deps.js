/**
 * External dependency detection and install for the CLI/platform backends.
 * Most backends shell out to tools installed outside DSH (bili, yt-dlp,
 * twitter, and mcporter). This module reports which are present and how to
 * install them; the sources.deps / sources.install actions expose it to the model. Each entry probes
 * the command the backend actually executes (the twitter backend runs
 * `twitter`, so finding `agent-reach` on PATH says nothing about it).
 *
 * Install is intentionally a MODEL-FACING TOOL, not a browser settings button:
 * a browser button running winget/pip/npm would be arbitrary command execution
 * without a permission gate, whereas a tool flows through DSH's existing
 * tool-permission/approval pipeline. The card points at this tool instead.
 * @module web-search-pro/deps
 */
import { runCli } from "./util.js";
const IS_WIN = process.platform === 'win32';
export const BILI_CLI_VERSION = '0.6.2';
export const BILI_CLI_REVISION = '489607468f967e0e11f3cdff6efc022d011e982a';
export const BILI_CLI_SOURCE = `git+https://github.com/public-clis/bilibili-cli@${BILI_CLI_REVISION}`;
export const BILI_CLI_INSTALLS = [
    { installer: 'uv', command: `uv tool install --force ${BILI_CLI_SOURCE}` },
    { installer: 'pipx', command: `pipx install --force ${BILI_CLI_SOURCE}` },
    { installer: 'pip', command: `pip install --force-reinstall ${BILI_CLI_SOURCE}` },
];
function compareVersions(left, right) {
    const a = left.split('.').map(Number);
    const b = right.split('.').map(Number);
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
        const delta = (a[index] ?? 0) - (b[index] ?? 0);
        if (delta !== 0)
            return delta;
    }
    return 0;
}
/** Validate the public-clis bili command rather than trusting an ambiguous package name. */
export function evaluateBiliCli(versionOutput, searchHelpOutput) {
    const version = /\b(\d+\.\d+\.\d+)\b/.exec(versionOutput)?.[1];
    if (!version)
        return { available: false, diagnostic: 'bili --version returned no semantic version' };
    if (compareVersions(version, BILI_CLI_VERSION) < 0) {
        return { available: false, version, diagnostic: `bili ${version} is older than required ${BILI_CLI_VERSION}` };
    }
    const missing = ['--type', '--max', '--json'].filter(option => !searchHelpOutput.includes(option));
    if (missing.length) {
        return { available: false, version, diagnostic: `bili search contract missing ${missing.join(', ')}` };
    }
    return { available: true, version };
}
async function probeBiliCli(bin) {
    const env = { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
    const version = await runCli(bin, ['--version'], { timeoutMs: 8_000, signal: undefined, env, maxOutput: 64 * 1024 });
    if (version.code !== 0) {
        return { available: false, diagnostic: `bili --version failed with exit ${version.code}` };
    }
    const help = await runCli(bin, ['search', '--help'], { timeoutMs: 8_000, signal: undefined, env, maxOutput: 128 * 1024 });
    if (help.code !== 0) {
        return { available: false, diagnostic: `bili search --help failed with exit ${help.code}` };
    }
    return evaluateBiliCli(version.stdout + version.stderr, help.stdout + help.stderr);
}
/**
 * The twitter backend runs `twitter search <query> -n N` (twitter-cli). Another program that happens to be
 * called `twitter` must not pass: require a successful `search --help` that actually describes a search command.
 */
export function evaluateTwitterCli(searchHelpOutput, exitCode) {
    if (exitCode !== 0)
        return { available: false, diagnostic: `twitter search --help failed with exit ${exitCode}` };
    if (!/search/i.test(searchHelpOutput))
        return { available: false, diagnostic: 'twitter search --help does not describe a search command (not twitter-cli?)' };
    return { available: true };
}
async function probeTwitterCli(bin) {
    const help = await runCli(bin, ['search', '--help'], { timeoutMs: 8_000, signal: undefined, env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }, maxOutput: 128 * 1024 });
    return evaluateTwitterCli(help.stdout + help.stderr, help.code);
}
export const TWITTER_CLI_INSTALLS = [
    { installer: 'uv', command: 'uv tool install twitter-cli' },
    { installer: 'pipx', command: 'pipx install twitter-cli' },
    { installer: 'pip', command: 'pip install twitter-cli' },
];
/** One external tool the plugin may shell out to. */
const DEPS = [
    {
        id: 'bili', label: 'bili-cli', usedBy: 'bilibili 后端',
        source: `public-clis/bilibili-cli v${BILI_CLI_VERSION} (${BILI_CLI_REVISION.slice(0, 12)})`,
        requiredVersion: `>=${BILI_CLI_VERSION}`,
        installs: BILI_CLI_INSTALLS,
        probe: probeBiliCli,
    },
    {
        id: 'yt-dlp', label: 'yt-dlp', usedBy: 'youtube 后端',
        installs: [
            { installer: 'uv', command: 'uv tool install yt-dlp' },
            { installer: 'pip', command: 'pip install yt-dlp' },
        ],
    },
    {
        id: 'twitter', label: 'twitter-cli', usedBy: 'twitter 平台后端（agentreach-twitter，执行 `twitter search`；另需 TWITTER_AUTH_TOKEN 与 TWITTER_CT0）',
        source: 'twitter-cli (PyPI twitter-cli; command `twitter`)',
        installs: TWITTER_CLI_INSTALLS,
        probe: probeTwitterCli,
    },
    {
        id: 'agent-reach', label: 'Agent-Reach', usedBy: '安装助手（可顺带装 twitter-cli 等渠道；本插件不直接执行它，twitter 搜索看 twitter 项）',
        optional: true,
        installs: [
            { installer: 'uv', command: 'uv tool install agent-reach' },
            { installer: 'pip', command: 'pip install agent-reach' },
        ],
    },
    {
        id: 'mcporter', label: 'mcporter', usedBy: 'Exa MCP fallback',
        installs: [
            { installer: 'npm', command: 'npm i -g mcporter' },
        ],
    },
    // opencli and playwright are NOT listed here: they are bundled (plugin-local
    // node_modules, with global reuse fallback) in the dsh-browser plugin, which
    // this plugin uses optionally via the `browser` service.
];
/** Resolve a command on PATH (win32: where.exe; posix: sh -c command -v). */
async function resolveCmd(cmd) {
    const res = await runCli(IS_WIN ? 'where' : 'sh', IS_WIN ? [cmd] : ['-c', 'command -v ' + cmd], { timeoutMs: 8_000, signal: undefined, maxOutput: 64 * 1024 });
    if (res.code !== 0)
        return { found: false };
    const first = res.stdout.split(/\r?\n/).find(line => line.trim().length > 0);
    return first ? { found: true, path: first.trim() } : { found: false };
}
/** Detect all backends. */
export async function detectDeps() {
    const out = [];
    for (const dep of DEPS) {
        const { probe, ...info } = dep;
        const resolved = await resolveCmd(dep.id);
        if (!resolved.found) {
            out.push({ ...info, available: false });
            continue;
        }
        const probed = probe ? await probe(resolved.path ?? dep.id) : { available: true };
        out.push({ ...info, ...probed, ...resolved.path ? { path: resolved.path } : {} });
    }
    return out;
}
/** Run the install command for one backend + installer. */
export async function installDep(id, installer) {
    const dep = DEPS.find(d => d.id === id);
    if (!dep)
        throw new Error('unknown dependency: ' + id);
    const target = dep.installs.find(i => i.installer === installer);
    if (!target)
        throw new Error('unknown installer ' + installer + ' for ' + id + '; try: ' + dep.installs.map(i => i.installer).join(', '));
    return runCompound(target.command, 180_000);
}
async function runCompound(command, timeoutMs) {
    // Split on spaces is fine for these fixed commands; quotes are not used.
    const parts = command.split(' ').filter(Boolean);
    const bin = parts.shift();
    return runCli(bin, parts, { timeoutMs, signal: undefined, maxOutput: 256 * 1024 });
}
export const DEP_IDS = DEPS.map(d => d.id);
//# sourceMappingURL=deps.js.map