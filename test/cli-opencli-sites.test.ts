import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { opencliSearchSpec, opencliSiteVerification, parseOpencliList } from '../src/cli/opencli.ts'
import { parseCliOutput } from '../src/cli/runner.ts'
import { validateCliAdapterSpec } from '../src/cli/spec.ts'

const dir = new URL('./fixtures/cli/', import.meta.url)
const read = (name: string): string => fs.readFileSync(new URL(name, dir), 'utf8')
const sites = parseOpencliList(read('opencli-list.json'))
const specOf = (platform: string, site = platform) => opencliSearchSpec(platform, sites.get(site)!, { silent: true })!
const parse = (platform: string, fixture: string, site = platform, count = 20) => { const spec = specOf(platform, site); return parseCliOutput(spec, spec.search, read(fixture), count) }

test('opencli twitter (live shape, synthetic content): link, text title, author · likes · views · time, created_at as ISO', () => {
  const out = parse('twitter', 'live-opencli-twitter-search.json')
  assert.equal(out.length, 3)
  assert.deepEqual(out[0], {
    url: 'https://x.com/example_dev/status/1000000000000000001',
    title: 'Trying the new agent harness on a sample benchmark. Same model, different harness, noticeably different results. Thread below.',
    snippet: '@example_dev · likes 308 · views 55556 · 2026-10-27T08:38:08Z',
    publishedAt: '2026-10-27T08:38:08Z',
  }, 'a multi-line tweet is one title line; created_at is no longer passed on in the X API format')
  assert.equal(out[1]!.title, '短评：这个 harness 的默认工具集很克制，上手只要十分钟。')
  assert.equal(out[2]!.snippet, '@another_handle · likes 0 · views 87 · 2026-10-25T02:15:00Z', 'zero likes are a number, not an empty value')
  assert.ok(out.every(s => /^https:\/\/x\.com\/\w+\/status\/\d+$/.test(s.url) && !/\n/.test(s.title ?? '')))
  assert.equal(parse('twitter', 'live-opencli-twitter-search.json', 'twitter', 2).length, 2, 'the count cuts the list')
})

test('opencli zhihu (live shape, synthetic content): title, kind · author · votes; the tool gives no excerpt or time and none is invented', () => {
  const out = parse('zhihu', 'live-opencli-zhihu-search.json')
  assert.deepEqual(out, [
    { url: 'https://zhuanlan.zhihu.com/p/100000001', title: '示例文章标题：用 Rust 写一个异步运行时', snippet: 'article · 示例作者甲 · 赞同 12' },
    { url: 'https://www.zhihu.com/question/200000002', title: '示例问题：如何评价这个 Agent 框架？', snippet: 'question · 赞同 0' },
    { url: 'https://www.zhihu.com/question/200000003/answer/300000003', title: '示例回答标题', snippet: 'answer · 示例作者乙 · 赞同 1' },
  ])
})

test('opencli reddit and xiaohongshu mappings follow the 1.8.8 adapters\' columns (not measured: constructed fixtures)', () => {
  const reddit = parse('reddit', 'constructed-opencli-reddit-search.json')
  assert.equal(reddit.length, 2)
  assert.deepEqual(reddit[0], {
    url: 'https://www.reddit.com/r/examples/comments/abc123/example_post_an_agent_harness_comparison/',
    title: 'Example post: an agent harness comparison',
    snippet: 'r/examples · score 245 · 37 comments · Body text of the example post.',
    publishedAt: new Date(1792000000 * 1000).toISOString(),
  })
  assert.equal(reddit[1]!.snippet, 'r/samples · score 3 · 0 comments', 'an empty selftext adds nothing')
})

test('verification per OpenCLI site: twitter and zhihu searches were run, xiaohongshu and reddit were not, others are contract-only', () => {
  assert.deepEqual(['twitter', 'zhihu', 'xiaohongshu', 'reddit', 'hackernews'].map(site => opencliSiteVerification(site).status), ['live', 'live', 'contract-only', 'contract-only', 'contract-only'])
  for (const site of ['twitter', 'zhihu', 'xiaohongshu', 'reddit', 'hackernews']) {
    const spec = specOf(site)
    assert.equal(spec.verification!.status, opencliSiteVerification(site).status)
    assert.equal(validateCliAdapterSpec(spec, 'builtin').ok, true, site)
  }
  assert.match(opencliSiteVerification('xiaohongshu').note!, /not measured.*AUTH_REQUIRED/)
  assert.match(opencliSiteVerification('reddit').note!, /not measured.*HTML/)
})
