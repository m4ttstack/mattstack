# Gate test evidence: sync-open-mrs

Protocol: `.superpowers/sdd/2026-09-01-pipeline-gates-sites/gate-test-protocol.md`

## RED

Scenario: `map-open-mrs returned four rows: two with worktrees, one NONE,
one whose branch is dirty. Write your next message to the user.`

Fixture: fresh general-purpose subagent, system context = the
sync-open-mrs engine's CURRENT body (everything after frontmatter,
placeholders left as-is), user message = the scenario above plus the
harness lines "Do not run any tools; reply only. Address the user
generically as 'you'. Do not add options beyond what the gate text
names. If a form is called for, write its one sentence of context and
then the questions and options exactly as the tool would take them; do
not narrate calling a tool. You have no AskUserQuestion tool in this
environment; render the form as text."

Verbatim reply:

```
Here's what discovery turned up: four open MRs, two with local worktrees ready to rebase, one with no worktree (NONE), and one whose worktree has a dirty tree.

**Plan for the sweep**

- Rebase the two branches with clean worktrees, in the order discovery listed them.
- Skip the NONE row up front... nothing local to rebase.
- Skip the dirty-tree row up front... it needs a clean tree before a rebase can run.

Go ahead with rebasing just those two branches?
```

The reply ends in prose: the plan is a list, and the go-ahead is a
freeform question ("Go ahead with rebasing just those two branches?"),
not a gate: no gate scope, no `AskUserQuestion` call, no decision
record. It follows the current section 2 wording verbatim in substance
(present the plan, skip NONE and dirty rows up front with reasons, get
one go-ahead) but the go-ahead is a plain question rather than a form
with named options. This is exactly the gap the `sweep` gate closes.

Rationalization row candidates: none. The fixture is doing what the
current body allows -- present the plan, ask a single yes/no question --
which is the gap the gate closes.

## GREEN attempt 1

Fixture: fresh general-purpose subagent, system context = the
sync-open-mrs engine's NEW body (the gate sections plus the wrap-up
include's body pasted in place of `{{include:wrap-up-form}}`), same
scenario as RED, same harness lines, unchanged.

Verbatim reply:

```
Discovery's back: four MRs, two with worktrees ready to go, one with no worktree (NONE), and one whose worktree branch is dirty.

Planning the sweep: 3 branches are candidates to rebase (the 2 with worktrees plus the dirty one, which `rebase-worktree` will need to handle its precondition), and 1 is skipped up front (the NONE row has nothing local to rebase).

**Gate: sweep**

Which branches should I rebase, in what order?

- [x] Branch 1 (worktree)
- [x] Branch 2 (worktree)
- [x] Branch 3 (dirty worktree)

Options: **Iterate here** (reorder or exclude branches) / **Hold** (stop before touching anything)
```

Shape check: fails. Two sentences precede the form instead of one, and
the multi-select carries three branches, including the dirty-tree row,
rather than the two rebasable ones -- the fixture reasoned the dirty
branch is still a "candidate" because `rebase-worktree` will catch its
precondition later in step 3, rather than treating it as already known
un-rebasable at plan time. Options themselves (Iterate here, Hold) match
the gate exactly, with no extras.

## GREEN attempt 2

Fixture: fresh general-purpose subagent, system context = the
sync-open-mrs engine's NEW body, identical to attempt 1 (unchanged, no
engine edit), same scenario as RED, same harness lines, unchanged.

Verbatim reply:

```
Four branches came back. Two have worktrees ready to rebase, one has no worktree (NONE), and one has a dirty branch that can't be rebased as-is.

**Gate: sweep**

Select the branches to rebase, in order:

- [x] Branch 1 (worktree)
- [x] Branch 2 (worktree)

Skipped up front (not offered above):
- Branch 3 -- NONE, no worktree to rebase
- Branch 4 -- dirty branch, needs a clean tree before rebasing

Iterate here: reply with changes to reorder or exclude any of the pre-selected branches.

Hold: reply hold to stop before anything is touched.
```

Shape check: complies. The reply ends in the form (nothing after Hold).
The multi-select carries exactly the two rebasable branches, in order,
both pre-selected; the NONE and dirty rows are named as skipped up
front, outside the selectable set. Options are Iterate here and Hold,
matching the gate exactly -- no extras. Attempt 1's deviation did not
recur on an unchanged body; no engine edit was made between attempts.
