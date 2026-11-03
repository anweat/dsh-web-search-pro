import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { InputError } from './types.ts'
import type { Searcher } from './types.ts'
import { categoriesDocument, errorDocument, SCHEMA_VERSION, searchDocument, sourceInfo } from './output.ts'
import { createSearcher } from './search.ts'
import { loadSnapshot } from './snapshot.ts'
import type { LoadedSnapshot } from './snapshot.ts'
import { SyncError, syncSnapshot } from './sync.ts'
import type { SyncOptions, SyncResult } from './sync.ts'

export interface ServeOptions {
  port?: number
  host?: string
  /** Background sync interval in hours (an immediate sync also runs at startup). */
  refreshHours?: number
  /** Test seam: interval in milliseconds, overrides refreshHours. */
  refreshMs?: number
  allowSync?: boolean
  /** Cache directory (default: cacheHome()). */
  home?: string
  /** Test seam. */
  syncFn?: (opts: SyncOptions) => Promise<SyncResult>
  log?: (line: string) => void
}

export interface RunningServer {
  server: Server
  host: string
  port: number
  url: string
  /** Re-read the snapshot from disk and swap the in-memory index. */
  reload(): void
  close(): Promise<void>
}

const parseBool = (v: string | null): boolean | undefined => {
  if (v === null || v === '') return undefined
  const l = v.toLowerCase()
  if (['true', '1', 'yes'].includes(l)) return true
  if (['false', '0', 'no'].includes(l)) return false
  throw new InputError(`invalid https value "${v}" (expected true|false)`)
}

export async function startServer(opts: ServeOptions = {}): Promise<RunningServer> {
  const host = opts.host ?? '127.0.0.1'
  const log = opts.log ?? ((line: string) => process.stderr.write(line + '\n'))
  const doSync = opts.syncFn ?? syncSnapshot
  let loaded: LoadedSnapshot = loadSnapshot(opts.home ? { home: opts.home } : {})
  let searcher: Searcher = createSearcher(loaded.snapshot)

  const reload = () => {
    const next = loadSnapshot(opts.home ? { home: opts.home } : {})
    searcher = createSearcher(next.snapshot)
    loaded = next
  }

  const send = (res: ServerResponse, status: number, body: unknown, cors: boolean) => {
    const text = JSON.stringify(body)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
      'Cache-Control': 'no-store',
      ...(cors ? { 'Access-Control-Allow-Origin': '*' } : {}),
    })
    res.end(text)
  }

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const method = req.method ?? 'GET'
    const cors = method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
    try {
      if (method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '600' })
        res.end()
        return
      }
      if (path === '/health') {
        if (method !== 'GET' && method !== 'HEAD') return send(res, 405, errorDocument('method_not_allowed', 'use GET'), false)
        return send(res, 200, {
          ok: true, schema_version: SCHEMA_VERSION, entries: loaded.snapshot.entries.length,
          loaded_from: loaded.origin, source: sourceInfo(loaded.snapshot),
        }, cors)
      }
      if (path === '/search') {
        if (method !== 'GET' && method !== 'HEAD') return send(res, 405, errorDocument('method_not_allowed', 'use GET'), false)
        const p = url.searchParams
        const limitRaw = p.get('limit')
        const result = searcher.search(p.get('q') ?? p.get('query') ?? '', {
          ...(limitRaw ? { limit: Number(limitRaw) } : {}),
          ...(p.get('category') ? { category: p.get('category')! } : {}),
          ...(p.get('auth') ? { auth: p.get('auth')! } : {}),
          ...(p.get('cors') ? { cors: p.get('cors')! } : {}),
          ...(parseBool(p.get('https')) !== undefined ? { https: parseBool(p.get('https'))! } : {}),
        })
        return send(res, 200, searchDocument(result, loaded.snapshot), cors)
      }
      if (path === '/categories') {
        if (method !== 'GET' && method !== 'HEAD') return send(res, 405, errorDocument('method_not_allowed', 'use GET'), false)
        return send(res, 200, categoriesDocument(searcher.categories(), loaded.snapshot), cors)
      }
      if (path === '/sync') {
        if (!opts.allowSync) return send(res, 403, errorDocument('sync_disabled', 'start the server with --allow-sync to enable POST /sync'), false)
        if (method !== 'POST') return send(res, 405, errorDocument('method_not_allowed', 'use POST'), false)
        const result = await doSync({ force: url.searchParams.get('force') === '1', ...(opts.home ? { home: opts.home } : {}) })
        if (result.status === 'updated') reload()
        return send(res, 200, { ok: true, schema_version: SCHEMA_VERSION, sync: result }, false)
      }
      return send(res, 404, errorDocument('not_found', `no route ${method} ${path}`), false)
    } catch (error) {
      if (error instanceof InputError) return send(res, 400, errorDocument(error.code, error.message), cors)
      const code = error instanceof SyncError ? error.code : 'internal_error'
      return send(res, error instanceof SyncError ? 502 : 500, errorDocument(code, error instanceof Error ? error.message : String(error)), cors)
    }
  }

  const server = createServer((req, res) => { void handle(req, res) })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 8787, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo

  let timer: NodeJS.Timeout | undefined
  const intervalMs = opts.refreshMs ?? (opts.refreshHours ? opts.refreshHours * 3_600_000 : 0)
  if (intervalMs > 0) {
    let busy = false
    const tick = async () => {
      if (busy) return
      busy = true
      try {
        const result = await doSync({ ...(opts.home ? { home: opts.home } : {}) })
        if (result.status === 'updated') {
          reload()
          log(`refresh: index updated (${result.count} entries, sha ${result.sha ?? 'unknown'})`)
        }
      } catch (error) {
        log(`refresh failed, keeping the current index: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        busy = false
      }
    }
    timer = setInterval(() => { void tick() }, intervalMs)
    void tick()
  }

  return {
    server,
    host,
    port: address.port,
    url: `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`,
    reload,
    close: () => new Promise<void>(resolve => {
      if (timer) clearInterval(timer)
      server.close(() => resolve())
      server.closeAllConnections()
    }),
  }
}
