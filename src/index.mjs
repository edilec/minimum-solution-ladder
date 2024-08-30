/**
 * minimum-solution-ladder
 *
 * Reads a decision worksheet and answers one question: is the change being
 * proposed the smallest one that demonstrably works?
 *
 * The ladder is checked in order -- no change, project reuse, standard library,
 * native platform, an already installed dependency, the smallest local edit,
 * then new machinery -- and a rung counts only when this tool opened something
 * and found what the worksheet said was there.
 *
 * Four properties are structural rather than incidental:
 *
 * 1. **A rung counts only with evidence this tool obtained itself.** Every
 *    candidate declares evidence that can be checked: a string that must appear
 *    in a file inside the root, a package that must be declared in a manifest,
 *    or an export that must exist on the running Node runtime. A prose assertion
 *    is accepted as input and is never accepted as evidence.
 * 2. **Unknown is never a pass, and never an absence either.** Evidence that
 *    could not be obtained -- an unreadable file, undecodable bytes, a module
 *    that would not load, an assertion, a limit reached, a time budget expired
 *    -- makes the run `incomplete`, withdraws the recommendation entirely, and
 *    exits 2. It never reads as "that rung does not apply", which is the reading
 *    that sends an agent off to rebuild something that already exists.
 * 3. **No savings number is invented.** This tool never estimates effort, time
 *    or lines saved, and refuses a worksheet that asserts one without a
 *    measurement it can open. A measured claim is repeated only with the file it
 *    was measured in.
 * 4. **Output is stable.** No clock reading, no locale, no absolute host path
 *    and no object key order reaches stdout, so the same worksheet always
 *    produces byte-identical output.
 *
 * This tool reads. It writes no files, changes no configuration, installs
 * nothing and reaches no network.
 */

import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { checkEvidence, describeEvidence, importBuiltin, isInside, relativePosix } from './evidence.mjs'
import {
  CANDIDATE_KEYS, EVIDENCE_KINDS, ID_PATTERN, RUNGS, RUNG_INDEX, VERIFIABLE_KINDS,
  WORKSHEET_KEYS, WORKSHEET_SCHEMA_VERSION, validateWorksheet,
} from './worksheet.mjs'
import { byCodeUnit, decodeUtf8, parseFailureDetail, sanitize } from './text.mjs'

export {
  DEPENDENCY_SECTIONS, checkEvidence, describeEvidence, importBuiltin, isInside, relativePosix,
} from './evidence.mjs'
export {
  CANDIDATE_KEYS, CRITERION_KEYS, EVIDENCE_KEYS, EVIDENCE_KINDS, ID_PATTERN, PROPOSED_KEYS,
  REQUIREMENT_KEYS, RUNGS, RUNG_INDEX, SAVINGS_KEYS, VERIFIABLE_KINDS, WORKSHEET_KEYS,
  WORKSHEET_SCHEMA_VERSION, validateWorksheet,
} from './worksheet.mjs'
export {
  CONTROL_CLASSES, EXCERPT_LIMIT, byCodeUnit, decodeUtf8, escapePointerSegment, parseFailureDetail, sanitize,
} from './text.mjs'

export const TOOL_ID = 'minimum-solution-ladder'
export const REPORT_SCHEMA_VERSION = '1'
export const CONFIG_SCHEMA_VERSION = '1'

/**
 * What each exit code means, written once.
 *
 * The help text and the README both used to say their own version of this, and
 * the two disagreed: the exit-code table promised that 0 meant "the proposal is
 * the smallest verified rung", while the rule table -- correctly -- documented
 * `proposal-unverified` and `no-candidate-fully-covers` as passing. Both of
 * those exit 0 having verified nothing about the proposal at all, one of them
 * saying so in its own message, so a consumer keying on the exit code read green
 * for a proposal this tool never reached.
 *
 * The behaviour was right and the sentence was wrong: a run that could not
 * challenge the proposal has not found the proposal wanting, and evidence that
 * was not obtained is `incomplete` and exits 2 long before this. So the sentence
 * is corrected rather than the rule, and it lives here, where `--help` prints it
 * and `test/rule-catalog.test.mjs` compares it against the README row. Two
 * documents cannot drift apart when there is only one of them.
 */
export const EXIT_MEANINGS = Object.freeze({
  0: 'The worksheet was checked and nothing in it refutes the proposal: no verified '
    + 'candidate reaches a rung below it, every cited piece of evidence was there, and no '
    + 'saving was asserted without a measurement. It is not a claim that the proposal '
    + 'itself was verified -- proposal-unverified and no-candidate-fully-covers both exit '
    + '0 and both say so in the report.',
  1: 'The worksheet was checked and it failed: a lower rung covers the requirement, a '
    + 'cited piece of evidence is not there, or a saving was asserted without a measurement.',
  2: 'Invalid usage or configuration, where stdout is empty -- or evidence that was '
    + 'missing, undecodable or bounded out, which puts an incomplete report on stdout.',
})

/**
 * Bounds are part of the contract, not a safety net.
 *
 * A worksheet is ordinary untrusted input: it can declare a thousand
 * candidates, cite a generated 40 MB file, or list fifty criteria nobody wrote.
 * Every limit is explicit, overridable from the command line, and named in the
 * finding when it is reached. Exceeding one produces an `incomplete` report and
 * no recommendation -- never a quietly shorter answer, and never a pass.
 *
 * `timeoutMs` accepts 0, and 0 means "no time at all": the first check fires.
 * That is the only way to prove from outside that the flag reaches the
 * verification loop, and a documented limit the command line never reaches is a
 * defect this catalog has already shipped once.
 */
export const DEFAULT_LIMITS = Object.freeze({
  maxCandidates: 100,
  maxCriteria: 50,
  maxEvidenceBytes: 262144,
  maxEvidencePerCandidate: 20,
  maxWorksheetBytes: 1048576,
  timeoutMs: 10000,
})

/**
 * The authoritative rule severity table.
 *
 * Severity decides whether a run refuses. Spread across construction sites as a
 * literal it drifts silently, so every finding takes its severity from here and
 * an unknown rule id throws.
 *
 * This table is the source of truth. It is **not** the guard. Three declarations
 * agreeing with each other -- this table, the README's rule table and an
 * expected-value map written out again in a test -- are all satisfied by one
 * coordinated edit, and 40 of 52 rules survived exactly that flip in another
 * tool here. The guard is `test/severity-outcomes.test.mjs`, which drives each
 * rule through the real CLI and asserts the observable outcome (`fail`,
 * `incomplete`, exit 1, exit 2) as a literal at the assertion site. An edit here
 * has nothing there to agree with.
 */
export const RULE_SEVERITY = Object.freeze({
  'candidate-duplicate-id': 'error',
  'candidate-malformed': 'error',
  'candidate-rung-unknown': 'error',
  'candidate-unknown-key': 'error',
  'criteria-uncovered': 'info',
  'criterion-unknown': 'error',
  'evidence-file-not-json': 'error',
  'evidence-file-not-utf8': 'error',
  'evidence-file-too-large': 'error',
  'evidence-file-unreadable': 'error',
  'evidence-kind-unknown': 'error',
  'evidence-module-unloadable': 'error',
  'evidence-not-found': 'error',
  'evidence-path-escapes-root': 'error',
  'evidence-unverifiable': 'warning',
  'lower-rung-available': 'error',
  'no-candidate-fully-covers': 'info',
  'no-candidates': 'warning',
  'proposal-unverified': 'info',
  'savings-measured': 'info',
  'time-budget-exceeded': 'error',
  'too-many-candidates': 'error',
  'too-many-criteria': 'error',
  'too-many-evidence': 'error',
  'unsourced-savings-claim': 'error',
  'worksheet-malformed': 'error',
  'worksheet-not-json': 'error',
  'worksheet-not-utf8': 'error',
  'worksheet-schema-unsupported': 'error',
  'worksheet-too-large': 'error',
  'worksheet-unknown-key': 'error',
  'worksheet-unreadable': 'error',
})

/**
 * Rules that mean evidence was not obtained.
 *
 * Any one of these forces `status: "incomplete"`, withdraws the recommendation,
 * and exits 2 -- whatever else the run found. Most are `error` severity, so it
 * would be easy to believe severity alone does the work. It does not: without
 * this flag the run would report `fail` and exit 1, claiming a verdict about
 * material it never read. And `evidence-unverifiable` and `no-candidates` are
 * `warning`s, so there the flag is the *only* thing standing between an
 * unchecked ladder and a green build.
 */
export const INCOMPLETE_RULES = Object.freeze([
  'candidate-duplicate-id',
  'candidate-malformed',
  'candidate-rung-unknown',
  'candidate-unknown-key',
  'criterion-unknown',
  'evidence-file-not-json',
  'evidence-file-not-utf8',
  'evidence-file-too-large',
  'evidence-file-unreadable',
  'evidence-kind-unknown',
  'evidence-module-unloadable',
  'evidence-path-escapes-root',
  'evidence-unverifiable',
  'no-candidates',
  'time-budget-exceeded',
  'too-many-candidates',
  'too-many-criteria',
  'too-many-evidence',
  'worksheet-malformed',
  'worksheet-not-json',
  'worksheet-not-utf8',
  'worksheet-schema-unsupported',
  'worksheet-too-large',
  'worksheet-unknown-key',
  'worksheet-unreadable',
])

const INCOMPLETE_SET = new Set(INCOMPLETE_RULES)
const ALLOWED_CONFIG_KEYS = Object.freeze(['limits', 'schemaVersion'])

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * The documented sort key, exported so a test can pin each half of it.
 *
 * `message` and `evidence` are the fourth and fifth keys because the first
 * three do not separate every row: one candidate can carry several unreadable
 * evidence files, and two unknown keys on one candidate share a pointer prefix.
 * Without the extra keys those rows tie, and their order falls back to whichever
 * loop inserted them -- an ordering no reader of this function can see and no
 * test of it can pin.
 */
export function compareFindingRows(left, right) {
  return byCodeUnit(left.location.file, right.location.file)
    || byCodeUnit(left.location.pointer ?? '', right.location.pointer ?? '')
    || byCodeUnit(left.ruleId, right.ruleId)
    || byCodeUnit(left.message, right.message)
    || byCodeUnit(left.evidence ?? '', right.evidence ?? '')
}

export function validateLimits(overrides = {}) {
  if (!isRecord(overrides)) throw new TypeError('Limits must be an object')
  const limits = { ...DEFAULT_LIMITS }
  for (const [name, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, name)) throw new TypeError(`Unknown limit "${sanitize(name, 60)}"`)
    const minimum = name === 'timeoutMs' ? 0 : 1
    if (!Number.isInteger(value) || value < minimum) {
      throw new TypeError(`Limit "${name}" must be an integer of ${minimum} or more`)
    }
    limits[name] = value
  }
  return Object.freeze(limits)
}

/**
 * Validate a parsed configuration document.
 *
 * An unknown key is refused. Accepting `limits: { maxCandidate: 1 }` next to the
 * real `maxCandidates` would leave the real limit at its default while the
 * operator believed otherwise, which is how a documented limit ends up never
 * enforced.
 */
export function validateConfig(config) {
  if (!isRecord(config)) throw new TypeError('Configuration must be a JSON object')
  if (config.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new TypeError(`Unsupported configuration schemaVersion: ${sanitize(config.schemaVersion ?? 'missing', 40)}`)
  }
  for (const key of Object.keys(config)) {
    if (!ALLOWED_CONFIG_KEYS.includes(key)) {
      throw new TypeError(`Unknown configuration key "${sanitize(key, 60)}"; this tool accepts ${ALLOWED_CONFIG_KEYS.join(', ')}`)
    }
  }
  return Object.freeze({ limits: validateLimits(config.limits ?? {}) })
}

/**
 * Read and validate a configuration file.
 *
 * Decoded with the same strict decoder as the worksheet. A tool that hardens its
 * data path and leaves its own configuration path lossy has moved the hole, not
 * closed it.
 */
export async function loadConfigFile(path) {
  let bytes
  try {
    bytes = await readFile(resolve(path))
  } catch (error) {
    throw new TypeError(`Configuration file could not be read: ${error.code ?? 'unreadable'}`)
  }
  const decoded = decodeUtf8(bytes)
  if (!decoded.ok) throw new TypeError('Configuration file is not valid UTF-8')
  let parsed
  try {
    parsed = JSON.parse(decoded.text)
  } catch (error) {
    throw new TypeError(`Configuration file is not valid JSON: ${sanitize(parseFailureDetail(error), 120)}`)
  }
  return validateConfig(parsed)
}

/**
 * The real path of `path`, or the closest thing to it that exists.
 *
 * `realpath` fails outright on a file that is not there, which is precisely the
 * case a report has to describe, so the containing directory is resolved
 * instead and the name appended. Resolving matters even when nothing is
 * missing: on macOS the temporary directory is reached through `/var`, which is
 * a symbolic link to `/private/var`, so a lexical comparison of an unresolved
 * worksheet path against a resolved root finds the worksheet "outside" a root
 * that contains it.
 */
async function realOrNearest(path) {
  try {
    return await realpath(path)
  } catch {
    // fall through to the directory
  }
  try {
    return join(await realpath(dirname(path)), basename(path))
  } catch {
    return resolve(path)
  }
}

function makeFinding(ruleId, message, location, extra = {}) {
  const severity = RULE_SEVERITY[ruleId]
  if (severity === undefined) throw new TypeError(`Unknown rule id "${ruleId}"`)
  const pointer = location.pointer === undefined || location.pointer === '' ? undefined : location.pointer
  return {
    ruleId,
    severity,
    message,
    location: pointer === undefined ? { file: location.file } : { file: location.file, pointer },
    ...extra,
  }
}

/**
 * Walk the ladder over one worksheet.
 *
 * `clock` and `loadBuiltin` are injected and default to `Date.now` and a real
 * dynamic `import`. `clock` is used for one thing --
 * deciding whether the time budget has expired -- and no reading of it ever
 * reaches the report, so a run in June and a run in December over the same
 * worksheet emit the same bytes. Injecting it is also the only way a test can
 * step a fake clock past the deadline and watch the loop stop.
 */
export async function runLadder(options = {}) {
  const allowed = ['clock', 'limits', 'loadBuiltin', 'root', 'worksheet']
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) throw new TypeError(`Unknown option "${sanitize(key, 60)}"`)
  }
  const {
    worksheet: worksheetPath, clock = Date.now, limits: limitOverrides = {}, loadBuiltin = importBuiltin,
  } = options
  if (typeof worksheetPath !== 'string' || worksheetPath.length === 0) {
    throw new TypeError('A worksheet path is required')
  }
  if (typeof clock !== 'function') throw new TypeError('clock must be a function returning milliseconds')
  const limits = validateLimits(limitOverrides)

  const worksheetFull = await realOrNearest(resolve(worksheetPath))
  const rootPath = options.root === undefined || options.root === null ? dirname(worksheetFull) : options.root
  let realRoot
  try {
    realRoot = await realpath(resolve(rootPath))
  } catch {
    throw new TypeError(`The root directory could not be resolved: ${sanitize(rootPath, 120)}`)
  }
  if (!isInside(realRoot, worksheetFull)) {
    throw new TypeError('The worksheet must be inside the root; the root is the boundary of what this run may read.')
  }
  const worksheetFile = relativePosix(realRoot, worksheetFull)

  const findings = []
  /**
   * The read cache lives for exactly one run.
   *
   * It is created here rather than at module scope so a worksheet citing one
   * file ten times opens it once, while two runs in the same process never share
   * a single byte: a cache that outlived a run would let one worksheet's file
   * contents answer another worksheet's question, and would make the second run
   * blind to a file that changed in between.
   */
  const cache = new Map()
  let subject = null
  const deadline = clock() + limits.timeoutMs
  const expired = () => clock() >= deadline

  const finish = (summaryExtra, recommendation) => {
    findings.sort(compareFindingRows)
    const counts = { error: 0, warning: 0, info: 0 }
    let incomplete = false
    for (const finding of findings) {
      counts[finding.severity] += 1
      if (INCOMPLETE_SET.has(finding.ruleId)) incomplete = true
    }
    const status = incomplete ? 'incomplete' : counts.error > 0 ? 'fail' : 'pass'
    return {
      schemaVersion: REPORT_SCHEMA_VERSION,
      tool: TOOL_ID,
      status,
      subject,
      summary: {
        checked: 0,
        candidates: 0,
        criteria: 0,
        verified: 0,
        refuted: 0,
        unexamined: 0,
        ...summaryExtra,
        errors: counts.error,
        warnings: counts.warning,
        info: counts.info,
      },
      // A recommendation is a claim about evidence. A run that did not obtain
      // its evidence has no claim to make, so an incomplete run carries none
      // whatever was verified before the gap appeared.
      recommendation: status === 'incomplete' ? null : recommendation,
      findings,
    }
  }

  let info
  try {
    info = await stat(worksheetFull)
  } catch (error) {
    findings.push(makeFinding(
      'worksheet-unreadable',
      `The worksheet could not be inspected (${sanitize(error.code ?? 'unreadable', 40)}), so no rung was checked.`,
      { file: worksheetFile },
    ))
    return finish({ unexamined: 1 }, null)
  }
  if (!info.isFile()) {
    findings.push(makeFinding(
      'worksheet-unreadable',
      'The worksheet path is not a regular file, so no rung was checked.',
      { file: worksheetFile },
    ))
    return finish({ unexamined: 1 }, null)
  }
  if (info.size > limits.maxWorksheetBytes) {
    findings.push(makeFinding(
      'worksheet-too-large',
      `The worksheet is ${info.size} bytes, over the limit of ${limits.maxWorksheetBytes}. It was not read.`,
      { file: worksheetFile },
    ))
    return finish({ unexamined: 1 }, null)
  }

  let bytes
  try {
    bytes = await readFile(worksheetFull)
  } catch (error) {
    findings.push(makeFinding(
      'worksheet-unreadable',
      `The worksheet could not be read (${sanitize(error.code ?? 'unreadable', 40)}), so no rung was checked.`,
      { file: worksheetFile },
    ))
    return finish({ unexamined: 1 }, null)
  }
  const decoded = decodeUtf8(bytes)
  if (!decoded.ok) {
    findings.push(makeFinding(
      'worksheet-not-utf8',
      'The worksheet is not valid UTF-8. Encoding is decided by the decoder, never inferred from decoded text.',
      { file: worksheetFile },
    ))
    return finish({ unexamined: 1 }, null)
  }
  let document
  try {
    document = JSON.parse(decoded.text)
  } catch (error) {
    findings.push(makeFinding(
      'worksheet-not-json',
      `The worksheet is not valid JSON: ${sanitize(parseFailureDetail(error), 120)}`,
      { file: worksheetFile },
    ))
    return finish({ unexamined: 1 }, null)
  }

  const { worksheet, problems } = validateWorksheet(document, limits)
  for (const problem of problems) {
    findings.push(makeFinding(
      problem.ruleId,
      problem.message,
      { file: worksheetFile, pointer: problem.pointer },
      problem.evidence === undefined ? {} : { evidence: problem.evidence },
    ))
  }
  if (worksheet === null) return finish({ unexamined: problems.length }, null)

  const criterionIds = worksheet.requirement.criteria.map((criterion) => criterion.id)
  subject = Object.freeze({
    requirement: sanitize(worksheet.requirement.id, 64),
    statement: sanitize(worksheet.requirement.statement, 200),
    proposedRung: worksheet.proposed.rung,
    criteria: Object.freeze(criterionIds.map((id) => sanitize(id, 64))),
  })
  const base = { candidates: worksheet.candidates.length, criteria: criterionIds.length }

  if (worksheet.candidates.length === 0) {
    findings.push(makeFinding(
      'no-candidates',
      'The worksheet lists no candidates, so no rung of the ladder was checked. An empty ladder is not a small solution; it is an unchecked one.',
      { file: worksheetFile, pointer: '/candidates' },
    ))
    return finish({ ...base, unexamined: 1 }, null)
  }

  let verifiedCount = 0
  let refutedCount = 0
  let unexamined = 0
  let timedOut = false
  const assessments = []

  for (const [index, candidate] of worksheet.candidates.entries()) {
    const pointer = `/candidates/${index}`
    const results = []
    let blocked = false

    const record = async (item, itemPointer, purpose) => {
      if (expired()) {
        timedOut = true
        return null
      }
      const result = await checkEvidence(item, { realRoot, limits, cache, load: loadBuiltin })
      const file = result.file ?? worksheetFile
      if (result.state === 'verified') {
        verifiedCount += 1
        return result
      }
      if (result.state === 'refuted') {
        refutedCount += 1
        findings.push(makeFinding(
          'evidence-not-found',
          `Candidate "${sanitize(candidate.id, 64)}" rests ${purpose} on evidence that is not there: ${result.detail}.`,
          { file, pointer: itemPointer },
          { evidence: sanitize(JSON.stringify(describeEvidence(item)), 160) },
        ))
        return result
      }
      unexamined += 1
      findings.push(makeFinding(
        result.ruleId,
        `Candidate "${sanitize(candidate.id, 64)}" cites evidence this run could not obtain: ${result.detail}. Unobtained evidence is not the same as a rung that does not apply.`,
        { file, pointer: itemPointer },
        { evidence: sanitize(JSON.stringify(describeEvidence(item)), 160) },
      ))
      return result
    }

    for (const [position, item] of candidate.evidence.entries()) {
      const result = await record(item, `${pointer}/evidence/${position}`, 'for its coverage claim')
      if (result === null) {
        blocked = true
        break
      }
      results.push(result)
    }

    let savings = null
    if (candidate.savings !== null && !timedOut) {
      if (candidate.savings.measurement === null) {
        findings.push(makeFinding(
          'unsourced-savings-claim',
          `Candidate "${sanitize(candidate.id, 64)}" asserts a saving with ${candidate.savings.prose ? 'a prose note instead of a measurement' : 'no measurement at all'}. This tool does not repeat an unmeasured number and does not invent one.`,
          { file: worksheetFile, pointer: `${pointer}/savings` },
          { evidence: sanitize(candidate.savings.claim, 160) },
        ))
      } else {
        const result = await record(candidate.savings.measurement, `${pointer}/savings/measurement`, 'its savings claim')
        if (result === null) blocked = true
        else if (result.state === 'verified') {
          savings = {
            claim: sanitize(candidate.savings.claim, 160),
            measurement: describeEvidence(candidate.savings.measurement),
          }
          findings.push(makeFinding(
            'savings-measured',
            `Candidate "${sanitize(candidate.id, 64)}" measured its savings claim: ${result.detail}. The claim is the worksheet's, reported with what backs it.`,
            { file: worksheetFile, pointer: `${pointer}/savings` },
            { evidence: sanitize(candidate.savings.claim, 160) },
          ))
        }
      }
    }

    if (blocked || timedOut) break

    const missing = criterionIds.filter((id) => !candidate.satisfies.includes(id))
    if (missing.length > 0) {
      findings.push(makeFinding(
        'criteria-uncovered',
        `Candidate "${sanitize(candidate.id, 64)}" on rung "${candidate.rung}" does not claim ${missing.length} of ${criterionIds.length} criteria, so it cannot replace the proposal on its own.`,
        { file: worksheetFile, pointer: `${pointer}/satisfies` },
        { evidence: sanitize(missing.map((id) => sanitize(id, 64)).join(', '), 160) },
      ))
    }

    const allVerified = results.every((result) => result.state === 'verified')
    assessments.push({
      id: candidate.id,
      rung: candidate.rung,
      index,
      covers: missing.length === 0 && allVerified,
      evidence: candidate.evidence.map((item) => describeEvidence(item)),
      savings,
    })
  }

  if (timedOut) {
    findings.push(makeFinding(
      'time-budget-exceeded',
      `The time budget of ${limits.timeoutMs}ms expired while checking evidence, so the rungs after that point were never checked and nothing verified before it is credited.`,
      { file: worksheetFile },
    ))
    return finish({ ...base, checked: assessments.length, verified: verifiedCount, refuted: refutedCount, unexamined: unexamined + 1 }, null)
  }

  const covering = assessments
    .filter((assessment) => assessment.covers)
    .sort((left, right) => RUNG_INDEX[left.rung] - RUNG_INDEX[right.rung] || byCodeUnit(left.id, right.id))

  const proposedIndex = RUNG_INDEX[worksheet.proposed.rung]
  let recommendation = null

  if (covering.length === 0) {
    findings.push(makeFinding(
      'no-candidate-fully-covers',
      `No candidate covered all ${criterionIds.length} criteria with evidence this run verified. That is a record of what this run checked, not an endorsement of the proposal on rung "${worksheet.proposed.rung}".`,
      { file: worksheetFile, pointer: '/candidates' },
    ))
  } else {
    const best = covering[0]
    const bestIndex = RUNG_INDEX[best.rung]
    recommendation = {
      rung: best.rung,
      candidateId: sanitize(best.id, 64),
      proposedRung: worksheet.proposed.rung,
      lowerThanProposed: bestIndex < proposedIndex,
      criteriaCovered: criterionIds.length,
      evidence: best.evidence,
      savings: best.savings,
    }
    if (bestIndex < proposedIndex) {
      findings.push(makeFinding(
        'lower-rung-available',
        `Rung "${best.rung}" already covers all ${criterionIds.length} criteria through candidate "${sanitize(best.id, 64)}", which this run verified. The proposal is on rung "${worksheet.proposed.rung}", ${proposedIndex - bestIndex} rung(s) further up the ladder.`,
        { file: worksheetFile, pointer: `/candidates/${best.index}` },
        { evidence: sanitize(JSON.stringify(best.evidence), 160) },
      ))
    } else if (bestIndex > proposedIndex) {
      findings.push(makeFinding(
        'proposal-unverified',
        `The proposal claims rung "${worksheet.proposed.rung}", but the lowest rung any candidate verifiably reached is "${best.rung}". Nothing here refutes the proposal; nothing here supports it either.`,
        { file: worksheetFile, pointer: '/proposed/rung' },
      ))
    }
  }

  return finish({
    ...base,
    checked: assessments.length,
    verified: verifiedCount,
    refuted: refutedCount,
    unexamined,
  }, recommendation)
}

export function formatReport(report) {
  const lines = report.findings.map((finding) =>
    `${finding.severity.toUpperCase().padEnd(7)} ${finding.location.file}${finding.location.pointer ?? ''} ${finding.ruleId} ${finding.message}`)
  lines.push('')
  lines.push(
    `${report.summary.checked} of ${report.summary.candidates} candidate(s) checked against ${report.summary.criteria} criterion(a): `
    + `${report.summary.verified} evidence item(s) verified, ${report.summary.refuted} refuted, ${report.summary.unexamined} not obtained. `
    + `${report.summary.errors} error, ${report.summary.warnings} warning, ${report.summary.info} info, status ${report.status}.`,
  )
  if (report.recommendation === null) {
    lines.push(
      report.status === 'incomplete'
        ? 'No recommendation: this run did not obtain all the evidence it was given, so it has no claim to make.'
        : `No smaller rung was verified; the proposal on rung "${report.subject === null ? 'unknown' : report.subject.proposedRung}" stands.`,
    )
  } else {
    lines.push(
      `Recommended rung: "${report.recommendation.rung}" via candidate "${report.recommendation.candidateId}" `
      + `(proposed "${report.recommendation.proposedRung}")${report.recommendation.lowerThanProposed ? ' -- smaller than what was proposed.' : '.'}`,
    )
    for (const item of report.recommendation.evidence) {
      lines.push(`  evidence: ${Object.entries(item).map(([key, value]) => `${key}=${value}`).join(' ')}`)
    }
    if (report.recommendation.savings !== null) {
      lines.push(`  the worksheet's savings claim, with the measurement behind it: ${report.recommendation.savings.claim}`)
    }
  }
  return `${lines.join('\n')}\n`
}

/** The ladder, in order, for a caller that wants to render it. */
export const LADDER = RUNGS

export const SUPPORTED = Object.freeze({
  worksheetKeys: WORKSHEET_KEYS,
  candidateKeys: CANDIDATE_KEYS,
  evidenceKinds: EVIDENCE_KINDS,
  verifiableKinds: VERIFIABLE_KINDS,
  idPattern: ID_PATTERN.source,
  schemaVersion: WORKSHEET_SCHEMA_VERSION,
})
