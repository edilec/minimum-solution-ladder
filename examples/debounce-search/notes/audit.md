# Search input audit

Counted by hand on 2026-09-01 across the three search surfaces:

- 3 duplicate debounce implementations, one per surface.
- 2 of them leak a timer when the component unmounts.

This file is the measurement behind the savings claim in the worksheet. The
tool repeats the claim only because it can open this file and find the count.
