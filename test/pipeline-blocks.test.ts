import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { splitBlocks } from '../src/blocks.ts'

const URL_A = 'https://example.com/docs/a'
const sha1 = (s: string): string => crypto.createHash('sha1').update(s).digest('hex')

/** Every block must be an exact, trimmed slice of the source text with correct id/hash. */
function assertInvariants(text: string, url: string, blocks: ReturnType<typeof splitBlocks>): void {
  let prevEnd = 0
  for (const b of blocks) {
    assert.equal(b.text, text.slice(b.start, b.end), 'text must equal slice(start,end)')
    assert.equal(b.text, b.text.trim(), 'block text must be trimmed')
    assert.ok(b.start >= prevEnd, 'blocks must be ordered and non-overlapping')
    prevEnd = b.end
    assert.equal(b.blockId, 'b_' + sha1(url + ':' + b.start).slice(0, 12))
    assert.equal(b.hash, sha1(b.text).slice(0, 16))
  }
  assert.equal(new Set(blocks.map(b => b.blockId)).size, blocks.length, 'ids must be unique')
}

const ENGLISH_MD = `# Install

Use npm to install the package. It works on Node 22 and later.

## Configuration

Create a config file next to package.json.

### Timeout

Set the timeout option to a number of milliseconds.

## Usage

Call the function and await the result.
`

test('English markdown: heading paths, ordering and invariants', () => {
  const blocks = splitBlocks(ENGLISH_MD, URL_A)
  assertInvariants(ENGLISH_MD, URL_A, blocks)
  assert.deepEqual(blocks.map(b => b.heading), [
    'Install',
    'Install > Configuration',
    'Install > Configuration > Timeout',
    'Install > Usage',
  ])
  assert.ok(blocks[0]!.text.startsWith('# Install'), 'heading line stays inside its first block')
  assert.ok(blocks[2]!.text.includes('timeout option'))
})

const CHINESE_PLAIN = `安装与配置

在开始之前，请先确认本机已经安装了 Node.js 22 或更高版本，并且可以在终端中直接运行 node 命令。

1.2 设置超时时间

通过 timeout 选项可以设置数据库的忙等待超时时间，单位是毫秒，默认值为 0，表示不等待并立即返回错误。

常见问题

如果遇到数据库被锁定的错误，可以先检查是否有其他进程同时在写入同一个数据库文件，并考虑启用 WAL 模式。`

test('Chinese plain text: heuristic headings and CJK paragraphs', () => {
  const blocks = splitBlocks(CHINESE_PLAIN, URL_A)
  assertInvariants(CHINESE_PLAIN, URL_A, blocks)
  assert.deepEqual(blocks.map(b => b.heading), ['安装与配置', '安装与配置 > 1.2 设置超时时间', '常见问题'])
  // Short body sentences ending with punctuation must not turn into headings.
  assert.ok(blocks[0]!.text.includes('Node.js 22'))
})

test('inferHeadings=false keeps plain text as body only', () => {
  const blocks = splitBlocks(CHINESE_PLAIN, URL_A, { inferHeadings: false })
  assertInvariants(CHINESE_PLAIN, URL_A, blocks)
  assert.ok(blocks.every(b => b.heading === undefined))
  assert.ok(blocks.map(b => b.text).join('\n').includes('常见问题'), 'no text is lost')
})

test('fenced code blocks stay intact, even when large and containing blank lines and # lines', () => {
  const code = Array.from({ length: 40 }, (_, i) => `# comment ${i}\nconst value${i} = ${i}\n`).join('\n')
  const text = `## Example\n\nRun this script:\n\n\`\`\`js\n${code}\`\`\`\n\nThen check the output.\n`
  const blocks = splitBlocks(text, URL_A, { maxChars: 300, minChars: 100 })
  assertInvariants(text, URL_A, blocks)
  const holders = blocks.filter(b => b.text.includes('const value0 = 0'))
  assert.equal(holders.length, 1)
  assert.ok(holders[0]!.text.includes('const value39 = 39'), 'whole fence in one block')
  assert.ok(holders[0]!.text.includes('```js') && holders[0]!.text.trimEnd().endsWith('```'))
  assert.ok(holders[0]!.text.length > 300, 'atomic block may exceed maxChars')
  assert.ok(blocks.every(b => b.heading === 'Example'), '# lines inside code are not headings')
  assert.ok(blocks[blocks.length - 1]!.text.includes('Then check the output.'))
})

test('unclosed fence runs to the end of the text', () => {
  const text = 'Intro paragraph.\n\n```\nline one\n\nline two\n'
  const blocks = splitBlocks(text, URL_A, { maxChars: 20, minChars: 5 })
  assertInvariants(text, URL_A, blocks)
  const fence = blocks.find(b => b.text.startsWith('```'))!
  assert.ok(fence.text.includes('line two'))
})

test('markdown tables are kept in one block', () => {
  const rows = Array.from({ length: 30 }, (_, i) => `| plan${i} | ${i * 100}k | ${i} ms |`).join('\n')
  const text = `## Limits\n\nCompare the plans below.\n\n| Plan | Requests | CPU |\n|---|---|---|\n${rows}\n\nPrices may change.\n`
  const blocks = splitBlocks(text, URL_A, { maxChars: 200, minChars: 50 })
  assertInvariants(text, URL_A, blocks)
  const holders = blocks.filter(b => b.text.includes('| plan0 |') || b.text.includes('| plan29 |'))
  assert.equal(holders.length, 1)
  assert.ok(holders[0]!.text.includes('| Plan | Requests | CPU |'))
})

test('long CJK paragraph is cut at sentence boundaries within maxChars', () => {
  const sentence = '这是一个用于测试的句子，它会被重复很多次以构造超长段落。'
  const text = sentence.repeat(60)
  const blocks = splitBlocks(text, URL_A, { maxChars: 200, minChars: 100 })
  assertInvariants(text, URL_A, blocks)
  assert.ok(blocks.length > 1)
  for (const b of blocks) {
    assert.ok(b.text.length <= 200, 'block within max: ' + b.text.length)
    assert.ok(b.text.endsWith('。'), 'cut on a sentence boundary')
  }
  assert.equal(blocks.map(b => b.text).join(''), text)
})

test('long Latin text without punctuation falls back to hard cuts without splitting surrogate pairs', () => {
  const text = ('word '.repeat(10) + '😀').repeat(50)
  const blocks = splitBlocks(text, URL_A, { maxChars: 120, minChars: 60 })
  assertInvariants(text, URL_A, blocks)
  for (const b of blocks) {
    assert.ok(b.text.length <= 120)
    assert.ok(!/[\ud800-\udbff]$/.test(b.text) && !/^[\udc00-\udfff]/.test(b.text), 'no split surrogate pair')
  }
})

test('paragraphs are packed up to maxChars and sections start new blocks', () => {
  const paras = Array.from({ length: 12 }, (_, i) => `Paragraph number ${i} carries a sentence of moderate length for packing.`)
  const text = '# Top\n\n' + paras.join('\n\n') + '\n\n# Next\n\nTail paragraph that is in another section of the page.'
  const blocks = splitBlocks(text, URL_A, { maxChars: 400, minChars: 200 })
  assertInvariants(text, URL_A, blocks)
  const top = blocks.filter(b => b.heading === 'Top')
  assert.ok(top.length >= 2 && top.length <= 4, 'packed into a few blocks: ' + top.length)
  assert.ok(top.every(b => b.text.length <= 400))
  assert.equal(blocks[blocks.length - 1]!.heading, 'Next')
})

test('ids are stable across runs and depend on the url', () => {
  const a1 = splitBlocks(ENGLISH_MD, URL_A)
  const a2 = splitBlocks(ENGLISH_MD, URL_A)
  const b = splitBlocks(ENGLISH_MD, 'https://example.com/docs/b')
  assert.deepEqual(a1, a2)
  assert.notEqual(a1[0]!.blockId, b[0]!.blockId)
  assert.equal(a1[0]!.hash, b[0]!.hash, 'content hash does not depend on url')
})

test('CRLF input keeps offsets consistent', () => {
  const text = ENGLISH_MD.replace(/\n/g, '\r\n')
  const blocks = splitBlocks(text, URL_A)
  assert.equal(blocks.length, 4)
  for (const b of blocks) assert.equal(b.text, text.slice(b.start, b.end))
})

test('setext headings and empty input', () => {
  const text = 'Title\n=====\n\nBody text of the page goes here and is long enough.\n'
  const blocks = splitBlocks(text, URL_A)
  assertInvariants(text, URL_A, blocks)
  assert.equal(blocks[0]!.heading, 'Title')
  assert.deepEqual(splitBlocks('', URL_A), [])
  assert.deepEqual(splitBlocks('   \n\n  ', URL_A), [])
})

test('trailing heading without content is still emitted', () => {
  const text = 'Some body paragraph.\n\n## Appendix\n'
  const blocks = splitBlocks(text, URL_A)
  assertInvariants(text, URL_A, blocks)
  assert.equal(blocks[blocks.length - 1]!.text, '## Appendix')
})

test('first line of a hard-wrapped paragraph is not mistaken for a heading', () => {
  const text = 'Setup\n\nAPIs that read values from SQLite have a configuration option that determines\nwhether values are converted to numbers or bigints in JavaScript, depending on the option.\n\nAdded in: v24.0.0, v22.16.0\n\nAdd the timeout option to the constructor and pass a number of milliseconds to use.\n'
  const blocks = splitBlocks(text, URL_A)
  assertInvariants(text, URL_A, blocks)
  assert.equal(blocks[0]!.heading, 'Setup')
  assert.ok(blocks[0]!.text.includes('whether values are converted'), 'wrapped paragraph stays in the Setup block')
  assert.ok(blocks.every(b => !b.heading?.includes('APIs that read')))
})
