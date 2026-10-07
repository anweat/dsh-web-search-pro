/**
 * External dependency detection and install for the CLI/platform backends.
 * Backends shell out to tools installed outside DSH: the built-in CLI adapter specs (bili, yt-dlp, twitter, xhs, zhihu,
 * rdt, omnireach, gh, wx-search-cli, tanso, the standalone opencli) plus the user's own `cliAdapters`, and mcporter. This
 * module reports which are present, whether the command on PATH really has the contract the adapter needs (a same-named
 * program with another contract is `incompatible`, never `detected`), and how to install them; the sources.deps /
 * sources.install actions expose it to the model. Probes are local, cached with a TTL, and never run a search or a login.
 *
 * Install is intentionally a MODEL-FACING TOOL, not a browser settings button:
 * a browser button running winget/pip/npm would be arbitrary command execution
 * without a permission gate, whereas a tool flows through DSH's existing
 * tool-permission/approval pipeline. The card points at this tool instead.
 * @module web-search-pro/deps
 */
import { runCli } from "./util.js";
import { BILI_CLI_INSTALLS, BILI_CLI_REVISION, BILI_CLI_SOURCE, BILI_CLI_VERSION, BUILTIN_CLI_SPECS, TWITTER_CLI_INSTALLS, builtinSpecById } from "./cli/builtin-specs.js";
import { OPENCLI_PROBE } from "./cli/opencli.js";
import { evaluateCliContract, findOnPath, probeAll } from "./cli/probe.js";
import { resolveCliAdapters } from "./cli/spec.js";
export { BILI_CLI_INSTALLS, BILI_CLI_REVISION, BILI_CLI_SOURCE, BILI_CLI_VERSION, TWITTER_CLI_INSTALLS };
const py = (pkg) => [
    { installer: 'uv', command: 'uv tool install ' + pkg },
    { installer: 'pipx', command: 'pipx install ' + pkg },
    { installer: 'pip', command: 'pip install ' + pkg },
];
/** Install commands of the spec-backed CLIs (a user-defined adapter has none: it names its own package in packageNote). */
const SPEC_INSTALLS = {
    bili: BILI_CLI_INSTALLS,
    'yt-dlp': [{ installer: 'uv', command: 'uv tool install yt-dlp' }, { installer: 'pip', command: 'pip install yt-dlp' }],
    twitter: TWITTER_CLI_INSTALLS,
    xhs: py('xiaohongshu-cli'),
    zhihu: py('pyzhihu-cli'),
    rdt: py('git+https://github.com/public-clis/rdt-cli'),
    omnireach: py('omnireach'),
    gh: [{ installer: 'brew', command: 'brew install gh' }, { installer: 'winget', command: 'winget install GitHub.cli' }],
    'wx-search-cli': [{ installer: 'npm', command: 'npm i -g wx-search-cli' }],
    tanso: [{ installer: 'npm', command: 'npm i -g @geekjourneyx/tanso' }],
    opencli: [{ installer: 'npm', command: 'npm i -g @jackwener/opencli' }],
};
const USED_BY = {
    bili: 'bilibili 平台后端',
    'yt-dlp': 'youtube 平台后端',
    twitter: 'twitter 平台后端（第一后端，执行 `twitter search`；另需 TWITTER_AUTH_TOKEN 与 TWITTER_CT0）',
    xhs: 'xiaohongshu 平台后端（只读 `xhs search`；需用户自行 `xhs login`）',
    zhihu: 'zhihu 平台后端（只读 `zhihu search`；需用户自行 `zhihu login`）',
    rdt: 'reddit 平台后端（只读 `rdt search`；需用户自行 `rdt login`）',
    omnireach: 'wechat 平台后端与 omnireach 多源平台（只读 `omnireach search`）',
    gh: 'github / github-issues / github-code 的 gh 回退后端（只读 `gh search`；需用户自行 `gh auth login`）',
    'wx-search-cli': 'wechat 平台第二后端（只读 `wx-search-cli search`；按上游文档，未实测）',
    tanso: 'tanso 平台后端（只读；按上游文档，未实测）',
    opencli: '独立 OpenCLI：xiaohongshu / reddit / twitter 等站点的搜索后端（按 `opencli list` 的 search 命令，使用用户自己的 Chrome）',
};
const LABELS = {
    bili: 'bili-cli', 'yt-dlp': 'yt-dlp', twitter: 'twitter-cli', xhs: 'xhs (xiaohongshu-cli)', zhihu: 'zhihu-cli', rdt: 'rdt-cli', omnireach: 'OmniReach', gh: 'GitHub CLI',
    'wx-search-cli': 'wx-search-cli', tanso: 'Tanso', opencli: 'OpenCLI (standalone)',
};
/** Validate the public-clis bili command rather than trusting an ambiguous package name. */
export function evaluateBiliCli(versionOutput, searchHelpOutput) {
    const verdict = evaluateCliContract(builtinSpecById('bili'), 'bili', { code: 0, output: versionOutput }, { code: 0, output: searchHelpOutput });
    if (verdict.state === 'detected')
        return { available: true, ...verdict.version ? { version: verdict.version } : {} };
    return { available: false, ...verdict.version ? { version: verdict.version } : {}, diagnostic: (verdict.reason ?? '').replace(/ \(a different program with the same name\?\)$/, '') };
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
/** Non-spec tools: Exa's MCP fallback and the optional Agent-Reach installer helper. */
const EXTRA_DEPS = [
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
    // playwright is NOT listed here: it is bundled in the dsh-browser plugin, which this plugin uses optionally via the
    // `browser` service. The dsh-browser OpenCLI is a backend of the platform chains, not a CLI of this list; the
    // standalone `opencli` below is the user's own install.
];
const infoOf = (subject, spec, usedBy, label, installs) => ({
    id: subject.id,
    label,
    usedBy,
    source: subject.packageNote,
    ...subject.probe.minVersion ? { requiredVersion: '>=' + subject.probe.minVersion } : {},
    ...spec?.verification ? { verification: spec.verification.status } : {},
    installs,
});
/** The built-in specs (one entry per CLI; a CLI serving several platforms is one entry) and the standalone opencli. */
function builtinDeps() {
    const out = BUILTIN_CLI_SPECS.map(spec => ({ subject: spec, info: infoOf(spec, spec, USED_BY[spec.id] ?? spec.platforms.join(' / ') + ' 后端', LABELS[spec.id] ?? spec.bins[0], SPEC_INSTALLS[spec.id] ?? []) }));
    out.push({ subject: OPENCLI_PROBE, info: { ...infoOf(OPENCLI_PROBE, undefined, USED_BY.opencli, LABELS.opencli, SPEC_INSTALLS.opencli), verification: 'contract-only' } });
    return out;
}
/** Order the plugin has always listed them in, then the new adapters, then the user's. */
const ORDER = ['bili', 'yt-dlp', 'twitter', 'agent-reach', 'mcporter'];
export const DEP_IDS = [...new Set([...ORDER, ...BUILTIN_CLI_SPECS.map(s => s.id), 'opencli', ...EXTRA_DEPS.map(d => d.id)])];
/** Detect every dependency: the spec-backed CLIs through their cached contract probes, the rest by presence on PATH. */
export async function detectDeps(options = {}) {
    const specs = builtinDeps();
    const user = resolveCliAdapters(options.config?.cliAdapters).specs;
    const userDeps = [...user].map(([id, spec]) => ({
        subject: { ...spec, id: 'custom-cli:' + id },
        info: { id: 'custom-cli:' + id, label: spec.bins[0] + ' (自定义)', usedBy: 'custom-cli:' + id + ' 平台后端（用户定义，未验证）', source: spec.packageNote, ...spec.probe.minVersion ? { requiredVersion: '>=' + spec.probe.minVersion } : {}, installs: [] },
    }));
    const all = [...specs, ...userDeps];
    const probes = await probeAll(all.map(a => a.subject), { ...options.force ? { force: true } : {} });
    const found = new Map();
    for (const { subject, info } of all) {
        const probe = probes.get(subject.id);
        found.set(subject.id, {
            ...info,
            available: probe.state === 'detected',
            installation: probe.state,
            ...probe.path ? { path: probe.path } : {},
            ...probe.version ? { version: probe.version } : {},
            ...probe.state === 'incompatible' && probe.reason ? { diagnostic: probe.reason } : {},
        });
    }
    for (const extra of EXTRA_DEPS) {
        const path = findOnPath(extra.id);
        found.set(extra.id, { ...extra, available: !!path, installation: path ? 'detected' : 'missing', ...path ? { path } : {} });
    }
    const order = [...ORDER, ...BUILTIN_CLI_SPECS.map(s => s.id), 'opencli', ...EXTRA_DEPS.map(d => d.id), ...userDeps.map(d => d.info.id)];
    return [...new Set(order)].map(id => found.get(id)).filter((d) => d !== undefined);
}
/** Run the install command for one backend + installer. */
export async function installDep(id, installer) {
    const dep = [...builtinDeps().map(b => ({ id: b.info.id, installs: b.info.installs })), ...EXTRA_DEPS].find(d => d.id === id);
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
/** The installer `sources.install` uses when none is named: the first one listed for the dependency. */
export function defaultInstaller(id) {
    const dep = [...builtinDeps().map(b => ({ id: b.info.id, installs: b.info.installs })), ...EXTRA_DEPS].find(d => d.id === id);
    if (!dep)
        throw new Error('unknown backend: ' + id + ' (sources.deps lists them: ' + DEP_IDS.join(', ') + ')');
    const first = dep.installs[0];
    if (!first)
        throw new Error(id + ' has no install command here: see its source in sources.deps');
    return first.installer;
}
//# sourceMappingURL=deps.js.map