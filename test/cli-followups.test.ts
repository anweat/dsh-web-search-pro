import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveConfig } from '../src/config.ts'
import { createBuiltinRegistry } from '../src/providers/index.ts'
import { SearchRouter } from '../src/router.ts'
import { Store } from '../src/store.ts'
import { clearProbeCache } from '../src/cli/probe.ts'
import { builtinSpecById } from '../src/cli/builtin-specs.ts'
import { mapCliItemsDetailed, parseCliItems, runCliSearchDetailed } from '../src/cli/runner.ts'
import { findAction } from '../src/actions/registry.ts'
import { checkOutput } from '../src/actions/schema.ts'
import { BROWSER_020 } from './browser-stub.ts'
import { callAction, renderResult } from './call-helper.ts'
import { posix, withCommands } from './cli-helpers.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: 'data:text/javascript,export const defineTool = value => value', shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const { registerTools } = await import('../src/tools.ts')
const { EvidenceService } = await import('../src/pipeline/service.ts')

const fixture = (name: string): string => fs.readFileSync(new URL('./fixtures/cli/' + name, import.meta.url), 'utf8')
const BILI_HELP = 'case "$1" in --version) echo "bili, version 0.6.2";; search) if [ "$2" = "--help" ]; then echo "--type --max --json"; else cat "$0.out"; fi;; esac'

function harness(extra: Record<string, unknown> = {}, browser = true) {
  clearProbeCache()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-followups-'))
  const store = new Store(path.join(dir, 'store.db'))
  const holder: { browser: any } = {
    browser: browser ? {
      ...BROWSER_020, render: async () => ({}), snapshot: async () => ({}), close: async () => {}, searchResults: async () => [],
      opencli: async () => ({ code: 0, stdout: '- url: https://www.xiaohongshu.com/n/1\n  title: browser note\n', stderr: '' }),
    } : undefined,
  }
  const config = resolveConfig({ engines: ['ddg'], dbPath: path.join(dir, 'store.db'), enableCliBackends: true, opencliEnabled: true, agentReachEnabled: true, ttlSeconds: 60, timeoutMs: 5_000, ...extra } as never)
  const router = new SearchRouter({ get: () => undefined } as never, config, store, () => config, () => holder.browser, undefined, createBuiltinRegistry())
  const fetchSvc = { fetchPage: async (url: string) => ({ url, title: 'Page', text: 'DeepSeek local deployment guide: install ollama, pull the model, run it locally with a UI.\n\nHardware needs depend on the model size.', source: 'http', shellPage: false }) }
  const service = new EvidenceService({ router, fetch: fetchSvc as never, store, dynamic: () => config })
  const definitions = new Map<string, any>()
  registerTools({ ctx: { tools: { register: (d: any) => definitions.set(d.name, d) } } as any, config, dynamic: () => config, store, router, fetch: fetchSvc as never, browser: () => holder.browser, evidence: service })
  return { router, store, service, definitions, config, cleanup: () => { router.dispose(); store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

// ── fix 3: results without a link ───────────────────────────────────────────

test('bili: an item without a bvid (course / series entry, captured live 2026-10-07) is skipped and counted; an item link is used when the tool gives one', () => {
  const spec = builtinSpecById('bili')!
  const items = parseCliItems(spec, spec.search.output, fixture('live-bili-search-nolink.json'))
  const mapped = mapCliItemsDetailed(spec.search.output, items, 3)
  assert.equal(mapped.sources.length, 2)
  assert.equal(mapped.skipped, 1)
  assert.equal(mapped.sources[0]!.url, 'https://www.bilibili.com/video/BV1PiNaeTEjn')
  const linked = mapCliItemsDetailed(spec.search.output, [{ bvid: '', title: 'Course', url: 'https://www.bilibili.com/cheese/play/ss1' }, { bvid: '', title: 'x' }], 3)
  assert.deepEqual(linked.sources.map(s => s.url), ['https://www.bilibili.com/cheese/play/ss1'])
  assert.equal(linked.skipped, 1)
})

test('bili through the router: count 3 returns 2 and the fallbackNote says "1 result without a link skipped"; the note survives the cache', { skip: !posix }, async () => {
  await withCommands({ bili: BILI_HELP }, async dir => {
    fs.writeFileSync(path.join(dir, 'bili.out'), fixture('live-bili-search-nolink.json'))
    const h = harness()
    try {
      const run = (fresh: boolean) => h.router.search({ query: 'DeepSeek 本地部署 教程', count: 3, fresh, multi: false, signal: undefined, platform: { id: 'bilibili' } as never })
      const live = await run(true)
      assert.equal(live.sources.length, 2)
      assert.match(live.fallbackNote!, /1 result without a link skipped/)
      const detailed = await runCliSearchDetailed(builtinSpecById('bili')!, { query: 'q', count: 3 })
      assert.deepEqual([detailed.sources.length, detailed.skipped], [2, 1])
    } finally { h.cleanup() }
  })
})

// ── fix 2: the backend that served a platform search ───────────────────────

test('platform search names the serving backend: text, output field, history detail, cache replay; the output stays within its closed schema', { skip: !posix }, async () => {
  await withCommands({ bili: BILI_HELP }, async dir => {
    fs.writeFileSync(path.join(dir, 'bili.out'), fixture('live-bili-search-nolink.json'))
    const h = harness()
    try {
      const out = await callAction(h.definitions, 'search.run', { platform: 'bilibili', query: 'DeepSeek', count: 3, fresh: true })
      assert.equal(out.backend, 'bili')
      assert.equal(out.engine, 'bilibili')
      assert.deepEqual(checkOutput(findAction('search.run')!.output, out), [])
      assert.match(renderResult('search.run', out), /^Platform: bilibili \(via bili\)/)
      // History detail carries the backend: a router with an empty memory cache replays it from SQLite.
      const second = new SearchRouter({ get: () => undefined } as never, resolveConfig({ engines: ['ddg'], dbPath: 'x', ttlSeconds: 60 } as never), h.store, undefined, () => undefined, undefined, createBuiltinRegistry())
      const replay = await second.search({ query: 'DeepSeek', count: 3, fresh: false, multi: false, signal: undefined, platform: { id: 'bilibili' } as never })
      assert.deepEqual([replay.fromCache, replay.backend], [true, 'bili'])
      const cached = await callAction(h.definitions, 'search.run', { platform: 'bilibili', query: 'DeepSeek', count: 3 })
      assert.equal(cached.fromCache, true)
      assert.equal(cached.backend, 'bili')
      assert.match(renderResult('search.run', cached), /^Platform: bilibili \(via bili, cached\)/)
      // A web search has no backend.
      const web = findAction('search.run')!
      assert.ok('backend' in (web.output as any).properties && !(web.output as any).properties.backend.required)
    } finally { h.cleanup() }
  })
})

test('a browser backend is named by its chain id, and a chain that fell through lists the skipped backends with reasons', { skip: !posix }, async () => {
  const home = process.env.HOME
  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-nohome-'))
  try {
    await withCommands({ xhs: 'case "$1" in --version) echo "xhs, version 0.6.4";; search) echo "Usage: xhs search KEYWORD --json --sort";; esac' }, async () => {
      const h = harness({ platformBackends: { xiaohongshu: ['xhs', 'browser-opencli'] } })
      try {
        const out = await callAction(h.definitions, 'search.run', { platform: 'xiaohongshu', query: '露营', fresh: true })
        assert.equal(out.backend, 'browser-opencli')
        assert.match(renderResult('search.run', out), /^Platform: xiaohongshu \(via browser-opencli\)/)
        assert.match(out.fallbackNote, /skipped backends: xhs: xhs has no saved login/)
      } finally { h.cleanup() }
    })
  } finally { fs.rmSync(process.env.HOME!, { recursive: true, force: true }); if (home === undefined) delete process.env.HOME; else process.env.HOME = home }
})

test('evidence mode: the pack names the platform and the backend that served it (pipeline(bilibili/bili))', { skip: !posix }, async () => {
  await withCommands({ bili: BILI_HELP }, async dir => {
    fs.writeFileSync(path.join(dir, 'bili.out'), fixture('live-bili-search-nolink.json'))
    const h = harness()
    try {
      const out = await h.service.search({ query: 'DeepSeek 本地部署 教程', task: 'find a guide to deploy DeepSeek locally', profile: 'experience', platform: { id: 'bilibili' }, count: 3 } as never)
      assert.match(out.engine, /^pipeline\(bilibili\/bili\)$/)
      assert.deepEqual(out.enginesTried, ['bilibili'])
    } finally { h.cleanup() }
  })
})

// ── fix 1: the summary line derives from the chain ──────────────────────────

test('sources.status: a platform is ready only when a backend can run with its login satisfied; otherwise the line says what it is and what to do', { skip: !posix }, async () => {
  const home = process.env.HOME
  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-nohome-'))
  try {
    // xhs installed but never logged in, no other backend: needs login.
    await withCommands({ xhs: 'case "$1" in --version) echo "xhs, version 0.6.4";; search) echo "Usage: xhs search KEYWORD --json --sort";; esac' }, async () => {
      const h = harness({ platformBackends: { xiaohongshu: ['xhs'], reddit: ['rdt'], bilibili: ['bili'] } }, false)
      try {
        const status = await callAction(h.definitions, 'sources.status')
        assert.deepEqual(checkOutput(findAction('sources.status')!.output, status), [])
        const engine = (id: string) => status.engines.find((e: any) => e.id === id)
        const provider = (id: string) => status.providers.find((p: any) => p.route === id)
        assert.deepEqual([engine('xiaohongshu').state, engine('xiaohongshu').available], ['needs_login', false])
        assert.equal(provider('xiaohongshu').readiness.state, 'needs_login', 'same word in both places')
        assert.match(engine('xiaohongshu').reason, /xhs: no saved login \(run `xhs login` yourself\)/)
        assert.deepEqual([engine('reddit').state, engine('reddit').available], ['unavailable', false])
        const text = renderResult('sources.status', status)
        assert.match(text, /⚠ xiaohongshu \[needs login\] — .*run `xhs login` yourself/)
        assert.match(text, /❌ reddit \[unavailable\] — .*rdt not found on PATH/)
        assert.doesNotMatch(text, /✅ xiaohongshu|✅ reddit/)
      } finally { h.cleanup() }
    })
    // A browser backend can run but its login cannot be checked: login unverified, still runnable.
    await withCommands({}, async () => {
      const h = harness({ platformBackends: { xiaohongshu: ['browser-opencli'] } })
      try {
        const status = await callAction(h.definitions, 'sources.status')
        const e = status.engines.find((x: any) => x.id === 'xiaohongshu')
        assert.deepEqual([e.state, e.available], ['login_unverified', true])
        assert.equal(status.providers.find((p: any) => p.route === 'xiaohongshu').readiness.state, 'login_unverified')
        assert.match(renderResult('sources.status', status), /⚠ xiaohongshu \[login unverified\] — login not verified: browser-opencli/)
      } finally { h.cleanup() }
    })
    // A backend that needs no login is plainly ready.
    await withCommands({ bili: BILI_HELP }, async () => {
      const h = harness({}, false)
      try {
        const status = await callAction(h.definitions, 'sources.status')
        assert.equal(status.engines.find((x: any) => x.id === 'bilibili').state, 'ready')
        assert.match(renderResult('sources.status', status), /✅ bilibili \[ready\]/)
      } finally { h.cleanup() }
    })
  } finally { fs.rmSync(process.env.HOME!, { recursive: true, force: true }); if (home === undefined) delete process.env.HOME; else process.env.HOME = home }
})
