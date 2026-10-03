import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { ACTIONS, CALL_TOOL, INDEX_TOOL, findAction } from '../src/actions/registry.ts'
import { ACTION_GROUPS } from '../src/actions/types.ts'
import { validateArgs } from '../src/actions/schema.ts'
import { COMPACT_GUIDE, renderIndex } from '../src/actions/index-view.ts'
import { LEGACY_TOOL_NAMES } from '../src/actions/legacy.ts'
import { SKILL_DIR, SKILL_NAME, createSkillProvider, parseSkillFile, readSkill } from '../src/skill.ts'
import { CONSTRAINT_KINDS, PROFILES } from '../src/pipeline/types.ts'
import { parseConstraints, parseNeeds } from '../src/pipeline/task.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: 'data:text/javascript,export const defineTool = value => value', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
const plugin = (await import('../src/index.ts')).default

const SKILL_FILES = ['SKILL.md', ...fs.readdirSync(path.join(SKILL_DIR, 'references')).filter(file => file.endsWith('.md')).map(file => 'references/' + file)]
const read = (file: string): string => fs.readFileSync(path.join(SKILL_DIR, file), 'utf8')

/** The old tool names; none may appear in guidance, since the model cannot call them. */
const LEGACY = new RegExp('\\b(' + LEGACY_TOOL_NAMES.join('|') + ')\\b')

test('the skill is packaged where the plugin looks for it', () => {
  assert.ok(fs.existsSync(path.join(SKILL_DIR, 'SKILL.md')), SKILL_DIR)
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { files: string[] }
  assert.ok(pkg.files.includes('assets'), 'package.json files must ship assets/')
  assert.ok(SKILL_DIR.endsWith(path.join('assets', 'skills', 'dsh-web-search-pro') + path.sep))
  // lib/ sits next to src/ one level below the package root, so the same relative URL resolves from the build.
  const built = path.join(path.dirname(new URL('../package.json', import.meta.url).pathname), 'lib')
  if (fs.existsSync(path.join(built, 'skill.js'))) {
    assert.ok(fs.readFileSync(path.join(built, 'skill.js'), 'utf8').includes('../assets/skills/dsh-web-search-pro/'))
  }
})

test('SKILL.md has the front matter the Host needs and stays within its size budget', () => {
  const skill = readSkill()
  assert.equal(skill.name, SKILL_NAME)
  assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  assert.match(skill.description, /web research and reading pages/i)
  assert.match(skill.description, /联网检索/)
  assert.ok(skill.description.length <= 1000)
  assert.ok(skill.body.length <= 7_000, `skill body is ${skill.body.length} chars (~2k tokens max)`)
  assert.ok(!skill.body.startsWith('---'))
  assert.throws(() => parseSkillFile('no front matter'), /front matter/)
})

test('every reference file is linked from SKILL.md', () => {
  const body = read('SKILL.md')
  assert.deepEqual(SKILL_FILES.filter(file => file !== 'SKILL.md').sort(), ['references/judges.md', 'references/sources.md', 'references/troubleshooting.md'])
  for (const file of SKILL_FILES.filter(file => file !== 'SKILL.md')) assert.ok(body.includes(file), `${file} is not referenced`)
  for (const [, link] of body.matchAll(/`(references\/[\w.-]+)`/g)) assert.ok(SKILL_FILES.includes(link!), `dangling reference ${link}`)
})

test('skill text and examples cannot drift from the action registry', () => {
  let namesChecked = 0
  let callsChecked = 0
  let indexChecked = 0
  const groupPattern = new RegExp(`(?<![\\w/.])(${ACTION_GROUPS.join('|')})\\.([a-z_]+)\\b(?!\\.md)`, 'g')
  for (const file of SKILL_FILES) {
    const text = read(file)
    assert.doesNotMatch(text, LEGACY, `${file} names a tool that no longer exists`)
    for (const match of text.matchAll(groupPattern)) {
      assert.ok(findAction(match[0]), `${file} mentions unknown action ${match[0]}`)
      namesChecked += 1
    }
    for (const block of text.matchAll(/```json (call|index)\n([\s\S]*?)```/g)) {
      const value = JSON.parse(block[2]!) as Record<string, unknown>
      if (block[1] === 'call') {
        assert.deepEqual(Object.keys(value).sort().filter(key => key !== 'args'), ['action'], `${file}: a call block is {action, args}`)
        const action = findAction(value.action)
        assert.ok(action, `${file} example calls unknown action ${String(value.action)}`)
        assert.deepEqual(validateArgs(action.params, value.args ?? {}).errors, [], `${file}: example for ${action.name} fails its schema`)
        const args = (value.args ?? {}) as Record<string, string>
        // The string-encoded arguments must parse the way the pipeline parses them.
        if (typeof args.profile === 'string') assert.ok((PROFILES as readonly string[]).includes(args.profile), `${file}: profile ${args.profile}`)
        if (typeof args.constraints === 'string') {
          const parsed = JSON.parse(args.constraints) as { kind: string; strength?: string }[]
          assert.ok(Array.isArray(parsed) && parsed.length > 0)
          assert.equal(parseConstraints(args.constraints).length, parsed.length, `${file}: every constraint is accepted by the parser`)
          for (const constraint of parsed) {
            assert.ok((CONSTRAINT_KINDS as readonly string[]).includes(constraint.kind), `${file}: constraint kind ${constraint.kind}`)
            assert.ok(['hard', 'soft'].includes(constraint.strength ?? 'soft'))
          }
        }
        if (typeof args.needs === 'string') assert.ok(parseNeeds(args.needs, args.task ?? '').needs.length >= 1)
        callsChecked += 1
      } else {
        assert.ok(Object.keys(value).every(key => ['group', 'action', 'query'].includes(key)), `${file}: bad index args`)
        if (typeof value.action === 'string') assert.ok(findAction(value.action))
        if (typeof value.group === 'string') assert.ok((ACTION_GROUPS as readonly string[]).includes(value.group))
        indexChecked += 1
      }
    }
  }
  assert.ok(namesChecked >= 30, `only ${namesChecked} action names were checked`)
  assert.ok(callsChecked >= 8, `only ${callsChecked} call examples were checked`)
  assert.ok(indexChecked >= 0)
})

test('the everyday actions the skill promises examples for are all demonstrated, including one Chinese and one English evidence search', () => {
  const body = read('SKILL.md')
  for (const action of ['search.run', 'search.recommend', 'read.fetch', 'history.expand']) assert.match(body, new RegExp(`"action":"${action.replace('.', '\\.')}"`), `${action} has no example`)
  assert.match(body, /"action":"read\.fetch","args":\{"url":"[^"]+","offset":\d+\}/, 'offset continuation is demonstrated')
  const searches = [...body.matchAll(/```json call\n(\{"action":"search\.run"[\s\S]*?)```/g)].map(match => JSON.parse(match[1]!).args as Record<string, string>)
  assert.ok(searches.some(args => /[一-鿿]/.test(args.task!) && args.profile && args.needs), 'a Chinese worked example with task, profile and needs')
  assert.ok(searches.some(args => /^[\x20-\x7e]+$/.test(args.task!) && args.profile && args.needs), 'an English worked example with task, profile and needs')
  assert.ok(searches.some(args => args.constraints), 'constraints usage is demonstrated')
  assert.ok(searches.some(args => args.engines), 'explicit engines are demonstrated')
  // The guidance carries the rules the plugin depends on.
  assert.match(body, /Coverage is heuristic/)
  assert.match(body, /never all|Never fan out/i)
  assert.match(body, /browser_index/)
  assert.match(body, /dsh-browser/)
  assert.match(body, /`gaps`/)
  assert.ok(ACTIONS.length > 0)
})

test('error codes in the skill table exist, and so do the gap reasons it names', async () => {
  const { ERROR_CODES } = await import('../src/actions/types.ts')
  const body = read('SKILL.md')
  for (const [, code] of body.matchAll(/^\| `([A-Z_]+)`/gm)) assert.ok((ERROR_CODES as readonly string[]).includes(code!), `${code} is not an error code`)
  const select = fs.readFileSync(new URL('../src/pipeline/select.ts', import.meta.url), 'utf8')
  for (const [, reason] of body.matchAll(/`(no_candidates|no_page_content|weak_support|budget)`/g)) assert.ok(select.includes(`'${reason}'`), reason)
})

test('the skill provider matches the Host provider contract and serves the packaged body', async () => {
  const provider = createSkillProvider()
  assert.equal(provider.name, 'dsh-web-search-pro')
  const [candidate] = await provider.list()
  assert.ok(candidate)
  assert.equal(candidate.name, 'dsh-web-search-pro')
  assert.equal(candidate.source, 'bundled')
  assert.equal(candidate.rank, 600)
  assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true })
  assert.deepEqual(candidate.resourceBase, { kind: 'directory', path: SKILL_DIR })
  const loaded = await provider.get()
  assert.equal(loaded.name, 'dsh-web-search-pro')
  assert.match(loaded.content, /^# dsh-web-search-pro/)
  assert.doesNotMatch(loaded.content, /^---/)
  // Relative reference files resolve against the advertised base directory.
  for (const [, link] of loaded.content.matchAll(/`(references\/[\w.-]+)`/g)) assert.ok(fs.existsSync(path.join(candidate.resourceBase.path, link!)), link)
})

// ── registration against a real Cordis context ──────────────────────────────

function hostWith(tools: any[], opts: { web?: any } = {}): Context {
  const root = new Context()
  root.provide('tools', { register(tool: any) { tools.push(tool); return () => {} } })
  root.provide('systemPrompt', { section() {} })
  if (opts.web) root.provide('web', opts.web)
  return root
}

const settle = () => new Promise(resolve => setTimeout(resolve, 40))

function config(dir: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dbPath: path.join(dir, 'store.db'), engines: ['seam'], enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false,
    playwright: { enabled: true, snapshotDir: path.join(dir, 'shots') }, ...extra,
  }
}

test('the plugin does not depend on a skill service: it declares none and works without one (root carries the compact guide)', async () => {
  assert.deepEqual(plugin.inject, ['tools', 'systemPrompt'])
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-noskill-'))
  const tools: any[] = []
  const host = hostWith(tools)
  let fiber: { dispose(): void } | undefined
  try {
    fiber = host.plugin(plugin as never, config(dir) as never)
    await settle()
    // Cordis 4.0.4 would leave the plugin pending if `skills` were a required inject; the tools prove it ran.
    assert.deepEqual(tools.map(tool => tool.name).sort(), [CALL_TOOL, INDEX_TOOL])
    const index = tools.find(tool => tool.name === INDEX_TOOL)
    const root = (await index.execute({}, {})).text as string
    assert.ok(root.includes(COMPACT_GUIDE), 'the root carries the compact guide when no skill exists')
    assert.doesNotMatch(root, /Load skill/)
    const call = tools.find(tool => tool.name === CALL_TOOL)
    const reply = await call.execute({ action: 'cache.stats' }, { signal: new AbortController().signal })
    assert.equal(reply.ok, true, 'actions keep working without the skill')
  } finally {
    fiber?.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('when a skill service appears, the provider is registered and the guide gives way to a pointer; when it goes, the guide returns', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-skill-'))
  const tools: any[] = []
  const host = hostWith(tools)
  let fiber: { dispose(): void } | undefined
  const providers: any[] = []
  const unregistered: number[] = []
  try {
    fiber = host.plugin(plugin as never, config(dir) as never)
    await settle()
    const index = tools.find(tool => tool.name === INDEX_TOOL)
    assert.ok(((await index.execute({}, {})).text as string).includes('Guide:'))

    const skillHost = host.plugin({
      name: 'fake-skill-registry',
      apply(ctx: any) {
        ctx.provide('skills', { registerProvider(create: (control: unknown) => unknown) { providers.push(create({ signal: new AbortController().signal, invalidate() {} })); return () => { unregistered.push(1) } } })
      },
    } as never)
    await settle()
    assert.equal(providers.length, 1)
    assert.equal(providers[0].name, 'dsh-web-search-pro')
    assert.equal((await providers[0].list({}))[0].name, 'dsh-web-search-pro')
    const withSkill = (await index.execute({}, {})).text as string
    assert.match(withSkill, /Load skill "dsh-web-search-pro"/)
    assert.ok(!withSkill.includes('Guide:'))

    skillHost.dispose()
    await settle()
    assert.equal(unregistered.length, 1, 'the provider is withdrawn with the registry')
    assert.ok(((await index.execute({}, {})).text as string).includes('Guide:'))
  } finally {
    fiber?.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the ctx.web provider is unaffected by the tool surface and by the skill service', async () => {
  for (const withSkill of [false, true]) {
    for (const toolSurface of ['indexed', 'flat'] as const) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-web-provider-'))
      const registered: { search: any[]; fetch: any[] } = { search: [], fetch: [] }
      const web = { registerSearchProvider: (p: any) => { registered.search.push(p) }, registerFetchProvider: (p: any) => { registered.fetch.push(p) } }
      const tools: any[] = []
      const host = hostWith(tools, { web })
      let fiber: { dispose(): void } | undefined
      try {
        if (withSkill) host.provide('skills', { registerProvider: () => () => {} })
        fiber = host.plugin(plugin as never, config(dir, { registerProvider: true, providerId: 'wsp-test', toolSurface }) as never)
        await settle()
        assert.equal(registered.search.length, 1)
        assert.equal(registered.fetch.length, 1)
        assert.equal(registered.search[0].id, 'wsp-test')
        assert.equal(registered.fetch[0].id, 'wsp-test')
        assert.equal(typeof registered.search[0].search, 'function')
        assert.equal(registered.fetch[0].available(), true)
        assert.equal(tools.length, toolSurface === 'flat' ? ACTIONS.length : 2)
      } finally {
        fiber?.dispose()
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }
  }
})

test('index root and the skill agree on the everyday calls', () => {
  const root = renderIndex({}, { skillAvailable: true, browserReady: true }).text
  const body = read('SKILL.md')
  for (const action of ['search.run', 'read.fetch']) {
    assert.ok(root.includes(`action:"${action}"`), `root shows ${action}`)
    assert.ok(body.includes(`"action":"${action}"`), `skill shows ${action}`)
  }
})
