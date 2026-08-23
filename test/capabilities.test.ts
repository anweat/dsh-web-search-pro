import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isPlatformSupported, PLATFORM_IDS, SEARCH_ENGINE_IDS } from '../src/engines.ts'
import { Store } from '../src/store.ts'

test('capability ids remain complete and configured custom platforms are accepted', () => {
  assert.deepEqual(SEARCH_ENGINE_IDS, [
    'seam', 'exa', 'ddg', 'bing', 'jina', 'github', 'bilibili', 'v2ex', 'youtube', 'arxiv', 'pubmed',
  ])
  assert.deepEqual(PLATFORM_IDS, [
    'github', 'github-code', 'github-issues', 'bilibili', 'youtube', 'v2ex', 'xiaohongshu', 'twitter',
    'reddit', 'instagram', 'facebook', 'rss', 'zhihu', 'weibo', 'douban', 'tieba', 'douyin', 'kuaishou',
    'arxiv', 'pubmed',
  ])
  assert.equal(isPlatformSupported('rss'), true)
  assert.equal(isPlatformSupported('forum', {
    forum: { name: 'Forum', url: 'https://example.com?q={query}', item: '.item', title: '.title', link: 'a' },
  }), true)
  assert.equal(isPlatformSupported('missing'), false)
})

test('persistent extraction rules and statistics cover their complete lifecycle', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-rules-stats-'))
  const store = new Store(path.join(dir, 'store.db'))
  try {
    store.upsertRule('Example.COM', 'main, article', '.ad')
    assert.deepEqual(store.listRules().map(rule => ({ hostname: rule.hostname, content: rule.content, remove: rule.remove })), [
      { hostname: 'example.com', content: 'main, article', remove: '.ad' },
    ])
    const query = store.recordQuery({ kind: 'search', query: 'dsh', engine: 'ddg', status: 'ok' })
    store.recordResults(query, [{ url: 'https://example.com/a' }], 'ddg')
    const stats = store.stats()
    assert.deepEqual({ queries: stats.queries, results: stats.results, pages: stats.pages, rules: stats.rules }, {
      queries: 1, results: 1, pages: 0, rules: 1,
    })
    assert.deepEqual(store.kindCounts().map(row => ({ ...row })), [{ kind: 'search', count: 1 }])
    assert.deepEqual(store.topEngines().map(row => ({ ...row })), [{ engine: 'ddg', count: 1 }])
    assert.deepEqual(store.topQueries().map(row => ({ ...row })), [{ query: 'dsh', count: 1 }])
    assert.equal(store.removeRule('EXAMPLE.com'), true)
    assert.equal(store.removeRule('example.com'), false)
  } finally {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
