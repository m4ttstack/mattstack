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

The standalone entry for reviewing someone else's change. Follow the
graph's edges; a move it does not show is a question for a gate, never a
judgment call. Reads through the read tools and `gitlab_get` are part of
the step that needs them.

## Run

Outside a pipeline this verb is its own run, so the console shows it and
the Stop hook covers its pane. `run_enter` starts, resumes or inherits the
run, or returns the running candidates; never list, read or build run dbs
by hand. It takes `flags` (the block below, verbatim), `skillDir` (this
skill's directory), `stage: review`, and only when they apply: `runDb` a
caller handed you; `spawnedBy` when a surface launched this pane; `resume`,
a review run id the caller or developer names, or the one on a handed
`--report`'s `review-run: <run id>` line (even in a launched pane).

{{run-start.flags:review}}

Pass the returned `runDb` to every `run_*` and gate call. Your stage is
`review`, except on an inherited run (`mode: inherited`): there it is
`at.stage`, written `<run.current_stage>` in the graph, and the caller
closes the run. A handed `runDb` whose run is not running is not inherited
(`handedRunDb: "not-running"`).

Every gate runs through gate-protocol with `runDb` and `stage`; the gate
tools write the gate fields and record the clarify and off-script answers.
The posting gate records nothing until `gate_record`, after posting. This
verb is on the tools, so gate-protocol's line on sites not yet on the
tools never applies: draw no `run_field_set {key: gate}` bracket and no
`run_decision` gate line.

Each loop counter is one `run_budget {runDb, key, limit, stage}` call on
the counted event; its `<key> spent?` diamond reads `exhausted`. After a
compaction or resume, read a counter you cannot remember with
`increment: 0`; never charge one event twice.

| Key | Limit | Charged when |
|---|---|---|
| `target-clarify` | 2 | the target clarify gate returns typed text |
| `verify-rounds:<depth>` | 2 | a verify round at that depth leaves a blocking finding unverified |
| `post-open-fix` | 2 | a posting-gate refusal names a field (the first charge fixes it) |
| `bad-anchors` | 2 | the submit answers bad-anchors (the first charge moves them) |

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
    "STOP: no review run without run_enter; report why to the user" [shape=octagon style=filled fillcolor=red fontcolor=white];
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
    "target-clarify spent?" [shape=diamond];
    "STOP: GitLab ticket searches go through the read tools or gitlab_get" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "STOP: GitLab reads go through the read tools or gitlab_get" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "STOP: GitLab branch lookups go through the read tools or gitlab_get" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Gate review clarify: which target?" [shape=box];
    "Review target answer?" [shape=diamond];
    "Own review run: record the target?" [shape=diamond];
    "Record the review target: mr, branch and any ticket" [shape=box];
    "Caller handed a decided selection and the report it decided on?" [shape=diamond];
    "Caller framed a re-review?" [shape=diamond];
    "Take the earlier threads the caller handed in" [shape=box];
    "Earlier threads in hand?" [shape=diamond];

    "Print the review depth block" [shape=box];
    "Review diff forge?" [shape=diamond];
    "gh pr diff <ref>" [shape=plaintext];
    "git fetch origin +pull/<n>/head:refs/remotes/origin/pr-<n>" [shape=plaintext];
    "git fetch origin <targetBranch> +refs/merge-requests/<iid>/head:refs/remotes/origin/mr-<iid>" [shape=plaintext];
    "git diff origin/<targetBranch>...origin/mr-<iid>" [shape=plaintext];
    "MR-head checkout in hand?" [shape=diamond];
    "worktree_provision {repoName, branch: <source branch>, reuse: true}" [shape=plaintext];
    "Review head worktree_provision returned a path?" [shape=diamond];
    "Provisioned review tree at the fetched head?" [shape=diamond];
    "STOP: create a review checkout only with worktree_provision" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Set up for the review depth" [shape=box];
    "Dispatch the fresh reviewer; it forms the findings" [shape=box];
    "Assemble the review draft" [shape=box];
    "Verify each blocking finding against the MR head" [shape=box];
    "Every blocking finding verified?" [shape=diamond];
    "run_budget {runDb, key: verify-rounds:<depth>, limit: 2, stage}" [shape=plaintext];
    "verify-rounds:<depth> spent?" [shape=diamond];
    "Re-dispatch a fresh reviewer on the unverified findings" [shape=box];
    "Demote each unverified finding to Minor, marked unverified" [shape=box];
    "Review report path given?" [shape=diamond];
    "Write the review report and its json sibling" [shape=box];

    "Caller handed a decided selection?" [shape=diamond];
    "Review report json in hand?" [shape=diamond];
    "Write review-post.extras.json" [shape=box];
    "Caller owns the review gates?" [shape=diamond];
    "Report json under the temp root?" [shape=diamond];
    "Copy the report json into the review scratch dir" [shape=box];
    "gate_open {kind: review-post, review: {findingsPath, extras}, runDb, stage, scope: post}" [shape=plaintext];
    "sh \"${CLAUDE_SKILL_DIR}/scripts/review-source.sh\" <report json> <dir>/review-post.extras.json > <dir>/review-post.source.json" [shape=plaintext];
    "review-source.sh exit 0?" [shape=diamond];
    "gate_open {kind: review-post, sourcePath: <dir>/review-post.source.json, handBack: true, outPath: <dir>/review-post.open.json, runDb, stage, scope: post}" [shape=plaintext];
    "gate_open result?" [shape=diamond];
    "STOP: only gate_open writes the review-post open; never hand-edit or hand-fit it" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "run_budget {runDb, key: post-open-fix, limit: 2, stage}" [shape=plaintext];
    "post-open-fix spent?" [shape=diamond];
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
    "Resumed run: read the MR first?" [shape=diamond];
    "mr_posted_since {mrUrl, since: <run started_at>, items}" [shape=plaintext];
    "This review already on the MR?" [shape=diamond];
    "mr_review_submit {mrUrl, outcome, summary, comments, replies}" [shape=plaintext];
    "mr_review_submit result?" [shape=diamond];
    "run_budget {runDb, key: bad-anchors, limit: 2, stage}" [shape=plaintext];
    "bad-anchors spent?" [shape=diamond];
    "Move the bad-anchor findings into the summary" [shape=box];
    "STOP: post a review only as one mr_review_submit" [shape=octagon style=filled fillcolor=red fontcolor=white];
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
    "Own review run: abandon it?" [shape=diamond];
    "run_close {runDb, workType: review, stage: review, outcome}" [shape=plaintext];
    "Review closed as?" [shape=diamond];
    "End with the review target's forge link" [shape=box];
    "run_stage {action: fail, stage: <run.current_stage>, reason: <why; what already posted>}" [shape=plaintext];
    "run_hold {runDb, stage, reason, decidedBy}" [shape=plaintext];
    "Review held: end the turn" [shape=doublecircle];
    "Review handed back: the why and what posted, quoted" [shape=doublecircle];
    "Review posted" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: review a teammate's MR or PR" -> "run_enter {flags, skillDir, stage: review, runDb?, resume?, spawnedBy?}";
    "run_enter {flags, skillDir, stage: review, runDb?, resume?, spawnedBy?}" -> "review run_enter mode?";
    "run_enter {flags, skillDir, stage: review, resume: <picked runId>}" -> "review run_enter mode?";
    "run_enter {flags, skillDir, stage: review, fresh: true, spawnedBy?}" -> "review run_enter mode?";
    "review run_enter mode?" -> "Resolve the review target" [label="started, or inherited"];
    "review run_enter mode?" -> "run_snapshot {runDb: <resumed review>}" [label="resumed"];
    "review run_enter mode?" -> "Gate review clarify: Resume / Start fresh / Hold" [label="candidates"];
    "review run_enter mode?" -> "The refused review run_enter carried resume?" [label="refused, or no tool"];
    "The refused review run_enter carried resume?" -> "run_enter {flags, skillDir, stage: review, fresh: true, spawnedBy?}" [label="yes: say so, start fresh"];
    "The refused review run_enter carried resume?" -> "STOP: no review run without run_enter; report why to the user" [label="no"];
    "Gate review clarify: Resume / Start fresh / Hold" -> "Review resume answer?";
    "Review resume answer?" -> "run_enter {flags, skillDir, stage: review, resume: <picked runId>}" [label="resume"];
    "Review resume answer?" -> "run_enter {flags, skillDir, stage: review, fresh: true, spawnedBy?}" [label="start fresh"];
    "Review resume answer?" -> "Review held: end the turn" [label="hold"];
    "run_snapshot {runDb: <resumed review>}" -> "Resumed review snapshot records?";
    "Resumed review snapshot records?" -> "Resolve the review target" [label="no post decision: re-enter, reuse every recorded answer"];
    "Resumed review snapshot records?" -> "Own review run: close it?" [label="a post decision"];

    "Resolve the review target" -> "Review target form?";
    "Review target form?" -> "mr_view {mrUrl, or repoName + iid}" [label="GitLab URL or iid"];
    "Review target form?" -> "mr_for_branch {repoName: <checkout>, branches: [<branch>]}" [label="GitLab branch"];
    "Review target form?" -> "gh pr view <ref>" [label="GitHub"];
    "Review target form?" -> "Gate review clarify: which target?" [label="several candidates"];
    "Review target form?" -> "mr_list {repoName: <checkout>, search: <ticket id>, state: all, limit: 200}" [label="ticket id only"];
    "Review target form?" -> "STOP: GitLab ticket searches go through the read tools or gitlab_get" [label="tempted to search with the GitLab CLI"];
    "STOP: GitLab ticket searches go through the read tools or gitlab_get" -> "mr_list {repoName: <checkout>, search: <ticket id>, state: all, limit: 200}";
    "mr_for_branch {repoName: <checkout>, branches: [<branch>]}" -> "mr_for_branch entry for the branch?";
    "mr_for_branch entry for the branch?" -> "mr_view {mrUrl, or repoName + iid}" [label="an iid"];
    "mr_for_branch entry for the branch?" -> "mr_list {repoName: <checkout>, sourceBranch: <branch>, state: all, limit: 200}" [label="null: no open MR"];
    "mr_for_branch entry for the branch?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="an error: hold, quoting it"];
    "mr_for_branch entry for the branch?" -> "STOP: GitLab branch lookups go through the read tools or gitlab_get" [label="tempted to look it up with the GitLab CLI"];
    "STOP: GitLab branch lookups go through the read tools or gitlab_get" -> "mr_list {repoName: <checkout>, sourceBranch: <branch>, state: all, limit: 200}";
    "mr_list {repoName: <checkout>, sourceBranch: <branch>, state: all, limit: 200}" -> "mr_list matches for the branch?";
    "mr_list matches for the branch?" -> "mr_view {mrUrl, or repoName + iid}" [label="exactly one"];
    "mr_list matches for the branch?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="none: hold"];
    "mr_list matches for the branch?" -> "Gate review clarify: which target?" [label="several, or truncated"];
    "mr_list matches for the branch?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="an error: hold, quoting it"];
    "mr_list {repoName: <checkout>, search: <ticket id>, state: all, limit: 200}" -> "mr_list matches for the ticket?";
    "mr_list matches for the ticket?" -> "mr_view {mrUrl, or repoName + iid}" [label="exactly one, untruncated"];
    "mr_list matches for the ticket?" -> "Gate review clarify: which target?" [label="none, several, or truncated"];
    "mr_list matches for the ticket?" -> "Gate review clarify: which target?" [label="an error: quoted in the gate"];
    "mr_view {mrUrl, or repoName + iid}" -> "mr_view returned the MR?";
    "mr_view returned the MR?" -> "Own review run: record the target?" [label="yes"];
    "mr_view returned the MR?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="an error: hold, quoting it"];
    "mr_view returned the MR?" -> "STOP: GitLab reads go through the read tools or gitlab_get" [label="tempted to read it with the GitLab CLI"];
    "STOP: GitLab reads go through the read tools or gitlab_get" -> "mr_view {mrUrl, or repoName + iid}";
    "gh pr view <ref>" -> "gh pr view found the PR?";
    "gh pr view found the PR?" -> "Own review run: record the target?" [label="yes"];
    "gh pr view found the PR?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="no: hold, quoting it"];
    "Gate review clarify: which target?" -> "Review target answer?";
    "Review target answer?" -> "Review target form?" [label="a target picked"];
    "Review target answer?" -> "run_budget {runDb, key: target-clarify, limit: 2, stage}" [label="their text"];
    "Review target answer?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="next: hold"];
    "run_budget {runDb, key: target-clarify, limit: 2, stage}" -> "target-clarify spent?";
    "target-clarify spent?" -> "Review target form?" [label="no: resolve it"];
    "target-clarify spent?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="yes: hold"];
    "Own review run: record the target?" -> "Record the review target: mr, branch and any ticket" [label="yes"];
    "Own review run: record the target?" -> "Caller handed a decided selection and the report it decided on?" [label="no: inherited"];
    "Record the review target: mr, branch and any ticket" -> "Caller handed a decided selection and the report it decided on?";
    "Caller handed a decided selection and the report it decided on?" -> "Review posting forge?" [label="yes: post it; review nothing again"];
    "Caller handed a decided selection and the report it decided on?" -> "Caller framed a re-review?" [label="no"];
    "Caller framed a re-review?" -> "Take the earlier threads the caller handed in" [label="yes"];
    "Caller framed a re-review?" -> "Print the review depth block" [label="no"];
    "Take the earlier threads the caller handed in" -> "Earlier threads in hand?";
    "Earlier threads in hand?" -> "Print the review depth block" [label="yes, or none to judge"];
    "Earlier threads in hand?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="no: the read errored"];

    "Print the review depth block" -> "Review diff forge?";
    "Review diff forge?" -> "gh pr diff <ref>" [label="GitHub"];
    "Review diff forge?" -> "git fetch origin <targetBranch> +refs/merge-requests/<iid>/head:refs/remotes/origin/mr-<iid>" [label="GitLab"];
    "git fetch origin <targetBranch> +refs/merge-requests/<iid>/head:refs/remotes/origin/mr-<iid>" -> "git diff origin/<targetBranch>...origin/mr-<iid>";
    "git diff origin/<targetBranch>...origin/mr-<iid>" -> "MR-head checkout in hand?";
    "gh pr diff <ref>" -> "git fetch origin +pull/<n>/head:refs/remotes/origin/pr-<n>";
    "git fetch origin +pull/<n>/head:refs/remotes/origin/pr-<n>" -> "MR-head checkout in hand?";
    "MR-head checkout in hand?" -> "Set up for the review depth" [label="yes, or read depth"];
    "MR-head checkout in hand?" -> "worktree_provision {repoName, branch: <source branch>, reuse: true}" [label="no: verify or repro"];
    "MR-head checkout in hand?" -> "STOP: create a review checkout only with worktree_provision" [label="tempted to create one by hand"];
    "STOP: create a review checkout only with worktree_provision" -> "worktree_provision {repoName, branch: <source branch>, reuse: true}";
    "worktree_provision {repoName, branch: <source branch>, reuse: true}" -> "Review head worktree_provision returned a path?";
    "Review head worktree_provision returned a path?" -> "Provisioned review tree at the fetched head?" [label="yes"];
    "Review head worktree_provision returned a path?" -> "Dispatch the fresh reviewer; it forms the findings" [label="no: checks not run"];
    "Provisioned review tree at the fetched head?" -> "Set up for the review depth" [label="yes"];
    "Provisioned review tree at the fetched head?" -> "Dispatch the fresh reviewer; it forms the findings" [label="no: checks not run"];
    "Set up for the review depth" -> "Dispatch the fresh reviewer; it forms the findings";
    "Dispatch the fresh reviewer; it forms the findings" -> "Assemble the review draft";
    "Assemble the review draft" -> "Verify each blocking finding against the MR head";
    "Verify each blocking finding against the MR head" -> "Every blocking finding verified?";
    "Every blocking finding verified?" -> "Review report path given?" [label="yes, or none blocking"];
    "Every blocking finding verified?" -> "run_budget {runDb, key: verify-rounds:<depth>, limit: 2, stage}" [label="no"];
    "run_budget {runDb, key: verify-rounds:<depth>, limit: 2, stage}" -> "verify-rounds:<depth> spent?";
    "verify-rounds:<depth> spent?" -> "Re-dispatch a fresh reviewer on the unverified findings" [label="no"];
    "verify-rounds:<depth> spent?" -> "Demote each unverified finding to Minor, marked unverified" [label="yes"];
    "Re-dispatch a fresh reviewer on the unverified findings" -> "Assemble the review draft";
    "Demote each unverified finding to Minor, marked unverified" -> "Review report path given?";
    "Review report path given?" -> "Write the review report and its json sibling" [label="yes"];
    "Review report path given?" -> "Caller handed a decided selection?" [label="no"];
    "Write the review report and its json sibling" -> "Caller handed a decided selection?";

    "Caller handed a decided selection?" -> "Review posting forge?" [label="yes: use it, ask nothing"];
    "Caller handed a decided selection?" -> "Review report json in hand?" [label="no"];
    "Review report json in hand?" -> "Write review-post.extras.json" [label="yes"];
    "Review report json in hand?" -> "Gate review-post, legacy: tiers, outcome and next" [label="no"];
    "Write review-post.extras.json" -> "Caller owns the review gates?";
    "Caller owns the review gates?" -> "sh \"${CLAUDE_SKILL_DIR}/scripts/review-source.sh\" <report json> <dir>/review-post.extras.json > <dir>/review-post.source.json" [label="yes: a board wrapper said so"];
    "Caller owns the review gates?" -> "Report json under the temp root?" [label="no: direct run"];
    "Report json under the temp root?" -> "gate_open {kind: review-post, review: {findingsPath, extras}, runDb, stage, scope: post}" [label="yes"];
    "Report json under the temp root?" -> "Copy the report json into the review scratch dir" [label="no"];
    "Copy the report json into the review scratch dir" -> "gate_open {kind: review-post, review: {findingsPath, extras}, runDb, stage, scope: post}";
    "gate_open {kind: review-post, review: {findingsPath, extras}, runDb, stage, scope: post}" -> "gate_open result?";
    "sh \"${CLAUDE_SKILL_DIR}/scripts/review-source.sh\" <report json> <dir>/review-post.extras.json > <dir>/review-post.source.json" -> "review-source.sh exit 0?";
    "review-source.sh exit 0?" -> "gate_open {kind: review-post, sourcePath: <dir>/review-post.source.json, handBack: true, outPath: <dir>/review-post.open.json, runDb, stage, scope: post}" [label="yes"];
    "review-source.sh exit 0?" -> "run_budget {runDb, key: post-open-fix, limit: 2, stage}" [label="exit 1: names a field"];
    "review-source.sh exit 0?" -> "Open the review off-script gate: a review script refused" [label="exit 2"];
    "gate_open {kind: review-post, sourcePath: <dir>/review-post.source.json, handBack: true, outPath: <dir>/review-post.open.json, runDb, stage, scope: post}" -> "gate_open result?";
    "gate_open result?" -> "Gate review-post: carry the opened gate through gate-protocol" [label="opened"];
    "gate_open result?" -> "Write the review-run line into the handed --report" [label="handed back"];
    "gate_open result?" -> "run_budget {runDb, key: post-open-fix, limit: 2, stage}" [label="refused: names a field"];
    "gate_open result?" -> "Open the review off-script gate: a review script refused" [label="refused: no field to fix"];
    "gate_open result?" -> "STOP: only gate_open writes the review-post open; never hand-edit or hand-fit it" [label="tempted to edit or fit the open by hand"];
    "STOP: only gate_open writes the review-post open; never hand-edit or hand-fit it" -> "Open the review off-script gate: a review script refused";
    "run_budget {runDb, key: post-open-fix, limit: 2, stage}" -> "post-open-fix spent?";
    "post-open-fix spent?" -> "Fix the field the review script names" [label="no"];
    "post-open-fix spent?" -> "Open the review off-script gate: a review script refused" [label="yes"];
    "Fix the field the review script names" -> "Caller owns the review gates?";
    "Open the review off-script gate: a review script refused" -> "Review script off-script answer?";
    "Review script off-script answer?" -> "Gate review-post, legacy: tiers, outcome and next" [label="take"];
    "Review script off-script answer?" -> "Write review-post.extras.json" [label="iterate here"];
    "Review script off-script answer?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="hold"];
    "Review script off-script answer?" -> "Own review run: abandon it?" [label="hand back"];
    "Write the review-run line into the handed --report" -> "Hand back the severity line and the open's paths";
    "Hand back the severity line and the open's paths" -> "Review caller's answer?";
    "Review caller's answer?" -> "Review posting forge?" [label="{findings, outcome}"];
    "Review caller's answer?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="hold"];
    "Gate review-post: carry the opened gate through gate-protocol" -> "Review-post next answer?";
    "Gate review-post, legacy: tiers, outcome and next" -> "Review-post next answer?";
    "Review-post next answer?" -> "Review posting forge?" [label="proceed"];
    "Review-post next answer?" -> "Take the human's changes into the review draft" [label="iterate here"];
    "Review-post next answer?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="hold"];
    "Take the human's changes into the review draft" -> "Review iterate note asks for another depth?";
    "Review iterate note asks for another depth?" -> "Print the review depth block" [label="yes"];
    "Review iterate note asks for another depth?" -> "Review report path given?" [label="no: a new gate next"];

    "Review posting forge?" -> "gh pr review <ref> with the disposition and the summary body" [label="GitHub"];
    "Review posting forge?" -> "Compose the submitted review: comments, summary, outcome" [label="GitLab"];
    "gh pr review <ref> with the disposition and the summary body" -> "gh pr review result?";
    "gh pr review result?" -> "gate_record {runDb, stage, scope: post, shape: post, gateId | answers + decidedBy}" [label="posted"];
    "gh pr review result?" -> "Open the review off-script gate: gh pr review refused" [label="error"];
    "Open the review off-script gate: gh pr review refused" -> "gh pr review off-script answer?";
    "gh pr review off-script answer?" -> "gh pr comment <ref> with the summary body" [label="take"];
    "gh pr review off-script answer?" -> "gh pr review <ref> with the disposition and the summary body" [label="iterate here"];
    "gh pr review off-script answer?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="hold"];
    "gh pr review off-script answer?" -> "Own review run: abandon it?" [label="hand back"];
    "gh pr comment <ref> with the summary body" -> "gate_record {runDb, stage, scope: post, shape: post, gateId | answers + decidedBy}";
    "Compose the submitted review: comments, summary, outcome" -> "Resumed run: read the MR first?";
    "Resumed run: read the MR first?" -> "mr_review_submit {mrUrl, outcome, summary, comments, replies}" [label="no: a first pass"];
    "Resumed run: read the MR first?" -> "mr_posted_since {mrUrl, since: <run started_at>, items}" [label="yes: resumed"];
    "mr_posted_since {mrUrl, since: <run started_at>, items}" -> "This review already on the MR?";
    "This review already on the MR?" -> "mr_review_submit {mrUrl, outcome, summary, comments, replies}" [label="no"];
    "This review already on the MR?" -> "Open the review off-script gate: mr_approve refused" [label="yes, approval outstanding"];
    "This review already on the MR?" -> "gate_record {runDb, stage, scope: post, shape: post, gateId | answers + decidedBy}" [label="yes, nothing outstanding"];
    "This review already on the MR?" -> "Open the review off-script gate: mr_review_submit refused" [label="partly"];
    "This review already on the MR?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="the read errored"];
    "mr_review_submit {mrUrl, outcome, summary, comments, replies}" -> "mr_review_submit result?";
    "mr_review_submit result?" -> "gate_record {runDb, stage, scope: post, shape: post, gateId | answers + decidedBy}" [label="published, approved as asked"];
    "mr_review_submit result?" -> "Open the review off-script gate: mr_approve refused" [label="published, approved: false on an approve"];
    "mr_review_submit result?" -> "run_budget {runDb, key: bad-anchors, limit: 2, stage}" [label="published: false, bad-anchors"];
    "mr_review_submit result?" -> "Open the review off-script gate: pending comments on the MR" [label="published: false, pending-drafts"];
    "mr_review_submit result?" -> "Open the review off-script gate: mr_review_submit refused" [label="error"];
    "mr_review_submit result?" -> "STOP: post a review only as one mr_review_submit" [label="tempted to post pieces with mr_comment_inline, mr_comment, mr_reply_thread, mr_resolve_thread or the GitLab CLI"];
    "STOP: post a review only as one mr_review_submit" -> "Open the review off-script gate: mr_review_submit refused";
    "run_budget {runDb, key: bad-anchors, limit: 2, stage}" -> "bad-anchors spent?";
    "bad-anchors spent?" -> "Move the bad-anchor findings into the summary" [label="no"];
    "bad-anchors spent?" -> "Open the review off-script gate: mr_review_submit refused" [label="yes"];
    "Move the bad-anchor findings into the summary" -> "mr_review_submit {mrUrl, outcome, summary, comments, replies}";
    "Open the review off-script gate: mr_review_submit refused" -> "Review submit off-script answer?";
    "Open the review off-script gate: pending comments on the MR" -> "Review submit off-script answer?";
    "Review submit off-script answer?" -> "Make the recorded review move once" [label="take"];
    "Review submit off-script answer?" -> "mr_review_submit {mrUrl, outcome, summary, comments, replies}" [label="iterate here"];
    "Review submit off-script answer?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="hold"];
    "Review submit off-script answer?" -> "Own review run: abandon it?" [label="hand back"];
    "Make the recorded review move once" -> "gate_record {runDb, stage, scope: post, shape: post, gateId | answers + decidedBy}";
    "mr_approve {mrUrl}" -> "mr_approve result?";
    "mr_approve result?" -> "gate_record {runDb, stage, scope: post, shape: post, gateId | answers + decidedBy}" [label="approved"];
    "mr_approve result?" -> "Open the review off-script gate: mr_approve refused" [label="refused"];
    "Open the review off-script gate: mr_approve refused" -> "Approval off-script answer?";
    "Approval off-script answer?" -> "Make the recorded approval move once" [label="take"];
    "Approval off-script answer?" -> "mr_approve {mrUrl}" [label="iterate here"];
    "Approval off-script answer?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="hold"];
    "Approval off-script answer?" -> "Own review run: abandon it?" [label="hand back"];
    "Make the recorded approval move once" -> "gate_record {runDb, stage, scope: post, shape: post, gateId | answers + decidedBy}";
    "gate_record {runDb, stage, scope: post, shape: post, gateId | answers + decidedBy}" -> "Own review run: close it?";
    "Own review run: close it?" -> "run_close {runDb, workType: review, stage: review, outcome}" [label="yes: done"];
    "Own review run: close it?" -> "End with the review target's forge link" [label="no: inherited"];
    "Own review run: abandon it?" -> "run_close {runDb, workType: review, stage: review, outcome}" [label="yes: abandoned"];
    "Own review run: abandon it?" -> "run_stage {action: fail, stage: <run.current_stage>, reason: <why; what already posted>}" [label="no: inherited"];
    "run_close {runDb, workType: review, stage: review, outcome}" -> "Review closed as?";
    "Review closed as?" -> "End with the review target's forge link" [label="done"];
    "Review closed as?" -> "Review handed back: the why and what posted, quoted" [label="abandoned"];
    "End with the review target's forge link" -> "Review posted";
    "run_stage {action: fail, stage: <run.current_stage>, reason: <why; what already posted>}" -> "Review handed back: the why and what posted, quoted";
    "run_hold {runDb, stage, reason, decidedBy}" -> "Review held: end the turn";
}
```

### Gate review clarify: Resume / Start fresh / Hold

No run is yours yet: use the in-pane structured-question tool. One
sentence naming each candidate's `spawnedBy`, `startedAt` and
`currentStage`; one **Resume** option per candidate this pane may take
(this session's, `ownSession: true`, recommended; or one no live pane
owns), naming one another live pane owns unavailable; then **Start fresh**
and **Hold**. A launched pane never gets here: with `spawnedBy` and no
`resume`, `run_enter` starts fresh. Hold records nothing.

### The refused review run_enter carried resume?

A refused resume means the run is gone or no longer running: say so in one
line and start fresh with the first call's `spawnedBy`. Any other refusal
ends the review: quote it verbatim and whole, never a paraphrase or a
guessed cause. Only with no `run_enter` tool at all, say rt predates the
run tools; update rt.

### Resolve the review target

From the conversation (an MR/PR URL, `!iid` or `#number`, a ticket id, or
a branch name), or on a resume in a new session the snapshot's `mr`.
`mr_view` takes `mrUrl`, else `repoName` (the checkout path) plus `iid`,
and resolves any MR your token can see, by anyone, in any state. Quote a
read error, never paraphrase it (usually GitLab's 404 or 403; or rt's:
target not resolved, daemon unreachable, timeout), and hold with it
(`decidedBy: "pane"`). A null `mr_for_branch` entry means no open MR, not
none: `mr_list` by `sourceBranch` sees every state.

### mr_list matches for the branch?

`truncated: true` (more than the 200 returned) is ambiguous whatever the
list holds: the clarify gate, saying it was cut at 200 rows, one option
per MR returned. Otherwise exactly one goes to `mr_view` by its `iid`;
none holds with "GitLab has no MR for the branch" (`decidedBy: "pane"`);
several take the clarify gate, one option per MR (iid, title, state).
Never a guess.

### mr_list matches for the ticket?

Keep the returned rows whose `sourceBranch` or `title` carries the id.
`truncated` first, as for the branch. Exactly one kept row goes to
`mr_view`; none is the clarify gate with no options, saying no returned
row carries the ticket (not that no MR exists), their typed text the
answer; several is the clarify gate, one option per row (iid, title,
state). An error is quoted in the gate's sentence, never read as none.
Never a guess.

### Reading a GitLab fact no read tool returns

A GitLab fact no read tool returns (the MR's commits, a
referenced issue, another MR's state) is `gitlab_get {repoName, path}`,
`repoName` the checkout path, `path` relative to the API root, `:id` this
project (`projects/:id/merge_requests/<iid>/commits`). It opens no gate.
Quote a GitLab error as written; a refused credential path is final.

### Gate review clarify: which target?

One sentence naming the candidates, quoting a failed read's error, or
saying the list was cut at 200 rows or nothing was found. Then
gate-protocol's Runs integration from `Trigger: a site reaches its gate`:
`gate_ask {questions, kind: clarify, context, runDb, stage}`, questions `target` (one option per candidate;
none when nothing was found or a read failed: their typed text answers)
and `next`: **Proceed** (recommended) / **Hold**. `next: hold` holds
whatever `target` says. A picked
target resolves; typed text charges `target-clarify` and resolves again,
and a spent budget's hold names what was tried.

### Record the review target: mr, branch and any ticket

`run_field_set` with `stage: review`: `key: mr` (the MR or PR URL), `key:
branch` (its source branch), and `key: ticket` only when the MR or PR
itself names one.

### Caller handed a decided selection and the report it decided on?

Yes when the caller hands a decided selection (`{findings, outcome}`, or
legacy `{tiers, outcome}`) together with the `--report` the human decided
it on: the review already ran in an earlier pane, a board's fresh pane or
a resume of this run included. Go straight to posting. Compose reads each
selected finding's text, anchor and tier from the report's json sibling
(the report itself for a legacy selection) as written. Print no depth
block, fetch, diff, provision or dispatch nothing, and never rewrite the
report or its json: a second pass forms new findings whose ids and
anchors are not the ones the human picked. On a resumed run the post
still reads the MR first (`This review already on the MR?`). No: a
selection handed with no report, or none handed, goes on to the review.

### Caller framed a re-review?

Yes only when the caller says this pass re-reviews an already reviewed
change; a hand-typed review, or a caller silent on earlier rounds, is a
first review.

### Take the earlier threads the caller handed in

A re-review judges the earlier threads first, then what is new. The caller
hands in the threads (each with `discussionId`, anchor, `round`, the
reviewer's first note and the author's replies), the last reviewed commit
and the round number, or the rule that picks the threads and their
`round`: then read `mr_threads {mrUrl, refresh: true}` and keep exactly
what it picks (an error answers no at `Earlier threads in hand?`). With
none, it is a full review framed as a re-review, `threads` empty.

The skipped list comes too, each `{id, round, title, severity, file,
line, excerpt, snippet}` with the sha of the round that skipped it: every
one comes back under the json's `skipped`, never raised again, since an
issue a skipped finding already says is not new.

This step judges nothing. Each thread's call (one of the structured
findings file's four, with a one-line note and a reply in the writing
style) and the new issues form in the fresh reviewer, weighting `git diff
<last reviewed sha>..HEAD` over the whole change, `HEAD` the MR head
(`origin/mr-<iid>`, or `origin/pr-<n>`, with no MR-head checkout in hand).
A missing, `unknown` or unfetched last reviewed commit makes the whole
change what changed.

### Print the review depth block

The review flow's Commit to a review depth, its HARD-GATE included. Size
the change from what resolving it returned (title, description, changed
files).

### MR-head checkout in hand?

In hand: a checkout already at the MR head, one a caller handed or this
pane's own tree. `read` depth runs nothing: yes. At `verify` or `repro`
with none, provision one (`repoName` this checkout's path, `branch` the
source branch, `reuse: true`) and run every check in its `path`, never
changing this pane's directory; rt disposes it after the merge, never you.
A refusal is quoted in the setup observations, the setup checks and the
verify command check noted as not run.

### Review head worktree_provision returned a path?

`kind: "provisioned"` or `"reused"` returns a `path`: yes, and the head
check decides whether it is usable. A refusal is no.

### Provisioned review tree at the fetched head?

Compare `git rev-parse HEAD` in that path with `origin/mr-<iid>` (or
`origin/pr-<n>`). A mismatch is not in hand: quote both shas, and note the
setup checks and the verify command check as not run. Never reset or pull
that tree.

### Set up for the review depth

The review flow's Set up for the depth, in the MR-head checkout
(`targetBranch` from `mr_view`). Record every command and its result.

### Dispatch the fresh reviewer; it forms the findings

The review flow's Dispatch the review, reviewer shape, full payload: the
findings form in that fresh context, never here, and it makes its own
`gitlab_get` reads. On a re-review one block follows the standard blocks:
the earlier threads and last reviewed commit, asking each thread's call and
note ahead of the Strengths and findings on new issues only, and the
skipped findings (anchor, title, excerpt), never new findings.

### Assemble the review draft

The review flow's Assemble the draft, Earlier threads first on a
re-review. On a second verify round, keep what round one verified and take
the re-dispatch's answer for the rest.

### Verify each blocking finding against the MR head

Blocking is Critical and Important; Minor is not verified. Check each
blocking finding's facts, never its reasoning:

- **Anchor:** the file exists at the head sha and the cited line is
  non-blank there (`git show <head>:<file>`, head `origin/mr-<iid>` or
  `origin/pr-<n>`), in the diff or not, since a change can break an
  unchanged line. No `file` anchor: check quote and command only.
- **Quote:** quoted code appears at or near that line.
- **Command:** a named command re-runs only in the MR-head checkout; with
  none, skip and note it ("not run at read depth" at `read`). One that
  passes where the finding says it fails is a failed check.

A round leaving a blocking finding unverified charges
`verify-rounds:<depth>`, the depth in force (`read`, `verify`, `repro`).

### Re-dispatch a fresh reviewer on the unverified findings

One fresh-context dispatch, same template, naming each failed check
verbatim and asking it to
confirm each finding with a corrected anchor or withdraw it.

### Demote each unverified finding to Minor, marked unverified

Each finding that failed round two moves to Minor, its `body` prefixed
`Unverified: <the failed check>.` Readiness is never raised by a demotion;
the reasoning gains one sentence naming the demoted findings. The json,
written afterward, mirrors the demoted draft; demotion never edits an
already-written json.

### Write the review report and its json sibling

The review flow's "Structured findings file", written after verification
so the json mirrors the verified draft.

### Write review-post.extras.json

Make one new directory in this session's scratchpad (the Claude Code temp
root, where `gate_open` reads and writes), never `mktemp -d`, and write its
path out literally from then on. Write `<dir>/review-post.extras.json`:

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
| `target` | `!<iid>` or `#<number>`, as the forge writes it |
| `reviewer`, `round` | only when the caller supplies them (a re-review's caller supplies `round`); else omit the key |
| `outcome` label | `Verdict on <target>: ` plus a clause composed from the json's `summary`, never a field verbatim: readiness `yes` reads "ready to merge"; `with-fixes` or `no` reads "not ready" or "ready once <the gist of the reasoning>" |
| `outcome` options | `comment` and `approve`, each described by what picking it does; `request_changes` only when this verb runs the gate on GitHub (rt's GitLab tools have none). The recommendation goes FIRST, its label ending ` (recommended)`: `approve` when readiness is `yes`, else `comment` |
| `next` | only when this verb runs the gate; a caller that owns the gates navigates itself |

Direct, the object is `gate_open`'s inline `extras`, the report json (or
its copy) the `findingsPath`; on the hand-back path the file goes to
`review-source.sh`. Both build one open whose question ids key the
answers: `thread-<n>` (options `post:<discussionId>`,
`resolve:<discussionId>`), `findings-<n>` (finding ids), `skipped-<n>`
(`restore:<id>`), `outcome`, `next`. A pre-v2 report json opens as
prose, which is not an error. Never hand-edit it or shorten a body to fit.

### Copy the report json into the review scratch dir

`gate_open` reads `findingsPath` only under the temp root (or an installed
plugin root): copy a report json from elsewhere (a caller's `--report`
sibling) into `<dir>` unchanged and pass the copy; the originals stay put.
Every pass copies again, so fix the original (or the extras), never the
copy.

### review-source.sh exit 0?

The hand-back path only: the board's prose step reads
`<dir>/review-post.source.json`, so build it with the vendored script.
Exit 1 names a field to fix (the extras, or the
report json where it drifted from the draft); exit 2 is a usage or
unreadable-input error, nothing to fix.

### gate_open result?

- **Opened** (direct): keep `id`, `paneAction` and `formChunks`; the tool
  wrote `gate` and stored the source as `extra.gate-source.post`.
- **Handed back:** nothing opened; the open is at `outPath` in
  `gate-ctx.sh fit`'s shape, its source beside it, `droppedContexts`
  naming any context over the shared budget.
- **Refused:** nothing opened, one problem per line. A line naming a field
  in the extras or the report json is a field to fix; a refusal no field
  fix can mend (a file it cannot read or parse, a path outside the read
  roots) goes straight to the off-script gate.

### Fix the field the review script names

Fix exactly the named field (a `gate_open` line, or `review-source.sh`
exit 1), in the extras or the report json where it drifted from the draft.
Then back through
`Caller owns the review gates?` to the same open.

### Write the review-run line into the handed --report

Write one `review-run: <run id>` line (`run_enter`'s `runId`) into the
handed `--report`, replacing any earlier one; with no `--report`, nothing.
A fresh pane the board later hands a decision to resumes this run, and
its stored gate source, by that id. The board never reads the line.

### Hand back the severity line and the open's paths

A caller that owns the gates (a board wrapper says so when it delegates)
gets no gate from this verb. Hand back the severity line; the absolute
paths of `<dir>/review-post.open.json` (its source beside it as
`review-post.source.json`) and of this skill's vendored
`${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh`; any `droppedContexts`; and on
GitLab the MR head sha this review read (`mr_view`'s `mr.sha`). Then wait
for its `{findings, outcome}` (plus `replies` and `restored` on a
re-review) or its hold.

### Gate review-post: carry the opened gate through gate-protocol

Enter gate-protocol at `Trigger: a site opened its gate with gate_open`
with the result and walk on from `paneAction?`. On a review gate neither
`gate_answer` nor `gate_reconcile` records: keep the gate's `id` and
answers map for Compose; the `gate_record` after posting is the record.
With `fits: false` or `contextDropped: true` the gate stays open as it is:
carry on.

### Gate review-post, legacy: tiers, outcome and next

No report json leaves nothing to build from. Gate-protocol's Runs
integration from `Trigger: a site reaches its gate`: `gate_ask {questions,
kind: review-post, scope: post, context, runDb, stage}`, `context` the severity line verbatim, questions
`tiers` (multi-select over the levels present, all pre-selected), then
`outcome` and `next` as in the extras. It records nothing either; the post
record reads `tiers` as the legacy selection.

### Take the human's changes into the review draft

Apply their text to the draft. Asking for another depth goes back to the
depth block under a fresh
`verify-rounds:<depth>` key, since new setup means a fresh verify.
Anything else is a draft edit: re-present, and the next gate is a NEW
gate.

### Compose the submitted review: comments, summary, outcome

One call carries the whole review. Selected findings: the union of the
`findings-<n>` answers (`{value, note}` unwraps to its value), a legacy
`tiers` answer's whole tiers, or the caller's selection (each finding
as the report json it was decided on writes it). `comments`: one
`{body, path, line}` per selected finding with both `file` and `line`,
`body` its tier, title and what to change. `summary`: the review-posting
summary, its issue list holding each selected finding without both.
`outcome`: `comment` or `approve`. At most 100 comments and replies in all;
past that, the lowest-tier anchored findings go to the issue list.

`replies`: one per `thread-<n>` answer that picked anything,
`discussionId` from the value after `post:` or `resolve:`, `resolve` true
for `resolve:<id>`, `body` only for `post:<id>`: the answer's `text` when
present (the human's edit), else the report json's `reply`. A caller's
decided `replies` go in unchanged.

A `restore:<id>` answer brings that skipped finding back, posting as
review-posting says for restored findings, its text the caller's record
verbatim, never rewritten: the caller's `restored` entry (`title`, then
`body`) when it decided the selection, else the handed skipped entry
(`title`, then `excerpt`). Its `changed` is the `restored` entry's, else
the report json's `skipped` entry's.

### This review already on the MR?

Asked on GitLab after Compose, before anything posts. A first pass
(`started` or `inherited`) answers no without a read. A resumed run with no
post decision reads the MR before any submit, whatever its holds say,
since a submit can land after the run's last record:

`mr_posted_since {mrUrl, since: <the snapshot's run.started_at>, items}`

`items`: `{id: "summary", contains: <the summary's first line>}`, then per
comment `{id: <finding id>, contains: <its body's first line>, path,
line}`. All `posted` is yes, some is partly, none is no; never judge it
from a thread read, and a read error holds, quoting it. The latest hold's
reason adds what the read cannot show: a review it names as posted by the
human is posted, and on an approve, an approval it does not name as landed
is outstanding. Yes with the approval outstanding is the approval gate
(iterate runs `mr_approve` alone, never a second submit); yes with nothing
outstanding is the post record; partly is the refused-review gate, where
the human finishes the review in the forge UI; no is submit.

### Move the bad-anchor findings into the summary

`badAnchors` names comments by `index`, zero-based in the `comments` sent;
nothing posted. Move each into the summary's issue list, its `file:line` in
the text, and call again with the rest unchanged.

### Make the recorded review move once

The human made the recorded move in the forge UI. Post nothing: record
it, once, and go on to the post record.

### Make the recorded approval move once

Exactly the move the gate recorded for the refused approval, once.

### End with the review target's forge link

End with the target's id as a markdown link to its real web URL
(review-posting's close HARD-GATE): a posting tool's, else `mr_view`'s
`webUrl` (or `gh pr view`'s url), else on a resume the snapshot's `mr`.

### Open the review off-script gate: a review script refused

Opens at once on a refusal no field fix can mend (`review-source.sh` exit
2, a `gate_open` refusal of an unreadable file or a path outside the read
roots), and on a field refusal once `post-open-fix` is spent. Proposed
move: the legacy gate in place of the structured open.

### Open the review off-script gate: gh pr review refused

Proposed move: post the summary body as a plain PR comment with `gh pr
comment <ref>`, leaving the disposition to the human.

### Open the review off-script gate: mr_review_submit refused

A timeout, an unknown outcome or a partial landing may have left some or
all of this review on the MR; any other error means nothing is up.
Proposed move: the human posts the review in the forge UI, approving on an
approve (the summary and every comment quoted in full in `context`),
recorded as posted by the human.

- **Timed out, or outcome unknown:** `context` first says some or all of
  it may be up; the human looks for the summary first, and one already up
  means take records it without posting again.
- **Only partly landed:** `context` first says some comments may be up
  without the summary, so the human checks the MR's threads. Take only:
  the human finishes the review in the forge UI, summary included.

`context` then says **Iterate here** is only for a human who confirmed
nothing from this review is up, never a blind resubmit. From `This review
already on the MR?` with partly, it quotes the hold reason and which
`mr_posted_since` items are posted.

### Open the review off-script gate: pending comments on the MR

The reviewer has pending comments here (from the forge UI or an earlier
failed submit) that a submit would publish with the review. `context`
quotes their count and first lines. The human submits or discards them in
the forge UI, so **Iterate here**, retrying the same call, is the
recommended `next`. Take: the human posts this review in the forge UI with
their pending comments (the summary and every comment quoted in full),
recorded as posted by the human.

### Open the review off-script gate: mr_approve refused

The review is posted; only the approval failed. Proposed move: the human
approves in the forge UI, recorded as theirs. Iterate retries `mr_approve`
alone, never the review. `context` quotes the submit's `approveError`, a
refused `mr_approve`'s error, or, from `This review already on the MR?`,
the hold reason naming the approval outstanding.

## Review off-script gates

Every off-script box opens gate-protocol's `## Off-script gate` at site
`review` (scope `off-script:review:<n>`, `n` from 1 in this run), `context`
quoting the refusal verbatim, under the run, in this pane even when a board
owns the review gates.

Route: `action: handback` is hand back whatever `next` says; otherwise
`next: iterate` is iterate here (a retry with their note; each failed
retry opens a new gate), `hold` is `run_hold` with their words, `proceed`
is take. A hold's or hand-back's reason says what is on the MR; from the
submit, pending-comments or approval gate it always says whether this
review is posted (by the submit, by the human, partly, or outcome unknown)
and, on an approve, whether the approval is outstanding: what `This review
already on the MR?` reads on a resume.

## What the graph cannot show

- Review verbs produce judgment and execute posting; they never decide
  what posts.
- The draft is presented once, after verify and any demotion, then the
  severity levels present in one line, for example "Findings: Critical
  (2), Important (1); 3 findings.", skipping empty levels, counted on the
  demoted draft before any selection.
- A caller's decided selection is `{findings, outcome}` or legacy
  `{tiers, outcome}` (plus `replies` and `restored: [{id, title, body,
  file, line, changed}]` on a re-review), with the decider to use. Posting
  gets it as `{findings: <ids>, disposition: <outcome>}` (legacy `{levels:
  <tiers>, disposition: <outcome>}`), restored findings selected, never
  deselected.
- The post record, `gate_record {runDb, stage, scope: post, shape: post}`,
  comes only once the review is up (by the submit, `gh`, or the human on a
  take): rt reads the latest post decision as what posted. Pass `gateId`
  for an answered gate, or the caller's selection as `answers` with its
  named `decidedBy`; the tool builds the record.
- A hold is one `run_hold` (`reason` the human's words or the quoted
  error, `decidedBy` the answer's by, `pane` for an error); then the turn
  ends. A gate that comes back `closed` is a hold, reason "gate closed".
- `run_close` takes `outcome: done` after the post record, or `abandoned`
  with `reason: <why; what already posted>` on a hand back.
- A fetch, diff or `gh pr diff` that errors is a hold quoting the error.

## The review flow

The boxes from **Print the review depth block** through **Assemble the
review draft** follow this flow; apply its Criteria triage lines and
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

On GitLab that one review is `mr_review_submit` (comments, summary,
outcome; `replies` on a re-review): `published: true` with `mrUrl`, the
close's link, or `published: false` with the reason and nothing posted.
The daemon places each comment, so never hand-build a position payload or
post a finding with `mr_comment_inline`. GitHub has no inline mechanism:
every selected finding rides in the one `gh pr review` body with its
`file:line`.
