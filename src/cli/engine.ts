/**
 * The Engine of a CLI adapter spec (dev-plan M12): one search leg that probes the command's contract (cached), then runs
 * the spec through the shared runner. `available()` is synchronous and local (settings gates plus the probe cache);
 * every failure reaches the caller as a structured error naming what to install or run.
 * @module web-search-pro/cli/engine
 */

import type { Engine, EngineDeps } from '../engines.ts'
import { CliAdapterError, loginHint, missingEnv, runCliSearch, savedLoginPresent, type CliRunOptions } from './runner.ts'
import { cachedProbe, probeCli, type CliProbeResult } from './probe.ts'
import type { CliAdapterSpec } from './spec.ts'
import type { runCli } from '../util.ts'

/** Settings that gate a spec on top of `enableCliBackends` (twitter-cli kept its own `agentReachEnabled` switch). */
const SETTING_GATE: Readonly<Record<string, { key: 'agentReachEnabled'; label: string }>> = {
  twitter: { key: 'agentReachEnabled', label: 'the twitter-cli backend is disabled in settings (agentReachEnabled)' },
}

/** Why a spec is switched off by settings, or undefined when it may run. */
export function disabledBySettings(spec: Pick<CliAdapterSpec, 'id'>, deps: Pick<EngineDeps, 'enableCli' | 'agentReachEnabled'>): string | undefined {
  if (!deps.enableCli) return 'CLI backends are disabled in settings (enableCliBackends)'
  const gate = SETTING_GATE[spec.id]
  return gate && !deps[gate.key] ? gate.label : undefined
}

export interface CliLegOptions {
  /** Engine id (default: the spec id). */
  id?: string
  label?: string
  /** Test seam: replaces the process runner; the contract probe is then skipped (the caller controls the command). */
  run?: typeof runCli
  env?: NodeJS.ProcessEnv
  home?: string
  /** The credentials are checked by the caller (the legacy twitter engine). */
  skipCredentialGate?: boolean
}

/** The probe verdict as the structured error a search would raise, or undefined when the command is usable. */
export function probeError(spec: Pick<CliAdapterSpec, 'bins' | 'packageNote'>, probe: CliProbeResult): CliAdapterError | undefined {
  if (probe.state === 'detected') return undefined
  if (probe.state === 'missing') return new CliAdapterError('the ' + spec.bins[0] + ' command is not installed: install it (' + spec.packageNote + ')', 'CLI_NOT_FOUND', 'install: ' + spec.packageNote)
  return new CliAdapterError(spec.bins[0] + ' is installed but does not match this adapter: ' + (probe.reason ?? 'contract mismatch'), 'CLI_CONTRACT_MISMATCH', 'a different program with the same name, or a version the adapter does not know: check `sources.deps`')
}

export function cliSpecEngine(spec: CliAdapterSpec, platform: string, deps: Pick<EngineDeps, 'enableCli' | 'agentReachEnabled'>, options: CliLegOptions = {}): Engine {
  return {
    id: options.id ?? spec.id,
    label: options.label ?? spec.bins[0]!,
    available: () => {
      if (disabledBySettings(spec, deps)) return false
      // Before the first probe the command is assumed present; the search itself probes and reports.
      return options.run ? true : (cachedProbe(spec)?.state ?? 'detected') === 'detected'
    },
    async search(query, count, signal) {
      const why = disabledBySettings(spec, deps)
      if (why) throw new CliAdapterError(why, 'CLI_NOT_FOUND', undefined, false)
      let bin = spec.bins[0]!
      if (!options.run) {
        const probe = await probeCli(spec)
        const failure = probeError(spec, probe)
        if (failure) throw failure
        bin = probe.path ?? bin
      }
      const runOptions: CliRunOptions = {
        platform, bin,
        ...options.run ? { run: options.run } : {},
        ...options.env ? { env: options.env } : {},
        ...options.home ? { home: options.home } : {},
        ...options.skipCredentialGate ? { skipCredentialGate: true } : {},
      }
      const sources = await runCliSearch(spec, { query, count, signal }, runOptions)
      return { sources, via: options.id ?? spec.id }
    },
  }
}

export interface SpecReadiness {
  ready: boolean
  installation: 'missing' | 'detected' | 'incompatible'
  version?: string
  path?: string
  /** Absent when the tool needs a login that cannot be checked from here (a keyring, a browser session). */
  credential?: 'not_required' | 'missing' | 'configured'
  /** Why it cannot run, naming what to install or run. */
  reason?: string
  code: 'ok' | 'disabled' | 'cli_missing' | 'cli_incompatible' | 'not_logged_in'
}

/** Local readiness of one spec: settings, contract probe, then the credentials it needs. Never runs a search. */
export async function specReadiness(spec: CliAdapterSpec, deps: Pick<EngineDeps, 'enableCli' | 'agentReachEnabled'>, options: { env?: NodeJS.ProcessEnv; home?: string } = {}): Promise<SpecReadiness> {
  const off = disabledBySettings(spec, deps)
  if (off) return { ready: false, installation: 'missing', credential: 'not_required', reason: spec.id + ': ' + off, code: 'disabled' }
  const probe = await probeCli(spec)
  const base = { installation: probe.state, ...probe.version ? { version: probe.version } : {}, ...probe.path ? { path: probe.path } : {} }
  if (probe.state === 'missing') return { ...base, ready: false, installation: 'missing', credential: 'not_required', reason: spec.id + ': ' + (probe.reason ?? 'not installed'), code: 'cli_missing' }
  if (probe.state === 'incompatible') return { ...base, ready: false, installation: 'incompatible', credential: 'not_required', reason: spec.id + ': ' + (probe.reason ?? 'contract mismatch'), code: 'cli_incompatible' }
  const missing = missingEnv(spec, options.env)
  if (missing.length) return { ...base, ready: false, installation: 'detected', credential: 'missing', reason: spec.id + ': ' + missing.join(' / ') + ' not set (' + loginHint(spec) + ')', code: 'not_logged_in' }
  const saved = savedLoginPresent(spec, options)
  if (saved === false) return { ...base, ready: false, installation: 'detected', credential: 'missing', reason: spec.id + ': no saved login (' + loginHint(spec) + ')', code: 'not_logged_in' }
  const credential = saved === true || (spec.env.required?.length ?? 0) > 0 ? 'configured' as const : spec.needsLogin ? undefined : 'not_required' as const
  return { ...base, ready: true, installation: 'detected', ...credential ? { credential } : {}, code: 'ok' }
}
