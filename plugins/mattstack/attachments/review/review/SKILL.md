---
name: review
disable-model-invocation: true
description: "Use when reviewing someone else's MR or PR before it merges -- a pasted MR/PR link or !iid, 'review this MR', 'check my co-worker's change', 'is this MR solid'. For your own uncommitted work use self-review; for feedback on your own MR use receive-review."
type: pipeline-step
slots:
  criteria: { contract: review-criteria@1, required: false }
  reviewer: { contract: reviewer-dispatch@1, required: false }
---

# review

The standalone entry for reviewing someone else's change. The graph below
is the run: follow its edges, and treat a move it does not show as a
question for a gate, never as a judgment call. Reads through the read
tools and `gitlab_get` are part of the step that needs them, not moves.

## Run

Outside a pipeline this verb is its own run, so the console shows it and
the Stop hook covers its pane. The graph's first call, `run_enter`, starts,
resumes or inherits the run, or returns the running candidates to choose
between. Never list, read or build run dbs by hand.

`run_enter` takes:

- `flags`: this verb's value in the block below, verbatim;
- `skillDir`: this skill's own directory;
- `stage: review`;
- `runDb`: only when a caller handed you one;
- `resume`: a review run id to resume, when the caller or the developer
  names one, or when a handed `--report` carries a `review-run: <run id>`
  line (that id, even in a pane a surface launched);
- `spawnedBy`: only when a board or another surface launched this pane.

{{run-start.flags:review}}

Keep the `runDb` it returns and pass it to every `run_*` and gate call;
nothing is exported. Your stage is `review` on a run you started or
resumed. On a run you inherited (`mode: inherited`, a running run a caller
handed you), your stage is the result's `at.stage`, written
`<run.current_stage>` in the graph, and the caller closes the run. A handed
`runDb` whose run is no longer running is not inherited: `run_enter`
carries on as if none was handed, and its result says
`handedRunDb: "not-running"`.

Every gate after `run_enter` runs through gate-protocol with `runDb` and
`stage`, so the gate tools write the run's gate fields. The clarify and
off-script gates record their answers map when answered. The posting gate
is a review gate: its answer records nothing until `gate_record`, after
posting. This verb writes no `gate` field and no gate decision by hand.

Every loop counter is a `run_budget {runDb, key, limit, stage}` call: each
counted event charges `increment: 1` (the default), the counter diamond
reads the result's `exhausted`, and the count survives compaction and
resume. The keys:

| Key | Limit | Counts |
|---|---|---|
| `target-clarify` | 2 | typed answers at the target clarify gate |
| `verify-rounds:<depth>` | 2 | verify rounds that left a blocking finding unverified, at that depth |
| `post-open-fix` | 1 | fixes made to a field a posting-gate refusal named |
| `bad-anchors` | 1 | bad-anchor findings moved into the summary |

A once-only fix (`post-open-fix`, `bad-anchors`) is two calls: a read with
`increment: 0` before its diamond, then the charge on the diamond's `no`
edge, right before the fix.

{{include:run-identity}}

## The review graph

```dot
digraph review {
    rankdir=TB;

    "Trigger: review a teammate's MR or PR" [shape=ellipse];
    "run_enter {flags, skillDir, stage: review, runDb?, resume?, spawnedBy?}" [shape=plaintext];
    "review run_enter mode?" [shape=diamond];
    "Gate review clarify: Resume / Start fresh / Hold" [shape=box];
    "Review resume answer?" [shape=diamond];
    "run_enter {flags, skillDir, stage: review, resume: <picked runId>}" [shape=plaintext];
    "run_enter {flags, skillDir, stage: review, fresh: true, spawnedBy?}" [shape=plaintext];
    "The refused review run_enter carried resume?" [shape=diamond];
    "STOP: rt predates the run tools; tell the user to update rt" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "run_snapshot {runDb: <resumed review>}" [shape=plaintext];
    "Resumed review snapshot records?" [shape=diamond];

    "Resolve the review target" [shape=box];
    "Review target form?" [shape=diamond];
    "mr_view {mrUrl, or repoName + iid}" [shape=plaintext];
    "mr_view returned the MR?" [shape=diamond];
    "mr_for_branch {repoName: <checkout>, branches: [<branch>]}" [shape=plaintext];
    "mr_for_branch entry for the branch?" [shape=diamond];
    "gh pr view <ref>" [shape=plaintext];
    "gh pr view found the PR?" [shape=diamond];
    "mr_list {repoName: <checkout>, sourceBranch: <branch>, state: all, limit: 200}" [shape=plaintext];
    "mr_list matches for the branch?" [shape=diamond];
    "mr_list {repoName: <checkout>, search: <ticket id>, state: all, limit: 200}" [shape=plaintext];
    "mr_list matches for the ticket?" [shape=diamond];
    "run_budget {runDb, key: target-clarify, limit: 2, stage}" [shape=plaintext];
    "Review clarify rounds = 2?" [shape=diamond];
    "STOP: GitLab ticket searches go through the read tools or gitlab_get" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "STOP: GitLab reads go through the read tools or gitlab_get" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "STOP: GitLab branch lookups go through the read tools or gitlab_get" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Gate review clarify: which target?" [shape=box];
    "Review target answer?" [shape=diamond];
    "Own review run: record the target?" [shape=diamond];
    "Record the review target: mr, branch and any ticket" [shape=box];
    "Caller framed a re-review?" [shape=diamond];
    "Take the earlier threads the caller handed in" [shape=box];
    "Earlier threads in hand?" [shape=diamond];

    "Print the review depth block" [shape=box];
    "Review diff forge?" [shape=diamond];
    "gh pr diff <ref>" [shape=plaintext];
    "git fetch origin +pull/<n>/head:refs/remotes/origin/pr-<n>" [shape=plaintext];
    "git fetch origin <targetBranch> +refs/merge-requests/<iid>/head:refs/remotes/origin/mr-<iid>" [shape=plaintext];
    "git diff origin/<targetBranch>...origin/mr-<iid>" [shape=plaintext];
    "MR-head checkout in hand for the review checks?" [shape=diamond];
    "worktree_provision {repoName, branch: <source branch>, reuse: true} for the review head" [shape=plaintext];
    "Review head worktree_provision returned a path?" [shape=diamond];
    "Provisioned review tree at the fetched head?" [shape=diamond];
    "STOP: create a review checkout only with worktree_provision" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Set up for the review depth" [shape=box];
    "Dispatch the fresh reviewer; it forms the findings" [shape=box];
    "Assemble the review draft" [shape=box];
    "Verify each blocking finding against the MR head" [shape=box];
    "Every blocking finding verified?" [shape=diamond];
    "run_budget {runDb, key: verify-rounds:<depth>, limit: 2, stage}" [shape=plaintext];
    "Review verify rounds = 2?" [shape=diamond];
    "Re-dispatch a fresh reviewer on the unverified findings" [shape=box];
    "Demote each unverified finding to Minor, marked unverified" [shape=box];
    "Review report path given?" [shape=diamond];
    "Write the review report and its json sibling" [shape=box];

    "Decided selection handed in by the review caller?" [shape=diamond];
    "Review report json in hand?" [shape=diamond];
    "Write review-post.extras.json" [shape=box];
    "Caller owns the review gates?" [shape=diamond];
    "Review report json under the Claude Code temp root?" [shape=diamond];
    "Copy the report json into the review scratch dir" [shape=box];
    "gate_open {kind: review-post, review: {findingsPath, extras}, runDb, stage, scope: post}" [shape=plaintext];
    "sh \"${CLAUDE_SKILL_DIR}/scripts/review-source.sh\" <report json> <dir>/review-post.extras.json > <dir>/review-post.source.json" [shape=plaintext];
    "review-source.sh exit 0?" [shape=diamond];
    "gate_open {kind: review-post, sourcePath: <dir>/review-post.source.json, handBack: true, outPath: <dir>/review-post.open.json, runDb, stage, scope: post}" [shape=plaintext];
    "gate_open result?" [shape=diamond];
    "STOP: never hand-edit or hand-fit the review-post open; open the review off-script gate" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "run_budget {runDb, key: post-open-fix, limit: 1, increment: 0, stage}" [shape=plaintext];
    "Fixed a field a review script named once already?" [shape=diamond];
    "run_budget {runDb, key: post-open-fix, limit: 1, stage}" [shape=plaintext];
    "Fix the field the review script names" [shape=box];
    "Open the review off-script gate: a review script refused" [shape=box];
    "Review script off-script answer?" [shape=diamond];
    "Write the review-run line into the handed --report" [shape=box];
    "Hand back the severity line and the open's paths" [shape=box];
    "Review caller's answer?" [shape=diamond];
    "Gate review-post: carry the opened gate through gate-protocol" [shape=box];
    "Gate review-post, legacy: tiers, outcome and next" [shape=box];
    "Review-post next answer?" [shape=diamond];
    "Take the human's changes into the review draft" [shape=box];
    "Review iterate note asks for another depth?" [shape=diamond];

    "Review posting forge?" [shape=diamond];
    "gh pr review <ref> with the disposition and the summary body" [shape=plaintext];
    "gh pr review result?" [shape=diamond];
    "Open the review off-script gate: gh pr review refused" [shape=box];
    "gh pr review off-script answer?" [shape=diamond];
    "gh pr comment <ref> with the summary body" [shape=plaintext];
    "Compose the submitted review: comments, summary, outcome" [shape=box];
    "Resumed review run: read the MR before the submit?" [shape=diamond];
    "mr_posted_since {mrUrl, since: <run started_at>, items}" [shape=plaintext];
    "This review already on the MR?" [shape=diamond];
    "mr_review_submit {mrUrl, outcome, summary, comments, replies}" [shape=plaintext];
    "mr_review_submit result?" [shape=diamond];
    "run_budget {runDb, key: bad-anchors, limit: 1, increment: 0, stage}" [shape=plaintext];
    "Bad anchors moved into the summary once already?" [shape=diamond];
    "run_budget {runDb, key: bad-anchors, limit: 1, stage}" [shape=plaintext];
    "Move the bad-anchor findings into the summary" [shape=box];
    "STOP: never post a review piece by piece or with the GitLab CLI; open the review off-script gate" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Open the review off-script gate: mr_review_submit refused" [shape=box];
    "Open the review off-script gate: pending comments on the MR" [shape=box];
    "Review submit off-script answer?" [shape=diamond];
    "Make the recorded review move once" [shape=box];
    "mr_approve {mrUrl}" [shape=plaintext];
    "mr_approve result?" [shape=diamond];
    "Open the review off-script gate: mr_approve refused" [shape=box];
    "Approval off-script answer?" [shape=diamond];
    "Make the recorded approval move once" [shape=box];
    "gate_record {runDb, stage, scope: post, shape: post, gateId | answers + decidedBy}" [shape=plaintext];
    "Own review run: close it?" [shape=diamond];
    "Own review run: close it as abandoned?" [shape=diamond];
    "run_close {runDb, workType: review, stage: review, outcome}" [shape=plaintext];
    "Review closed as?" [shape=diamond];
    "End with the review target's forge link" [shape=box];
    "run_stage {action: fail, stage: <run.current_stage>, reason: <why; what already posted>}" [shape=plaintext];
    "run_hold {runDb, stage, reason, decidedBy} for review" [shape=plaintext];
    "Review held: end the turn" [shape=doublecircle];
    "Review handed back: the why and what posted, quoted" [shape=doublecircle];
    "Review posted" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: review a teammate's MR or PR" -> "run_enter {flags, skillDir, stage: review, runDb?, resume?, spawnedBy?}";
    "run_enter {flags, skillDir, stage: review, runDb?, resume?, spawnedBy?}" -> "review run_enter mode?";
    "run_enter {flags, skillDir, stage: review, resume: <picked runId>}" -> "review run_enter mode?";
    "run_enter {flags, skillDir, stage: review, fresh: true, spawnedBy?}" -> "review run_enter mode?";
    "review run_enter mode?" -> "Resolve the review target" [label="started, or inherited: stage is at.stage"];
    "review run_enter mode?" -> "run_snapshot {runDb: <resumed review>}" [label="resumed"];
    "review run_enter mode?" -> "Gate review clarify: Resume / Start fresh / Hold" [label="candidates"];
    "review run_enter mode?" -> "The refused review run_enter carried resume?" [label="refused, or the tool is missing"];
    "The refused review run_enter carried resume?" -> "run_enter {flags, skillDir, stage: review, fresh: true, spawnedBy?}" [label="yes: say the resume was refused, start fresh"];
    "The refused review run_enter carried resume?" -> "STOP: rt predates the run tools; tell the user to update rt" [label="no"];
    "Gate review clarify: Resume / Start fresh / Hold" -> "Review resume answer?";
    "Review resume answer?" -> "run_enter {flags, skillDir, stage: review, resume: <picked runId>}" [label="resume"];
    "Review resume answer?" -> "run_enter {flags, skillDir, stage: review, fresh: true, spawnedBy?}" [label="start fresh"];
    "Review resume answer?" -> "Review held: end the turn" [label="hold: no run yet, record nothing"];
    "run_snapshot {runDb: <resumed review>}" -> "Resumed review snapshot records?";
    "Resumed review snapshot records?" -> "Resolve the review target" [label="no post decision: re-enter, reuse every recorded answer"];
    "Resumed review snapshot records?" -> "Own review run: close it?" [label="a post decision: posting already ran"];

    "Resolve the review target" -> "Review target form?";
    "Review target form?" -> "mr_view {mrUrl, or repoName + iid}" [label="GitLab URL or iid"];
    "Review target form?" -> "mr_for_branch {repoName: <checkout>, branches: [<branch>]}" [label="GitLab branch name"];
    "Review target form?" -> "gh pr view <ref>" [label="GitHub"];
    "Review target form?" -> "Gate review clarify: which target?" [label="several candidates"];
    "Review target form?" -> "mr_list {repoName: <checkout>, search: <ticket id>, state: all, limit: 200}" [label="ticket id only"];
    "mr_for_branch {repoName: <checkout>, branches: [<branch>]}" -> "mr_for_branch entry for the branch?";
    "mr_for_branch entry for the branch?" -> "mr_view {mrUrl, or repoName + iid}" [label="an iid"];
    "mr_for_branch entry for the branch?" -> "mr_list {repoName: <checkout>, sourceBranch: <branch>, state: all, limit: 200}" [label="null: no open MR, look for a merged or closed one"];
    "mr_for_branch entry for the branch?" -> "run_hold {runDb, stage, reason, decidedBy} for review" [label="an error: hold, quoting its text"];
    "mr_for_branch entry for the branch?" -> "STOP: GitLab branch lookups go through the read tools or gitlab_get" [label="tempted to look it up with the GitLab CLI"];
    "STOP: GitLab branch lookups go through the read tools or gitlab_get" -> "mr_list {repoName: <checkout>, sourceBranch: <branch>, state: all, limit: 200}";
    "mr_list {repoName: <checkout>, sourceBranch: <branch>, state: all, limit: 200}" -> "mr_list matches for the branch?";
    "mr_list matches for the branch?" -> "mr_view {mrUrl, or repoName + iid}" [label="exactly one: its iid"];
    "mr_list matches for the branch?" -> "run_hold {runDb, stage, reason, decidedBy} for review" [label="none: hold, GitLab has no MR for the branch"];
    "mr_list matches for the branch?" -> "Gate review clarify: which target?" [label="several, or a truncated list"];
    "mr_list matches for the branch?" -> "run_hold {runDb, stage, reason, decidedBy} for review" [label="an error: hold, quoting its text (never read as none)"];
    "mr_list {repoName: <checkout>, search: <ticket id>, state: all, limit: 200}" -> "mr_list matches for the ticket?";
    "Review target form?" -> "STOP: GitLab ticket searches go through the read tools or gitlab_get" [label="tempted to search with the GitLab CLI"];
    "STOP: GitLab ticket searches go through the read tools or gitlab_get" -> "mr_list {repoName: <checkout>, search: <ticket id>, state: all, limit: 200}";
    "mr_list matches for the ticket?" -> "mr_view {mrUrl, or repoName + iid}" [label="exactly one, from a complete read: its iid"];
    "mr_list matches for the ticket?" -> "Gate review clarify: which target?" [label="none, several, or a truncated list"];
    "mr_list matches for the ticket?" -> "Gate review clarify: which target?" [label="an error: quoted in the gate's sentence"];
    "mr_view {mrUrl, or repoName + iid}" -> "mr_view returned the MR?";
    "mr_view returned the MR?" -> "Own review run: record the target?" [label="yes"];
    "mr_view returned the MR?" -> "run_hold {runDb, stage, reason, decidedBy} for review" [label="an error: hold, quoting its text (usually GitLab's 404 or 403)"];
    "mr_view returned the MR?" -> "STOP: GitLab reads go through the read tools or gitlab_get" [label="tempted to read it with the GitLab CLI"];
    "STOP: GitLab reads go through the read tools or gitlab_get" -> "mr_view {mrUrl, or repoName + iid}";
    "gh pr view <ref>" -> "gh pr view found the PR?";
    "gh pr view found the PR?" -> "Own review run: record the target?" [label="yes"];
    "gh pr view found the PR?" -> "run_hold {runDb, stage, reason, decidedBy} for review" [label="no: hold, quoting the error"];
    "Gate review clarify: which target?" -> "Review target answer?";
    "Review target answer?" -> "Review target form?" [label="a target picked: resolve it"];
    "Review target answer?" -> "run_budget {runDb, key: target-clarify, limit: 2, stage}" [label="their text: charge it"];
    "run_budget {runDb, key: target-clarify, limit: 2, stage}" -> "Review clarify rounds = 2?";
    "Review clarify rounds = 2?" -> "Review target form?" [label="no: not exhausted, resolve it"];
    "Review clarify rounds = 2?" -> "run_hold {runDb, stage, reason, decidedBy} for review" [label="yes: exhausted, hold naming what was tried"];
    "Review target answer?" -> "run_hold {runDb, stage, reason, decidedBy} for review" [label="next: hold"];
    "Own review run: record the target?" -> "Record the review target: mr, branch and any ticket" [label="yes"];
    "Own review run: record the target?" -> "Caller framed a re-review?" [label="no: inherited"];
    "Record the review target: mr, branch and any ticket" -> "Caller framed a re-review?";
    "Caller framed a re-review?" -> "Take the earlier threads the caller handed in" [label="yes"];
    "Caller framed a re-review?" -> "Print the review depth block" [label="no: a first review"];
    "Take the earlier threads the caller handed in" -> "Earlier threads in hand?";
    "Earlier threads in hand?" -> "Print the review depth block" [label="yes, or none to judge"];
    "Earlier threads in hand?" -> "run_hold {runDb, stage, reason, decidedBy} for review" [label="no: the thread read errored; hold, quoting its text"];

    "Print the review depth block" -> "Review diff forge?";
    "Review diff forge?" -> "gh pr diff <ref>" [label="GitHub"];
    "Review diff forge?" -> "git fetch origin <targetBranch> +refs/merge-requests/<iid>/head:refs/remotes/origin/mr-<iid>" [label="GitLab"];
    "git fetch origin <targetBranch> +refs/merge-requests/<iid>/head:refs/remotes/origin/mr-<iid>" -> "git diff origin/<targetBranch>...origin/mr-<iid>";
    "git diff origin/<targetBranch>...origin/mr-<iid>" -> "MR-head checkout in hand for the review checks?";
    "gh pr diff <ref>" -> "git fetch origin +pull/<n>/head:refs/remotes/origin/pr-<n>";
    "git fetch origin +pull/<n>/head:refs/remotes/origin/pr-<n>" -> "MR-head checkout in hand for the review checks?";
    "MR-head checkout in hand for the review checks?" -> "Set up for the review depth" [label="yes, or read depth"];
    "MR-head checkout in hand for the review checks?" -> "worktree_provision {repoName, branch: <source branch>, reuse: true} for the review head" [label="no: verify or repro depth"];
    "MR-head checkout in hand for the review checks?" -> "STOP: create a review checkout only with worktree_provision" [label="tempted to create one by hand"];
    "STOP: create a review checkout only with worktree_provision" -> "worktree_provision {repoName, branch: <source branch>, reuse: true} for the review head";
    "worktree_provision {repoName, branch: <source branch>, reuse: true} for the review head" -> "Review head worktree_provision returned a path?";
    "Review head worktree_provision returned a path?" -> "Provisioned review tree at the fetched head?" [label="yes: provisioned or reused; run the checks in that path"];
    "Review head worktree_provision returned a path?" -> "Dispatch the fresh reviewer; it forms the findings" [label="no: refused; the checks are noted as not run"];
    "Provisioned review tree at the fetched head?" -> "Set up for the review depth" [label="yes"];
    "Provisioned review tree at the fetched head?" -> "Dispatch the fresh reviewer; it forms the findings" [label="no: checks noted as not run, both shas quoted"];
    "Set up for the review depth" -> "Dispatch the fresh reviewer; it forms the findings";
    "Dispatch the fresh reviewer; it forms the findings" -> "Assemble the review draft";
    "Assemble the review draft" -> "Verify each blocking finding against the MR head";
    "Verify each blocking finding against the MR head" -> "Every blocking finding verified?";
    "Every blocking finding verified?" -> "Review report path given?" [label="yes, or none are blocking"];
    "Every blocking finding verified?" -> "run_budget {runDb, key: verify-rounds:<depth>, limit: 2, stage}" [label="no: charge the round"];
    "run_budget {runDb, key: verify-rounds:<depth>, limit: 2, stage}" -> "Review verify rounds = 2?";
    "Review verify rounds = 2?" -> "Re-dispatch a fresh reviewer on the unverified findings" [label="no: not exhausted"];
    "Review verify rounds = 2?" -> "Demote each unverified finding to Minor, marked unverified" [label="yes: exhausted"];
    "Re-dispatch a fresh reviewer on the unverified findings" -> "Assemble the review draft";
    "Demote each unverified finding to Minor, marked unverified" -> "Review report path given?";
    "Review report path given?" -> "Write the review report and its json sibling" [label="yes"];
    "Review report path given?" -> "Decided selection handed in by the review caller?" [label="no"];
    "Write the review report and its json sibling" -> "Decided selection handed in by the review caller?";

    "Decided selection handed in by the review caller?" -> "Review posting forge?" [label="yes: use it, ask nothing"];
    "Decided selection handed in by the review caller?" -> "Review report json in hand?" [label="no"];
    "Review report json in hand?" -> "Write review-post.extras.json" [label="yes"];
    "Review report json in hand?" -> "Gate review-post, legacy: tiers, outcome and next" [label="no"];
    "Write review-post.extras.json" -> "Caller owns the review gates?";
    "Caller owns the review gates?" -> "sh \"${CLAUDE_SKILL_DIR}/scripts/review-source.sh\" <report json> <dir>/review-post.extras.json > <dir>/review-post.source.json" [label="yes: a board wrapper said so"];
    "Caller owns the review gates?" -> "Review report json under the Claude Code temp root?" [label="no: direct run"];
    "Review report json under the Claude Code temp root?" -> "gate_open {kind: review-post, review: {findingsPath, extras}, runDb, stage, scope: post}" [label="yes: findingsPath is the report json"];
    "Review report json under the Claude Code temp root?" -> "Copy the report json into the review scratch dir" [label="no: a --report elsewhere"];
    "Copy the report json into the review scratch dir" -> "gate_open {kind: review-post, review: {findingsPath, extras}, runDb, stage, scope: post}";
    "gate_open {kind: review-post, review: {findingsPath, extras}, runDb, stage, scope: post}" -> "gate_open result?";
    "sh \"${CLAUDE_SKILL_DIR}/scripts/review-source.sh\" <report json> <dir>/review-post.extras.json > <dir>/review-post.source.json" -> "review-source.sh exit 0?";
    "review-source.sh exit 0?" -> "gate_open {kind: review-post, sourcePath: <dir>/review-post.source.json, handBack: true, outPath: <dir>/review-post.open.json, runDb, stage, scope: post}" [label="yes"];
    "review-source.sh exit 0?" -> "run_budget {runDb, key: post-open-fix, limit: 1, increment: 0, stage}" [label="exit 1: names a field"];
    "review-source.sh exit 0?" -> "Open the review off-script gate: a review script refused" [label="exit 2: no field to fix"];
    "gate_open {kind: review-post, sourcePath: <dir>/review-post.source.json, handBack: true, outPath: <dir>/review-post.open.json, runDb, stage, scope: post}" -> "gate_open result?";
    "gate_open result?" -> "Gate review-post: carry the opened gate through gate-protocol" [label="opened: the direct run"];
    "gate_open result?" -> "Write the review-run line into the handed --report" [label="handed back: the open is at outPath"];
    "gate_open result?" -> "run_budget {runDb, key: post-open-fix, limit: 1, increment: 0, stage}" [label="refused: a line names a field to fix"];
    "gate_open result?" -> "Open the review off-script gate: a review script refused" [label="refused: nothing a field fix can mend"];
    "gate_open result?" -> "STOP: never hand-edit or hand-fit the review-post open; open the review off-script gate" [label="tempted to edit the open by hand or fit it with a script"];
    "STOP: never hand-edit or hand-fit the review-post open; open the review off-script gate" -> "Open the review off-script gate: a review script refused";
    "run_budget {runDb, key: post-open-fix, limit: 1, increment: 0, stage}" -> "Fixed a field a review script named once already?";
    "Fixed a field a review script named once already?" -> "run_budget {runDb, key: post-open-fix, limit: 1, stage}" [label="no: charge the fix"];
    "Fixed a field a review script named once already?" -> "Open the review off-script gate: a review script refused" [label="yes: exhausted"];
    "run_budget {runDb, key: post-open-fix, limit: 1, stage}" -> "Fix the field the review script names";
    "Fix the field the review script names" -> "Caller owns the review gates?";
    "Open the review off-script gate: a review script refused" -> "Review script off-script answer?";
    "Review script off-script answer?" -> "Gate review-post, legacy: tiers, outcome and next" [label="take: open the legacy gate instead"];
    "Review script off-script answer?" -> "Write review-post.extras.json" [label="iterate here: rebuild with their note"];
    "Review script off-script answer?" -> "run_hold {runDb, stage, reason, decidedBy} for review" [label="hold"];
    "Review script off-script answer?" -> "Own review run: close it as abandoned?" [label="hand back"];
    "Write the review-run line into the handed --report" -> "Hand back the severity line and the open's paths";
    "Hand back the severity line and the open's paths" -> "Review caller's answer?";
    "Review caller's answer?" -> "Review posting forge?" [label="{findings, outcome}, with replies and restored on a re-review"];
    "Review caller's answer?" -> "run_hold {runDb, stage, reason, decidedBy} for review" [label="hold"];
    "Gate review-post: carry the opened gate through gate-protocol" -> "Review-post next answer?";
    "Gate review-post, legacy: tiers, outcome and next" -> "Review-post next answer?";
    "Review-post next answer?" -> "Review posting forge?" [label="proceed"];
    "Review-post next answer?" -> "Take the human's changes into the review draft" [label="iterate here"];
    "Review-post next answer?" -> "run_hold {runDb, stage, reason, decidedBy} for review" [label="hold: nothing posted, nothing recorded"];
    "Take the human's changes into the review draft" -> "Review iterate note asks for another depth?";
    "Review iterate note asks for another depth?" -> "Print the review depth block" [label="yes: redo from the depth block; the new depth's verify-rounds key is fresh"];
    "Review iterate note asks for another depth?" -> "Review report path given?" [label="no: draft edits only; the next gate is a new one"];

    "Review posting forge?" -> "gh pr review <ref> with the disposition and the summary body" [label="GitHub"];
    "Review posting forge?" -> "Compose the submitted review: comments, summary, outcome" [label="GitLab"];
    "gh pr review <ref> with the disposition and the summary body" -> "gh pr review result?";
    "gh pr review result?" -> "gate_record {runDb, stage, scope: post, shape: post, gateId | answers + decidedBy}" [label="posted"];
    "gh pr review result?" -> "Open the review off-script gate: gh pr review refused" [label="error"];
    "Open the review off-script gate: gh pr review refused" -> "gh pr review off-script answer?";
    "gh pr review off-script answer?" -> "gh pr comment <ref> with the summary body" [label="take"];
    "gh pr review off-script answer?" -> "gh pr review <ref> with the disposition and the summary body" [label="iterate here: retry with their note"];
    "gh pr review off-script answer?" -> "run_hold {runDb, stage, reason, decidedBy} for review" [label="hold"];
    "gh pr review off-script answer?" -> "Own review run: close it as abandoned?" [label="hand back"];
    "gh pr comment <ref> with the summary body" -> "gate_record {runDb, stage, scope: post, shape: post, gateId | answers + decidedBy}";
    "Compose the submitted review: comments, summary, outcome" -> "Resumed review run: read the MR before the submit?";
    "Resumed review run: read the MR before the submit?" -> "mr_review_submit {mrUrl, outcome, summary, comments, replies}" [label="no: a first pass, nothing from it is up"];
    "Resumed review run: read the MR before the submit?" -> "mr_posted_since {mrUrl, since: <run started_at>, items}" [label="yes: run_enter said resumed"];
    "mr_posted_since {mrUrl, since: <run started_at>, items}" -> "This review already on the MR?";
    "This review already on the MR?" -> "mr_review_submit {mrUrl, outcome, summary, comments, replies}" [label="no: no item posted"];
    "This review already on the MR?" -> "Open the review off-script gate: mr_approve refused" [label="yes, approval outstanding"];
    "This review already on the MR?" -> "gate_record {runDb, stage, scope: post, shape: post, gateId | answers + decidedBy}" [label="yes, nothing outstanding: record, never resubmit"];
    "This review already on the MR?" -> "Open the review off-script gate: mr_review_submit refused" [label="partly: some items posted"];
    "This review already on the MR?" -> "run_hold {runDb, stage, reason, decidedBy} for review" [label="the read errored: hold, quoting its text"];
    "mr_review_submit {mrUrl, outcome, summary, comments, replies}" -> "mr_review_submit result?";
    "mr_review_submit result?" -> "gate_record {runDb, stage, scope: post, shape: post, gateId | answers + decidedBy}" [label="published, approved as asked: keep mrUrl"];
    "mr_review_submit result?" -> "Open the review off-script gate: mr_approve refused" [label="published, approved: false on an approve"];
    "mr_review_submit result?" -> "run_budget {runDb, key: bad-anchors, limit: 1, increment: 0, stage}" [label="published: false, bad-anchors"];
    "mr_review_submit result?" -> "Open the review off-script gate: pending comments on the MR" [label="published: false, pending-drafts"];
    "mr_review_submit result?" -> "Open the review off-script gate: mr_review_submit refused" [label="error"];
    "mr_review_submit result?" -> "STOP: never post a review piece by piece or with the GitLab CLI; open the review off-script gate" [label="tempted to post the pieces with mr_comment_inline, mr_comment, mr_reply_thread, mr_resolve_thread or the GitLab CLI"];
    "STOP: never post a review piece by piece or with the GitLab CLI; open the review off-script gate" -> "Open the review off-script gate: mr_review_submit refused";
    "run_budget {runDb, key: bad-anchors, limit: 1, increment: 0, stage}" -> "Bad anchors moved into the summary once already?";
    "Bad anchors moved into the summary once already?" -> "run_budget {runDb, key: bad-anchors, limit: 1, stage}" [label="no: charge the move"];
    "Bad anchors moved into the summary once already?" -> "Open the review off-script gate: mr_review_submit refused" [label="yes: exhausted"];
    "run_budget {runDb, key: bad-anchors, limit: 1, stage}" -> "Move the bad-anchor findings into the summary";
    "Move the bad-anchor findings into the summary" -> "mr_review_submit {mrUrl, outcome, summary, comments, replies}";
    "Open the review off-script gate: mr_review_submit refused" -> "Review submit off-script answer?";
    "Open the review off-script gate: pending comments on the MR" -> "Review submit off-script answer?";
    "Review submit off-script answer?" -> "Make the recorded review move once" [label="take"];
    "Review submit off-script answer?" -> "mr_review_submit {mrUrl, outcome, summary, comments, replies}" [label="iterate here: retry with their note"];
    "Review submit off-script answer?" -> "run_hold {runDb, stage, reason, decidedBy} for review" [label="hold"];
    "Review submit off-script answer?" -> "Own review run: close it as abandoned?" [label="hand back"];
    "Make the recorded review move once" -> "gate_record {runDb, stage, scope: post, shape: post, gateId | answers + decidedBy}";
    "mr_approve {mrUrl}" -> "mr_approve result?";
    "mr_approve result?" -> "gate_record {runDb, stage, scope: post, shape: post, gateId | answers + decidedBy}" [label="approved"];
    "mr_approve result?" -> "Open the review off-script gate: mr_approve refused" [label="refused"];
    "Open the review off-script gate: mr_approve refused" -> "Approval off-script answer?";
    "Approval off-script answer?" -> "Make the recorded approval move once" [label="take"];
    "Approval off-script answer?" -> "mr_approve {mrUrl}" [label="iterate here: retry with their note"];
    "Approval off-script answer?" -> "run_hold {runDb, stage, reason, decidedBy} for review" [label="hold"];
    "Approval off-script answer?" -> "Own review run: close it as abandoned?" [label="hand back"];
    "Make the recorded approval move once" -> "gate_record {runDb, stage, scope: post, shape: post, gateId | answers + decidedBy}";
    "gate_record {runDb, stage, scope: post, shape: post, gateId | answers + decidedBy}" -> "Own review run: close it?";
    "Own review run: close it?" -> "run_close {runDb, workType: review, stage: review, outcome}" [label="yes: own run, outcome done"];
    "Own review run: close it?" -> "End with the review target's forge link" [label="no: inherited"];
    "Own review run: close it as abandoned?" -> "run_close {runDb, workType: review, stage: review, outcome}" [label="yes: own run, outcome abandoned with the why"];
    "Own review run: close it as abandoned?" -> "run_stage {action: fail, stage: <run.current_stage>, reason: <why; what already posted>}" [label="no: inherited, the caller decides"];
    "run_close {runDb, workType: review, stage: review, outcome}" -> "Review closed as?";
    "Review closed as?" -> "End with the review target's forge link" [label="done"];
    "Review closed as?" -> "Review handed back: the why and what posted, quoted" [label="abandoned"];
    "End with the review target's forge link" -> "Review posted";
    "run_stage {action: fail, stage: <run.current_stage>, reason: <why; what already posted>}" -> "Review handed back: the why and what posted, quoted";
    "run_hold {runDb, stage, reason, decidedBy} for review" -> "Review held: end the turn";
}
```

### Gate review clarify: Resume / Start fresh / Hold

No run of yours exists yet, so this gate is the structured-question tool
in the pane. The candidates come from `run_enter`'s result, each with its
`runId`, `runDb` (absolute), `startedAt`, `spawnedBy`, `currentStage` and
`ownSession`. One sentence naming each candidate's `spawnedBy`, `startedAt`
and `currentStage`, then one **Resume** option per candidate this pane may
take, a run this session started earlier (`ownSession: true`,
recommended) or one no live pane owns; a run another live pane owns gets
no Resume option, named unavailable, then **Start fresh**, **Hold**. A
surface-launched pane never reaches this gate: `run_enter` starts a fresh
run when it gets `spawnedBy` and no `resume`, since another pane's live run
is not yours to resume.
Resume calls `run_enter` again with the picked candidate's `runId` as
`resume`; Start fresh calls it with `fresh: true`. Re-enter with the
snapshot's decisions: a question they already answered is never asked
again. Hold here records nothing (no run has started or been resumed to
record it against) and ends the turn.

### The refused review run_enter carried resume?

A refused resume means the run is gone or no longer running: say so in one
line, then start fresh, keeping the first call's `spawnedBy`. Any other
refusal, or no `run_enter` tool at all, is an rt that predates the run
tools.

### Resolve the review target

From the conversation: an MR/PR URL, a bare `!iid` or `#number`, a ticket
id, or a branch name. On GitLab `mr_view` takes `mrUrl` when you were
given a URL, else `repoName` = the checkout path plus `iid`. The read
asks GitLab, so any MR your token can see resolves, whoever wrote it and
whether it is open, merged or closed. A ticket id with no URL, iid or
branch is searched with `mr_list`; more than one candidate is the clarify gate. An `mr_view`
error is quoted, not paraphrased: GitLab's 404 or 403 is the usual case,
though an error can also be rt's (target not resolved, daemon unreachable,
timeout). Hold with that text as the reason (`decidedBy: "pane"`). A null
`mr_for_branch` entry means GitLab has no open MR for the branch, not
that it has none: look at merged and closed ones too. On a resume in a new session the
target is not in the conversation: the resumed snapshot's `mr` field is
the target.

### mr_list {repoName: <checkout>, sourceBranch: <branch>, state: all, limit: 200}

`mr_for_branch` sees open MRs only, so a null entry says nothing about a
merged or closed one. List every MR whose source branch is the given
branch, whatever its state.

### mr_list matches for the branch?

Check `truncated` first. A `truncated: true` list (GitLab held more than
the 200 returned) is ambiguous whatever it holds: take the clarify gate
like several, with a sentence saying the list was cut at 200 rows and one
option per MR returned. Otherwise count the returned MRs. Exactly one:
take its `iid` to `mr_view`. None: hold, reason "GitLab has no MR for the
branch" (`decidedBy: "pane"`). Several: the clarify gate, one option per MR
(iid, title, state). Never a guess.

### mr_list {repoName: <checkout>, search: <ticket id>, state: all, limit: 200}

A bare ticket id names no MR, so ask GitLab for the MRs whose title or
description carries it, whatever their state or author. Keep the rows
whose `sourceBranch` or `title` carries the id.

### mr_list matches for the ticket?

Check `truncated` first. A `truncated: true` list (GitLab held more than
the 200 returned) is ambiguous whatever it holds: take the clarify gate,
with a sentence saying the search was cut at 200 rows and naming what was
found. Otherwise count the kept rows. Exactly one: take its `iid` to
`mr_view`. None: the clarify gate with no options, a sentence saying nothing
carried the ticket, and their typed text as the answer. Several: the
clarify gate, a sentence naming what was found with one option per row
(iid, title, state). An error is the error
text, usually GitLab's: it goes to the clarify gate's sentence, quoted,
never read as none. No row means none of the rows GitLab returned carries
the ticket, not that no MR exists. Never a guess.

### Reading a GitLab fact no read tool returns

At any step of the review, including while verifying findings, a GitLab
fact the read tools do not return (the MR's commit list, an issue it
references, another MR's state) is read with `gitlab_get {repoName,
path}`: `repoName` = the checkout path, `path` relative to the API root
with `:id` for this project, for example
`projects/:id/merge_requests/<iid>/commits`. The read is part of the step
that needs it, not an off-script move, so it opens no gate. A GitLab error
is quoted as GitLab wrote it. Its refusal of a credential path is final.

### Gate review clarify: which target?

One sentence naming the candidates, quoting the GitLab error when a read
failed, or saying the search was cut at 200 rows when a list was
truncated, or saying none was found. Then run gate-protocol's Runs
integration from `Trigger: a site reaches its gate`:

`gate_ask {questions, kind: clarify, context, runDb, stage}`

with two questions: `target`, one option per candidate (none when nothing
was found or a read failed: their typed text is the answer), and `next`:
**Proceed** (recommended) / **Hold**. The protocol's `gate_answer` or
`gate_reconcile` records the answers map `{target, next}` at scope
`clarify`. A `next: hold` is the hold, whatever `target` says. A picked
target resolves it. Their text charges `target-clarify` once, then goes
back to the target form and resolves again; the second typed answer
exhausts the budget and ends in a hold naming what was tried.

### Record the review target: mr, branch and any ticket

Up to three `run_field_set` calls, `stage: review`: `key: mr`, value the
MR or PR URL; `key: branch`, value its source branch; and, only when the
MR or PR itself names a ticket, `key: ticket`, value that id. Never guess
a ticket id the target does not carry.

### Caller framed a re-review?

Yes when the caller says this pass is a re-review of a change already
reviewed; a review typed by hand, or a caller that says nothing of an
earlier round, is a first review.

### Take the earlier threads the caller handed in

A re-review judges two things, in this order: what became of the
reviewer's earlier threads, then what is new. The caller hands in the
earlier threads (each with its `discussionId`, anchor, `round`, the
reviewer's first note and the author's replies), the commit the last
round reviewed, and the round number. For each thread, read the code at
the MR head and make one of the four calls the structured findings file
names, with a one-line note of what was checked and a reply to post.
Then hunt for new issues, weighting the diff since the last reviewed
commit (`git diff <last reviewed sha>..HEAD`) while still reading the
whole change. With no earlier threads handed in, the pass is a full
review framed as a re-review, and `threads` is empty.

A caller may hand in the rule that picks the threads (which ones count,
and the `round` each one gets) in place of the threads themselves. Then
this step reads them, `mr_threads {mrUrl, refresh: true}`, and keeps
exactly what the rule picks. A read that errors answers no at `Earlier
threads in hand?`: a hold whose reason quotes the error.

The caller also hands in the skipped list: the findings the human chose
not to raise in earlier rounds, each `{id, round, title, severity, file,
line, excerpt, snippet}` with the sha of the round that skipped it. This
pass reports every one of them back under the json's `skipped`, `changed`
worked out as the structured findings file says, and never raises one
again as a finding: an issue a skipped finding already says is not new.

This step takes the inputs in and judges nothing yet: both judgments
form after the depth block, in the fresh reviewer's context, like every
judgment in this verb (`Dispatch the fresh reviewer; it forms the
findings`). `HEAD` above is the MR head:
the fetched `origin/mr-<iid>` (`origin/pr-<n>` on GitHub) when no
MR-head checkout is in hand. With no last reviewed commit, a last
reviewed commit of `unknown` (a round rebuilt from an old report), or one
the fetch does not have, the whole change is what changed. Each thread's
reply is drafted in the writing style from its call and note.

### Print the review depth block

The review flow's "Commit to a review depth" below is this step, and its
HARD-GATE holds: the REVIEW DEPTH and EVIDENCE CHECK block, plus the
provider triage lines when Criteria is bound, prints before a test runs, a
checkout is touched, or the diff is read. Size the change from what
resolving it returned (title, description, changed files).

### MR-head checkout in hand for the review checks?

In hand means a checkout already at the MR head: one a caller handed, or
this pane's own tree when it sits at the MR head. At `read` depth nothing
runs, so take the yes edge. At `verify` or `repro` depth with none in
hand, provision one with `worktree_provision` (`repoName` = this
checkout's path, `branch` = the MR's or PR's source branch, `reuse: true`)
and run every check in the path it returns; never change this pane's own
directory for it. The tree keeps rt's default disposal, so rt disposes it
once the MR merges; the review never disposes it by hand. A refusal is
quoted in the setup observations, and the setup checks and the verify
step's command check are noted as not run.

### Review head worktree_provision returned a path?

`kind: "provisioned"` (a tree claimed or created) and `kind: "reused"` (a
tree already on the branch) both return a `path`: take the yes edge with
it, so the head check decides whether it is usable. A refusal is the no
edge.

### Provisioned review tree at the fetched head?

Compare `git rev-parse HEAD` run in that path with the fetched head
(`origin/mr-<iid>`, or `origin/pr-<n>` on GitHub). On a mismatch the tree
is not in hand: quote both shas, and note the setup checks and the verify
step's command check as not run. Never reset or pull that tree.

### Set up for the review depth

The review flow's "Set up for the depth". The GitLab fetch and diff above
are two separate commands, `targetBranch` from `mr_view`. Run
the checks the depth names in the MR-head checkout (the one in hand or
the one provisioned). Record every command and its result.

### Dispatch the fresh reviewer; it forms the findings

The review flow's "Dispatch the review", reviewer shape, with the full
payload. The findings form in that fresh context, never here. The fresh
reviewer has the same tools and makes any `gitlab_get` read itself when it
needs a fact, as in "Reading a GitLab fact no read tool returns".

On a re-review the payload also carries the earlier threads and the last
reviewed commit, as one block after the standard blocks, asking for each
thread's call and one-line note ahead of the Strengths, and for findings
on new issues only. The same block lists the skipped findings (each one's
anchor, title and excerpt): an issue one of them already says is not new,
so it is never a finding.

### Assemble the review draft

The review flow's "Assemble the draft": Strengths / Issues (Critical /
Important / Minor, each `file:line`, what, why, fix) / Assessment, with
Earlier threads first on a re-review (each thread's call, note and the
reply drafted for it). On a second verify round, keep the findings the
first verify round verified and take the re-dispatch's answer for the
rest.

### Verify each blocking finding against the MR head

Blocking means Critical and Important; Minor findings are not verified.
Check each blocking finding's facts, never its reasoning:

- **Anchor:** the file exists at the head sha and the cited line is
  non-blank there, read with `git show <head>:<file>` (`origin/mr-<iid>`,
  or `origin/pr-<n>` on GitHub). A change can break an unchanged line, so
  the line need not be in the diff. A finding with no `file` anchor is
  checked on its quote and command only.
- **Quote:** code the finding quotes appears at or near that line.
- **Command:** a command the finding names (a test, a script) re-runs only
  in the MR-head checkout (in hand or provisioned); with none, skip it and
  note it; at `read` depth note "not run at read depth". A command that
  passes where the finding says it fails is a failed check.

A GitLab fact a check needs is read as in "Reading a GitLab fact no read
tool returns".

Each verify round that leaves a blocking finding unverified charges
`verify-rounds:<depth>` once (`<depth>` is the depth in force: `read`,
`verify` or `repro`), and `Review verify rounds = 2?` reads that call's
`exhausted`. Back in this loop after a compaction or resume with no fresh
round in hand, read the key with `increment: 0` and go on from what it
says; never charge a round twice.

### Re-dispatch a fresh reviewer on the unverified findings

One fresh-context dispatch, same template, naming each failed check
verbatim ("validate.ts:42 is a blank line on the head"; "the 'rounds half
up' test passes on the head") and asking it to confirm each finding with a
corrected anchor or withdraw it.

### Demote each unverified finding to Minor, marked unverified

Move each finding that failed round two to Minor in the draft, its `body`
prefixed `Unverified: <the failed check>.` The Assessment's readiness is
never raised by a demotion (the reviewer may have had other reasons); its
reasoning gains one sentence naming the demoted findings. The json
sibling, written afterward, mirrors this demoted draft; demotion never
edits an already-written json on its own.

### Write the review report and its json sibling

The review flow's "Structured findings file", written after verification
so the json mirrors the verified draft.

### Write review-post.extras.json

Make one scratch directory: a new directory inside this session's
scratchpad (the Claude Code temp root, the only place `gate_open` reads
and writes), never `mktemp -d`. Write its path out literally from then on:
each tool call is a fresh shell. Write `<dir>/review-post.extras.json`:

```json
{"target": "!87", "reviewer": "<the reviewer the caller names>", "round": 2,
 "questions": [
   {"id": "outcome", "label": "Verdict on !87: <readiness clause>", "multi": false,
    "options": [{"value": "comment", "label": "comment (recommended)", "description": "<what picking it does for this review>"},
                {"value": "approve", "label": "approve", "description": "<what picking it does for this review>"}]},
   {"id": "next", "label": "Next", "multi": false,
    "options": [{"value": "proceed", "label": "proceed (recommended)"}, "iterate", "hold"]}
 ]}
```

| Field | Filled from |
|---|---|
| `target` | the MR/PR reference as its forge writes it: `!<iid>` or `#<number>` |
| `reviewer`, `round` | only when the caller supplies them; otherwise omit the key. On a re-review the caller supplies `round`. |
| `outcome` label | `Verdict on <target>: ` plus a clause composed from the json's `summary`, never either field verbatim: readiness `yes` reads "ready to merge"; `with-fixes` or `no` reads "not ready" or "ready once <the gist of the reasoning>" |
| `outcome` options | `comment` and `approve`, each described by what picking it does for this review. `request_changes` joins them only when this verb runs the gate itself and the target is on GitHub (`gh pr review --request-changes`); rt's GitLab MR tools have no Request changes. The recommendation goes FIRST, its label ending ` (recommended)`: `approve` when readiness is `yes`, else `comment` |
| `next` | only when this verb runs the gate itself; a caller that owns the gates navigates on its own, so omit the question |

On the direct run, the file's object is the `extras` that `gate_open
{review: {findingsPath, extras}}` takes, passed inline; `findingsPath` is
the report json (or its copy, below). On the hand-back path the file goes
to `review-source.sh`.

Both paths build the same open from the report json and the extras: every
finding becomes a `findings-<n>` option (tier order, four per question)
whose value is the finding's `id`; ahead of those, each entry of the
report's `threads` becomes its own `thread-<n>` question (options
`post:<discussionId>` and `resolve:<discussionId>`); after them, the
report's `skipped` entries become `skipped-<n>` questions (options
`restore:<id>`, none recommended). Those question ids are the keys of the
gate's answers. A report json from before version 2 carries no bodies, so
the open falls back to prose on its own; that is correct, not an error.
Never hand-edit the open, and never shorten a body to make it fit.

### Copy the report json into the review scratch dir

`gate_open` reads `findingsPath` only under the Claude Code temp root (or
an installed plugin root). A report json elsewhere, such as a caller's
`--report` sibling, is copied into `<dir>` first, unchanged, and the copy
is the `findingsPath`. The report and its json stay where the caller put
them.

### review-source.sh exit 0?

The hand-back path only: the board's prose step reads the source file this
writes, `<dir>/review-post.source.json`, so it is built with the vendored
script, exactly as in the node. Exit 0: open it with `gate_open {...,
sourcePath, handBack: true, outPath}`. Exit 1 names a field to fix, in the
extras or in the report json where it drifted from the draft. Exit 2 is a
usage or unreadable-input error with no field to fix.

### gate_open result?

- **Opened** (the direct run): keep the result's `id`, `paneAction` and
  `formChunks`. Under the run `gate_open` has already written the `gate`
  field and stored the untrimmed source as `extra.gate-source.post`.
- **Handed back:** nothing opened; the open is written at `outPath` in
  `gate-ctx.sh fit`'s shape, its source beside it. The result says
  `droppedContexts` when even the prose was over the shared budget.
- **Refused:** nothing opened, one problem per line. A line that names a
  field in the extras or the report json is a field to fix. A refusal no
  field fix can mend (a file it cannot read or parse, a path outside the
  read roots) goes straight to the off-script gate.

### Fix the field the review script names

The field the refusal names (a `gate_open` line, or `review-source.sh`'s
exit 1): in the extras, or in the report json where it drifted from the
draft. Fix exactly that, once, then go back through `Caller owns the
review gates?` to the same open.

### Write the review-run line into the handed --report

Before the hand-back, write one line `review-run: <run id>` (`run_enter`'s
`runId`) into the handed `--report` file, replacing any earlier
`review-run:` line. A fresh pane the board later hands a decision to
passes that id as `resume`, and lands on this run, which holds the stored
gate source. The board never reads the line.

### Hand back the severity line and the open's paths

A caller that owns the gates (a board wrapper; it says so when it
delegates) gets no gate from this verb. Hand back the severity line, the
absolute paths of `<dir>/review-post.open.json` (its source sits
beside it as `review-post.source.json`) and of this skill's vendored
`${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh`, and on GitLab the MR head sha
this review read (`mr_view`'s `mr.sha`), then wait for its `{findings,
outcome}` (with `replies` and `restored` on a re-review) or its hold. When
the result listed `droppedContexts`, name them in the hand-back.

### Gate review-post: carry the opened gate through gate-protocol

`gate_open` opened the gate, so enter gate-protocol at `Trigger: a site
opened its gate with gate_open` with its result and walk on from
`paneAction?`:

- **form:** `### Present the in-pane gate form`, one AskUserQuestion call
  per `formChunks` chunk, then exactly one `gate_answer {id, answers,
  runDb, stage}` carrying every question;
- **wait:** `rt gate wait <id> as a background Bash task`, then `End the
  turn: holding at gate <id>`; the re-entry is `gate_reconcile {id, runDb,
  stage}`.

On a review gate neither call records anything. Keep the gate's `id` and
its answers map (`thread-<n>`, `findings-<n>`, `skipped-<n>`, `outcome`,
`next`): Compose builds the submit from them, and `gate_record` after
posting is the gate's record. With `fits: false` or `contextDropped: true`
the gate is still open as it is: carry on.

### Gate review-post, legacy: tiers, outcome and next

No report json leaves nothing to build from. Run gate-protocol's Runs
integration from `Trigger: a site reaches its gate`:

`gate_ask {questions, kind: review-post, scope: post, context, runDb, stage}`

with `context` the severity line verbatim, and three questions: `tiers`
(multi-select over the levels present, each pre-selected), then `outcome`
and `next` exactly as in the extras above. It records nothing either: the
`gate_record` after posting reads its `tiers` as the legacy selection.

### Take the human's changes into the review draft

Their text is changes to the draft: apply them. Their words asking for a
different review depth (verify instead of read, repro instead of verify,
or similarly) are a depth request: it sends the graph back to the depth
block, and that depth's `verify-rounds:<depth>` key starts fresh, since a
deeper depth means new setup and a fresh verify pass. Anything else is a
draft edit only: re-present, and the next gate is a NEW gate, never the
old one reopened.

### Compose the submitted review: comments, summary, outcome

One call carries the whole review. The selected findings are the gate's
answers: the union of every `findings-<n>` answer (a `{value, note}`
unwraps to its value), or every finding in the tiers a legacy `tiers`
answer picked, or the caller's selection as handed. `comments` is one
entry per selected finding that has both `file` and `line`: `{body, path,
line}`, `body` the finding as the summary would state it (tier, title,
what to change). `summary` is the review-posting summary, its issue list
holding every selected finding with no `file` or no `line`. `outcome` is
the disposition: `comment` or `approve`. A review carries at most 100
comments and replies in total; past that, the lowest-tier anchored
findings go in the summary's issue list instead.

`replies` is built from the gate's `thread-<n>` answers, one entry per
thread whose answer picked anything: `discussionId` from the option value
after `post:` or `resolve:`; `resolve` true when `resolve:<id>` was
picked; `body` present only when `post:<id>` was picked, and then the
answer's `text` when it carries one (the human edited the reply), else
the report json's `reply` for that thread. A thread whose answer picked
neither option gets no entry. A caller that decided the selection hands
`replies` in already built; they go in unchanged.

A skipped finding the human brought back (`restore:<id>` picked in a
`skipped-<n>` answer) posts like a selected finding: a comment at its
recorded `file` and `line` with its recorded text as the body, or in the
summary's issue list when it lacks a `file` or a `line`. One with
`changed` true (its code moved since the round that skipped it, so its
recorded line may now hold other code) always posts in the summary's
issue list, its recorded `file:line` in its text, never as a comment.
Its text is the caller's record of it, never rewritten or put into the
writing style, in a comment or in the summary: the caller's `restored`
entry when it decided the selection (`title`, then `body` verbatim),
else the skipped entry it handed in with that `id` (`title`, then
`excerpt` verbatim). Its `changed` is the caller's `restored` entry's
when it decided the selection, else the report json's `skipped` entry
with that `id`.

### This review already on the MR?

Asked on GitLab after Compose and before anything posts. A run on its
first pass (`run_enter` said `started` or `inherited`) answers no without
a read: nothing from this review is up. A resumed run with no post decision
recorded reads the MR before any submit, whatever its holds say, since a
submit can land after the last thing the run recorded:

`mr_posted_since {mrUrl, since: <the snapshot's run.started_at>, items}`

with `items` built from what Compose just wrote: `{id: "summary",
contains: <the summary's first line>}`, then one `{id: <finding id>,
contains: <the first line of its body>, path, line}` per comment. Every
item `posted` means yes; some means partly; none means no. Never judge it
from a thread read by hand. A read that errors is a hold whose reason
quotes the error, so nothing is submitted unchecked. The latest hold's
reason (see Review off-script gates) adds what the MR read cannot show: a
review it names as posted by the human in the forge UI is posted, and it
says whether the approval landed. On an approve, an approval the reason
does not name as landed is outstanding.

- **Yes, approval outstanding:** the approval gate, whose iterate runs
  `mr_approve` alone. The review is never submitted again.
- **Yes, nothing outstanding:** the post record, with nothing posted.
- **Partly:** the refused-review gate, whose move is the human finishing
  the review in the forge UI.
- **No:** submit.

### Move the bad-anchor findings into the summary

The result's `badAnchors` names comments by `index`, the zero-based
position in the `comments` array that was sent. Nothing posted. Take each
named finding out of `comments` and add it to the summary's issue list
with its `file:line` in the text, as a finding with no anchor. Call again
with the rest unchanged. This happens once, counted on `bad-anchors`: a
second bad-anchors result is a refusal.

### Make the recorded review move once

The human made the move the off-script gate recorded, in the forge UI.
The pane posts nothing here: it only records what the human did, once,
and goes on to the post record.

### Make the recorded approval move once

Exactly the move the off-script gate recorded for the refused approval,
once.

### End with the review target's forge link

The final message ends with the target's id as a markdown link to its
real web URL: the one a posting tool returned, else `mr_view`'s `webUrl`
(or `gh pr view`'s url), else on a resume the snapshot's `mr` field (the
review-posting close HARD-GATE below).

### Open the review off-script gate: a review script refused

A refusal no field fix can mend (`review-source.sh` exit 2, or a
`gate_open` refusal of an unreadable file or a path outside the read
roots) opens this gate at once; a field refusal opens it when the
`post-open-fix` budget is spent. The proposed move is the legacy gate in
place of the structured open. The rest is the shape in Review off-script
gates below.

### Open the review off-script gate: gh pr review refused

The proposed move: post the summary body as a plain PR comment with `gh
pr comment <ref>`, and leave the disposition to the human.

### Open the review off-script gate: mr_review_submit refused

An error that says the call timed out, that the outcome is unknown, or
that it only partly landed may have left some or all of this review on
the MR; any other error means nothing from it is up. The proposed move:
the human posts the review in the forge UI, approving it on an approve
(the summary and every comment quoted in full in `context`), and the run
records it as posted by the human.

- **Timed out, or outcome unknown:** `context` says first that some or
  all of this review may already be on the MR, and the human looks for
  the summary on the MR before choosing: a summary already there means
  the review is up, and take records it without posting it again.
- **Only partly landed:** `context` says first that some of this review's
  comments may be on the MR without its summary, and that the human
  checks the MR's threads. The move is take only: the human finishes the
  review in the forge UI (what is missing, the summary included), and the
  run records it as posted by the human.

After any of these errors, `context` also says that **Iterate here** is
only for a human who has confirmed nothing from this review is on the MR;
it is never a blind resubmit. Reached from `This review already on the MR?`
with partly, `context` quotes the hold reason and which `mr_posted_since`
items are posted.

### Open the review off-script gate: pending comments on the MR

The reviewer already has pending comments on this MR, started in the
forge UI or left by an earlier submit that failed; a submit would publish
those along with the review. `context` quotes the count and the first
lines the result gave. The way on is for the human to submit or discard
those pending comments in the forge UI, and this gate's iterate retries
the same call, so **Iterate here** is the recommended `next`. The proposed
move, for a take, is the one the refused-review gate proposes: the human
posts this review in the forge UI (the summary and every comment quoted
in full in `context`), together with their pending comments, and the run
records it as posted by the human.

### Open the review off-script gate: mr_approve refused

The review is posted; only the approval failed. The proposed move: the
human approves in the forge UI, and the run records the approval as
theirs. Iterate retries `mr_approve` alone, never the review. Entered from
the submit result, `context` quotes the submit's `approveError`; from a
refused `mr_approve`, its error; from `This review already on the MR?` on
a resume, the hold reason that names the approval outstanding.

## Review off-script gates

Leaving the graph is legal when it is explicit. Every off-script box opens
gate-protocol's `## Off-script gate` with site `review`: scope
`off-script:review:<n>` (`n` counts from 1 in this run), `context` quoting
the refusal verbatim, and its `action` and `next` questions, under the run
with `runDb` and `stage`. The include defines the questions and what the
answers map records. A board that owns the review gates does not own
these: they open in this pane.

Route on the answers: `action: handback` is hand back whatever `next`
says; otherwise `next: iterate` is iterate here, `next: hold` is hold, and
`next: proceed` is take. Take makes exactly that move, once, then
continues after it. Iterate here retries the refused call with their note;
each retry that fails opens a new gate. A hold is `run_hold`, its reason
their words; a hand back closes an own run as abandoned and fails the
stage on an inherited one, per the graph. A hold's reason, like a
hand-back's, says what is on the MR. From the submit gate, the
pending-comments gate or the approval gate it always says whether this
review is posted (by the submit, by the human, partly, or with its outcome
unknown) and, on an approve, whether the approval is outstanding: on a
resume, `This review already on the MR?` reads exactly that. A gate that
comes back `closed` is a hold whose reason is "gate closed"; record it as
any hold and end the turn.

## What the graph cannot show

- Review verbs produce judgment and execute posting; they never decide
  what posts.
- The draft is presented once: after verify and any demotion, never
  before. Present it, then state the severity levels present in one
  structured line, for example "Findings: Critical (2), Important (1); 3
  findings.", skipping any level with no findings. The counts are the
  demoted draft's own, before any selection narrows what posts.
- A caller's decided selection is `{findings, outcome}` (findings naming
  finding ids from the report json, outcome the disposition), or from an
  unmigrated caller the legacy `{tiers, outcome}`. On a re-review it may
  also carry `replies`, already in the submit's shape; posting hands them
  through unchanged. It may also carry `restored: [{id, title, body, file,
  line, changed}]`, the skipped findings the human brought back, handed in
  by the caller from its own record; each posts as `Compose the submitted
  review: comments, summary, outcome` says, with the caller's text and
  `changed`. Use the decider the caller names alongside it.
- Posting runs per review-posting below, handed the selection Compose
  built: `{findings: <ids>, disposition: <outcome>}`, or legacy `{levels:
  <tiers>, disposition: <outcome>}`, with `replies` and the restored
  findings riding along on a re-review. A restored finding is a selected
  one for posting, never a deselected one.
- The post record is `gate_record {runDb, stage, scope: post, shape: post}`,
  made only after the review is up (posted by the submit, by `gh`, or by
  the human on an off-script take), never before: rt reads the latest
  post decision as what posted. Pass `gateId` for an answered posting
  gate, or the caller's selection as `answers` with `decidedBy` its named
  decider. The tool builds `{findings, disposition, replies?, restored?}`
  itself (legacy `tiers` included); never hand-build it.
- A hold is the one `run_hold` call: `stage` is your stage, `reason` the
  human's words or the quoted error, `decidedBy` the answer's by (`pane`
  for an error hold). It computes the attempt and writes the `hold` field;
  then the turn ends.
- `run_close` takes `outcome: done` after the post record, or `outcome:
  abandoned` with `reason: <why; what already posted>` on a hand back. It
  refuses an inherited run, which never reaches it.
- A gate that comes back `closed` is a hold whose reason is "gate
  closed"; record it as any hold and end the turn.
- A fetch, diff or `gh pr diff` that errors is a hold whose reason quotes
  the error.

## The review flow

The boxes from **Print the review depth block** through **Assemble the
review draft** follow this flow. Its Criteria section carries the domain's
review standards when the pack binds them; apply its triage lines and
addendum exactly as it directs.

{{include:review-core-body}}

If a rule below asks for a move this graph marks STOP, take the off-script edge instead.

## Criteria

{{slot:criteria}}

{{include:review-core-body-after}}

{{include:review-dispatch-body}}

If a rule below asks for a move this graph marks STOP, take the off-script edge instead.

## Reviewer

{{slot:reviewer}}

{{include:review-dispatch-body-after}}

{{include:review-core-body-tail}}

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}

{{include:writing-style-lookup}}

{{include:review-posting}}

Posting mechanics on GitLab: the review is ONE `mr_review_submit` call
(comments, summary, outcome; `replies` on a re-review). It answers
`published: true` with `mrUrl`, the link the close needs, or `published:
false` with the reason and nothing posted. The daemon checks every
comment's placement before it publishes, so never hand-build a position
payload and never post a finding with `mr_comment_inline` here. On GitHub
use `gh pr review` / `gh pr comment`: GitHub has no inline mechanism, so
every selected finding, anchored or not, rides in the one `gh pr review`
body, with its `file:line` in the text.
