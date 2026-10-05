import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Config, resolveConfig } from '../src/config.ts'
import { resolveProviders } from '../src/pipeline/judges/providers.ts'
import { BUILTIN_RUBRIC_IDS, overrideProblems } from '../src/pipeline/rubrics-spec.ts'
import { resolveRubric } from '../src/pipeline/rubrics.ts'
import { customProviders, evidenceIssues, nextVersion, providerChoices, rubricEntryProblems } from '../src/client/validators.ts'
import { rubricField } from '../src/client/form-specs.ts'
import { harness } from './settings-harness.ts'

const GOOD = { protocol: 'systemone', baseUrl: 'https://jev.example.com', model: 'm1', keyRef: 'MY_JEV_KEY' }

// ── providers ───────────────────────────────────────────────────────────────

test('custom providers: the card runs the server validation and words its errors the same way', () => {
  const input = {
    good: GOOD,
    plain: { ...GOOD, baseUrl: 'http://jev.example.com' },
    'Bad Id': GOOD,
    rr: { protocol: 'rerank', baseUrl: 'https://rerank.example.com', model: 'r' },
    typo: { ...GOOD, modle: 'x' },
    'laya-local': { baseUrl: 'ftp://nowhere' },
  }
  const card = customProviders(input)
  const server = resolveProviders({ providers: input })
  assert.deepEqual(card.problems.filter(p => !p.includes('looks like a secret')), server.diagnostics, 'same diagnostics as the server produces')
  assert.deepEqual(card.ids, ['good', 'rr'], 'an uncalibrated reranker is a valid definition (it is unusable until calibrated, which is a warning)')
  assert.ok(card.problems.some(p => p.includes('evidence.judge.providers.plain ignored') && p.includes('baseUrl must be https (http is only allowed for localhost')))
  assert.ok(card.problems.some(p => p.includes('Bad Id') && p.includes('the id must be lowercase')))
  assert.ok(card.problems.some(p => p.includes('unknown field "modle"')))
  assert.ok(card.problems.some(p => p.includes('evidence.judge.providers.laya-local ignored, the built-in preset is kept')))
  assert.ok(!card.ids.includes('plain') && !card.ids.includes('typo') && !card.ids.includes('Bad Id') && !card.ids.includes('laya-local'))
})

test('custom providers never carry a key value: secret-looking fields are refused, keyRef names are the only way', () => {
  const card = customProviders({
    leak: { ...GOOD, extraBody: { api_key: 'sk-live-123', nested: { Authorization: 'Bearer x' } } },
    ok: { ...GOOD, extraBody: { max_len: 512 } },
    'bad-ref': { ...GOOD, keyRef: 'sk-live 123' },
  })
  const text = card.problems.join('\n')
  assert.match(text, /providers\.leak\.extraBody\.api_key looks like a secret/)
  assert.match(text, /providers\.leak\.extraBody\.nested\.Authorization looks like a secret/)
  assert.match(text, /providers\.bad-ref ignored: keyRef must be a credentials ref \/ environment variable name \(not the key itself\)/)
  // Messages name the field, never its value.
  assert.doesNotMatch(text, /sk-live|Bearer x/)
  assert.deepEqual(card.ids, ['ok'])
  assert.deepEqual(customProviders('nope').problems, ['evidence.judge.providers must be an object keyed by provider id'])
})

test('the provider choices are the presets plus the valid custom ids', () => {
  assert.deepEqual(providerChoices(undefined), ['bocha-jev', 'typesafe-jev', 'laya-local', 'jina-rerank', 'cohere-rerank'])
  assert.deepEqual(providerChoices({ mine: GOOD, broken: { protocol: 'x' } }), ['bocha-jev', 'typesafe-jev', 'laya-local', 'jina-rerank', 'cohere-rerank', 'mine'])
})

// ── rubrics ─────────────────────────────────────────────────────────────────

test('rubric override problems: unknown variables, level counts, versions, limits', () => {
  const messages = (id: string, entry: unknown) => rubricEntryProblems(id, entry).join(' | ')
  assert.match(messages('score.support', { version: 'v2', instructions: 'Rate {need} against {candidate} for {topic}' }), /unknown variable \{topic\} \(allowed: \{task\} \{need\} \{candidate\}\)/)
  assert.match(messages('score.support', { version: 'v2', instructions: 'Rate {need} for {constraint}' }), /variable \{constraint\} is not available in score\.support/)
  assert.match(messages('score.support', { version: 'v2', instructions: 'no variables at all' }), /instructions must contain \{need\}.*instructions must contain \{candidate\}/)
  assert.match(messages('score.support', { version: 'v2', criteria: ['only one'] }), /criteria needs 2-10 levels, lowest first/)
  assert.match(messages('score.support', { version: 'v2', criteria: Array.from({ length: 11 }, (_, i) => 'level ' + i) }), /criteria needs 2-10 levels/)
  assert.match(messages('score.support', { version: 'v2', criteria: ['a', ''] }), /each criterion must be a non-empty string/)
  assert.match(messages('gate.relevance', { version: 'v2', criteria: ['a', 'b'] }), /criteria only apply to score rubrics/)
  assert.match(messages('score.support', { version: 'bad version' }), /version must be a label like "v2"/)
  assert.match(messages('score.support', { version: 'v2', maxStateChars: 5 }), /maxStateChars must be an integer in 20\.\.2000/)
  assert.match(messages('score.support', { version: 'v2', maxCandidateChars: 'many' }), /maxCandidateChars must be an integer in 100\.\.8000/)
  assert.match(messages('score.support', { version: 'v2', color: 'red' }), /unknown field "color"/)
  assert.match(messages('nope', { version: 'v2' }), /unknown rubric id "nope" \(known: score\.support, gate\.relevance, gate\.constraint, cover\.sufficient\)/)
  assert.equal(messages('score.support', 'text'), 'not an object')
  // The version must differ from the built-in one: changed text under "v1" says so, and so does a bare "v1".
  assert.match(messages('score.support', { version: 'v1', instructions: 'Rate {need} for {candidate}' }), /changed content needs a new version \(not "v1"\)/)
  assert.match(messages('score.support', { version: 'v1' }), /version must differ from the built-in "v1"/)
  assert.equal(messages('score.support', { version: 'v2', instructions: 'Rate {need} for {candidate} in {task}', criteria: ['a', 'b', 'c'], maxStateChars: 300, maxCandidateChars: 1500 }), '')
})

test('every entry the card calls valid is one the server applies, and the other way round', () => {
  const entries: [string, Record<string, unknown>][] = [
    ['score.support', { version: 'v2', instructions: 'Rate {need} for {candidate}', criteria: ['a', 'b'] }],
    ['score.support', { version: 'v1', instructions: 'Rate {need} for {candidate}' }],
    ['score.support', { version: 'v2', instructions: 'Rate {nope} for {candidate}' }],
    ['gate.constraint', { version: 'v2', instructions: 'Does {candidate} meet {constraint}?' }],
    ['gate.constraint', { version: 'v2', instructions: 'Does {candidate} meet {need}?' }],
    ['cover.sufficient', { version: 'v2', maxCandidateChars: 99 }],
    ['cover.sufficient', { version: 'v2', maxCandidateChars: 3000 }],
  ]
  for (const [id, entry] of entries) {
    const server = resolveRubric(id, { [id]: entry })
    // The shared rule set is the server's: it ignores the entry exactly when the shared validation finds a problem.
    assert.equal(server.diagnostics.length === 0, overrideProblems(id, entry).length === 0, id + ' ' + JSON.stringify(entry))
    // The card is at most stricter (a bare built-in label).
    if (rubricEntryProblems(id, entry).length === 0) assert.equal(server.diagnostics.length, 0)
  }
  assert.equal(nextVersion('v1'), 'v2')
  assert.equal(nextVersion('v9'), 'v10')
  assert.equal(nextVersion('stable'), 'stable2')
})

// ── draft-level issues ──────────────────────────────────────────────────────

test('evidence issues: undefined providers, coverage needs, budget, with the server wording', () => {
  const issues = (ev: Record<string, unknown>) => evidenceIssues(ev).map(i => `${i.level}:${i.field}:${i.message}`)
  assert.deepEqual(issues({}), [])
  assert.match(issues({ judge: { provider: 'ghost' } })[0]!, /^error:evidence\.judge\.provider:provider "ghost" is not defined \(known: bocha-jev, typesafe-jev, laya-local, jina-rerank, cohere-rerank\)$/)
  // A placeholder or uncalibrated provider is accepted but cannot run.
  assert.match(issues({ jevMode: 'shadow', judge: { provider: 'typesafe-jev' } })[0]!, /^warning:evidence\.judge\.provider:provider typesafe-jev is a placeholder preset/)
  assert.match(issues({ judge: { mode: 'control', provider: 'jina-rerank' } })[0]!, /^warning:.*rerank provider: set calibration\.points/)
  assert.deepEqual(issues({ judge: { provider: 'jina-rerank' } }), [], 'mode off: nothing to warn about')
  // Coverage.
  assert.deepEqual(issues({ coverage: { mode: 'shadow' } }), [], 'the shipped calibration covers bocha-jev + cover.sufficient@v1')
  assert.match(issues({ coverage: { mode: 'control', provider: 'laya-local' } }).join('\n'), /warning:evidence\.coverage\.thresholds\.weak:no calibrated thresholds for laya-local\|cover\.sufficient@v1/)
  assert.match(issues({ coverage: { mode: 'shadow' }, rubrics: { 'cover.sufficient': { version: 'v2', instructions: 'Does {candidate} answer {need}?' } } }).join('\n'), /no calibrated thresholds for bocha-jev\|cover\.sufficient@v2/)
  assert.match(issues({ coverage: { mode: 'shadow', provider: 'jina-rerank', thresholds: { weak: 0.1, covered: 0.3 } } }).join('\n'), /warning:evidence\.coverage\.provider:the coverage judge needs a provider speaking the systemone protocol; jina-rerank speaks rerank/)
  assert.match(issues({ coverage: { mode: 'shadow', provider: 'ghost' } }).join('\n'), /error:evidence\.coverage\.provider:provider "ghost" is not defined/)
  // Budget.
  assert.match(issues({ budget: { timezone: 'Mars/Olympus' } })[0]!, /^error:evidence\.budget\.timezone:evidence\.budget\.timezone "Mars\/Olympus" is not a time zone/)
  assert.match(issues({ budget: { providers: { 'bocha-jev': { dailyInputTokens: -1 } } } })[0]!, /^error:evidence\.budget\.providers:evidence\.budget\.providers\.bocha-jev\.dailyInputTokens ignored: must be a number >= 0/)
})

// ── the rubric editor and the provider editor through the controller ─────────

test('the rubric editor starts from the built-in text, validates as the server does, and restores the default', async () => {
  const { scope, controller } = harness()
  const state = () => controller.snapshot().rubrics.find(r => r.id === 'score.support')!
  assert.deepEqual(controller.snapshot().rubrics.map(r => r.id), [...BUILTIN_RUBRIC_IDS])
  assert.equal(state().editing, false)
  assert.equal(state().activeVersion, 'v1')

  controller.startRubric('score.support')
  assert.equal(state().editing, true)
  assert.equal(state().entry.version, 'v2')
  assert.equal(state().entry.criteria.split('\n').length, 4)
  assert.equal(controller.snapshot().invalid, false)

  controller.editRubric('score.support', 'instructions', 'Rate {need} against {candidate} using {pizza}')
  assert.equal(controller.snapshot().invalid, true)
  assert.match(state().problems.join('\n'), /unknown variable \{pizza\} \(allowed: \{task\} \{need\} \{candidate\}\)/)
  assert.equal(state().invalid, true)
  await controller.save()
  assert.deepEqual(scope.writes, [], 'a rubric the server would ignore is not saved')

  controller.editRubric('score.support', 'instructions', 'Rate {need} against {candidate} within {task}')
  controller.editRubric('score.support', 'criteria', 'nothing\n\nsame topic\n')
  assert.equal(state().entry.criteria, 'nothing\n\nsame topic\n', 'blank lines survive while typing')
  assert.equal(controller.snapshot().invalid, false)
  controller.editRubric('score.support', 'maxCandidateChars', '10')
  assert.match(state().problems.join('\n'), /maxCandidateChars must be an integer in 100\.\.8000/)
  controller.editRubric('score.support', 'maxCandidateChars', '1500')
  controller.editRubric('score.support', 'version', 'v1')
  assert.match(state().problems.join('\n'), /changed content needs a new version \(not "v1"\)/)
  controller.editRubric('score.support', 'version', 'mine-1')
  assert.equal(state().problems.length, 0)
  await controller.save()
  assert.deepEqual(scope.writes, ['set:evidence'])

  const stored = (scope.user.evidence as { rubrics: Record<string, unknown> }).rubrics['score.support']
  assert.deepEqual(stored, { version: 'mine-1', instructions: 'Rate {need} against {candidate} within {task}', criteria: ['nothing', 'same topic'], maxStateChars: 200, maxCandidateChars: 1500 })
  // The real schema parse and the server take it, and the active version is the override's.
  const evidence = resolveConfig((Config as unknown as (value: unknown) => never)({ evidence: scope.user.evidence })).evidence
  assert.deepEqual(resolveRubric('score.support', evidence.rubrics).diagnostics, [])
  assert.equal(resolveRubric('score.support', evidence.rubrics).rubric.version, 'mine-1')
  assert.equal(state().activeVersion, 'mine-1')
  assert.equal(state().overridden, true)

  controller.restoreRubric('score.support')
  assert.equal(state().editing, false)
  await controller.save()
  assert.equal(Object.hasOwn(scope.user, 'evidence'), false, 'restore default removes the override and the emptied evidence object')
  assert.equal(state().activeVersion, 'v1')
  controller.dispose()
})

test('the rubric editor handles non-score rubrics, other overrides next to it, and an ignored stored entry', async () => {
  const stored = { evidence: { rubrics: { 'gate.relevance': { version: 'v2', instructions: 'broken {nope} {need} {candidate}' }, 'old.rubric': { version: 'v1' } } } }
  const { scope, controller } = harness(undefined, stored)
  const gate = () => controller.snapshot().rubrics.find(r => r.id === 'gate.relevance')!
  assert.equal(gate().editing, true)
  assert.equal(gate().activeVersion, 'v1', 'an override the server ignores is not the active version')
  assert.match(gate().problems.join('\n'), /unknown variable \{nope\}/)
  assert.equal(controller.snapshot().invalid, false, 'a stored problem the person has not touched does not block unrelated saves')
  assert.deepEqual(controller.snapshot().unknownRubrics, ['old.rubric'])

  controller.startRubric('gate.constraint')
  const constraint = controller.snapshot().rubrics.find(r => r.id === 'gate.constraint')!
  assert.equal(constraint.entry.criteria, '', 'only score rubrics have levels')
  controller.editRubric('gate.constraint', 'criteria', 'a\nb')
  assert.match(controller.snapshot().rubrics.find(r => r.id === 'gate.constraint')!.problems.join('\n'), /criteria only apply to score rubrics/)
  controller.editRubric('gate.constraint', 'criteria', '')
  assert.equal(controller.snapshot().invalid, false)
  await controller.save()
  const rubrics = (scope.user.evidence as { rubrics: Record<string, unknown> }).rubrics
  assert.deepEqual(Object.keys(rubrics).sort(), ['gate.constraint', 'gate.relevance', 'old.rubric'])
  controller.dispose()
})

test('the provider editor refuses what the server would ignore and offers valid custom ids to the selects', async () => {
  const { scope, controller } = harness()
  assert.deepEqual(controller.snapshot().providerChoices, ['bocha-jev', 'typesafe-jev', 'laya-local', 'jina-rerank', 'cohere-rerank'])

  controller.edit('evidence.judge.providers', '{"mine":{"protocol":"systemone","baseUrl":"http://jev.example.com","model":"m"}}')
  assert.equal(controller.snapshot().invalid, true)
  assert.match(controller.snapshot().fields['evidence.judge.providers'].message ?? '', /baseUrl must be https/)
  await controller.save()
  assert.deepEqual(scope.writes, [])

  controller.edit('evidence.judge.providers', '{"mine":{"protocol":"systemone","baseUrl":"https://jev.example.com","model":"m","extraBody":{"api_key":"sk-x"}}}')
  assert.match(controller.snapshot().fields['evidence.judge.providers'].message ?? '', /looks like a secret/)
  assert.doesNotMatch(controller.snapshot().fields['evidence.judge.providers'].message ?? '', /sk-x/)

  controller.edit('evidence.judge.providers', '{"mine":{"protocol":"systemone","baseUrl":"https://jev.example.com","model":"m","keyRef":"MY_KEY"}}')
  assert.equal(controller.snapshot().invalid, false)
  assert.deepEqual(controller.snapshot().providerChoices.slice(-1), ['mine'])
  controller.edit('evidence.judge.provider', 'mine')
  assert.equal(controller.snapshot().invalid, false)
  controller.edit('evidence.judge.provider', 'ghost')
  assert.equal(controller.snapshot().invalid, true)
  assert.match(controller.snapshot().fields['evidence.judge.provider'].message ?? '', /provider "ghost" is not defined/)
  controller.edit('evidence.judge.provider', 'mine')
  await controller.save()
  assert.deepEqual(scope.user.evidence, { judge: { providers: { mine: { protocol: 'systemone', baseUrl: 'https://jev.example.com', model: 'm', keyRef: 'MY_KEY' } }, provider: 'mine' } })

  // Removing the provider the selection names is refused until the selection changes.
  controller.edit('evidence.judge.providers', '')
  assert.equal(controller.snapshot().invalid, true)
  assert.match(controller.snapshot().fields['evidence.judge.provider'].message ?? '', /provider "mine" is not defined/)
  controller.dispose()
})

// ── the client bundle only gets pure shared modules ─────────────────────────

test('the client module graph imports no Node module and no server-only module', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
  const seen = new Map<string, string[]>()
  const visit = (file: string): void => {
    if (seen.has(file)) return
    const source = readFileSync(file, 'utf8')
    // Value imports and re-exports only; `import type` is erased and cannot pull code in.
    const specs = [...source.matchAll(/^(?:import|export)\s+(?!type\b)(?:[\w$*\s,]|\{[^}]*\})+?\s*from\s+['"]([^'"]+)['"]/gm)].map(match => match[1]!)
    seen.set(file, specs)
    for (const spec of specs) if (spec.startsWith('.')) visit(resolve(dirname(file), spec))
  }
  visit(resolve(root, 'client/index.ts'))
  const external = new Map<string, string[]>()
  for (const [file, specs] of seen) for (const spec of specs.filter(spec => !spec.startsWith('.'))) external.set(spec, [...external.get(spec) ?? [], file.slice(root.length + 1)])
  const allowed = new Set(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots'])
  const offenders = [...external].filter(([spec]) => !allowed.has(spec)).map(([spec, files]) => `${spec} <- ${files.join(', ')}`)
  assert.deepEqual(offenders, [])
  // The shared pure modules the card depends on are in the graph, so this test cannot pass by walking nothing.
  const files = [...seen.keys()].map(file => file.slice(root.length + 1))
  for (const expected of ['pipeline/rubrics-spec.ts', 'pipeline/judges/providers-spec.ts', 'pipeline/judges/calibration-spec.ts', 'pipeline/budget-spec.ts', 'pipeline/coverage.ts', 'config-enums.ts', 'providers/keyed-meta.ts']) assert.ok(files.includes(expected), expected)
  for (const forbidden of ['config.ts', 'pipeline/rubrics.ts', 'pipeline/ledger.ts', 'pipeline/judges/providers.ts', 'pipeline/judges/calibration.ts', 'providers/keyed.ts', 'store.ts']) assert.ok(!files.includes(forbidden), forbidden)
})

test('rubricField names match the form fields', () => {
  assert.equal(rubricField('score.support'), 'evidence.rubrics.score.support')
})
