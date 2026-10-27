import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTimeText } from '../src/cli/time-text.ts'
import { getPath, mapCliItemsDetailed, resolveField } from '../src/cli/runner.ts'
import { baseSpec } from './cli-helpers.ts'
import { validateCliAdapterSpec } from '../src/cli/spec.ts'

// 2026-10-27 12:00 in China (04:00 UTC).
const NOW = Date.UTC(2026, 9, 27, 4, 0, 0)
const t = (text: string, now = NOW): string | undefined => normalizeTimeText(text, now)

test('time texts: exact formats only, nothing is guessed', () => {
  // The X API created_at, ISO with and without a zone.
  assert.equal(t('Tue Oct 27 08:38:08 +0000 2026'), '2026-10-27T08:38:08Z')
  assert.equal(t('Tue Oct 27 10:38:08 +0200 2026'), '2026-10-27T08:38:08Z')
  assert.equal(t('2026-10-27T08:38:08Z'), '2026-10-27T08:38:08Z')
  assert.equal(t('2026-10-27T08:38:08.123+08:00'), '2026-10-27T00:38:08Z')
  assert.equal(t('2026-10-27T08:38'), '2026-10-27T08:38:00Z')
  // Calendar dates.
  assert.equal(t('2025-12-01'), '2025-12-01')
  assert.equal(t('2026-1-5'), '2026-01-05')
  assert.equal(t('08-26'), '2026-08-26', 'the latest such date not after today')
  assert.equal(t('10-27'), '2026-10-27', 'today is today')
  assert.equal(t('10-28'), '2025-10-28', 'tomorrow cannot be a publish date: last year')
  assert.equal(t('12-01'), '2025-12-01')
  assert.equal(t('02-29'), '2024-02-29', 'a leap day skips back to a leap year')
  assert.equal(t('02-30'), undefined)
  assert.equal(t('13-01'), undefined)
  // China-time relative texts.
  assert.equal(t('5分钟前'), '2026-10-27T03:55:00Z')
  assert.equal(t('3小时前'), '2026-10-27T01:00:00Z')
  assert.equal(t('2天前'), '2026-10-25')
  assert.equal(t('昨天 10:20'), '2026-10-26T10:20:00+08:00')
  // Near midnight China time the date is still China's: 2026-10-26 17:30 UTC is 10-27 01:30 in China.
  const late = Date.UTC(2026, 9, 26, 17, 30)
  assert.equal(t('08-26', late), '2026-08-26')
  assert.equal(t('1天前', late), '2026-10-26')
  assert.equal(t('昨天 23:59', late), '2026-10-26T23:59:00+08:00')
  // Everything else is not a time.
  for (const bad of ['', '   ', 'last week', '刚刚', '3周前', '1个月前', '昨天', '昨天 25:00', '2026-13-01', '2026-02-30', 'Tue Oct 27 08:38:08 +0000', '3小时前 广东', 'N/A']) assert.equal(t(bad), undefined, JSON.stringify(bad))
})

test('field sources: { time } and a time join part read the text through the same parser; a bad text drops out', () => {
  const item = { created_at: 'Tue Oct 27 08:38:08 +0000 2026', bad: 'soon', tags: [{ type: 'location', text: '广东' }, { type: 'publish_time', text: '08-26' }], likes: 308 }
  assert.equal(resolveField({ time: 'created_at' }, item, new Set(), NOW), '2026-10-27T08:38:08Z')
  assert.equal(resolveField({ time: 'bad' }, item, new Set(), NOW), undefined)
  assert.equal(resolveField({ time: 'tags.type=publish_time.text' }, item, new Set(), NOW), '2026-08-26')
  assert.equal(resolveField({ time: 'tags.type=nothing.text' }, item, new Set(), NOW), undefined)
  assert.equal(getPath(item, 'tags.type=location.text'), '广东')
  assert.equal(getPath(item, 'tags.1.text'), '08-26', 'an index still works')
  assert.equal(resolveField({ join: [{ path: 'likes', prefix: 'likes ' }, { time: 'created_at' }, { time: 'bad' }], sep: ' · ' }, item, new Set(), NOW), 'likes 308 · 2026-10-27T08:38:08Z')
})

test('keepWhen drops the items that are not results without counting them as skipped; the spec validator knows time, key=value paths and keepWhen', () => {
  const output = baseSpec().search.output
  const spec = { ...output, keepWhen: { path: 'kind', equals: 'note' }, fields: { url: 'url', title: 'title', publishedAt: { time: 'tags.type=publish_time.text' } } }
  const items = [{ kind: 'suggestion', id: 'x' }, { kind: 'note', url: 'https://example.com/1', title: 'one', tags: [{ type: 'publish_time', text: '3小时前' }] }, { kind: 'note', title: 'no link' }]
  const out = mapCliItemsDetailed(spec, items, 5, NOW)
  assert.deepEqual(out.sources, [{ url: 'https://example.com/1', title: 'one', publishedAt: '2026-10-27T01:00:00Z' }])
  assert.equal(out.skipped, 1, 'only the note without a link is reported')
  assert.deepEqual(validateCliAdapterSpec(baseSpec({ search: { ...baseSpec().search, output: spec } })).errors, [])
  assert.match(validateCliAdapterSpec(baseSpec({ search: { ...baseSpec().search, output: { ...spec, keepWhen: { path: 'a b', equals: 1 } } } })).errors.join(), /keepWhen must be \{ path, equals \}/)
  assert.match(validateCliAdapterSpec(baseSpec({ search: { ...baseSpec().search, output: { ...spec, fields: { url: 'url', publishedAt: { time: 'a b' } } } } })).errors.join(), /time must be a dotted path/)
})
