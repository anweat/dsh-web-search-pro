import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveConfig } from '../src/config.ts'
import { createBuiltinRegistry } from '../src/providers/index.ts'
import { SearchRouter } from '../src/router.ts'
import { Store } from '../src/store.ts'
import { clearProbeCache } from '../src/cli/probe.ts'

/** A real router over a temp store, with the user's `cliAdapters` (and any other settings) given; commands come from `withCommands`. */
export function routerHarness(extra: Record<string, unknown> = {}) {
  clearProbeCache()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-custom-'))
  const store = new Store(path.join(dir, 'store.db'))
  const config = resolveConfig({ engines: ['ddg'], dbPath: path.join(dir, 'store.db'), enableCliBackends: true, opencliEnabled: true, agentReachEnabled: true, ttlSeconds: 60, ...extra } as never)
  const router = new SearchRouter({ get: () => undefined } as never, config, store, () => config, () => undefined, undefined, createBuiltinRegistry())
  const search = (query: string, o: { engines?: string[]; count?: number; multi?: boolean; fresh?: boolean; platform?: string } = {}) => router.search({
    query, count: o.count ?? 5, fresh: o.fresh ?? true, multi: o.multi ?? false, signal: undefined,
    ...o.engines ? { engines: o.engines } : {}, ...o.platform ? { platform: { id: o.platform } as never } : {},
  })
  return { router, store, config, search, cleanup: () => { router.dispose(); store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}
