/**
 * Search-provider registry (design §4, dev-plan M6): a descriptor (what a source
 * is: id, languages, task profiles, filters, requirements, cost) plus a runtime
 * (`probeLocal`: local readiness without network; `create`: the Engine). Built-in
 * engines and any later adapter use the same shape; adding a source is one
 * descriptor + adapter file and a `register` call, not an edit of the core.
 *
 * Ids are namespaced and stable (`builtin:ddg`, `vendor:name`); `aliases` keep the
 * short legacy ids (`ddg`) working. The id that appears in tool output, history,
 * cache keys and backend state is the ROUTE id: the first alias when there is one,
 * else the full id, so existing records and tests keep their names.
 * Nothing here loads code dynamically: only adapters handed to `register` exist.
 * @module web-search-pro/providers/registry
 */

import type { Engine, EngineDeps } from '../engines.ts'
import type { BrowserMethod } from '../browser-access.ts'
import type { ResolvedConfig } from '../config.ts'
import type { CompiledQuery } from '../pipeline/compile.ts'
import type { TaskSpec } from '../pipeline/types.ts'

export type Operation = 'search'

/** `web`: a general search engine; `platform`: one site or community (addressable as `search.run platform=<route id>`). */
export type ProviderKind = 'web' | 'platform'

/** A thing a provider needs before it can run. `env` lists credential / environment names, tried in order. */
export interface Requirement {
  kind: 'key' | 'cli' | 'browser' | 'service'
  /** Stable name: `bocha-key`, `mcporter`, `dsh-browser`. */
  id: string
  /** `key`: credentials refs / environment variables, first configured one wins. */
  env?: readonly string[]
  /** Not needed for the provider to run (a fallback path exists). */
  optional?: boolean
  note?: string
}

export interface CostDescriptor {
  kind: 'free' | 'metered' | 'subscription' | 'unknown'
  /** What one billed unit is (`request`). */
  unit?: string
  note?: string
}

export interface ProviderDescriptor {
  /** Namespaced, stable: `builtin:ddg`. */
  id: string
  /** Legacy / short ids accepted wherever an engine id is (`ddg`). The first one is the route id used in outputs. */
  aliases: readonly string[]
  label: string
  adapterVersion: string
  contractVersion: 1
  operations: readonly Operation[]
  /** Profiles (docs_code, news_fact, academic, experience, compare, general) the provider is a sensible source for. */
  taskProfiles: readonly string[]
  /**
   * Languages (ISO 639-1: `zh`, `en`) the provider is STRONG in. `*` = language-agnostic. The planner prefers a
   * provider that names the task's language over language-agnostic ones.
   */
  languages: readonly string[]
  /** Regions it covers or is tuned for (`cn`, `global`); informational. */
  regions: readonly string[]
  /** What it returns (`web`, `code`, `paper`, `video`, `forum`). */
  resultKinds: readonly string[]
  /**
   * Shared upstream index (`google` for Serper and SerpAPI). Absent = unknown: never read as independent, and
   * providers with the same family do not count as independent evidence.
   */
  sourceFamily?: string
  requirements: readonly Requirement[]
  /**
   * Constraint kinds the provider enforces NATIVELY (`site`, `exclude_site`, `exclude_term`, `time_window`, `category`).
   * A hard constraint outside this list is verified locally and reported as such, never silently ignored.
   */
  supportedFilters: readonly string[]
  costModel: CostDescriptor
  /** Order among providers promoted for a language (lower first, default 100). */
  priority?: number
  /** Default `web`. A `platform` provider is never added to a plan on its own, only by an explicit source choice or a hard `site` constraint naming one of its `domains`. */
  kind?: ProviderKind
  /** Site domains a `platform` provider covers (`zhihu.com`): a hard `site` constraint on one of them selects it. */
  domains?: readonly string[]
  /** Method of the optional dsh-browser service the provider needs to run; absent = it does not need the browser. */
  needsBrowser?: BrowserMethod
  /** Only a recorded live check (version, date, result) sets `live`; absent / false = not verified against the real service. */
  verification?: { live: boolean; note?: string }
}

export type InstallationState = 'missing' | 'detected' | 'incompatible' | 'not_required'
export type CredentialState = 'not_required' | 'missing' | 'configured' | 'rejected'
export type Health = 'unknown' | 'ready' | 'degraded' | 'cooldown' | 'error'

/**
 * Local readiness, by dimension (design §4.3). `available` is the only field the router acts on: false = do not
 * run it. Everything else explains or refines: a `configured` credential is a local fact, not proof the service accepts it.
 */
export interface Readiness {
  available: boolean
  installation?: InstallationState
  credential?: CredentialState
  health?: Health
  reason?: string
  diagnosticCode?: string
}

/** What `probeLocal` may look at: resolved dependencies and settings, plus CLI presence when the caller scanned it. No network. */
export interface ProbeEnv {
  deps: EngineDeps
  config: ResolvedConfig
  cli?: ReadonlyMap<string, boolean> | undefined
}

export interface ProviderAdapter {
  descriptor: ProviderDescriptor
  /** Local readiness: declared services, keys, commands. No network, no login, no model call. */
  probeLocal(env: ProbeEnv): Readiness | Promise<Readiness>
  create(deps: EngineDeps, config: ResolvedConfig): Engine
  /** Optional native query compilation (constraints -> provider options); absent = the core compiler's rules / plain query. */
  compile?(task: Pick<TaskSpec, 'goal' | 'query' | 'needs' | 'constraints'>, now: Date): CompiledQuery
}

/** The id under which a provider appears in tool output, history, cache keys and backend state. */
export function routeIdOf(descriptor: Pick<ProviderDescriptor, 'id' | 'aliases'>): string {
  return descriptor.aliases[0] ?? descriptor.id
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._-]*)?$/

export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>()
  /** Every accepted spelling (full id and aliases) -> full id. */
  private readonly names = new Map<string, string>()
  private readonly listeners = new Set<() => void>()
  private version = 0

  /**
   * Add an adapter. A duplicate id, or an alias / id that another provider already owns, throws: nothing is
   * replaced silently. Returns the unregister function (stops new scheduling; in-flight calls finish).
   */
  register(adapter: ProviderAdapter): () => void {
    const d = adapter.descriptor
    if (!d || typeof d.id !== 'string' || !ID_PATTERN.test(d.id)) throw new Error('invalid provider id: ' + String(d?.id))
    if (this.adapters.has(d.id)) throw new Error('duplicate provider id: ' + d.id)
    const spellings = [d.id, ...d.aliases]
    for (const name of spellings) {
      if (!name || /[\s,]/.test(name)) throw new Error('invalid provider alias for ' + d.id + ': "' + name + '"')
      const owner = this.names.get(name)
      if (owner !== undefined) throw new Error('provider ' + d.id + ': "' + name + '" is already used by ' + owner)
    }
    if (new Set(spellings).size !== spellings.length) throw new Error('provider ' + d.id + ': duplicate alias')
    this.adapters.set(d.id, adapter)
    for (const name of spellings) this.names.set(name, d.id)
    this.touch()
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.adapters.get(d.id) !== adapter) return
      this.adapters.delete(d.id)
      for (const name of spellings) if (this.names.get(name) === d.id) this.names.delete(name)
      this.touch()
    }
  }

  /** The adapter for a full id or alias (case-sensitive, trimmed), or undefined. */
  resolve(idOrAlias: string): ProviderAdapter | undefined {
    const full = this.names.get(idOrAlias.trim())
    return full === undefined ? undefined : this.adapters.get(full)
  }

  /** Route id for a full id or alias; undefined when unknown. */
  routeId(idOrAlias: string): string | undefined {
    const adapter = this.resolve(idOrAlias)
    return adapter ? routeIdOf(adapter.descriptor) : undefined
  }

  list(filter: { operation?: Operation } = {}): ProviderAdapter[] {
    return [...this.adapters.values()].filter(a => !filter.operation || a.descriptor.operations.includes(filter.operation))
  }

  /** Route ids of every provider that can search, registration order. */
  searchIds(): string[] {
    return this.list({ operation: 'search' }).map(a => routeIdOf(a.descriptor))
  }

  /** Route ids of the providers of kind `platform` (`search.run platform=`), registration order. */
  platformIds(): string[] {
    return this.list({ operation: 'search' }).filter(a => a.descriptor.kind === 'platform').map(a => routeIdOf(a.descriptor))
  }

  /** Normalise a list of ids (aliases, full ids) to route ids, dropping repeats; unknown ids are returned apart. */
  normalize(ids: readonly string[]): { ids: string[]; unknown: string[] } {
    const out: string[] = []
    const unknown: string[] = []
    for (const raw of ids) {
      const route = this.routeId(raw)
      if (route === undefined) { if (!unknown.includes(raw)) unknown.push(raw); continue }
      if (!out.includes(route)) out.push(route)
    }
    return { ids: out, unknown }
  }

  /** Message for ids the registry does not know, listing what is available. */
  unknownMessage(unknown: readonly string[]): string {
    return 'unknown engine: ' + unknown.join(', ') + ' (available: ' + this.searchIds().join(', ') + ')'
  }

  /** Throws the "unknown engine" error when any id is unknown; otherwise returns the route ids (aliases accepted). */
  validate(ids: readonly string[]): string[] {
    const { ids: route, unknown } = this.normalize(ids)
    if (unknown.length) throw new Error(this.unknownMessage(unknown))
    return route
  }

  /** Called after every register / unregister (the router syncs its backends). Returns the unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Bumped on every change, so a consumer can tell whether its copy is stale. */
  get revision(): number { return this.version }

  private touch(): void {
    this.version++
    for (const listener of this.listeners) { try { listener() } catch { /* a listener must not break registration */ } }
  }
}
