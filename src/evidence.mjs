/**
 * Checking evidence, which is the only thing that makes a rung count.
 *
 * Every check answers one of three ways, and the third one is the reason this
 * file exists:
 *
 * - **verified** -- the tool opened something and found what the worksheet said
 *   was there.
 * - **refuted** -- the tool opened something and the claim was false. A definite
 *   negative: the run fails.
 * - **unknown** -- the tool could not obtain the evidence: the file would not
 *   open, the bytes would not decode, the module would not load, or the item was
 *   a sentence rather than a fact. An unknown is never coverage and never
 *   absence. It makes the run `incomplete`.
 *
 * Collapsing "unknown" into either of the others is the defect this catalog has
 * paid for most often: an unreadable file reported as "the rung does not apply"
 * sends an agent off to write new machinery that already exists, and an
 * unreadable file reported as coverage recommends reuse of something nobody
 * confirmed is there.
 *
 * Nothing here reaches the network. `builtin` evidence imports a module from the
 * running Node runtime and nothing else: the name is checked against
 * `builtinModules` first, so an arbitrary path on disk is never imported.
 */

import { readFile, realpath, stat } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import { relative, resolve, sep } from 'node:path'

import { decodeUtf8, parseFailureDetail, sanitize } from './text.mjs'

/** Dependency sections a manifest may declare an installed package in. */
export const DEPENDENCY_SECTIONS = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
])

/**
 * The built-in module names of the running runtime.
 *
 * `builtinModules` mixes two spellings -- `crypto` and `node:sqlite` both appear
 * on Node 24 -- so membership is tested both ways. Checking only the bare name
 * would report `node:sqlite` as "not a built-in module of this runtime", which
 * is a refutation of a true claim: exactly the wrong answer, arrived at
 * confidently.
 */
const BUILTIN_NAMES = new Set(builtinModules)

function isBuiltinName(bare) {
  return BUILTIN_NAMES.has(bare) || BUILTIN_NAMES.has(`node:${bare}`)
}

/**
 * How a built-in module is loaded, injected so a test can make it fail.
 *
 * No Node release this package was built against refuses to import a module it
 * lists in `builtinModules`, so the "would not load" branch is unreachable from
 * the outside on this runtime -- and an unreachable branch that throws would
 * turn an input problem into a crash on some future runtime that does refuse
 * (an experimental module behind a flag is the obvious candidate). Injecting the
 * loader is what lets that branch be exercised and pinned. The default is the
 * real dynamic import and nothing else.
 */
export const importBuiltin = (specifier) => import(specifier)

/** True when `target` is the real root or lies inside it. Both must be real paths. */
export function isInside(realRoot, target) {
  return target === realRoot || target.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep)
}

/**
 * A relative path with forward slashes, so a report reads the same on every
 * platform -- and sanitised, because a path is untrusted text like any other.
 *
 * The worksheet chooses these spellings. A file named with a line feed in it is
 * a legal path on every platform this runs on, and reported verbatim it forges a
 * whole line in the human report from a field nobody thinks of as an excerpt.
 * The unsanitised spelling is still what gets opened; only the reported one is
 * cleaned.
 */
export function relativePosix(realRoot, target) {
  return sanitize(relative(realRoot, target).split(sep).join('/'), 200)
}

const verified = (detail, extra = {}) => ({ state: 'verified', detail, ...extra })
const refuted = (detail, extra = {}) => ({ state: 'refuted', ruleId: 'evidence-not-found', detail, ...extra })
const unknown = (ruleId, detail, extra = {}) => ({ state: 'unknown', ruleId, detail, ...extra })

/**
 * Read one file inside the root, bounded and strictly decoded.
 *
 * Confinement is checked on the **resolved** path, not the spelling: rejecting
 * `../` and absolute paths is not confinement, because a symbolic link planted
 * inside the root points outside it while spelling nothing suspicious. A file
 * read through such a link would put out-of-root content into the report, which
 * has already happened in this catalog.
 *
 * Reads are cached by real path so a worksheet citing one file ten times opens
 * it once. The cache is keyed on the resolved path and holds only files this run
 * already read, so it changes how long a run takes and never what it concludes.
 */
async function readInsideRoot(file, context) {
  const { realRoot, limits, cache } = context
  const candidate = resolve(realRoot, file)
  if (!isInside(realRoot, candidate)) {
    return {
      problem: unknown(
        'evidence-path-escapes-root',
        'the path leaves the declared root, which is the boundary of what this run may read',
        { file: null },
      ),
    }
  }

  let realFile
  try {
    realFile = await realpath(candidate)
  } catch (error) {
    return {
      problem: unknown(
        'evidence-file-unreadable',
        `the file could not be resolved (${sanitize(String(error.code ?? 'unreadable'), 40)})`,
        { file: relativePosix(realRoot, candidate) },
      ),
    }
  }
  const reported = relativePosix(realRoot, candidate)
  if (!isInside(realRoot, realFile)) {
    return {
      problem: unknown(
        'evidence-path-escapes-root',
        'the path resolves through a link to a location outside the declared root, so it was not read',
        { file: reported },
      ),
    }
  }

  const hit = cache.get(realFile)
  if (hit !== undefined) return { ...hit, file: reported }

  let info
  try {
    info = await stat(realFile)
  } catch (error) {
    return {
      problem: unknown(
        'evidence-file-unreadable',
        `the file could not be inspected (${sanitize(String(error.code ?? 'unreadable'), 40)})`,
        { file: reported },
      ),
    }
  }
  if (!info.isFile()) {
    return { problem: unknown('evidence-file-unreadable', 'the path is not a regular file', { file: reported }) }
  }
  if (info.size > limits.maxEvidenceBytes) {
    return {
      problem: unknown(
        'evidence-file-too-large',
        `the file is ${info.size} bytes, over the limit of ${limits.maxEvidenceBytes}`,
        { file: reported },
      ),
    }
  }

  let bytes
  try {
    bytes = await readFile(realFile)
  } catch (error) {
    return {
      problem: unknown(
        'evidence-file-unreadable',
        `the file could not be read (${sanitize(String(error.code ?? 'unreadable'), 40)})`,
        { file: reported },
      ),
    }
  }
  const decoded = decodeUtf8(bytes)
  if (!decoded.ok) {
    return {
      problem: unknown(
        'evidence-file-not-utf8',
        'the file is not valid UTF-8, so nothing in it was searched',
        { file: reported },
      ),
    }
  }
  const result = { text: decoded.text }
  cache.set(realFile, result)
  return { ...result, file: reported }
}

/**
 * Check one evidence item.
 *
 * Returns `{ state, ruleId?, detail, file? }`. `file` is the path the finding
 * should be reported against when the item named one, already relative to the
 * root and already in POSIX spelling; a finding about builtin or assertion
 * evidence belongs to the worksheet instead, and `file` is null for those.
 */
export async function checkEvidence(item, context) {
  if (item.kind === 'assertion') {
    return unknown(
      'evidence-unverifiable',
      'the item is an assertion, which this tool cannot check; a rung supported only by assertion was not checked',
      { file: null },
    )
  }

  if (item.kind === 'builtin') {
    const bare = item.module.startsWith('node:') ? item.module.slice(5) : item.module
    if (!isBuiltinName(bare)) {
      return refuted(
        `"${sanitize(item.module, 80)}" is not a built-in module of the Node runtime this check ran on (${process.version})`,
        { file: null },
      )
    }
    let namespace
    try {
      namespace = await (context.load ?? importBuiltin)(`node:${bare}`)
    } catch (error) {
      return unknown(
        'evidence-module-unloadable',
        `the built-in module "${sanitize(item.module, 80)}" would not load on this runtime (${sanitize(String(error?.code ?? 'load failed'), 40)})`,
        { file: null },
      )
    }
    if (!Object.hasOwn(namespace, item.export)) {
      return refuted(
        `"${sanitize(item.module, 80)}" does not export "${sanitize(item.export, 80)}" on ${process.version}`,
        { file: null },
      )
    }
    return verified(`"${sanitize(item.module, 80)}" exports "${sanitize(item.export, 80)}" on ${process.version}`)
  }

  const read = await readInsideRoot(item.file, context)
  if (read.problem !== undefined) {
    return { ...read.problem, file: read.problem.file ?? null, declared: sanitize(item.file, 120) }
  }

  if (item.kind === 'source') {
    if (!read.text.includes(item.contains)) {
      return refuted(
        `"${sanitize(item.contains, 80)}" does not appear in the file`,
        { file: read.file },
      )
    }
    return verified(`"${sanitize(item.contains, 80)}" appears in ${read.file}`, { file: read.file })
  }

  let manifest
  try {
    manifest = JSON.parse(read.text)
  } catch (error) {
    return unknown(
      'evidence-file-not-json',
      `the dependency manifest is not valid JSON: ${sanitize(parseFailureDetail(error), 120)}`,
      { file: read.file },
    )
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return unknown('evidence-file-not-json', 'the dependency manifest is not a JSON object', { file: read.file })
  }
  const sections = DEPENDENCY_SECTIONS.filter((section) => {
    const table = manifest[section]
    return Boolean(table) && typeof table === 'object' && !Array.isArray(table) && Object.hasOwn(table, item.name)
  })
  if (sections.length === 0) {
    return refuted(
      `"${sanitize(item.name, 80)}" is not declared in ${DEPENDENCY_SECTIONS.join(', ')} of ${read.file}`,
      { file: read.file },
    )
  }
  return verified(`"${sanitize(item.name, 80)}" is declared in ${sections.join(' and ')} of ${read.file}`, { file: read.file })
}

/** A short, sanitised description of an evidence item, for the report. */
export function describeEvidence(item) {
  if (item.kind === 'assertion') return { kind: 'assertion', note: sanitize(item.note, 160) }
  if (item.kind === 'builtin') {
    return { kind: 'builtin', module: sanitize(item.module, 80), export: sanitize(item.export, 80) }
  }
  if (item.kind === 'source') {
    return { kind: 'source', file: sanitize(item.file, 120), contains: sanitize(item.contains, 80) }
  }
  return { kind: 'dependency', file: sanitize(item.file, 120), name: sanitize(item.name, 80) }
}
