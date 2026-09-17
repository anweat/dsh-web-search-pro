import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BackendRegistry } from '../src/backend-registry.ts'
import { SearchRouter } from '../src/router.ts'
import { Store } from '../src/store.ts'
import { detectShellPage } from '../src/fetch.ts'

test('router falls back to a later engine when the first returns snippet-less (low-quality) results', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-web-router-fallback-'))
  const store = new Store(path.join(dir, 'store.db'))
  try {
    const config = {
      memoryCacheEntries: 8, ttlSeconds: 60, engines: ['ddg', 'bing'], rrfConstant: 60,
      freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [],
      exaApiKeyEnv: 'EXA_API_KEY', jinaApiKeyEnv: 'JINA_API_KEY', githubTokenEnv: 'GITHUB_TOKEN',
      enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false,
    }
    const router = new SearchRouter({ get: () => undefined } as never, config as never, store)

    // Replace the real ddg/bing backends with stubs (keep the router's assess()).
    const entries = (router as any).backends.entries as Map<string, { probe: () => unknown; run: (i: unknown) => Promise<unknown>; assess?: (v: unknown) => unknown }>
    entries.set('ddg', {
      id: 'ddg',
      probe: async () => ({ available: true }),
      run: async () => ({ sources: [
        { url: 'https://a.example/1', title: 'A' },
        { url: 'https://a.example/2', title: 'B' },
        { url: 'https://a.example/3', title: 'C' },
        { url: 'https://a.example/4', title: 'D' },
      ] }),
      assess: entries.get('ddg')?.assess, // reuse the router's snippet-coverage gate
    })
    entries.set('bing', {
      id: 'bing',
      probe: async () => ({ available: true }),
      run: async () => ({ sources: [
        { url: 'https://b.example/1', title: 'B1', snippet: 'good snippet one' },
        { url: 'https://b.example/2', title: 'B2', snippet: 'good snippet two' },
      ] }),
    })

    const result = await router.search({ query: 'fallback probe', count: 5, fresh: true, multi: false, signal: undefined })
    // The ok engine (bing) must win over the low-quality ddg.
    assert.equal(result.engine, 'bing')
    assert.deepEqual(result.enginesTried, ['ddg', 'bing'])
    assert.ok(result.fallbackNote, 'fallbackNote should explain the fallback')
    assert.match(result.fallbackNote, /ddg/)
    assert.match(result.fallbackNote, /snippets=0\/4/)
  } finally {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('router keeps the first low-quality result when no later engine does better', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-web-router-keep-'))
  const store = new Store(path.join(dir, 'store.db'))
  try {
    const config = {
      memoryCacheEntries: 8, ttlSeconds: 60, engines: ['ddg', 'bing'], rrfConstant: 60,
      freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [],
      exaApiKeyEnv: 'EXA_API_KEY', jinaApiKeyEnv: 'JINA_API_KEY', githubTokenEnv: 'GITHUB_TOKEN',
      enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false,
    }
    const router = new SearchRouter({ get: () => undefined } as never, config as never, store)
    const entries = (router as any).backends.entries as Map<string, { probe: () => unknown; run: (i: unknown) => Promise<unknown>; assess?: (v: unknown) => unknown }>
    entries.set('ddg', {
      id: 'ddg',
      probe: async () => ({ available: true }),
      run: async () => ({ sources: [{ url: 'https://a.example/1', title: 'A' }] }), // 0/1 snippets → low-quality
      assess: entries.get('ddg')?.assess,
    })
    entries.set('bing', {
      id: 'bing',
      probe: async () => ({ available: false, reason: 'down' }),
      run: async () => { throw new Error('unreachable') },
    })

    const result = await router.search({ query: 'keep low quality', count: 5, fresh: true, multi: false, signal: undefined })
    // bing is unavailable → the low-quality ddg result is still returned (better than nothing).
    assert.equal(result.engine, 'ddg')
    // enginesTried stops at the engine that produced the (low-quality) result;
    // bing was rejected by its probe before running, so it is not in the list.
    assert.deepEqual(result.enginesTried, ['ddg'])
    assert.ok(result.fallbackNote, 'should note that ddg was low-quality')
  } finally {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('router does not downgrade metadata-snippet engines (github/bilibili/youtube) to low-quality', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-web-router-meta-'))
  const store = new Store(path.join(dir, 'store.db'))
  try {
    const config = {
      memoryCacheEntries: 8, ttlSeconds: 60, engines: ['github', 'bing'], rrfConstant: 60,
      freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [],
      exaApiKeyEnv: 'EXA_API_KEY', jinaApiKeyEnv: 'JINA_API_KEY', githubTokenEnv: 'GITHUB_TOKEN',
      enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false,
    }
    const router = new SearchRouter({ get: () => undefined } as never, config as never, store)
    const entries = (router as any).backends.entries as Map<string, { probe: () => unknown; run: (i: unknown) => Promise<unknown> }>
    // GitHub-style result: every source carries a structured metadata snippet.
    entries.set('github', {
      id: 'github',
      probe: async () => ({ available: true }),
      run: async () => ({ sources: [
        { url: 'https://github.com/o/r1', title: 'o/r1', snippet: 'repo — ⭐12 [TypeScript]' },
        { url: 'https://github.com/o/r2', title: 'o/r2', snippet: 'repo — ⭐3' },
      ] }),
    })

    const result = await router.search({ query: 'meta snippets', count: 5, fresh: true, multi: false, signal: undefined })
    assert.equal(result.engine, 'github')
    assert.deepEqual(result.enginesTried, ['github'])
    assert.equal(result.fallbackNote, undefined)
  } finally {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('BackendRegistry.runSelected reports per-engine attempts with outcomes', async () => {
  const reg = new BackendRegistry<{ q: string }, { sources: { url: string; snippet?: string }[] }>()
  reg.register({
    id: 'e1',
    probe: async () => ({ available: true }),
    run: async () => ({ sources: [{ url: 'https://x/1' }] }),
    assess: v => {
      const withSnip = v.sources.filter(s => s.snippet).length
      return withSnip / v.sources.length >= 0.5 ? { ok: true } : { ok: true, lowQuality: true, detail: 'snippets=0/1' }
    },
  })
  reg.register({
    id: 'e2',
    probe: async () => ({ available: true }),
    run: async () => ({ sources: [{ url: 'https://x/2', snippet: 'ok' }] }),
  })
  const { id, attempts } = await reg.runSelected({ q: 'q' }, { preferred: ['e1', 'e2'] })
  assert.equal(id, 'e2')
  assert.deepEqual(attempts.map(a => a.id + ':' + a.outcome), ['e1:low-quality', 'e2:ok'])
})

test('detectShellPage flags navigation/form shells but not real prose', () => {
  // Link-dense stub → shell.
  const linkDense = Array.from({ length: 40 }, (_, i) => `[link ${i}](https://example.com/${i})`).join('\n')
  assert.equal(detectShellPage(linkDense), true)
  // Explicit form phrasing with little else → shell.
  assert.equal(detectShellPage('Please search by station id and date range. Enter a query to continue.'), true)
  // Substantive prose → not a shell.
  const prose = 'Ottawa recorded 1,240 mm of snowfall over the 2025-2026 season, well above the 30-year average of 980 mm. The peak month was January with 410 mm, and the earliest season-opening storm arrived on November 18. These figures come from Environment and Climate Change Canada station 50172.'
  assert.equal(detectShellPage(prose), false)
})
