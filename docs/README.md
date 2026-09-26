# Minimum Solution Ladder documentation

- [`ladder-rules.md`](./ladder-rules.md) — the ladder, the evidence kinds, the
  authoritative rule catalog with severities and outcomes, the determinism
  contract and the limits.
- The [README](../README.md) carries the quick start, the worksheet schema, the
  exit codes and the non-goals.
- `examples/` holds three worksheets that are run by `npm run check`: one that
  passes, one that fails because a lower rung covers the requirement, and one
  that is incomplete because its ladder rests on an assertion.
