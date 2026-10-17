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
`run_stage` `start` or `done` here. Read consumes with `run_field_get`;
write `mr` the moment it exists and `pushed` once the push lands; fail
with `run_stage {action: fail}` naming what failed. Every `stage` argument
is `"ship"`. `<root>` is the absolute worktree root
`git rev-parse --show-toplevel` prints.

```dot
digraph ship {
    rankdir=TB;

    "Ship stage entered" [shape=ellipse];
    "Run the domain steps before the gate (none when unbound)" [shape=box];
    "git status --porcelain; git log --oneline @{upstream}.. or -5" [shape=plaintext];
    "branch_stack {tree: <root>}" [shape=plaintext];
    "run_field_get {key: shipTarget}" [shape=plaintext];
    "shipTarget matches the fresh target?" [shape=diamond];
    "Gate ship (table below)" [shape=box];
    "run_field_set {key: shipTarget, value: <resolved target>, stage}" [shape=plaintext];
    "run_field_set {key: shipTarget, value: -, stage} (iterate)" [shape=plaintext];
    "run_field_set {key: shipTarget, value: -, stage} (hold)" [shape=plaintext];
    "run_budget {key: ship:ship-gate-rounds, limit: 1, stage}" [shape=plaintext];
    "ship-gate-rounds spent?" [shape=diamond];
    "run_budget {key: ship:ship-gate-reopenings, limit: 1, stage}" [shape=plaintext];
    "ship-gate-reopenings spent?" [shape=diamond];
    "Rebase in progress?" [shape=diamond];
    "git_rebase {tree: <root>, abort: true}" [shape=plaintext];
    "Which exit?" [shape=diamond];
    "dirty answer?" [shape=diamond];
    "Commit named files, ticket-prefixed subject" [shape=box];
    "Stash them" [shape=box];
    "Run the domain's fast checks (none when unbound)" [shape=box];
    "Checks pass?" [shape=diamond];
    "run_budget {key: ship:fix-rounds, limit: 3, stage}" [shape=plaintext];
    "fix-rounds spent?" [shape=diamond];
    "Fix test-first, commit, rerun" [shape=box];
    "Domain rebases, and no rebase finished this pass?" [shape=diamond];
    "git_rebase {tree: <root>, onto: origin/<resolved target>}" [shape=plaintext];
    "Rebase status?" [shape=diamond];
    "run_budget {key: ship:conflict-rounds, limit: 3, stage}" [shape=plaintext];
    "conflict-rounds spent?" [shape=diamond];
    "Resolve the files, then git rebase --continue on Bash" [shape=box];
    "Continue result?" [shape=diamond];

    "Push needs force-with-lease?" [shape=diamond];
    "git_push {tree: <root>, setUpstream: true}" [shape=plaintext];
    "git_push {tree: <root>, forceWithLease: true}" [shape=plaintext];
    "git_push result?" [shape=diamond];
    "run_field_set {key: pushed, value: <{\"sha\", \"priorPipelineId\"} JSON>, stage}" [shape=plaintext];
    "STOP: push only with git_push" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Off-script gate: git_push refused" [shape=box];
    "Make the recorded move once" [shape=box];
    "Push landed?" [shape=diamond];
    "run_field_set {key: pushed, value: <{\"sha\": HEAD, \"priorPipelineId\": null} JSON>, stage}" [shape=plaintext];

    "git remote get-url origin" [shape=plaintext];
    "Forge host?" [shape=diamond];
    "run_budget {key: ship:forge-clarify-rounds, limit: 1, stage}" [shape=plaintext];
    "forge-clarify-rounds spent?" [shape=diamond];
    "Gate clarify: which forge?" [shape=box];
    "mr_create {repoName: <root>, sourceBranch, targetBranch: <resolved target>, title, description, draft, squash?, labels?, ifExists: return}" [shape=plaintext];
    "mr_create result?" [shape=diamond];
    "run_budget {key: ship:mr-create-recalls, limit: 1, stage}" [shape=plaintext];
    "mr-create-recalls spent?" [shape=diamond];
    "mr_update {mrUrl, squash: true}" [shape=plaintext];
    "STOP: GitLab goes through gitlab_get, the read tools and mr_*" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "gh pr create --base <resolved target> [--draft]" [shape=plaintext];
    "gh pr create result?" [shape=diamond];
    "run_field_set {key: mr, value: <url>, stage}" [shape=plaintext];

    "run_field_get {key: evidence}" [shape=plaintext];
    "Capture the AFTER for the next case the domain names" [shape=box];
    "AFTER result?" [shape=diamond];
    "run_budget {key: ship:after-attempts:<case id>, limit: 2, stage}" [shape=plaintext];
    "after-attempts spent?" [shape=diamond];
    "Every named case tried?" [shape=diamond];
    "Record image or new AFTER?" [shape=diamond];
    "Merge into the record (evidence-record)" [shape=box];
    "Annotate or waive each image the record does not yet cover (evidence-record)" [shape=box];
    "Annotate or waive outcome?" [shape=diamond];
    "run_field_set {key: evidence, value: <evidence@2 JSON>, stage}" [shape=plaintext];
    "evidence write result?" [shape=diamond];
    "run_budget {key: ship:validator-refusals, limit: 1, stage}" [shape=plaintext];
    "validator-refusals spent?" [shape=diamond];
    "run_budget {key: ship:record-fixes, limit: 1, stage}" [shape=plaintext];
    "record-fixes spent?" [shape=diamond];
    "Files to attach?" [shape=diamond];
    "mr_upload {mrUrl, path, runId} per file" [shape=plaintext];
    "mr_upload result?" [shape=diamond];
    "run_budget {key: ship:upload-path-fixes:<basename>, limit: 1, stage}" [shape=plaintext];
    "upload-path-fixes spent?" [shape=diamond];
    "mr_upload {mrUrl, path: <corrected path>, runId}" [shape=plaintext];
    "STOP: upload only with mr_upload" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Off-script gate: mr_upload refused" [shape=box];
    "upload off-script answer?" [shape=diamond];
    "run_budget {key: ship:upload-off-script, limit: 1, stage}" [shape=plaintext];
    "upload-off-script spent?" [shape=diamond];
    "run_budget {key: ship:upload-timeouts:<basename>, limit: 1, stage}" [shape=plaintext];
    "upload-timeouts spent?" [shape=diamond];
    "mr_upload {mrUrl, path: <timed-out file>, runId}" [shape=plaintext];
    "Forge host (read back)?" [shape=diamond];
    "mr_view {mrUrl}" [shape=plaintext];
    "gh pr view <mr> --json title,body" [shape=plaintext];
    "Write the title and description" [shape=box];
    "Forge host (write back)?" [shape=diamond];
    "mr_update {mrUrl, title, description}" [shape=plaintext];
    "gh pr edit <mr> --title <title> --body <description>" [shape=plaintext];

    "run_stage {action: fail, stage, reason}" [shape=plaintext];
    "run_hold {stage, reason, decidedBy}" [shape=plaintext];
    "Held: end the turn naming run and stage" [shape=doublecircle];
    "Hand the Go back answer to the orchestrator" [shape=doublecircle];
    "Stage failed" [shape=doublecircle];
    "Ship done: return to the orchestrator" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Ship stage entered" -> "Run the domain steps before the gate (none when unbound)";
    "Run the domain steps before the gate (none when unbound)" -> "git status --porcelain; git log --oneline @{upstream}.. or -5";
    "git status --porcelain; git log --oneline @{upstream}.. or -5" -> "branch_stack {tree: <root>}";
    "branch_stack {tree: <root>}" -> "run_field_get {key: shipTarget}";
    "run_field_get {key: shipTarget}" -> "shipTarget matches the fresh target?";
    "shipTarget matches the fresh target?" -> "dirty answer?" [label="yes: the earlier Proceed stands"];
    "shipTarget matches the fresh target?" -> "Gate ship (table below)" [label="no"];
    "Gate ship (table below)" -> "run_field_set {key: shipTarget, value: <resolved target>, stage}" [label="proceed"];
    "Gate ship (table below)" -> "run_field_set {key: shipTarget, value: -, stage} (iterate)" [label="iterate"];
    "Gate ship (table below)" -> "run_field_set {key: shipTarget, value: -, stage} (hold)" [label="hold"];
    "Gate ship (table below)" -> "Rebase in progress?" [label="go back, or dirty = abort"];
    "run_field_set {key: shipTarget, value: <resolved target>, stage}" -> "dirty answer?";
    "run_field_set {key: shipTarget, value: -, stage} (iterate)" -> "run_budget {key: ship:ship-gate-rounds, limit: 1, stage}";
    "run_budget {key: ship:ship-gate-rounds, limit: 1, stage}" -> "ship-gate-rounds spent?";
    "ship-gate-rounds spent?" -> "Run the domain steps before the gate (none when unbound)" [label="no: redo with their note"];
    "ship-gate-rounds spent?" -> "Rebase in progress?" [label="yes: a failure"];
    "run_field_set {key: shipTarget, value: -, stage} (hold)" -> "run_hold {stage, reason, decidedBy}";
    "Rebase in progress?" -> "git_rebase {tree: <root>, abort: true}" [label="yes"];
    "Rebase in progress?" -> "Which exit?" [label="no"];
    "git_rebase {tree: <root>, abort: true}" -> "Which exit?";
    "Which exit?" -> "Hand the Go back answer to the orchestrator" [label="go back"];
    "Which exit?" -> "run_stage {action: fail, stage, reason}" [label="a failure"];
    "dirty answer?" -> "Commit named files, ticket-prefixed subject" [label="commit"];
    "dirty answer?" -> "Stash them" [label="stash"];
    "dirty answer?" -> "Run the domain's fast checks (none when unbound)" [label="clean tree"];
    "Commit named files, ticket-prefixed subject" -> "Run the domain's fast checks (none when unbound)";
    "Stash them" -> "Run the domain's fast checks (none when unbound)";
    "Run the domain's fast checks (none when unbound)" -> "Checks pass?";
    "Checks pass?" -> "Domain rebases, and no rebase finished this pass?" [label="yes"];
    "Checks pass?" -> "run_budget {key: ship:fix-rounds, limit: 3, stage}" [label="no"];
    "run_budget {key: ship:fix-rounds, limit: 3, stage}" -> "fix-rounds spent?";
    "fix-rounds spent?" -> "Fix test-first, commit, rerun" [label="no"];
    "fix-rounds spent?" -> "run_budget {key: ship:ship-gate-reopenings, limit: 1, stage}" [label="yes: reopen"];
    "Fix test-first, commit, rerun" -> "Run the domain's fast checks (none when unbound)";
    "Domain rebases, and no rebase finished this pass?" -> "git_rebase {tree: <root>, onto: origin/<resolved target>}" [label="yes"];
    "Domain rebases, and no rebase finished this pass?" -> "Push needs force-with-lease?" [label="no"];
    "git_rebase {tree: <root>, onto: origin/<resolved target>}" -> "Rebase status?";
    "Rebase status?" -> "Run the domain's fast checks (none when unbound)" [label="clean"];
    "Rebase status?" -> "run_budget {key: ship:conflict-rounds, limit: 3, stage}" [label="conflict"];
    "Rebase status?" -> "Which exit?" [label="error: a failure"];
    "run_budget {key: ship:conflict-rounds, limit: 3, stage}" -> "conflict-rounds spent?";
    "conflict-rounds spent?" -> "Resolve the files, then git rebase --continue on Bash" [label="no"];
    "conflict-rounds spent?" -> "run_budget {key: ship:ship-gate-reopenings, limit: 1, stage}" [label="yes: reopen"];
    "run_budget {key: ship:ship-gate-reopenings, limit: 1, stage}" -> "ship-gate-reopenings spent?";
    "ship-gate-reopenings spent?" -> "Gate ship (table below)" [label="no: reopen with what was quoted"];
    "ship-gate-reopenings spent?" -> "Rebase in progress?" [label="yes: a failure"];
    "Resolve the files, then git rebase --continue on Bash" -> "Continue result?";
    "Continue result?" -> "run_budget {key: ship:conflict-rounds, limit: 3, stage}" [label="another commit conflicted"];
    "Continue result?" -> "Run the domain's fast checks (none when unbound)" [label="rebase finished"];
    "Continue result?" -> "git_rebase {tree: <root>, abort: true}" [label="error: a failure"];

    "Push needs force-with-lease?" -> "git_push {tree: <root>, setUpstream: true}" [label="no"];
    "Push needs force-with-lease?" -> "git_push {tree: <root>, forceWithLease: true}" [label="yes"];
    "git_push {tree: <root>, setUpstream: true}" -> "git_push result?";
    "git_push {tree: <root>, forceWithLease: true}" -> "git_push result?";
    "git_push result?" -> "run_field_set {key: pushed, value: <{\"sha\", \"priorPipelineId\"} JSON>, stage}" [label="ok"];
    "git_push result?" -> "STOP: push only with git_push" [label="refused"];
    "run_field_set {key: pushed, value: <{\"sha\", \"priorPipelineId\"} JSON>, stage}" -> "git remote get-url origin";
    "STOP: push only with git_push" -> "Off-script gate: git_push refused";
    "Off-script gate: git_push refused" -> "Make the recorded move once" [label="take"];
    "Off-script gate: git_push refused" -> "Push needs force-with-lease?" [label="iterate: push again"];
    "Off-script gate: git_push refused" -> "Which exit?" [label="hand back"];
    "Off-script gate: git_push refused" -> "run_hold {stage, reason, decidedBy}" [label="hold"];
    "Make the recorded move once" -> "Push landed?";
    "Push landed?" -> "run_field_set {key: pushed, value: <{\"sha\": HEAD, \"priorPipelineId\": null} JSON>, stage}" [label="yes"];
    "Push landed?" -> "git remote get-url origin" [label="no: go on, pushed unwritten"];
    "run_field_set {key: pushed, value: <{\"sha\": HEAD, \"priorPipelineId\": null} JSON>, stage}" -> "git remote get-url origin";

    "git remote get-url origin" -> "Forge host?";
    "Forge host?" -> "mr_create {repoName: <root>, sourceBranch, targetBranch: <resolved target>, title, description, draft, squash?, labels?, ifExists: return}" [label="GitLab"];
    "Forge host?" -> "gh pr create --base <resolved target> [--draft]" [label="GitHub"];
    "Forge host?" -> "run_budget {key: ship:forge-clarify-rounds, limit: 1, stage}" [label="anything else"];
    "run_budget {key: ship:forge-clarify-rounds, limit: 1, stage}" -> "forge-clarify-rounds spent?";
    "forge-clarify-rounds spent?" -> "Gate clarify: which forge?" [label="no"];
    "forge-clarify-rounds spent?" -> "Which exit?" [label="yes: a failure"];
    "Gate clarify: which forge?" -> "Forge host?" [label="GitLab or GitHub"];
    "Gate clarify: which forge?" -> "run_hold {stage, reason, decidedBy}" [label="hold"];
    "Gate clarify: which forge?" -> "Which exit?" [label="hand back"];
    "mr_create {repoName: <root>, sourceBranch, targetBranch: <resolved target>, title, description, draft, squash?, labels?, ifExists: return}" -> "mr_create result?";
    "mr_create result?" -> "run_field_set {key: mr, value: <url>, stage}" [label="created"];
    "mr_create result?" -> "run_field_set {key: mr, value: <url>, stage}" [label="existing: keep its url; no squash or labels, the title and description are still written below"];
    "mr_create result?" -> "mr_update {mrUrl, squash: true}" [label="squashApplied: false"];
    "mr_create result?" -> "run_budget {key: ship:mr-create-recalls, limit: 1, stage}" [label="url: null"];
    "mr_create result?" -> "Which exit?" [label="error: a failure"];
    "mr_create result?" -> "STOP: GitLab goes through gitlab_get, the read tools and mr_*" [label="tempted to use the GitLab CLI"];
    "STOP: GitLab goes through gitlab_get, the read tools and mr_*" -> "mr_create {repoName: <root>, sourceBranch, targetBranch: <resolved target>, title, description, draft, squash?, labels?, ifExists: return}";
    "run_budget {key: ship:mr-create-recalls, limit: 1, stage}" -> "mr-create-recalls spent?";
    "mr-create-recalls spent?" -> "mr_create {repoName: <root>, sourceBranch, targetBranch: <resolved target>, title, description, draft, squash?, labels?, ifExists: return}" [label="no: call again"];
    "mr-create-recalls spent?" -> "Which exit?" [label="yes: a failure"];
    "mr_update {mrUrl, squash: true}" -> "run_field_set {key: mr, value: <url>, stage}";
    "gh pr create --base <resolved target> [--draft]" -> "gh pr create result?";
    "gh pr create result?" -> "run_field_set {key: mr, value: <url>, stage}" [label="url printed, or already exists"];
    "gh pr create result?" -> "Which exit?" [label="error: a failure"];
    "run_field_set {key: mr, value: <url>, stage}" -> "run_field_get {key: evidence}";

    "run_field_get {key: evidence}" -> "Capture the AFTER for the next case the domain names";
    "Capture the AFTER for the next case the domain names" -> "AFTER result?";
    "AFTER result?" -> "Every named case tried?" [label="captured"];
    "AFTER result?" -> "Record image or new AFTER?" [label="none named"];
    "AFTER result?" -> "run_budget {key: ship:after-attempts:<case id>, limit: 2, stage}" [label="the capture failed"];
    "run_budget {key: ship:after-attempts:<case id>, limit: 2, stage}" -> "after-attempts spent?";
    "after-attempts spent?" -> "Capture the AFTER for the next case the domain names" [label="no: same case again"];
    "after-attempts spent?" -> "Every named case tried?" [label="yes: go on without it"];
    "Every named case tried?" -> "Capture the AFTER for the next case the domain names" [label="no"];
    "Every named case tried?" -> "Record image or new AFTER?" [label="yes"];
    "Record image or new AFTER?" -> "Merge into the record (evidence-record)" [label="yes"];
    "Record image or new AFTER?" -> "Files to attach?" [label="no"];
    "Merge into the record (evidence-record)" -> "Annotate or waive each image the record does not yet cover (evidence-record)";
    "Annotate or waive each image the record does not yet cover (evidence-record)" -> "Annotate or waive outcome?";
    "Annotate or waive outcome?" -> "run_field_set {key: evidence, value: <evidence@2 JSON>, stage}" [label="ready"];
    "Annotate or waive outcome?" -> "run_hold {stage, reason, decidedBy}" [label="held at evidence-waiver"];
    "Annotate or waive outcome?" -> "Which exit?" [label="waiver openings spent"];
    "run_field_set {key: evidence, value: <evidence@2 JSON>, stage}" -> "evidence write result?";
    "evidence write result?" -> "Files to attach?" [label="ok"];
    "evidence write result?" -> "run_budget {key: ship:validator-refusals, limit: 1, stage}" [label="refused: names an image"];
    "evidence write result?" -> "Which exit?" [label="error: a failure"];
    "run_budget {key: ship:validator-refusals, limit: 1, stage}" -> "validator-refusals spent?";
    "validator-refusals spent?" -> "Annotate or waive each image the record does not yet cover (evidence-record)" [label="no"];
    "validator-refusals spent?" -> "Which exit?" [label="yes: a failure"];
    "Files to attach?" -> "mr_upload {mrUrl, path, runId} per file" [label="yes, GitLab: every uploadable path (a repeat upload is harmless)"];
    "Files to attach?" -> "Forge host (read back)?" [label="no, or GitHub: link the paths"];
    "mr_upload {mrUrl, path, runId} per file" -> "mr_upload result?";
    "mr_upload result?" -> "mr_view {mrUrl}" [label="ok: all uploaded"];
    "mr_upload result?" -> "mr_upload {mrUrl, path, runId} per file" [label="ok: more to upload"];
    "mr_upload result?" -> "run_budget {key: ship:upload-path-fixes:<basename>, limit: 1, stage}" [label="path not absolute, or not found"];
    "mr_upload result?" -> "run_budget {key: ship:record-fixes, limit: 1, stage}" [label="not in the record, or a raw capture"];
    "mr_upload result?" -> "run_budget {key: ship:upload-timeouts:<basename>, limit: 1, stage}" [label="timed out"];
    "mr_upload result?" -> "STOP: upload only with mr_upload" [label="other refusal"];
    "mr_upload result?" -> "STOP: upload only with mr_upload" [label="tempted to upload another way"];
    "run_budget {key: ship:record-fixes, limit: 1, stage}" -> "record-fixes spent?";
    "record-fixes spent?" -> "Annotate or waive each image the record does not yet cover (evidence-record)" [label="no: the named file"];
    "record-fixes spent?" -> "STOP: upload only with mr_upload" [label="yes"];
    "run_budget {key: ship:upload-path-fixes:<basename>, limit: 1, stage}" -> "upload-path-fixes spent?";
    "upload-path-fixes spent?" -> "mr_upload {mrUrl, path: <corrected path>, runId}" [label="no: this file's one fix"];
    "upload-path-fixes spent?" -> "STOP: upload only with mr_upload" [label="yes"];
    "mr_upload {mrUrl, path: <corrected path>, runId}" -> "mr_upload result?";
    "run_budget {key: ship:upload-timeouts:<basename>, limit: 1, stage}" -> "upload-timeouts spent?";
    "upload-timeouts spent?" -> "mr_upload {mrUrl, path: <timed-out file>, runId}" [label="no: retry once"];
    "upload-timeouts spent?" -> "STOP: upload only with mr_upload" [label="yes"];
    "mr_upload {mrUrl, path: <timed-out file>, runId}" -> "mr_upload result?";
    "STOP: upload only with mr_upload" -> "Off-script gate: mr_upload refused";
    "Off-script gate: mr_upload refused" -> "upload off-script answer?";
    "upload off-script answer?" -> "Forge host (read back)?" [label="take: link the paths"];
    "upload off-script answer?" -> "Which exit?" [label="hand back"];
    "upload off-script answer?" -> "run_hold {stage, reason, decidedBy}" [label="hold"];
    "upload off-script answer?" -> "run_budget {key: ship:upload-off-script, limit: 1, stage}" [label="iterate"];
    "run_budget {key: ship:upload-off-script, limit: 1, stage}" -> "upload-off-script spent?";
    "upload-off-script spent?" -> "mr_upload {mrUrl, path, runId} per file" [label="no: retry the refused files"];
    "upload-off-script spent?" -> "Which exit?" [label="yes: a failure"];
    "Forge host (read back)?" -> "mr_view {mrUrl}" [label="GitLab"];
    "Forge host (read back)?" -> "gh pr view <mr> --json title,body" [label="GitHub"];
    "mr_view {mrUrl}" -> "Write the title and description";
    "gh pr view <mr> --json title,body" -> "Write the title and description";
    "Write the title and description" -> "Forge host (write back)?";
    "Forge host (write back)?" -> "mr_update {mrUrl, title, description}" [label="GitLab"];
    "Forge host (write back)?" -> "gh pr edit <mr> --title <title> --body <description>" [label="GitHub"];
    "mr_update {mrUrl, title, description}" -> "Ship done: return to the orchestrator";
    "gh pr edit <mr> --title <title> --body <description>" -> "Ship done: return to the orchestrator";
    "run_stage {action: fail, stage, reason}" -> "Stage failed";
    "run_hold {stage, reason, decidedBy}" -> "Held: end the turn naming run and stage";
}
```

### Run the domain steps before the gate (none when unbound)

The domain's gathering steps (the diff against the ticket, the branch and
ticket checks, an existing-MR lookup, a mandatory pre-ship review); their
questions go on the `ship` gate.

### Reading a GitLab fact no read tool returns

Read it with `gitlab_get {repoName: <root>, path}` (`path` from the API
root, `:id` for this project) as part of the step: no gate. Quote a GitLab
error as written; a refused credential path is final.

### shipTarget matches the fresh target?

Yes when a readable fresh target equals `shipTarget`: the earlier Proceed
stands, with the answers from the ship gate decision `run_snapshot` shows
(a tree dirty now with no recorded commit or stash answer is asked at
"dirty answer?"). Unset (`run_field_get` errors), `-`, a different target
or an unreadable store opens the gate, naming both targets.

### Gate ship (table below)

One sentence above the form: the branch, the commits about to go, whether
the tree is dirty, and the resolved target (the stack parent, the default
branch, or "the stack could not be read, so the default branch"), so
Proceed is consent to that target. A reopening with a rebase in progress
says so.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `dirty` (write-in) | **Commit the changes (Recommended)** / **Stash them** / **Abort** | the tree is dirty |
| `open_as` (write-in) | **Push and open as draft (Recommended)** / **Push and open ready** | always |
| the domain's own | as the domain rules word them (a ticket mismatch, an MR already open) | the domain declares them |
| `next` | **Proceed** / **Iterate here** / **Go back** / **Hold** | always |
| `to` | one option per earlier stage, split `to-1`, ... over 4 | Go back answered and more than one earlier stage row |

Selection: `{"dirty":"commit|stash|abort|null","open_as":"draft|ready","domain":{<answers>},"next":"proceed|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}`.
Abort's reason is `aborted at the ship gate`. With the store unreadable,
Proceed records `<default branch> (stack store unreadable)`; the rebase
and `mr_create` use the plain name.
Iterate and Hold clear it to `-` first, so a resume re-asks; the work
orchestrator clears it on a redirect reaching ship and on a failure gate
Retry of ship. Spent fix or conflict rounds reopen this gate (not an
Iterate), quoting the failing output or conflicted files; they carry over
a reopen, so a Proceed whose checks still fail reopens with no new fix
rounds.

### Stash them

Nothing in this stage pops the stash.

### Run the domain's fast checks (none when unbound)

Only the checks the domain names, on the changed files; revert generated
drift they leave. A full suite the domain rules out stays out. A finished
rebase reruns them, then the push follows: a pass never rebases twice.

### Resolve the files, then git rebase --continue on Bash

Resolve each conflicted file `git_rebase` returned, then continue on Bash
(no tool continues a rebase).

### Push needs force-with-lease?

Yes only when a rebase finished this pass and the upstream already held
the commits it rewrote; never force otherwise. Never push a branch whose
tests you have not seen pass this session.

### The off-script gates

Each is the gate protocol's Off-script gate (scope `off-script:ship:<n>`,
one `n` for both, `context` quoting the refusal): `action` Take (its
section names the move) or Hand back (a failure, the refusal its reason);
`next` Proceed, Iterate here (the human fixed the cause) or Hold (no
move). Read `next` first: only Proceed applies `action`; retrying
`git_push` or `mr_upload` is Iterate, never Take. A spent Iterate budget
fails the same way, the refusals as the reason.

### Off-script gate: git_push refused

Take: the push outside `git_push` the gate recorded. Iterate counts
nothing: `git_push` bounds its own retries.

### Make the recorded move once

Never retried. It landed when the remote branch carries
`git rev-parse HEAD`, which `pushed` records with no prior id.

### Gate clarify: which forge?

Context: the `git remote get-url origin` line. Options: **GitLab** /
**GitHub** / **Hand back**; `next`: **Proceed** / **Hold**. Later forge
diamonds read the named forge, never the URL.

### Capture the AFTER for the next case the domain names

Per case in the record, the same view as its BEFORE on the pushed sha (a
v1 record's BEFORE is the case `case`); any other capture the domain names
is a new case with its own `id` and `label`. A case with no AFTER after
three tries goes on, the description saying what was tried. A capture is
never uploaded outside the record.

### Off-script gate: mr_upload refused

Reached past a file's path fix, second timeout or second
not-in-the-record refusal; `context` adds the path. Take links the refused
files' local paths (uploaded files keep their markdown). Iterate: the
human moved the file, widened `rt.mcp.uploadRoots`, recaptured or checked
the daemon. Copying a file under an allowed root is only the human's move:
the roots bound what leaves the machine.

### Write the title and description

Title from the ticket or the first commit subject; the body links the
ticket and carries the evidence section built from the record, with each
upload's markdown. The update replaces the whole body, so start from the
read-back: replace any earlier evidence block, keep everything else (a
teammate's edits). The domain's title, template and voice rules win.

## What the graph cannot show

- **`pushed`** hands the watch-ci stage `git_push`'s `sha`, and its
  `priorPipelineId` only when the push moved the branch (commits listed
  before the gate, a commit by this stage since, or a forced push); else
  `null`, or the watch waits for a pipeline that never comes.
- **Hold** records `run_hold`: `reason` their words or the gate,
  `decidedBy` as the answer recorded it.
- **`targetBranch`** is what `branch_stack` resolved: the stack parent
  for a stack member, else the default branch read from git, never
  guessed; on `stackStore: "unavailable"` or an error, the default
  branch. A GitHub PR takes it as `--base`, with `--draft` unless the gate
  said ready. The rebase
  goes onto `origin/<target>`, so a stack member never replays its
  parent's unmerged commits.
- **The MR.** `mr_create`'s `url` is `mrUrl` from here on. `existing:
  true` is an MR already open, nothing passed applied (as the re-call
  after `url: null` returns the first call's MR). The return names both
  targets when its `targetBranch` differs from the resolved one, and says
  squash is unset when asked and never applied.

## Budgets in this stage

Each `run_budget` counts one as its loop is entered and lasts the stage
attempt, through compaction and resume. Its `spent?` diamond reads `spent` against `limit`
(`spent > limit`); ignore `exhausted` and `remaining` (`exhausted` is
`spent >= limit` and would stop one round early). A failure quotes what it last saw (the error, the note, the
failing output or conflicted files, the origin URL and answer, the
refusal) as its reason.

## Domain rules

The domain rules run their own steps in their own order, every mechanical
move landing on this graph. If a rule below asks for a move this graph
marks STOP, take the off-script edge instead. A rule that keeps a capture
out of the record, or keeps a base with no waiver, yields to the evidence
record.

{{slot:domain}}

When nothing is inlined above, the graph alone is the flow: no domain
steps or checks, no rebase, no AFTER.

## Evidence record

{{include:evidence-record}}

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
