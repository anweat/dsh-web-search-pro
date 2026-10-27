import { test } from 'node:test'
import assert from 'node:assert/strict'

/** A minimal `document`: enough for ensureStyles (getElementById, createElement, head.append). */
function fakeDocument() {
  const nodes: { id: string; textContent: string | null }[] = []
  return {
    nodes,
    getElementById: (id: string) => nodes.find(node => node.id === id) ?? null,
    createElement: () => ({ id: '', textContent: null as string | null }),
    head: { append: (node: { id: string; textContent: string | null }) => { nodes.push(node) } },
  }
}

test('ensureStyles refreshes a stylesheet an older version left in the page instead of keeping it', async () => {
  const doc = fakeDocument()
  ;(globalThis as { document?: unknown }).document = doc
  try {
    const { ensureStyles } = await import('../src/client/styles.ts')
    doc.nodes.push({ id: 'web-search-pro-settings-styles', textContent: '.old-version{}' })
    ensureStyles()
    assert.equal(doc.nodes.length, 1, 'no second <style> element')
    assert.ok(doc.nodes[0]!.textContent!.includes('.wsp-'), 'the current CSS replaced the old one')
    const css = doc.nodes[0]!.textContent
    ensureStyles()
    assert.equal(doc.nodes.length, 1)
    assert.equal(doc.nodes[0]!.textContent, css)
  } finally {
    delete (globalThis as { document?: unknown }).document
  }
})

test('ensureStyles injects the stylesheet once when the page has none', async () => {
  const doc = fakeDocument()
  ;(globalThis as { document?: unknown }).document = doc
  try {
    const { ensureStyles } = await import('../src/client/styles.ts')
    ensureStyles()
    ensureStyles()
    assert.equal(doc.nodes.length, 1)
    assert.equal(doc.nodes[0]!.id, 'web-search-pro-settings-styles')
  } finally {
    delete (globalThis as { document?: unknown }).document
  }
})
