# Changelog

All notable changes to this package are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this package uses
semantic versioning, and **a rule id is part of the public surface** — renaming
one is a breaking change and is recorded here.

## [Unreleased]

### Fixed

- **A value that cannot be stringified no longer costs the whole report.**
  `String({"toString": {}})` throws `Cannot convert object to primitive value`,
  and that value in a document emptied stdout on exit 2 -- the shape reserved for
  a configuration error -- suppressing every other finding in the run. `sanitize`
  now describes a value it cannot render by its shape (`[object]`, `[array]`) and
  never reproduces it, and no call site stringifies before handing a value over.
  The run reports the input as invalid with status `incomplete`.

## [0.1.0] - 2026-09-14

First working release.

### Added

- `runLadder()` and the `minimum-solution-ladder` CLI: read a decision
  worksheet, check every candidate's evidence, and report the lowest rung that
  verifiably covers the requirement.
- Seven ladder rungs, smallest first: `no-change`, `project-reuse`,
  `standard-library`, `platform-native`, `installed-dependency`, `local-edit`,
  `new-machinery`.
- Four evidence kinds: `source` (a string in a file inside the root),
  `dependency` (a package declared in a JSON manifest), `builtin` (an export on
  the running Node runtime), and `assertion` — which is recorded and never
  counts, so a ladder resting on one is reported `incomplete`.
- A frozen rule catalog of 32 rules. Three of them fail a run
  (`evidence-not-found`, `lower-rung-available`, `unsourced-savings-claim`); the
  rest mean evidence was not obtained and make the run `incomplete`.
- Savings claims: refused without a measurement this tool can open, repeated
  with the measurement when it checks out. The tool itself estimates nothing.
- Limits for worksheet size, candidate count, criteria count, evidence per
  candidate, evidence file size and wall-clock time, settable from the command
  line or a `--config` file, and named in the finding when one is reached.
- `examples/` with a passing worksheet, a failing one and an incomplete one, all
  run by `npm run check`.

### Notes

- This tool writes no file. There is no `--out`, and the contract's write-guard
  requirements do not apply to it.
- It reaches no network and executes none of the caller's code. The only module
  it imports is a Node built-in named by the worksheet, checked against the
  runtime's own list first.
- Findings sort by `(location.file, location.pointer, ruleId, message, evidence)`
  compared by UTF-16 code unit — never `localeCompare` or `Intl.Collator`, whose
  ICU data differs between Node builds.
