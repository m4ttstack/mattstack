---
name: sync-open-mrs
disable-model-invocation: true
description: "Use when every open MR or PR should be brought current with the default branch in one sweep -- 'rebase all my open MRs', 'my branches are stale, sync them', batch maintenance after the default branch moved."
allowed-tools:
  - Bash(gh pr list:*)
  - Bash(git worktree list:*)
  - Bash(git -C * status:*)
  - Bash(git -C * log:*)
  - Bash(git -C * remote get-url:*)
type: pipeline-step
slots: {}
---

# sync-open-mrs

Bring every open MR or PR current with the default branch in one sweep:
rebase each, then offer to push and watch CI. The sweep covers the open
MRs the map returns: `mr_map` on GitLab, `map-open-mrs` on GitHub. This
verb owns the sequencing, the batch gates and the report. Discovery and CI
watching belong to the verbs it follows; rebasing belongs to
`branch_sync_sweep` and `branch_sync`. Gates stay human decisions: never
stash a tree, never resolve a conflict. `<checkout>`, and the `repoName`
the map and sweep calls take, are the current checkout's absolute path.

```dot
digraph sync_open_mrs {
    rankdir=TB;

    trigger_open_mrs_current [label="Trigger: every open MR should come current" shape=ellipse];
    run_enter [label="run_enter {flags, skillDir, stage: sync-open-mrs, runDb?, spawnedBy?}" shape=plaintext];
    run_enter_mode [label="sync-open-mrs run_enter mode?" shape=diamond];
    inherit_run [label="Inherit the run" shape=box];
    gate_resume_choice [label="Gate clarify: resume or start fresh" shape=box];
    clarify_answer [label="clarify answer?" shape=diamond];
    run_enter_resume [label="run_enter {flags, skillDir, stage: sync-open-mrs, resume: <picked runId>}" shape=plaintext];
    run_enter_fresh [label="run_enter {flags, skillDir, stage: sync-open-mrs, fresh: true, spawnedBy?}" shape=plaintext];
    why_refused [label="Why was run_enter refused?" shape=diamond];
    refused_reported [label="run_enter refused: reported" shape=doublecircle];
    run_snapshot [label="run_snapshot {runDb: <resumed>}" shape=plaintext];
    keep_recorded_answers [label="Keep the recorded answers" shape=box];
    git_remote_url [label="git -C <checkout> remote get-url origin" shape=plaintext];
    forge_host [label="Forge?" shape=diamond];
    mr_map [label="mr_map {repoName, author: me}" shape=plaintext];
    mr_map_result [label="mr_map result?" shape=diamond];
    stop_gitlab_mr_read [label="STOP: GitLab MR reads go through mr_map" shape=octagon style=filled fillcolor=red fontcolor=white];
    follow_map_open_mrs [label="Follow map-open-mrs for the table" shape=box];
    plan_sweep [label="Plan the sweep" shape=box];
    gate_sweep [label="Gate sweep" shape=box];
    sweep_answer [label="sweep answer?" shape=diamond];
    say_nothing_selected [label="Say nothing was selected" shape=box];
    all_selected [label="Every listed branch selected?" shape=diamond];
    branch_sync_sweep [label="branch_sync_sweep {repoName}" shape=plaintext];
    branch_sync_sweep_result [label="branch_sync_sweep result?" shape=diamond];
    record_sweep_result [label="Record every sweep result in its bucket" shape=box];
    selected_branches_left [label="Selected branches left?" shape=diamond];
    branch_sync [label="branch_sync {tree}" shape=plaintext];
    record_branch_bucket [label="Record the branch in its bucket" shape=box];
    branches_pull_left [label="Branches to pull left?" shape=diamond];
    git_pull [label="git_pull {tree}" shape=plaintext];
    git_pull_result [label="git_pull result?" shape=diamond];
    branch_sync_pulled [label="branch_sync {tree: <pulled tree>}" shape=plaintext];
    record_resync [label="Record the re-sync in its bucket" shape=box];
    tree_came_dirty [label="Any listed tree came back dirty?" shape=diamond];
    gate_dirty_trees [label="Gate clarify: dirty trees" shape=box];
    dirty_answer [label="dirty answer?" shape=diamond];
    retried_trees_left [label="Retried trees left?" shape=diamond];
    branch_sync_retried [label="branch_sync {tree: <retried tree>}" shape=plaintext];
    record_retry_bucket [label="Record the retry in its bucket" shape=box];
    rebased_still_unpushed [label="Any rebased, still unpushed?" shape=diamond];
    summarize_rebase_pass [label="Summarize the rebase pass" shape=box];
    gate_push [label="Gate push" shape=box];
    push_answer [label="push answer?" shape=diamond];
    selected_pushes_left [label="Selected pushes left?" shape=diamond];
    git_push_force_lease [label="git_push {tree, forceWithLease: true}" shape=plaintext];
    git_push_result [label="git_push result?" shape=diamond];
    record_pushed [label="Record pushed" shape=box];
    record_push_failed_quoted [label="Record push failed, reason quoted" shape=box];
    record_push_failed_mechanical [label="Record push failed, mechanical" shape=box];
    mechanical_push_failure [label="Any mechanical push failure?" shape=diamond];
    stop_shell_push [label="STOP: push only with git_push" shape=octagon style=filled fillcolor=red fontcolor=white];
    gate_off_script [label="Off-script gate" shape=box];
    off_script_answer [label="off-script answer?" shape=diamond];
    off_script_rounds_spent [label="Off-script rounds = 2?" shape=diamond];
    queue_mechanical_failures [label="Queue the mechanical failures again" shape=box];
    make_recorded_move [label="Make the recorded move once per listed branch" shape=box];
    watch_ci_asked [label="Watch CI asked?" shape=diamond];
    follow_watch_ci [label="Follow watch-ci per pushed branch" shape=box];
    report_branch_buckets [label="Report every branch in one bucket" shape=box];
    run_started_here [label="Started or resumed this run here?" shape=diamond];
    sweep_abandoned [label="Sweep abandoned?" shape=diamond];
    run_close_done [label="run_close {runDb, workType: sync-open-mrs, stage: sync-open-mrs, outcome: done}" shape=plaintext];
    run_close_abandoned [label="run_close {runDb, workType: sync-open-mrs, stage: sync-open-mrs, outcome: abandoned, reason}" shape=plaintext];
    inherited_sweep_abandoned [label="Inherited sweep abandoned?" shape=diamond];
    rt_too_old [label="rt too old: told the user to update" shape=doublecircle];
    held_end_turn [label="Held: end the turn naming the gate" shape=doublecircle];
    abandoned [label="Sweep abandoned" shape=doublecircle];
    sweep_reported [label="Sweep reported" shape=doublecircle style=filled fillcolor=lightgreen];

    trigger_open_mrs_current -> run_enter;
    run_enter -> run_enter_mode;
    run_enter_resume -> run_enter_mode;
    run_enter_fresh -> run_enter_mode;
    run_enter_mode -> git_remote_url [label="started"];
    run_enter_mode -> inherit_run [label="inherited"];
    run_enter_mode -> run_snapshot [label="resumed"];
    run_enter_mode -> gate_resume_choice [label="candidates"];
    run_enter_mode -> why_refused [label="refused, or the tool is missing"];
    why_refused -> run_enter_fresh [label="a resume of a run that is gone or no longer running: say so, start fresh"];
    why_refused -> rt_too_old [label="no run_enter tool"];
    why_refused -> refused_reported [label="anything else: quote it"];
    inherit_run -> git_remote_url;
    gate_resume_choice -> clarify_answer;
    clarify_answer -> run_enter_resume [label="resume a candidate"];
    clarify_answer -> run_enter_fresh [label="start fresh"];
    clarify_answer -> held_end_turn [label="hold"];
    run_snapshot -> keep_recorded_answers;
    keep_recorded_answers -> git_remote_url;
    git_remote_url -> forge_host;
    forge_host -> mr_map [label="GitLab"];
    forge_host -> follow_map_open_mrs [label="GitHub"];
    forge_host -> stop_gitlab_mr_read [label="tempted to use the GitLab CLI"];
    stop_gitlab_mr_read -> mr_map;
    mr_map -> mr_map_result;
    mr_map_result -> plan_sweep [label="rows"];
    mr_map_result -> report_branch_buckets [label="GitLab error: quoted"];
    follow_map_open_mrs -> plan_sweep;
    plan_sweep -> gate_sweep;
    gate_sweep -> sweep_answer;
    sweep_answer -> all_selected [label="proceed with branches"];
    sweep_answer -> say_nothing_selected [label="proceed with none selected"];
    sweep_answer -> plan_sweep [label="iterate"];
    sweep_answer -> held_end_turn [label="hold"];
    say_nothing_selected -> run_started_here;
    all_selected -> branch_sync_sweep [label="yes: all four conditions hold"];
    all_selected -> selected_branches_left [label="no: per branch, in the answer's order"];
    branch_sync_sweep -> branch_sync_sweep_result;
    branch_sync_sweep_result -> record_sweep_result [label="results"];
    branch_sync_sweep_result -> selected_branches_left [label="error: per branch over the selected rows"];
    record_sweep_result -> branches_pull_left;
    selected_branches_left -> branch_sync [label="yes"];
    selected_branches_left -> branches_pull_left [label="no"];
    branch_sync -> record_branch_bucket;
    record_branch_bucket -> selected_branches_left;
    branches_pull_left -> git_pull [label="yes"];
    branches_pull_left -> tree_came_dirty [label="no"];
    git_pull -> git_pull_result;
    git_pull_result -> branch_sync_pulled [label="fast-forwarded"];
    git_pull_result -> record_resync [label="error: skipped, quoted"];
    branch_sync_pulled -> record_resync;
    record_resync -> branches_pull_left;
    tree_came_dirty -> gate_dirty_trees [label="yes"];
    tree_came_dirty -> rebased_still_unpushed [label="no"];
    gate_dirty_trees -> dirty_answer;
    dirty_answer -> retried_trees_left [label="proceed: retry the picked trees, the rest skipped"];
    dirty_answer -> held_end_turn [label="hold"];
    retried_trees_left -> branch_sync_retried [label="yes"];
    retried_trees_left -> rebased_still_unpushed [label="no"];
    branch_sync_retried -> record_retry_bucket;
    record_retry_bucket -> retried_trees_left;
    rebased_still_unpushed -> summarize_rebase_pass [label="yes"];
    rebased_still_unpushed -> report_branch_buckets [label="no"];
    summarize_rebase_pass -> gate_push;
    gate_push -> push_answer;
    push_answer -> selected_pushes_left [label="proceed"];
    push_answer -> summarize_rebase_pass [label="iterate"];
    push_answer -> held_end_turn [label="hold"];
    selected_pushes_left -> git_push_force_lease [label="yes"];
    selected_pushes_left -> mechanical_push_failure [label="no"];
    git_push_force_lease -> git_push_result;
    git_push_result -> record_pushed [label="pushed"];
    git_push_result -> record_push_failed_quoted [label="safety refusal: lease, protected or default branch, detached HEAD, upstream mismatch"];
    git_push_result -> record_push_failed_mechanical [label="not registered with rt"];
    git_push_result -> record_push_failed_quoted [label="any other error"];
    record_pushed -> selected_pushes_left;
    record_push_failed_quoted -> selected_pushes_left;
    record_push_failed_mechanical -> selected_pushes_left;
    mechanical_push_failure -> stop_shell_push [label="yes"];
    mechanical_push_failure -> watch_ci_asked [label="no"];
    stop_shell_push -> gate_off_script;
    gate_off_script -> off_script_answer;
    off_script_answer -> make_recorded_move [label="take"];
    off_script_answer -> off_script_rounds_spent [label="iterate: the human fixed it, retry"];
    off_script_answer -> watch_ci_asked [label="hand back: they stay push failed"];
    off_script_answer -> held_end_turn [label="hold"];
    off_script_rounds_spent -> queue_mechanical_failures [label="no"];
    off_script_rounds_spent -> watch_ci_asked [label="yes: they stay push failed"];
    queue_mechanical_failures -> selected_pushes_left;
    make_recorded_move -> watch_ci_asked;
    watch_ci_asked -> follow_watch_ci [label="yes"];
    watch_ci_asked -> report_branch_buckets [label="no"];
    follow_watch_ci -> report_branch_buckets;
    report_branch_buckets -> run_started_here;
    run_started_here -> sweep_abandoned [label="yes"];
    run_started_here -> inherited_sweep_abandoned [label="no: inherited, close nothing"];
    sweep_abandoned -> run_close_done [label="no"];
    sweep_abandoned -> run_close_abandoned [label="yes"];
    run_close_done -> sweep_reported;
    run_close_abandoned -> abandoned;
    inherited_sweep_abandoned -> sweep_reported [label="no"];
    inherited_sweep_abandoned -> abandoned [label="yes"];
}
```

### Inherit the run

`run_enter` returned `mode: inherited`: a caller handed a `runDb` whose run
is still running, and you were invoked from inside it. The result's
`at.stage` is your stage, and you close nothing at the end. A handed
`runDb` whose run is no longer running is not inherited: the result says
`handedRunDb: "not-running"` and the run starts or lists as if none was
handed.

### Gate clarify: resume or start fresh

The candidates are `run_enter`'s `candidates` (running sync-open-mrs runs
in this repo); never list, read or build run dbs by hand. A surface-launched
pane never reaches this gate: with `spawnedBy` and no `resume`, `run_enter`
starts fresh.

Scope `clarify`. One sentence naming each candidate's `spawnedBy`,
`startedAt`, and `currentStage`, then one **Resume** option per candidate
(recommended for `ownSession: true`; a run another live pane owns is not
yours) / **Start fresh**; **Hold**.

Resume passes the picked candidate's `runId` as `resume`; the result's
`runDb` is the one to keep. `run_enter` adopts the running attempt,
re-records this session and clears a `hold`, so nothing else is written.
Start fresh passes `fresh: true`.

### Why was run_enter refused?

Start fresh only when the refused call carried `resume` and the refusal
says that run is gone or no longer running (`no run <id>`, `run <id> is
<status>`); say so in one line, then start fresh, keeping the first call's
`spawnedBy`. Any other refusal, a resume one included (a locked or
unreadable run db, stages that do not match the pack), ends the verb:
quote it verbatim and start nothing, since the picked run is still
running. Only when there is no `run_enter` tool at all, say rt predates
the run tools; update rt.

### Keep the recorded answers

The decisions the resumed `run_snapshot` shows are answers already given.
Each gate step that finds its scope's decision there takes it instead of
asking again, but only a proceed decision for that gate counts: one whose
`next` is iterate or hold is not an answer, and a gate reached again after
an iterate edge always asks afresh (a re-ask after Hold or Iterate opens a
new gate). **Resumed run already holds this gate's decision?** reads this
rule.

### mr_map result?

**rows**: the call returned `{rows, complete}` with `repoName` = the
checkout's absolute path; each row is a map row (`ref`, `title`, `author`,
`sourceBranch`, and `worktree`, where null is a NONE row), and its `dirty`
and the result's `complete` feed the plan. **GitLab error**: there is no
map, so nothing is planned, rebased or pushed; the report's one line is
the error, quoted, and the sweep ends abandoned.

### Follow map-open-mrs for the table

The GitHub path. Follow the pack's compiled `map-open-mrs` verb
(`../map-open-mrs/SKILL.md`, relative to this file, when the pack compiles
both on the same side; a different surface changes the path) and get its
table: MR ref, title, author, source branch, worktree path or NONE.

### Plan the sweep

One sentence: how many branches rebase, how many are skipped up front and
why. Skipped up front: NONE rows, with nothing local to rebase, and trees
`branch_sync` would refuse as dirty. On GitLab a row's `dirty` decides:
`true` is a dirty tree, and `null` with a tree means the read failed, so
the tree is not known clean and is skipped too, saying so. On GitHub,
a tree whose `git -C <tree> status --porcelain` is not empty is the dirty
one. When the map was cut short, the same sentence says so: on GitLab,
`complete: false` means it was cut at 200 open MRs; on GitHub, exactly 200
rows from `gh pr list` means it was cut at 200 open PRs. Every row of the map is the signed-in user's own MR, so every branch
starts pre-selected; deselecting skips it.

**These thoughts mean you are skipping the gate -- STOP:**

| Thought | Reality |
|---------|---------|
| "I'll list the dirty tree too and let the rebase step refuse it" | The sweep form lists only branches the sweep will rebase; a tree the rebase would refuse is a skipped row, named up front with its reason. |

### Gate sweep

Scope `sweep`, once for the whole batch, never per branch. The questions,
each its own question (never fold one list into another: a question over 4
options sends the whole gate to the wait queue):

- `branches`: a multi-select of the branches to rebase, in order,
  pre-selected by the rule under **Plan the sweep** (deselecting skips
  one); over 4 branches it splits into `branches-1`, `branches-2`, ... of
  up to 4 options each, in order, whose answers read as one union
- `next`: **Proceed** (recommended) / **Iterate here** (their text
  reorders or excludes) / **Hold**

Selection `{"branches":[...]}`. Nothing is touched before the answer.
Read `next` first: **Hold** ends the turn with nothing rebased; **Iterate
here** goes back to **Plan the sweep** and ignores `branches`; only
**Proceed** applies the selection.
**Proceed** with an empty `branches` union is "proceed with none selected".

### Say nothing was selected

One sentence: no branch was selected, so nothing is rebased or pushed. The
sweep ends abandoned; a run this verb started closes as `abandoned`.

### Every listed branch selected?

`branch_sync_sweep` reads its own MR list and syncs (and pushes) every
branch of yours that has a tree, not the form's list. So the answer is yes
only when all four hold:

- the map was complete (`mr_map`'s `complete` is true on GitLab; fewer
  than 200 rows from `gh pr list` on GitHub),
- the plan skipped no tree up front (no `dirty: true`, no `dirty: null`
  with a worktree on GitLab, no non-empty porcelain read on GitHub), so
  the sweep visits no tree outside the form; a NONE row does not count,
- every listed branch is selected,
- the answer asked for no reorder.

Anything else is no: the per-branch path, one `branch_sync {tree}` per
selected branch in the answer's order.

### branch_sync_sweep result?

**results**: the call returned `{repoName, results, noTree, complete}`.
**error**: the call itself failed (it could not list). On error, take the
per-branch loop over the selected rows (the map already listed them) and
put the sweep's error in the report.

### Record every sweep result in its bucket

Each entry of `results` goes into its bucket by the table under **Record
the branch in its bucket**; each `noTree` row is skipped: no worktree.
`complete: false` is one report line: the forge may have cut the MR list
short. A result for a branch the map did not list (an MR opened after the
map) lands in its bucket like any other and the report names it as one the
map did not list.

### Record the branch in its bucket

The `branch_sync` result's `kind` decides the bucket. No branch's outcome
blocks the rest of the sweep:

| result | bucket |
|---|---|
| `synced`, `pushed: true` | pushed ("pushed by branch_sync") |
| `synced`, `pushed: false` | rebased, still unpushed (origin does not hold the new head) |
| `up-to-date` | current |
| `conflict` | needs-hands, files from `unresolvedFiles`; the rebase stays paused |
| `push-refused` | rebased, still unpushed (to the push gate) |
| `stacked-refused`, `stack-unverified` | skipped, `refusal` quoted |
| `error` whose refusal says "run git_pull first" | the pull pass (first time only); after the pull pass, skipped with the refusal |
| `dirty-tree` on a branch the form listed | the dirty gate (first time only); after the retry, skipped: dirty tree |
| any other `error` (a preflight refusal, a sweep tree refusal, an rt sync failure) | skipped, `refusal` quoted |
| a `git_pull` error | skipped, the error quoted |
| a sweep `noTree` row, a map NONE row | skipped: no worktree |
| a branch deselected at the sweep gate | skipped at the gate, reported, never synced |

A sweep `dirty-tree` result for a branch the map did not list is reported
and skipped: dirty tree, never gated.

A branch passes the pull pass and the dirty gate at most once each, so
neither loops. The pushed and rebased lines carry the move as sha +
subject: read `git -C <tree> log -1 --oneline --no-decorate <oldHead>` and
the same for `<newHead>`.

### Record the re-sync in its bucket

The pull pass's `branch_sync` result, or the `git_pull` error, goes into
its bucket by the table under **Record the branch in its bucket**. A
second "run git_pull first" refusal is skipped with the refusal.

### Gate clarify: dirty trees

Scope `clarify:dirty-trees`, once for the batch of listed branches that
came back `dirty-tree`. One sentence per tree listing its uncommitted
`paths` (when `paths` is absent, quote `refusal` instead). The questions, each its own question:

- `retry`: a multi-select "I committed them, retry" of those branches,
  none pre-selected; over 4 branches it splits into `retry-1`, `retry-2`,
  ... of up to 4 options each, whose answers read as one union
- `next`: **Proceed** (recommended) / **Hold**

Selection `{"retry":[...]}`. Read `next` first: **Hold** ends the turn
with nothing more synced; **Proceed** re-syncs the picked trees once and
leaves the rest skipped (dirty tree, aborted by the human). Never stash.

### Record the retry in its bucket

The retried tree's `branch_sync` result goes into its bucket by the table
under **Record the branch in its bucket**. A second `dirty-tree` is
skipped: dirty tree. A retry that returns "run git_pull first" is skipped
with the refusal quoted: the pull pass has already run.

### Summarize the rebase pass

One sentence: which branches rebased clean (the old and new sha + subject
each, "pushed by branch_sync" where that happened), which are rebased but
still unpushed, and which were already current.

### Gate push

Scope `push`, once for the batch of still-unpushed branches; never push one
of those unasked, never one by one as each rebase completes. The
questions, each its own question (never fold one list into another: a
question over 4 options sends the whole gate to the wait queue):

- `branches`: a multi-select of the clean, still-unpushed branches to
  push with force-with-lease, all pre-selected; over 4 branches it
  splits into `branches-1`, `branches-2`, ... of up to 4 options each,
  in order, whose answers read as one union
- `watch_ci`: **Watch CI after pushing** (yes / no)
- `next`: **Proceed** (recommended) / **Iterate here** / **Hold**

Selection `{"branches":[...],"watch_ci":true|false}`. Read `next` first:
**Hold** ends the turn with nothing pushed; **Iterate here** goes back to
**Summarize the rebase pass** and ignores `branches` and `watch_ci`; only
**Proceed** applies the selection. Each selected branch then goes to
`git_push` with `tree` = its worktree path.

### Record pushed

The branch lands in the pushed bucket.

### Record push failed, reason quoted

The branch lands in push failed with the `git_push` error quoted as the
reason, and the rest carry on. A safety refusal (lease, protected or
default branch, detached HEAD, upstream mismatch) is a verdict on that
branch: never gated, never retried; so is any other `git_push` error.

### Record push failed, mechanical

The branch lands in push failed with the "not registered with rt" refusal
quoted, marked mechanical. The rest carry on; the mechanical ones go to the
batch off-script gate once the queue is empty.

### Off-script gate

Scope `off-script:<run.current_stage>:<n>`, `n` counting from 1 per
off-script round in this sweep. One gate for the whole batch: the context
sentence quotes each mechanical refusal with its branch. The questions,
each its own question:

- `action`: **Take the proposed move** (the value spells the move in full,
  one move per branch) / **Hand back**
- `next`: **Proceed** (recommended) / **Iterate here** / **Hold**

Selection `{"move":"<one move per listed branch>","why":"<each refusal>","action":"take|handback","next":"proceed|iterate|hold","note":"<their words or null>"}`.
Read `next` first: **Hold** ends the turn with no move made; **Iterate
here** means the human fixed the cause and wants those pushes retried, and
it ignores `action`; only **Proceed** applies `action`, where **Hand back**
leaves them push failed. The proposed move is the same plain-git
force-with-lease push, once per listed branch; retrying the refused tool is
**Iterate here**, never **Take**.

### Queue the mechanical failures again

Every branch recorded push failed, mechanical goes back into the push
queue for this round. Branches already pushed or failed for a safety reason
stay where they are.

### Make the recorded move once per listed branch

Exactly the move the selection recorded, once for each listed branch. Each
branch's result moves it to pushed or leaves it push failed with the new
error quoted; a failure is reported, never a second off-script gate.

### Follow watch-ci per pushed branch

Follow the pack's compiled `watch-ci` verb (a public verb; invoke it by its
pack-qualified skill name) per pushed branch. It inherits this run and its
`runDb`, hands back its verdict, and closes nothing.

### Report every branch in one bucket

One table, every branch from the map landing in exactly one
bucket: rebased, still unpushed (old and new sha + subject), pushed,
current (nothing to push), conflicted (needs-hands, with its files), push
failed (with reason), or skipped (with reason: dirty tree, a `refusal`, a
`git_pull` error, no worktree). Below it: a branch the sweep synced that
the map did not list, the sweep's error when the sweep fell to the
per-branch path, and the `complete: false` line when the sweep returned it.
When `mr_map` failed there is no table: the report is that one line, the
GitLab error quoted.

### Starting the run

The `run_enter` nodes: `flags` is the compiled flag text below, verbatim;
`skillDir` is this skill's own directory; `stage` is `sync-open-mrs`;
`runDb` only when a caller handed one; add `spawnedBy` when a board or
another surface launched this pane.

{{run-start.flags:sync-open-mrs}}

Keep the result's `runDb` and pass it to every `run_*` call; nothing is
exported. The close is `run_close` only on a run this verb started or
resumed; `reason` on an abandoned close is the why, quoted when it is an
error.

## Gates

Every gate box above runs this graph.

```dot
digraph gate_steps {
    rankdir=TB;

    trigger_gate_box [label="Trigger: a gate box in the graph above" shape=ellipse];
    holds_rundb [label="This conversation holds a runDb?" shape=diamond];
    pane_form_only [label="In-pane form only; nothing recorded" shape=box];
    resumed_holds_decision [label="Resumed run already holds this gate's decision?" shape=diamond];
    publish_answer [label="Publish and answer per the gate protocol" shape=box];
    answer_back [label="Answer back at the gate box" shape=doublecircle style=filled fillcolor=lightgreen];

    trigger_gate_box -> holds_rundb;
    holds_rundb -> resumed_holds_decision [label="yes"];
    holds_rundb -> pane_form_only [label="no: the resume question, launched by hand"];
    pane_form_only -> answer_back;
    resumed_holds_decision -> answer_back [label="yes: take the recorded answer"];
    resumed_holds_decision -> publish_answer [label="no"];
    publish_answer -> answer_back;
}
```

### In-pane form only; nothing recorded

Only the resume question runs with no run: a human launched this pane and
no run exists yet. It gets the form in the pane, and no `run_*` call is
made.

### Publish and answer per the gate protocol

Under the run, every gate tool call passes `runDb` and `stage:
sync-open-mrs`, so the tools bracket and record the gate: `gate_ask` writes
the run's `gate` field, and `gate_answer` or `gate_reconcile` records the
answers map as the scope's `gate@1` decision (`gate_record` where the
protocol draws it). Nothing here writes the `gate` field or the decision
by hand: a second record moves the decision's time. The recorded
selection is that answers map, keyed by the question ids each gate names,
`next` included; each `Selection` line names those keys.

If a rule below asks for a move this graph marks STOP, take the off-script edge instead.

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
