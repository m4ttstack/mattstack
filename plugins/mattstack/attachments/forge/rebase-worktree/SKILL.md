---
name: rebase-worktree
disable-model-invocation: true
description: "Use when one worktree's feature branch has fallen behind the default branch -- 'rebase this worktree', a stale MR branch. Not for resolving conflicts on its own or moving uncommitted work."
allowed-tools:
  - Bash(git -C * status:*)
  - Bash(git -C * log:*)
type: pipeline-step
slots: {}
---

# rebase-worktree

Bring one worktree's branch current with the default branch through the
`branch_sync` tool. This never guesses: it refuses on a dirty tree, refuses
a stack member, and hands conflicts back to a human.

`<tree>` is the worktree's absolute path. Each graph box has a section below. Every gate box runs the gate steps graph under **Gates**.

```dot
digraph rebase_worktree {
    rankdir=TB;

    bring_current [label="Trigger: one worktree's branch to bring current" shape=ellipse];
    git_status_branch [label="git -C <tree> status -sb" shape=plaintext];
    upstream_set [label="Upstream set?" shape=diamond];
    branch_sync [label="branch_sync {tree}" shape=plaintext];
    branch_sync_kind [label="branch_sync kind?" shape=diamond];
    stop_stash [label="STOP: never stash; gate the dirty tree" shape=octagon style=filled fillcolor=red fontcolor=white];
    gate_dirty_tree [label="Gate clarify: dirty tree" shape=box];
    tree_answer [label="tree answer?" shape=diamond];
    dirty_retries_spent [label="Dirty retries = 2?" shape=diamond];
    pulled_once [label="Pulled once already?" shape=diamond];
    git_pull [label="git_pull {tree}" shape=plaintext];
    git_pull_result [label="git_pull result?" shape=diamond];
    stop_hand_rebase [label="STOP: a refusal ends the run; never rebase by hand" shape=octagon style=filled fillcolor=red fontcolor=white];
    stop_resolve_conflict [label="STOP: never resolve a conflict; hand it back" shape=octagon style=filled fillcolor=red fontcolor=white];
    gate_conflict [label="Gate conflict:rebase-worktree:<attempt>" shape=box];
    conflict_answer [label="conflict answer?" shape=diamond];
    git_rebase_abort [label="git_rebase {tree, abort: true}" shape=plaintext];
    abort_succeeded [label="Abort succeeded?" shape=diamond];
    git_status_tree [label="git -C <tree> status" shape=plaintext];
    still_mid_rebase [label="Still mid-rebase?" shape=diamond];
    conflict_attempts_spent [label="Conflict attempts = 3?" shape=diamond];
    stop_touch_rebase [label="STOP: leave the rebase for the human" shape=octagon style=filled fillcolor=red fontcolor=white];
    git_log_head [label="git -C <tree> log -1 --oneline HEAD" shape=plaintext];
    head_unchanged [label="Head still the old head?" shape=diamond];
    git_log_old_head [label="git -C <tree> log -1 --oneline --no-decorate <oldHead>" shape=plaintext];
    git_log_new_head [label="git -C <tree> log -1 --oneline --no-decorate <newHead>" shape=plaintext];
    report_move [label="Report the move" shape=box];
    heads_equal [label="Old head = new head?" shape=diamond];
    sync_pushed [label="branch_sync pushed it?" shape=diamond];
    gate_push [label="Gate push" shape=box];
    push_answer [label="push answer?" shape=diamond];
    git_push_force_lease [label="git_push {tree, forceWithLease: true}" shape=plaintext];
    git_push_result [label="git_push result?" shape=diamond];
    stop_shell_push [label="STOP: push only with git_push" shape=octagon style=filled fillcolor=red fontcolor=white];
    gate_off_script [label="Off-script gate" shape=box];
    off_script_answer [label="off-script answer?" shape=diamond];
    make_recorded_move [label="Make the recorded move once" shape=box];
    recorded_move_succeeded [label="Recorded move succeeded?" shape=diamond];
    off_script_rounds_spent [label="Off-script rounds = 2?" shape=diamond];
    dirty_tree [label="Dirty tree: reported" shape=doublecircle];
    aborted_untouched [label="Aborted: nothing touched" shape=doublecircle];
    no_upstream [label="No upstream: reported" shape=doublecircle];
    refused [label="Refused: reported" shape=doublecircle];
    refused_stack_member [label="Refused: stack member, tool named" shape=doublecircle];
    stack_check_failed [label="Stack check could not run: reported" shape=doublecircle];
    left_mid_rebase [label="Left mid-rebase for the human" shape=doublecircle];
    aborted [label="Aborted" shape=doublecircle];
    abort_failed [label="Abort failed: error reported, tree left for the human" shape=doublecircle];
    aborted_by_human [label="Rebase aborted in the human's pane: reported" shape=doublecircle];
    rebased_unpushed [label="Rebased, left unpushed" shape=doublecircle];
    push_refused [label="Rebased, push refused: reported" shape=doublecircle];
    held_end_turn [label="Held: end the turn naming the gate" shape=doublecircle];
    done [label="Done: move reported" shape=doublecircle style=filled fillcolor=lightgreen];

    bring_current -> git_status_branch;
    git_status_branch -> upstream_set;
    upstream_set -> branch_sync [label="yes"];
    upstream_set -> no_upstream [label="no"];
    branch_sync -> branch_sync_kind;
    branch_sync_kind -> git_log_old_head [label="synced, up-to-date or push-refused"];
    branch_sync_kind -> gate_dirty_tree [label="dirty-tree"];
    branch_sync_kind -> gate_conflict [label="conflict"];
    branch_sync_kind -> refused_stack_member [label="stacked-refused"];
    branch_sync_kind -> stack_check_failed [label="stack-unverified"];
    branch_sync_kind -> pulled_once [label="error: refusal says run git_pull first"];
    branch_sync_kind -> refused [label="error: any other refusal or failure"];
    branch_sync_kind -> stop_stash [label="tempted to stash and proceed"];
    branch_sync_kind -> stop_hand_rebase [label="tempted to rebase by hand"];
    branch_sync_kind -> stop_resolve_conflict [label="tempted to resolve or continue it yourself"];
    stop_stash -> gate_dirty_tree;
    stop_hand_rebase -> refused;
    stop_resolve_conflict -> gate_conflict;
    gate_dirty_tree -> tree_answer;
    tree_answer -> dirty_retries_spent [label="I committed them, retry"];
    tree_answer -> aborted_untouched [label="abort"];
    tree_answer -> held_end_turn [label="hold"];
    dirty_retries_spent -> branch_sync [label="no"];
    dirty_retries_spent -> dirty_tree [label="yes"];
    pulled_once -> git_pull [label="no"];
    pulled_once -> refused [label="yes"];
    git_pull -> git_pull_result;
    git_pull_result -> branch_sync [label="fast-forwarded"];
    git_pull_result -> refused [label="error"];
    gate_conflict -> conflict_answer;
    conflict_answer -> left_mid_rebase [label="leave"];
    conflict_answer -> git_rebase_abort [label="abort"];
    conflict_answer -> held_end_turn [label="hold"];
    conflict_answer -> git_status_tree [label="iterate: the human worked in their pane"];
    git_rebase_abort -> abort_succeeded;
    abort_succeeded -> aborted [label="yes"];
    abort_succeeded -> abort_failed [label="no"];
    git_status_tree -> still_mid_rebase;
    still_mid_rebase -> conflict_attempts_spent [label="yes"];
    still_mid_rebase -> git_log_head [label="no"];
    conflict_attempts_spent -> gate_conflict [label="no: attempt n+1"];
    conflict_attempts_spent -> stop_touch_rebase [label="yes"];
    stop_touch_rebase -> left_mid_rebase;
    git_log_head -> head_unchanged;
    head_unchanged -> aborted_by_human [label="yes"];
    head_unchanged -> git_log_old_head [label="no: the rebase finished"];
    git_log_old_head -> git_log_new_head;
    git_log_new_head -> report_move;
    report_move -> heads_equal;
    heads_equal -> done [label="yes: already current, nothing pushed"];
    heads_equal -> sync_pushed [label="no"];
    sync_pushed -> done [label="yes: synced, pushed true"];
    sync_pushed -> gate_push [label="no: synced unpushed, push-refused, or the human finished the rebase"];
    gate_push -> push_answer;
    push_answer -> git_push_force_lease [label="push with force-with-lease"];
    push_answer -> rebased_unpushed [label="leave it unpushed"];
    push_answer -> report_move [label="iterate"];
    push_answer -> held_end_turn [label="hold"];
    git_push_force_lease -> git_push_result;
    git_push_result -> done [label="pushed"];
    git_push_result -> push_refused [label="safety refusal: lease, protected or default branch, detached HEAD, upstream mismatch"];
    git_push_result -> stop_shell_push [label="not registered with rt"];
    git_push_result -> push_refused [label="any other error"];
    stop_shell_push -> gate_off_script;
    gate_off_script -> off_script_answer;
    off_script_answer -> make_recorded_move [label="take"];
    off_script_answer -> off_script_rounds_spent [label="iterate: the human fixed it, retry"];
    off_script_answer -> push_refused [label="hand back"];
    off_script_answer -> held_end_turn [label="hold"];
    off_script_rounds_spent -> git_push_force_lease [label="no"];
    off_script_rounds_spent -> push_refused [label="yes"];
    make_recorded_move -> recorded_move_succeeded;
    recorded_move_succeeded -> done [label="yes"];
    recorded_move_succeeded -> push_refused [label="no"];
}
```

### branch_sync kind?

`branch_sync` does the fetch, the stack check, the rebase and the push in
one call, and returns `{kind, branch, oldHead, newHead, pushed, refusal?,
paths?}`. `kind` decides, and nothing else does:

| kind | next |
|---|---|
| `synced` | The branch moved. `pushed: true`: origin has it, so no push gate. `pushed: false`: origin's ref lacks the new head, so **Gate push** follows. |
| `up-to-date` | Nothing moved or was pushed. **Report the move** says "already current; nothing pushed". |
| `push-refused` | The rebase landed locally; the push failed. **Report the move** quotes `refusal`; **Gate push** follows. |
| `dirty-tree` | Nothing ran. **Gate clarify: dirty tree** with the result's `paths`. |
| `conflict` | The rebase is paused in the worktree. **Gate conflict:rebase-worktree:<attempt>** with the bundle's `unresolvedFiles`. Keep the result's `newHead` for **Head still the old head?**. |
| `stacked-refused` | **Refused: stack member, tool named**: quote `refusal` and name the tool it names. The restack belongs to that tool. |
| `stack-unverified` | **Stack check could not run: reported**: quote `refusal`, which says why. |
| `error` | Read `refusal`. When it says "run git_pull first" (the branch is only behind origin), go to **Pulled once already?**: one `git_pull {tree}`, then one more `branch_sync`. That phrase is the one text match in this skill. Any other refusal or failure: **Refused: reported** with `refusal`. |

| Thought | Reality |
|---|---|
| "The stack refusal came back, but the MR targets the default branch, so I'll rebase by hand" | `stacked-refused` is the guard's verdict, not a hint. The run ends reported; the restack is the named tool's. |
| "The stack check could not run, so I'll check the MRs myself and rebase" | `stack-unverified` ends the run. An unverified branch is never rebased, by hand or by another tool. |
| "`synced`, so now the push gate" | With `pushed: true` the push already happened; a push form would be a false choice. Report it as pushed. |
| "`synced` means pushed" | Read `pushed`. With `pushed: false` the new head is local only, and the push gate decides. |

### Gate clarify: dirty tree

Scope `clarify`. One sentence listing the uncommitted paths (the result's
`paths`; when absent, quote `refusal`), then two questions, each its own question:

- `tree`: **I committed them, retry** / **Abort**
- `next`: **Proceed** / **Hold**

Selection `{"tree":"retry|abort"}`. Read `next` first: **Hold** ends the
turn with nothing moved. Never stash and
proceed: moving someone's uncommitted work is not this skill's call. The
table under **Gate push** binds this form too.

{{include:spawned-no-run-guard}}

### Gate conflict:rebase-worktree:<attempt>

Scope `conflict:rebase-worktree:<attempt>`. One sentence listing the
conflicted files: the bundle's `unresolvedFiles`, or after an iterate the
unmerged (`both modified` and similar) entries of the
`git -C <tree> status` read.

`<attempt>` counts from 1. The questions, each its own question (never
fold one list into another: a question over 4 options sends the whole gate
to the wait queue):

- `conflict`: **Leave the rebase in progress for me** (recommended) /
  **Abort the rebase**
- `next`: **Proceed** (recommended) / **Iterate here** / **Hold**

Selection `{"next":"leave|abort|iterate|hold","note":"<their words or null>"}`.
The recorded `next` folds both questions into one value: **Hold** records
`hold` and ends the turn with nothing aborted; **Iterate here** records
`iterate` and re-reads the tree, ignoring `conflict`; **Proceed** records
the `conflict` choice itself (`leave` or `abort`). Never resolve the
conflict yourself, stage the files, or continue or skip the rebase.

{{include:spawned-no-run-guard}}

### Report the move

One line: old head -> new head, each as the sha and subject from its
`git -C <tree> log -1 --oneline --no-decorate` read. `<oldHead>` is the
result's `oldHead`. `<newHead>` is the result's `newHead` on the
`branch_sync` path, and HEAD after an iterate where the human finished the
rebase. The line ends "already current; nothing pushed" when the heads
match, "pushed by branch_sync" when `pushed` is true, and otherwise "not
pushed", followed on `push-refused` by the quoted `refusal`.

### Gate push

Scope `push`. The sentence is the line from **Report the move**; nothing
else before the form. The questions, each its own question (never fold one list
into another: a question over 4 options sends the whole gate to the wait
queue):

- `push`: **Push with force-with-lease now** / **Leave it unpushed**
  (recommended when the branch has an open MR others may have pulled)
- `next`: **Proceed** / **Iterate here** / **Hold**

Selection `{"push":true|false,"next":"proceed|iterate|hold","note":"<their words or null>"}`.
Read `next` first: **Hold** ends the turn with nothing pushed; **Iterate
here** goes back to **Report the move** and ignores `push`; only
**Proceed** applies `push`.
Any `git_push` error other than "not registered with rt" is reported with
its text; the rebase stands unpushed.

{{include:spawned-no-run-guard}}

**These thoughts mean you are skipping the gate -- STOP:**

| Thought | Reality |
|---------|---------|
| "Push with force-with-lease now is the natural next action, so I'll mark it Recommended" | Only **Leave it unpushed** carries a recommended label, and only conditionally (an open MR others may have pulled). Keep that qualifier on that option; never move it to the push option. |
| "Restating the finding and explaining each option makes the ask clearer" | A gate's form is one sentence of context, then the bare option labels the gate text names, nothing more -- no restated heading, no per-option description, no conditional aside on when Hold applies. |

### Off-script gate

Its origin is the `git_push` refusal "not registered with rt". Scope
`off-script:<run.current_stage>:<n>`, `n` counting from 1 per
rebase-worktree invocation; with no run, the site is `rebase-worktree`
(scope `off-script:rebase-worktree:<n>`). The
context sentence quotes the `git_push` refusal. The questions, each its
own question:

- `action`: **Take the proposed move** (the value spells the move in full)
  / **Hand back**
- `next`: **Proceed** (recommended) / **Iterate here** / **Hold**

Selection `{"move":"<the move>","why":"<the refusal>","action":"take|handback","next":"proceed|iterate|hold","note":"<their words or null>"}`.
Read `next` first: **Hold** ends the turn with no move made; **Iterate
here** means the human fixed the cause and wants the push retried, and it
ignores `action`; only **Proceed** applies `action` (take or hand back).
The proposed move is one plain-git force-with-lease push of the
branch; retrying the refused tool is **Iterate here**, never **Take**.

### Make the recorded move once

Exactly the move the selection recorded, once. Its result decides the next
node; a failure is reported, never a second off-script gate.

## What the graph cannot show

- Never push unasked.
- Aborting the rebase happens only on the **Abort the rebase** answer.
- "Upstream set?" is no when the `status -sb` branch line carries no `...origin/<branch>` tracking ref.

### Head still the old head?

The old head here is the conflict result's `newHead`: the branch ref when
the rebase paused, which differs from `oldHead` when rt sync first reset a
GitLab-rebased branch to origin. HEAD still equal to it means the human
aborted in their pane, never "already current".

## Gates

Every gate box runs this graph.

```dot
digraph gate_steps {
    rankdir=TB;

    trigger_gate_box [label="Trigger: a gate box in the graph above" shape=ellipse];
    holds_rundb [label="This conversation holds a runDb?" shape=diamond];
    run_field_set [label="run_field_set {runDb, key: gate, value: <scope>, stage}" shape=plaintext];
    publish_answer [label="Publish and answer per the gate protocol" shape=box];
    run_decision [label="run_decision {runDb, contract: gate@1, scope, selection, decidedBy}" shape=plaintext];
    spawned_pane [label="Spawned pane?" shape=diamond];
    error_line_to_spawner [label="One error line to the spawning surface" shape=box];
    pane_form_only [label="In-pane form only; nothing recorded" shape=box];
    gate_path_ended [label="Gate path ended" shape=doublecircle];
    answer_back [label="Answer back at the gate box" shape=doublecircle style=filled fillcolor=lightgreen];

    trigger_gate_box -> holds_rundb;
    holds_rundb -> run_field_set [label="yes"];
    holds_rundb -> spawned_pane [label="no"];
    run_field_set -> publish_answer;
    publish_answer -> run_decision;
    run_decision -> answer_back;
    spawned_pane -> error_line_to_spawner [label="yes"];
    spawned_pane -> pane_form_only [label="no: a human invoked it"];
    error_line_to_spawner -> gate_path_ended;
    pane_form_only -> answer_back;
}
```

### Publish and answer per the gate protocol

If a rule below asks for a move this graph marks STOP, take the off-script edge instead.

{{include:gate-protocol}}

### One error line to the spawning surface

The guard text in the gate's own section (for the off-script gate, the
one under **Gate push**) says what the line is and where it goes; the gate
path ends there.

### In-pane form only; nothing recorded

A human invocation with no run gets the same form in the pane, and no
`run_*` call is made.

## Wrap-up form contract

{{include:wrap-up-form}}
