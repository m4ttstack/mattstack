---
name: checkout
disable-model-invocation: true
description: "Use when someone else's branch needs a local worktree for review or testing -- given a branch name, an MR or PR link or number, or a ticket id -- without starting your own work on it. Does not open an editor (checkout-and-open does)."
allowed-tools:
  - Bash(git worktree list:*)
  - Bash(git remote get-url:*)
type: pipeline-step
---

# checkout

Get a teammate's branch into a local worktree so you can read or test it --
this is a review checkout, not the start of your own work.

```mermaid
flowchart TB
%% name: checkout
    teammate_branch([Trigger: a teammate's branch to check out])
    git_remote_origin[/git remote get-url origin/]
    what_given{What was given?}
    mr_resolve_branch[/"mr_resolve_branch {repoName, mrUrl or iid}"/]
    pick_branch
    mr_resolve_result{mr_resolve_branch result?}
    mr_list_search[/"mr_list {repoName, search: <ticket id>, state: all, limit: 200}"/]
    search_names_ticket{Search returned a row naming the ticket?}
    mr_list_all[/"mr_list {repoName, state: all, limit: 200}"/]
    stop_shell_mr_read[STOP: MR and PR reads go through the read tools]:::stop
    stop_shell_ticket_search[STOP: ticket searches go through the read tools]:::stop
    one_branch{Exactly one branch, from a complete read?}
    picked_github_row{A GitHub PR row picked?}
    mr_resolve_branch_row[/"mr_resolve_branch {repoName, iid: <row iid>}"/]
    gate_which_branch
    branch_answer{branch answer?}
    clarify_rounds_spent{Clarify rounds = 2?}
    git_worktree_list[/git worktree list/]
    already_checked_out{Branch already checked out?}
    worktree_provision[/"worktree_provision {repoName, branch}"/]
    provision_result{worktree_provision result?}
    argument_fixed{Argument fixed once already?}
    fix_argument
    stop_hand_rolled_worktree[STOP: worktrees only through worktree_provision]:::stop
    stop_move_into_tree[STOP: stay put; report the path]:::stop
    gate_off_script
    off_script_answer{off-script answer?}
    make_recorded_move
    recorded_move_succeeded{Recorded move succeeded?}
    off_script_rounds_spent{Off-script rounds = 2?}
    report_path_owner
    unresolved(((Unresolved: reported)))
    fork_pr(((Fork PR: reported)))
    provision_refused(((Provision refused: reported)))
    held_end_turn(((Held: end the turn naming the gate)))
    checked_out(((Checked out: path reported))):::done
    teammate_branch --> git_remote_origin
    git_remote_origin --> what_given
    what_given -->|a branch name: use it verbatim| git_worktree_list
    what_given -->|an MR or PR link, !iid, #number, or number| mr_resolve_branch
    what_given -->|a ticket id| mr_list_search
    what_given -->|tempted to read the MR or PR with the GitLab CLI or gh| stop_shell_mr_read
    stop_shell_mr_read --> mr_resolve_branch
    what_given -->|tempted to search with the GitLab CLI or gh| stop_shell_ticket_search
    stop_shell_ticket_search --> mr_list_search
    mr_resolve_branch --> mr_resolve_result
    mr_resolve_branch_row --> mr_resolve_result
    mr_resolve_result -->|a forge error: quoted in the gate's sentence| gate_which_branch
    mr_resolve_result -->|a GitHub PR whose branch lives in a fork| fork_pr
    mr_resolve_result -->|a tree on the branch: point there| report_path_owner
    mr_resolve_result -->|no tree| worktree_provision
    mr_list_search --> search_names_ticket
    search_names_ticket -->|yes| pick_branch
    search_names_ticket -->|no| mr_list_all
    search_names_ticket -->|a forge error: quoted in the gate's sentence| gate_which_branch
    mr_list_all --> pick_branch
    pick_branch --> one_branch
    one_branch -->|yes| picked_github_row
    one_branch -->|no: several, none, a forge error, or a truncated read| gate_which_branch
    gate_which_branch --> branch_answer
    branch_answer -->|a candidate| picked_github_row
    picked_github_row -->|yes| mr_resolve_branch_row
    picked_github_row -->|no: GitLab, or a branch name| git_worktree_list
    branch_answer -->|their text| clarify_rounds_spent
    branch_answer -->|hold| held_end_turn
    clarify_rounds_spent -->|no: resolve their text| what_given
    clarify_rounds_spent -->|yes| unresolved
    git_worktree_list --> already_checked_out
    already_checked_out -->|yes: point there| report_path_owner
    already_checked_out -->|no| worktree_provision
    worktree_provision --> provision_result
    provision_result -->|ok: keep its path| report_path_owner
    provision_result -->|an argument error| argument_fixed
    provision_result -->|daemon unreachable, or repo unknown to rt| stop_hand_rolled_worktree
    provision_result -->|tempted to enter the worktree| stop_move_into_tree
    provision_result -->|any other error| provision_refused
    stop_move_into_tree --> report_path_owner
    argument_fixed -->|no| fix_argument
    argument_fixed -->|yes| stop_hand_rolled_worktree
    fix_argument --> worktree_provision
    stop_hand_rolled_worktree --> gate_off_script
    gate_off_script --> off_script_answer
    off_script_answer -->|take| make_recorded_move
    off_script_answer -->|iterate or a write-in: the human fixed it, retry| off_script_rounds_spent
    off_script_answer -->|hand back| provision_refused
    off_script_answer -->|hold| held_end_turn
    off_script_rounds_spent -->|no| worktree_provision
    off_script_rounds_spent -->|yes| provision_refused
    make_recorded_move --> recorded_move_succeeded
    recorded_move_succeeded -->|yes| report_path_owner
    recorded_move_succeeded -->|no| provision_refused
    report_path_owner --> checked_out
```
