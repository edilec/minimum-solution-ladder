/**
 * The root is the boundary of what this run may read.
 *
 * Rejecting `../` and absolute paths is not confinement: a symbolic link planted
 * inside the declared root spells nothing suspicious and points anywhere on the
 * machine. A tool in this catalog followed one and echoed out-of-root content
 * into its report.
 *
 * The allowed cases are here too. A guard that refuses everything passes every
 * confinement test while making the tool useless, so the tests below prove both
 * halves: what is refused, and what still works.
 */

import assert from 'node:assert/strict'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { isInside } from '../src/index.mjs'
import { cleanup, findingFor, makeTree, nativeCandidate, runCli, runReport, worksheet } from './helpers.mjs'

const SECRET = 'the private marker nobody asked for'

test('a symlink inside the root pointing out of it is refused, and its content is not echoed', async (t) => {
  const outside = await makeTree({ 'secret.txt': `${SECRET}\n` })
  const root = await makeTree({
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'source', file: 'link.txt', contains: 'private marker' }] }),
    ]),
  })
  t.after(() => Promise.all([cleanup(root), cleanup(outside)]))
  await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'))

  const { report, stdout, status } = runReport(root)
  const finding = findingFor(report, 'evidence-path-escapes-root')
  assert.match(finding.message, /outside the declared root/)
  assert.equal(report.status, 'incomplete')
  assert.equal(status, 2)
  assert.doesNotMatch(stdout, new RegExp(SECRET))
})

test('a symlinked directory inside the root pointing out of it is refused too', async (t) => {
  const outside = await makeTree({ 'notes/secret.txt': `${SECRET}\n` })
  const root = await makeTree({
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'source', file: 'notes/secret.txt', contains: 'private marker' }] }),
    ]),
  })
  t.after(() => Promise.all([cleanup(root), cleanup(outside)]))
  await symlink(join(outside, 'notes'), join(root, 'notes'))

  const { report, stdout } = runReport(root)
  assert.equal(findingFor(report, 'evidence-path-escapes-root').severity, 'error')
  assert.doesNotMatch(stdout, new RegExp(SECRET))
})

test('a link that stays inside the root is followed, because it does not leave the tree', async (t) => {
  const root = await makeTree({ 'real/app.mjs': 'export const marker = "the marker"\n' })
  t.after(() => cleanup(root))
  await symlink(join(root, 'real', 'app.mjs'), join(root, 'alias.mjs'))
  await writeFile(join(root, 'worksheet.json'), worksheet([
    nativeCandidate({ evidence: [{ kind: 'source', file: 'alias.mjs', contains: 'the marker' }] }),
  ], { proposed: { rung: 'platform-native', summary: 'Use it.' } }))

  const { report, status } = runReport(root)
  assert.equal(report.status, 'pass')
  assert.equal(status, 0)
  assert.equal(report.summary.verified, 1)
})

test('a path that climbs out lexically is refused by the schema before it reaches the filesystem', async (t) => {
  const root = await makeTree({
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'source', file: '../outside.txt', contains: 'anything' }] }),
    ]),
  })
  t.after(() => cleanup(root))

  const { report, status } = runReport(root)
  assert.match(findingFor(report, 'candidate-malformed').message, /relative path inside the root/)
  assert.equal(status, 2)
})

test('an absolute evidence path is refused', async (t) => {
  const root = await makeTree({
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'source', file: '/etc/hosts', contains: 'localhost' }] }),
    ]),
  })
  t.after(() => cleanup(root))

  const { report, status } = runReport(root)
  assert.match(findingFor(report, 'candidate-malformed').message, /relative path inside the root/)
  assert.equal(status, 2)
})

test('a worksheet outside the declared root is a configuration error with empty stdout', async (t) => {
  const outside = await makeTree({ 'worksheet.json': worksheet([nativeCandidate()]) })
  const root = await makeTree({ 'keep.txt': 'x' })
  t.after(() => Promise.all([cleanup(root), cleanup(outside)]))

  const { stdout, stderr, status } = runCli([
    '--worksheet', join(outside, 'worksheet.json'), '--root', root, '--json',
  ])
  assert.equal(status, 2)
  assert.equal(stdout, '', 'the run never had a subject inside the root, so there is nothing to report about')
  assert.match(stderr, /must be inside the root/)
})

test('a root that does not exist is a configuration error with empty stdout', async (t) => {
  const root = await makeTree({ 'worksheet.json': worksheet([nativeCandidate()]) })
  t.after(() => cleanup(root))

  const { stdout, stderr, status } = runCli([
    '--worksheet', join(root, 'worksheet.json'), '--root', join(root, 'nowhere'), '--json',
  ])
  assert.equal(status, 2)
  assert.equal(stdout, '')
  assert.match(stderr, /root directory could not be resolved/)
})

test('reported paths are relative to the root and never absolute host paths', async (t) => {
  const root = await makeTree({
    'deep/nested/app.mjs': 'export const marker = "here"\n',
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'source', file: 'deep/nested/app.mjs', contains: 'not there' }] }),
    ]),
  })
  t.after(() => cleanup(root))

  const { report, stdout } = runReport(root)
  assert.equal(findingFor(report, 'evidence-not-found').location.file, 'deep/nested/app.mjs')
  assert.doesNotMatch(stdout, /"file": "\//)
})

test('isInside compares real paths and does not accept a sibling with a shared prefix', () => {
  assert.equal(isInside('/a/root', '/a/root'), true)
  assert.equal(isInside('/a/root', '/a/root/inner/file.txt'), true)
  assert.equal(isInside('/a/root', '/a/rootless/file.txt'), false)
  assert.equal(isInside('/a/root', '/a/other'), false)
})

test('a nested directory inside the root is read normally', async (t) => {
  const root = await makeTree({ 'a/b/c/app.mjs': 'export const marker = "deep marker"\n' })
  t.after(() => cleanup(root))
  await mkdir(join(root, 'a', 'b', 'c'), { recursive: true })
  await writeFile(join(root, 'worksheet.json'), worksheet([
    nativeCandidate({ evidence: [{ kind: 'source', file: 'a/b/c/app.mjs', contains: 'deep marker' }] }),
  ], { proposed: { rung: 'platform-native', summary: 'Use it.' } }))

  const { report, status } = runReport(root)
  assert.equal(report.status, 'pass')
  assert.equal(status, 0)
})
