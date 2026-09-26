/**
 * The schema, checked at the unit level.
 *
 * The CLI-level tests prove what a bad worksheet does to a run; these prove what
 * the validator itself accepts and refuses, which is where an "unknown key
 * silently ignored" defect actually lives.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_LIMITS, ID_PATTERN, RUNGS, validateWorksheet } from '../src/index.mjs'

const good = () => ({
  schemaVersion: '1',
  requirement: {
    id: 'req',
    statement: 'The thing that has to be true.',
    criteria: [{ id: 'c-one', statement: 'One.' }],
  },
  proposed: { rung: 'new-machinery', summary: 'Write it.' },
  candidates: [{
    id: 'native',
    rung: 'platform-native',
    summary: 'The platform does it.',
    satisfies: ['c-one'],
    evidence: [{ kind: 'builtin', module: 'node:crypto', export: 'randomUUID' }],
  }],
})

const validate = (document) => validateWorksheet(document, DEFAULT_LIMITS)
const rules = (result) => result.problems.map((problem) => problem.ruleId).sort()

test('a well-formed worksheet validates with no problems', () => {
  const result = validate(good())
  assert.deepEqual(result.problems, [])
  assert.equal(result.worksheet.candidates.length, 1)
  assert.equal(result.worksheet.candidates[0].savings, null)
})

test('an unknown key is refused at every level', () => {
  for (const [label, mutate] of [
    ['worksheet', (doc) => { doc.notes = 'hello' }],
    ['requirement', (doc) => { doc.requirement.owner = 'me' }],
    ['criterion', (doc) => { doc.requirement.criteria[0].weight = 2 }],
    ['proposed', (doc) => { doc.proposed.cost = 3 }],
    ['candidate', (doc) => { doc.candidates[0].confidence = 'high' }],
    ['evidence', (doc) => { doc.candidates[0].evidence[0].line = 12 }],
  ]) {
    const document = good()
    mutate(document)
    const result = validate(document)
    assert.notDeepEqual(result.problems, [], `an unknown key on the ${label} was accepted`)
    assert.equal(result.worksheet, null, `an unknown key on the ${label} still produced a worksheet`)
  }
})

test('every rung name is accepted and nothing else is', () => {
  for (const rung of RUNGS) {
    const document = good()
    document.candidates[0].rung = rung
    assert.deepEqual(validate(document).problems, [], `${rung} was refused`)
  }
  const document = good()
  document.candidates[0].rung = 'Standard-Library'
  assert.deepEqual(rules(validate(document)), ['candidate-rung-unknown'])
})

test('the identifier pattern refuses what a report cannot safely render', () => {
  assert.equal(ID_PATTERN.test('a-good.id_1'), true)
  assert.equal(ID_PATTERN.test('-leading-dash'), false)
  assert.equal(ID_PATTERN.test(''), false)
  assert.equal(ID_PATTERN.test('x'.repeat(65)), false)
  assert.equal(ID_PATTERN.test('spaces here'), false)
})

test('a relative path with a climbing segment is refused before the filesystem sees it', () => {
  for (const file of ['../outside', 'a/../../outside', '/absolute', 'C:/windows']) {
    const document = good()
    document.candidates[0].evidence = [{ kind: 'source', file, contains: 'x' }]
    assert.deepEqual(rules(validate(document)), ['candidate-malformed'], `${file} was accepted`)
  }
})

test('a nested relative path is accepted', () => {
  const document = good()
  document.candidates[0].evidence = [{ kind: 'source', file: 'a/b/c.md', contains: 'x' }]
  assert.deepEqual(validate(document).problems, [])
})

test('each evidence kind has its own required fields', () => {
  const cases = [
    [{ kind: 'source', file: 'a.md' }, 'candidate-malformed'],
    [{ kind: 'dependency', file: 'p.json' }, 'candidate-malformed'],
    [{ kind: 'builtin', module: 'node:crypto' }, 'candidate-malformed'],
    [{ kind: 'assertion' }, 'candidate-malformed'],
    [{ kind: 'hunch', note: 'maybe' }, 'evidence-kind-unknown'],
  ]
  for (const [evidence, ruleId] of cases) {
    const document = good()
    document.candidates[0].evidence = [evidence]
    assert.deepEqual(rules(validate(document)), [ruleId], `${JSON.stringify(evidence)} was mishandled`)
  }
})

test('a savings claim must carry a measurement of a kind that can be checked', () => {
  const withoutMeasurement = good()
  withoutMeasurement.candidates[0].savings = { claim: 'Saves a lot.' }
  const first = validate(withoutMeasurement)
  assert.deepEqual(first.problems, [])
  assert.equal(first.worksheet.candidates[0].savings.measurement, null)
  assert.equal(first.worksheet.candidates[0].savings.prose, false)

  const prose = good()
  prose.candidates[0].savings = { claim: 'Saves a lot.', measurement: { kind: 'assertion', note: 'trust me' } }
  const second = validate(prose)
  assert.deepEqual(second.problems, [])
  assert.equal(second.worksheet.candidates[0].savings.measurement, null)
  assert.equal(second.worksheet.candidates[0].savings.prose, true)

  const measured = good()
  measured.candidates[0].savings = {
    claim: 'Saves a lot.',
    measurement: { kind: 'source', file: 'audit.md', contains: 'counted' },
  }
  assert.equal(validate(measured).worksheet.candidates[0].savings.measurement.kind, 'source')
})

test('an empty candidate list validates but carries no candidates', () => {
  const document = good()
  document.candidates = []
  const result = validate(document)
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.worksheet.candidates, [])
})

test('a candidate with no evidence at all is refused', () => {
  const document = good()
  document.candidates[0].evidence = []
  assert.deepEqual(rules(validate(document)), ['candidate-malformed'])
})

test('duplicate criterion ids are refused, because coverage of either is ambiguous', () => {
  const document = good()
  document.requirement.criteria = [{ id: 'c-one', statement: 'One.' }, { id: 'c-one', statement: 'Again.' }]
  assert.deepEqual(rules(validate(document)), ['worksheet-malformed'])
})

test('the validator reports every problem it finds, not just the first', () => {
  const document = good()
  document.candidates[0].rung = 'nowhere'
  document.candidates[0].satisfies = ['c-nine']
  assert.deepEqual(rules(validate(document)), ['candidate-rung-unknown', 'criterion-unknown'])
})
