import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalizeUrl, isHashRoute, isTrackingParam } from '../src/pipeline/url.ts'

test('canonicalizeUrl: host case, default port, fragment and trailing slash', () => {
  assert.equal(canonicalizeUrl('HTTPS://Example.COM:443/a/b/#section'), 'https://example.com/a/b')
  assert.equal(canonicalizeUrl('http://example.com:80/x'), 'http://example.com/x')
  assert.equal(canonicalizeUrl('http://example.com:8080/x'), 'http://example.com:8080/x')
  assert.equal(canonicalizeUrl('https://example.com.'), 'https://example.com/')
  assert.equal(canonicalizeUrl('https://example.com/'), 'https://example.com/')
  assert.equal(canonicalizeUrl('  https://example.com/a  '), 'https://example.com/a')
})

test('canonicalizeUrl: hash routes are kept, plain anchors dropped', () => {
  assert.equal(canonicalizeUrl('https://app.example.com/#/docs/install'), 'https://app.example.com/#/docs/install')
  assert.equal(canonicalizeUrl('https://app.example.com/#!/docs'), 'https://app.example.com/#!/docs')
  assert.equal(canonicalizeUrl('https://app.example.com/guide#install'), 'https://app.example.com/guide')
  assert.equal(canonicalizeUrl('https://app.example.com/guide#'), 'https://app.example.com/guide')
  assert.ok(isHashRoute('#/a') && isHashRoute('#!/a') && !isHashRoute('#a') && !isHashRoute(''))
})

test('canonicalizeUrl: tracking parameters go, content parameters stay, remainder is sorted', () => {
  assert.equal(
    canonicalizeUrl('https://example.com/a?utm_source=x&id=7&fbclid=1&UTM_Medium=y&gclid=2&page=3&spm=a.b&vd_source=zz&share_source=copy'),
    'https://example.com/a?id=7&page=3',
  )
  assert.equal(canonicalizeUrl('https://example.com/a?b=2&a=1&b=1'), 'https://example.com/a?a=1&b=2&b=1')
  assert.equal(canonicalizeUrl('https://example.com/a?b=1&a=2'), canonicalizeUrl('https://example.com/a?a=2&b=1'))
  assert.equal(canonicalizeUrl('https://example.com/a?utm_source=x'), 'https://example.com/a')
  assert.equal(canonicalizeUrl('https://example.com/s?q=node+sqlite&v=22.5'), 'https://example.com/s?q=node+sqlite&v=22.5')
  assert.equal(canonicalizeUrl('https://www.bilibili.com/video/BV1xx?spm_id_from=333.1&vd_source=abc&p=2'), 'https://www.bilibili.com/video/BV1xx?p=2')
})

test('canonicalizeUrl: ambiguous names `ref` and `from` are only dropped when they are clearly tracking', () => {
  // git ref on a code forge, and version/sha-like values elsewhere, are content
  assert.equal(canonicalizeUrl('https://github.com/o/r/blob/x/README.md?ref=feature-branch'), 'https://github.com/o/r/blob/x/README.md?ref=feature-branch')
  assert.equal(canonicalizeUrl('https://cdn.example.com/pkg?ref=v1.2.3'), 'https://cdn.example.com/pkg?ref=v1.2.3')
  assert.equal(canonicalizeUrl('https://cdn.example.com/pkg?ref=abcdef1234'), 'https://cdn.example.com/pkg?ref=abcdef1234')
  assert.equal(canonicalizeUrl('https://blog.example.com/p?ref=newsletter'), 'https://blog.example.com/p')
  // numeric `from` is an offset; `from=search` is a referrer tag
  assert.equal(canonicalizeUrl('https://api.example.com/items?from=20&size=10'), 'https://api.example.com/items?from=20&size=10')
  assert.equal(canonicalizeUrl('https://example.com/p?from=search&id=3'), 'https://example.com/p?id=3')
  assert.equal(isTrackingParam('from', '', 'example.com'), false)
})

test('canonicalizeUrl: host-scoped WeChat parameters, content ids kept', () => {
  assert.equal(
    canonicalizeUrl('https://mp.weixin.qq.com/s?__biz=MzA&mid=1&idx=2&sn=abc&chksm=zz&scene=27'),
    'https://mp.weixin.qq.com/s?__biz=MzA&idx=2&mid=1&sn=abc',
  )
  assert.equal(canonicalizeUrl('https://example.com/s?scene=27&chksm=1'), 'https://example.com/s?chksm=1&scene=27')
})

test('canonicalizeUrl: percent-escapes normalised, scheme and www kept distinct, junk passes through', () => {
  assert.equal(canonicalizeUrl('https://example.com/%e4%b8%ad%e6%96%87/'), 'https://example.com/%E4%B8%AD%E6%96%87')
  assert.notEqual(canonicalizeUrl('http://example.com/a'), canonicalizeUrl('https://example.com/a'))
  assert.notEqual(canonicalizeUrl('https://www.example.com/a'), canonicalizeUrl('https://example.com/a'))
  assert.equal(canonicalizeUrl('not a url'), 'not a url')
  assert.equal(canonicalizeUrl('mailto:a@b.com'), 'mailto:a@b.com')
})
