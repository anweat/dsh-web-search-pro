/**
 * Action registry types.
 *
 * Every model-visible capability is one {@link ActionDef}: a name of the form
 * `group.action`, a one-line summary, a parameter schema, an output schema, an
 * approval class, concurrency safety, the function that runs it and the
 * function that renders its result as text. The `indexed` and `flat` tool
 * surfaces are both projections of this one registry, so a capability is
 * defined, validated, approved and executed in exactly one place.
 * @module web-search-pro/actions/types
 */

import type { ResolvedConfig } from '../config.ts'
import type { SearchRouter } from '../router.ts'
import type { FetchService } from '../fetch.ts'
import type { Store } from '../store.ts'
import type { EvidenceService } from '../pipeline/service.ts'
import type { BrowserGetter } from '../browser-access.ts'
import type { ProviderState } from '../provider.ts'

export const ACTION_GROUPS = ['search', 'read', 'history', 'sources', 'rules', 'cache'] as const
export type ActionGroup = typeof ACTION_GROUPS[number]

/**
 * One parameter node. A subset of the Host's tool parameter DSL, so the same
 * nodes feed the flat tool projection unchanged.
 */
export interface ParamNode {
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object'
  description?: string
  enum?: readonly string[]
  /** Marks a property of the enclosing object as required. */
  required?: true
  items?: ParamNode
  properties?: Record<string, ParamNode>
  additionalProperties?: boolean
}

export type ParamSchema = Record<string, ParamNode>

/** A closed output schema: every field optional unless marked `required`. Same DSL as the old tools' `output.schema`. */
export interface OutputNode {
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object'
  required?: true
  items?: OutputNode
  properties?: Record<string, OutputNode>
  additionalProperties?: boolean
}

export interface OutputSchema {
  type: 'object'
  additionalProperties: false
  properties: Record<string, OutputNode>
}

/**
 * How an action is approved.
 * - `none`: runs directly.
 * - `install`: runs an external installer (`sources.install`).
 * - `local-write`: changes or deletes locally stored data (cache, history rows, extraction rules).
 */
export type ApprovalClass = 'none' | 'install' | 'local-write'

export interface ActionExample {
  args: Record<string, unknown>
  note?: string
}

/** What an executing action may touch. Built once by the tool layer; `signal` is per call. */
export interface ActionServices {
  /** Config as resolved at startup (tool timeouts and defaults that were fixed at registration). */
  config: ResolvedConfig
  /** Hot-reloadable config source: read per call. */
  dynamic: () => ResolvedConfig
  store: Store
  router: SearchRouter
  fetch: FetchService
  /** The optional dsh-browser service, read lazily. */
  browser: BrowserGetter
  /** Evidence pipeline (built lazily from the other services). */
  evidence: () => Pick<EvidenceService, 'search'>
  /** State of the ctx.web provider route (registered? selected by the Host?); absent when the host does not report it. */
  providerState?: () => ProviderState
  /** Default characters one text exit may return (config `fetchDefaultChars`). */
  outputCap: () => number
}

export interface ActionContext extends ActionServices {
  signal: AbortSignal
}

export interface ActionDef {
  /** `group.action`. */
  name: string
  group: ActionGroup
  /** One sentence shown in the L1 listing. */
  summary: string
  /** Extra L2 guidance. */
  notes?: string
  params: ParamSchema
  /** Closed schema of the `result` this action returns. */
  output: OutputSchema
  approval: ApprovalClass
  /** Whether it changes stored state or the machine (drives the approval hook and the DEADLINE wording). */
  mutating: boolean
  /** Whether sibling calls may overlap (the old tool's `isConcurrencySafe`). */
  concurrencySafe: boolean
  /** Per-call deadline in ms; exceeded deadlines return DEADLINE. A function of the startup config where the old tool's timeout was. */
  timeoutMs(config: ResolvedConfig): number
  examples?: ActionExample[]
  /** Error codes callers should expect beyond the generic set. */
  errors?: string[]
  /** Whether the action can run right now, for the index listing only; undefined means yes. */
  unavailable?(env: { browserReady: boolean }): string | undefined
  execute(args: Record<string, any>, ctx: ActionContext): Promise<unknown>
  /** The result as the text the model reads. */
  render(result: any, args: Record<string, any>): string
}

/** Raised by an executor for a malformed call that schema validation cannot express. */
export class ActionArgError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message)
    this.name = 'ActionArgError'
  }
}

/** Raised when a referenced stored item does not exist. */
export class ActionNotFoundError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message)
    this.name = 'ActionNotFoundError'
  }
}

export const ERROR_CODES = [
  'INVALID_ARGS', 'UNKNOWN_ACTION', 'CAPABILITY_UNAVAILABLE', 'POLICY_DENIED',
  'DEADLINE', 'CANCELLED', 'NOT_FOUND', 'ACTION_FAILED',
] as const
export type ErrorCode = typeof ERROR_CODES[number]

export interface ActionErrorBody {
  code: ErrorCode
  message: string
  hint?: string
  /** Compact parameter schema, attached to INVALID_ARGS so the model can fix the call at once. */
  schema?: string
}

export interface ActionEnvelope {
  ok: boolean
  action: string
  result?: Record<string, unknown>
  error?: ActionErrorBody
  truncation?: { omitted: number; reason: string }
}
