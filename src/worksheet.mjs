/**
 * The worksheet schema, validated by hand.
 *
 * By hand because this package has no dependencies, not because hand-rolling is
 * better than a schema compiler: the approach follows JSON Schema's habit of
 * refusing an unknown keyword rather than ignoring it, and nothing is installed.
 * A one-character typo in a key must not turn a real failure into a green run,
 * so every unknown key is refused at every level.
 *
 * Validation collects *every* problem it finds rather than throwing on the
 * first, because a worksheet with three broken candidates should be repaired
 * once. Each problem carries the rule id the report will use and a JSON Pointer
 * into the document.
 */

import { sanitize } from './text.mjs'

/**
 * The ladder, smallest first.
 *
 * The order is the whole tool: index 0 is "the behaviour you want already
 * happens", index 6 is "write something new". A recommendation is the
 * lowest-index rung that a candidate *verifiably* reaches, and a proposal sitting
 * above one of those is the finding this tool exists to emit.
 */
export const RUNGS = Object.freeze([
  'no-change',
  'project-reuse',
  'standard-library',
  'platform-native',
  'installed-dependency',
  'local-edit',
  'new-machinery',
])

export const RUNG_INDEX = Object.freeze(Object.fromEntries(RUNGS.map((rung, index) => [rung, index])))

export const WORKSHEET_SCHEMA_VERSION = '1'

/** Kinds of evidence this tool can check for itself. `assertion` is deliberately not one. */
export const VERIFIABLE_KINDS = Object.freeze(['builtin', 'dependency', 'source'])
export const EVIDENCE_KINDS = Object.freeze(['assertion', ...VERIFIABLE_KINDS])

export const WORKSHEET_KEYS = Object.freeze(['candidates', 'proposed', 'requirement', 'schemaVersion'])
export const REQUIREMENT_KEYS = Object.freeze(['criteria', 'id', 'statement'])
export const CRITERION_KEYS = Object.freeze(['id', 'statement'])
export const PROPOSED_KEYS = Object.freeze(['rung', 'summary'])
export const CANDIDATE_KEYS = Object.freeze(['evidence', 'id', 'rung', 'satisfies', 'savings', 'summary'])
export const SAVINGS_KEYS = Object.freeze(['claim', 'measurement'])
export const EVIDENCE_KEYS = Object.freeze({
  assertion: Object.freeze(['kind', 'note']),
  builtin: Object.freeze(['export', 'kind', 'module']),
  dependency: Object.freeze(['file', 'kind', 'name']),
  source: Object.freeze(['contains', 'file', 'kind']),
})

/**
 * Identifiers are constrained, and the constraint is load-bearing.
 *
 * An id becomes a JSON Pointer segment, a line in the human report and a key in
 * the recommendation. Everything that reaches output is sanitised anyway, but an
 * id is also how a reader matches the report back to the worksheet, so a name
 * that renders as something else is refused outright rather than quietly
 * rewritten.
 */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

const MAX_TEXT = 400
const MAX_CONTAINS = 200

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isText(value, max = MAX_TEXT) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
}

/**
 * A relative path that stays inside the tree, checked lexically here.
 *
 * Lexical rejection is not confinement -- a symlink planted inside the root
 * spells nothing suspicious -- so the real check happens in `index.mjs` against
 * the resolved root. This one exists so an obviously absolute or climbing path
 * is named as a schema problem rather than reaching the filesystem at all.
 */
function isRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 240
    && !value.startsWith('/')
    && !/^[A-Za-z]:/.test(value)
    && !value.split(/[/\\]/).includes('..')
}

function unknownKeys(record, allowed) {
  return Object.keys(record).filter((key) => !allowed.includes(key)).sort()
}

function validateEvidenceItem(item, pointer, problems, { allowAssertion = true } = {}) {
  if (!isRecord(item)) {
    problems.push({ ruleId: 'candidate-malformed', message: 'Evidence must be an object.', pointer })
    return null
  }
  if (typeof item.kind !== 'string' || !EVIDENCE_KINDS.includes(item.kind)) {
    problems.push({
      ruleId: 'evidence-kind-unknown',
      message: `Evidence kind must be one of ${EVIDENCE_KINDS.join(', ')}.`,
      pointer: `${pointer}/kind`,
      evidence: sanitize(String(item.kind ?? 'missing'), 60),
    })
    return null
  }
  if (!allowAssertion && item.kind === 'assertion') {
    // Reported by the caller as unsourced-savings-claim; nothing to add here.
    return null
  }

  const allowed = EVIDENCE_KEYS[item.kind]
  for (const key of unknownKeys(item, allowed)) {
    problems.push({
      ruleId: 'candidate-unknown-key',
      message: `Evidence of kind "${item.kind}" accepts ${allowed.join(', ')}.`,
      pointer: `${pointer}/${key}`,
      evidence: sanitize(key, 60),
    })
  }

  const bad = (field, message) => {
    problems.push({ ruleId: 'candidate-malformed', message, pointer: `${pointer}/${field}` })
  }

  if (item.kind === 'assertion') {
    if (!isText(item.note)) bad('note', 'An assertion needs a non-empty "note" of at most 400 characters.')
    return isText(item.note) ? Object.freeze({ kind: 'assertion', note: item.note }) : null
  }
  if (item.kind === 'source') {
    let ok = true
    if (!isRelativePath(item.file)) {
      ok = false
      bad('file', 'A source evidence "file" must be a relative path inside the root, with no ".." segment.')
    }
    if (!isText(item.contains, MAX_CONTAINS)) {
      ok = false
      bad('contains', 'A source evidence needs a non-empty "contains" string of at most 200 characters.')
    }
    return ok ? Object.freeze({ kind: 'source', file: item.file, contains: item.contains }) : null
  }
  if (item.kind === 'dependency') {
    let ok = true
    if (!isRelativePath(item.file)) {
      ok = false
      bad('file', 'A dependency evidence "file" must be a relative path inside the root, with no ".." segment.')
    }
    if (!isText(item.name, 120)) {
      ok = false
      bad('name', 'A dependency evidence needs a non-empty "name" of at most 120 characters.')
    }
    return ok ? Object.freeze({ kind: 'dependency', file: item.file, name: item.name }) : null
  }
  let ok = true
  if (!isText(item.module, 120)) {
    ok = false
    bad('module', 'A builtin evidence needs a non-empty "module" of at most 120 characters.')
  }
  if (!isText(item.export, 120)) {
    ok = false
    bad('export', 'A builtin evidence needs a non-empty "export" of at most 120 characters.')
  }
  return ok ? Object.freeze({ kind: 'builtin', module: item.module, export: item.export }) : null
}

function validateSavings(savings, pointer, problems) {
  if (savings === undefined || savings === null) return null
  if (!isRecord(savings)) {
    problems.push({ ruleId: 'candidate-malformed', message: '"savings" must be an object.', pointer })
    return null
  }
  for (const key of unknownKeys(savings, SAVINGS_KEYS)) {
    problems.push({
      ruleId: 'candidate-unknown-key',
      message: `"savings" accepts ${SAVINGS_KEYS.join(', ')}.`,
      pointer: `${pointer}/${key}`,
      evidence: sanitize(key, 60),
    })
  }
  if (!isText(savings.claim)) {
    problems.push({
      ruleId: 'candidate-malformed',
      message: '"savings" needs a non-empty "claim" of at most 400 characters.',
      pointer: `${pointer}/claim`,
    })
    return null
  }

  /**
   * A claim with no measurement, or one backed only by prose, is refused rather
   * than repeated.
   *
   * This is the rule that keeps invented numbers out. "Reusing the platform
   * feature saves 80% of the work" is a sentence anybody can write; a
   * measurement is a file this tool can open. The claim text still reaches the
   * report, but only as bounded evidence attributed to the worksheet -- never as
   * something this tool concluded.
   */
  const measurement = savings.measurement === undefined || savings.measurement === null
    ? null
    : validateEvidenceItem(savings.measurement, `${pointer}/measurement`, problems, { allowAssertion: false })

  return Object.freeze({
    claim: savings.claim,
    measurement,
    prose: isRecord(savings.measurement) && savings.measurement.kind === 'assertion',
  })
}

function validateCandidate(candidate, index, criterionIds, problems, limits) {
  const pointer = `/candidates/${index}`
  if (!isRecord(candidate)) {
    problems.push({ ruleId: 'candidate-malformed', message: 'A candidate must be an object.', pointer })
    return null
  }
  for (const key of unknownKeys(candidate, CANDIDATE_KEYS)) {
    problems.push({
      ruleId: 'candidate-unknown-key',
      message: `A candidate accepts ${CANDIDATE_KEYS.join(', ')}.`,
      pointer: `${pointer}/${key}`,
      evidence: sanitize(key, 60),
    })
  }

  let ok = true
  if (typeof candidate.id !== 'string' || !ID_PATTERN.test(candidate.id)) {
    ok = false
    problems.push({
      ruleId: 'candidate-malformed',
      message: 'A candidate "id" must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}.',
      pointer: `${pointer}/id`,
      evidence: sanitize(String(candidate.id ?? 'missing'), 60),
    })
  }
  if (typeof candidate.rung !== 'string' || !RUNGS.includes(candidate.rung)) {
    ok = false
    problems.push({
      ruleId: 'candidate-rung-unknown',
      message: `A candidate "rung" must be one of ${RUNGS.join(', ')}.`,
      pointer: `${pointer}/rung`,
      evidence: sanitize(String(candidate.rung ?? 'missing'), 60),
    })
  }
  if (!isText(candidate.summary)) {
    ok = false
    problems.push({
      ruleId: 'candidate-malformed',
      message: 'A candidate needs a non-empty "summary" of at most 400 characters.',
      pointer: `${pointer}/summary`,
    })
  }

  const satisfies = []
  if (!Array.isArray(candidate.satisfies) || candidate.satisfies.length === 0) {
    ok = false
    problems.push({
      ruleId: 'candidate-malformed',
      message: 'A candidate needs a non-empty "satisfies" array of criterion ids.',
      pointer: `${pointer}/satisfies`,
    })
  } else {
    candidate.satisfies.forEach((id, position) => {
      if (typeof id !== 'string' || !criterionIds.includes(id)) {
        ok = false
        problems.push({
          ruleId: 'criterion-unknown',
          message: 'A candidate claims a criterion the requirement does not list, so what it covers cannot be judged.',
          pointer: `${pointer}/satisfies/${position}`,
          evidence: sanitize(String(id ?? 'missing'), 60),
        })
      } else if (satisfies.includes(id)) {
        ok = false
        problems.push({
          ruleId: 'candidate-malformed',
          message: 'A candidate lists the same criterion twice.',
          pointer: `${pointer}/satisfies/${position}`,
          evidence: sanitize(id, 60),
        })
      } else satisfies.push(id)
    })
  }

  const evidence = []
  if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0) {
    ok = false
    problems.push({
      ruleId: 'candidate-malformed',
      message: 'A candidate needs a non-empty "evidence" array. A rung nobody evidenced was not checked.',
      pointer: `${pointer}/evidence`,
    })
  } else if (candidate.evidence.length > limits.maxEvidencePerCandidate) {
    ok = false
    problems.push({
      ruleId: 'too-many-evidence',
      message: `A candidate carries ${candidate.evidence.length} evidence items, over the limit of ${limits.maxEvidencePerCandidate}.`,
      pointer: `${pointer}/evidence`,
    })
  } else {
    candidate.evidence.forEach((item, position) => {
      const validated = validateEvidenceItem(item, `${pointer}/evidence/${position}`, problems)
      if (validated === null) ok = false
      else evidence.push(validated)
    })
  }

  const savings = validateSavings(candidate.savings, `${pointer}/savings`, problems)

  if (!ok) return null
  return Object.freeze({
    id: candidate.id,
    rung: candidate.rung,
    summary: candidate.summary,
    satisfies: Object.freeze(satisfies),
    evidence: Object.freeze(evidence),
    savings,
  })
}

/**
 * Validate a parsed worksheet document.
 *
 * Returns `{ worksheet, problems }`. `worksheet` is null whenever anything the
 * ladder depends on is missing, and a null worksheet is an `incomplete` run:
 * a document this tool could not interpret is evidence it did not obtain, not a
 * verdict about the change being proposed.
 */
export function validateWorksheet(document, limits) {
  const problems = []
  if (!isRecord(document)) {
    problems.push({ ruleId: 'worksheet-malformed', message: 'The worksheet must be a JSON object.', pointer: '' })
    return { worksheet: null, problems }
  }
  if (document.schemaVersion !== WORKSHEET_SCHEMA_VERSION) {
    problems.push({
      ruleId: 'worksheet-schema-unsupported',
      message: `This tool reads worksheet schemaVersion "${WORKSHEET_SCHEMA_VERSION}".`,
      pointer: '/schemaVersion',
      evidence: sanitize(String(document.schemaVersion ?? 'missing'), 40),
    })
    return { worksheet: null, problems }
  }
  for (const key of unknownKeys(document, WORKSHEET_KEYS)) {
    problems.push({
      ruleId: 'worksheet-unknown-key',
      message: `A worksheet accepts ${WORKSHEET_KEYS.join(', ')}.`,
      pointer: `/${key}`,
      evidence: sanitize(key, 60),
    })
  }

  let fatal = problems.length > 0

  const requirement = document.requirement
  const criterionIds = []
  let criteria = []
  if (!isRecord(requirement)) {
    fatal = true
    problems.push({ ruleId: 'worksheet-malformed', message: '"requirement" must be an object.', pointer: '/requirement' })
  } else {
    for (const key of unknownKeys(requirement, REQUIREMENT_KEYS)) {
      fatal = true
      problems.push({
        ruleId: 'worksheet-unknown-key',
        message: `"requirement" accepts ${REQUIREMENT_KEYS.join(', ')}.`,
        pointer: `/requirement/${key}`,
        evidence: sanitize(key, 60),
      })
    }
    if (typeof requirement.id !== 'string' || !ID_PATTERN.test(requirement.id)) {
      fatal = true
      problems.push({
        ruleId: 'worksheet-malformed',
        message: 'The requirement "id" must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}.',
        pointer: '/requirement/id',
        evidence: sanitize(String(requirement.id ?? 'missing'), 60),
      })
    }
    if (!isText(requirement.statement)) {
      fatal = true
      problems.push({
        ruleId: 'worksheet-malformed',
        message: 'The requirement needs a non-empty "statement" of at most 400 characters.',
        pointer: '/requirement/statement',
      })
    }
    if (!Array.isArray(requirement.criteria) || requirement.criteria.length === 0) {
      fatal = true
      problems.push({
        ruleId: 'worksheet-malformed',
        message: 'The requirement needs a non-empty "criteria" array. Coverage of nothing cannot be judged.',
        pointer: '/requirement/criteria',
      })
    } else if (requirement.criteria.length > limits.maxCriteria) {
      fatal = true
      problems.push({
        ruleId: 'too-many-criteria',
        message: `The requirement lists ${requirement.criteria.length} criteria, over the limit of ${limits.maxCriteria}.`,
        pointer: '/requirement/criteria',
      })
    } else {
      requirement.criteria.forEach((criterion, index) => {
        const pointer = `/requirement/criteria/${index}`
        if (!isRecord(criterion)) {
          fatal = true
          problems.push({ ruleId: 'worksheet-malformed', message: 'A criterion must be an object.', pointer })
          return
        }
        for (const key of unknownKeys(criterion, CRITERION_KEYS)) {
          fatal = true
          problems.push({
            ruleId: 'worksheet-unknown-key',
            message: `A criterion accepts ${CRITERION_KEYS.join(', ')}.`,
            pointer: `${pointer}/${key}`,
            evidence: sanitize(key, 60),
          })
        }
        if (typeof criterion.id !== 'string' || !ID_PATTERN.test(criterion.id)) {
          fatal = true
          problems.push({
            ruleId: 'worksheet-malformed',
            message: 'A criterion "id" must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}.',
            pointer: `${pointer}/id`,
            evidence: sanitize(String(criterion.id ?? 'missing'), 60),
          })
          return
        }
        if (criterionIds.includes(criterion.id)) {
          fatal = true
          problems.push({
            ruleId: 'worksheet-malformed',
            message: 'Two criteria share an id, so coverage of either one is ambiguous.',
            pointer: `${pointer}/id`,
            evidence: sanitize(criterion.id, 60),
          })
          return
        }
        if (!isText(criterion.statement)) {
          fatal = true
          problems.push({
            ruleId: 'worksheet-malformed',
            message: 'A criterion needs a non-empty "statement" of at most 400 characters.',
            pointer: `${pointer}/statement`,
          })
          return
        }
        criterionIds.push(criterion.id)
        criteria.push(Object.freeze({ id: criterion.id, statement: criterion.statement }))
      })
    }
  }

  const proposed = document.proposed
  let proposedValue = null
  if (!isRecord(proposed)) {
    fatal = true
    problems.push({ ruleId: 'worksheet-malformed', message: '"proposed" must be an object.', pointer: '/proposed' })
  } else {
    for (const key of unknownKeys(proposed, PROPOSED_KEYS)) {
      fatal = true
      problems.push({
        ruleId: 'worksheet-unknown-key',
        message: `"proposed" accepts ${PROPOSED_KEYS.join(', ')}.`,
        pointer: `/proposed/${key}`,
        evidence: sanitize(key, 60),
      })
    }
    if (typeof proposed.rung !== 'string' || !RUNGS.includes(proposed.rung)) {
      fatal = true
      problems.push({
        ruleId: 'worksheet-malformed',
        message: `The proposed "rung" must be one of ${RUNGS.join(', ')}.`,
        pointer: '/proposed/rung',
        evidence: sanitize(String(proposed.rung ?? 'missing'), 60),
      })
    } else if (!isText(proposed.summary)) {
      fatal = true
      problems.push({
        ruleId: 'worksheet-malformed',
        message: 'The proposal needs a non-empty "summary" of at most 400 characters.',
        pointer: '/proposed/summary',
      })
    } else proposedValue = Object.freeze({ rung: proposed.rung, summary: proposed.summary })
  }

  const candidates = []
  if (!Array.isArray(document.candidates)) {
    fatal = true
    problems.push({ ruleId: 'worksheet-malformed', message: '"candidates" must be an array.', pointer: '/candidates' })
  } else if (document.candidates.length > limits.maxCandidates) {
    fatal = true
    problems.push({
      ruleId: 'too-many-candidates',
      message: `The worksheet lists ${document.candidates.length} candidates, over the limit of ${limits.maxCandidates}.`,
      pointer: '/candidates',
    })
  } else {
    const seen = new Set()
    document.candidates.forEach((candidate, index) => {
      const validated = validateCandidate(candidate, index, criterionIds, problems, limits)
      if (validated === null) {
        fatal = true
        return
      }
      if (seen.has(validated.id)) {
        fatal = true
        problems.push({
          ruleId: 'candidate-duplicate-id',
          message: 'Two candidates share an id, so a recommendation naming it would be ambiguous.',
          pointer: `/candidates/${index}/id`,
          evidence: sanitize(validated.id, 60),
        })
        return
      }
      seen.add(validated.id)
      candidates.push(validated)
    })
  }

  if (fatal || proposedValue === null || criteria.length === 0) return { worksheet: null, problems }

  return {
    worksheet: Object.freeze({
      requirement: Object.freeze({
        id: requirement.id,
        statement: requirement.statement,
        criteria: Object.freeze(criteria),
      }),
      proposed: proposedValue,
      candidates: Object.freeze(candidates),
    }),
    problems,
  }
}
