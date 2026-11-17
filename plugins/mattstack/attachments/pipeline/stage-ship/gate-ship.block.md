---
node: gate_ship
kind: gate
label: Ship gate
props:
  rules:
    merge: add
    default: ""
---

# Gate ship (table below)

Reach comes from the MR state read just before this gate and from the
recommended `open_as` option. With the run's `mr` set, the read is
`mr_view` on it; with `mr` unset, it is `mr_for_branch` on the branch,
which may already have an MR. Reach `teammates` when the recommended
`open_as` is **Push and open ready**, when the read shows the MR ready, or
when the read failed (an error is never read as no MR): any push, a
force-with-lease one above all, then lands on a branch teammates review.
Otherwise reach `draft`: the read shows a draft, or `mr_for_branch` shows
no open MR on the branch (`null`), a re-ship that pushes with
force-with-lease after a CI fix round included.

One sentence above the form: the branch, the commits about to go, whether
the tree is dirty, and the resolved target (the stack parent, the default
branch, or "the stack could not be read, so the default branch"), so
`proceed` is consent to that target. A reopening with a rebase in progress
says so.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `dirty` (write-in) | **Commit the changes (Recommended)** / **Stash them** / **Abort** | the tree is dirty |
| `open_as` (write-in) | **Push and open as draft (Recommended)** / **Push and open ready** | always |
| the domain's own | as the domain rules word them (a ticket mismatch, an MR already open) | the domain declares them |

Selection: `{"dirty":"commit|stash|abort|null","open_as":"draft|ready","domain":{<answers>},"next":"proceed|iterate|go-back|hold","to":"<stage or null>","note":"<their words or null>"}`.
Abort's reason is `aborted at the ship gate`. With the store unreadable,
`proceed` records `<default branch> (stack store unreadable)`; the rebase
and `mr_create` use the plain name.
`iterate` and `hold` clear it to `-` first, so a resume re-asks; the work
orchestrator clears it on a redirect reaching ship and on a failure gate
Retry of ship. Spent fix or conflict rounds reopen this gate (not an
`iterate`), quoting the failing output or conflicted files, and pass
`needsOperator` with one line naming what was spent (`fix rounds spent:
<the failing check>` or `conflict rounds spent: <the conflicted files>`),
so the reopened gate asks in every mode. The rounds carry over a reopen,
so a `proceed` whose checks still fail reopens with no new fix rounds.

{{props.rules}}
