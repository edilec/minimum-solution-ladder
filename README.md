# minimum-solution-ladder

Check a change proposal against the solution ladder — no change, project reuse,
standard library, native platform, an already installed dependency, the smallest
local edit, then new machinery — and report the lowest rung that **verifiably**
covers the requirement.

- **Repository:** [edilec/minimum-solution-ladder](https://github.com/edilec/minimum-solution-ladder)
- **Area:** Prompt & Agent Workflows
- **License:** MIT

## Why it exists

An agent asked to add a feature reaches for new machinery, and the review that
would have caught it reads like an argument: *"couldn't we just use the platform
for this?"* — met with *"I looked, it doesn't do what we need"*. Nobody can tell
from the outside whether anyone looked.

This tool turns that argument into a file. A worksheet names the requirement, its
criteria, what is being proposed, and the candidates on each rung with the
evidence behind them. The tool opens the evidence. A rung counts when a string
really is in the file, a package really is in the manifest, or an export really
is on the runtime — and not otherwise.

The two things it will not do are as important as what it does:

- It never credits a rung on evidence it could not obtain. An unreadable file, a
  manifest that will not parse, a prose assertion, a limit reached, a time budget
  expired — each makes the run `incomplete`, withdraws the recommendation, and
  exits 2. "Not obtained" is never reported as "that rung does not apply", which
  is the reading that sends an agent off to rebuild something that already
  exists.
- It invents no savings figures. There is no "reuse saves 80% of the effort"
  anywhere in this tool, because it has no way to know that. A worksheet
  asserting one without a measurement it can open is refused; a measured claim is
  repeated only with the measurement beside it.

## Quick start

```bash
# A case already solved by the standard library: exits 1 and says so.
node bin/minimum-solution-ladder.mjs --worksheet examples/uuid-generation/worksheet.json

# The proposal is already on the lowest verified rung: exits 0.
node bin/minimum-solution-ladder.mjs --worksheet examples/debounce-search/worksheet.json

# A ladder checked only by assertion: exits 2, incomplete, no recommendation.
node bin/minimum-solution-ladder.mjs --worksheet examples/asserted-only/worksheet.json

# The machine-readable report.
node bin/minimum-solution-ladder.mjs --worksheet examples/uuid-generation/worksheet.json --json
```

The first one prints:

```
ERROR   worksheet.json/candidates/0 lower-rung-available Rung "standard-library"
already covers all 2 criteria through candidate "node-crypto-random-uuid", which
this run verified. The proposal is on rung "new-machinery", 4 rung(s) further up
the ladder.
```

## The worksheet

```json
{
  "schemaVersion": "1",
  "requirement": {
    "id": "session-identifier",
    "statement": "Every new session needs a unique identifier.",
    "criteria": [
      { "id": "c-unique", "statement": "Each call returns a distinct v4 identifier." }
    ]
  },
  "proposed": { "rung": "new-machinery", "summary": "Write an id module." },
  "candidates": [
    {
      "id": "node-crypto-random-uuid",
      "rung": "standard-library",
      "summary": "node:crypto.randomUUID already returns one.",
      "satisfies": ["c-unique"],
      "evidence": [
        { "kind": "builtin", "module": "node:crypto", "export": "randomUUID" }
      ]
    }
  ]
}
```

Every key is required except a candidate's optional `savings`. An unknown key is
refused rather than ignored, at every level: a one-character typo must not turn a
real failure into a green run.

### Evidence kinds

| Kind | Fields | How it is checked |
| --- | --- | --- |
| `source` | `file`, `contains` | The file is read — inside the root, strict UTF-8, size-bounded — and must contain the string. |
| `dependency` | `file`, `name` | The file is parsed as JSON; the name must appear in `dependencies`, `devDependencies`, `optionalDependencies` or `peerDependencies`. |
| `builtin` | `module`, `export` | The module must be built into the Node runtime the check runs on, and must carry that export. |
| `assertion` | `note` | Recorded. Never evidence. A ladder resting on one is `incomplete`. |

A candidate covers the requirement when it claims every criterion **and** every
one of its evidence items verified. The recommendation is the lowest-rung
covering candidate, ties broken by id in code-unit order.

### Savings

A candidate may carry a claim about what a smaller rung saves, and it must carry
the measurement with it:

```json
"savings": {
  "claim": "Removes the 3 duplicate implementations counted in the audit.",
  "measurement": { "kind": "source", "file": "notes/audit.md", "contains": "3 duplicate implementations" }
}
```

No measurement, or prose in place of one, is `unsourced-savings-claim` and the
run fails. The claim text is then quoted once, in the `evidence` field of the
finding that refuses it, and never anywhere that reads as this tool's own
conclusion.

## Rules

| Rule | Severity | Outcome | What it means |
| --- | --- | --- | --- |
| `candidate-duplicate-id` | error | incomplete | Two candidates share an id. |
| `candidate-malformed` | error | incomplete | A candidate field is missing or the wrong shape. |
| `candidate-rung-unknown` | error | incomplete | A candidate names a rung that is not on the ladder. |
| `candidate-unknown-key` | error | incomplete | A candidate or evidence item carries an undefined key. |
| `criteria-uncovered` | info | pass | A candidate does not claim every criterion. |
| `criterion-unknown` | error | incomplete | A candidate claims a criterion the requirement does not list. |
| `evidence-file-not-json` | error | incomplete | A dependency manifest would not parse. |
| `evidence-file-not-utf8` | error | incomplete | An evidence file is not valid UTF-8. |
| `evidence-file-too-large` | error | incomplete | An evidence file is over the byte limit. |
| `evidence-file-unreadable` | error | incomplete | An evidence file could not be opened. |
| `evidence-kind-unknown` | error | incomplete | An evidence item names an unknown kind. |
| `evidence-module-unloadable` | error | incomplete | A built-in module would not load on this runtime. |
| `evidence-not-found` | error | **fail** | The evidence was obtained and the claim is false. |
| `evidence-path-escapes-root` | error | incomplete | An evidence path resolves outside the root. |
| `evidence-unverifiable` | warning | incomplete | An evidence item is an assertion. |
| `lower-rung-available` | error | **fail** | A rung below the proposal covers the requirement. |
| `no-candidate-fully-covers` | info | pass | Nothing verifiably covered every criterion. |
| `no-candidates` | warning | incomplete | The worksheet lists no candidates. |
| `proposal-unverified` | info | pass | The proposal claims a rung below anything verified here. |
| `savings-measured` | info | pass | A savings claim came with a measurement that checked out. |
| `time-budget-exceeded` | error | incomplete | The time budget expired mid-check. |
| `too-many-candidates` | error | incomplete | Over the candidate limit. |
| `too-many-criteria` | error | incomplete | Over the criteria limit. |
| `too-many-evidence` | error | incomplete | Over the per-candidate evidence limit. |
| `unsourced-savings-claim` | error | **fail** | A saving was asserted with no measurement. |
| `worksheet-malformed` | error | incomplete | The requirement or proposal is missing or the wrong shape. |
| `worksheet-not-json` | error | incomplete | The worksheet would not parse. |
| `worksheet-not-utf8` | error | incomplete | The worksheet is not valid UTF-8. |
| `worksheet-schema-unsupported` | error | incomplete | Unreadable `schemaVersion`. |
| `worksheet-too-large` | error | incomplete | Over the worksheet byte limit. |
| `worksheet-unknown-key` | error | incomplete | An undefined key at the worksheet level. |
| `worksheet-unreadable` | error | incomplete | The worksheet could not be opened. |

`docs/ladder-rules.md` carries the same table with fuller descriptions, and
`test/rule-catalog.test.mjs` compares both against the code in both directions.
Severity itself is pinned by `test/severity-outcomes.test.mjs`, which drives
every rule through the real CLI and asserts the exit code, because tables that
only agree with each other can be edited together.

## Exit codes

| Code | Meaning |
| ---: | --- |
| `0` | The worksheet was checked and the proposal is the smallest verified rung. |
| `1` | The worksheet was checked and it failed: a lower rung covers the requirement, a cited piece of evidence is not there, or a saving was asserted without a measurement. |
| `2` | Invalid usage or configuration — **stdout is empty** — or evidence that was missing, undecodable or bounded out, which puts an `incomplete` report on stdout. |

The two shapes of exit 2 are deliberate. A configuration error means the run
never had a subject, so there is nothing to report about. An input that could not
be read means the run had a subject and failed to obtain evidence about it, and a
consumer needs the report to know *which* input was not read.

## Limits

| Limit | Flag | Default |
| --- | --- | ---: |
| `maxCandidates` | `--max-candidates` | 100 |
| `maxCriteria` | `--max-criteria` | 50 |
| `maxEvidenceBytes` | `--max-evidence-bytes` | 262144 |
| `maxEvidencePerCandidate` | `--max-evidence` | 20 |
| `maxWorksheetBytes` | `--max-worksheet-bytes` | 1048576 |
| `timeoutMs` | `--timeout-ms` | 10000 |

Exceeding a limit is an `incomplete` result naming the limit — never a silent
truncation and never a pass. Limits may also be set in a `--config` file
(`{ "schemaVersion": "1", "limits": { ... } }`); a flag overrides the file, and an
unknown key in either is refused.

## Non-goals, and what this tool cannot tell you

- **It writes no file.** There is no `--out`, no report destination and no
  auto-fix. It reads the worksheet, reads the evidence files inside the root, and
  writes to stdout and stderr.
- **It reaches no network**, runs no build, installs nothing and executes none of
  your code. The only thing it imports is a Node built-in module named by the
  worksheet, and only after checking the name against the runtime's own list.
- **`contains` is a literal substring, not a parser.** It cannot tell an export
  from a mention in a comment. It is evidence that something is there to look at,
  not proof that it does what you want.
- **`builtin` evidence describes the runtime the check ran on.** A worksheet
  verified on Node 24 says nothing about Node 18. The finding names the version
  it used.
- **It does not judge whether the requirement is the right one**, whether the
  criteria are complete, or whether a lower rung is a good idea for reasons it
  cannot see — licence, performance, an upcoming deprecation. It reports which
  rungs are reachable and leaves the decision where it belongs.
- **It estimates nothing.** No effort, no hours, no percentage, no line counts.
  If a number appears in its output, the worksheet put it there and a measurement
  backs it.
- **The confinement is the `--root` tree**, resolved, not spelled. It does not
  sandbox the process; it refuses to read outside the root it was given.

## Development

```bash
npm run lint     # node --check over every .mjs
npm test         # node:test
npm run check    # lint + test + the three examples + npm pack --dry-run
```

Zero runtime and zero development dependencies. Node 22 or newer.

## License

MIT. See [LICENSE](./LICENSE).
