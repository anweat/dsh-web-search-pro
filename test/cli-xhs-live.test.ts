import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { builtinSpecById } from '../src/cli/builtin-specs.ts'
import { mapCliItemsDetailed, parseCliItems, parseCliOutput } from '../src/cli/runner.ts'
import { validateCliAdapterSpec } from '../src/cli/spec.ts'

const read = (name: string): string => fs.readFileSync(new URL('./fixtures/cli/' + name, import.meta.url), 'utf8')
const xhs = builtinSpecById('xhs')!
// 2026-10-27 12:00 in China.
const NOW = Date.UTC(2026, 9, 27, 4, 0, 0)

test('xhs (live shape, synthetic content): note links with the signed token, author and likes, the publish time from corner_tag_info', () => {
  const out = parseCliOutput(xhs, xhs.search, read('live-xhs-search.json'), 20, NOW)
  assert.deepEqual(out.map(s => s.url), [
    'https://www.xiaohongshu.com/explore/0000000000000000000000a1?xsec_token=EXAMPLE_TOKEN_00a1&xsec_source=pc_search',
    'https://www.xiaohongshu.com/explore/0000000000000000000000a2?xsec_token=EXAMPLE_TOKEN_00a2&xsec_source=pc_search',
    'https://www.xiaohongshu.com/explore/0000000000000000000000a3?xsec_token=EXAMPLE_TOKEN_00a3&xsec_source=pc_search',
    'https://www.xiaohongshu.com/explore/0000000000000000000000a4?xsec_token=EXAMPLE_TOKEN_00a4&xsec_source=pc_search',
  ])
  assert.deepEqual(out.map(s => s.title), ['示例笔记：双人露营装备清单', '示例笔记：新手露营避坑', '示例笔记：只有标题的一条', '示例笔记：三小时前发布'])
  assert.equal(out[0]!.snippet, '作者: 示例作者甲 | 赞: 128')
  // MM-DD is the latest such date not after today; YYYY-MM-DD as it is; a relative text is read against the clock; no tag, no time.
  assert.deepEqual(out.map(s => s.publishedAt), ['2026-08-26', '2025-12-01', undefined, '2026-10-27T01:00:00Z'])
  assert.ok(!('publishedAt' in out[2]!), 'a missing time is left out, not empty')
})

test('xhs: the hot_query suggestion cards of the result list are not results and are not reported as results without a link', () => {
  const items = parseCliItems(xhs, xhs.search.output, read('live-xhs-search.json'))
  assert.equal(items.length, 5)
  assert.equal(items.filter((i: any) => i.model_type === 'hot_query').length, 1)
  const { sources, skipped } = mapCliItemsDetailed(xhs.search.output, items, 20, NOW)
  assert.equal(sources.length, 4)
  assert.equal(skipped, 0)
  assert.ok(sources.every(s => !/b1\b/.test(s.url)), 'the card\'s id is never a link')
  // The count is met by notes, wherever the cards sit in the list.
  assert.equal(mapCliItemsDetailed(xhs.search.output, items, 3, NOW).sources.length, 3)
})

test('xhs is a live spec (a real search was run on 2026-10-27) and still a valid, read-only one', () => {
  assert.deepEqual([xhs.verification!.status, xhs.verification!.version, xhs.verification!.date], ['live', '0.6.4', '2026-10-27'])
  assert.deepEqual(validateCliAdapterSpec(xhs, 'builtin').errors, [])
  assert.deepEqual(xhs.search.argv, ['search', '{query}', '--json'])
  assert.equal(xhs.login!.command, 'xhs login', 'the user logs in with the tool\'s own command; the plugin never runs it')
})
