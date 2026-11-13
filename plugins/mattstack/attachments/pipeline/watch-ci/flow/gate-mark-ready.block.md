---
node: gate_mark_ready
kind: gate
label: Mark ready
---

# watch-ci gate mark-ready

One sentence above the form: CI is green for the MR's head.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `ready` (write-in) | **Mark ready now (Recommended)** / **Keep it draft** | always |

Scope `mark-ready`. Selection: `{"ready":true|false,"next":"proceed|iterate|go-back|hold","to":"<stage or null>","note":"<their words or null>"}`.
