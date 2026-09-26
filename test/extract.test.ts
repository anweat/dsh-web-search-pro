/**
 * Extraction tests for the node-html-parser-backed extractor.
 *
 * These lock in the behaviors that differ between node-html-parser and a real
 * DOM (jsdom), which the extractor previously used:
 *  - `<pre>`/`<code>` bodies are parsed as RAW TEXT, so nested markup reaches
 *    `textContent` verbatim (`<pre><code>x</code></pre>` -> "<code>x</code>")
 *    where a real DOM yields "x". The extractor must flatten it.
 *  - Fragments without `<body>` have no body element, where jsdom synthesizes
 *    one; content selection must still find something.
 * The parser swap exists because jsdom -> whatwg-url -> tr46 does
 * `require('punycode/')`, which dsh 0.1.7-rc.2's CJS resolution router cannot
 * route, making any jsdom-importing plugin fail to load.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { extractText } from '../src/extract.ts'
import { parseDocument } from '../src/util.ts'

const BT = String.fromCharCode(96)

test('extractText reads the document title and an article body', () => {
  const html = '<html><head><title>Hello</title></head><body><article>'
    + '<p>' + 'Main content sentence here. '.repeat(6) + '</p></article></body></html>'
  const result = extractText(html, 'https://example.com/a', [])
  assert.equal(result.title, 'Hello')
  assert.match(result.text, /Main content sentence here\./)
})

test('extractText prefers a longer og:title over the title tag', () => {
  const html = '<html><head><title>Short</title>'
    + '<meta property="og:title" content="A Much Longer OpenGraph Title">'
    + '</head><body><article><p>' + 'Body text. '.repeat(20) + '</p></article></body></html>'
  const result = extractText(html, 'https://example.com/a', [])
  assert.equal(result.title, 'A Much Longer OpenGraph Title')
})

test('extractText falls back to the h1 when no title exists', () => {
  const html = '<html><head></head><body><article><h1>Heading Only</h1>'
    + '<p>' + 'Filler sentence for length. '.repeat(10) + '</p></article></body></html>'
  const result = extractText(html, 'https://example.com/a', [])
  assert.equal(result.title, 'Heading Only')
})

test('extractText uses a JSON-LD articleBody when present and long enough', () => {
  const body = 'JSON-LD body content. '.repeat(8)
  const html = '<html><head><title>LD</title></head><body>'
    + '<script type="application/ld+json">' + JSON.stringify({ '@type': 'Article', articleBody: body }) + '</script>'
    + '<div>visible text that should lose to the JSON-LD body</div></body></html>'
  const result = extractText(html, 'https://example.com/a', [])
  assert.equal(result.text.trim(), body.trim())
})

test('extractText applies a hostname rule content selector', () => {
  const html = '<html><head><title>R</title></head><body>'
    + '<nav>navigation junk</nav>'
    + '<div class="pickme"><p>' + 'Rule-selected content. '.repeat(6) + '</p></div>'
    + '<div class="other"><p>' + 'Unselected content. '.repeat(6) + '</p></div></body></html>'
  const result = extractText(html, 'https://example.com/a', [
    { hostname: 'example.com', contentSelectors: ['.pickme'] },
  ])
  assert.match(result.text, /Rule-selected content\./)
  assert.doesNotMatch(result.text, /Unselected content\./)
  assert.equal(result.usedRule, 'example.com')
})

test('extractText applies rule remove selectors', () => {
  const html = '<html><head><title>R</title></head><body>'
    + '<article><div class="ad">SPONSORED JUNK</div><p>' + 'Real article text. '.repeat(8) + '</p></article></body></html>'
  const result = extractText(html, 'https://example.com/a', [
    { hostname: 'example.com', contentSelectors: ['article'], removeSelectors: ['.ad'] },
  ])
  assert.match(result.text, /Real article text\./)
  assert.doesNotMatch(result.text, /SPONSORED JUNK/)
})

test('extractText renders links as markdown and relative links as plain text', () => {
  const html = '<html><head><title>L</title></head><body><article>'
    + '<p><a href="https://ex.com/abs">absolute</a> and <a href="/relative">relative</a></p>'
    + '<p>' + 'Filler sentence. '.repeat(10) + '</p></article></body></html>'
  const result = extractText(html, 'https://example.com/a', [])
  assert.match(result.text, /\[absolute\]\(https:\/\/ex\.com\/abs\)/)
  assert.match(result.text, /relative/)
  assert.doesNotMatch(result.text, /\]\(\/relative\)/)
})

test('extractText renders img alt text', () => {
  const html = '<html><head><title>I</title></head><body><article>'
    + '<img alt="diagram"><img src="no-alt.png">'
    + '<p>' + 'Text around images. '.repeat(10) + '</p></article></body></html>'
  const result = extractText(html, 'https://example.com/a', [])
  assert.match(result.text, /diagram/)
})

test('extractText flattens markup nested inside pre and code', () => {
  // node-html-parser parses <pre> bodies as raw text: a nested <code> arrives as
  // the literal string "<code>const x = 1</code>" rather than as an element.
  // The extractor must flatten it to match real DOM textContent semantics.
  const html = '<html><head><title>Code</title></head><body><article>'
    + '<pre><code>const x = 1</code></pre>'
    + '<p>' + 'Surrounding prose. '.repeat(10) + '</p></article></body></html>'
  const result = extractText(html, 'https://example.com/a', [])
  assert.match(result.text, new RegExp(BT.repeat(3) + '\\s*const x = 1\\s*' + BT.repeat(3)))
  assert.doesNotMatch(result.text, /<code>/)
  assert.doesNotMatch(result.text, /<\/code>/)
})

test('extractText preserves pre whitespace and decodes entities inside it', () => {
  const html = '<html><head><title>E</title></head><body><article>'
    + '<pre>line1\n  line2 &lt;tag&gt; &amp;&amp; ok</pre>'
    + '<p>' + 'Trailing prose. '.repeat(10) + '</p></article></body></html>'
  const result = extractText(html, 'https://example.com/a', [])
  assert.match(result.text, /line1\n {2}line2 <tag> && ok/)
})

test('extractText keeps escaped tag lookalikes inside pre as text', () => {
  // The raw <pre> body is entity-decoded by the parser, so a naive re-parse
  // would mistake "&lt;div&gt;" for real markup and drop it. The extractor
  // re-parses the ORIGINAL escaped source, which preserves it as text.
  const html = '<html><head><title>L</title></head><body><article>'
    + '<pre>&lt;div&gt;fake&lt;/div&gt;</pre>'
    + '<p>' + 'Follow-up prose. '.repeat(10) + '</p></article></body></html>'
  const result = extractText(html, 'https://example.com/a', [])
  assert.match(result.text, /<div>fake<\/div>/)
})

test('extractText flattens nested elements inside pre', () => {
  const html = '<html><head><title>N</title></head><body><article>'
    + '<pre><span>spanned</span> tail</pre>'
    + '<p>' + 'More prose after. '.repeat(10) + '</p></article></body></html>'
  const result = extractText(html, 'https://example.com/a', [])
  assert.match(result.text, /spanned tail/)
  assert.doesNotMatch(result.text, /<span>/)
})

test('extractText flattens inline code without leaking tags', () => {
  const html = '<html><head><title>C</title></head><body><article>'
    + '<p>Use <code>npm install</code> then <code>a &lt; b</code>.</p>'
    + '<p>' + 'More sentences here. '.repeat(10) + '</p></article></body></html>'
  const result = extractText(html, 'https://example.com/a', [])
  assert.match(result.text, new RegExp(BT + 'npm install' + BT))
  assert.match(result.text, new RegExp(BT + 'a < b' + BT))
  assert.doesNotMatch(result.text, /<code>/)
})

test('extractText drops script and style content', () => {
  const html = '<html><head><title>S</title><style>.a{color:red}</style></head><body><article>'
    + '<script>var x = 1</script>'
    + '<p>' + 'Real content only. '.repeat(10) + '</p></article></body></html>'
  const result = extractText(html, 'https://example.com/a', [])
  assert.match(result.text, /Real content only\./)
  assert.doesNotMatch(result.text, /color:red/)
  assert.doesNotMatch(result.text, /var x = 1/)
})

test('extractText handles a fragment with no html or body element', () => {
  const html = '<div><p>' + 'Fragment content without html or body tags. '.repeat(4) + '</p></div>'
  const result = extractText(html, 'https://example.com/a', [])
  assert.match(result.text, /Fragment content without html or body tags\./)
})

test('extractText decodes entities in ordinary text', () => {
  const html = '<html><head><title>A &amp; B</title></head><body><article>'
    + '<p>&lt;tag&gt; &amp; &quot;quotes&quot;</p>'
    + '<p>' + 'More content. '.repeat(12) + '</p></article></body></html>'
  const result = extractText(html, 'https://example.com/a', [])
  assert.equal(result.title, 'A & B')
  assert.match(result.text, /<tag> & "quotes"/)
})

test('extractText is resilient to an invalid content selector in a rule', () => {
  const html = '<html><head><title>X</title></head><body><article>'
    + '<p>' + 'Fallback content survives. '.repeat(10) + '</p></article></body></html>'
  const result = extractText(html, 'https://example.com/a', [
    { hostname: 'example.com', contentSelectors: ['>>>not a selector<<<', 'article'] },
  ])
  assert.match(result.text, /Fallback content survives\./)
})

test('extractText respects maxChars', () => {
  const html = '<html><head><title>M</title></head><body><article>'
    + '<p>' + 'Long paragraph text. '.repeat(200) + '</p></article></body></html>'
  const result = extractText(html, 'https://example.com/a', [], 100)
  assert.ok(result.text.length <= 100, `expected <= 100 chars, got ${result.text.length}`)
})

test('extractText strips navigation and footer from the generic path', () => {
  const html = '<html><head><title>N</title></head><body>'
    + '<nav>NAVIGATION LINKS</nav>'
    + '<p>' + 'Body paragraph content. '.repeat(10) + '</p>'
    + '<footer>FOOTER COPYRIGHT</footer></body></html>'
  const result = extractText(html, 'https://example.com/a', [])
  assert.match(result.text, /Body paragraph content\./)
  assert.doesNotMatch(result.text, /NAVIGATION LINKS/)
  assert.doesNotMatch(result.text, /FOOTER COPYRIGHT/)
})

test('parseDocument exposes the DOM slice the extractor relies on', () => {
  const document = parseDocument('<html><head><title>T</title></head><body><div id="x"><p>p</p></div></body></html>')
  assert.equal(document.title, 'T')
  assert.ok(document.body)
  const div = document.querySelector('#x')
  assert.ok(div)
  assert.equal(div.tagName, 'DIV')
  assert.equal(div.querySelector('p').textContent, 'p')
  assert.equal(document.querySelectorAll('p').length, 1)
  assert.equal(document.querySelector('#missing'), null)
})
