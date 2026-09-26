/**
 * The parse-failure helper: the document never comes back out.
 *
 * V8 embeds the offending input in its own message --
 * `Unexpected token 'A', "AKIAIOSFODNN7EXAMPLE" is not valid JSON` -- so
 * interpolating `error.message` walks file contents onto stdout past every
 * redactor. Nineteen of thirty-eight tools in this catalog shipped the bug the
 * other way round: they looked for `at position N` first, which finds that
 * phrase *inside the quoted span* when the document itself contains it, and
 * slices the document straight back out.
 *
 * Every case below is one the contract names, and the last one is the other
 * half: the safe positional wording must still come through with its position,
 * line and column, or the helper is useless.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { parseFailureDetail } from '../src/index.mjs'
import { cleanup, makeTree, runReport } from './helpers.mjs'

const CREDENTIAL = 'AKIAIOSFODNN7EXAMPLE'

/** The real V8 message for a document, obtained by actually parsing it. */
function failureFor(document) {
  try {
    JSON.parse(document)
    throw new Error('that document parsed')
  } catch (error) {
    return { error, detail: parseFailureDetail(error) }
  }
}

test('the helper is exported from the package entry point', () => {
  assert.equal(typeof parseFailureDetail, 'function')
})

test('a document that reads "at position 1" does not come back as its own excerpt', () => {
  const { error, detail } = failureFor('at position 1')
  assert.match(error.message, /at position 1/, 'the fixture must reproduce the trap')
  assert.equal(detail, "unexpected token 'a' at the start of the document")
  assert.doesNotMatch(detail, /"/)
})

test('a document that is only a credential is not reproduced', () => {
  const { error, detail } = failureFor(CREDENTIAL)
  assert.match(error.message, new RegExp(CREDENTIAL), 'the fixture must reproduce the trap')
  assert.doesNotMatch(detail, new RegExp(CREDENTIAL))
  assert.equal(detail, "unexpected token 'A' at the start of the document")
})

test('a long document with a sensitive prefix is not reproduced', () => {
  const { detail } = failureFor(`${CREDENTIAL} ${'x'.repeat(4000)}`)
  assert.doesNotMatch(detail, new RegExp(CREDENTIAL))
  assert.doesNotMatch(detail, /x{5}/)
})

test('a quoted span containing a newline is still recognised', () => {
  // The `s` flag is what makes this work: without it the dotAll-less pattern
  // fails to match, the position branch runs instead, and the document's own
  // text is sliced back out.
  const { error, detail } = failureFor(`{"alpha": ${String.fromCharCode(0x0a)}${CREDENTIAL}}`)
  assert.match(error.message, /\n/, 'the fixture must put a newline inside the quoted span')
  assert.doesNotMatch(detail, new RegExp(CREDENTIAL))
  assert.doesNotMatch(detail, /"/)
})

test('a quoted span taken from the middle of the document is not reproduced', () => {
  const { detail } = failureFor(`{"alpha": "ok", "beta": ${CREDENTIAL}}`)
  assert.doesNotMatch(detail, new RegExp(CREDENTIAL))
  assert.doesNotMatch(detail, /"/)
})

test('the safe positional wording still yields position, line and column', () => {
  const { error, detail } = failureFor('{"alpha": 1 "beta": 2}')
  assert.match(error.message, /at position \d+ \(line \d+ column \d+\)/, 'the fixture must produce the safe shape')
  assert.match(detail, /at position \d+ \(line \d+ column \d+\)$/)
  assert.doesNotMatch(detail, /"/)
})

test('an unfinished document keeps its own wording', () => {
  const { detail } = failureFor('{"alpha":')
  assert.equal(detail, 'Unexpected end of JSON input')
})

test('a message the helper has never seen is refused if it still carries a quote', () => {
  const invented = { message: `Some future wording, "${CREDENTIAL}", is not acceptable` }
  assert.equal(parseFailureDetail(invented), 'the document could not be parsed as JSON')
})

test('a worksheet that is only a credential does not leak through the real CLI', async (t) => {
  const root = await makeTree({ 'worksheet.json': CREDENTIAL })
  t.after(() => cleanup(root))

  const { report, stdout, stderr, status } = runReport(root)
  assert.equal(status, 2)
  assert.equal(report.status, 'incomplete')
  assert.equal(report.findings[0].ruleId, 'worksheet-not-json')
  assert.doesNotMatch(stdout, new RegExp(CREDENTIAL))
  assert.doesNotMatch(stderr, new RegExp(CREDENTIAL))
})

test('a dependency manifest that is only a credential does not leak either', async (t) => {
  const root = await makeTree({
    'package.json': CREDENTIAL,
    'worksheet.json': JSON.stringify({
      schemaVersion: '1',
      requirement: { id: 'req', statement: 'Something must hold.', criteria: [{ id: 'c-one', statement: 'One.' }] },
      proposed: { rung: 'new-machinery', summary: 'Write it.' },
      candidates: [{
        id: 'installed',
        rung: 'installed-dependency',
        summary: 'It is already installed.',
        satisfies: ['c-one'],
        evidence: [{ kind: 'dependency', file: 'package.json', name: 'uuid' }],
      }],
    }),
  })
  t.after(() => cleanup(root))

  const { stdout, stderr } = runReport(root)
  assert.doesNotMatch(stdout, new RegExp(CREDENTIAL))
  assert.doesNotMatch(stderr, new RegExp(CREDENTIAL))
})

test('a configuration file that is only a credential does not leak on the way to exit 2', async (t) => {
  const root = await makeTree({ 'worksheet.json': '{}', 'config.json': CREDENTIAL })
  t.after(() => cleanup(root))

  const { stdout, stderr, status } = runReport(root, ['--config', `${root}/config.json`])
  assert.equal(status, 2)
  assert.equal(stdout, '', 'a configuration error means the run never had a subject')
  assert.doesNotMatch(stderr, new RegExp(CREDENTIAL))
})
