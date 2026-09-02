---
name: sync-open-mrs
disable-model-invocation: true
description: "Use when every open MR or PR should be brought current with the default branch in one sweep -- 'rebase all my open MRs', 'my branches are stale, sync them', batch maintenance after the default branch moved."
allowed-tools:
  - Bash(gh pr list:*)
  - Bash(glab mr list:*)
  - Bash(git worktree list:*)
type: pipeline-step
slots: {}
---

# sync-open-mrs

Batch maintenance for "all my open MRs are stale": discover every open
item, rebase each onto the default branch, and offer to push and watch CI,
all in one sweep. This skill is a delegator -- it owns sequencing, the user
gates, and the final report; discovery, rebasing, and CI watching belong to
a focused skill it calls, not reimplemented here.

## Run

Outside a pipeline this verb is its own run, so the console shows it and
the Stop hook covers its pane. Skip this section when `RT_RUN_DB` is set
and `rt runs snapshot` shows `run.status` = `running`: you were invoked
from inside that run, you inherit it, `run.current_stage` is your stage,
and you close nothing at the end.

Otherwise, when a surface launched this pane (the `--spawned-by` case
below), start fresh: another pane's live run is not yours to resume.
Launched by hand, first the Resume offer: list `~/.mattstack/runs/<repo>/`
(the `--repo` value in the flags block below) for runs whose `snapshot`
shows `run.status` = `running` and `run.work_type` = `sync-open-mrs` (read each with
`RT_RUN_DB` pointed at its `state.db`; never raw sqlite). Any found: gate
`clarify`, one sentence naming each candidate's `spawned_by`, `started_at`,
and `current_stage`, then the structured-question tool with one **Resume**
option per candidate (recommended for a run this session started earlier; a
run another live pane owns is not yours) / **Start fresh**; **Hold**.
Resume: `export RT_RUN_DB=<its state.db>`, then `rt runs stage-start --stage
sync-open-mrs` (a new attempt, which re-records this session) and `rt runs field set
hold - --stage sync-open-mrs`; re-enter with the snapshot's decisions and do not
re-ask a question it already answered.

Fresh. The flags for this verb, rendered by the compiler:

{{run-start.flags:sync-open-mrs}}

```bash
PACK_DIRS="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd -P)"
rt runs run-start <the flags above> --pack-dirs "$PACK_DIRS" [--spawned-by "<surface>"]
export RT_RUN_DB=<runDb from the response>
rt runs stage-start --stage sync-open-mrs
```

The response must parse as JSON with `ok: true` and a `runDb`; anything
else means this rt predates the run verbs: stop and tell the user to
update rt. Pass `--spawned-by` when a board or another surface launched
this pane.

Every gate in this verb then writes its `gate` field and its decision with
`--stage sync-open-mrs`. The close, after the final gate's answer and only
when this section ran `run-start`: `rt runs stage-done --stage
sync-open-mrs`, `rt runs run-status --status done` (or `abandoned` when
the gate said so), then `unset RT_RUN_DB`.

## 1. Discover

Follow the pack's compiled `map-open-mrs` verb (`../map-open-mrs/SKILL.md`,
relative to this file, when the pack compiles both on the same side) and get
its table: MR ref, title, source
branch, worktree path or NONE.

## 2. Plan the sweep, then gate `sweep`

One sentence: how many branches rebase, how many are skipped up front (NONE
rows with nothing local to rebase, and trees whose `git status --porcelain`
is not empty, which `rebase-worktree` would refuse) and why. Then the gate,
once for the whole batch, never per branch:

- `rt runs field set gate sweep --stage sync-open-mrs`.
- The form: a multi-select of the branches to rebase, in order, all
  pre-selected (deselecting skips one); **Iterate here** (their text
  reorders or excludes); **Hold**.
- `rt runs decision record --contract gate@1 --scope sweep --selection '{"branches":[...]}' --decided-by sync-open-mrs`.

Nothing is touched before the answer.

## 3. Rebase each branch

In the order from step 2, follow the pack's compiled `rebase-worktree` verb
(a public verb; invoke it by its pack-qualified skill name) per branch. A
conflict stops only that branch -- `rebase-worktree` hands it back
mid-rebase; record it in a needs-hands list and move on. A precondition
refusal (dirty tree, no upstream) stops it too -- record it as skipped with
the reason and move on; neither ever blocks the rest of the sweep.
`rebase-worktree` also asks per branch whether to push after a clean rebase
-- defer that; step 4 makes the push call once for the whole batch.

## 4. Gate `push`, then watch CI

Once the rebase pass finishes, one sentence: which branches rebased clean
(old head -> new head each). Then the gate, once for the batch; never push
a branch unasked, never one-by-one as each rebase completes:

- `rt runs field set gate push --stage sync-open-mrs`.
- The form: a multi-select of the clean branches to `git push
  --force-with-lease`, all pre-selected; **Watch CI after pushing** (yes /
  no); **Iterate here**; **Hold**.
- `rt runs decision record --contract gate@1 --scope push --selection '{"branches":[...],"watch_ci":true|false}' --decided-by sync-open-mrs`.

Push the selected branches, then, when asked, follow the pack's compiled
`watch-ci` verb (a public verb; invoke it by its pack-qualified skill name)
per pushed branch (it inherits this run and hands back its verdict).

## 5. Report

One table, every branch from step 1 landing in exactly one bucket:
rebased (old head -> new head), pushed, conflicted (needs-hands), or
skipped (with reason -- dirty tree, no upstream, NONE row).

**These thoughts mean you are skipping the gate -- STOP:**

| Thought | Reality |
|---------|---------|
| "I'll list the dirty tree too and let the rebase step refuse it" | The sweep form lists only branches the sweep will rebase; a tree the rebase would refuse is a skipped row, named up front with its reason. |

Close, only when `## Run` started this run: after the report, `rt runs
stage-done --stage sync-open-mrs`, `rt runs run-status --status done`,
`unset RT_RUN_DB`. The per-branch `rebase-worktree` and `watch-ci` calls
inherit this run and close nothing.

## Wrap-up form contract

{{include:wrap-up-form}}
