import assert from 'node:assert/strict'
import test from 'node:test'
import { validateCliAdapterSpec } from '../src/cli/spec.ts'
import {
  adaptersOf, checkForm, checkSpec, derivedSubcommands, echoSpec, errorsByField, formToSpec, freeId, newSpec, parseSpecText, specText, specToForm, withAdapter,
} from '../src/client/cli-form.ts'
import { harness } from './settings-harness.ts'

const jsonSpec = () => ({
  bins: ['mytool'], packageNote: 'mytool (npm i -g mytool)', platforms: ['weibo'], engine: true, confidence: 0.7,
  probe: { versionArgs: ['--version'], helpArgs: ['search', '--help'], mustContain: ['--json'] }, allowedSubcommands: ['search'],
  search: {
    argv: ['search', '{query}', '--limit', '{count}', '--json'], maxCount: 10, emptyWhen: ['no results'],
    output: { format: 'json', itemsPath: 'data', fields: { url: 'link', title: 'name', snippet: { template: '{a} - {b}' } } },
  },
  env: { passthrough: ['HTTPS_PROXY'] }, needsLogin: false, timeoutMs: 20000, maxOutputBytes: 1048576,
})

test('spec -> form -> spec keeps the spec: the keys the form has no control for stay as they were', () => {
  const spec = jsonSpec()
  const form = specToForm('mytool', spec)
  assert.deepEqual(
    { bin: form.bin, argv: form.argv, format: form.format, itemsPath: form.itemsPath, whole: form.whole, timeoutMs: form.timeoutMs, engine: form.engine, platforms: form.platforms, confidence: form.confidence, helpArgs: form.helpArgs, mustContain: form.mustContain, fields: form.fields, complex: form.complex },
    { bin: 'mytool', argv: ['search', '{query}', '--limit', '{count}', '--json'], format: 'json', itemsPath: 'data', whole: false, timeoutMs: '20000', engine: true, platforms: ['weibo'], confidence: '0.7', helpArgs: 'search --help', mustContain: ['--json'], fields: { url: 'link', title: 'name', snippet: '', publishedAt: '' }, complex: ['snippet'] },
  )
  const again = formToSpec(form, spec)
  assert.deepEqual(again, spec, 'an untouched form writes the same spec back (key order aside)')
  // A complex mapping (a template) is shown as such and kept; the others are plain paths.
  assert.deepEqual((again.search as { output: { fields: Record<string, unknown> } }).output.fields.snippet, { template: '{a} - {b}' })
  assert.equal(checkForm(form, spec).ok, true)
})

test('form edits land on the right keys; allowedSubcommands is derived from the argv templates (and the probe), never typed', () => {
  const base = jsonSpec()
  const form = specToForm('mytool', base)
  form.bin = 'other'
  form.argv = ['find', 'repos', '{query}', '-n', '{count}']
  form.helpArgs = 'find --help'
  form.itemsPath = 'items'
  form.fields.publishedAt = 'date'
  form.timeoutMs = '9000'
  form.confidence = ''
  form.platforms = ['weibo', 'douban']
  const spec = formToSpec(form, base) as ReturnType<typeof jsonSpec>
  assert.deepEqual(spec.bins, ['other'])
  assert.deepEqual(spec.search.argv, ['find', 'repos', '{query}', '-n', '{count}'])
  assert.deepEqual(spec.allowedSubcommands, ['find', 'repos'], 'the leading literal tokens of the argv, plus those of the probe: find')
  assert.equal(spec.search.output.itemsPath, 'items')
  assert.equal((spec.search.output.fields as Record<string, unknown>).publishedAt, 'date')
  assert.equal(spec.timeoutMs, 9000)
  assert.equal('confidence' in spec, false, 'an empty confidence box is the default: the key goes')
  assert.deepEqual(spec.platforms, ['weibo', 'douban'])
  assert.deepEqual((spec as { search: { emptyWhen?: string[] } }).search.emptyWhen, ['no results'], 'a key the form does not know is kept')
  assert.deepEqual(derivedSubcommands({ probe: { versionArgs: ['--version'], helpArgs: ['search', 'x', '--help'] }, search: { argv: ['search', '{query}'] }, read: { argv: ['read', '{url}'] }, searches: { a: { argv: ['gist', '{query}'] } } }), ['search', 'x', 'read', 'gist'])
  assert.equal(checkForm(form, base).ok, true, checkForm(form, base).errors.join('\n'))
})

test('a new entry: the template validates once the command is given; the echo example validates as it is', () => {
  const empty = specToForm('mytool', newSpec())
  const bare = checkForm(empty, newSpec())
  assert.equal(bare.ok, false)
  assert.ok(bare.byField.bin?.[0]?.includes('bins must be 1..4 command names'), 'the command box says what is wrong')
  empty.bin = 'mytool'
  const filled = checkForm(empty, newSpec())
  assert.equal(filled.ok, true, filled.errors.join('\n'))
  assert.equal((filled.spec as { packageNote: string }).packageNote, 'mytool (installed by you)', 'the package note is filled in from the command when empty')
  const echo = checkSpec('echo', echoSpec())
  assert.equal(echo.ok, true, echo.errors.join('\n'))
  assert.equal(validateCliAdapterSpec({ ...echoSpec(), id: 'echo' }, 'user').ok, true)
  const form = specToForm('echo', echoSpec())
  assert.equal(form.whole, true)
  assert.equal(form.format, 'text')
})

test('whole output through the form: the switch writes lines.whole and drops the field mapping; off writes url-lines; tsv takes columns', () => {
  const form = specToForm('mytool', jsonSpec())
  form.format = 'text'
  form.whole = true
  form.wholeMax = '3000'
  let spec = formToSpec(form, jsonSpec()) as { search: { output: Record<string, unknown> } }
  assert.deepEqual(spec.search.output, { format: 'text', lines: { mode: 'whole', maxChars: 3000 } })
  assert.equal(checkSpec('mytool', spec as never).ok, true, checkSpec('mytool', spec as never).errors.join('\n'))
  form.wholeMax = ''
  spec = formToSpec(form, jsonSpec()) as typeof spec
  assert.deepEqual(spec.search.output.lines, { mode: 'whole' })
  form.whole = false
  spec = formToSpec(form, jsonSpec()) as typeof spec
  assert.deepEqual(spec.search.output.lines, { mode: 'url-lines' })
  assert.deepEqual(spec.search.output.fields, { url: 'link', title: 'name', snippet: { template: '{a} - {b}' } }, 'the mapping is back when the switch is off')
  form.linesMode = 'tsv'
  form.columns = 'id, title ,url'
  spec = formToSpec(form, jsonSpec()) as typeof spec
  assert.deepEqual(spec.search.output.lines, { mode: 'tsv', columns: ['id', 'title', 'url'] })
  form.whole = true
  form.wholeMax = '50'
  assert.deepEqual(checkForm(form, jsonSpec()).byField.lines?.length, 1, 'maxChars out of range is reported at the whole-output control')
})

test('validation messages go to the control they are about, with the server\'s wording', () => {
  const base = jsonSpec()
  const form = specToForm('mytool', base)
  form.argv = ['login', '{query}']
  form.timeoutMs = 'soon'
  form.confidence = '1.5'
  form.fields.url = 'a b'
  form.itemsPath = 'a..b'
  form.maxOutputBytes = '5'
  const checked = checkForm(form, base)
  assert.equal(checked.ok, false)
  assert.match(checked.byField.argv!.join('\n'), /"login" is a write \/ login command \(read-only guard\)/)
  assert.match(checked.byField.timeoutMs![0]!, /timeoutMs must be an integer 1000\.\.180000/)
  assert.match(checked.byField.confidence![0]!, /confidence must be a number 0\.\.1/)
  assert.match(checked.byField.url![0]!, /"a b" is not a dotted path/)
  assert.match(checked.byField.itemsPath![0]!, /itemsPath must be a dotted path/)
  assert.match(checked.byField.maxOutputBytes![0]!, /maxOutputBytes must be an integer/)
  // Cookie flags are refused where the argv is edited.
  form.argv = ['search', '{query}', '--cookie-source', 'chrome']
  assert.match(checkForm(form, base).byField.argv!.join('\n'), /reads cookies or carries credentials/)
  // An id that is taken, or is not an id.
  assert.match(checkSpec('mytool', base, ['mytool']).byField.id![0]!, /already used by another entry/)
  assert.match(checkSpec('Bad Id', base).byField.id![0]!, /id must match/)
  assert.deepEqual(errorsByField('x', ['cliAdapters.x: needsLogin without login.command or env.required gives the user nothing to run']).general?.length, 1)
  assert.deepEqual(errorsByField('a.b', ['cliAdapters.a.b.search.argv must be an array of 1..24 non-empty strings']).argv?.length, 1, 'an id with a dot')
})

test('the JSON view and the form are two views of one object: text -> spec -> form -> spec -> text is stable, and a broken text says why', () => {
  const text = specText(jsonSpec())
  const parsed = parseSpecText(text)
  assert.ok('spec' in parsed)
  const form = specToForm('mytool', (parsed as { spec: Record<string, unknown> }).spec)
  assert.equal(specText(formToSpec(form, (parsed as { spec: Record<string, unknown> }).spec)), text)
  assert.ok('error' in parseSpecText('{ "bins": '))
  assert.deepEqual(parseSpecText('[]'), { error: 'the spec must be a JSON object' })
  // Raw edits the form has no control for show up in the form view and survive a form edit.
  const raw = { ...jsonSpec(), env: { required: ['MY_TOKEN'] }, needsLogin: true }
  const edited = specToForm('mytool', raw)
  edited.bin = 'renamed'
  const out = formToSpec(edited, raw) as typeof raw
  assert.deepEqual(out.env, { required: ['MY_TOKEN'] })
  assert.equal(out.needsLogin, true)
})

test('entries in the cliAdapters text: add, replace, remove; the others stay; no entry left = the empty text; a broken text is not touched', () => {
  const one = withAdapter('', 'echo', echoSpec())!
  assert.deepEqual(Object.keys(adaptersOf(one)!), ['echo'])
  const two = withAdapter(one, 'mine', jsonSpec())!
  assert.deepEqual(Object.keys(adaptersOf(two)!), ['echo', 'mine'])
  assert.deepEqual(adaptersOf(withAdapter(two, 'echo', { ...echoSpec(), confidence: 0.9 })!)!.echo, { ...echoSpec(), confidence: 0.9 })
  assert.deepEqual(Object.keys(adaptersOf(withAdapter(two, 'echo', undefined)!)!), ['mine'])
  assert.equal(withAdapter(one, 'echo', undefined), '')
  assert.equal(withAdapter('{ nope', 'echo', echoSpec()), undefined)
  assert.equal(withAdapter('[]', 'echo', echoSpec()), undefined)
  assert.equal(freeId('echo', ['echo']), 'echo-2')
  assert.equal(freeId('echo', ['echo', 'echo-2']), 'echo-3')
  assert.equal(freeId('Echo Copy!', []), 'echo-copy')
  assert.equal(freeId('', []), 'mycli')
})

test('through the form model: staging an entry, saving writes cliAdapters; a spec the server would refuse blocks the save with its words', async () => {
  const { scope, controller } = harness()
  const text = (): string => controller.snapshot().fields.cliAdapters.text
  controller.edit('cliAdapters', withAdapter(text(), 'echo', echoSpec())!)
  assert.equal(controller.snapshot().invalid, false, controller.snapshot().fields.cliAdapters.message ?? '')
  await controller.save()
  assert.deepEqual(scope.writes, ['set:cliAdapters'])
  assert.deepEqual((scope.user.cliAdapters as Record<string, unknown>).echo, echoSpec())
  controller.edit('cliAdapters', withAdapter(text(), 'echo', { ...echoSpec(), confidence: 3 })!)
  assert.equal(controller.snapshot().invalid, true)
  assert.match(controller.snapshot().fields.cliAdapters.message ?? '', /cliAdapters\.echo ignored.*confidence must be a number 0\.\.1/)
  controller.edit('cliAdapters', withAdapter(text(), 'echo', undefined)!)
  assert.equal(controller.snapshot().invalid, false)
  await controller.save()
  assert.equal(Object.hasOwn(scope.user, 'cliAdapters'), false, 'the last entry removed = the field is unset')
  controller.dispose()
})
