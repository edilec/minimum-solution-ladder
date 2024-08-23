/**
 * The command-line surface, including the two shapes of exit 2.
 *
 * A configuration error means the run never had a subject, so stdout is empty.
 * An input that could not be read means the run had a subject and failed to
 * obtain evidence about it, so stdout carries an `incomplete` report naming what
 * was not read. A consumer piping stdout has to handle both, which is why both
 * are pinned here rather than left to whichever branch happened to be written
 * first.
 */

import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'

import { cleanup, makeTree, nativeCandidate, runCli, worksheet } from './helpers.mjs'

test('--help goes to stdout and exits 0', () => {
  const { stdout, status } = runCli(['--help'])
  assert.equal(status, 0)
  assert.match(stdout, /minimum-solution-ladder/)
  assert.match(stdout, /Exit codes:/)
})

test('the help text says the tool writes no files', () => {
  // The contract's write-guard section applies to a tool that writes. This one
  // does not, and saying so is the honest alternative to documenting a
  // confinement the code does not perform.
  const { stdout } = runCli(['--help'])
  assert.match(stdout, /writes no file/)
  assert.doesNotMatch(stdout, /^ *--out\b/m, 'a tool with no --out must not advertise one')
})

test('the help text describes every evidence kind, including the one that never counts', () => {
  const { stdout } = runCli(['--help'])
  for (const kind of ['source', 'dependency', 'builtin', 'assertion']) {
    assert.match(stdout, new RegExp(`^  ${kind}\\s`, 'm'), `the help text does not describe "${kind}"`)
  }
  assert.match(stdout, /it is never evidence/)
})

test('an unknown option is refused with empty stdout and exit 2', () => {
  const { stdout, stderr, status } = runCli(['--worksheet', 'x.json', '--recursive'])
  assert.equal(status, 2)
  assert.equal(stdout, '')
  assert.match(stderr, /Unknown option "--recursive"/)
})

test('a missing --worksheet is refused with empty stdout and exit 2', () => {
  const { stdout, stderr, status } = runCli(['--json'])
  assert.equal(status, 2)
  assert.equal(stdout, '')
  assert.match(stderr, /--worksheet is required/)
})

test('a repeated flag is a configuration error, not a silent last-wins', () => {
  const { stdout, stderr, status } = runCli(['--worksheet', 'a.json', '--worksheet', 'b.json'])
  assert.equal(status, 2)
  assert.equal(stdout, '')
  assert.match(stderr, /--worksheet was given more than once/)
})

test('a flag with no value is refused', () => {
  const { stderr, status } = runCli(['--worksheet'])
  assert.equal(status, 2)
  assert.match(stderr, /--worksheet requires a value/)
})

test('an unreadable worksheet still puts a report on stdout, because the run had a subject', async (t) => {
  const root = await makeTree({ 'other.json': '{}' })
  t.after(() => cleanup(root))

  const { stdout, status } = runCli(['--worksheet', join(root, 'worksheet.json'), '--root', root, '--json'])
  assert.equal(status, 2)
  const report = JSON.parse(stdout)
  assert.equal(report.status, 'incomplete')
  assert.equal(report.findings[0].ruleId, 'worksheet-unreadable')
  assert.equal(report.findings[0].location.file, 'worksheet.json')
})

test('stdout carries the JSON report and nothing else', async (t) => {
  const root = await makeTree({ 'worksheet.json': worksheet([nativeCandidate()]) })
  t.after(() => cleanup(root))

  const { stdout, stderr } = runCli(['--worksheet', join(root, 'worksheet.json'), '--root', root, '--json'])
  assert.doesNotThrow(() => JSON.parse(stdout))
  assert.equal(JSON.parse(stdout).tool, 'minimum-solution-ladder')
  assert.doesNotMatch(stderr, /\{/, 'diagnostics are not data')
})

test('the human report names the rung, the candidate and the evidence', async (t) => {
  const root = await makeTree({ 'worksheet.json': worksheet([nativeCandidate()]) })
  t.after(() => cleanup(root))

  const { stdout, status } = runCli(['--worksheet', join(root, 'worksheet.json'), '--root', root])
  assert.equal(status, 1)
  assert.match(stdout, /Recommended rung: "platform-native" via candidate "native"/)
  assert.match(stdout, /evidence: kind=builtin module=node:crypto export=randomUUID/)
  assert.match(stdout, /status fail/)
})

test('the default root is the directory holding the worksheet', async (t) => {
  const root = await makeTree({
    'src/app.mjs': 'export const marker = "the marker"\n',
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'source', file: 'src/app.mjs', contains: 'the marker' }] }),
    ], { proposed: { rung: 'platform-native', summary: 'Use it.' } }),
  })
  t.after(() => cleanup(root))

  const { stdout, status } = runCli(['--worksheet', join(root, 'worksheet.json'), '--json'])
  assert.equal(status, 0)
  assert.equal(JSON.parse(stdout).summary.verified, 1)
})
