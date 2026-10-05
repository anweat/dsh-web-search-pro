/**
 * Validator and renderers for action parameters, plus a checker for closed
 * output schemas (used by tests to hold results to their declared shape).
 * @module web-search-pro/actions/schema
 */

import type { OutputNode, OutputSchema, ParamNode, ParamSchema } from './types.ts'

// --- validation -----------------------------------------------------------

export interface ValidationResult {
  ok: boolean
  value: Record<string, unknown>
  errors: string[]
}

const MAX_ERRORS = 6

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describeType(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

function validateObject(properties: Record<string, ParamNode>, open: boolean, value: unknown, path: string, errors: string[]): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    errors.push(`${path || 'args'}: expected object, got ${describeType(value)}`)
    return undefined
  }
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const node = properties[key]
    if (!node) {
      if (open) out[key] = entry
      else errors.push(`${path ? path + '.' : ''}${key}: unknown argument (allowed: ${Object.keys(properties).join(', ') || 'none'})`)
      continue
    }
    // Models often send null for an omitted optional value; treat it as absent.
    if (entry === null || entry === undefined) continue
    const checked = validateNode(node, entry, `${path ? path + '.' : ''}${key}`, errors)
    if (checked !== undefined) out[key] = checked
  }
  for (const [key, node] of Object.entries(properties)) {
    if (node.required && !(key in out) && !errors.some(error => error.startsWith(`${path ? path + '.' : ''}${key}:`))) {
      errors.push(`${path ? path + '.' : ''}${key}: required`)
    }
  }
  return out
}

function validateNode(node: ParamNode, value: unknown, path: string, errors: string[]): unknown {
  if (errors.length >= MAX_ERRORS) return undefined
  switch (node.type) {
    case 'string':
      if (typeof value !== 'string') { errors.push(`${path}: expected string, got ${describeType(value)}`); return undefined }
      if (node.enum && !node.enum.includes(value)) { errors.push(`${path}: must be one of ${node.enum.join(' | ')}`); return undefined }
      return value
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) { errors.push(`${path}: expected number, got ${describeType(value)}`); return undefined }
      return value
    case 'boolean':
      if (typeof value !== 'boolean') { errors.push(`${path}: expected boolean, got ${describeType(value)}`); return undefined }
      return value
    case 'array': {
      if (!Array.isArray(value)) { errors.push(`${path}: expected array, got ${describeType(value)}`); return undefined }
      if (!node.items) return value
      const items: unknown[] = []
      value.forEach((entry, index) => {
        const checked = validateNode(node.items!, entry, `${path}[${index}]`, errors)
        if (checked !== undefined) items.push(checked)
      })
      return items
    }
    case 'object':
      return validateObject(node.properties ?? {}, node.additionalProperties === true || !node.properties, value, path, errors)
    default:
      return value
  }
}

/** Validate call arguments against an action's parameter schema. */
export function validateArgs(params: ParamSchema, args: unknown): ValidationResult {
  const errors: string[] = []
  const input = args === undefined || args === null ? {} : args
  const value = validateObject(params, false, input, '', errors) ?? {}
  return { ok: errors.length === 0, value, errors }
}

// --- rendering ------------------------------------------------------------

function compactNode(node: ParamNode): string {
  switch (node.type) {
    case 'string': return node.enum ? node.enum.map(value => JSON.stringify(value)).join('|') : 'string'
    case 'number': return 'number'
    case 'boolean': return 'boolean'
    case 'array': return (node.items ? compactNode(node.items) : 'any') + '[]'
    case 'object': return node.properties ? '{' + compactFields(node.properties) + '}' : 'object'
    default: return 'any'
  }
}

function compactFields(properties: Record<string, ParamNode>): string {
  return Object.entries(properties).map(([key, node]) => `${key}${node.required ? '' : '?'}: ${compactNode(node)}`).join(', ')
}

/** One-line parameter summary: `query: string, count?: number`. */
export function compactParams(params: ParamSchema): string {
  return compactFields(params)
}

/** Compact schema block attached to INVALID_ARGS replies. */
export function compactSchema(action: string, params: ParamSchema): string {
  return `${action}(${compactFields(params)})`
}

/** Full parameter listing with descriptions. */
export function describeParams(params: ParamSchema): string[] {
  if (!Object.keys(params).length) return ['  (no arguments)']
  return Object.entries(params).map(([key, node]) => `  ${key}${node.required ? '' : '?'}: ${compactNode(node)}${node.description ? ' - ' + node.description : ''}`)
}

// --- closed output schemas ---------------------------------------------------

/** Violations of `value` against a closed output schema ([] when it conforms). Unknown fields are violations. */
export function checkOutput(schema: OutputSchema, value: unknown): string[] {
  const violations: string[] = []
  const walk = (node: OutputNode, entry: unknown, path: string): void => {
    if (violations.length >= 12) return
    switch (node.type) {
      case 'string': if (typeof entry !== 'string') violations.push(`${path}: expected string, got ${describeType(entry)}`); return
      case 'number': if (typeof entry !== 'number') violations.push(`${path}: expected number, got ${describeType(entry)}`); return
      case 'boolean': if (typeof entry !== 'boolean') violations.push(`${path}: expected boolean, got ${describeType(entry)}`); return
      case 'array':
        if (!Array.isArray(entry)) { violations.push(`${path}: expected array, got ${describeType(entry)}`); return }
        if (node.items) entry.forEach((item, index) => walk(node.items!, item, `${path}[${index}]`))
        return
      case 'object': {
        if (!isRecord(entry)) { violations.push(`${path}: expected object, got ${describeType(entry)}`); return }
        const properties = node.properties
        if (!properties) return
        for (const [key, child] of Object.entries(entry)) {
          if (child === undefined) continue
          const childNode = properties[key]
          if (!childNode) { if (node.additionalProperties !== true) violations.push(`${path}.${key}: not declared in the output schema`); continue }
          walk(childNode, child, `${path}.${key}`)
        }
        for (const [key, child] of Object.entries(properties)) if (child.required && entry[key] === undefined) violations.push(`${path}.${key}: required but missing`)
        return
      }
      default:
    }
  }
  walk(schema, value, 'result')
  return violations
}
