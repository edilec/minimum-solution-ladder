#!/usr/bin/env node

import { formatReport, loadConfigFile, runLadder } from '../src/index.mjs'

const HELP = `minimum-solution-ladder

Check a decision worksheet against the solution ladder -- no change, project
reuse, standard library, native platform, an installed dependency, the smallest
local edit, then new machinery -- and say whether the change being proposed is
the smallest one that demonstrably works.

Usage:
  minimum-solution-ladder --worksheet FILE [--root DIR] [--config FILE]
                          [--json] [limits]

Options:
  --worksheet FILE        Decision worksheet to read (required)
  --root DIR              Root that every evidence path is resolved inside and
                          every reported path is relative to (default: the
                          directory holding the worksheet). It is the boundary
                          of what this run may read: a path that resolves
                          outside it, through a link or otherwise, is refused
                          rather than read
  --config FILE           JSON configuration: schemaVersion and limits
  --json                  Emit the machine-readable report on stdout
  --max-candidates N      Maximum candidates in a worksheet (default 100)
  --max-criteria N        Maximum criteria in the requirement (default 50)
  --max-evidence N        Maximum evidence items per candidate (default 20)
  --max-evidence-bytes N  Maximum size of one evidence file (default 262144)
  --max-worksheet-bytes N Maximum worksheet size (default 1048576)
  --timeout-ms N          Time budget for the whole run (default 10000; 0 leaves
                          no time at all and is only useful for proving the
                          budget is enforced)
  -h, --help              Show this help

Evidence kinds. A rung counts only when one of the first three was checked and
found:

  source      { "kind": "source", "file": "src/x.mjs", "contains": "..." }
              the string must appear in that file, which must be inside --root
  dependency  { "kind": "dependency", "file": "package.json", "name": "x" }
              the package must be declared in dependencies, devDependencies,
              optionalDependencies or peerDependencies of that manifest
  builtin     { "kind": "builtin", "module": "node:crypto", "export": "..." }
              the module must be a built-in of the Node runtime this check runs
              on, and must carry that export
  assertion   { "kind": "assertion", "note": "..." }
              a sentence. It is recorded and it is never evidence: a worksheet
              whose ladder rests on one is reported incomplete, because a rung
              supported only by assertion was not checked

What cannot happen:

  - A rung is never credited on evidence this tool did not obtain. An
    unreadable file, undecodable bytes, a module that would not load, an
    assertion, a limit reached or an expired time budget each produce an
    "incomplete" report with NO recommendation, and exit 2. "Not obtained" is
    never reported as "that rung does not apply".
  - No savings figure is invented. This tool estimates no percentage, no hours
    and no lines. A worksheet asserting a saving without a measurement it can
    open is refused; a measured claim is repeated only alongside the
    measurement, attributed to the worksheet.
  - Nothing is written, installed, fetched or changed. This tool opens files
    inside --root and imports built-in modules from the running runtime. It
    writes no file, so it has no --out and no destination to confine.

Every option is accepted once; a repeated flag is a configuration error rather
than a silent last-wins. An unknown option is refused rather than ignored.

Exit codes:
  0  the worksheet was checked and the proposal is the smallest verified rung
  1  the worksheet was checked and it failed: a lower rung covers the
     requirement, a cited piece of evidence is not there, or a saving was
     asserted without a measurement
  2  invalid usage or configuration (no report on stdout), or evidence that was
     missing, undecodable or bounded out (an "incomplete" report on stdout)
`

const LIMIT_FLAGS = new Map([
  ['--max-candidates', 'maxCandidates'],
  ['--max-criteria', 'maxCriteria'],
  ['--max-evidence', 'maxEvidencePerCandidate'],
  ['--max-evidence-bytes', 'maxEvidenceBytes'],
  ['--max-worksheet-bytes', 'maxWorksheetBytes'],
  ['--timeout-ms', 'timeoutMs'],
])

function parseArguments(argv) {
  if (argv.includes('-h') || argv.includes('--help')) return { help: true }
  const options = { worksheet: null, root: null, config: null, json: false, limits: {} }
  const given = new Set()

  /**
   * A flag that carries a value is accepted once.
   *
   * Letting it repeat discards the earlier value with no diagnostic, so
   * `--timeout-ms 10000 --timeout-ms 0` runs against a budget nobody asked for.
   * That is the same defect as an ignored typo, which this tool already refuses.
   */
  const once = (name) => {
    if (given.has(name)) throw new Error(`${name} was given more than once`)
    given.add(name)
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const takeValue = (name) => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) throw new Error(`${name} requires a value`)
      index += 1
      return value
    }

    if (argument === '--json') {
      once('--json')
      options.json = true
    } else if (argument === '--worksheet') {
      once('--worksheet')
      options.worksheet = takeValue('--worksheet')
    } else if (argument === '--root') {
      once('--root')
      options.root = takeValue('--root')
    } else if (argument === '--config') {
      once('--config')
      options.config = takeValue('--config')
    } else if (LIMIT_FLAGS.has(argument)) {
      once(argument)
      const raw = takeValue(argument)
      const minimum = argument === '--timeout-ms' ? 0 : 1
      if (!/^\d+$/.test(raw) || Number(raw) < minimum) {
        throw new Error(`${argument} requires an integer of ${minimum} or more`)
      }
      options.limits[LIMIT_FLAGS.get(argument)] = Number(raw)
    } else throw new Error(`Unknown option "${argument}"`)
  }

  if (options.worksheet === null) throw new Error('--worksheet is required')
  return options
}

async function main(argv) {
  let options
  try {
    options = parseArguments(argv)
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${HELP}`)
    return 2
  }
  if (options.help) {
    process.stdout.write(HELP)
    return 0
  }

  let configured = { limits: {} }
  if (options.config !== null) {
    try {
      configured = await loadConfigFile(options.config)
    } catch (error) {
      process.stderr.write(`--config is not usable: ${error.message}\n`)
      return 2
    }
  }

  let report
  try {
    report = await runLadder({
      worksheet: options.worksheet,
      ...(options.root === null ? {} : { root: options.root }),
      limits: { ...configured.limits, ...options.limits },
    })
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 2
  }

  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report))

  if (report.status === 'incomplete') {
    process.stderr.write(
      `incomplete: ${report.summary.unexamined} piece(s) of evidence were not obtained, so no rung was recommended.\n`,
    )
    return 2
  }
  return report.status === 'fail' ? 1 : 0
}

process.exitCode = await main(process.argv.slice(2))
