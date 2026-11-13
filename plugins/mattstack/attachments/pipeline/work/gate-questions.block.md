---
order: 4
---

# Gate questions

Each question is its own; never fold one list into another.

| Gate | Question | Options (recommended first) |
|---|---|---|
| `clarify` | `resume` (write-in) | **Resume it (Recommended)** / **Start fresh** / **Hold** |
| `<stage>-failed:<attempt>` | `action` (write-in) | **Retry the stage** (`Retry the stage (Recommended)` when the reason names something fixable) / **Abandon the run** (`Abandon the run (Recommended)` and listed first otherwise) |
| `close` | `finish` (write-in) | **Done** (`Done (Recommended)` when `ci` is green and the MR ready) / **Change something** |

The answer maps to `run_resolve`'s `next`, with their words as `note`.
Read `next` first: `proceed` applies `action` or `finish`, Retry (or an
`action` write-in, their words the `note`) as `retry`, Abandon as
`abandon`, Done as `done`, Change something (or a
`finish` write-in, their words the `note`) as `iterate` with `to` =
`implement`. An `iterate`, `go-back` or `hold` arrives only through a
hand-back or a future surface: `iterate` is `iterate` (`to` =
`implement` at close), `go-back` is `redirect` with the answer's `to`,
`hold` is `hold`.
`attempt` is the failure scope's `<n>`, or at close the last stage's.
