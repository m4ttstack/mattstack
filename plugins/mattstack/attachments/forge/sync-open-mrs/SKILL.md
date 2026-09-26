---
name: sync-open-mrs
disable-model-invocation: true
description: "Use when every open MR or PR should be brought current with the default branch in one sweep -- 'rebase all my open MRs', 'my branches are stale, sync them', batch maintenance after the default branch moved."
allowed-tools:
  - Bash(gh pr list:*)
  - Bash(git worktree list:*)
type: pipeline-step
slots: {}
---

# sync-open-mrs

Batch maintenance for "all my open MRs are stale": discover the open items
the forge lists, rebase each onto the default branch, and offer to push
and watch CI, all in one sweep. This skill is a delegator -- it owns sequencing, the user
gates, and the final report; discovery, rebasing, and CI watching belong to
a focused skill it calls, not reimplemented here.

## Run

Outside a pipeline this verb is its own run, so the console shows it and
the Stop hook covers its pane. Skip this section when this conversation
already holds a run's `runDb` (the calling verb handed it in) and the
`run_snapshot` tool with that `runDb` shows `run.status` = `running`: you
were invoked from inside that run, you inherit it, `run.current_stage` is
your stage, and you close nothing at the end.

Otherwise, when a surface launched this pane (the `spawnedBy` case
below), start fresh: another pane's live run is not yours to resume.
Launched by hand, first the Resume offer: call the `run_list` tool with
`repo` = the `--repo` value in the flags block below, and keep the runs
whose `status` is `running` and `work_type` is `sync-open-mrs`; never
read the run dbs by hand. Any found: gate
`clarify`, one sentence naming each candidate's `spawned_by`, `started_at`,
and `current_stage`, then the structured-question tool with one **Resume**
option per candidate (recommended for a run this session started earlier; a
run another live pane owns is not yours) / **Start fresh**; **Hold**.
Resume: the candidate's `runDb` is `~/.mattstack/runs/<repo>/<id>/state.db`
built from the row's `repo` and `id`, with `~` expanded to the home
directory. Keep it, then call `run_stage` with that `runDb`, `action`
`start`, `stage` `sync-open-mrs` (a new attempt, which re-records this
session) and `run_field_set` with `key` `hold`, `value` `-`, `stage`
`sync-open-mrs`; re-enter with the decisions `run_snapshot` shows and do
not re-ask a question it already answered.

Fresh. Start the run with the `run_start` tool: `flags` is the compiled
flag text below, verbatim; `skillDir` is this skill's own directory; add
`spawnedBy` when a board or another surface launched this pane.

{{run-start.flags:sync-open-mrs}}

The result must carry `ok: true` and a `runDb`. Anything else means this rt
predates the run tools: stop and tell the user to update rt. Keep `runDb`
and pass it to every `run_*` call below; nothing is exported. Then call
`run_stage` with `action` `start`, `stage` `sync-open-mrs`.

Every gate in this verb then writes its `gate` field and its decision with
`stage` `sync-open-mrs`. The close, after the final gate's answer and only
when this section ran `run_start`: `run_stage` with `action` `done`,
`stage` `sync-open-mrs`, then `run_status` with `status` `done` (or
`abandoned` when the gate said so).

## 1. Discover

Follow the pack's compiled `map-open-mrs` verb (`../map-open-mrs/SKILL.md`,
relative to this file, when the pack compiles both on the same side; a
different surface changes the path) and get its table: MR ref, title,
author, source branch, worktree path or NONE.

## 2. Plan the sweep, then gate `sweep`

One sentence: how many branches rebase, how many are skipped up front (NONE
rows with nothing local to rebase, trees whose `git status --porcelain`
is not empty, which `rebase-worktree` would refuse, and, when the user's
forge username is known, MRs whose author is someone else) and why. When
the username is not known, the sentence also says the author could not be
confirmed, and each `branches` option's label carries its MR's author
(`<branch> (by <author>)`). Every branch starts pre-selected only when the
username is known; otherwise every option starts deselected and the
human picks their own, because step 3's fast path pushes without a gate,
so a pre-checked teammate branch would be force-pushed on one click. Then the gate, once for the whole batch, never
per branch:

- The `run_field_set` tool with the run's `runDb`, `key` `gate`, `value` `sweep`, `stage` `sync-open-mrs`.
- Run gate-protocol's Runs integration with kind `sweep` and these
  questions, each its own question (never fold one list into another --
  a question over 4 options sends the whole gate to the wait queue):
  - `branches`: a multi-select of the branches to rebase, in order,
    pre-selected by the rule above (deselecting skips one); over 4 branches it splits into
    `branches-1`, `branches-2`, ... of up to 4 options each, in order,
    whose answers read as one union
  - `next`: **Proceed** (recommended) / **Iterate here** (their text
    reorders or excludes) / **Hold**
- The `run_decision` tool with the run's `runDb`, `contract` `gate@1`, `scope` `sweep`, `selection` `{"branches":[...]}`, `decidedBy` `<the answer's by>`.

Nothing is touched before the answer.

## 3. Rebase each branch

In the order from step 2, follow the pack's compiled `rebase-worktree` verb
(a public verb; invoke it by its pack-qualified skill name) per branch. A
conflict stops only that branch -- `rebase-worktree` hands it back
mid-rebase; record it in a needs-hands list and move on. A precondition
refusal (dirty tree, no upstream) stops it too -- record it as skipped with
the reason and move on. So does any other stop (a `branch_sync` refusal
such as "run git_pull first", a stack refusal, a `git_rebase` error):
skipped, with its error text as the reason. None of these ever blocks the
rest of the sweep.
A branch `rebase-worktree` synced through `branch_sync` comes back
already pushed ("pushed by branch_sync"); record it as pushed. One that
comes back "already current; nothing pushed" is recorded as current. A
branch that took its manual path comes back with the push still to
decide -- defer that; step 4 makes the push call once for all of those.

## 4. Gate `push`, then watch CI

Once the rebase pass finishes, one sentence: which branches rebased clean
(old head -> new head each, "pushed by branch_sync" where that happened,
with any "stack check covered <scope> only" caveat a branch handed back)
and which were already current. Then the gate, once for the batch of
still-unpushed branches; never push one of those unasked, never
one-by-one as each rebase completes:

- The `run_field_set` tool with the run's `runDb`, `key` `gate`, `value` `push`, `stage` `sync-open-mrs`.
- Run gate-protocol's Runs integration with kind `push` and these
  questions, each its own question (never fold one list into another --
  a question over 4 options sends the whole gate to the wait queue):
  - `branches`: a multi-select of the clean, still-unpushed branches to
    push with force-with-lease, all pre-selected; over 4 branches it
    splits into `branches-1`, `branches-2`, ... of up to 4 options each,
    in order, whose answers read as one union
  - `watch_ci`: **Watch CI after pushing** (yes / no)
  - `next`: **Proceed** (recommended) / **Iterate here** / **Hold**
- The `run_decision` tool with the run's `runDb`, `contract` `gate@1`, `scope` `push`, `selection` `{"branches":[...],"watch_ci":true|false}`, `decidedBy` `<the answer's by>`.

Push each selected branch with the `git_push` tool, `tree` = its worktree
path and `forceWithLease: true`. A `git_push` error (a lease refusal, a
protected branch) records that branch as push failed, with the error as
the reason, and the rest carry on. Then, when asked, follow the pack's
compiled `watch-ci` verb (a public verb; invoke it by its pack-qualified skill name)
per pushed branch (it inherits this run and hands back its verdict).

## 5. Report

One table, every branch from step 1 landing in exactly one bucket:
rebased (old head -> new head), pushed, current (nothing to push),
conflicted (needs-hands), push failed (with reason), or skipped (with reason -- dirty tree, no upstream, NONE row, another
author's MR).

**These thoughts mean you are skipping the gate -- STOP:**

| Thought | Reality |
|---------|---------|
| "I'll list the dirty tree too and let the rebase step refuse it" | The sweep form lists only branches the sweep will rebase; a tree the rebase would refuse is a skipped row, named up front with its reason. |

Close, only when `## Run` started this run: after the report, `run_stage`
with the run's `runDb`, `action` `done`, `stage` `sync-open-mrs`, then
`run_status` with `status` `done`. The per-branch `rebase-worktree` and
`watch-ci` calls inherit this run and its `runDb`, and close nothing.

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
