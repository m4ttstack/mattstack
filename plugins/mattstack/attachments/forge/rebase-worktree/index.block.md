---
name: rebase-worktree
disable-model-invocation: true
description: "Use when one worktree's feature branch has fallen behind the default branch -- 'rebase this worktree', a stale MR branch. Not for resolving conflicts on its own or moving uncommitted work."
allowed-tools:
  - Bash(git -C * status:*)
  - Bash(git -C * log:*)
type: pipeline-step
---

# rebase-worktree

Bring one worktree's branch current with the default branch through the
`branch_sync` tool. This never guesses: it refuses on a dirty tree, refuses
a stack member, and hands conflicts back to a human.

`<tree>` is the worktree's absolute path. Each graph box has a section below. Every gate box runs the gate steps graph under **Gates**.

```mermaid
flowchart TB
%% name: rebase_worktree
    bring_current([Trigger: one worktree's branch to bring current])
    git_status_branch[/git -C <tree> status -sb/]
    upstream_set{Upstream set?}
    branch_sync[/"branch_sync {tree}"/]
    branch_sync_kind{branch_sync kind?}
    stop_stash[STOP: never stash; gate the dirty tree]:::stop
    gate_dirty_tree
    tree_answer{tree answer?}
    dirty_retries_spent{Dirty retries = 2?}
    pulled_once{Pulled once already?}
    git_pull[/"git_pull {tree}"/]
    git_pull_result{git_pull result?}
    stop_hand_rebase[STOP: a refusal ends the run; never rebase by hand]:::stop
    stop_resolve_conflict[STOP: never resolve a conflict; hand it back]:::stop
    gate_conflict
    conflict_answer{conflict answer?}
    git_rebase_abort[/"git_rebase {tree, abort: true}"/]
    abort_succeeded{Abort succeeded?}
    git_status_tree[/git -C <tree> status/]
    still_mid_rebase{Still mid-rebase?}
    conflict_attempts_spent{Conflict attempts = 3?}
    stop_touch_rebase[STOP: leave the rebase for the human]:::stop
    git_log_head[/git -C <tree> log -1 --oneline HEAD/]
    git_log_old_head[/git -C <tree> log -1 --oneline --no-decorate <oldHead>/]
    git_log_new_head[/git -C <tree> log -1 --oneline --no-decorate <newHead>/]
    report_move
    heads_equal{Old head = new head?}
    sync_pushed{branch_sync pushed it?}
    gate_push
    push_answer{push answer?}
    git_push_force_lease[/"git_push {tree, forceWithLease: true}"/]
    git_push_result{git_push result?}
    stop_shell_push[STOP: push only with git_push]:::stop
    gate_off_script
    off_script_answer{off-script answer?}
    make_recorded_move
    head_unchanged{Head still the old head?}
    recorded_move_succeeded{Recorded move succeeded?}
    off_script_rounds_spent{Off-script rounds = 2?}
    dirty_tree(((Dirty tree: reported)))
    aborted_untouched(((Aborted: nothing touched)))
    no_upstream(((No upstream: reported)))
    refused(((Refused: reported)))
    refused_stack_member(((Refused: stack member, tool named)))
    stack_check_failed(((Stack check could not run: reported)))
    left_mid_rebase(((Left mid-rebase for the human)))
    aborted(((Aborted)))
    abort_failed(((Abort failed: error reported, tree left for the human)))
    aborted_by_human(((Rebase aborted in the human's pane: reported)))
    rebased_unpushed(((Rebased, left unpushed)))
    push_refused(((Rebased, push refused: reported)))
    held_end_turn(((Held: end the turn naming the gate)))
    done(((Done: move reported))):::done
    bring_current --> git_status_branch
    git_status_branch --> upstream_set
    upstream_set -->|yes| branch_sync
    upstream_set -->|no| no_upstream
    branch_sync --> branch_sync_kind
    branch_sync_kind -->|synced, up-to-date or push-refused| git_log_old_head
    branch_sync_kind -->|dirty-tree| gate_dirty_tree
    branch_sync_kind -->|conflict| gate_conflict
    branch_sync_kind -->|stacked-refused| refused_stack_member
    branch_sync_kind -->|stack-unverified| stack_check_failed
    branch_sync_kind -->|error: refusal says run git_pull first| pulled_once
    branch_sync_kind -->|error: any other refusal or failure| refused
    branch_sync_kind -->|tempted to stash and proceed| stop_stash
    branch_sync_kind -->|tempted to rebase by hand| stop_hand_rebase
    branch_sync_kind -->|tempted to resolve or continue it yourself| stop_resolve_conflict
    stop_stash --> gate_dirty_tree
    stop_hand_rebase --> refused
    stop_resolve_conflict --> gate_conflict
    gate_dirty_tree --> tree_answer
    tree_answer -->|I committed them, retry| dirty_retries_spent
    tree_answer -->|abort| aborted_untouched
    tree_answer -->|hold| held_end_turn
    dirty_retries_spent -->|no| branch_sync
    dirty_retries_spent -->|yes| dirty_tree
    pulled_once -->|no| git_pull
    pulled_once -->|yes| refused
    git_pull --> git_pull_result
    git_pull_result -->|fast-forwarded| branch_sync
    git_pull_result -->|error| refused
    gate_conflict --> conflict_answer
    conflict_answer -->|leave| left_mid_rebase
    conflict_answer -->|abort| git_rebase_abort
    conflict_answer -->|hold| held_end_turn
    conflict_answer -->|iterate: the human worked in their pane| git_status_tree
    git_rebase_abort --> abort_succeeded
    abort_succeeded -->|yes| aborted
    abort_succeeded -->|no| abort_failed
    git_status_tree --> still_mid_rebase
    still_mid_rebase -->|yes| conflict_attempts_spent
    still_mid_rebase -->|no| git_log_head
    conflict_attempts_spent -->|no: attempt n+1| gate_conflict
    conflict_attempts_spent -->|yes| stop_touch_rebase
    stop_touch_rebase --> left_mid_rebase
    git_log_head --> head_unchanged
    head_unchanged -->|yes| aborted_by_human
    head_unchanged -->|no: the rebase finished| git_log_old_head
    git_log_old_head --> git_log_new_head
    git_log_new_head --> report_move
    report_move --> heads_equal
    heads_equal -->|yes: already current, nothing pushed| done
    heads_equal -->|no| sync_pushed
    sync_pushed -->|yes: synced, pushed true| done
    sync_pushed -->|no: synced unpushed, push-refused, or the human finished the rebase| gate_push
    gate_push --> push_answer
    push_answer -->|push with force-with-lease| git_push_force_lease
    push_answer -->|leave it unpushed| rebased_unpushed
    push_answer -->|iterate| report_move
    push_answer -->|hold| held_end_turn
    git_push_force_lease --> git_push_result
    git_push_result -->|pushed| done
    git_push_result -->|safety refusal: lease, protected or default branch, detached HEAD, upstream mismatch| push_refused
    git_push_result -->|not registered with rt| stop_shell_push
    git_push_result -->|any other error| push_refused
    stop_shell_push --> gate_off_script
    gate_off_script --> off_script_answer
    off_script_answer -->|take| make_recorded_move
    off_script_answer -->|iterate: the human fixed it, retry| off_script_rounds_spent
    off_script_answer -->|hand back| push_refused
    off_script_answer -->|hold| held_end_turn
    off_script_rounds_spent -->|no| git_push_force_lease
    off_script_rounds_spent -->|yes| push_refused
    make_recorded_move --> recorded_move_succeeded
    recorded_move_succeeded -->|yes| done
    recorded_move_succeeded -->|no| push_refused
```
