---
name: stage-evidence
description: "Pipeline stage: capture the before-state evidence the plan committed to, while the before still exists. Reached only through the work orchestrator; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
metadata:
  stage: "evidence"
  stage-consumes: "evidence-plan worktree"
  stage-produces: "evidence"
replaced-slots: [domain]
---

# stage: evidence

{{stage.fields}}

Run state: the orchestrator opens and closes this stage, so never write
`run_stage` `start` or `done` here. `evidence_record` writes `evidence`;
never write it with `run_field_set`. A `<slug> spent?` diamond reads its
`run_budget` as the evidence record below says. `detailPath` on a failure
is whatever was captured so far.

Capture the BEFORE now, before implementation changes the surface.

```mermaid
flowchart TB
%% name: evidence
    evidence_entered([Evidence stage entered])
    run_field_get_plan[/"run_field_get {key: evidence-plan}"/]
    run_field_get_worktree[/"run_field_get {key: worktree}"/]
    plan_is_none{evidence-plan starts with none?}
    evidence_record_none[/"evidence_record {runDb, stage: evidence, plan: "none"}"/]
    domain_steps_before_gate
    needs_dev_servers{Domain needs dev servers or another rt read?}
    dev_endpoints[/"dev_endpoints {tree: <worktree>, roles: <the domain's roles>}"/]
    stop_guessed_ports[STOP: ports come only from dev_endpoints]:::stop
    role_waiting{Any role waiting or unclaimed?}
    rt_verb[/"rt_verb {args: [<verb>, ...]}"/]
    stop_shell_rt_read[STOP: rt reads go through rt_verb, never rt on Bash]:::stop
    intake_needed{Intake questions declared, or source not local?}
    gate_evidence["Gate evidence (table below)"]
    evidence_answer{evidence answer?}
    ticket_shows_before{Ticket already shows the broken state?}
    save_ticket_image
    ticket_image_saved{Ticket image saved?}
    record_ticket_before
    browser_case{Browser screenshot for this case?}
    capture_browser
    capture_before_case
    captured{Captured?}
    run_budget_capture_attempts[/"run_budget {runDb, key: evidence:capture-attempts:<case>, limit: 3, stage: evidence}"/]
    capture_attempts_spent{capture-attempts spent?}
    every_case_captured{Every planned case captured or located?}
    pick_next_source
    same_source{Same source the gate recorded?}
    stop_new_source[STOP: a new data source is an off-script move]:::stop
    gate_new_source
    off_script_answer{off-script answer?}
    run_budget_source_off_script[/"run_budget {runDb, key: evidence:source-off-script, limit: 2, stage: evidence}"/]
    source_off_script_spent{source-off-script spent?}
    run_budget_gate_iterates[/"run_budget {runDb, key: evidence:gate-iterates, limit: 3, stage: evidence}"/]
    gate_iterates_spent{gate-iterates spent?}
    domain_attaches_mr{Domain attaches evidence to an MR here?}
    run_field_get_branch[/"run_field_get {key: branch}"/]
    git_remote_origin[/git -C <worktree> remote get-url origin/]
    forge_host{Forge host?}
    mr_for_branch[/"mr_for_branch {repoName: <worktree>, branches: [<branch>]}"/]
    gh_pr_view_branch[/gh pr view <branch> --json number,url,state/]
    open_mr_on_branch{Open MR or PR on the branch?}
    gate_evidence_attach["Gate evidence-attach (table below)"]
    attach_answer{attach answer?}
    record_evidence
    record_outcome{Record outcome?}
    attach_answered{Attach now answered?}
    attach_evidence
    attach_outcome{Attach outcome?}
    run_stage_fail[/"run_stage {action: fail, stage: evidence, reason, detailPath}"/]
    run_hold[/"run_hold {runDb, stage: evidence, reason, decidedBy}"/]
    held_end_turn(((Held: end the turn naming run and stage)))
    stage_failed(((Stage failed)))
    evidence_done(((Evidence done: return to the orchestrator))):::done
    evidence_entered --> run_field_get_plan
    run_field_get_plan --> run_field_get_worktree
    run_field_get_worktree --> plan_is_none
    plan_is_none -->|yes| evidence_record_none
    plan_is_none -->|no| domain_steps_before_gate
    evidence_record_none -->|written| evidence_done
    evidence_record_none -->|errored| run_stage_fail
    domain_steps_before_gate --> needs_dev_servers
    needs_dev_servers -->|dev servers| dev_endpoints
    needs_dev_servers -->|another rt read| rt_verb
    needs_dev_servers -->|tempted to look up or probe ports on Bash| stop_guessed_ports
    needs_dev_servers -->|tempted to run rt on Bash| stop_shell_rt_read
    needs_dev_servers -->|no| intake_needed
    stop_guessed_ports --> dev_endpoints
    stop_shell_rt_read --> rt_verb
    dev_endpoints --> role_waiting
    role_waiting -->|yes: name it in the gate's sentence| gate_evidence
    role_waiting -->|no, and another rt read| rt_verb
    role_waiting -->|no| intake_needed
    rt_verb --> intake_needed
    intake_needed -->|yes| gate_evidence
    intake_needed -->|no| ticket_shows_before
    gate_evidence --> evidence_answer
    evidence_answer -->|proceed: intake and source recorded| ticket_shows_before
    evidence_answer -->|iterate: re-ask with their note| gate_evidence
    evidence_answer -->|iterate, a role was waiting or unclaimed| run_budget_gate_iterates
    run_budget_gate_iterates --> gate_iterates_spent
    gate_iterates_spent -->|no: re-check| dev_endpoints
    gate_iterates_spent -->|yes: hand back, the roles named| run_stage_fail
    evidence_answer -->|hand back| run_stage_fail
    evidence_answer -->|go on without this BEFORE: reopened from an unfixable Not drawn| every_case_captured
    ticket_shows_before -->|yes: an image| save_ticket_image
    ticket_shows_before -->|yes: a link or text, no image| record_ticket_before
    ticket_shows_before -->|no| browser_case
    save_ticket_image --> ticket_image_saved
    ticket_image_saved -->|yes| every_case_captured
    ticket_image_saved -->|no: no tool can fetch it, keep the link| record_ticket_before
    record_ticket_before --> every_case_captured
    every_case_captured -->|no| ticket_shows_before
    every_case_captured -->|yes| domain_attaches_mr
    browser_case -->|yes| capture_browser
    browser_case -->|no: the domain's own method| capture_before_case
    capture_browser --> captured
    capture_before_case --> captured
    captured -->|yes, or Board ready: keep its board and claim for the record| every_case_captured
    captured -->|no, or Not drawn: a failed brief or spent re-renders| run_budget_capture_attempts
    captured -->|Not drawn, a reason no retry can fix: reopen with what was tried| gate_evidence
    captured -->|Held at evidence-redaction| run_hold
    run_budget_capture_attempts --> capture_attempts_spent
    capture_attempts_spent -->|no| pick_next_source
    capture_attempts_spent -->|yes: reopen with what was tried| gate_evidence
    pick_next_source --> same_source
    same_source -->|yes| browser_case
    same_source -->|no| stop_new_source
    stop_new_source --> gate_new_source
    gate_new_source --> off_script_answer
    off_script_answer -->|proceed + take: the proposed source| browser_case
    off_script_answer -->|proceed + hand back| run_stage_fail
    off_script_answer -->|iterate: the human fixed the recorded source| run_budget_source_off_script
    run_budget_source_off_script --> source_off_script_spent
    source_off_script_spent -->|no: the recorded source| browser_case
    source_off_script_spent -->|yes: hand back| run_stage_fail
    domain_attaches_mr -->|yes| run_field_get_branch
    domain_attaches_mr -->|no: ship attaches| record_evidence
    run_field_get_branch --> git_remote_origin
    git_remote_origin --> forge_host
    forge_host -->|GitLab| mr_for_branch
    forge_host -->|GitHub| gh_pr_view_branch
    forge_host -->|another host: ship attaches| record_evidence
    mr_for_branch --> open_mr_on_branch
    gh_pr_view_branch --> open_mr_on_branch
    open_mr_on_branch -->|"yes (a PR's state is OPEN): keep its url"| gate_evidence_attach
    open_mr_on_branch -->|no, or a PR not OPEN: ship attaches later| record_evidence
    gate_evidence_attach --> attach_answer
    attach_answer -->|attach now, or hand back the markdown| record_evidence
    attach_answer -->|iterate, or hide: revise each drawn board their words name, re-ask with their note| gate_evidence_attach
    evidence_answer -->|hold| run_hold
    off_script_answer -->|hold| run_hold
    attach_answer -->|hold| run_hold
    record_evidence --> record_outcome
    record_outcome -->|Recorded| attach_answered
    attach_answered -->|yes| attach_evidence
    attach_answered -->|no| evidence_done
    attach_evidence --> attach_outcome
    attach_outcome -->|Attached, or Taken: ship's attach sends the refused files| evidence_done
    record_outcome -->|Record held, or Attach held| run_hold
    attach_outcome -->|Record held, or Attach held| run_hold
    record_outcome -->|Record failed, or Attach failed: the reason quoted| run_stage_fail
    attach_outcome -->|Record failed, or Attach failed: the reason quoted| run_stage_fail
    run_hold --> held_end_turn
    run_stage_fail --> stage_failed
```
