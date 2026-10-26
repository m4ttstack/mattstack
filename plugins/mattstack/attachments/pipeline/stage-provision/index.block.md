---
name: stage-provision
description: "Pipeline stage: establish where the unit of work happens -- workspace, branch, ticket. Reached only through the work orchestrator; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
metadata:
  stage: "provision"
  stage-consumes: "ticket repo"
  stage-produces: "branch worktree"
replaced-slots: [domain]
---

# stage: provision

{{stage.fields}}

The orchestrator owns this stage's rows: read consumes with
`run_field_get`, write produces with `run_field_set {stage: "provision"}`,
and end a failure with `run_stage {action: fail, stage: "provision",
reason}`.

```mermaid
flowchart TB
%% name: provision
    provision_entered([Provision stage entered])
    run_field_get_mode[/"run_field_get {key: mode}"/]
    mode_is_worker{mode is worker?}
    git_status_pwd[/git status in $PWD/]
    clean_run{Clean run?}
    domain_rules_inlined{Domain rules inlined in Domain rules or under Follow the domain's provision flow?}
    follow_domain_flow
    domain_flow_result{Domain flow result?}
    worktree_provision_precheck[/"worktree_provision {repoName, ticket | branch, ticketTitle?, precheck: true}"/]
    precheck_result{Precheck result?}
    worktree_provision_codes[/"worktree_provision {repoName, ticket | branch, ticketTitle?, codes: true, runDb, stage: provision, budget: {key: provision-refusals, limit: 2}}"/]
    provision_result{worktree_provision result?}
    whoami[/"whoami {}"/]
    gate_provision["Gate provision (table below)"]
    provision_answer{provision answer?}
    fresh_tree_budget_spent{Fresh trees this attempt = 2?}
    picked_tree_held{Picked tree read held?}
    worktree_provision_reuse[/"worktree_provision {repoName, branch: <the picked branch>, reuse: true, runDb, stage: provision}"/]
    worktree_provision_take_over[/"worktree_provision {repoName, branch: <the picked branch>, reuse: true, takeOver: true, runDb, stage: provision}"/]
    reuse_result{Reuse result?}
    run_budget_fresh_tree[/"run_budget {key: fresh-tree, limit: 2, stage: provision}"/]
    git_branch_list[/git -C <repo> branch --list <slug>-*/]
    enter_worktree[/"EnterWorktree {path}"/]
    recorded_on_run{Recorded on the run?}
    git_rev_parse[/git -C <repo> rev-parse --git-dir/]
    git_status_porcelain[/git -C <repo> status --porcelain/]
    checkout_clean{Checkout clean?}
    git_switch_create[/git -C <repo> switch -c <branch> <default>/]
    stop_hand_rolled_worktree[STOP: never hand-roll a worktree; worktree_provision or the plain branch fallback]:::stop
    run_field_set_branch[/"run_field_set {key: branch, value: <branch>, stage: provision}"/]
    run_field_set_worktree[/"run_field_set {key: worktree, value: <absolute path>, stage: provision}"/]
    stage_made_ticket{This stage found or created the ticket?}
    run_field_set_ticket[/"run_field_set {key: ticket, value: <id>, stage: provision}"/]
    run_stage_fail[/"run_stage {action: fail, stage: provision, reason}"/]
    run_hold[/"run_hold {runDb, stage: provision, reason, decidedBy}"/]
    held_end_turn(((Held: end the turn naming run and stage)))
    stage_failed(((Stage failed)))
    provision_done(((Provision done: return to the orchestrator))):::done
    provision_entered --> run_field_get_mode
    run_field_get_mode --> mode_is_worker
    mode_is_worker -->|worker| git_status_pwd
    mode_is_worker -->|interactive, or the key is not set| domain_rules_inlined
    git_status_pwd --> clean_run
    clean_run -->|yes: $PWD and its branch| run_field_set_branch
    clean_run -->|no| run_stage_fail
    domain_rules_inlined -->|yes| follow_domain_flow
    domain_rules_inlined -->|no| worktree_provision_precheck
    follow_domain_flow --> domain_flow_result
    domain_flow_result -->|it provisions a tree| worktree_provision_precheck
    domain_flow_result -->|it raises a question| gate_provision
    domain_flow_result -->|already provisioned: this tree and its branch| run_field_set_branch
    worktree_provision_precheck --> precheck_result
    precheck_result -->|trees to resume| whoami
    whoami --> gate_provision
    precheck_result -->|nothing in the way| worktree_provision_codes
    precheck_result -->|refused daemon-outdated| worktree_provision_codes
    precheck_result -->|refused daemon-unreachable or repo-unknown, unless the domain forbids the fallback| git_rev_parse
    precheck_result -->|refused daemon-unreachable or repo-unknown, the domain forbids the fallback| run_stage_fail
    precheck_result -->|refused otherwise| run_stage_fail
    worktree_provision_codes --> provision_result
    provision_result -->|provisioned: the result's path| enter_worktree
    provision_result -->|refused branch-attached| whoami
    provision_result -->|refused daemon-unreachable or repo-unknown, unless the domain forbids the fallback| git_rev_parse
    provision_result -->|refused daemon-unreachable or repo-unknown, the domain forbids the fallback| run_stage_fail
    provision_result -->|refused busy, budget not exhausted| worktree_provision_codes
    provision_result -->|any other refusal, or busy with the budget exhausted| run_stage_fail
    provision_result -->|tempted to hand-roll one| stop_hand_rolled_worktree
    stop_hand_rolled_worktree --> run_stage_fail
    git_rev_parse --> git_status_porcelain
    git_status_porcelain --> checkout_clean
    checkout_clean -->|yes| git_switch_create
    checkout_clean -->|no: quote the dirty paths as the reason| run_stage_fail
    git_switch_create -->|worktree = the checkout| run_field_set_branch
    gate_provision --> provision_answer
    provision_answer -->|resume in <tree or branch>| picked_tree_held
    picked_tree_held -->|no| worktree_provision_reuse
    picked_tree_held -->|yes: the human picked it anyway| worktree_provision_take_over
    provision_answer -->|fresh tree| run_budget_fresh_tree
    provision_answer -->|ticket: create one| follow_domain_flow
    provision_answer -->|ticket: recheck the id| follow_domain_flow
    provision_answer -->|slug: their typed text| follow_domain_flow
    provision_answer -->|a domain answer| follow_domain_flow
    provision_answer -->|iterate: redo with their note| follow_domain_flow
    provision_answer -->|hold| run_hold
    run_hold --> held_end_turn
    worktree_provision_reuse --> reuse_result
    worktree_provision_take_over --> reuse_result
    reuse_result -->|reused or provisioned: the result's path| enter_worktree
    reuse_result -->|refused: quote it| run_stage_fail
    run_budget_fresh_tree --> fresh_tree_budget_spent
    fresh_tree_budget_spent -->|no, ticket mode: provision fresh, no precheck| worktree_provision_codes
    fresh_tree_budget_spent -->|no, branch mode| git_branch_list
    git_branch_list -->|branch = <slug>-<n>| worktree_provision_codes
    fresh_tree_budget_spent -->|yes: exhausted| run_stage_fail
    enter_worktree --> recorded_on_run
    recorded_on_run -->|yes: recorded true| stage_made_ticket
    recorded_on_run -->|no: recordError| run_field_set_branch
    run_field_set_branch --> run_field_set_worktree
    run_field_set_worktree --> stage_made_ticket
    stage_made_ticket -->|yes| run_field_set_ticket
    stage_made_ticket -->|no, or it came in known| provision_done
    run_field_set_ticket --> provision_done
    run_stage_fail --> stage_failed
```
