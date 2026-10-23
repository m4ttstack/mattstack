---
node: gate_ci
---

# watch-ci gate ci

Quote any error, or a spent `waiting`'s `next`. On
`no_pipeline`, `pushed: false` means the MR head is `remoteSha`: say ship first; `pushed: true` means no
pipeline ran for it. Scope `ci:<stage>:<attempt>`. One sentence above the
form: the verdict and a one-line triage per blocking failure.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `action` (write-in) | **Fix and re-push** (a REAL failure in the change) / **Retry the job** (a flake not yet retried) / **Hand back** / **Abandon the run** (own run only) | always |
| `next` | **Proceed** / **Iterate here** / **Hold** | always |

Mark one `action` option `(Recommended)`: **Fix and re-push** when any
blocking failure is REAL, while fewer than three fix rounds have run
(`watch-ci:fix-rounds`); else **Hand back** when any is REAL; else
**Retry the job** when an INFRA one is not yet retried; else **Hand
back**, which also covers a red with no triage (a timeout, `no_pipeline`,
an MR lookup error).

Selection: `{"action":"fix|retry|handback|abandon","next":"proceed|iterate|hold","note":"<their words or null>"}`.
An `action` write-in records `{"writeIn": "<their words>"}` as `action`.
Read `next` first: Proceed applies `action`; Iterate here and Hold win
over it. Hand back leaves the MR red
for the human.
