/**
 * Tiny flag parser shared by the bench CLIs: `--flag value` and boolean `--flag`.
 * @module bench/cli
 */

export interface FlagSpec {
  /** Flags that take a value. */
  values: readonly string[]
  /** Boolean flags. */
  booleans: readonly string[]
}

export function parseFlags(argv: readonly string[], spec: FlagSpec): Record<string, string | true> {
  const out: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) throw new Error('unexpected argument: ' + arg)
    const name = arg.slice(2)
    if (spec.booleans.includes(name)) { out[name] = true; continue }
    if (!spec.values.includes(name)) throw new Error('unknown argument: ' + arg)
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(arg + ' needs a value')
    out[name] = v
    i++
  }
  return out
}

export function numberFlag(flags: Record<string, string | true>, name: string, fallback: number): number {
  const v = flags[name]
  if (v === undefined) return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error('--' + name + ' must be a number')
  return n
}

export function listFlag(flags: Record<string, string | true>, name: string): string[] | undefined {
  const v = flags[name]
  return typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
