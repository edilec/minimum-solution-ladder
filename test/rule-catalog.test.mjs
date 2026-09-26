/**
 * The catalog and the documents agree, in both directions.
 *
 * This is a completeness check, not the severity guard. Two tables agreeing with
 * each other are satisfied by one coordinated edit; the guard for severity is
 * `test/severity-outcomes.test.mjs`, where every expectation is a literal and
 * several of them are exit codes.
 *
 * What this file catches is the other failure: a rule added to the code and
 * never documented, or documented and never implemented, or listed as making a
 * run incomplete without being a rule at all.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { DEFAULT_LIMITS, EXIT_MEANINGS, INCOMPLETE_RULES, RULE_SEVERITY, RUNGS, TOOL_ID } from '../src/index.mjs'
import { runCli } from './helpers.mjs'

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8')

/** Rule ids from a markdown table whose first column is a backticked id. */
function documentedRules(markdown) {
  return [...markdown.matchAll(/^\| `([a-z][a-z0-9-]*)` \| (error|warning|info) \|/gm)]
    .map(([, ruleId, severity]) => ({ ruleId, severity }))
}

test('TOOL_ID equals the directory and package name', async () => {
  const manifest = JSON.parse(await read('package.json'))
  assert.equal(TOOL_ID, 'minimum-solution-ladder')
  assert.equal(manifest.name, TOOL_ID)
  assert.equal(new URL('..', import.meta.url).pathname.replace(/\/$/, '').split('/').pop(), TOOL_ID)
})

test('every rule in the code is documented, and every documented rule exists', async () => {
  const documented = documentedRules(await read('docs/ladder-rules.md'))
  const documentedIds = documented.map((row) => row.ruleId).sort()
  const declaredIds = Object.keys(RULE_SEVERITY).sort()

  assert.deepEqual(
    declaredIds.filter((id) => !documentedIds.includes(id)), [],
    'these rules are implemented and not documented',
  )
  assert.deepEqual(
    documentedIds.filter((id) => !declaredIds.includes(id)), [],
    'these rules are documented and not implemented',
  )
})

test('the documented severity matches the table it is documenting', async () => {
  for (const row of documentedRules(await read('docs/ladder-rules.md'))) {
    assert.equal(RULE_SEVERITY[row.ruleId], row.severity, `docs disagree about ${row.ruleId}`)
  }
})

test('the README documents the same rules as the code', async () => {
  const documented = documentedRules(await read('README.md')).map((row) => row.ruleId).sort()
  assert.deepEqual(documented, Object.keys(RULE_SEVERITY).sort())
})

test('every incomplete rule is a real rule, and the fail rules are named exactly', () => {
  const unknown = INCOMPLETE_RULES.filter((ruleId) => !Object.hasOwn(RULE_SEVERITY, ruleId))
  assert.deepEqual(unknown, [], 'these rules make a run incomplete but are not in the severity table')

  const failing = Object.entries(RULE_SEVERITY)
    .filter(([ruleId, severity]) => severity === 'error' && !INCOMPLETE_RULES.includes(ruleId))
    .map(([ruleId]) => ruleId)
    .sort()
  // Exactly three rules mean "checked, and the answer is no".
  assert.deepEqual(failing, ['evidence-not-found', 'lower-rung-available', 'unsourced-savings-claim'])
})

test('INCOMPLETE_RULES is sorted by code unit, so a reader can find a rule in it', () => {
  const sorted = [...INCOMPLETE_RULES].sort((a, b) => (a === b ? 0 : a < b ? -1 : 1))
  assert.deepEqual([...INCOMPLETE_RULES], sorted)
})

test('the ladder is documented in the order the code applies it', async () => {
  assert.deepEqual([...RUNGS], [
    'no-change',
    'project-reuse',
    'standard-library',
    'platform-native',
    'installed-dependency',
    'local-edit',
    'new-machinery',
  ])

  const markdown = await read('docs/ladder-rules.md')
  const documented = [...markdown.matchAll(/^\| (\d) \| `([a-z-]+)` \|/gm)].map(([, index, rung]) => [Number(index), rung])
  assert.deepEqual(documented, RUNGS.map((rung, index) => [index, rung]))
})

test('every documented limit exists, with the documented default', async () => {
  const markdown = await read('docs/ladder-rules.md')
  const rows = [...markdown.matchAll(/^\| `(\w+)` \| `(--[a-z-]+)` \| (\d+) \|/gm)]
  assert.equal(rows.length, Object.keys(DEFAULT_LIMITS).length)
  for (const [, name, , value] of rows) {
    assert.equal(DEFAULT_LIMITS[name], Number(value), `the documented default for ${name} is not the real one`)
  }
})

test('the README does not promise an output file this tool does not write', async () => {
  const readme = await read('README.md')
  assert.match(readme, /writes no file/i)
  // Naming a flag the CLI does not have is the documentation overclaim this
  // catalog counts as a defect; saying there is no such flag is not.
  assert.doesNotMatch(readme, /^ *\| `--out/m)
  assert.doesNotMatch(readme, /--out [A-Z]/)
})


/**
 * The exit-code documents, which disagreed with each other and with the tool.
 *
 * The README's row for `0` said the proposal was "the smallest verified rung"
 * while the rule table on the same page documented `proposal-unverified` and
 * `no-candidate-fully-covers` as passing -- and both of those exit 0 having
 * verified nothing about the proposal. A consumer keying on the exit code read
 * green for a proposal this run never reached.
 *
 * The behaviour is right: a run that cannot challenge the proposal has not found
 * it wanting, and evidence that was not obtained is `incomplete` and exits 2
 * long before this. So the sentence was corrected, not the rule -- and there is
 * now one sentence, printed by `--help` and asserted here against the README.
 */

const normalise = (text) => text.replace(/\s+/g, ' ').trim()

test('the README exit-code table is the table the tool prints', async () => {
  const rows = [...(await read('README.md')).matchAll(/^\| `(\d)` \| (.+?) \|$/gm)]
  assert.equal(rows.length, Object.keys(EXIT_MEANINGS).length)

  const help = normalise(runCli(['--help']).stdout)
  for (const [, code, meaning] of rows) {
    assert.equal(normalise(meaning), normalise(EXIT_MEANINGS[code]), `the README row for exit ${code} is not the tool's`)
    assert.equal(help.includes(normalise(EXIT_MEANINGS[code])), true, `--help does not print the meaning of exit ${code}`)
  }
})

test('nothing claims exit 0 means the proposal itself was verified', async () => {
  // The two rules that pass without verifying the proposal are pinned
  // behaviourally in test/severity-outcomes.test.mjs; this is the document half
  // of the same guarantee, and it is the half that was wrong.
  const readme = await read('README.md')
  assert.doesNotMatch(readme, /smallest verified rung/)
  assert.doesNotMatch(runCli(['--help']).stdout, /smallest verified rung/)
  assert.match(normalise(EXIT_MEANINGS[0]), /not a claim that the proposal itself was verified/)
})

test('the README does not promise a measurement behind every number it prints', async () => {
  // An unsourced savings claim is quoted back in the finding that refuses it --
  // showing the figure is what makes the refusal readable -- so "if a number
  // appears in its output, a measurement backs it" was false on that path.
  const readme = await read('README.md')
  assert.doesNotMatch(readme, /a measurement\s+backs it/)
  assert.match(readme, /unsourced-savings-claim/)
})
