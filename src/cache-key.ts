import crypto from 'node:crypto'

export interface SearchCacheInput {
  query: string
  engines: readonly string[]
  count: number
  multi: boolean
  exa?: Record<string, unknown>
}

export interface PlatformCacheInput {
  platform: string
  query: string
  url?: string
  count: number
  authProfile?: string
  rulePack?: string
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, canonical(v)]))
  }
  return value
}

function fingerprint(kind: string, input: unknown): string {
  return kind + ':v2:' + crypto.createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex')
}

export function createSearchCacheKey(input: SearchCacheInput): string {
  return fingerprint('search', { ...input, query: input.query.trim().replace(/\s+/g, ' ').toLowerCase() })
}

export function createPlatformCacheKey(input: PlatformCacheInput): string {
  return fingerprint('platform', { ...input, query: input.query.trim().replace(/\s+/g, ' ').toLowerCase() })
}
