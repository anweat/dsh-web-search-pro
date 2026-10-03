import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { buildPromptText } from '../src/prompt.ts'
import { resolveConfig } from '../src/config.ts'
import { indexedToolDefinitions } from '../src/tool-defs.ts'
import { LEGACY_TOOL_NAMES } from '../src/actions/legacy.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: 'data:text/javascript,export const defineTool = value => value', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
const { registerTools } = await import('../src/tools.ts')

function definitions(toolSurface?: 'indexed' | 'flat'): Map<string, any> {
  const config = resolveConfig({ dbPath: '/tmp/unused.db', ...toolSurface ? { toolSurface } : {} } as never)
  const defs = new Map<string, any>()
  registerTools({ ctx: { tools: { register: (d: any) => defs.set(d.name, d) } } as any, config, dynamic: () => config, store: {} as any, router: {} as any, fetch: {} as any })
  return defs
}

/** What the Host sends the model for this plugin on every turn: prompt section, tool names, descriptions, parameter schemas. */
export function residentChars(hasBrowser: boolean): { prompt: number; names: number; descriptions: number; parameters: number; total: number } {
  const defs = [...definitions().values()]
  const prompt = buildPromptText(hasBrowser).length
  const names = defs.reduce((n, d) => n + d.name.length, 0)
  const descriptions = defs.reduce((n, d) => n + d.description.length, 0)
  const parameters = defs.reduce((n, d) => n + JSON.stringify(d.parameters).length, 0)
  return { prompt, names, descriptions, parameters, total: prompt + names + descriptions + parameters }
}

test('the indexed surface registers exactly web_index and web_call, with short descriptions', () => {
  const defs = definitions()
  assert.deepEqual([...defs.keys()].sort(), ['web_call', 'web_index'])
  for (const [name, def] of defs) assert.ok(def.description.length <= 200, name + ' description ' + def.description.length)
  // The registered tools are exactly the definitions the budget is measured from.
  for (const published of indexedToolDefinitions()) {
    const def = defs.get(published.name)
    assert.equal(def.description, published.description)
    assert.deepEqual(def.parameters, published.parameters)
  }
})

test('the indexed surface keeps the tools\' resident text small: descriptions + parameters under 900 chars', () => {
  const defs = [...definitions().values()]
  const descriptions = defs.reduce((n, d) => n + d.description.length, 0)
  const parameters = defs.reduce((n, d) => n + JSON.stringify(d.parameters).length, 0)
  assert.ok(descriptions <= 400, 'descriptions ' + descriptions)
  assert.ok(parameters <= 600, 'parameters ' + parameters)
  assert.ok(descriptions + parameters <= 900, 'tools ' + (descriptions + parameters))
})

test('condensed descriptions point at the registry and keep the rules the model needs', () => {
  const defs = definitions()
  assert.match(defs.get('web_index').description, /group/)
  assert.match(defs.get('web_index').description, /action/)
  assert.match(defs.get('web_call').description, /search\.run/)
  assert.match(defs.get('web_call').description, /INVALID_ARGS/)
  assert.equal(defs.get('web_call').parameters.action.required, true)
  assert.equal(defs.get('web_call').parameters.args.additionalProperties, true)
})

test('the prompt is one line naming the entry points and the skill; no old tool name or browser_* tool name is left', () => {
  const text = buildPromptText(false)
  assert.ok(text.length <= 250, 'prompt ' + text.length)
  assert.match(text, /web_index/)
  assert.match(text, /web_call/)
  assert.match(text, /search\.run/)
  assert.match(text, /skill dsh-web-search-pro/)
  assert.doesNotMatch(text, /\n/)
  const withBrowser = buildPromptText(true)
  assert.ok(withBrowser.startsWith(text))
  assert.match(withBrowser, /skill dsh-browser or browser_index/)
  for (const prompt of [text, withBrowser]) {
    assert.doesNotMatch(prompt, new RegExp('\\b(' + LEGACY_TOOL_NAMES.join('|') + ')\\b'), 'old tool names are gone from the prompt')
    // The only browser tool name that may appear is the entry point.
    assert.deepEqual([...prompt.matchAll(/\bbrowser_[a-z_]+/g)].map(match => match[0]).filter(name => name !== 'browser_index'), [])
  }
})

test('total resident text of this plugin (prompt + tool names, descriptions and parameters) stays within 1200 characters', () => {
  const plain = residentChars(false)
  const withBrowser = residentChars(true)
  assert.ok(plain.total <= 1_200, 'resident ' + JSON.stringify(plain))
  assert.ok(withBrowser.total <= 1_200, 'resident with browser ' + JSON.stringify(withBrowser))
  // Before M8a: prompt 612/1148 (without/with browser) + 11 tool descriptions 2391 + parameters 6193 + names 150 = 9346 / 9882.
  assert.ok(plain.total * 5 < 9_346, 'at least five times smaller than the 11-tool surface')
})
