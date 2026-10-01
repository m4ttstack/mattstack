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
write `mr` with `run_field_set` (`stage: "ship"`) the moment it exists,
and on failure write `run_stage {action: fail, stage: "ship", reason}`
naming what failed. `<root>` is the worktree root, the absolute path
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
    "Gate ship (table below)" [shape=box];
    "ship answer?" [shape=diamond];
    "Ship gate rounds = 2?" [shape=diamond];
    "Ship gate reopenings = 2?" [shape=diamond];
    "Rebase in progress (ship gate budget spent)?" [shape=diamond];
    "git_rebase {tree: <root>, abort: true} (ship gate budget spent)" [shape=plaintext];
    "Forge clarify answer?" [shape=diamond];
    "Forge clarify rounds = 2?" [shape=diamond];
    "dirty answer?" [shape=diamond];
    "Commit named files, ticket-prefixed subject" [shape=box];
    "Stash them; nothing in this stage pops it" [shape=box];
    "Run the domain's fast checks (none when unbound)" [shape=box];
    "Checks pass?" [shape=diamond];
    "Fix rounds = 3?" [shape=diamond];
    "Fix test-first, commit, rerun" [shape=box];
    "Domain rebases, and no rebase finished this pass?" [shape=diamond];
    "git_rebase {tree: <root>, onto: origin/<resolved target>}" [shape=plaintext];
    "Rebase status?" [shape=diamond];
    "Conflict rounds = 3?" [shape=diamond];
    "Resolve the files, then git rebase --continue on Bash" [shape=box];
    "Continue result?" [shape=diamond];
    "Rebase in progress (stage abort)?" [shape=diamond];
    "git_rebase {tree: <root>, abort: true} (stage abort)" [shape=plaintext];
    "git_rebase {tree: <root>, abort: true} (after a failed continue)" [shape=plaintext];
    "Rebase in progress (go back)?" [shape=diamond];
    "git_rebase {tree: <root>, abort: true} (go back)" [shape=plaintext];
    "git_push {tree: <root>, setUpstream: true}" [shape=plaintext];
    "git_push result?" [shape=diamond];
    "Retried with the printed root?" [shape=diamond];
    "git_push {tree: <the root the error prints>, setUpstream: true}" [shape=plaintext];
    "STOP: push only with git_push; a shell push is off-script" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Off-script gate (gate-protocol, scope off-script:ship:<n>)" [shape=box];
    "off-script answer?" [shape=diamond];
    "Off-script rounds = 2?" [shape=diamond];
    "Make the recorded move once" [shape=box];
    "git remote get-url origin" [shape=plaintext];
    "Forge host?" [shape=diamond];
    "mr_for_branch {repoName: <root>, branches: [<branch>]}" [shape=plaintext];
    "Open MR on the branch?" [shape=diamond];
    "Created once already?" [shape=diamond];
    "mr_create {repoName: <root>, sourceBranch, targetBranch: <resolved target>, title, description, draft, squash?, labels?}" [shape=plaintext];
    "mr_create result?" [shape=diamond];
    "mr_update {mrUrl, squash: true}" [shape=plaintext];
    "STOP: GitLab reads go through the read tools or gitlab_get, writes through the mr_* tools" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "gh pr create --base <resolved target>, draft unless the gate said ready" [shape=plaintext];
    "gh pr create result?" [shape=diamond];
    "Gate clarify: which forge?" [shape=box];
    "run_field_set {key: mr, value: <url>, stage: ship}" [shape=plaintext];
    "Capture the AFTER when the domain names one" [shape=box];
    "AFTER captured, or none named?" [shape=diamond];
    "AFTER attempts = 3?" [shape=diamond];
    "Files to attach?" [shape=diamond];
    "mr_upload {mrUrl, path} per file; keep each markdown" [shape=plaintext];
    "mr_upload result?" [shape=diamond];
    "Upload retried with a corrected path?" [shape=diamond];
    "mr_upload {mrUrl, path: <the corrected absolute path>}" [shape=plaintext];
    "STOP: upload only with mr_upload; another route is off-script" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Off-script gate: mr_upload refused (gate-protocol, scope off-script:ship:<n>)" [shape=box];
    "upload off-script answer?" [shape=diamond];
    "Upload off-script rounds = 2?" [shape=diamond];
    "Timed-out upload retried once?" [shape=diamond];
    "mr_upload {mrUrl, path: <the timed-out file>}" [shape=plaintext];
    "Forge host (read back the description)?" [shape=diamond];
    "mr_view {mrUrl}" [shape=plaintext];
    "gh pr view <mr> --json title,body" [shape=plaintext];
    "Write the title and description" [shape=box];
    "Forge host (write the description)?" [shape=diamond];
    "mr_update {mrUrl, title, description}" [shape=plaintext];
    "gh pr edit <mr> --title <title> --body <description>" [shape=plaintext];
    "run_stage {action: fail, stage: ship, reason}" [shape=plaintext];
    "run_decision {contract: gate@1, scope: hold:ship:<attempt>, selection: {reason}, decidedBy}" [shape=plaintext];
    "run_field_set {key: hold, value: <their words, or held>, stage: ship}" [shape=plaintext];
    "Held: end the turn naming run and stage" [shape=doublecircle];
    "Hand the Go back answer to the orchestrator" [shape=doublecircle];
    "Stage failed" [shape=doublecircle];
    "Ship done: return to the orchestrator" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Ship stage entered" -> "Run the domain steps before the gate (none when unbound)";
    "Run the domain steps before the gate (none when unbound)" -> "git status --porcelain; git log --oneline @{upstream}.. or -5";
    "git status --porcelain; git log --oneline @{upstream}.. or -5" -> "branch_stack {tree: <root>}";
    "branch_stack {tree: <root>}" -> "Stack store readable?";
    "Stack store readable?" -> "Stack member?" [label="yes"];
    "Stack store readable?" -> "Gate ship (table below)" [label="no: stackStore unavailable, or a tool error: the target is the default branch, the stack could not be read"];
    "Stack member?" -> "Gate ship (table below)" [label="yes: the target is the stack parent"];
    "Stack member?" -> "Gate ship (table below)" [label="no: the target is the default branch"];
    "Gate ship (table below)" -> "ship answer?";
    "ship answer?" -> "dirty answer?" [label="proceed"];
    "ship answer?" -> "Ship gate rounds = 2?" [label="iterate: redo with their note"];
    "Ship gate rounds = 2?" -> "Run the domain steps before the gate (none when unbound)" [label="no: redo with their note"];
    "Ship gate rounds = 2?" -> "Rebase in progress (ship gate budget spent)?" [label="yes: a failure, their last note quoted"];
    "ship answer?" -> "Rebase in progress (go back)?" [label="go back"];
    "Rebase in progress (go back)?" -> "git_rebase {tree: <root>, abort: true} (go back)" [label="yes"];
    "Rebase in progress (go back)?" -> "Hand the Go back answer to the orchestrator" [label="no"];
    "git_rebase {tree: <root>, abort: true} (go back)" -> "Hand the Go back answer to the orchestrator";
    "ship answer?" -> "run_decision {contract: gate@1, scope: hold:ship:<attempt>, selection: {reason}, decidedBy}" [label="hold"];
    "run_decision {contract: gate@1, scope: hold:ship:<attempt>, selection: {reason}, decidedBy}" -> "run_field_set {key: hold, value: <their words, or held>, stage: ship}";
    "run_field_set {key: hold, value: <their words, or held>, stage: ship}" -> "Held: end the turn naming run and stage";
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
    "Checks pass?" -> "Fix rounds = 3?" [label="no"];
    "Fix rounds = 3?" -> "Fix test-first, commit, rerun" [label="no"];
    "Fix rounds = 3?" -> "Ship gate reopenings = 2?" [label="yes: reopen, failing output quoted"];
    "Fix test-first, commit, rerun" -> "Run the domain's fast checks (none when unbound)";
    "Domain rebases, and no rebase finished this pass?" -> "git_rebase {tree: <root>, onto: origin/<resolved target>}" [label="yes"];
    "Domain rebases, and no rebase finished this pass?" -> "git_push {tree: <root>, setUpstream: true}" [label="no"];
    "git_rebase {tree: <root>, onto: origin/<resolved target>}" -> "Rebase status?";
    "Rebase status?" -> "Run the domain's fast checks (none when unbound)" [label="clean: the tree changed"];
    "Rebase status?" -> "Conflict rounds = 3?" [label="conflict"];
    "Rebase status?" -> "run_stage {action: fail, stage: ship, reason}" [label="any other error: quote it as the reason"];
    "Conflict rounds = 3?" -> "Resolve the files, then git rebase --continue on Bash" [label="no"];
    "Conflict rounds = 3?" -> "Ship gate reopenings = 2?" [label="yes: reopen, conflicted files quoted"];
    "Ship gate reopenings = 2?" -> "Gate ship (table below)" [label="no: reopen with what was quoted"];
    "Ship gate reopenings = 2?" -> "Rebase in progress (ship gate budget spent)?" [label="yes: a failure, the failing output or conflicted files quoted"];
    "Rebase in progress (ship gate budget spent)?" -> "git_rebase {tree: <root>, abort: true} (ship gate budget spent)" [label="yes"];
    "Rebase in progress (ship gate budget spent)?" -> "run_stage {action: fail, stage: ship, reason}" [label="no: a failure, what was quoted is the reason"];
    "git_rebase {tree: <root>, abort: true} (ship gate budget spent)" -> "run_stage {action: fail, stage: ship, reason}" [label="a failure, what was quoted is the reason"];
    "Resolve the files, then git rebase --continue on Bash" -> "Continue result?";
    "Continue result?" -> "Conflict rounds = 3?" [label="another commit conflicted"];
    "Continue result?" -> "Run the domain's fast checks (none when unbound)" [label="rebase finished"];
    "Continue result?" -> "git_rebase {tree: <root>, abort: true} (after a failed continue)" [label="any other error: a failure, quoted"];
    "git_rebase {tree: <root>, abort: true} (after a failed continue)" -> "run_stage {action: fail, stage: ship, reason}" [label="a failure, the continue error is the reason"];
    "git_push {tree: <root>, setUpstream: true}" -> "git_push result?";
    "git_push {tree: <the root the error prints>, setUpstream: true}" -> "git_push result?";
    "git_push result?" -> "git remote get-url origin" [label="ok"];
    "git_push result?" -> "Retried with the printed root?" [label="tree must be the absolute path of the root"];
    "git_push result?" -> "STOP: push only with git_push; a shell push is off-script" [label="any other error"];
    "Retried with the printed root?" -> "git_push {tree: <the root the error prints>, setUpstream: true}" [label="no"];
    "Retried with the printed root?" -> "STOP: push only with git_push; a shell push is off-script" [label="yes"];
    "STOP: push only with git_push; a shell push is off-script" -> "Off-script gate (gate-protocol, scope off-script:ship:<n>)";
    "Off-script gate (gate-protocol, scope off-script:ship:<n>)" -> "off-script answer?";
    "off-script answer?" -> "Make the recorded move once" [label="proceed + take"];
    "off-script answer?" -> "run_stage {action: fail, stage: ship, reason}" [label="proceed + hand back"];
    "off-script answer?" -> "Off-script rounds = 2?" [label="iterate: the human fixed the cause, retry the push"];
    "off-script answer?" -> "run_decision {contract: gate@1, scope: hold:ship:<attempt>, selection: {reason}, decidedBy}" [label="hold: no move made"];
    "Off-script rounds = 2?" -> "git_push {tree: <root>, setUpstream: true}" [label="no"];
    "Off-script rounds = 2?" -> "run_stage {action: fail, stage: ship, reason}" [label="yes: hand back, the refusal quoted"];
    "Make the recorded move once" -> "git remote get-url origin";
    "git remote get-url origin" -> "Forge host?";
    "Forge host?" -> "mr_for_branch {repoName: <root>, branches: [<branch>]}" [label="GitLab"];
    "Forge host?" -> "gh pr create --base <resolved target>, draft unless the gate said ready" [label="GitHub"];
    "Forge host?" -> "Forge clarify rounds = 2?" [label="anything else"];
    "Forge clarify rounds = 2?" -> "Gate clarify: which forge?" [label="no: ask which forge"];
    "Forge clarify rounds = 2?" -> "run_stage {action: fail, stage: ship, reason}" [label="yes: a failure, the origin URL and their answer quoted"];
    "Gate clarify: which forge?" -> "Forge clarify answer?";
    "Forge clarify answer?" -> "Forge host?" [label="answered: GitLab or GitHub, the host from here on"];
    "Forge clarify answer?" -> "run_decision {contract: gate@1, scope: hold:ship:<attempt>, selection: {reason}, decidedBy}" [label="hold"];
    "Forge clarify answer?" -> "run_stage {action: fail, stage: ship, reason}" [label="hand back: a failure, no forge this stage knows"];
    "mr_for_branch {repoName: <root>, branches: [<branch>]}" -> "Open MR on the branch?";
    "Open MR on the branch?" -> "run_field_set {key: mr, value: <url>, stage: ship}" [label="yes: keep its url"];
    "Open MR on the branch?" -> "Created once already?" [label="no"];
    "Created once already?" -> "mr_create {repoName: <root>, sourceBranch, targetBranch: <resolved target>, title, description, draft, squash?, labels?}" [label="no"];
    "Created once already?" -> "run_stage {action: fail, stage: ship, reason}" [label="yes: the mr_create error is the reason"];
    "mr_create {repoName: <root>, sourceBranch, targetBranch: <resolved target>, title, description, draft, squash?, labels?}" -> "mr_create result?";
    "mr_create result?" -> "run_field_set {key: mr, value: <url>, stage: ship}" [label="url, squash applied or not asked"];
    "mr_create result?" -> "mr_update {mrUrl, squash: true}" [label="squashApplied: false"];
    "mr_create result?" -> "mr_for_branch {repoName: <root>, branches: [<branch>]}" [label="error, or url null: read it back; never create twice"];
    "mr_create result?" -> "STOP: GitLab reads go through the read tools or gitlab_get, writes through the mr_* tools" [label="tempted by the CLI"];
    "STOP: GitLab reads go through the read tools or gitlab_get, writes through the mr_* tools" -> "mr_for_branch {repoName: <root>, branches: [<branch>]}";
    "mr_update {mrUrl, squash: true}" -> "run_field_set {key: mr, value: <url>, stage: ship}";
    "gh pr create --base <resolved target>, draft unless the gate said ready" -> "gh pr create result?";
    "gh pr create result?" -> "run_field_set {key: mr, value: <url>, stage: ship}" [label="url printed"];
    "gh pr create result?" -> "run_field_set {key: mr, value: <url>, stage: ship}" [label="already exists: keep the url it prints"];
    "gh pr create result?" -> "run_stage {action: fail, stage: ship, reason}" [label="any other error: quote it as the reason"];
    "run_field_set {key: mr, value: <url>, stage: ship}" -> "Capture the AFTER when the domain names one";
    "Capture the AFTER when the domain names one" -> "AFTER captured, or none named?";
    "AFTER captured, or none named?" -> "Files to attach?" [label="yes"];
    "AFTER captured, or none named?" -> "AFTER attempts = 3?" [label="no: the capture failed"];
    "AFTER attempts = 3?" -> "Capture the AFTER when the domain names one" [label="no: another attempt"];
    "AFTER attempts = 3?" -> "Files to attach?" [label="yes: go on without it; the description names the gap"];
    "Files to attach?" -> "mr_upload {mrUrl, path} per file; keep each markdown" [label="yes, GitLab"];
    "Files to attach?" -> "Forge host (read back the description)?" [label="no, or GitHub: link the paths"];
    "mr_upload {mrUrl, path} per file; keep each markdown" -> "mr_upload result?";
    "mr_upload result?" -> "mr_view {mrUrl}" [label="ok: every file uploaded"];
    "mr_upload result?" -> "mr_upload {mrUrl, path} per file; keep each markdown" [label="ok: files still to upload"];
    "mr_upload result?" -> "Upload retried with a corrected path?" [label="path must be absolute, or file not found"];
    "mr_upload result?" -> "STOP: upload only with mr_upload; another route is off-script" [label="any other refusal: outside the roots, bytes, size"];
    "mr_upload result?" -> "STOP: upload only with mr_upload; another route is off-script" [label="tempted to copy the file into an allowed root, or upload another way"];
    "Upload retried with a corrected path?" -> "mr_upload {mrUrl, path: <the corrected absolute path>}" [label="no: this file's one fix"];
    "Upload retried with a corrected path?" -> "STOP: upload only with mr_upload; another route is off-script" [label="yes"];
    "mr_upload {mrUrl, path: <the corrected absolute path>}" -> "mr_upload result?";
    "mr_upload result?" -> "Timed-out upload retried once?" [label="timed out"];
    "Timed-out upload retried once?" -> "mr_upload {mrUrl, path: <the timed-out file>}" [label="no: retry once, a timed-out upload is safe to repeat"];
    "Timed-out upload retried once?" -> "STOP: upload only with mr_upload; another route is off-script" [label="yes: timed out twice"];
    "mr_upload {mrUrl, path: <the timed-out file>}" -> "mr_upload result?";
    "STOP: upload only with mr_upload; another route is off-script" -> "Off-script gate: mr_upload refused (gate-protocol, scope off-script:ship:<n>)";
    "Off-script gate: mr_upload refused (gate-protocol, scope off-script:ship:<n>)" -> "upload off-script answer?";
    "upload off-script answer?" -> "Forge host (read back the description)?" [label="proceed + take: link the refused files' local paths"];
    "upload off-script answer?" -> "run_stage {action: fail, stage: ship, reason}" [label="proceed + hand back"];
    "upload off-script answer?" -> "Upload off-script rounds = 2?" [label="iterate: the human fixed the cause, retry the upload"];
    "upload off-script answer?" -> "run_decision {contract: gate@1, scope: hold:ship:<attempt>, selection: {reason}, decidedBy}" [label="hold: nothing linked"];
    "Upload off-script rounds = 2?" -> "mr_upload {mrUrl, path} per file; keep each markdown" [label="no: retry the refused files"];
    "Upload off-script rounds = 2?" -> "run_stage {action: fail, stage: ship, reason}" [label="yes: hand back, the refusal quoted"];
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
}
```

### Run the domain steps before the gate (none when unbound)

The domain's gathering steps: sanity of the diff against the ticket, the
branch and ticket checks, an existing-MR lookup, any mandatory pre-ship
review. Each one that raises a question adds it to the `ship` gate rather
than asking on its own. A GitLab fact these steps need that no read tool
returns is read as in "Reading a GitLab fact no read tool returns".

### Reading a GitLab fact no read tool returns

At any step of this stage, a GitLab fact the read tools do not return is
read with `gitlab_get {repoName, path}`: `repoName` = the checkout or
tree this stage already targets, `path` relative to the API root with `:id`
for this project, for example `projects/:id/merge_requests/<iid>/approvals`.
The read is part of the step that needs it, not an off-script move, so it
opens no gate. A GitLab error is quoted as GitLab wrote it. Its refusal of
a credential path is final.

### Run the domain's fast checks (none when unbound)

Only the checks the domain names, on the changed files. Revert generated
drift the checks leave behind before continuing. A full suite the domain
rules out stays out: CI runs it.

### Fix test-first, commit, rerun

Each fix gets its failing test first, then the fix, then a commit. The
counter is fix rounds within this pass through the stage.

### Resolve the files, then git rebase --continue on Bash

Resolve each conflicted file `git_rebase` returned, then continue the
rebase on Bash (no tool continues one). A later commit that conflicts
counts as another round. Once a rebase finishes, clean or resolved, the
fast checks run again because the tree changed under them, and then the
push follows: this pass never starts a second rebase. A continue that
fails with anything but another conflict aborts the rebase, then fails
the stage with the error quoted.

### Capture the AFTER when the domain names one

The same view as the BEFORE in `evidence`, on the sha you pushed. The
counter is attempts within this pass through the stage; after the third
failure, ship without it and say in the description what was tried.
Unbound, there is no AFTER.

### Off-script gate: mr_upload refused (gate-protocol, scope off-script:ship:<n>)

The upload guard refused a file past its one fix; a second timeout on
the same file reaches this gate too, and Iterate retries it once the
human has checked the daemon. Scope
`off-script:ship:<n>`, sharing `n` with the push's off-script gate,
`context` quoting the refusal and the path. Take writes the description
with the refused files' local paths linked instead of uploads, while files
already uploaded keep their upload markdown; Iterate means the human moved
the file, widened `rt.mcp.uploadRoots` or recaptured. Copying a file under
an allowed root is only ever the human's move: the roots are the boundary
on what leaves the machine.

### Write the title and description

Title from the ticket or the first commit subject; the body links the
ticket and every `evidence` entry, with the upload markdown where it
exists. The update replaces the whole body, so start from the one just
read back: keep what is already there (evidence the evidence stage
attached, a teammate's edits) and change only what this stage owns. The
domain's title, template and voice rules win over this paragraph.

### Gate clarify: which forge?

The origin host is neither GitLab nor GitHub. Ask which forge it is,
quoting the `git remote get-url origin` line as the context. Options:
**GitLab** / **GitHub** / **Hand back**, and `next`: **Proceed** /
**Hold**. `Forge clarify rounds = 2?` counts the times the host reads as
neither within this pass through the stage, this one included: the first
asks, and the second fails the stage with the origin URL and the answer
quoted. The named forge stands for the host from here on: this diamond
and every later forge diamond read the answer, never the origin URL
again, so the counter trips only when the answer names no forge this
stage knows.

## What the graph cannot show

- **Off-script answers.** Read `next` first: Hold ends the turn with no
  move made; Iterate means the human fixed the cause and ignores
  `action`; only Proceed applies `action`. Retrying `git_push` or
  `mr_upload` is Iterate, never Take; rounds count per stage attempt.
- After a rebase that rewrote already-pushed commits, push with
  `git_push {tree: <root>, forceWithLease: true}` instead. Never force
  otherwise, and never push a branch whose tests you have not seen pass in
  this session.
- `targetBranch` is the target `branch_stack` resolved before the gate:
  the stack parent when the branch is a stack member, else the default
  branch read from git, never guessed. When `branch_stack` reports
  `stackStore: "unavailable"` or errors, the target is the default branch
  and the gate's context says the stack could not be read. A GitHub PR
  takes the same target as `--base`. The domain rebase goes onto
  `origin/<that target>`, so a stack member never replays its parent's
  unmerged commits; the gate names the target, the unreadable-store
  fallback included, before any rebase runs.
  Keep the `url` `mr_create` returns as `mrUrl` for every later write.

## Gate `ship` (before the push)

One sentence above the form: the branch, the commits about to go, whether
the tree is dirty, and the resolved target (the stack parent, the default
branch, or "the stack could not be read, so the default branch"), so
Proceed is consent to that target. When the gate reopens with a rebase in
progress (the conflict rounds are spent), the context says so, since Abort
or Go back then aborts that rebase.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `dirty` | **Commit the changes** / **Stash them** / **Abort** | the tree is dirty |
| `open_as` | **Push and open as draft** / **Push and open ready** | always |
| the domain's own | as the domain rules word them (a ticket mismatch, an MR already open) | the domain declares them |
| `next` | **Proceed** / **Iterate here** / **Go back** / **Hold** | always |
| `to` | one option per earlier stage, split `to-1`, ... over 4 | Go back answered and more than one earlier stage row |

Selection: `{"dirty":"commit|stash|abort|null","open_as":"draft|ready","domain":{<answers>},"next":"proceed|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}`.
Abort pushes nothing and aborts a rebase in progress before the stage fails.
Go back also aborts a rebase in progress first, so the earlier stage never
receives a tree that is mid-rebase.
`Ship gate rounds = 2?` counts Iterate answers at this gate within this
pass through the stage, this one included: the first redoes the steps
before the gate with the note, and the second fails the stage with the
note quoted. `Ship gate reopenings = 2?` counts the times the fix or
conflict rounds run out and reopen this gate within this pass through
the stage, this one included: the first reopens it with the failing
output or conflicted files quoted, and the second fails the stage with
them quoted. The fix and conflict rounds carry over a reopen: the
reopened gate is the human's turn to fix it, so a Proceed whose checks
still fail reaches this counter again without new fix rounds. Either
failure aborts a rebase in progress first.

## Domain rules

The domain rules below supply content, checks and extra gate questions.
Where a domain step names a move the graph above marks STOP, the STOP
node's edge wins: a shell push fallback opens the push's off-script gate;
a GitLab CLI read goes through the read tools or `gitlab_get`, and a
write through the `mr_*` tools.

{{slot:domain}}

When nothing is inlined above, the graph alone is the flow: no steps
before the gate, no fast checks, no rebase, no AFTER.

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
