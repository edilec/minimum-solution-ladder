/**
 * Unknown is never a pass, and never an absence either.
 *
 * These are the tests that would go green if someone decided an unreadable file
 * meant "that rung does not apply", or that a partly finished run could still
 * recommend what it had managed to check.
 */

import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'

import { runLadder } from '../src/index.mjs'
import { cleanup, findingFor, findingsFor, makeTree, nativeCandidate, runReport, worksheet } from './helpers.mjs'

test('evidence that was verified is not credited when other evidence was not obtained', async (t) => {
  // The first candidate verifies, sits below the proposal, and would be the
  // recommendation on its own. The second cites a file that is not there. The
  // run has a gap in it, so it makes no recommendation at all -- a smaller rung
  // chosen from a partial reading is not a smaller answer, it is a guess.
  const root = await makeTree({
    'worksheet.json': worksheet([
      nativeCandidate(),
      nativeCandidate({
        id: 'other',
        rung: 'project-reuse',
        evidence: [{ kind: 'source', file: 'src/missing.mjs', contains: 'marker' }],
      }),
    ]),
  })
  t.after(() => cleanup(root))

  const { report, status } = runReport(root)
  assert.equal(report.summary.verified, 1)
  assert.equal(report.status, 'incomplete')
  assert.equal(report.recommendation, null)
  assert.equal(status, 2)
})

test('a run whose findings are all warnings still refuses; severity alone would have passed it', async (t) => {
  const root = await makeTree({
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'assertion', note: 'The platform surely does this.' }] }),
    ]),
  })
  t.after(() => cleanup(root))

  const { report, status } = runReport(root)
  assert.equal(report.summary.errors, 0)
  assert.equal(report.summary.warnings, 1)
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('an unreadable evidence file is not reported as evidence that is absent', async (t) => {
  const root = await makeTree({
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'source', file: 'src/missing.mjs', contains: 'marker' }] }),
    ]),
  })
  t.after(() => cleanup(root))

  const { report } = runReport(root)
  // "Not found" is a claim about a file that was read. This file was not read.
  assert.equal(findingsFor(report, 'evidence-not-found').length, 0)
  const finding = findingFor(report, 'evidence-file-unreadable')
  assert.match(finding.message, /could not obtain/)
  assert.match(finding.message, /not the same as a rung that does not apply/)
})

test('a dependency manifest that will not parse is not reported as the package being absent', async (t) => {
  const root = await makeTree({
    'package.json': '{ "dependencies": ',
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'dependency', file: 'package.json', name: 'uuid' }] }),
    ]),
  })
  t.after(() => cleanup(root))

  const { report, status } = runReport(root)
  assert.equal(findingsFor(report, 'evidence-not-found').length, 0)
  assert.equal(findingFor(report, 'evidence-file-not-json').severity, 'error')
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
})

test('a time budget that expires mid-loop leaves nothing marked as verified coverage', async (t) => {
  const root = await makeTree({
    'src/app.mjs': 'export const marker = "here"\n',
    'worksheet.json': worksheet([
      nativeCandidate({
        id: 'first',
        rung: 'no-change',
        evidence: [{ kind: 'source', file: 'src/app.mjs', contains: 'here' }],
      }),
      nativeCandidate({ id: 'second', rung: 'project-reuse' }),
    ]),
  })
  t.after(() => cleanup(root))

  // A clock that runs out after the first evidence check: the first candidate
  // verified and fully covers the requirement from the lowest rung there is.
  let reading = 0
  const ticks = [0, 0, 5000, 5000, 5000, 5000]
  const clock = () => {
    const value = ticks[Math.min(reading, ticks.length - 1)]
    reading += 1
    return value
  }

  const report = await runLadder({ worksheet: join(root, 'worksheet.json'), root, clock, limits: { timeoutMs: 1000 } })

  assert.equal(report.summary.verified, 1, 'the first item really was checked before the budget ran out')
  assert.equal(report.status, 'incomplete')
  assert.equal(report.recommendation, null)
  assert.equal(findingFor(report, 'time-budget-exceeded').severity, 'error')
  assert.equal(findingsFor(report, 'lower-rung-available').length, 0)
})

test('the same run with time to spare does reach the recommendation', async (t) => {
  // The other half of the previous test: without it, a tool that never
  // recommends anything would pass it.
  const root = await makeTree({
    'src/app.mjs': 'export const marker = "here"\n',
    'worksheet.json': worksheet([
      nativeCandidate({
        id: 'first',
        rung: 'no-change',
        evidence: [{ kind: 'source', file: 'src/app.mjs', contains: 'here' }],
      }),
      nativeCandidate({ id: 'second', rung: 'project-reuse' }),
    ]),
  })
  t.after(() => cleanup(root))

  const report = await runLadder({
    worksheet: join(root, 'worksheet.json'),
    root,
    clock: () => 0,
    limits: { timeoutMs: 1000 },
  })
  assert.equal(report.status, 'fail')
  assert.equal(report.recommendation.rung, 'no-change')
  assert.equal(findingFor(report, 'lower-rung-available').severity, 'error')
})

test('a worksheet with no candidates is incomplete, not an empty pass', async (t) => {
  const root = await makeTree({ 'worksheet.json': worksheet([]) })
  t.after(() => cleanup(root))

  const { report, status } = runReport(root)
  assert.equal(report.summary.checked, 0)
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
  assert.match(findingFor(report, 'no-candidates').message, /not a small solution/)
})

test('an incomplete run says so on stderr and puts a report on stdout', async (t) => {
  const root = await makeTree({ 'worksheet.json': worksheet([]) })
  t.after(() => cleanup(root))

  const { stdout, stderr, status } = runReport(root)
  assert.equal(status, 2)
  assert.notEqual(stdout, '', 'the run had a subject, so the consumer gets a report saying what was not obtained')
  assert.match(stderr, /incomplete/)
  assert.equal(JSON.parse(stdout).status, 'incomplete')
})
