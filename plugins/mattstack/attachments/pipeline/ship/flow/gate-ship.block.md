---
node: gate_ship
props:
  rules:
    merge: add
    default: ""
---

# ship gate ship

One sentence above the form: the branch, the commits about to go, whether
the tree is dirty, and the resolved target (the stack parent, the default
branch, or "the stack could not be read, so the default branch"), so
Proceed is consent to that target. A reopening with a rebase in progress
says so, and Abort aborts that rebase first.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `dirty` (write-in) | **Commit the changes (Recommended)** / **Stash them** / **Abort** | the tree is dirty |
| `open_as` (write-in) | **Push and open as draft (Recommended)** / **Push and open ready** | always |
| the domain's own | as the domain rules word them (a ticket mismatch, an MR already open) | the domain declares them |
| `next` | **Proceed** / **Iterate here** / **Hold** | always |

Scope `ship`. Selection: `{"dirty":"commit|stash|abort|null","open_as":"draft|ready","domain":{<answers>},"next":"proceed|iterate|hold","note":"<their words or null>"}`.
Iterate and Hold clear `shipTarget` first, so
a resume re-asks. With the stack store unreadable, Proceed records
`<default branch> (stack store unreadable)`, telling consent to the
fallback from a real read; the rebase and `mr_create` use the plain name.

Running out of fix or conflict rounds reopens this gate (not an
Iterate), quoting the failing output or conflicted files; a second time
fails the verb. Fix and conflict rounds carry over a reopen (the human's
turn to fix), so a Proceed whose checks still fail reopens again with no
new fix rounds.

{{props.rules}}
