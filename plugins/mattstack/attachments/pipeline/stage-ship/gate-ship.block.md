---
node: gate_ship
kind: gate
props:
  rules:
    merge: add
    default: ""
---

# Gate ship (table below)

One sentence above the form: the branch, the commits about to go, whether
the tree is dirty, and the resolved target (the stack parent, the default
branch, or "the stack could not be read, so the default branch"), so
Proceed is consent to that target. A reopening with a rebase in progress
says so.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `dirty` (write-in) | **Commit the changes (Recommended)** / **Stash them** / **Abort** | the tree is dirty |
| `open_as` (write-in) | **Push and open as draft (Recommended)** / **Push and open ready** | always |
| the domain's own | as the domain rules word them (a ticket mismatch, an MR already open) | the domain declares them |
| `next` | **Proceed** / **Iterate here** / **Go back** / **Hold** | always |
| `to` | one option per earlier stage, split `to-1`, ... over 4 | Go back answered and more than one earlier stage row |

Selection: `{"dirty":"commit|stash|abort|null","open_as":"draft|ready","domain":{<answers>},"next":"proceed|iterate|go-back|hold","to":"<stage or null>","note":"<their words or null>"}`.
Abort's reason is `aborted at the ship gate`. With the store unreadable,
Proceed records `<default branch> (stack store unreadable)`; the rebase
and `mr_create` use the plain name.
Iterate and Hold clear it to `-` first, so a resume re-asks; the work
orchestrator clears it on a redirect reaching ship and on a failure gate
Retry of ship. Spent fix or conflict rounds reopen this gate (not an
Iterate), quoting the failing output or conflicted files; they carry over
a reopen, so a Proceed whose checks still fail reopens with no new fix
rounds.

{{props.rules}}
