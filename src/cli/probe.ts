/**
 * Contract probes of CLI adapter specs (dev-plan M12, design §4.3 / §4.4): local only, cached with a TTL. A probe finds
 * the command on PATH and runs ONLY the spec's version and help commands, then checks the contract the spec needs: a
 * minimum version and the subcommands / flags that must appear in the help text. A same-named program with another
 * contract is `incompatible`, not `detected`. A probe never runs a search and never logs in.
 * @module web-search-pro/cli/probe
 */

import fs from 'node:fs'
import path from 'node:path'
import { runCli } from '../util.ts'
import { buildCliEnv } from './runner.ts'
import { compareVersions, parseVersion, type CliAdapterSpec } from './spec.ts'

export type CliInstallation = 'missing' | 'detected' | 'incompatible'

export interface CliProbeResult {
  state: CliInstallation
  /** The command name that matched. */
  bin?: string
  /** Where it was found. */
  path?: string
  version?: string
  /** Why it is incompatible or missing. */
  reason?: string
  checkedAt: number
}

/** What a probe needs of a spec: where the command is, how it is checked, and the environment it runs in. */
export type ProbeSubject = Pick<CliAdapterSpec, 'id' | 'bins' | 'probe' | 'packageNote' | 'env'>

export interface CliProbeOptions {
  run?: typeof runCli
  /** Cache lifetime; default 60 s. */
  ttlMs?: number
  /** Skip the cache (an explicit "check again"). */
  force?: boolean
  now?: () => number
}

const DEFAULT_TTL_MS = 60_000
const PROBE_TIMEOUT_MS = 8_000
const cache = new Map<string, { at: number; result: CliProbeResult }>()
const flights = new Map<string, Promise<CliProbeResult>>()

export function clearProbeCache(): void {
  cache.clear()
  flights.clear()
}

/** The executable `cmd` resolves to on PATH (no process is spawned; Windows tries PATHEXT). */
export function findOnPath(cmd: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const win = process.platform === 'win32'
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)
  const exts = win ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.join(dir, cmd + ext)
      try {
        const stat = fs.statSync(file)
        if (stat.isFile() && (win || (stat.mode & 0o111) !== 0)) return file
      } catch { /* not here */ }
    }
  }
  return undefined
}

const keyOf = (spec: ProbeSubject): string => [spec.id, spec.bins.join(','), JSON.stringify(spec.probe), process.env.PATH ?? ''].join('\u0000')

/** The cached probe of a spec, when one is fresh (no spawn: `Engine.available()` is synchronous). */
export function cachedProbe(spec: ProbeSubject, ttlMs = DEFAULT_TTL_MS, now: () => number = Date.now): CliProbeResult | undefined {
  const hit = cache.get(keyOf(spec))
  return hit && now() - hit.at <= ttlMs ? hit.result : undefined
}

export interface ContractInput { code: number; output: string }

/**
 * Decide whether version and help output satisfy a spec's contract. Pure (the fixtures tests call it directly).
 * The version command may fail or print nothing unless the spec asks for a minimum version.
 */
export function evaluateCliContract(
  spec: Pick<CliAdapterSpec, 'probe'>,
  bin: string,
  version: ContractInput,
  help: ContractInput,
): { state: 'detected' | 'incompatible'; version?: string; reason?: string } {
  const { probe } = spec
  const versionCmd = [bin, ...probe.versionArgs].join(' ')
  const detected = version.code === 0 ? parseVersion(version.output) : undefined
  if (probe.minVersion !== undefined) {
    if (version.code !== 0) return { state: 'incompatible', reason: versionCmd + ' failed with exit ' + version.code }
    if (!detected) return { state: 'incompatible', reason: versionCmd + ' returned no semantic version' }
    if (compareVersions(detected, probe.minVersion) < 0) return { state: 'incompatible', version: detected, reason: bin + ' ' + detected + ' is older than required ' + probe.minVersion }
  }
  const withVersion = detected ? { version: detected } : {}
  const helpCmd = [bin, ...probe.helpArgs].join(' ')
  if (help.code !== 0) return { state: 'incompatible', ...withVersion, reason: helpCmd + ' failed with exit ' + help.code }
  const lower = help.output.toLowerCase()
  const missing = probe.mustContain.filter(fragment => !lower.includes(fragment.toLowerCase()))
  if (missing.length) {
    const words = probe.helpArgs.filter(arg => !arg.startsWith('-')).join(' ') || 'help'
    return { state: 'incompatible', ...withVersion, reason: bin + ' ' + words + ' contract missing ' + missing.join(', ') + ' (a different program with the same name?)' }
  }
  return { state: 'detected', ...withVersion }
}

async function probeUncached(spec: ProbeSubject, options: CliProbeOptions): Promise<CliProbeResult> {
  const run = options.run ?? runCli
  const now = options.now ?? Date.now
  const env = buildCliEnv(spec)
  const call = async (bin: string, args: readonly string[]): Promise<ContractInput> => {
    const res = await run(bin, [...args], { timeoutMs: PROBE_TIMEOUT_MS, signal: undefined, env, cleanEnv: true, maxOutput: 128 * 1024, outputEncoding: 'utf-8' })
    return { code: res.timedOut || res.spawnFailed ? -1 : res.code, output: res.stdout + '\n' + res.stderr }
  }
  let firstBad: CliProbeResult | undefined
  for (const bin of spec.bins) {
    const found = findOnPath(bin)
    if (!found) continue
    const version = await call(found, spec.probe.versionArgs)
    const help = await call(found, spec.probe.helpArgs)
    const verdict = evaluateCliContract(spec, bin, version, help)
    const result: CliProbeResult = { state: verdict.state, bin, path: found, ...verdict.version ? { version: verdict.version } : {}, ...verdict.reason ? { reason: verdict.reason } : {}, checkedAt: now() }
    if (verdict.state === 'detected') return result
    firstBad ??= result
  }
  return firstBad ?? { state: 'missing', reason: spec.bins.join(' / ') + ' not found on PATH (' + spec.packageNote + ')', checkedAt: now() }
}

/** Probe one spec (cached; concurrent calls for the same spec share one run). */
export async function probeCli(spec: ProbeSubject, options: CliProbeOptions = {}): Promise<CliProbeResult> {
  const key = keyOf(spec)
  const now = options.now ?? Date.now
  if (!options.force) {
    const hit = cache.get(key)
    if (hit && now() - hit.at <= (options.ttlMs ?? DEFAULT_TTL_MS)) return hit.result
    const flight = flights.get(key)
    if (flight) return flight
  }
  const flight = probeUncached(spec, options).then(result => { cache.set(key, { at: now(), result }); return result }).finally(() => { if (flights.get(key) === flight) flights.delete(key) })
  flights.set(key, flight)
  return flight
}

/** Probe many specs with a small concurrency bound (a settings refresh must not spawn dozens of processes at once). */
export async function probeAll(specs: readonly ProbeSubject[], options: CliProbeOptions = {}, concurrency = 4): Promise<Map<string, CliProbeResult>> {
  const out = new Map<string, CliProbeResult>()
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const spec = specs[next++]
      if (!spec) return
      out.set(spec.id, await probeCli(spec, options))
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, specs.length) }, worker))
  return out
}
