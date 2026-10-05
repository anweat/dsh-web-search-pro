import test from 'node:test'
import assert from 'node:assert/strict'
import { assignSplits, loadTaskSet, loadTasks, parseTaskSet, taskSetPaths, validateTask } from '../src/tasks.ts'
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

// ── v2: held-out set ───────────────────────────────────────────────────────

const v2 = loadTaskSet('v2')

test('task-set selection: v1 default paths are unchanged, v2 maps to its own files', () => {
  assert.equal(parseTaskSet(undefined), 'v1')
  assert.equal(parseTaskSet('v2'), 'v2')
  assert.throws(() => parseTaskSet('v3'), /--task-set/)
  assert.throws(() => parseTaskSet(true), /--task-set/)
  const p1 = taskSetPaths()
  assert.ok(p1.tasksFile.endsWith('tasks/tasks.v1.jsonl') && p1.candidatesDir.endsWith('data/candidates.v1') && p1.labelsDir.endsWith('data/labels.v1'))
  const p2 = taskSetPaths('v2')
  assert.ok(p2.tasksFile.endsWith('tasks/tasks.v2.jsonl') && p2.candidatesDir.endsWith('data/candidates.v2') && p2.labelsDir.endsWith('data/labels.v2'))
  assert.deepEqual(loadTaskSet('v1'), tasks)
})

test('v2: 40 valid tasks with v2- ids, 6-7 per profile, at least half Chinese, about 6 mixed', () => {
  assert.equal(v2.length, 40)
  assert.equal(new Set(v2.map(t => t.id)).size, 40)
  for (const t of v2) assert.match(t.id, /^v2-[a-z]{2}-\d{2}$/)
  const prefix = { docs_code: 'dc', news_fact: 'nf', academic: 'ac', experience: 'ex', compare: 'cp', general: 'gn' }
  for (const t of v2) assert.equal(t.id.slice(3, 5), prefix[t.profile], t.id)
  for (const profile of PROFILES) {
    const n = v2.filter(t => t.profile === profile).length
    assert.ok(n >= 6 && n <= 7, profile + ' has ' + n)
  }
  assert.ok(v2.filter(t => t.lang === 'zh').length >= 20)
  const mixed = v2.filter(t => t.lang === 'mixed').length
  assert.ok(mixed >= 5 && mixed <= 7, 'mixed tasks: ' + mixed)
  assert.ok(v2.some(t => t.lang === 'en'))
})

test('v2: does not duplicate v1 ids or queries', () => {
  const v1Ids = new Set(tasks.map(t => t.id))
  const v1Queries = new Set(tasks.map(t => t.query.toLowerCase()))
  for (const t of v2) {
    assert.ok(!v1Ids.has(t.id), 'id clash ' + t.id)
    assert.ok(!v1Queries.has(t.query.toLowerCase()), 'query clash ' + t.id)
  }
  assert.equal(new Set(v2.map(t => t.query.toLowerCase())).size, v2.length)
})

test('v2: no entity constraint is shared with a v1 task', () => {
  const v1Entities = new Set(tasks.flatMap(t => t.constraints.filter(c => c.kind === 'entity').map(c => c.value.toLowerCase())))
  for (const t of v2) {
    for (const c of t.constraints.filter(x => x.kind === 'entity')) assert.ok(!v1Entities.has(c.value.toLowerCase()), t.id + ' reuses v1 entity ' + c.value)
  }
})

test('v2: covers the planned trap kinds and constraint shapes', () => {
  const traps = new Set(v2.flatMap(t => t.traps))
  for (const trap of ['版本差异', '否定条件', '导航页', '转载', '冲突信息', '镜像站', '中英术语不一致', '替代方案满足需求但不满足字面约束']) {
    assert.ok(traps.has(trap), 'missing trap ' + trap)
  }
  const absence = v2.filter(t => t.traps.includes('否定条件'))
  assert.ok(absence.length >= 3, 'absence-style tasks: ' + absence.length)
  const versioned = v2.filter(t => t.constraints.some(c => c.kind === 'version'))
  assert.ok(versioned.length >= 5, 'version-specific tasks: ' + versioned.length)
  for (const t of v2) {
    for (const c of t.constraints) {
      if (c.kind === 'time_window') assert.match(c.value, /^20\d\d 年以后$/, t.id)
      if (c.kind === 'site' || c.kind === 'exclude_site') assert.match(c.value, /^[a-z0-9.-]+\.[a-z]{2,}$/, t.id)
    }
  }
})

test('v2: every task is heldout; v1 split is unchanged', () => {
  const splits = assignSplits(v2, 'v2')
  assert.equal(splits.size, 40)
  for (const t of v2) assert.equal(splits.get(t.id), 'heldout', t.id)
  assert.deepEqual([...assignSplits(tasks, 'v1').entries()], [...assignSplits(tasks).entries()])
  assert.ok([...assignSplits(tasks).values()].every(s => s === 'calibration' || s === 'test'))
})

test('validateTask accepts v2 ids and still rejects malformed ids', () => {
  assert.deepEqual(validateTask(v2[0]), [])
  assert.ok(validateTask({ ...v2[0]!, id: 'v2_dc_01' }).some(e => e.includes('id must look like')))
  assert.ok(validateTask({ ...v2[0]!, id: 'dc-1' }).some(e => e.includes('id must look like')))
})
