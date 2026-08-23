import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const imports = [...source.matchAll(/\brequire\((['"])([^'"]+)\1\)/g)].map(match => match[2])
const allowed = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-runtime/client', '@deepseek-ai/dsh-client-ui-slots',
])
const forbidden = [...new Set(imports.filter(id => !allowed.has(id)))].sort()

assert.deepEqual(forbidden, [], `client bundle contains unavailable imports: ${forbidden.join(', ')}`)
assert.match(source, /settings\.plugin\.item/)
assert.match(source, /web-search-pro/)
assert.match(source, /Web Search Pro/)
console.log(`client bundle check passed (${[...new Set(imports)].length} module-table imports)`)
