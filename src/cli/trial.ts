/**
 * The trial run of a custom CLI spec (settings card, "Try it"): what a search with the draft spec would do, shown before it is saved.
 * It is a real run, not a simulation: the spec is validated by the rule every spec goes through (the read-only guard, no shell, no
 * credentials in argv), the command is probed (version and help only), then ONE search for the sample query runs through the same
 * runner with the spec's own timeout and output cap. The first results and the tool's own words come back; secrets are redacted,
 * a login is never run, and nothing is stored.
 * @module web-search-pro/cli/trial
 */

import { capText, type runCli } from '../util.ts'
import type { TrialResult } from '../rpc-types.ts'
import { probeCli } from './probe.ts'
import { CliAdapterError, runCliSearchDetailed } from './runner.ts'
import { validateCliAdapterSpec } from './spec.ts'

export interface TrialOptions {
  /** `enableCliBackends`: with it off no custom command runs, trial or search. */
  enabled: boolean
  signal?: AbortSignal
  /** Test seams. */
  run?: typeof runCli
  env?: NodeJS.ProcessEnv
}

/** Results shown, and the characters of the tool's own words kept. */
const SHOWN = 3
const RAW_CHARS = 1_200
const SNIPPET_CHARS = 240

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

export async function trialCli(id: string, rawSpec: unknown, query: string, options: TrialOptions): Promise<TrialResult> {
  if (!options.enabled) return { ok: false, stage: 'disabled', message: 'CLI backends are disabled in settings (enableCliBackends): no custom command runs.' }
  const checked = validateCliAdapterSpec(isRecord(rawSpec) ? { ...rawSpec, id } : rawSpec, 'user')
  if (!checked.ok || !checked.spec) return { ok: false, stage: 'validate', message: 'the spec is not valid: nothing was run', errors: checked.errors }
  const spec = checked.spec
  const text = query.trim() || 'test'
  const started = Date.now()

  const probe = await probeCli({ id: 'custom-cli:' + id, bins: spec.bins, probe: spec.probe, packageNote: spec.packageNote, env: spec.env }, { force: true, ...options.run ? { run: options.run } : {} })
  if (probe.state !== 'detected') {
    return { ok: false, stage: 'probe', message: probe.state === 'missing' ? 'the command is not installed: ' + (probe.reason ?? spec.bins.join(' / ')) : 'the command does not match the probe of this spec: ' + (probe.reason ?? 'contract mismatch'), elapsedMs: Date.now() - started }
  }

  let raw = ''
  try {
    const { sources } = await runCliSearchDetailed(spec, { query: text, count: SHOWN, ...options.signal ? { signal: options.signal } : {} }, {
      bin: probe.path ?? spec.bins[0]!,
      ...options.run ? { run: options.run } : {},
      ...options.env ? { env: options.env } : {},
      observe: result => { raw = (result.stdout.trim() ? result.stdout : result.stderr || result.stdout).trim() },
    })
    return {
      ok: true, stage: 'search', probe: { ...probe.version ? { version: probe.version } : {}, ...probe.path ? { path: probe.path } : {} },
      sources: sources.slice(0, SHOWN).map(source => ({ url: source.url, ...source.title ? { title: source.title } : {}, ...source.snippet ? { snippet: capText(source.snippet, SNIPPET_CHARS) } : {}, ...source.publishedAt ? { publishedAt: source.publishedAt } : {} })),
      total: sources.length, raw: raw.length > RAW_CHARS ? raw.slice(0, RAW_CHARS) + '\n… [cut]' : raw, elapsedMs: Date.now() - started,
    }
  } catch (error) {
    if (options.signal?.aborted) throw error
    const message = error instanceof Error ? error.message : String(error)
    const code = (error as { code?: unknown } | null)?.code
    return {
      ok: false, stage: 'search', message, ...typeof code === 'string' ? { code } : {},
      ...error instanceof CliAdapterError && error.hint ? { hint: error.hint } : {},
      ...raw ? { raw: raw.length > RAW_CHARS ? raw.slice(0, RAW_CHARS) + '\n… [cut]' : raw } : {}, elapsedMs: Date.now() - started,
    }
  }
}
