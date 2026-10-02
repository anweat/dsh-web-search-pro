import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { buildPromptText } from '../src/prompt.ts'
import { resolveConfig } from '../src/config.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: 'data:text/javascript,export const defineTool = value => value', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
const { registerTools } = await import('../src/tools.ts')

function definitions(): Map<string, any> {
  const config = resolveConfig({ dbPath: '/tmp/unused.db' } as never)
  const defs = new Map<string, any>()
  registerTools({ ctx: { tools: { register: (d: any) => defs.set(d.name, d) } } as any, config, dynamic: () => config, store: {} as any, router: {} as any, fetch: {} as any })
  return defs
}

test('always-on text stays condensed: prompt base <= 600, web_search_pro description <= 450, every description short', () => {
  assert.ok(buildPromptText(false).length <= 600, 'base ' + buildPromptText(false).length)
  assert.ok(buildPromptText(true).length <= 1100, 'with browser ' + buildPromptText(true).length)
  const defs = definitions()
  assert.equal(defs.size, 11)
  assert.ok(defs.get('web_search_pro').description.length <= 450, 'web_search_pro ' + defs.get('web_search_pro').description.length)
  for (const [name, def] of defs) assert.ok(def.description.length <= 450, name + ' description ' + def.description.length)
  const total = [...defs.values()].reduce((n, d) => n + d.description.length, 0)
  assert.ok(total <= 2400, 'descriptions total ' + total)
})

test('condensed descriptions keep the rules the model needs', () => {
  const defs = definitions()
  const d = (name: string): string => defs.get(name).description
  // Evidence mode is discoverable from the tool description alone.
  assert.match(d('web_search_pro'), /task/)
  assert.match(d('web_search_pro'), /profile \(docs_code, news_fact, academic, experience, compare, general\)/)
  assert.match(d('web_search_pro'), /evidence pack/)
  assert.match(d('web_fetch_pro'), /offset/)
  assert.match(d('web_fetch_pro'), /20000 chars/)
  assert.match(d('web_exa_contents'), /8000 chars per URL and 30000/)
  assert.match(d('web_platform_search'), /optional dsh-browser plugin/)
  assert.match(d('web_snapshot'), /optional dsh-browser plugin/)
  assert.match(d('web_deps'), /only when the user asks/)
  assert.match(d('web_deps'), /twitter/)
  assert.match(d('web_backend_status'), /Makes no search requests/)
  // Parameters that carry rules keep them.
  const params = (name: string, key: string): string => defs.get(name).parameters[key].description
  assert.match(params('web_search_pro', 'constraints'), /hard \(drop violators\) or soft/)
  assert.match(params('web_platform_search', 'platform'), /github, github-code/)
  assert.match(params('web_history', 'action'), /expand/)
  assert.match(params('web_fetch_pro', 'offset'), /nextOffset/)
})
