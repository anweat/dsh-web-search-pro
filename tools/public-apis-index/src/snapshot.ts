import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ApiEntry, Snapshot } from './types.ts'

export const SOURCE_REPO = 'public-apis/public-apis'
export const RAW_README_URL = 'https://raw.githubusercontent.com/public-apis/public-apis/master/README.md'

/** Cache directory: $PUBLIC_APIS_INDEX_HOME, else ~/.cache/public-apis-index. */
export function cacheHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.PUBLIC_APIS_INDEX_HOME?.trim()
  return fromEnv ? fromEnv : join(homedir(), '.cache', 'public-apis-index')
}

export function cachePath(home = cacheHome()): string {
  return join(home, 'snapshot.json')
}

/** data/snapshot.json sits one level above both src/ and dist/. */
export function bundledPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'snapshot.json')
}

const isStr = (v: unknown): v is string => typeof v === 'string'

export function isValidSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false
  const s = value as Partial<Snapshot>
  if (s.schemaVersion !== 1 || !s.source || typeof s.source !== 'object' || !Array.isArray(s.entries)) return false
  if (!isStr(s.source.fetchedAt)) return false
  return s.entries.every(
    (e: Partial<ApiEntry>) =>
      !!e && isStr(e.id) && isStr(e.name) && isStr(e.url) && isStr(e.description) && isStr(e.category) &&
      isStr(e.categorySlug) && isStr(e.auth) && typeof e.https === 'boolean' && isStr(e.cors),
  )
}

/** One entry per line keeps the bundled file diff-friendly. */
export function serializeSnapshot(snapshot: Snapshot): string {
  const head = JSON.stringify({ schemaVersion: snapshot.schemaVersion, source: snapshot.source })
  const body = snapshot.entries.map(e => JSON.stringify(e)).join(',\n')
  return head.slice(0, -1) + ',"entries":[\n' + body + '\n]}\n'
}

/** Atomic write: temp file in the same directory, then rename. */
export function writeSnapshotFile(file: string, snapshot: Snapshot): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmp, serializeSnapshot(snapshot))
    renameSync(tmp, file)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}

export function readSnapshotFile(file: string): Snapshot | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return isValidSnapshot(parsed) ? parsed : null
  } catch {
    return null
  }
}

export interface LoadedSnapshot {
  snapshot: Snapshot
  origin: 'cache' | 'bundled'
  path: string
}

export interface LoadOptions {
  /** Cache directory (default: cacheHome()). */
  home?: string
  /** Skip the cache and use the bundled snapshot. */
  bundledOnly?: boolean
}

/** Never touches the network. Cache snapshot if valid, else the bundled one. */
export function loadSnapshot(opts: LoadOptions = {}): LoadedSnapshot {
  if (!opts.bundledOnly) {
    const file = cachePath(opts.home)
    if (existsSync(file)) {
      const snapshot = readSnapshotFile(file)
      if (snapshot) return { snapshot, origin: 'cache', path: file }
    }
  }
  const file = bundledPath()
  const snapshot = readSnapshotFile(file)
  if (!snapshot) throw new Error(`bundled snapshot is missing or invalid: ${file}`)
  return { snapshot, origin: 'bundled', path: file }
}
