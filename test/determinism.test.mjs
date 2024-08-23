/**
 * The same worksheet produces the same bytes.
 *
 * Not "the same findings in some order": the same bytes, because the report is
 * diffed, committed and pasted into reviews. A difference between two runs of
 * one input is a defect even when both answers are correct.
 */

import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'

import { runLadder } from '../src/index.mjs'
import { cleanup, makeTree, nativeCandidate, runCli, worksheet } from './helpers.mjs'

const busy = () => worksheet([
  nativeCandidate({ id: 'zulu', rung: 'local-edit' }),
  nativeCandidate({
    id: 'alpha',
    rung: 'project-reuse',
    evidence: [{ kind: 'source', file: 'src/app.mjs', contains: 'not in the file' }],
  }),
  nativeCandidate({
    id: 'mike',
    rung: 'installed-dependency',
    evidence: [{ kind: 'dependency', file: 'package.json', name: 'absent-package' }],
  }),
], {
  requirement: {
    id: 'req',
    statement: 'Two things must hold.',
    criteria: [
      { id: 'c-one', statement: 'One.' },
      { id: 'c-two', statement: 'Two.' },
    ],
  },
})

test('two runs over the same tree emit byte-identical stdout', async (t) => {
  const root = await makeTree({
    'package.json': JSON.stringify({ name: 'app', dependencies: {} }),
    'src/app.mjs': 'export const marker = "here"\n',
    'worksheet.json': busy(),
  })
  t.after(() => cleanup(root))

  const args = ['--worksheet', join(root, 'worksheet.json'), '--root', root, '--json']
  const first = runCli(args)
  const second = runCli(args)
  assert.equal(first.stdout, second.stdout)
  assert.equal(first.status, second.status)
  assert.notEqual(first.stdout, '')
})

test('the human report is byte-identical too', async (t) => {
  const root = await makeTree({
    'package.json': JSON.stringify({ name: 'app', dependencies: {} }),
    'src/app.mjs': 'export const marker = "here"\n',
    'worksheet.json': busy(),
  })
  t.after(() => cleanup(root))

  const args = ['--worksheet', join(root, 'worksheet.json'), '--root', root]
  assert.equal(runCli(args).stdout, runCli(args).stdout)
})

test('the same worksheet under a different root path produces the same report', async (t) => {
  // Two temporary directories with different absolute names. If a host path
  // leaked into the report, this would fail.
  const files = {
    'package.json': JSON.stringify({ name: 'app', dependencies: {} }),
    'src/app.mjs': 'export const marker = "here"\n',
    'worksheet.json': busy(),
  }
  const first = await makeTree(files)
  const second = await makeTree(files)
  t.after(() => Promise.all([cleanup(first), cleanup(second)]))

  const report = (root) => runCli(['--worksheet', join(root, 'worksheet.json'), '--root', root, '--json']).stdout
  assert.equal(report(first), report(second))
  assert.notEqual(first, second)
})

test('object key order in the report does not depend on the worksheet key order', async (t) => {
  const ordered = JSON.parse(busy())
  const shuffled = {
    candidates: ordered.candidates,
    proposed: ordered.proposed,
    requirement: ordered.requirement,
    schemaVersion: ordered.schemaVersion,
  }
  const files = {
    'package.json': JSON.stringify({ name: 'app', dependencies: {} }),
    'src/app.mjs': 'export const marker = "here"\n',
  }
  const first = await makeTree({ ...files, 'worksheet.json': JSON.stringify(ordered) })
  const second = await makeTree({ ...files, 'worksheet.json': JSON.stringify(shuffled) })
  t.after(() => Promise.all([cleanup(first), cleanup(second)]))

  const report = (root) => runCli(['--worksheet', join(root, 'worksheet.json'), '--root', root, '--json']).stdout
  assert.equal(report(first), report(second))
})

test('a second run in the same process does not answer from the first run cache', async (t) => {
  // The read cache is per-run. One that outlived a run would let one worksheet's
  // file contents answer another worksheet's question.
  const first = await makeTree({
    'src/app.mjs': 'export const marker = "the marker"\n',
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'source', file: 'src/app.mjs', contains: 'the marker' }] }),
    ], { proposed: { rung: 'platform-native', summary: 'Use it.' } }),
  })
  const second = await makeTree({
    'src/app.mjs': 'export const marker = "something else entirely"\n',
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'source', file: 'src/app.mjs', contains: 'the marker' }] }),
    ], { proposed: { rung: 'platform-native', summary: 'Use it.' } }),
  })
  t.after(() => Promise.all([cleanup(first), cleanup(second)]))

  const before = await runLadder({ worksheet: join(first, 'worksheet.json'), root: first })
  const after = await runLadder({ worksheet: join(second, 'worksheet.json'), root: second })
  assert.equal(before.status, 'pass')
  assert.equal(after.status, 'fail')
})

test('an unknown option to the library is refused rather than ignored', async (t) => {
  const root = await makeTree({ 'worksheet.json': worksheet([nativeCandidate()]) })
  t.after(() => cleanup(root))
  await assert.rejects(
    () => runLadder({ worksheet: join(root, 'worksheet.json'), roots: root }),
    /Unknown option "roots"/,
  )
})
