# Self-review leans to fixing

Status: approved direction, 2026-11-17

## Why

An audit of about 100 work runs compared self-review's findings with the
blocking threads teammates later raised on the same merge requests. About a
third of those threads were findings self-review had already raised. The
run then dropped them:

- Minor findings stayed open because the fix gate's answer was "fix the
  blocking findings".
- Findings were waved off as "pre-existing" or "a follow-up is fine".
- Evidence owed to the change was deferred to ship as a note, and ship never
  captured it.

A second group of threads sat in code written as the fix for self-review's
own finding. The next review covered only the latest commit (a test
rename), so the fix commits were never reviewed. Replaying the reviewer on
those commits caught the issues most of the time: the reviewer can find
them. The gap is in what gets reviewed and what gets left open.

Work gate modes (2026-11-15) make this sharper. The self-review fix gate
declares reach `worktree`, so under the `normal`, `quiet` and `yolo` modes
it answers itself with its recommended option. Whatever the gate
recommends is what most runs do.

## The four changes

### 1. Fix every finding by default

The self-review fix gate's options become **Fix every finding** (`all`,
always recommended) / **Fix the blocking findings only** (`blocking`) /
**Ship as is** (`none`). A mode therefore fixes everything.

`all` selects every finding. Two kinds are not fixed in the loop:

- a **judgment call**: the reviewer marked it so (the finding's fix line
  starts `Judgment call:` with a one-line reason). Only the reviewer makes
  this mark; the run never does. It is recorded as left open, and its
  reason goes in the merge request description's follow-up section.
- **owed evidence** (change 3).

"Pre-existing" and "a follow-up is fine" are not reasons to leave a
finding open. The reviewer's brief asks for the judgment-call mark and the
reachability line (change 2), so the run reads both from the draft instead
of deciding them itself.

Lives in: the self-review engine (`attachments/review/self-review/`): the
fix gate block, a new `Sort the finding` decision in the fix loop with
`Record the judgment call` and `Record the owed evidence` steps, the
reviewer dispatch's brief, and red flags. The unbound stage path
(`stage-self-review` with no domain review) fixes every finding except
those two kinds as well.

### 2. Pre-existing says whether it is reachable

A finding about code this change did not write states
`Reachable from this change: yes` or `no`. Reachable means this change
calls it, feeds it new inputs, or exposes it to new users. A reachable
finding is fixed like any other. An unreachable one may stay open only as
a judgment call whose reason says it is pre-existing and unreachable. A
pre-existing finding with no reachability line is treated as reachable.

Lives in: the reviewer brief (self-review's dispatch step) and the
`Sort the finding` section.

### 3. Owed evidence is a list ship must clear

A finding whose fix is evidence that can only be captured against the
pushed branch (an AFTER screenshot, a preview check) is owed evidence. It
is not left open and it is not a note.

**Carried as a run field, `owed-evidence`.** The stage writes it next to
`review`; ship reads it, captures each item, and marks it cleared. Run
fields are the mechanism the pipeline already uses to hand a value from
one stage to a later one (`commits`, `evidence`, `pushed`, `shipTarget`),
they survive compaction and resume, and ship can rewrite the list as it
clears it. A run decision is an answer record, not a work list ship
updates, and MR text is written by ship at its very end, so neither can
carry a list ship must clear first.

The value is a Markdown list, one item per line:

- `- [ ] <what to capture> (<finding id>)` while owed;
- `- [x] <short sha>: <what to capture> (<finding id>)` once captured on
  that pushed sha.

The field is not a declared produce: a pipeline without self-review never
writes it, and an unset or `-` field means nothing is owed. Self-review
appends and never drops an item, so a second self-review after a CI-fix
redirect keeps the list.

In ship, every item not cleared at the pushed sha joins the AFTER loop as
its own case, captured like any other case the domain names. After the
loop ship rewrites the field with the captured items marked. Just before
ship finishes, any item still not cleared at the pushed sha holds the
stage, naming the items. A later commit (a CI fix goes back through
implement, self-review and ship) moves the pushed sha, so every item
cleared at the older sha is owed again and ship captures it again.

Lives in: the self-review engine (records the item), `stage-self-review`
(writes the field), `stage-ship` (reads it, captures, marks, and holds).
The standalone `ship` door has no self-review before it and is unchanged.

### 4. Re-review the fix round

When the fix round changed code, the self-review engine re-reviews before
it closes. The re-review covers every change since the last full review,
not just the latest commit.

**How "since the last full review" is found.** At every full review
dispatch, the engine reads the head commit before it dispatches and
records that sha as the run field `self-review-head` (one `run_field_set`)
after, so a commit that lands during the review is not counted as
reviewed. The re-review's diff is
`git diff <self-review-head>` (committed and uncommitted changes since
that commit) plus untracked files, built the same way as the self-review
diff. A re-review does not move `self-review-head`, so a second re-review
again covers everything since the full review. When the tree was dirty at
the full review, the diff also holds changes that review already saw:
a superset, which is the safe direction.

The re-review assembles a draft and opens the same fix gate. With no
findings it closes. It is budgeted (`rereview-rounds`, limit 3, charged before each
dispatch, so two re-reviews run); a spent budget holds instead of closing
with an unreviewed fix round.

An owed item ship has no capture method for (an unbound, non-browser
case) is not skipped silently: it stays owed, and ship holds on it,
naming it for the operator.

The unbound stage path already loops back to a fresh review of
`<branch-point>..HEAD`, the whole branch, after each fix round, which
covers every fix commit; it gains the rule that the range is never
narrowed to the latest commit.

Lives in: the self-review engine graph (`Did the fix round change code?`,
a budget, `Re-review the fix round`) and `stage-self-review`.

## Not changed

- The shared review draft vocabulary (Critical / Important / Minor,
  `file:line`, fix) stays as it is; the judgment-call mark rides in a
  finding's fix line, so the board review and receive-review read drafts as
  before.
- No rt code or MCP tool changes: run fields take any key.
- Ship-time domain gates keep their own blocking rules.

## Team packs

A pack whose self-review or ship fills restate the old behaviour (fix
blocking by default, evidence deferred as a note, re-review of the latest
commit) updates them to match. A pack compile reads the installed engine,
so a pack sees the new engine text only after this change is released.
