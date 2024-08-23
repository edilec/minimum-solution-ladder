/**
 * Severity, pinned behaviourally.
 *
 * A frozen `ruleId -> severity` table is a good source of truth and a bad
 * guard: when the test also keeps its own expected-value map, the guarantee is
 * three declarations agreeing with each other, and one coordinated edit passes.
 * In another tool here, 40 of 52 error rules survived exactly that flip.
 *
 * So every assertion below writes its expectation out as a literal at the
 * assertion site -- the severity string, the status string, the exit code -- and
 * takes nothing from a table, a parameter or an import. Flipping one row of
 * RULE_SEVERITY cannot be argued with by editing the README and a map; for the
 * rules whose severity decides the verdict it cannot be argued with at all,
 * because an exit code is not editable.
 *
 * Every rule the tool can emit appears exactly once. The closing test asserts
 * that, so a rule added without an outcome test fails the suite.
 */

import assert from 'node:assert/strict'
import { symlink } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { RULE_SEVERITY, runLadder } from '../src/index.mjs'
import { cleanup, findingFor, makeTree, nativeCandidate, runReport, worksheet } from './helpers.mjs'

const covered = new Set()

/** Build a fixture, run the real CLI over it, and remember which rule was exercised. */
async function exercise(t, ruleId, files, args = []) {
  covered.add(ruleId)
  const root = await makeTree(files)
  t.after(() => cleanup(root))
  return { ...runReport(root, args), root }
}

test('candidate-duplicate-id is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'candidate-duplicate-id', {
    'worksheet.json': worksheet([nativeCandidate(), nativeCandidate({ rung: 'standard-library' })]),
  })
  assert.equal(findingFor(report, 'candidate-duplicate-id').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
  assert.equal(report.recommendation, null)
})

test('candidate-malformed is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'candidate-malformed', {
    'worksheet.json': worksheet([{ ...nativeCandidate(), summary: '' }]),
  })
  assert.equal(findingFor(report, 'candidate-malformed').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('candidate-rung-unknown is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'candidate-rung-unknown', {
    'worksheet.json': worksheet([nativeCandidate({ rung: 'a-bit-of-both' })]),
  })
  assert.equal(findingFor(report, 'candidate-rung-unknown').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('candidate-unknown-key is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'candidate-unknown-key', {
    'worksheet.json': worksheet([{ ...nativeCandidate(), satisfy: ['c-one'] }]),
  })
  assert.equal(findingFor(report, 'candidate-unknown-key').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('criteria-uncovered is info: the run still passes and still exits 0', async (t) => {
  const { report, status } = await exercise(t, 'criteria-uncovered', {
    'worksheet.json': worksheet([nativeCandidate()], {
      requirement: {
        id: 'req',
        statement: 'Two things must hold.',
        criteria: [
          { id: 'c-one', statement: 'The first criterion.' },
          { id: 'c-two', statement: 'The second criterion.' },
        ],
      },
    }),
  })
  assert.equal(findingFor(report, 'criteria-uncovered').severity, 'info')
  assert.equal(report.status, 'pass')
  assert.equal(status, 0)
})

test('criterion-unknown is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'criterion-unknown', {
    'worksheet.json': worksheet([nativeCandidate({ satisfies: ['c-nine'] })]),
  })
  assert.equal(findingFor(report, 'criterion-unknown').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('evidence-file-not-json is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'evidence-file-not-json', {
    'package.json': 'this is not a manifest',
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'dependency', file: 'package.json', name: 'uuid' }] }),
    ]),
  })
  assert.equal(findingFor(report, 'evidence-file-not-json').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('evidence-file-not-utf8 is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'evidence-file-not-utf8', {
    'src/blob.bin': new Uint8Array([0xff, 0xfe, 0x41]),
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'source', file: 'src/blob.bin', contains: 'A' }] }),
    ]),
  })
  assert.equal(findingFor(report, 'evidence-file-not-utf8').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('evidence-file-too-large is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'evidence-file-too-large', {
    'src/app.mjs': 'export const marker = "here"\n',
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'source', file: 'src/app.mjs', contains: 'here' }] }),
    ]),
  }, ['--max-evidence-bytes', '4'])
  assert.equal(findingFor(report, 'evidence-file-too-large').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('evidence-file-unreadable is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'evidence-file-unreadable', {
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'source', file: 'src/gone.mjs', contains: 'here' }] }),
    ]),
  })
  assert.equal(findingFor(report, 'evidence-file-unreadable').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('evidence-kind-unknown is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'evidence-kind-unknown', {
    'worksheet.json': worksheet([nativeCandidate({ evidence: [{ kind: 'vibes', note: 'it feels right' }] })]),
  })
  assert.equal(findingFor(report, 'evidence-kind-unknown').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

/**
 * The one rule with no path in from the command line.
 *
 * No Node release this package was built against refuses to import a module it
 * lists in `builtinModules`, so the branch cannot be reached by any worksheet on
 * this runtime. It is reached here through the real library entry point with the
 * loader injected -- the same injection point that exists so a future runtime
 * refusing an experimental module produces an incomplete report rather than a
 * crash. The status literal below is what the CLI turns into exit 2, and that
 * mapping is pinned by every other incomplete rule in this file.
 */
test('evidence-module-unloadable is an error that makes the run incomplete, with no recommendation', async (t) => {
  covered.add('evidence-module-unloadable')
  const root = await makeTree({ 'worksheet.json': worksheet([nativeCandidate()]) })
  t.after(() => cleanup(root))

  const report = await runLadder({
    worksheet: join(root, 'worksheet.json'),
    root,
    loadBuiltin: () => {
      const error = new Error('not available without --experimental-everything')
      error.code = 'ERR_UNKNOWN_BUILTIN_MODULE'
      throw error
    },
  })
  assert.equal(findingFor(report, 'evidence-module-unloadable').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(report.recommendation, null)
})

test('evidence-not-found is an error that fails the run and exits 1', async (t) => {
  const { report, status } = await exercise(t, 'evidence-not-found', {
    'src/app.mjs': 'export const marker = "here"\n',
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'source', file: 'src/app.mjs', contains: 'not in the file' }] }),
    ]),
  })
  assert.equal(findingFor(report, 'evidence-not-found').severity, 'error')
  assert.equal(report.status, 'fail')
  assert.equal(status, 1)
})

test('evidence-path-escapes-root is an error that makes the run incomplete and exits 2', async (t) => {
  covered.add('evidence-path-escapes-root')
  const outside = await makeTree({ 'secret.txt': 'the marker is here\n' })
  const root = await makeTree({
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'source', file: 'link.txt', contains: 'the marker' }] }),
    ]),
  })
  t.after(() => Promise.all([cleanup(root), cleanup(outside)]))
  await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'))

  const { report, status, stdout } = runReport(root)
  assert.equal(findingFor(report, 'evidence-path-escapes-root').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
  assert.doesNotMatch(stdout, /the marker is here/)
})

test('evidence-unverifiable is a warning that still makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'evidence-unverifiable', {
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'assertion', note: 'I am fairly sure the platform does this.' }] }),
    ]),
  })
  assert.equal(findingFor(report, 'evidence-unverifiable').severity, 'warning')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
  assert.equal(report.recommendation, null)
})

test('lower-rung-available is an error that fails the run and exits 1', async (t) => {
  const { report, status } = await exercise(t, 'lower-rung-available', {
    'worksheet.json': worksheet([nativeCandidate()]),
  })
  assert.equal(findingFor(report, 'lower-rung-available').severity, 'error')
  assert.equal(report.status, 'fail')
  assert.equal(status, 1)
})

test('no-candidate-fully-covers is info: the run still passes and still exits 0', async (t) => {
  const { report, status } = await exercise(t, 'no-candidate-fully-covers', {
    'worksheet.json': worksheet([nativeCandidate()], {
      requirement: {
        id: 'req',
        statement: 'Two things must hold.',
        criteria: [
          { id: 'c-one', statement: 'The first criterion.' },
          { id: 'c-two', statement: 'The second criterion.' },
        ],
      },
    }),
  })
  assert.equal(findingFor(report, 'no-candidate-fully-covers').severity, 'info')
  assert.equal(report.status, 'pass')
  assert.equal(status, 0)
})

test('no-candidates is a warning that still makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'no-candidates', { 'worksheet.json': worksheet([]) })
  assert.equal(findingFor(report, 'no-candidates').severity, 'warning')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
  assert.equal(report.summary.checked, 0)
})

test('proposal-unverified is info: the run still passes and still exits 0', async (t) => {
  const { report, status } = await exercise(t, 'proposal-unverified', {
    'worksheet.json': worksheet([nativeCandidate()], {
      proposed: { rung: 'no-change', summary: 'It already works today.' },
    }),
  })
  assert.equal(findingFor(report, 'proposal-unverified').severity, 'info')
  assert.equal(report.status, 'pass')
  assert.equal(status, 0)
})

test('savings-measured is info: the run still passes and still exits 0', async (t) => {
  const { report, status } = await exercise(t, 'savings-measured', {
    'notes/audit.md': 'counted 3 duplicate implementations\n',
    'worksheet.json': worksheet([
      nativeCandidate({
        savings: {
          claim: 'Removes the duplicates counted in the audit.',
          measurement: { kind: 'source', file: 'notes/audit.md', contains: '3 duplicate implementations' },
        },
      }),
    ], { proposed: { rung: 'platform-native', summary: 'Call the platform function.' } }),
  })
  assert.equal(findingFor(report, 'savings-measured').severity, 'info')
  assert.equal(report.status, 'pass')
  assert.equal(status, 0)
})

test('time-budget-exceeded is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'time-budget-exceeded', {
    'worksheet.json': worksheet([nativeCandidate()]),
  }, ['--timeout-ms', '0'])
  assert.equal(findingFor(report, 'time-budget-exceeded').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
  assert.equal(report.recommendation, null)
})

test('too-many-candidates is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'too-many-candidates', {
    'worksheet.json': worksheet([nativeCandidate(), nativeCandidate({ id: 'other' })]),
  }, ['--max-candidates', '1'])
  assert.equal(findingFor(report, 'too-many-candidates').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('too-many-criteria is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'too-many-criteria', {
    'worksheet.json': worksheet([nativeCandidate()], {
      requirement: {
        id: 'req',
        statement: 'Two things must hold.',
        criteria: [
          { id: 'c-one', statement: 'The first criterion.' },
          { id: 'c-two', statement: 'The second criterion.' },
        ],
      },
    }),
  }, ['--max-criteria', '1'])
  assert.equal(findingFor(report, 'too-many-criteria').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('too-many-evidence is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'too-many-evidence', {
    'worksheet.json': worksheet([
      nativeCandidate({
        evidence: [
          { kind: 'builtin', module: 'node:crypto', export: 'randomUUID' },
          { kind: 'builtin', module: 'node:crypto', export: 'createHash' },
        ],
      }),
    ]),
  }, ['--max-evidence', '1'])
  assert.equal(findingFor(report, 'too-many-evidence').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('unsourced-savings-claim is an error that fails the run and exits 1', async (t) => {
  const { report, status } = await exercise(t, 'unsourced-savings-claim', {
    'worksheet.json': worksheet([
      nativeCandidate({ savings: { claim: 'Saves most of the effort.' } }),
    ], { proposed: { rung: 'platform-native', summary: 'Call the platform function.' } }),
  })
  assert.equal(findingFor(report, 'unsourced-savings-claim').severity, 'error')
  assert.equal(report.status, 'fail')
  assert.equal(status, 1)
})

test('worksheet-malformed is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'worksheet-malformed', {
    'worksheet.json': worksheet([nativeCandidate()], { requirement: 'a sentence, not an object' }),
  })
  assert.equal(findingFor(report, 'worksheet-malformed').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('worksheet-not-json is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'worksheet-not-json', { 'worksheet.json': '{ "schemaVersion":' })
  assert.equal(findingFor(report, 'worksheet-not-json').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('worksheet-not-utf8 is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'worksheet-not-utf8', {
    'worksheet.json': new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]),
  })
  assert.equal(findingFor(report, 'worksheet-not-utf8').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('worksheet-schema-unsupported is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'worksheet-schema-unsupported', {
    'worksheet.json': worksheet([nativeCandidate()], { schemaVersion: '2' }),
  })
  assert.equal(findingFor(report, 'worksheet-schema-unsupported').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('worksheet-too-large is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'worksheet-too-large', {
    'worksheet.json': worksheet([nativeCandidate()]),
  }, ['--max-worksheet-bytes', '16'])
  assert.equal(findingFor(report, 'worksheet-too-large').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('worksheet-unknown-key is an error that makes the run incomplete and exits 2', async (t) => {
  const { report, status } = await exercise(t, 'worksheet-unknown-key', {
    'worksheet.json': worksheet([nativeCandidate()], { candidate: [] }),
  })
  assert.equal(findingFor(report, 'worksheet-unknown-key').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('worksheet-unreadable is an error that makes the run incomplete and exits 2', async (t) => {
  covered.add('worksheet-unreadable')
  const root = await makeTree({ 'other.json': '{}' })
  t.after(() => cleanup(root))
  const { report, status } = runReport(root)
  assert.equal(findingFor(report, 'worksheet-unreadable').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('a directory where the worksheet should be is unreadable, not empty', async (t) => {
  const root = await makeTree({ 'worksheet.json/placeholder': 'x' })
  t.after(() => cleanup(root))
  const { report, status } = runReport(root)
  assert.match(findingFor(report, 'worksheet-unreadable').message, /not a regular file/)
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('every rule in the catalog has an outcome test', () => {
  const missing = Object.keys(RULE_SEVERITY).filter((ruleId) => !covered.has(ruleId)).sort()
  assert.deepEqual(missing, [], 'these rules have no behavioural outcome test')
  const stray = [...covered].filter((ruleId) => !Object.hasOwn(RULE_SEVERITY, ruleId)).sort()
  assert.deepEqual(stray, [], 'these tests exercise a rule the catalog does not declare')
})
