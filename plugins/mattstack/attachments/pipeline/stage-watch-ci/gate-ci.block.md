---
node: gate_ci
kind: gate
label: CI gate
---

# Gate ci

Quote any error, or a spent `waiting`'s `next`. On `no_pipeline`,
`pushed: false` means the MR head is `remoteSha`: say ship first; `pushed:
true` means no pipeline ran for it. Scope `ci:watch-ci:<attempt>`. One sentence above the form: the
verdict and a one-line triage per blocking failure.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `action` (write-in) | **Fix and re-push** (a REAL failure in your change) / **Retry the job** (a flake not yet retried) / **Hand back** (leave it red for the human) / **Abandon the run** | always |
| `next` | **Proceed** / **Iterate here** / **Go back** / **Hold** | always |
| `to` | one option per earlier stage; with one candidate, **Go back to `<stage>`** in `next` instead | Go back, with more than one earlier stage row |

Mark one `action` option `(Recommended)`: **Fix and re-push** when any
blocking failure is REAL, while this is the first, second or third
`watch-ci` attempt (the `<attempt>` in scope `ci:watch-ci:<attempt>`), so
at most three fix rounds run; else **Hand
back** when any is REAL; else **Retry the job** when an INFRA one is not
yet retried; else **Hand back**, which also covers a red with no triage
(a timeout, `no_pipeline`, an MR lookup error).

Selection: `{"action":"fix|retry|handback|abandon","next":"proceed|iterate|go-back|hold","to":"<stage or null>","note":"<their words or null>"}`.
An `action` write-in records `{"writeIn": "<their words>"}` as `action`.
Read `next` first: Proceed applies `action`; Iterate here, Go back and
Hold win over it.

**Fix and re-push** hands back `{to: implement, note, decidedBy}`. The
note carries their words, when any, then names each failing job, its
one-line triage, and the heading of the section in this skill that governs
fixing it (under Domain rules or at a step; the deepest heading that
applies), for example `api-tests: REAL, orders spec asserts 25 per page;
section: Acting on other REAL failures` (`section: none` when no section
applies).
