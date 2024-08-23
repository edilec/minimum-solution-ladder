/**
 * Ordering, pinned behaviourally.
 *
 * Scanning this tool's own source for `.localeCompare(` is not a determinism
 * test: substituting `Intl.Collator` produces identical collation drift with
 * different source text, so the grep passes while the output quietly becomes
 * machine-dependent. It has been written twice in this build, the second time by
 * someone who had already learned it.
 *
 * So these tests choose inputs whose order genuinely differs between code-unit
 * and collation ordering, push them through the real report path, and assert the
 * exact emitted sequence. Each one also asserts that the collation ordering of
 * the same strings is *different*, so the fixture is provably able to tell the
 * two apart -- a discrimination check that fails loudly if someone ever picks
 * example names both orderings agree on.
 */

import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'

import { compareFindingRows, runLadder } from '../src/index.mjs'
import { cleanup, makeTree, nativeCandidate, worksheet } from './helpers.mjs'

const collated = (values) => [...values].sort(new Intl.Collator('en').compare)

const NAMES = ['README.md', 'Zulu.md', 'a-b.md', 'a-note.md', 'a_b.md', 'assets.md']

test('findings sort by file using code units, not collation', async (t) => {
  const files = Object.fromEntries(NAMES.map((name) => [name, 'nothing of interest here\n']))
  const root = await makeTree({
    ...files,
    'worksheet.json': worksheet([
      nativeCandidate({
        evidence: NAMES.map((name) => ({ kind: 'source', file: name, contains: 'the marker' })),
      }),
    ]),
  })
  t.after(() => cleanup(root))

  const report = await runLadder({ worksheet: join(root, 'worksheet.json'), root })
  const emitted = report.findings
    .filter((finding) => finding.ruleId === 'evidence-not-found')
    .map((finding) => finding.location.file)

  assert.deepEqual(emitted, ['README.md', 'Zulu.md', 'a-b.md', 'a-note.md', 'a_b.md', 'assets.md'])
  assert.notDeepEqual(emitted, collated(emitted), 'the fixture must distinguish code-unit ordering from collation')
})

test('findings sort by pointer using code units when the file is the same', async (t) => {
  // Ten evidence items on one candidate: by code unit "/10" precedes "/2",
  // which is exactly the ordering a reader can reproduce and a collator is
  // entitled to disagree with.
  const root = await makeTree({
    'worksheet.json': worksheet([
      nativeCandidate({
        evidence: Array.from({ length: 11 }, (_, index) => ({
          kind: 'builtin',
          module: 'node:crypto',
          export: `notAnExport${index}`,
        })),
      }),
    ]),
  })
  t.after(() => cleanup(root))

  const report = await runLadder({ worksheet: join(root, 'worksheet.json'), root })
  const pointers = report.findings.map((finding) => finding.location.pointer)

  assert.deepEqual(pointers, [
    // The summary finding about the candidate set sorts ahead of the items,
    // because "/candidates" is a prefix of every one of them.
    '/candidates',
    '/candidates/0/evidence/0',
    '/candidates/0/evidence/1',
    '/candidates/0/evidence/10',
    '/candidates/0/evidence/2',
    '/candidates/0/evidence/3',
    '/candidates/0/evidence/4',
    '/candidates/0/evidence/5',
    '/candidates/0/evidence/6',
    '/candidates/0/evidence/7',
    '/candidates/0/evidence/8',
    '/candidates/0/evidence/9',
  ])
})

test('the ladder itself is ordered by rung, not by name or by document order', async (t) => {
  const root = await makeTree({
    'a.md': 'the marker is here\n',
    'b.md': 'the marker is here\n',
    'worksheet.json': worksheet([
      nativeCandidate({
        id: 'zebra',
        rung: 'project-reuse',
        evidence: [{ kind: 'source', file: 'b.md', contains: 'the marker' }],
      }),
      nativeCandidate({
        id: 'aardvark',
        rung: 'local-edit',
        evidence: [{ kind: 'source', file: 'a.md', contains: 'the marker' }],
      }),
    ]),
  })
  t.after(() => cleanup(root))

  const report = await runLadder({ worksheet: join(root, 'worksheet.json'), root })
  // "zebra" wins because project-reuse is a lower rung than local-edit, even
  // though it is later in both alphabets and first in the document.
  assert.equal(report.recommendation.candidateId, 'zebra')
  assert.equal(report.recommendation.rung, 'project-reuse')
})

test('two candidates on the same rung tie-break by code unit', async (t) => {
  const root = await makeTree({
    'a.md': 'the marker is here\n',
    'worksheet.json': worksheet([
      nativeCandidate({
        id: 'a_b',
        rung: 'project-reuse',
        evidence: [{ kind: 'source', file: 'a.md', contains: 'the marker' }],
      }),
      nativeCandidate({
        id: 'a-b',
        rung: 'project-reuse',
        evidence: [{ kind: 'source', file: 'a.md', contains: 'the marker' }],
      }),
    ]),
  })
  t.after(() => cleanup(root))

  const report = await runLadder({ worksheet: join(root, 'worksheet.json'), root })
  // By code unit "a-b" (0x2D) precedes "a_b" (0x5F); a collator treats the
  // underscore as ignorable punctuation and reverses them.
  assert.equal(report.recommendation.candidateId, 'a-b')
  assert.notDeepEqual(['a-b', 'a_b'], collated(['a_b', 'a-b']))
})

test('each tie-break key of the documented sort is load-bearing', () => {
  const row = (over) => ({
    ruleId: 'criteria-uncovered',
    severity: 'info',
    message: 'm',
    location: { file: 'f', pointer: '/p' },
    ...over,
  })

  assert.equal(compareFindingRows(row({ location: { file: 'A' } }), row({ location: { file: 'a' } })), -1)
  assert.equal(compareFindingRows(row({ location: { file: 'f', pointer: '/A' } }), row({ location: { file: 'f', pointer: '/a' } })), -1)
  assert.equal(compareFindingRows(row({ ruleId: 'candidate-malformed' }), row({ ruleId: 'criteria-uncovered' })), -1)
  assert.equal(compareFindingRows(row({ message: 'A' }), row({ message: 'a' })), -1)
  assert.equal(compareFindingRows(row({ evidence: 'A' }), row({ evidence: 'a' })), -1)
  assert.equal(compareFindingRows(row({}), row({})), 0)
})
