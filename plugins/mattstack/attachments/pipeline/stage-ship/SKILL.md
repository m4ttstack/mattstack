---
name: stage-ship
description: "Pipeline stage: publish the unit of work for review -- push, open the MR/PR, attach evidence. Reached only through the work orchestrator; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
slots:
  domain: { contract: ship-domain@1, required: false }
metadata:
  stage: "ship"
  stage-consumes: "commits ticket"
  stage-produces: "mr"
---

# stage: ship

{{stage.fields}}

Run state: the orchestrator opens and closes this stage, so never write
`run_stage` `start` or `done` here. Read consumes with `run_field_get`,
write `mr` with `run_field_set` (`stage: "ship"`) the moment it exists and
`pushed` once the push lands, record a hold with `run_hold`, and on failure
write `run_stage {action: fail, stage: "ship", reason}` naming what failed.
`<root>` is the worktree root, the absolute path
`git rev-parse --show-toplevel` prints.

The domain rules below run their own steps in their own order. This graph
is where every mechanical move in them lands.

```dot
digraph ship {
    rankdir=TB;

    "Ship stage entered" [shape=ellipse];
    "Run the domain steps before the gate (none when unbound)" [shape=box];
    "git status --porcelain; git log --oneline @{upstream}.. or -5" [shape=plaintext];
    "branch_stack {tree: <root>}" [shape=plaintext];
    "Stack store readable?" [shape=diamond];
    "Stack member?" [shape=diamond];
    "run_field_get {key: shipTarget}" [shape=plaintext];
    "Recorded shipTarget matches a readable fresh target?" [shape=diamond];
    "run_field_set {key: shipTarget, value: <resolved target>, stage: ship}" [shape=plaintext];
    "run_field_set {key: shipTarget, value: -, stage: ship} (iterate)" [shape=plaintext];
    "run_field_set {key: shipTarget, value: -, stage: ship} (hold)" [shape=plaintext];
    "Gate ship (table below)" [shape=box];
    "ship answer?" [shape=diamond];
    "run_budget {key: ship:ship-gate-rounds, limit: 1, stage: ship}" [shape=plaintext];
    "ship-gate-rounds past its limit?" [shape=diamond];
    "run_budget {key: ship:ship-gate-reopenings, limit: 1, stage: ship}" [shape=plaintext];
    "ship-gate-reopenings past its limit?" [shape=diamond];
    "Rebase in progress (ship gate budget spent)?" [shape=diamond];
    "git_rebase {tree: <root>, abort: true} (ship gate budget spent)" [shape=plaintext];
    "dirty answer?" [shape=diamond];
    "Commit named files, ticket-prefixed subject" [shape=box];
    "Stash them; nothing in this stage pops it" [shape=box];
    "Run the domain's fast checks (none when unbound)" [shape=box];
    "Checks pass?" [shape=diamond];
    "run_budget {key: ship:fix-rounds, limit: 3, stage: ship}" [shape=plaintext];
    "fix-rounds past its limit?" [shape=diamond];
    "Fix test-first, commit, rerun" [shape=box];
    "Domain rebases, and no rebase finished this pass?" [shape=diamond];
    "git_rebase {tree: <root>, onto: origin/<resolved target>}" [shape=plaintext];
    "Rebase status?" [shape=diamond];
    "run_budget {key: ship:conflict-rounds, limit: 3, stage: ship}" [shape=plaintext];
    "conflict-rounds past its limit?" [shape=diamond];
    "Resolve the files, then git rebase --continue on Bash" [shape=box];
    "Continue result?" [shape=diamond];
    "Rebase in progress (stage abort)?" [shape=diamond];
    "git_rebase {tree: <root>, abort: true} (stage abort)" [shape=plaintext];
    "git_rebase {tree: <root>, abort: true} (after a failed continue)" [shape=plaintext];
    "Rebase in progress (go back)?" [shape=diamond];
    "git_rebase {tree: <root>, abort: true} (go back)" [shape=plaintext];

    "Push needs force-with-lease?" [shape=diamond];
    "git_push {tree: <root>, setUpstream: true}" [shape=plaintext];
    "git_push {tree: <root>, forceWithLease: true}" [shape=plaintext];
    "git_push result?" [shape=diamond];
    "run_field_set {key: pushed, value: <{\"sha\", \"priorPipelineId\"} JSON>, stage: ship}" [shape=plaintext];
    "STOP: push only with git_push; a shell push is off-script" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Off-script gate (gate-protocol, scope off-script:ship:<n>)" [shape=box];
    "off-script answer?" [shape=diamond];
    "run_budget {key: ship:push-off-script, limit: 1, stage: ship}" [shape=plaintext];
    "push-off-script past its limit?" [shape=diamond];
    "Make the recorded move once" [shape=box];
    "Push landed?" [shape=diamond];
    "run_budget {key: ship:landing-checks, limit: 1, stage: ship}" [shape=plaintext];
    "landing-checks past its limit?" [shape=diamond];
    "run_field_set {key: pushed, value: <{\"sha\": HEAD, \"priorPipelineId\": null} JSON>, stage: ship} (after the human's push)" [shape=plaintext];

    "git remote get-url origin" [shape=plaintext];
    "Forge host?" [shape=diamond];
    "run_budget {key: ship:forge-clarify-rounds, limit: 1, stage: ship}" [shape=plaintext];
    "forge-clarify-rounds past its limit?" [shape=diamond];
    "Gate clarify: which forge?" [shape=box];
    "Forge clarify answer?" [shape=diamond];
    "mr_create {repoName: <root>, sourceBranch, targetBranch: <resolved target>, title, description, draft, squash?, labels?, ifExists: return}" [shape=plaintext];
    "mr_create result?" [shape=diamond];
    "run_budget {key: ship:mr-create-recalls, limit: 1, stage: ship}" [shape=plaintext];
    "mr-create-recalls past its limit?" [shape=diamond];
    "mr_update {mrUrl, squash: true}" [shape=plaintext];
    "STOP: GitLab reads go through the read tools or gitlab_get, writes through the mr_* tools" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "gh pr create --base <resolved target>, draft unless the gate said ready" [shape=plaintext];
    "gh pr create result?" [shape=diamond];
    "run_field_set {key: mr, value: <url>, stage: ship}" [shape=plaintext];

    "run_field_get {key: evidence}" [shape=plaintext];
    "Capture the AFTER for the next case the domain names" [shape=box];
    "AFTER captured, or none left to capture?" [shape=diamond];
    "run_budget {key: ship:after-attempts:<case id>, limit: 2, stage: ship}" [shape=plaintext];
    "after-attempts past its limit?" [shape=diamond];
    "Every named case tried?" [shape=diamond];
    "A v1 or v2 record with an image, or an AFTER was captured?" [shape=diamond];
    "Merge into the record (evidence-record)" [shape=box];
    "Annotate or waive each image the record does not yet cover (evidence-record)" [shape=box];
    "Annotate or waive outcome?" [shape=diamond];
    "run_field_set {key: evidence, value: <the merged evidence@2 JSON>, stage: ship}" [shape=plaintext];
    "evidence write result?" [shape=diamond];
    "run_budget {key: ship:validator-refusals, limit: 1, stage: ship}" [shape=plaintext];
    "validator-refusals past its limit?" [shape=diamond];
    "run_budget {key: ship:record-fixes, limit: 1, stage: ship}" [shape=plaintext];
    "record-fixes past its limit?" [shape=diamond];
    "Files to attach?" [shape=diamond];
    "mr_upload {mrUrl, path, runId} per uploadable file; keep each markdown" [shape=plaintext];
    "mr_upload result?" [shape=diamond];
    "run_budget {key: ship:upload-path-fixes:<basename>, limit: 1, stage: ship}" [shape=plaintext];
    "upload-path-fixes past its limit?" [shape=diamond];
    "mr_upload {mrUrl, path: <the corrected absolute path>, runId}" [shape=plaintext];
    "STOP: upload only with mr_upload; another route is off-script" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Off-script gate: mr_upload refused (gate-protocol, scope off-script:ship:<n>)" [shape=box];
    "upload off-script answer?" [shape=diamond];
    "run_budget {key: ship:upload-off-script, limit: 1, stage: ship}" [shape=plaintext];
    "upload-off-script past its limit?" [shape=diamond];
    "run_budget {key: ship:upload-timeouts:<basename>, limit: 1, stage: ship}" [shape=plaintext];
    "upload-timeouts past its limit?" [shape=diamond];
    "mr_upload {mrUrl, path: <the timed-out file>, runId}" [shape=plaintext];
    "Forge host (read back the description)?" [shape=diamond];
    "mr_view {mrUrl}" [shape=plaintext];
    "gh pr view <mr> --json title,body" [shape=plaintext];
    "Write the title and description" [shape=box];
    "Forge host (write the description)?" [shape=diamond];
    "mr_update {mrUrl, title, description}" [shape=plaintext];
    "gh pr edit <mr> --title <title> --body <description>" [shape=plaintext];

    "run_stage {action: fail, stage: ship, reason}" [shape=plaintext];
    "run_hold {stage: ship, reason, decidedBy}" [shape=plaintext];
    "Held: end the turn naming run and stage" [shape=doublecircle];
    "Hand the Go back answer to the orchestrator" [shape=doublecircle];
    "Stage failed" [shape=doublecircle];
    "Ship done: return to the orchestrator" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Ship stage entered" -> "Run the domain steps before the gate (none when unbound)";
    "Run the domain steps before the gate (none when unbound)" -> "git status --porcelain; git log --oneline @{upstream}.. or -5";
    "git status --porcelain; git log --oneline @{upstream}.. or -5" -> "branch_stack {tree: <root>}";
    "branch_stack {tree: <root>}" -> "Stack store readable?";
    "Stack store readable?" -> "Stack member?" [label="yes"];
    "Stack store readable?" -> "run_field_get {key: shipTarget}" [label="no: stackStore unavailable, or a tool error: the target is the default branch, the stack could not be read"];
    "Stack member?" -> "run_field_get {key: shipTarget}" [label="yes: the target is the stack parent"];
    "Stack member?" -> "run_field_get {key: shipTarget}" [label="no: the target is the default branch"];
    "run_field_get {key: shipTarget}" -> "Recorded shipTarget matches a readable fresh target?";
    "Recorded shipTarget matches a readable fresh target?" -> "dirty answer?" [label="yes: the earlier Proceed stands, its answers read from the ship gate decision run_snapshot shows"];
    "Recorded shipTarget matches a readable fresh target?" -> "Gate ship (table below)" [label="no: the key is not set (run_field_get errors) or holds -, it differs, or the store is unreadable now"];
    "Gate ship (table below)" -> "ship answer?";
    "ship answer?" -> "run_field_set {key: shipTarget, value: <resolved target>, stage: ship}" [label="proceed: record the consented target"];
    "run_field_set {key: shipTarget, value: <resolved target>, stage: ship}" -> "dirty answer?";
    "ship answer?" -> "run_field_set {key: shipTarget, value: -, stage: ship} (iterate)" [label="iterate: clear the recorded consent first"];
    "run_field_set {key: shipTarget, value: -, stage: ship} (iterate)" -> "run_budget {key: ship:ship-gate-rounds, limit: 1, stage: ship}";
    "run_budget {key: ship:ship-gate-rounds, limit: 1, stage: ship}" -> "ship-gate-rounds past its limit?";
    "ship-gate-rounds past its limit?" -> "Run the domain steps before the gate (none when unbound)" [label="no: redo with their note"];
    "ship-gate-rounds past its limit?" -> "Rebase in progress (ship gate budget spent)?" [label="yes: a failure, their last note quoted"];
    "ship answer?" -> "Rebase in progress (go back)?" [label="go back"];
    "Rebase in progress (go back)?" -> "git_rebase {tree: <root>, abort: true} (go back)" [label="yes"];
    "Rebase in progress (go back)?" -> "Hand the Go back answer to the orchestrator" [label="no"];
    "git_rebase {tree: <root>, abort: true} (go back)" -> "Hand the Go back answer to the orchestrator";
    "ship answer?" -> "run_field_set {key: shipTarget, value: -, stage: ship} (hold)" [label="hold: clear the recorded consent first"];
    "run_field_set {key: shipTarget, value: -, stage: ship} (hold)" -> "run_hold {stage: ship, reason, decidedBy}";
    "ship answer?" -> "Rebase in progress (stage abort)?" [label="dirty = abort: reason 'aborted at the ship gate'"];
    "Rebase in progress (stage abort)?" -> "git_rebase {tree: <root>, abort: true} (stage abort)" [label="yes"];
    "Rebase in progress (stage abort)?" -> "run_stage {action: fail, stage: ship, reason}" [label="no: reason 'aborted at the ship gate'"];
    "git_rebase {tree: <root>, abort: true} (stage abort)" -> "run_stage {action: fail, stage: ship, reason}" [label="reason 'aborted at the ship gate'"];
    "dirty answer?" -> "Commit named files, ticket-prefixed subject" [label="commit"];
    "dirty answer?" -> "Stash them; nothing in this stage pops it" [label="stash"];
    "dirty answer?" -> "Run the domain's fast checks (none when unbound)" [label="clean tree"];
    "Commit named files, ticket-prefixed subject" -> "Run the domain's fast checks (none when unbound)";
    "Stash them; nothing in this stage pops it" -> "Run the domain's fast checks (none when unbound)";
    "Run the domain's fast checks (none when unbound)" -> "Checks pass?";
    "Checks pass?" -> "Domain rebases, and no rebase finished this pass?" [label="yes"];
    "Checks pass?" -> "run_budget {key: ship:fix-rounds, limit: 3, stage: ship}" [label="no"];
    "run_budget {key: ship:fix-rounds, limit: 3, stage: ship}" -> "fix-rounds past its limit?";
    "fix-rounds past its limit?" -> "Fix test-first, commit, rerun" [label="no"];
    "fix-rounds past its limit?" -> "run_budget {key: ship:ship-gate-reopenings, limit: 1, stage: ship}" [label="yes: reopen, failing output quoted"];
    "Fix test-first, commit, rerun" -> "Run the domain's fast checks (none when unbound)";
    "Domain rebases, and no rebase finished this pass?" -> "git_rebase {tree: <root>, onto: origin/<resolved target>}" [label="yes"];
    "Domain rebases, and no rebase finished this pass?" -> "Push needs force-with-lease?" [label="no"];
    "git_rebase {tree: <root>, onto: origin/<resolved target>}" -> "Rebase status?";
    "Rebase status?" -> "Run the domain's fast checks (none when unbound)" [label="clean: the tree changed"];
    "Rebase status?" -> "run_budget {key: ship:conflict-rounds, limit: 3, stage: ship}" [label="conflict"];
    "Rebase status?" -> "run_stage {action: fail, stage: ship, reason}" [label="any other error: quote it as the reason"];
    "run_budget {key: ship:conflict-rounds, limit: 3, stage: ship}" -> "conflict-rounds past its limit?";
    "conflict-rounds past its limit?" -> "Resolve the files, then git rebase --continue on Bash" [label="no"];
    "conflict-rounds past its limit?" -> "run_budget {key: ship:ship-gate-reopenings, limit: 1, stage: ship}" [label="yes: reopen, conflicted files quoted"];
    "run_budget {key: ship:ship-gate-reopenings, limit: 1, stage: ship}" -> "ship-gate-reopenings past its limit?";
    "ship-gate-reopenings past its limit?" -> "Gate ship (table below)" [label="no: reopen with what was quoted"];
    "ship-gate-reopenings past its limit?" -> "Rebase in progress (ship gate budget spent)?" [label="yes: a failure, the failing output or conflicted files quoted"];
    "Rebase in progress (ship gate budget spent)?" -> "git_rebase {tree: <root>, abort: true} (ship gate budget spent)" [label="yes"];
    "Rebase in progress (ship gate budget spent)?" -> "run_stage {action: fail, stage: ship, reason}" [label="no: a failure, what was quoted is the reason"];
    "git_rebase {tree: <root>, abort: true} (ship gate budget spent)" -> "run_stage {action: fail, stage: ship, reason}" [label="a failure, what was quoted is the reason"];
    "Resolve the files, then git rebase --continue on Bash" -> "Continue result?";
    "Continue result?" -> "run_budget {key: ship:conflict-rounds, limit: 3, stage: ship}" [label="another commit conflicted"];
    "Continue result?" -> "Run the domain's fast checks (none when unbound)" [label="rebase finished"];
    "Continue result?" -> "git_rebase {tree: <root>, abort: true} (after a failed continue)" [label="any other error: a failure, quoted"];
    "git_rebase {tree: <root>, abort: true} (after a failed continue)" -> "run_stage {action: fail, stage: ship, reason}" [label="a failure, the continue error is the reason"];

    "Push needs force-with-lease?" -> "git_push {tree: <root>, setUpstream: true}" [label="no"];
    "Push needs force-with-lease?" -> "git_push {tree: <root>, forceWithLease: true}" [label="yes: the rebase rewrote pushed commits"];
    "git_push {tree: <root>, setUpstream: true}" -> "git_push result?";
    "git_push {tree: <root>, forceWithLease: true}" -> "git_push result?";
    "git_push result?" -> "run_field_set {key: pushed, value: <{\"sha\", \"priorPipelineId\"} JSON>, stage: ship}" [label="ok: its sha, and priorPipelineId only when the push moved the branch"];
    "git_push result?" -> "STOP: push only with git_push; a shell push is off-script" [label="any other error"];
    "run_field_set {key: pushed, value: <{\"sha\", \"priorPipelineId\"} JSON>, stage: ship}" -> "git remote get-url origin";
    "STOP: push only with git_push; a shell push is off-script" -> "Off-script gate (gate-protocol, scope off-script:ship:<n>)";
    "Off-script gate (gate-protocol, scope off-script:ship:<n>)" -> "off-script answer?";
    "off-script answer?" -> "Make the recorded move once" [label="proceed + take"];
    "off-script answer?" -> "run_stage {action: fail, stage: ship, reason}" [label="proceed + hand back"];
    "off-script answer?" -> "run_budget {key: ship:push-off-script, limit: 1, stage: ship}" [label="iterate: the human fixed the cause, retry the push"];
    "off-script answer?" -> "run_hold {stage: ship, reason, decidedBy}" [label="hold: no move made"];
    "run_budget {key: ship:push-off-script, limit: 1, stage: ship}" -> "push-off-script past its limit?";
    "push-off-script past its limit?" -> "Push needs force-with-lease?" [label="no: retry the push"];
    "push-off-script past its limit?" -> "run_stage {action: fail, stage: ship, reason}" [label="yes: hand back, the refusal quoted"];
    "Make the recorded move once" -> "Push landed?";
    "Push landed?" -> "run_field_set {key: pushed, value: <{\"sha\": HEAD, \"priorPipelineId\": null} JSON>, stage: ship} (after the human's push)" [label="yes: the remote branch carries HEAD"];
    "Push landed?" -> "run_budget {key: ship:landing-checks, limit: 1, stage: ship}" [label="no"];
    "run_budget {key: ship:landing-checks, limit: 1, stage: ship}" -> "landing-checks past its limit?";
    "landing-checks past its limit?" -> "Off-script gate (gate-protocol, scope off-script:ship:<n>)" [label="no: reopen with what the comparison showed"];
    "landing-checks past its limit?" -> "run_stage {action: fail, stage: ship, reason}" [label="yes: a failure, the comparison quoted"];
    "run_field_set {key: pushed, value: <{\"sha\": HEAD, \"priorPipelineId\": null} JSON>, stage: ship} (after the human's push)" -> "git remote get-url origin";

    "git remote get-url origin" -> "Forge host?";
    "Forge host?" -> "mr_create {repoName: <root>, sourceBranch, targetBranch: <resolved target>, title, description, draft, squash?, labels?, ifExists: return}" [label="GitLab"];
    "Forge host?" -> "gh pr create --base <resolved target>, draft unless the gate said ready" [label="GitHub"];
    "Forge host?" -> "run_budget {key: ship:forge-clarify-rounds, limit: 1, stage: ship}" [label="anything else"];
    "run_budget {key: ship:forge-clarify-rounds, limit: 1, stage: ship}" -> "forge-clarify-rounds past its limit?";
    "forge-clarify-rounds past its limit?" -> "Gate clarify: which forge?" [label="no: ask which forge"];
    "forge-clarify-rounds past its limit?" -> "run_stage {action: fail, stage: ship, reason}" [label="yes: a failure, the origin URL and their answer quoted"];
    "Gate clarify: which forge?" -> "Forge clarify answer?";
    "Forge clarify answer?" -> "Forge host?" [label="answered: GitLab or GitHub, the host from here on"];
    "Forge clarify answer?" -> "run_hold {stage: ship, reason, decidedBy}" [label="hold"];
    "Forge clarify answer?" -> "run_stage {action: fail, stage: ship, reason}" [label="hand back: a failure, no forge this stage knows"];
    "mr_create {repoName: <root>, sourceBranch, targetBranch: <resolved target>, title, description, draft, squash?, labels?, ifExists: return}" -> "mr_create result?";
    "mr_create result?" -> "run_field_set {key: mr, value: <url>, stage: ship}" [label="created, squash applied or not asked: keep its url"];
    "mr_create result?" -> "run_field_set {key: mr, value: <url>, stage: ship}" [label="existing: keep its url, leave its settings as found"];
    "mr_create result?" -> "mr_update {mrUrl, squash: true}" [label="squashApplied: false"];
    "mr_create result?" -> "run_budget {key: ship:mr-create-recalls, limit: 1, stage: ship}" [label="url null: the MR exists, its url was not read back"];
    "mr_create result?" -> "run_stage {action: fail, stage: ship, reason}" [label="error: quote it as the reason"];
    "mr_create result?" -> "STOP: GitLab reads go through the read tools or gitlab_get, writes through the mr_* tools" [label="tempted to use the GitLab CLI"];
    "STOP: GitLab reads go through the read tools or gitlab_get, writes through the mr_* tools" -> "mr_create {repoName: <root>, sourceBranch, targetBranch: <resolved target>, title, description, draft, squash?, labels?, ifExists: return}";
    "run_budget {key: ship:mr-create-recalls, limit: 1, stage: ship}" -> "mr-create-recalls past its limit?";
    "mr-create-recalls past its limit?" -> "mr_create {repoName: <root>, sourceBranch, targetBranch: <resolved target>, title, description, draft, squash?, labels?, ifExists: return}" [label="no: call again, it returns the MR it made"];
    "mr-create-recalls past its limit?" -> "run_stage {action: fail, stage: ship, reason}" [label="yes: a failure, the url never came back"];
    "mr_update {mrUrl, squash: true}" -> "run_field_set {key: mr, value: <url>, stage: ship}";
    "gh pr create --base <resolved target>, draft unless the gate said ready" -> "gh pr create result?";
    "gh pr create result?" -> "run_field_set {key: mr, value: <url>, stage: ship}" [label="url printed"];
    "gh pr create result?" -> "run_field_set {key: mr, value: <url>, stage: ship}" [label="already exists: keep the url it prints"];
    "gh pr create result?" -> "run_stage {action: fail, stage: ship, reason}" [label="any other error: quote it as the reason"];
    "run_field_set {key: mr, value: <url>, stage: ship}" -> "run_field_get {key: evidence}";

    "run_field_get {key: evidence}" -> "Capture the AFTER for the next case the domain names";
    "Capture the AFTER for the next case the domain names" -> "AFTER captured, or none left to capture?";
    "AFTER captured, or none left to capture?" -> "Every named case tried?" [label="captured"];
    "AFTER captured, or none left to capture?" -> "A v1 or v2 record with an image, or an AFTER was captured?" [label="none named: there is no AFTER"];
    "AFTER captured, or none left to capture?" -> "run_budget {key: ship:after-attempts:<case id>, limit: 2, stage: ship}" [label="the capture failed"];
    "run_budget {key: ship:after-attempts:<case id>, limit: 2, stage: ship}" -> "after-attempts past its limit?";
    "after-attempts past its limit?" -> "Capture the AFTER for the next case the domain names" [label="no: another attempt, same case"];
    "after-attempts past its limit?" -> "Every named case tried?" [label="yes: go on without it; the description names the gap"];
    "Every named case tried?" -> "Capture the AFTER for the next case the domain names" [label="no"];
    "Every named case tried?" -> "A v1 or v2 record with an image, or an AFTER was captured?" [label="yes"];
    "A v1 or v2 record with an image, or an AFTER was captured?" -> "Merge into the record (evidence-record)" [label="yes"];
    "A v1 or v2 record with an image, or an AFTER was captured?" -> "Files to attach?" [label="no"];
    "Merge into the record (evidence-record)" -> "Annotate or waive each image the record does not yet cover (evidence-record)";
    "Annotate or waive each image the record does not yet cover (evidence-record)" -> "Annotate or waive outcome?";
    "Annotate or waive outcome?" -> "run_field_set {key: evidence, value: <the merged evidence@2 JSON>, stage: ship}" [label="ready"];
    "Annotate or waive outcome?" -> "run_hold {stage: ship, reason, decidedBy}" [label="held at evidence-waiver"];
    "Annotate or waive outcome?" -> "run_stage {action: fail, stage: ship, reason}" [label="waiver openings spent: the images named"];
    "run_field_set {key: evidence, value: <the merged evidence@2 JSON>, stage: ship}" -> "evidence write result?";
    "evidence write result?" -> "Files to attach?" [label="ok"];
    "evidence write result?" -> "run_budget {key: ship:validator-refusals, limit: 1, stage: ship}" [label="refused: the validator names an image"];
    "evidence write result?" -> "run_stage {action: fail, stage: ship, reason}" [label="any other error: quote it as the reason"];
    "run_budget {key: ship:validator-refusals, limit: 1, stage: ship}" -> "validator-refusals past its limit?";
    "validator-refusals past its limit?" -> "Annotate or waive each image the record does not yet cover (evidence-record)" [label="no"];
    "validator-refusals past its limit?" -> "run_stage {action: fail, stage: ship, reason}" [label="yes: the refusal quoted"];
    "Files to attach?" -> "mr_upload {mrUrl, path, runId} per uploadable file; keep each markdown" [label="yes, GitLab: every uploadable path in the record (a repeat upload is harmless)"];
    "Files to attach?" -> "Forge host (read back the description)?" [label="no, or GitHub: link the paths"];
    "mr_upload {mrUrl, path, runId} per uploadable file; keep each markdown" -> "mr_upload result?";
    "mr_upload result?" -> "mr_view {mrUrl}" [label="ok: every file uploaded"];
    "mr_upload result?" -> "mr_upload {mrUrl, path, runId} per uploadable file; keep each markdown" [label="ok: files still to upload"];
    "mr_upload result?" -> "run_budget {key: ship:upload-path-fixes:<basename>, limit: 1, stage: ship}" [label="path must be absolute, or file not found"];
    "mr_upload result?" -> "STOP: upload only with mr_upload; another route is off-script" [label="any other refusal: outside the roots, bytes, size"];
    "mr_upload result?" -> "STOP: upload only with mr_upload; another route is off-script" [label="tempted to copy the file into an allowed root, or upload another way"];
    "mr_upload result?" -> "run_budget {key: ship:record-fixes, limit: 1, stage: ship}" [label="refused: not in the record, or a raw capture"];
    "run_budget {key: ship:record-fixes, limit: 1, stage: ship}" -> "record-fixes past its limit?";
    "record-fixes past its limit?" -> "Annotate or waive each image the record does not yet cover (evidence-record)" [label="no: the named file"];
    "record-fixes past its limit?" -> "STOP: upload only with mr_upload; another route is off-script" [label="yes"];
    "run_budget {key: ship:upload-path-fixes:<basename>, limit: 1, stage: ship}" -> "upload-path-fixes past its limit?";
    "upload-path-fixes past its limit?" -> "mr_upload {mrUrl, path: <the corrected absolute path>, runId}" [label="no: this file's one fix"];
    "upload-path-fixes past its limit?" -> "STOP: upload only with mr_upload; another route is off-script" [label="yes"];
    "mr_upload {mrUrl, path: <the corrected absolute path>, runId}" -> "mr_upload result?";
    "mr_upload result?" -> "run_budget {key: ship:upload-timeouts:<basename>, limit: 1, stage: ship}" [label="timed out"];
    "run_budget {key: ship:upload-timeouts:<basename>, limit: 1, stage: ship}" -> "upload-timeouts past its limit?";
    "upload-timeouts past its limit?" -> "mr_upload {mrUrl, path: <the timed-out file>, runId}" [label="no: retry once, a timed-out upload is safe to repeat"];
    "upload-timeouts past its limit?" -> "STOP: upload only with mr_upload; another route is off-script" [label="yes: timed out twice"];
    "mr_upload {mrUrl, path: <the timed-out file>, runId}" -> "mr_upload result?";
    "STOP: upload only with mr_upload; another route is off-script" -> "Off-script gate: mr_upload refused (gate-protocol, scope off-script:ship:<n>)";
    "Off-script gate: mr_upload refused (gate-protocol, scope off-script:ship:<n>)" -> "upload off-script answer?";
    "upload off-script answer?" -> "Forge host (read back the description)?" [label="proceed + take: link the refused files' local paths"];
    "upload off-script answer?" -> "run_stage {action: fail, stage: ship, reason}" [label="proceed + hand back"];
    "upload off-script answer?" -> "run_budget {key: ship:upload-off-script, limit: 1, stage: ship}" [label="iterate: the human fixed the cause, retry the upload"];
    "upload off-script answer?" -> "run_hold {stage: ship, reason, decidedBy}" [label="hold: nothing linked"];
    "run_budget {key: ship:upload-off-script, limit: 1, stage: ship}" -> "upload-off-script past its limit?";
    "upload-off-script past its limit?" -> "mr_upload {mrUrl, path, runId} per uploadable file; keep each markdown" [label="no: retry the refused files"];
    "upload-off-script past its limit?" -> "run_stage {action: fail, stage: ship, reason}" [label="yes: hand back, the refusal quoted"];
    "Forge host (read back the description)?" -> "mr_view {mrUrl}" [label="GitLab"];
    "Forge host (read back the description)?" -> "gh pr view <mr> --json title,body" [label="GitHub"];
    "mr_view {mrUrl}" -> "Write the title and description";
    "gh pr view <mr> --json title,body" -> "Write the title and description";
    "Write the title and description" -> "Forge host (write the description)?";
    "Forge host (write the description)?" -> "mr_update {mrUrl, title, description}" [label="GitLab"];
    "Forge host (write the description)?" -> "gh pr edit <mr> --title <title> --body <description>" [label="GitHub"];
    "mr_update {mrUrl, title, description}" -> "Ship done: return to the orchestrator";
    "gh pr edit <mr> --title <title> --body <description>" -> "Ship done: return to the orchestrator";
    "run_stage {action: fail, stage: ship, reason}" -> "Stage failed";
    "run_hold {stage: ship, reason, decidedBy}" -> "Held: end the turn naming run and stage";
}
```

### Run the domain steps before the gate (none when unbound)

The domain's gathering steps: sanity of the diff against the ticket, the
branch and ticket checks, an existing-MR lookup, any mandatory pre-ship
review. Each one that raises a question adds it to the `ship` gate rather
than asking on its own.

### Reading a GitLab fact no read tool returns

At any step, a GitLab fact the read tools do not return is read with
`gitlab_get {repoName, path}`: `repoName` = the tree this stage targets,
`path` relative to the API root with `:id` for this project, for example
`projects/:id/merge_requests/<iid>/approvals`. The read is part of the
step, not an off-script move: no gate. Quote a GitLab error as
written; its refusal of a credential path is final.

### Run the domain's fast checks (none when unbound)

Only the checks the domain names, on the changed files. Revert generated
drift the checks leave behind before continuing. A full suite the domain
rules out stays out: CI runs it.

### Fix test-first, commit, rerun

Each fix gets its failing test first, then the fix, then a commit. Each
failing check run counts one `fix-rounds` round.

### Resolve the files, then git rebase --continue on Bash

Resolve each conflicted file `git_rebase` returned, then continue the
rebase on Bash (no tool continues one). A later commit that conflicts
counts another `conflict-rounds` round. A finished rebase, clean or
resolved, reruns the fast checks on the changed tree, then the push
follows: this pass never rebases twice. A
continue that fails with anything but another conflict aborts the rebase,
then fails the stage with the error quoted.

### Push needs force-with-lease?

Yes only when a rebase finished in this pass and the branch's upstream
already held the commits it rewrote. Never force otherwise, and never push
a branch whose tests you have not seen pass in this session.

### Make the recorded move once

The gate's recorded move (the human's push) happens once, never retried
here. Then compare `git rev-parse HEAD` with the remote branch: it landed
when that branch carries HEAD, which `pushed` records with no prior id.
Each miss counts one `landing-checks` round: the first reopens the
off-script gate quoting the comparison, the second fails the stage.

### Capture the AFTER for the next case the domain names

For each case in the record, the same view as its BEFORE, on the sha
you pushed; a v1 record's BEFORE counts as the case `case`, so an AFTER
of that view belongs to it. Any other capture the domain names is a new
case with its own `id` and `label`. Each failed capture counts one
`after-attempts:<case id>` round; after the third, that case goes on
without its AFTER and the description says what was tried. Unbound, there
is no AFTER. Every capture enters the record through the evidence
record's merge and annotate steps and is written before anything uploads,
never uploaded on its own.

### Off-script gate: mr_upload refused (gate-protocol, scope off-script:ship:<n>)

The upload guard refused a file past its one fix, timed out on it twice
(Iterate retries once the human has checked the daemon), or refused it
twice as not in the record or a raw capture. Scope `off-script:ship:<n>`,
`n` shared with the push's off-script gate, `context` quoting the refusal
and the path. Take links the refused files' local paths in the
description, files already uploaded keeping their upload markdown; Iterate
means the human moved the file, widened `rt.mcp.uploadRoots` or
recaptured. Copying a file under an allowed root is only ever the human's
move: the roots are the boundary on what leaves the machine.

### Write the title and description

Title from the ticket or the first commit subject; the body links the
ticket and carries the evidence section the evidence record below
describes, built from the record just written. The update replaces the
whole body, so start from the one just read back: the record's evidence
section replaces any evidence block an earlier stage wrote, and everything
else already there (a teammate's edits) is kept; change only what this
stage owns. The domain's title, template and voice rules win over this
paragraph.

### Gate clarify: which forge?

The origin host is neither GitLab nor GitHub: ask which forge, quoting
the `git remote get-url origin` line as context. Options:
**GitLab** / **GitHub** / **Hand back**, and `next`: **Proceed** /
**Hold**. Each time the host reads as neither counts one
`forge-clarify-rounds` round: the first asks, and the second fails the
stage with the origin URL and the answer quoted. The named forge is the
host from here on: later forge diamonds read the answer, never the URL.

## What the graph cannot show

- **Off-script answers.** Read `next` first: Hold ends the turn with no
  move made; Iterate means the human fixed the cause and ignores
  `action`; only Proceed applies `action`. Retrying `git_push` or
  `mr_upload` is Iterate, never Take.
- **Budgets.** Every loop counts through `run_budget` (`stage: ship`),
  surviving compaction and resume within the stage attempt; the diamond
  after each call reads `spent > limit`. `after-attempts` keys end in the
  case id, upload keys in the file's basename.
- **`pushed`** hands the watch-ci stage `git_push`'s `sha`, and its
  `priorPipelineId` only when the push moved the branch (no upstream
  before it, commits listed before the gate, a commit by this stage since,
  or a forced push); else `null`, since that pipeline is the sha's own and
  the watch would wait for one that never comes.
- **Hold** records `run_hold`: `reason` their words or the gate,
  `decidedBy` as the answer recorded it.
- `targetBranch` is the target `branch_stack` resolved before the gate:
  the stack parent for a stack member, else the default branch read from
  git, never guessed; on `stackStore: "unavailable"` or an error, the
  default branch, and the gate's context says the stack could not be read.
  A GitHub PR takes it as `--base`. The domain rebase goes onto
  `origin/<that target>`, so a stack member never replays its parent's
  unmerged commits.
- Keep the `url` `mr_create` returns as `mrUrl` for every later write.
  `existing: true` is an MR already open on the branch, nothing the call
  passed applied (a re-call after `url: null` returns the first call's
  MR this way). The return to the orchestrator names both targets when
  its `targetBranch` differs from the resolved one, and says squash is
  unset when it was asked and no result applied it.
- **Recorded consent.** Proceed records the consented target in
  `shipTarget`; with the stack store unreadable the value is `<default
  branch> (stack store unreadable)`, telling consent to the fallback from a
  real read. The rebase and `mr_create` use the plain branch name. Iterate
  and Hold clear it to `-` first, so the skip below never fires within a
  pass and a resume after either re-asks the gate. The work orchestrator
  clears it on a redirect reaching ship and on a failure gate Retry of
  ship.
- **Re-entry.** A stage entered again reads `shipTarget` after
  `branch_stack`; unset (`run_field_get` errors) or `-` opens the gate. A
  readable fresh target equal to the recorded one continues past the
  gate, the earlier Proceed standing, with the `dirty`, `open_as` and
  domain answers from the ship gate decision `run_snapshot` shows; a tree
  dirty now with no recorded commit or stash answer goes to "dirty
  answer?", which asks first. A fresh target that differs, or a store
  unreadable now, reopens the gate naming both targets; Proceed records
  the fresh one.

## Gate `ship` (before the push)

One sentence above the form: the branch, the commits about to go, whether
the tree is dirty, and the resolved target (the stack parent, the default
branch, or "the stack could not be read, so the default branch"), so
Proceed is consent to that target. A re-entered stage reopening it
because the target moved names the recorded and fresh targets. When the gate reopens with a rebase in progress (the
conflict rounds are spent), the context says so, since Abort or Go back
then aborts that rebase.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `dirty` (write-in) | **Commit the changes (Recommended)** / **Stash them** / **Abort** | the tree is dirty |
| `open_as` (write-in) | **Push and open as draft (Recommended)** / **Push and open ready** | always |
| the domain's own | as the domain rules word them (a ticket mismatch, an MR already open) | the domain declares them |
| `next` | **Proceed** / **Iterate here** / **Go back** / **Hold** | always |
| `to` | one option per earlier stage, split `to-1`, ... over 4 | Go back answered and more than one earlier stage row |

Selection: `{"dirty":"commit|stash|abort|null","open_as":"draft|ready","domain":{<answers>},"next":"proceed|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}`.
Abort pushes nothing; Abort and Go back abort a rebase in progress first,
so the earlier stage never receives a tree mid-rebase.
Each Iterate counts one `ship-gate-rounds` round, and each time the fix
or conflict rounds run out one `ship-gate-reopenings` round. The first
redoes the steps before the gate with the note, or reopens this gate
quoting the failing output or conflicted files; the second fails the
stage quoting them. The fix and conflict rounds carry over a reopen: the reopened
gate is the human's turn to fix it, so a Proceed whose checks still fail
reaches this counter again without new fix rounds. Either failure aborts a
rebase in progress first.

## Domain rules

The domain rules below supply content, checks and extra gate questions.
If a rule below asks for a move this graph marks STOP, take the off-script
edge instead: a shell push opens the push's off-script gate; a GitLab CLI
read goes through the read tools or `gitlab_get`, a write through the
`mr_*` tools. A domain rule that keeps a capture out
of the record, or keeps a base with no waiver, yields to the evidence
record.

{{slot:domain}}

When nothing is inlined above, the graph alone is the flow: no steps
before the gate, no fast checks, no rebase, no AFTER.

## Evidence record

{{include:evidence-record}}

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
