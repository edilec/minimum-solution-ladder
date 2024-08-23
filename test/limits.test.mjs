/**
 * Every documented limit, enforced and reachable from the command line.
 *
 * A configuration key accepted and silently ignored is a defect this catalog has
 * already shipped: the CLI never wired a clock through, so the documented
 * timeout did nothing and a real failure ran green. Each test below changes only
 * the limit and asserts the outcome changes with it, which is the only way to
 * tell an enforced limit from a documented one.
 */

import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'

import { DEFAULT_LIMITS, runLadder, validateLimits } from '../src/index.mjs'
import { cleanup, findingFor, makeTree, nativeCandidate, runCli, runReport, worksheet } from './helpers.mjs'

const BIG = (count) => Array.from({ length: count }, (_, index) => nativeCandidate({ id: `cand-${index}` }))

test('--max-worksheet-bytes is enforced, and the same worksheet passes without it', async (t) => {
  const root = await makeTree({
    'worksheet.json': worksheet([nativeCandidate()], {
      proposed: { rung: 'platform-native', summary: 'Use the platform.' },
    }),
  })
  t.after(() => cleanup(root))

  assert.equal(runReport(root).status, 0)
  const bounded = runReport(root, ['--max-worksheet-bytes', '32'])
  assert.equal(bounded.status, 2)
  assert.match(findingFor(bounded.report, 'worksheet-too-large').message, /over the limit of 32/)
})

test('--max-candidates is enforced, and the same worksheet passes without it', async (t) => {
  const root = await makeTree({
    'worksheet.json': worksheet(BIG(3), { proposed: { rung: 'platform-native', summary: 'Use the platform.' } }),
  })
  t.after(() => cleanup(root))

  assert.equal(runReport(root).status, 0)
  const bounded = runReport(root, ['--max-candidates', '2'])
  assert.equal(bounded.status, 2)
  assert.match(findingFor(bounded.report, 'too-many-candidates').message, /over the limit of 2/)
})

test('--max-criteria is enforced, and the same worksheet passes without it', async (t) => {
  const root = await makeTree({
    'worksheet.json': worksheet([nativeCandidate({ satisfies: ['c-one', 'c-two'] })], {
      requirement: {
        id: 'req',
        statement: 'Two things.',
        criteria: [
          { id: 'c-one', statement: 'One.' },
          { id: 'c-two', statement: 'Two.' },
        ],
      },
      proposed: { rung: 'platform-native', summary: 'Use the platform.' },
    }),
  })
  t.after(() => cleanup(root))

  assert.equal(runReport(root).status, 0)
  const bounded = runReport(root, ['--max-criteria', '1'])
  assert.equal(bounded.status, 2)
  assert.match(findingFor(bounded.report, 'too-many-criteria').message, /over the limit of 1/)
})

test('--max-evidence is enforced per candidate, and the same worksheet passes without it', async (t) => {
  const root = await makeTree({
    'worksheet.json': worksheet([
      nativeCandidate({
        evidence: [
          { kind: 'builtin', module: 'node:crypto', export: 'randomUUID' },
          { kind: 'builtin', module: 'node:crypto', export: 'createHash' },
        ],
      }),
    ], { proposed: { rung: 'platform-native', summary: 'Use the platform.' } }),
  })
  t.after(() => cleanup(root))

  assert.equal(runReport(root).status, 0)
  const bounded = runReport(root, ['--max-evidence', '1'])
  assert.equal(bounded.status, 2)
  assert.match(findingFor(bounded.report, 'too-many-evidence').message, /over the limit of 1/)
})

test('--max-evidence-bytes is enforced, and the same file is read without it', async (t) => {
  const root = await makeTree({
    'src/app.mjs': 'export const marker = "the marker"\n',
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'source', file: 'src/app.mjs', contains: 'the marker' }] }),
    ], { proposed: { rung: 'platform-native', summary: 'Use the platform.' } }),
  })
  t.after(() => cleanup(root))

  assert.equal(runReport(root).status, 0)
  const bounded = runReport(root, ['--max-evidence-bytes', '8'])
  assert.equal(bounded.status, 2)
  assert.match(findingFor(bounded.report, 'evidence-file-too-large').message, /over the limit of 8/)
})

test('--timeout-ms 0 leaves no time at all, which proves the flag reaches the loop', async (t) => {
  const root = await makeTree({
    'worksheet.json': worksheet([nativeCandidate()], {
      proposed: { rung: 'platform-native', summary: 'Use the platform.' },
    }),
  })
  t.after(() => cleanup(root))

  assert.equal(runReport(root).status, 0)
  const bounded = runReport(root, ['--timeout-ms', '0'])
  assert.equal(bounded.status, 2)
  assert.match(findingFor(bounded.report, 'time-budget-exceeded').message, /budget of 0ms/)
})

test('the clock is injected, never read: a fake clock decides the deadline', async (t) => {
  const root = await makeTree({ 'worksheet.json': worksheet([nativeCandidate()]) })
  t.after(() => cleanup(root))

  const frozen = await runLadder({
    worksheet: join(root, 'worksheet.json'),
    root,
    clock: () => 1_000,
    limits: { timeoutMs: 10 },
  })
  assert.equal(frozen.status, 'fail', 'a clock that never advances never expires')

  const racing = await runLadder({
    worksheet: join(root, 'worksheet.json'),
    root,
    clock: (() => {
      let value = 0
      return () => {
        value += 1_000
        return value
      }
    })(),
    limits: { timeoutMs: 10 },
  })
  assert.equal(racing.status, 'incomplete')
  assert.equal(racing.recommendation, null)
})

test('no reading of the clock reaches the report', async (t) => {
  const root = await makeTree({ 'worksheet.json': worksheet([nativeCandidate()]) })
  t.after(() => cleanup(root))

  const early = await runLadder({ worksheet: join(root, 'worksheet.json'), root, clock: () => 0 })
  const late = await runLadder({ worksheet: join(root, 'worksheet.json'), root, clock: () => 4_102_444_800_000 })
  assert.equal(JSON.stringify(early), JSON.stringify(late))
})

test('an unknown limit name is refused rather than ignored', () => {
  assert.throws(() => validateLimits({ maxCandidate: 4 }), /Unknown limit "maxCandidate"/)
  assert.throws(() => validateLimits({ maxCandidates: 0 }), /integer of 1 or more/)
  assert.throws(() => validateLimits({ timeoutMs: -1 }), /integer of 0 or more/)
  assert.deepEqual(validateLimits({}), DEFAULT_LIMITS)
})

test('an unknown configuration key is refused with empty stdout', async (t) => {
  const root = await makeTree({
    'worksheet.json': worksheet([nativeCandidate()]),
    'config.json': JSON.stringify({ schemaVersion: '1', limit: { maxCandidates: 1 } }),
  })
  t.after(() => cleanup(root))

  const { stdout, stderr, status } = runReport(root, ['--config', join(root, 'config.json')])
  assert.equal(status, 2)
  assert.equal(stdout, '')
  assert.match(stderr, /Unknown configuration key "limit"/)
})

test('a configuration file sets a limit, and the command line still wins', async (t) => {
  const root = await makeTree({
    'worksheet.json': worksheet(BIG(3)),
    'config.json': JSON.stringify({ schemaVersion: '1', limits: { maxCandidates: 1 } }),
  })
  t.after(() => cleanup(root))

  const configured = runReport(root, ['--config', join(root, 'config.json')])
  assert.equal(configured.status, 2)
  assert.match(findingFor(configured.report, 'too-many-candidates').message, /over the limit of 1/)

  const overridden = runReport(root, ['--config', join(root, 'config.json'), '--max-candidates', '10'])
  assert.equal(overridden.status, 1, 'the flag overrides the file, and three candidates are then in bounds')
})

test('a configuration file with an unsupported schemaVersion is refused', async (t) => {
  const root = await makeTree({
    'worksheet.json': worksheet([nativeCandidate()]),
    'config.json': JSON.stringify({ schemaVersion: '9' }),
  })
  t.after(() => cleanup(root))

  const { stdout, stderr, status } = runReport(root, ['--config', join(root, 'config.json')])
  assert.equal(status, 2)
  assert.equal(stdout, '')
  assert.match(stderr, /Unsupported configuration schemaVersion/)
})

test('a limit flag that is not an integer is refused before anything is read', async (t) => {
  const root = await makeTree({ 'worksheet.json': worksheet([nativeCandidate()]) })
  t.after(() => cleanup(root))

  const { stdout, stderr, status } = runCli([
    '--worksheet', join(root, 'worksheet.json'), '--max-candidates', 'many',
  ])
  assert.equal(status, 2)
  assert.equal(stdout, '')
  assert.match(stderr, /--max-candidates requires an integer/)
})
