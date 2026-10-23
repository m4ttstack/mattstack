---
node: gate_mark_ready
---

# ship gate mark-ready

One sentence above the form: CI is green; the attachments are there (or
are not).

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `ready` (write-in) | **Mark ready now (Recommended)** (CI green, evidence attached) / **Keep it draft** | always |
| `next` | **Proceed** / **Iterate here** / **Go back** / **Hold** | always; **Go back** only in an inherited run |
| `to` | one option per earlier stage; with one candidate, **Go back to `<stage>`** in `next` instead | Go back, with more than one earlier stage in `run_snapshot` |

Scope `mark-ready`. Selection: `{"ready":true|false,"next":"proceed|iterate|go-back|hold","to":"<stage or null>","note":"<their words or null>"}`.
The first Iterate opens a new gate with the note; the second ends the
verb done, the MR a draft, the note quoted in the report.
