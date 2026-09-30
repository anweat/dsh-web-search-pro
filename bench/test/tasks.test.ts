import test from 'node:test'
import assert from 'node:assert/strict'
import { assignSplits, loadTasks, validateTask } from '../src/tasks.ts'
import { PROFILES } from '../src/types.ts'

const tasks = loadTasks()

test('task set: 60 valid tasks with unique ids', () => {
  assert.equal(tasks.length, 60)
  assert.equal(new Set(tasks.map(t => t.id)).size, 60)
})

test('task set: about 10 tasks per profile, at least half Chinese', () => {
  for (const profile of PROFILES) {
    const n = tasks.filter(t => t.profile === profile).length
    assert.ok(n >= 8 && n <= 12, profile + ' has ' + n)
  }
  const zh = tasks.filter(t => t.lang === 'zh').length
  assert.ok(zh >= tasks.length / 2, 'zh tasks: ' + zh)
  assert.ok(tasks.some(t => t.lang === 'en') && tasks.some(t => t.lang === 'mixed'))
})

test('task set: id prefix matches profile', () => {
  const prefix = { docs_code: 'dc', news_fact: 'nf', academic: 'ac', experience: 'ex', compare: 'cp', general: 'gn' }
  for (const t of tasks) assert.equal(t.id.slice(0, 2), prefix[t.profile], t.id)
})

test('task set: time_window values stay relative to a fixed year, site values look like hosts', () => {
  for (const t of tasks) {
    for (const c of t.constraints) {
      if (c.kind === 'time_window') assert.match(c.value, /^20\d\d 年以后$/, t.id)
      if (c.kind === 'site' || c.kind === 'exclude_site') assert.match(c.value, /^[a-z0-9.-]+\.[a-z]{2,}$/, t.id)
    }
  }
})

test('task set: covers every constraint kind and the core traps', () => {
  const kinds = new Set(tasks.flatMap(t => t.constraints.map(c => c.kind)))
  for (const kind of ['must_term', 'exclude_term', 'entity', 'version', 'time_window', 'site', 'exclude_site', 'language', 'region', 'source_type']) {
    assert.ok(kinds.has(kind as never), 'missing constraint kind ' + kind)
  }
  const traps = new Set(tasks.flatMap(t => t.traps))
  for (const trap of ['同名实体', '版本差异', '否定条件', '导航页', '转载', '冲突信息', '替代方案满足需求但不满足字面约束']) {
    assert.ok(traps.has(trap), 'missing trap ' + trap)
  }
})

test('validateTask reports problems', () => {
  assert.ok(validateTask({}).length > 0)
  assert.deepEqual(validateTask(tasks[0]), [])
  const bad = { ...tasks[0]!, profile: 'nope', needs: [] }
  const errors = validateTask(bad)
  assert.ok(errors.some(e => e.includes('profile')) && errors.some(e => e.includes('needs')))
})

test('assignSplits is deterministic and stratified by profile', () => {
  const a = assignSplits(tasks)
  const b = assignSplits([...tasks].reverse())
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort())
  for (const profile of PROFILES) {
    const group = tasks.filter(t => t.profile === profile)
    const cal = group.filter(t => a.get(t.id) === 'calibration').length
    assert.equal(cal, Math.ceil(group.length / 2), profile)
  }
})
