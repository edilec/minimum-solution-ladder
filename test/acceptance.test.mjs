/**
 * The acceptance criteria, item by item.
 *
 *   "A case already solved by a native feature recommends reuse with evidence;
 *    no universal savings percentages are fabricated."
 *
 * Both halves are asserted on what the tool emits through its real entry point,
 * with the expected values written as literals here rather than imported from
 * the code under test.
 */

import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'

import { cleanup, findingFor, findingsFor, makeTree, nativeCandidate, runReport, worksheet } from './helpers.mjs'

const PERCENTAGE = /\d+\s*(?:%|per ?cent)/i

test('a requirement a native feature already meets recommends reuse, with the evidence', async (t) => {
  const root = await makeTree({
    'worksheet.json': worksheet([nativeCandidate()], {
      proposed: { rung: 'new-machinery', summary: 'Write our own identifier generator.' },
    }),
  })
  t.after(() => cleanup(root))

  const { report, status } = runReport(root)

  assert.equal(report.status, 'fail')
  assert.equal(status, 1)

  // The recommendation names the rung, the candidate, and what was proposed.
  assert.equal(report.recommendation.rung, 'platform-native')
  assert.equal(report.recommendation.candidateId, 'native')
  assert.equal(report.recommendation.proposedRung, 'new-machinery')
  assert.equal(report.recommendation.lowerThanProposed, true)

  // "with evidence": the exact item the tool checked travels with the
  // recommendation, so a reader can repeat the check by hand.
  assert.deepEqual(report.recommendation.evidence, [
    { kind: 'builtin', module: 'node:crypto', export: 'randomUUID' },
  ])
  assert.equal(report.summary.verified, 1)

  const finding = findingFor(report, 'lower-rung-available')
  assert.equal(finding.severity, 'error')
  assert.match(finding.message, /platform-native/)
  assert.match(finding.message, /new-machinery/)
})

test('the reuse recommendation rests on a check, not on the worksheet saying so', async (t) => {
  // Same worksheet, one character different: an export node:crypto does not
  // have. If the recommendation came from the declaration rather than from the
  // check, this would still recommend reuse.
  const root = await makeTree({
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'builtin', module: 'node:crypto', export: 'randomUUIDv7' }] }),
    ]),
  })
  t.after(() => cleanup(root))

  const { report, status } = runReport(root)

  assert.equal(report.recommendation, null)
  assert.equal(report.status, 'fail')
  assert.equal(status, 1)
  const finding = findingFor(report, 'evidence-not-found')
  assert.equal(finding.severity, 'error')
  assert.match(finding.message, /does not export/)
})

test('a module that is not built in at all refutes the claim rather than being assumed', async (t) => {
  const root = await makeTree({
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'builtin', module: 'node:lodash', export: 'debounce' }] }),
    ]),
  })
  t.after(() => cleanup(root))

  const { report, status } = runReport(root)
  assert.equal(report.recommendation, null)
  assert.equal(report.status, 'fail')
  assert.equal(status, 1)
  assert.match(findingFor(report, 'evidence-not-found').message, /is not a built-in module/)
})

test('a built-in module spelled with its node: prefix in builtinModules is still recognised', async (t) => {
  // Node 24 lists some names bare ("crypto") and some prefixed ("node:test").
  // A membership test that only knows one spelling refutes a true claim.
  const root = await makeTree({
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'builtin', module: 'node:test', export: 'describe' }] }),
    ], { proposed: { rung: 'platform-native', summary: 'Use the runner that ships with the runtime.' } }),
  })
  t.after(() => cleanup(root))

  const { report, status } = runReport(root)
  assert.equal(report.status, 'pass')
  assert.equal(status, 0)
  assert.equal(report.recommendation.rung, 'platform-native')
  assert.equal(findingsFor(report, 'evidence-not-found').length, 0)
})

test('the lowest rung wins when several candidates cover the requirement', async (t) => {
  const root = await makeTree({
    'package.json': JSON.stringify({ name: 'app', dependencies: { uuid: '^9.0.0' } }),
    'src/app.mjs': 'export const marker = "already here"\n',
    'worksheet.json': worksheet([
      {
        id: 'installed-package',
        rung: 'installed-dependency',
        summary: 'The package is already installed.',
        satisfies: ['c-one'],
        evidence: [{ kind: 'dependency', file: 'package.json', name: 'uuid' }],
      },
      {
        id: 'already-in-the-repo',
        rung: 'project-reuse',
        summary: 'The repository already does this.',
        satisfies: ['c-one'],
        evidence: [{ kind: 'source', file: 'src/app.mjs', contains: 'already here' }],
      },
      nativeCandidate(),
    ]),
  })
  t.after(() => cleanup(root))

  const { report, status } = runReport(root)
  assert.equal(report.recommendation.rung, 'project-reuse')
  assert.equal(report.recommendation.candidateId, 'already-in-the-repo')
  assert.equal(report.status, 'fail')
  assert.equal(status, 1)
})

test('a proposal already on the lowest verified rung passes and recommends itself', async (t) => {
  const root = await makeTree({
    'worksheet.json': worksheet([nativeCandidate()], {
      proposed: { rung: 'platform-native', summary: 'Call the platform function.' },
    }),
  })
  t.after(() => cleanup(root))

  const { report, status } = runReport(root)
  assert.equal(report.status, 'pass')
  assert.equal(status, 0)
  assert.equal(report.recommendation.lowerThanProposed, false)
  assert.equal(report.recommendation.rung, 'platform-native')
  assert.equal(findingsFor(report, 'lower-rung-available').length, 0)
})

test('a candidate that covers only part of the requirement does not displace the proposal', async (t) => {
  const root = await makeTree({
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
  t.after(() => cleanup(root))

  const { report, status } = runReport(root)
  assert.equal(report.status, 'pass')
  assert.equal(status, 0)
  assert.equal(report.recommendation, null)
  assert.equal(findingFor(report, 'criteria-uncovered').severity, 'info')
  assert.equal(findingFor(report, 'criteria-uncovered').evidence, 'c-two')
  assert.equal(findingsFor(report, 'lower-rung-available').length, 0)
})

test('no savings percentage is fabricated anywhere in a passing report', async (t) => {
  const root = await makeTree({
    'worksheet.json': worksheet([nativeCandidate()], {
      proposed: { rung: 'platform-native', summary: 'Call the platform function.' },
    }),
  })
  t.after(() => cleanup(root))

  const { report, stdout, status } = runReport(root)
  assert.equal(status, 0)
  assert.equal(report.recommendation.savings, null)
  // Nothing in the whole document offers a figure: no percentage, no hours, no
  // "saves N lines". The tool reports what it checked and stops there.
  assert.doesNotMatch(stdout, PERCENTAGE)
  assert.doesNotMatch(stdout, /\bsav(?:es|ed|ing)\b/i)
})

test('an asserted saving with no measurement is refused, and the number is never repeated as a conclusion', async (t) => {
  const root = await makeTree({
    'worksheet.json': worksheet([
      nativeCandidate({ savings: { claim: 'Reusing the platform cuts 80% of the work.' } }),
    ], { proposed: { rung: 'platform-native', summary: 'Call the platform function.' } }),
  })
  t.after(() => cleanup(root))

  const { report, status } = runReport(root)
  assert.equal(report.status, 'fail')
  assert.equal(status, 1)

  const finding = findingFor(report, 'unsourced-savings-claim')
  assert.equal(finding.severity, 'error')
  assert.equal(finding.evidence, 'Reusing the platform cuts 80% of the work.')

  // The figure survives only as a quotation of the worksheet, attributed to the
  // worksheet by sitting in an "evidence" field of the finding that refuses it.
  assert.equal(report.recommendation.savings, null)
  assert.doesNotMatch(finding.message, PERCENTAGE)
  const elsewhere = { ...report, findings: report.findings.map((row) => ({ ...row, evidence: '' })) }
  assert.doesNotMatch(JSON.stringify(elsewhere), PERCENTAGE)
})

test('a saving backed by prose rather than a measurement is refused the same way', async (t) => {
  const root = await makeTree({
    'worksheet.json': worksheet([
      nativeCandidate({
        savings: {
          claim: 'Saves about two days.',
          measurement: { kind: 'assertion', note: 'That is roughly what it took last time.' },
        },
      }),
    ], { proposed: { rung: 'platform-native', summary: 'Call the platform function.' } }),
  })
  t.after(() => cleanup(root))

  const { report, status } = runReport(root)
  assert.equal(report.status, 'fail')
  assert.equal(status, 1)
  assert.match(findingFor(report, 'unsourced-savings-claim').message, /prose note instead of a measurement/)
})

test('a measured saving is repeated only with the measurement behind it', async (t) => {
  const root = await makeTree({
    'notes/audit.md': '# Audit\n\n3 duplicate implementations, counted by hand.\n',
    'worksheet.json': worksheet([
      nativeCandidate({
        savings: {
          claim: 'Removes the 3 duplicate implementations counted in the audit.',
          measurement: { kind: 'source', file: 'notes/audit.md', contains: '3 duplicate implementations' },
        },
      }),
    ], { proposed: { rung: 'platform-native', summary: 'Call the platform function.' } }),
  })
  t.after(() => cleanup(root))

  const { report, status } = runReport(root)
  assert.equal(report.status, 'pass')
  assert.equal(status, 0)
  assert.deepEqual(report.recommendation.savings, {
    claim: 'Removes the 3 duplicate implementations counted in the audit.',
    measurement: { kind: 'source', file: 'notes/audit.md', contains: '3 duplicate implementations' },
  })
  assert.equal(findingFor(report, 'savings-measured').severity, 'info')
})

test('a measurement that is not there refutes the saving instead of repeating it', async (t) => {
  const root = await makeTree({
    'notes/audit.md': '# Audit\n\nNobody counted anything yet.\n',
    'worksheet.json': worksheet([
      nativeCandidate({
        savings: {
          claim: 'Removes the 3 duplicate implementations counted in the audit.',
          measurement: { kind: 'source', file: 'notes/audit.md', contains: '3 duplicate implementations' },
        },
      }),
    ], { proposed: { rung: 'platform-native', summary: 'Call the platform function.' } }),
  })
  t.after(() => cleanup(root))

  const { report, status } = runReport(root)
  assert.equal(report.status, 'fail')
  assert.equal(status, 1)
  assert.equal(report.recommendation.savings, null)
  assert.match(findingFor(report, 'evidence-not-found').message, /savings claim/)
})

test('the shipped examples behave as the README says they do', async () => {
  const examples = new URL('../examples/', import.meta.url)
  const run = (name, args = []) => runReport(
    join(examples.pathname, name),
    args,
  )

  const passing = run('debounce-search')
  assert.equal(passing.status, 0)
  assert.equal(passing.report.status, 'pass')
  assert.equal(passing.report.recommendation.rung, 'project-reuse')

  const failing = run('uuid-generation')
  assert.equal(failing.status, 1)
  assert.equal(failing.report.status, 'fail')
  assert.equal(failing.report.recommendation.rung, 'standard-library')

  const incomplete = run('asserted-only')
  assert.equal(incomplete.status, 2)
  assert.equal(incomplete.report.status, 'incomplete')
  assert.equal(incomplete.report.recommendation, null)
})
