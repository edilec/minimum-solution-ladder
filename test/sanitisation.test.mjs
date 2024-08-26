/**
 * Sanitising, class by class, on what actually reaches stdout.
 *
 * Stripping C0 and the line separators is not sanitising: four tools in this
 * catalog did exactly that and let the C1 range through, where U+0085 (NEL)
 * starts a new line on a terminal just as a line feed does, U+009B opens an
 * escape sequence, and U+202E reverses everything displayed after it.
 *
 * So every class below is exercised separately, and one of them arrives through
 * an **identifier** rather than an excerpt -- the case that caught a tool which
 * had sanitised its evidence field carefully and let a page id forge whole lines.
 *
 * The characters are built from code points here for the same reason the
 * implementation builds its pattern that way: a literal U+2028 in a source file
 * is a syntax hazard, and in a regular expression literal it breaks the module
 * at load.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { CONTROL_CLASSES, sanitize } from '../src/index.mjs'
import { cleanup, findingFor, makeTree, nativeCandidate, runCli, runReport, worksheet } from './helpers.mjs'

const ALL = Object.values(CONTROL_CLASSES).flat()

/** Every code point the contract says must never reach output. */
function controlsIn(text) {
  return [...text].map((character) => character.codePointAt(0)).filter((point) => ALL.includes(point))
}

/**
 * Every string the report carries, walked.
 *
 * Checking the raw stdout instead would be weaker and noisier: the pretty
 * printer puts real line feeds between fields, and `JSON.stringify` escapes a
 * line feed *inside* a value as `\n`, so a forged line hides from a scan of the
 * bytes and shows up here, in the value a consumer actually reads back.
 */
function stringsIn(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsIn)
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => [key, ...stringsIn(entry)])
  }
  return []
}

const char = (point) => String.fromCharCode(point)

for (const [name, points] of Object.entries(CONTROL_CLASSES)) {
  test(`the ${name} class never reaches stdout through a free-text field`, async (t) => {
    const statement = `before${points.map(char).join('')}after`
    const root = await makeTree({
      'worksheet.json': worksheet([nativeCandidate()], {
        requirement: { id: 'req', statement, criteria: [{ id: 'c-one', statement: 'The first criterion.' }] },
      }),
    })
    t.after(() => cleanup(root))

    const { report } = runReport(root)
    assert.deepEqual(
      stringsIn(report).flatMap(controlsIn), [], `${name} survived into the JSON report`,
    )
    assert.equal(report.subject.statement, 'before after')
  })

  test(`the ${name} class never reaches stdout through an identifier`, async (t) => {
    // The id is refused by the identifier pattern, and the refusal quotes it.
    // That quotation is an identifier reaching output, and it is sanitised on
    // the way: a candidate id carrying a newline forges lines in the human
    // report exactly as an excerpt would.
    const id = `cand${points.map(char).join('')}idate`
    const root = await makeTree({
      'worksheet.json': worksheet([nativeCandidate({ id })]),
    })
    t.after(() => cleanup(root))

    const { report, stdout } = runReport(root)
    assert.deepEqual(
      stringsIn(report).flatMap(controlsIn), [], `${name} survived into the JSON report through an id`,
    )
    assert.match(stdout, /candidate-malformed/)
  })

  test(`the ${name} class never reaches the human report either`, async (t) => {
    const note = `note${points.map(char).join('')}text`
    const root = await makeTree({
      'worksheet.json': worksheet([nativeCandidate({ evidence: [{ kind: 'assertion', note }] })]),
    })
    t.after(() => cleanup(root))

    // No --json: the plain formatter is the surface a person reads, and it is
    // the one a forged line actually fools. Line feeds separating the report's
    // own lines are legitimate, so they are removed before the scan -- and the
    // line count is compared against the same report with a clean note, which is
    // what a forged line would change.
    const { stdout } = runCli(['--worksheet', `${root}/worksheet.json`, '--root', root])
    assert.deepEqual(
      controlsIn(stdout.replaceAll(char(0x0a), '')), [], `${name} survived into the human report`,
    )

    const clean = await makeTree({
      'worksheet.json': worksheet([
        nativeCandidate({ evidence: [{ kind: 'assertion', note: 'notetext' }] }),
      ]),
    })
    t.after(() => cleanup(clean))
    const plain = runCli(['--worksheet', `${clean}/worksheet.json`, '--root', clean])
    assert.equal(
      stdout.split(char(0x0a)).length,
      plain.stdout.split(char(0x0a)).length,
      `${name} forged a line in the human report`,
    )
  })
}

test('a control character in an evidence path is stripped from the reported location', async (t) => {
  const file = `src${char(0x0a)}app.mjs`
  const root = await makeTree({
    'worksheet.json': worksheet([
      nativeCandidate({ evidence: [{ kind: 'source', file, contains: 'marker' }] }),
    ]),
  })
  t.after(() => cleanup(root))

  const { report } = runReport(root)
  assert.deepEqual(stringsIn(report).flatMap(controlsIn), [])
  const finding = findingFor(report, 'evidence-file-unreadable')
  assert.equal(finding.location.file, 'src app.mjs')
})

test('sanitize bounds the length and marks what it cut', () => {
  assert.equal(sanitize('x'.repeat(200), 10), `${'x'.repeat(10)}...`)
  assert.equal(sanitize('  spaced   out  '), 'spaced out')
  assert.equal(sanitize(`a${char(0x9b)}b`), 'a b')
  assert.throws(() => sanitize('x', 0), TypeError)
})

/**
 * A value that cannot be stringified costs the whole report, not just its field.
 *
 * `String({toString: {}})` throws `Cannot convert object to primitive value`, and
 * every malformed field in this tool is reported by sanitising the value that was
 * wrong. Uncaught, one such value emptied stdout on exit 2 -- the shape this
 * contract reserves for a configuration error -- so a consumer could not tell
 * which input was not read, and every other finding in the same run went with it.
 *
 * The guard lives at the sanitising boundary, so these cases walk the three
 * pointers that reach it and then check the boundary itself: a value it cannot
 * render is described by its shape, never reproduced, and every value it can
 * render is untouched. A guard that mangled everything would pass the crash case
 * on its own.
 */

const POISON = JSON.parse('{"toString": {}}')
const SECRET = 'AKIAIOSFODNN7EXAMPLE'

test('String() really does throw on the poison these cases are about', () => {
  assert.throws(() => String(POISON), TypeError)
  assert.throws(() => String([POISON]), TypeError)
})

test('sanitize describes an unstringifiable value by its shape and reproduces nothing', () => {
  assert.equal(sanitize(POISON), '[object]')
  assert.equal(sanitize([POISON]), '[array]')
  assert.equal(sanitize({ toString: {}, secret: SECRET }), '[object]')
})

test('sanitize leaves every value it can render exactly as it was', () => {
  assert.equal(sanitize('plain text'), 'plain text')
  assert.equal(sanitize(42), '42')
  assert.equal(sanitize(null), 'null')
  assert.equal(sanitize(undefined), 'undefined')
  assert.equal(sanitize(false), 'false')
  assert.equal(sanitize([1, 2]), '1,2')
  assert.equal(sanitize({ toString: () => 'a real custom toString' }), 'a real custom toString')
})

for (const [where, document] of [
  ['/schemaVersion', { schemaVersion: POISON, note: SECRET }],
  ['/candidates/0/id', JSON.parse(worksheet([nativeCandidate({ id: POISON, summary: SECRET })]))],
  ['/candidates/0/evidence/0/kind', JSON.parse(worksheet([
    nativeCandidate({ evidence: [{ kind: POISON, note: SECRET }] }),
  ]))],
]) {
  test(`an unstringifiable value at ${where} is reported, not thrown`, async (t) => {
    const root = await makeTree({ 'worksheet.json': JSON.stringify(document) })
    t.after(() => cleanup(root))

    const { report, status, stdout } = runReport(root)
    assert.equal(status, 2)
    assert.notEqual(stdout, '', 'an input that could not be interpreted owes a report, not empty stdout')
    assert.equal(report.status, 'incomplete')
    assert.ok(report.findings.length > 0, 'the report must say which input was not read')
    assert.doesNotMatch(stdout, new RegExp(SECRET), 'a neighbouring field is none of the report\'s business')
  })
}

test('one unstringifiable value does not suppress the findings for the rest of the document', async (t) => {
  const root = await makeTree({
    'worksheet.json': worksheet([
      nativeCandidate({ id: POISON }),
      nativeCandidate({ id: 'second', rung: 'not-a-rung' }),
    ]),
  })
  t.after(() => cleanup(root))

  const { report, status } = runReport(root)
  assert.equal(status, 2)
  assert.equal(findingFor(report, 'candidate-malformed').evidence, '[object]')
  assert.equal(findingFor(report, 'candidate-rung-unknown').evidence, 'not-a-rung')
})
