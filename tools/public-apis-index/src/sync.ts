import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseReadmeDetailed } from './parser.ts'
import { RAW_README_URL, SOURCE_REPO, cachePath, cacheHome, readSnapshotFile, writeSnapshotFile } from './snapshot.ts'
import type { Snapshot } from './types.ts'

export const COMMITS_API_URL = 'https://api.github.com/repos/public-apis/public-apis/commits/master'
export const DEFAULT_TIMEOUT_MS = 30_000

export class SyncError extends Error {
  code: string
  constructor(message: string, code = 'sync_failed') {
    super(message)
    this.name = 'SyncError'
    this.code = code
  }
}

export interface SyncOptions {
  /** Re-download and rewrite even when the upstream sha is unchanged. */
  force?: boolean
  /** A README.md file or a cloned repo directory; no network is used. */
  from?: string
  /** Raw README URL (mirrors). */
  url?: string
  /** Cache directory (default: cacheHome()). */
  home?: string
  timeoutMs?: number
  /** Test seam. */
  fetchImpl?: typeof fetch
  /** Override the commits API endpoint (mirrors); an empty string disables the lookup. */
  commitsUrl?: string
}

export interface SyncResult {
  status: 'updated' | 'unchanged'
  mode: 'network' | 'local'
  count: number
  skipped: number
  sha: string | null
  previousSha: string | null
  commitDate: string | null
  fetchedAt: string
  path: string
}

const PROXY_HINT = 'behind an HTTP proxy Node 24 needs NODE_USE_ENV_PROXY=1 (with HTTPS_PROXY set)'

function describeFetchError(error: unknown, what: string, timeoutMs: number): SyncError {
  const e = error as { name?: string; message?: string; cause?: { code?: string; message?: string } }
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    return new SyncError(`timed out after ${Math.round(timeoutMs / 1000)}s fetching ${what}; ${PROXY_HINT}`, 'timeout')
  }
  const detail = e?.cause?.code ?? e?.cause?.message ?? e?.message ?? String(error)
  return new SyncError(`network error fetching ${what}: ${detail}; ${PROXY_HINT}`, 'network')
}

export interface CommitInfo {
  sha: string | null
  commitDate: string | null
}

/** Latest upstream commit; returns nulls on any failure (rate limit, offline mirror): sha is optional. */
export async function fetchCommitInfo(opts: Pick<SyncOptions, 'timeoutMs' | 'fetchImpl' | 'commitsUrl'>): Promise<CommitInfo> {
  const nothing: CommitInfo = { sha: null, commitDate: null }
  const url = opts.commitsUrl ?? COMMITS_API_URL
  if (!url) return nothing
  const f = opts.fetchImpl ?? fetch
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'public-apis-index' }
  const token = process.env.GITHUB_TOKEN?.trim()
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const res = await f(url, { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) })
    if (!res.ok) return nothing
    const body = (await res.json()) as { sha?: unknown; commit?: { committer?: { date?: unknown }; author?: { date?: unknown } } }
    const sha = typeof body.sha === 'string' && /^[0-9a-f]{7,64}$/i.test(body.sha) ? body.sha : null
    const date = body.commit?.committer?.date ?? body.commit?.author?.date
    return { sha, commitDate: typeof date === 'string' ? date : null }
  } catch {
    return nothing
  }
}

function git(dir: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim() || null
  } catch {
    return null
  }
}

function readLocal(from: string): { md: string; file: string; info: CommitInfo } {
  const abs = resolve(from)
  if (!existsSync(abs)) throw new SyncError(`--from path does not exist: ${abs}`, 'bad_argument')
  if (statSync(abs).isDirectory()) {
    const file = join(abs, 'README.md')
    if (!existsSync(file)) throw new SyncError(`no README.md in directory: ${abs}`, 'bad_argument')
    return { md: readFileSync(file, 'utf8'), file, info: { sha: git(abs, ['rev-parse', 'HEAD']), commitDate: git(abs, ['log', '-1', '--format=%cI']) } }
  }
  return { md: readFileSync(abs, 'utf8'), file: abs, info: { sha: null, commitDate: null } }
}

/** Explicit sync into the cache dir. The only code path (besides serve --refresh) that may use the network. */
export async function syncSnapshot(opts: SyncOptions = {}): Promise<SyncResult> {
  const home = opts.home ?? cacheHome()
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const file = cachePath(home)
  const previous = existsSync(file) ? readSnapshotFile(file) : null
  const previousSha = previous?.source.sha ?? null

  let md: string
  let info: CommitInfo
  let sourceUrl: string
  let mode: SyncResult['mode']
  if (opts.from) {
    const local = readLocal(opts.from)
    md = local.md
    info = local.info
    sourceUrl = pathToFileURL(local.file).href
    mode = 'local'
    if (info.sha && info.sha === previousSha && !opts.force) {
      return unchanged(previous!, previousSha, file, 'local')
    }
  } else {
    mode = 'network'
    sourceUrl = opts.url ?? RAW_README_URL
    info = await fetchCommitInfo(opts)
    if (previous && info.sha && info.sha === previousSha && !opts.force) {
      return unchanged(previous, previousSha, file, 'network')
    }
    const f = opts.fetchImpl ?? fetch
    try {
      const res = await f(sourceUrl, { headers: { 'User-Agent': 'public-apis-index' }, signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) throw new SyncError(`HTTP ${res.status} ${res.statusText} fetching ${sourceUrl}`, 'http')
      md = await res.text()
    } catch (error) {
      if (error instanceof SyncError) throw error
      throw describeFetchError(error, sourceUrl, timeoutMs)
    }
  }

  const { entries, skipped } = parseReadmeDetailed(md)
  if (entries.length === 0) {
    throw new SyncError(`parsed 0 entries from ${sourceUrl}; keeping the existing snapshot`, 'parse_failed')
  }
  const snapshot: Snapshot = {
    schemaVersion: 1,
    source: { repo: SOURCE_REPO, sha: info.sha, commitDate: info.commitDate, fetchedAt: new Date().toISOString(), url: sourceUrl },
    entries,
  }
  writeSnapshotFile(file, snapshot)
  return {
    status: 'updated', mode, count: entries.length, skipped: skipped.length,
    sha: info.sha, previousSha, commitDate: info.commitDate, fetchedAt: snapshot.source.fetchedAt, path: file,
  }
}

function unchanged(previous: Snapshot, sha: string | null, path: string, mode: SyncResult['mode']): SyncResult {
  return {
    status: 'unchanged', mode, count: previous.entries.length, skipped: 0, sha, previousSha: sha,
    commitDate: previous.source.commitDate, fetchedAt: previous.source.fetchedAt, path,
  }
}
