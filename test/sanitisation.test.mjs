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
