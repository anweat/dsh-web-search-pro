import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { Config } from '../src/config.ts'
import { WebSearchSettingsController } from '../src/client/form.ts'

/** A Host settings scope in memory: top-level `set` / `unset` like the real one, with a base (composition) and a user layer. */
export class ScopeStub implements SettingsScope<Record<string, unknown>> {
  /** One entry per op the card sent, `set:evidence.maxRounds` / `unset:provider.deadlineMs`: what reached the Host. */
  readonly writes: string[] = []
  /** Every `mutate` call, with the ops as sent. */
  readonly mutations: { ops: { op: string; path: string[]; value?: unknown }[]; revision: number | undefined }[] = []
  /** Paths the stub refused, as the Host does for an edit that is not beneath a volatile field of the plugin schema. */
  readonly refused: string[] = []
  private readonly listeners = new Set<() => void>()
  private snapshotValue: SettingsScopeSnapshot<Record<string, unknown>>

  constructor(base: Record<string, unknown>, user: Record<string, unknown> = {}, private readonly inherit = false) {
    this.snapshotValue = {
      status: 'ready', value: deepMergeValue(base, user) as Record<string, unknown>, base: structuredClone(base), user: structuredClone(user),
      revision: 0, writable: true, mode: 'host',
    }
  }

  getSnapshot(): SettingsScopeSnapshot<Record<string, unknown>> { return this.snapshotValue }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * The Host's `mutate`: ops are applied in order to the user layer (a `set` writes the value at the path; an `unset` puts the
   * field back to what the composition layer holds, or removes it), all or nothing. The Host refuses an edit whose path is not
   * beneath a volatile node of the plugin's Config schema (dsh-settings `isVolatilePath`): so does the stub, and it records the path.
   */
  async mutate(ops: readonly { op: string; path: string[]; value?: unknown }[], revision?: number): Promise<boolean> {
    this.mutations.push({ ops: structuredClone(ops) as never, revision })
    for (const op of ops) {
      if (!isVolatilePath(Config as unknown as SchemaNode, op.path)) { this.refused.push(op.path.join('.')); return false }
    }
    const user = structuredClone(this.snapshotValue.user) as Record<string, unknown>
    const base = this.snapshotValue.base as Record<string, unknown>
    for (const op of ops) {
      this.writes.push(op.op + ':' + op.path.join('.'))
      if (op.op === 'set') { setAt(user, op.path, structuredClone(op.value)); continue }
      // The Host puts the field back to what the composition layer holds there; in the harness that layer carries the defaults the card
      // shows, which a real profile's bundle patch does not, so by default a reset removes the leaf (its parents stay, as on the Host).
      const inherited = this.inherit ? getAtPath(base, op.path) : undefined
      if (inherited !== undefined) setAt(user, op.path, structuredClone(inherited))
      else deleteAt(user, op.path)
    }
    this.snapshotValue = { ...this.snapshotValue, value: deepMergeValue(base, user) as Record<string, unknown>, user, revision: (this.snapshotValue.revision ?? 0) + 1 }
    for (const listener of this.listeners) listener()
    return true
  }
  async set(): Promise<void> { throw new Error('the card must write through mutate, at field paths') }
  async unset(): Promise<void> { throw new Error('the card must write through mutate, at field paths') }
  async dispose(): Promise<void> {}

  /** What is stored in the user layer. */
  get user(): Record<string, unknown> { return this.snapshotValue.user as Record<string, unknown> }
}

export interface SchemaNode { meta?: { volatile?: boolean }; dict?: Record<string, SchemaNode>; inner?: SchemaNode }
/** dsh-settings `isVolatilePath`: the path lies beneath a node declared volatile. */
export function isVolatilePath(schema: SchemaNode, path: readonly string[]): boolean {
  if (schema.meta?.volatile) return true
  const [key, ...rest] = path
  const child = key === undefined ? undefined : schema.dict?.[key]
  return child !== undefined && isVolatilePath(child, rest)
}
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
function getAtPath(root: unknown, path: readonly string[]): unknown { let n = root; for (const k of path) { if (!isObj(n)) return undefined; n = n[k] } return n }
function setAt(root: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let n = root
  for (const k of path.slice(0, -1)) { if (!isObj(n[k])) n[k] = {}; n = n[k] as Record<string, unknown> }
  n[path[path.length - 1]!] = value
}
function deleteAt(root: Record<string, unknown>, path: readonly string[]): void {
  const parents: Record<string, unknown>[] = [root]
  let n: unknown = root
  for (const k of path.slice(0, -1)) { n = isObj(n) ? n[k] : undefined; if (!isObj(n)) return; parents.push(n) }
  delete parents[parents.length - 1]![path[path.length - 1]!]
}
function deepMergeValue(base: unknown, over: unknown): unknown {
  if (!isObj(base) || !isObj(over)) return over === undefined ? structuredClone(base) : structuredClone(over)
  const out: Record<string, unknown> = structuredClone(base)
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMergeValue(base[k], v) : structuredClone(v)
  return out
}

/** Defaults a Host section carries for the plain top-level fields. */
export const BASE = {
  engines: ['seam', 'exa', 'ddg'], parallelEngines: false, searchMaxResults: 8, timeoutMs: 30_000,
  exaApiKeyEnv: 'EXA_API_KEY', jinaApiKeyEnv: 'JINA_API_KEY', githubTokenEnv: 'GITHUB_TOKEN',
  enableCliBackends: true, opencliEnabled: true, agentReachEnabled: true,
  providerId: 'web-search-pro', registerProvider: false, playwright: { enabled: true },
  ttlSeconds: 3600, memoryCacheEntries: 128, rrfConstant: 60, freshnessBoost: 0.2,
  freshnessDays: 30, authorityBoost: 0.25, authorityDomains: [], verbose: false,
}

export function harness(base: Record<string, unknown> = BASE, user: Record<string, unknown> = {}) {
  const scope = new ScopeStub(base, user)
  const credentialValues = new Map<string, string>()
  const described: string[][] = []
  const ctx = {
    remote: {
      credentials: {
        async describe(refs: string[]) {
          described.push(refs)
          return { ok: true, value: Object.fromEntries(refs.map(ref => [ref, { configured: credentialValues.has(ref), writable: true }])) }
        },
        async set(ref: string, value: string) {
          credentialValues.set(ref, value)
          return { ok: true, value: { ref } }
        },
      },
    },
  }
  const controller = new WebSearchSettingsController(scope, ctx as never)
  return { scope, credentialValues, described, controller }
}
