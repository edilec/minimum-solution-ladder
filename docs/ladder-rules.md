# The ladder, the evidence, and the rules

This document is the authoritative catalog. `test/rule-catalog.test.mjs` reads
the table below and compares it, in both directions, against the frozen
`RULE_SEVERITY` table in `src/index.mjs` — a rule in one and not the other fails
the suite.

Severity is **not** pinned by that comparison. Two tables agreeing with each
other are satisfied by one coordinated edit, so severity is pinned behaviourally
in `test/severity-outcomes.test.mjs`, which drives every rule through the real
CLI and asserts the exit code.

## The ladder

Smallest first. The recommendation is the lowest rung a candidate verifiably
reaches, and the whole point of the ordering is that a proposal above one of
those is worth naming.

| # | Rung | What it means |
| ---: | --- | --- |
| 0 | `no-change` | The behaviour already happens. Nothing is written. |
| 1 | `project-reuse` | Code already in this repository does it. |
| 2 | `standard-library` | The language's standard library does it. |
| 3 | `platform-native` | The runtime or platform does it. |
| 4 | `installed-dependency` | A package already installed does it. |
| 5 | `local-edit` | The smallest edit to existing code does it. |
| 6 | `new-machinery` | A new module, service or dependency. |

`standard-library` and `platform-native` are separate rungs and both are checked
with `builtin` evidence; which one a candidate claims is the worksheet's call,
and this tool only checks that the module and export are really there.

## Evidence kinds

| Kind | Fields | How it is checked |
| --- | --- | --- |
| `source` | `file`, `contains` | The file is read (inside the root, strict UTF-8, bounded) and must contain the string. |
| `dependency` | `file`, `name` | The file is parsed as JSON and the name must appear in `dependencies`, `devDependencies`, `optionalDependencies` or `peerDependencies`. |
| `builtin` | `module`, `export` | The module must be a built-in of the Node runtime the check runs on, and its namespace must carry that export. |
| `assertion` | `note` | Recorded, never checked. A ladder resting on one is reported `incomplete`. |

Each check answers **verified**, **refuted** or **unknown**. A candidate covers
the requirement only when every criterion is claimed and every one of its
evidence items verified.

## Rules

| Rule | Severity | Outcome | What it means |
| --- | --- | --- | --- |
| `candidate-duplicate-id` | error | incomplete | Two candidates share an id, so a recommendation naming it would be ambiguous. |
| `candidate-malformed` | error | incomplete | A candidate is missing a required field or has one of the wrong shape. |
| `candidate-rung-unknown` | error | incomplete | A candidate names a rung that is not on the ladder. |
| `candidate-unknown-key` | error | incomplete | A candidate or evidence item carries a key this schema does not define. |
| `criteria-uncovered` | info | pass | A candidate does not claim every criterion, so it cannot replace the proposal alone. |
| `criterion-unknown` | error | incomplete | A candidate claims a criterion the requirement does not list. |
| `evidence-file-not-json` | error | incomplete | A dependency manifest would not parse, so what it declares is unknown. |
| `evidence-file-not-utf8` | error | incomplete | An evidence file is not valid UTF-8, so nothing in it was searched. |
| `evidence-file-too-large` | error | incomplete | An evidence file is over `maxEvidenceBytes` and was not read. |
| `evidence-file-unreadable` | error | incomplete | An evidence file could not be opened or is not a regular file. |
| `evidence-kind-unknown` | error | incomplete | An evidence item names a kind this tool does not know. |
| `evidence-module-unloadable` | error | incomplete | A built-in module would not load on this runtime, so its exports are unknown. |
| `evidence-not-found` | error | **fail** | The evidence was obtained and the claim is false: the string, package or export is not there. |
| `evidence-path-escapes-root` | error | incomplete | An evidence path resolves outside the root, so it was not read. |
| `evidence-unverifiable` | warning | incomplete | An evidence item is an assertion. A rung supported only by assertion was not checked. |
| `lower-rung-available` | error | **fail** | A rung below the proposal covers the requirement, with evidence this run verified. |
| `no-candidate-fully-covers` | info | pass | Nothing verifiably covered every criterion, so the proposal stands unchallenged by this run. |
| `no-candidates` | warning | incomplete | The worksheet lists no candidates, so no rung was checked. |
| `proposal-unverified` | info | pass | The proposal claims a rung below anything this run could verify. |
| `savings-measured` | info | pass | A savings claim came with a measurement, and the measurement checked out. |
| `time-budget-exceeded` | error | incomplete | `timeoutMs` expired while checking evidence; nothing checked before it is credited. |
| `too-many-candidates` | error | incomplete | The worksheet declares more candidates than `maxCandidates`. |
| `too-many-criteria` | error | incomplete | The requirement declares more criteria than `maxCriteria`. |
| `too-many-evidence` | error | incomplete | A candidate carries more evidence items than `maxEvidencePerCandidate`. |
| `unsourced-savings-claim` | error | **fail** | A saving was asserted with no measurement, or with prose in place of one. |
| `worksheet-malformed` | error | incomplete | The worksheet's requirement or proposal is missing or the wrong shape. |
| `worksheet-not-json` | error | incomplete | The worksheet would not parse as JSON. |
| `worksheet-not-utf8` | error | incomplete | The worksheet is not valid UTF-8. |
| `worksheet-schema-unsupported` | error | incomplete | The worksheet declares a `schemaVersion` this release does not read. |
| `worksheet-too-large` | error | incomplete | The worksheet is over `maxWorksheetBytes` and was not read. |
| `worksheet-unknown-key` | error | incomplete | The worksheet, requirement, criterion or proposal carries an undefined key. |
| `worksheet-unreadable` | error | incomplete | The worksheet could not be opened, or is not a regular file. |

**Outcome** is what the rule does to the run, and it is not a function of
severity. Three `error` rules fail the run (exit 1); the rest mean evidence was
not obtained and make it `incomplete` (exit 2). Two `warning` rules also make it
incomplete — for those, the incomplete classification is the *only* thing
standing between an unchecked ladder and a green build, which is why
`test/incomplete.test.mjs` asserts a run with zero errors still exits 2.

## Determinism

Findings sort by `(location.file, location.pointer, ruleId, message, evidence)`,
compared by UTF-16 code unit. Never `localeCompare` and never `Intl.Collator`:
both consult ICU data that differs between Node builds, so two correct machines
would disagree about the same report. The observable difference is not
hypothetical — by code unit `Z` precedes `a`, `a-b` precedes `a_b`, and `README`
precedes `assets`; collation reverses all three.

No clock reading, locale, absolute host path or object key order reaches stdout.
The clock is injected (`clock`, defaulting to `Date.now`) and is used only to
decide whether the time budget expired.

## Limits

| Limit | Flag | Default |
| --- | --- | ---: |
| `maxCandidates` | `--max-candidates` | 100 |
| `maxCriteria` | `--max-criteria` | 50 |
| `maxEvidenceBytes` | `--max-evidence-bytes` | 262144 |
| `maxEvidencePerCandidate` | `--max-evidence` | 20 |
| `maxWorksheetBytes` | `--max-worksheet-bytes` | 1048576 |
| `timeoutMs` | `--timeout-ms` | 10000 |

Exceeding a limit is an `incomplete` result naming the limit, never a silent
truncation and never a pass. `timeoutMs` accepts 0, which leaves no time at all
and exists so the flag's wiring can be proved from outside.
