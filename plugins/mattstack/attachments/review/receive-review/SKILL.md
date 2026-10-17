---
name: receive-review
disable-model-invocation: true
description: >-
  Use when processing review feedback received on your OWN MR/PR --
  "address the review comments", "go through the reviewer's comments and
  reply", "respond to the review", "handle the feedback on my change".
  For someone else's change use the domain's review skill; for your own
  branch before it has feedback use the self-review flow.
type: pipeline-step
slots:
  criteria: { contract: review-criteria@1, required: false }
  reply-rules: { contract: reply-rules@1, required: false }
  reviewer: { contract: reviewer-dispatch@1, required: false }
---

# Receive review (feedback on your own change)

The review comments left on **your own** change: pull the open threads,
judge each against the codebase, decide what to change, reply. The skill
exists for the two things agents get wrong on their **own** change:
adjudicating the comments in the context that wrote the code (author
bias), and performative agreement leaking into the replies.

The graph below is the run: follow its edges. A move it does not show is a
question for a gate, never a judgment call. Reads through the read tools
and `gitlab_get` are part of the step that needs them, not moves.

```dot
digraph receive_review {
    rankdir=TB;

    "Trigger: review feedback to answer on your own MR/PR" [shape=ellipse];
    "run_enter {flags, skillDir, stage: receive-review, runDb?, resume?, spawnedBy?}" [shape=plaintext];
    "receive-review run_enter mode?" [shape=diamond];
    "Gate clarify for receive-review: Resume / Start fresh / Hold" [shape=box];
    "receive-review clarify answer?" [shape=diamond];
    "run_enter {flags, skillDir, stage: receive-review, resume: <picked runId>}" [shape=plaintext];
    "run_enter {flags, skillDir, stage: receive-review, fresh: true, spawnedBy?}" [shape=plaintext];
    "The refused receive-review run_enter carried resume?" [shape=diamond];
    "STOP: no receive-review run without run_enter; report why to the user" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "run_snapshot {runDb: <resumed receive-review>}" [shape=plaintext];
    "What does the receive-review snapshot record?" [shape=diamond];
    "run_field_get {runDb, key: extra.gate-source.respond-plan}" [shape=plaintext];
    "What did the caller hand receive-review?" [shape=diamond];

    "Resolve the change and record its identity" [shape=box];
    "Forge of the change?" [shape=diamond];
    "MR url or iid in hand?" [shape=diamond];
    "mr_for_branch {repoName: <root>, branches: [<branch>]}" [shape=plaintext];
    "Open MR with this source branch?" [shape=diamond];
    "Report that no open MR has this branch as its source" [shape=box];
    "The run already records mr?" [shape=diamond];
    "run_field_set {runDb, key: mr, value: <MR or PR url>, stage}" [shape=plaintext];
    "The run already records branch?" [shape=diamond];
    "run_field_set {runDb, key: branch, value: <source branch>, stage}" [shape=plaintext];
    "Executing a caller-handed {plan}?" [shape=diamond];
    "Where are the handed plan's threads?" [shape=diamond];
    "mr_threads {mrUrl} for the handed plan's threads" [shape=plaintext];
    "Read the handed plan's threads on GitHub with gh" [shape=box];
    "Keep exactly the threads the handed plan names" [shape=box];
    "run_field_get {runDb, key: extra.gate-source.respond-plan} for the handed plan" [shape=plaintext];
    "The run stores a respond-plan source for the handed plan?" [shape=diamond];
    "Forge for the thread read?" [shape=diamond];
    "mr_threads {mrUrl, filter: \"unresolved-human\"}" [shape=plaintext];
    "Read the PR's review threads with gh" [shape=box];
    "Keep only unresolved human threads (GitHub)" [shape=box];
    "Any unresolved human threads?" [shape=diamond];

    "Dispatch one fresh-context adjudicator over all the review threads" [shape=box];
    "Draft the verdict table and one reply per thread" [shape=box];
    "Build the open" [shape=box];
    "Caller owns the receive-review gates at respond-plan?" [shape=diamond];
    "gate_open {kind: respond-plan, sourcePath: <dir>/respond-plan.source.json, runDb, stage, scope: respond-plan}" [shape=plaintext];
    "gate_open {kind: respond-plan, sourcePath: <dir>/respond-plan.source.json, handBack: true, outPath: <dir>/respond-plan.open.json, runDb, stage, scope: respond-plan}" [shape=plaintext];
    "respond-plan gate_open result?" [shape=diamond];
    "STOP: fit the respond-plan open only with gate_open" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "run_budget {runDb, key: respond-plan-open, limit: 3, stage}" [shape=plaintext];
    "respond-plan-open spent?" [shape=diamond];
    "Fix the respond-plan source the gate_open refusal names" [shape=box];
    "Off-script gate: the respond-plan open will not fit" [shape=box];
    "respond-plan fit answer?" [shape=diamond];
    "Write the receive-review-run line into the handed --report" [shape=box];
    "Hand back the verdict table and the respond-plan open's path" [shape=box];
    "Gate respond-plan: carry the opened gate through gate-protocol" [shape=box];
    "respond-plan pane next answer?" [shape=diamond];
    "Redraft the replies with the respond-plan note" [shape=box];
    "gate_record {runDb, stage, scope: respond-plan, shape: respond-plan, gateId | answers + decidedBy, contextDropped?}" [shape=plaintext];
    "Rewrite the receive-review report rows" [shape=box];
    "code-changes answer?" [shape=diamond];

    "Next report row, in verdict-table order?" [shape=diamond];
    "Implement the thread's fix" [shape=box];
    "Run the project's tests and checks on the fix" [shape=box];
    "Fix checks pass?" [shape=diamond];
    "run_budget {runDb, key: fix:<threadId>, limit: 3, stage}" [shape=plaintext];
    "fix:<threadId> spent?" [shape=diamond];
    "Off-script gate: the thread's fix did not converge" [shape=box];
    "Unconverged fix answer?" [shape=diamond];
    "Make the recorded move once for the unconverged fix" [shape=box];
    "Commit the fix and finalize its Fixed reply" [shape=box];
    "Redraft the override's reply" [shape=box];

    "Any thread offered (a finalized fix or an override)?" [shape=diamond];
    "Build the respond-post open" [shape=box];
    "Caller owns the receive-review gates at respond-post?" [shape=diamond];
    "gate_open {kind: respond-post, sourcePath: <dir>/respond-post.source.json, runDb, stage, scope: respond-post}" [shape=plaintext];
    "gate_open {kind: respond-post, sourcePath: <dir>/respond-post.source.json, handBack: true, outPath: <dir>/respond-post.open.json, runDb, stage, scope: respond-post}" [shape=plaintext];
    "respond-post gate_open result?" [shape=diamond];
    "STOP: fit the respond-post open only with gate_open" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "run_budget {runDb, key: respond-post-open, limit: 3, stage}" [shape=plaintext];
    "respond-post-open spent?" [shape=diamond];
    "Fix the respond-post source the gate_open refusal names" [shape=box];
    "Off-script gate: the respond-post open will not fit" [shape=box];
    "respond-post fit answer?" [shape=diamond];
    "Write the run line before the respond-post hand-back" [shape=box];
    "Hand back the offered replies and the respond-post open's path" [shape=box];
    "Gate respond-post: carry the opened gate through gate-protocol" [shape=box];
    "respond-post next answer?" [shape=diamond];
    "Decide nothing at respond-post: no push, post, resolve or record" [shape=box];
    "Apply the respond-post note" [shape=box];
    "gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy}" [shape=plaintext];

    "Forge for the post side?" [shape=diamond];
    "respond_post_execute {runDb, tree, stage}" [shape=plaintext];
    "respond_post_execute result?" [shape=diamond];
    "run_budget {runDb, key: post-execute-fix, limit: 2, stage}" [shape=plaintext];
    "post-execute-fix spent?" [shape=diamond];
    "Fix what the respond_post_execute refusal names" [shape=box];
    "Off-script gate: respond_post_execute refused" [shape=box];
    "respond_post_execute refusal answer?" [shape=diamond];
    "STOP: respond_post_execute pushes the fix; never push from the shell, never force" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "STOP: post replies only through respond_post_execute" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Off-script gate: the forge refused a reply or resolve" [shape=box];
    "Forge refusal answer?" [shape=diamond];
    "Report the held threads verbatim" [shape=box];
    "run_field_set {runDb, key: hold, value: -, stage}" [shape=plaintext];

    "Posted already on GitHub: read every thread with gh" [shape=box];
    "The GitHub read returned every thread due?" [shape=diamond];
    "Picks post or resolve a gate-1: fix row?" [shape=diamond];
    "git branch --show-current" [shape=plaintext];
    "git rev-parse --abbrev-ref @{push}" [shape=plaintext];
    "Both name the MR's source branch?" [shape=diamond];
    "git_push {tree: <worktree root>}" [shape=plaintext];
    "git_push result for the fix rows?" [shape=diamond];
    "STOP: a failed git_push holds the fix rows; never push from the shell, never force" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Hold the picked fix rows and report the failure verbatim" [shape=box];
    "Next GitHub thread?" [shape=diamond];
    "Post the reply on GitHub with gh" [shape=box];
    "resolve: decided for this thread?" [shape=diamond];
    "Resolve the thread on GitHub with gh" [shape=box];
    "Any GitHub fix row held this pass?" [shape=diamond];
    "gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy, held}" [shape=plaintext];
    "run_field_set {runDb, key: hold, value: held, stage: <stage>}" [shape=plaintext];

    "Report the outcome" [shape=box];
    "This verb started or resumed the run?" [shape=diamond];
    "Failed or abandoned: is the run this verb's own?" [shape=diamond];
    "run_close {runDb, workType: receive-review, stage: receive-review, outcome}" [shape=plaintext];
    "receive-review closed as?" [shape=diamond];
    "run_stage {action: fail, stage: <stage>, reason}" [shape=plaintext];
    "run_hold {runDb, stage, reason, decidedBy}" [shape=plaintext];

    "No open MR: nothing to answer" [shape=doublecircle];
    "Held: end the turn naming the run and stage" [shape=doublecircle];
    "Threads held: run left open for a resume" [shape=doublecircle];
    "receive-review stage failed" [shape=doublecircle];
    "Review feedback answered" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: review feedback to answer on your own MR/PR" -> "run_enter {flags, skillDir, stage: receive-review, runDb?, resume?, spawnedBy?}";
    "run_enter {flags, skillDir, stage: receive-review, runDb?, resume?, spawnedBy?}" -> "receive-review run_enter mode?";
    "run_enter {flags, skillDir, stage: receive-review, resume: <picked runId>}" -> "receive-review run_enter mode?";
    "run_enter {flags, skillDir, stage: receive-review, fresh: true, spawnedBy?}" -> "receive-review run_enter mode?";
    "receive-review run_enter mode?" -> "What did the caller hand receive-review?" [label="started, or inherited: stage is at.stage"];
    "receive-review run_enter mode?" -> "run_snapshot {runDb: <resumed receive-review>}" [label="resumed"];
    "receive-review run_enter mode?" -> "Gate clarify for receive-review: Resume / Start fresh / Hold" [label="candidates"];
    "receive-review run_enter mode?" -> "The refused receive-review run_enter carried resume?" [label="refused, or the tool is missing"];
    "The refused receive-review run_enter carried resume?" -> "run_enter {flags, skillDir, stage: receive-review, fresh: true, spawnedBy?}" [label="yes: say so, start fresh"];
    "The refused receive-review run_enter carried resume?" -> "STOP: no receive-review run without run_enter; report why to the user" [label="no"];
    "Gate clarify for receive-review: Resume / Start fresh / Hold" -> "receive-review clarify answer?";
    "receive-review clarify answer?" -> "run_enter {flags, skillDir, stage: receive-review, resume: <picked runId>}" [label="resume"];
    "receive-review clarify answer?" -> "run_enter {flags, skillDir, stage: receive-review, fresh: true, spawnedBy?}" [label="start fresh"];
    "receive-review clarify answer?" -> "Held: end the turn naming the run and stage" [label="hold: no run yet, record nothing"];
    "run_snapshot {runDb: <resumed receive-review>}" -> "What does the receive-review snapshot record?";
    "What does the receive-review snapshot record?" -> "What did the caller hand receive-review?" [label="no respond-plan record"];
    "What does the receive-review snapshot record?" -> "run_field_get {runDb, key: extra.gate-source.respond-plan}" [label="respond-plan recorded only, no plan handed after a revise: never record it again"];
    "What does the receive-review snapshot record?" -> "What did the caller hand receive-review?" [label="respond-plan recorded as code-changes: revise, a {plan} handed: the newer plan"];
    "What does the receive-review snapshot record?" -> "gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy}" [label="respond-plan recorded only, a {post} handed"];
    "What does the receive-review snapshot record?" -> "Forge for the post side?" [label="respond-post recorded, held or not"];
    "run_field_get {runDb, key: extra.gate-source.respond-plan}" -> "Rewrite the receive-review report rows" [label="the stored cards, or an unset-key error"];
    "What did the caller hand receive-review?" -> "Resolve the change and record its identity" [label="nothing, or a {plan} (alone or in {plan, post})"];
    "What did the caller hand receive-review?" -> "gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy}" [label="a {post} alone"];

    "Resolve the change and record its identity" -> "Forge of the change?";
    "Forge of the change?" -> "MR url or iid in hand?" [label="GitLab"];
    "Forge of the change?" -> "The run already records mr?" [label="GitHub: the PR url"];
    "MR url or iid in hand?" -> "The run already records mr?" [label="yes"];
    "MR url or iid in hand?" -> "mr_for_branch {repoName: <root>, branches: [<branch>]}" [label="no"];
    "mr_for_branch {repoName: <root>, branches: [<branch>]}" -> "Open MR with this source branch?";
    "Open MR with this source branch?" -> "The run already records mr?" [label="yes: its iid"];
    "Open MR with this source branch?" -> "Report that no open MR has this branch as its source" [label="null entry"];
    "Open MR with this source branch?" -> "Failed or abandoned: is the run this verb's own?" [label="an error: fail, quoting it"];
    "Report that no open MR has this branch as its source" -> "No open MR: nothing to answer";
    "The run already records mr?" -> "run_field_set {runDb, key: mr, value: <MR or PR url>, stage}" [label="no"];
    "The run already records mr?" -> "The run already records branch?" [label="yes: keep it"];
    "run_field_set {runDb, key: mr, value: <MR or PR url>, stage}" -> "The run already records branch?";
    "The run already records branch?" -> "run_field_set {runDb, key: branch, value: <source branch>, stage}" [label="no"];
    "The run already records branch?" -> "Executing a caller-handed {plan}?" [label="yes: keep it"];
    "run_field_set {runDb, key: branch, value: <source branch>, stage}" -> "Executing a caller-handed {plan}?";
    "Executing a caller-handed {plan}?" -> "Where are the handed plan's threads?" [label="yes, not yet spent: never re-adjudicate"];
    "Executing a caller-handed {plan}?" -> "Forge for the thread read?" [label="no, or spent by a revise"];
    "Executing a caller-handed {plan}?" -> "run_field_get {runDb, key: extra.gate-source.respond-plan}" [label="spent: the run records it"];
    "Where are the handed plan's threads?" -> "run_field_get {runDb, key: extra.gate-source.respond-plan} for the handed plan" [label="in this conversation: read nothing"];
    "Where are the handed plan's threads?" -> "mr_threads {mrUrl} for the handed plan's threads" [label="not in this conversation: GitLab"];
    "Where are the handed plan's threads?" -> "Read the handed plan's threads on GitHub with gh" [label="not in this conversation: GitHub"];
    "mr_threads {mrUrl} for the handed plan's threads" -> "Keep exactly the threads the handed plan names" [label="threads, resolved ones included"];
    "mr_threads {mrUrl} for the handed plan's threads" -> "Failed or abandoned: is the run this verb's own?" [label="an error: fail, quoting it"];
    "Read the handed plan's threads on GitHub with gh" -> "Keep exactly the threads the handed plan names";
    "Keep exactly the threads the handed plan names" -> "run_field_get {runDb, key: extra.gate-source.respond-plan} for the handed plan";
    "run_field_get {runDb, key: extra.gate-source.respond-plan} for the handed plan" -> "The run stores a respond-plan source for the handed plan?";
    "The run stores a respond-plan source for the handed plan?" -> "gate_record {runDb, stage, scope: respond-plan, shape: respond-plan, gateId | answers + decidedBy, contextDropped?}" [label="yes: record it"];
    "The run stores a respond-plan source for the handed plan?" -> "Build the open" [label="no: build it from the handed --report"];
    "Forge for the thread read?" -> "mr_threads {mrUrl, filter: \"unresolved-human\"}" [label="GitLab"];
    "Forge for the thread read?" -> "Read the PR's review threads with gh" [label="GitHub"];
    "mr_threads {mrUrl, filter: \"unresolved-human\"}" -> "Any unresolved human threads?" [label="threads: already filtered"];
    "mr_threads {mrUrl, filter: \"unresolved-human\"}" -> "Failed or abandoned: is the run this verb's own?" [label="an error: fail, quoting it"];
    "Read the PR's review threads with gh" -> "Keep only unresolved human threads (GitHub)";
    "Keep only unresolved human threads (GitHub)" -> "Any unresolved human threads?";
    "Any unresolved human threads?" -> "Dispatch one fresh-context adjudicator over all the review threads" [label="yes"];
    "Any unresolved human threads?" -> "Report the outcome" [label="none: say so"];

    "Dispatch one fresh-context adjudicator over all the review threads" -> "Draft the verdict table and one reply per thread";
    "Draft the verdict table and one reply per thread" -> "Build the open";
    "Build the open" -> "Caller owns the receive-review gates at respond-plan?";
    "Caller owns the receive-review gates at respond-plan?" -> "gate_open {kind: respond-plan, sourcePath: <dir>/respond-plan.source.json, handBack: true, outPath: <dir>/respond-plan.open.json, runDb, stage, scope: respond-plan}" [label="yes, no unspent plan handed: a board wrapper said so"];
    "Caller owns the receive-review gates at respond-plan?" -> "gate_open {kind: respond-plan, sourcePath: <dir>/respond-plan.source.json, runDb, stage, scope: respond-plan}" [label="no: a direct run"];
    "Caller owns the receive-review gates at respond-plan?" -> "gate_open {kind: respond-plan, sourcePath: <dir>/respond-plan.source.json, handBack: true, outPath: <dir>/respond-plan.open.json, runDb, stage, scope: respond-plan}" [label="an unspent handed plan: store its source"];
    "gate_open {kind: respond-plan, sourcePath: <dir>/respond-plan.source.json, runDb, stage, scope: respond-plan}" -> "respond-plan gate_open result?";
    "gate_open {kind: respond-plan, sourcePath: <dir>/respond-plan.source.json, handBack: true, outPath: <dir>/respond-plan.open.json, runDb, stage, scope: respond-plan}" -> "respond-plan gate_open result?";
    "respond-plan gate_open result?" -> "Gate respond-plan: carry the opened gate through gate-protocol" [label="opened: the direct run"];
    "respond-plan gate_open result?" -> "Write the receive-review-run line into the handed --report" [label="handed back, no unspent plan"];
    "respond-plan gate_open result?" -> "gate_record {runDb, stage, scope: respond-plan, shape: respond-plan, gateId | answers + decidedBy, contextDropped?}" [label="handed back, an unspent handed plan: record it"];
    "respond-plan gate_open result?" -> "run_budget {runDb, key: respond-plan-open, limit: 3, stage}" [label="refused: a line names a source field"];
    "respond-plan gate_open result?" -> "Off-script gate: the respond-plan open will not fit" [label="refused: nothing a source fix can mend"];
    "respond-plan gate_open result?" -> "STOP: fit the respond-plan open only with gate_open" [label="tempted to edit the open by hand, shorten a reply, or fit it with a script"];
    "STOP: fit the respond-plan open only with gate_open" -> "Off-script gate: the respond-plan open will not fit";
    "run_budget {runDb, key: respond-plan-open, limit: 3, stage}" -> "respond-plan-open spent?";
    "respond-plan-open spent?" -> "Fix the respond-plan source the gate_open refusal names" [label="no"];
    "respond-plan-open spent?" -> "Off-script gate: the respond-plan open will not fit" [label="yes"];
    "Fix the respond-plan source the gate_open refusal names" -> "Caller owns the receive-review gates at respond-plan?";
    "Off-script gate: the respond-plan open will not fit" -> "respond-plan fit answer?";
    "respond-plan fit answer?" -> "Fix the respond-plan source the gate_open refusal names" [label="take: the proposed change, once"];
    "respond-plan fit answer?" -> "Fix the respond-plan source the gate_open refusal names" [label="iterate: fix again with their note"];
    "respond-plan fit answer?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="hold"];
    "respond-plan fit answer?" -> "Failed or abandoned: is the run this verb's own?" [label="hand back"];
    "Write the receive-review-run line into the handed --report" -> "Hand back the verdict table and the respond-plan open's path";
    "Hand back the verdict table and the respond-plan open's path" -> "gate_record {runDb, stage, scope: respond-plan, shape: respond-plan, gateId | answers + decidedBy, contextDropped?}" [label="caller hands {plan} back: answers + decidedBy"];
    "Gate respond-plan: carry the opened gate through gate-protocol" -> "respond-plan pane next answer?";
    "respond-plan pane next answer?" -> "gate_record {runDb, stage, scope: respond-plan, shape: respond-plan, gateId | answers + decidedBy, contextDropped?}" [label="continue, or answered off the pane: gateId"];
    "respond-plan pane next answer?" -> "Redraft the replies with the respond-plan note" [label="iterate here: answer nothing, record nothing"];
    "respond-plan pane next answer?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="hold: answer nothing, the gate stays open"];
    "Redraft the replies with the respond-plan note" -> "Build the open" [label="a new gate"];
    "gate_record {runDb, stage, scope: respond-plan, shape: respond-plan, gateId | answers + decidedBy, contextDropped?}" -> "Rewrite the receive-review report rows" [label="its rows"];
    "Rewrite the receive-review report rows" -> "code-changes answer?";
    "code-changes answer?" -> "Next report row, in verdict-table order?" [label="approve, or skip"];
    "code-changes answer?" -> "Dispatch one fresh-context adjudicator over all the review threads" [label="revise: a fresh dispatch; a handed plan is spent"];

    "Next report row, in verdict-table order?" -> "Implement the thread's fix" [label="fix, code-changes approve, not yet on the branch"];
    "Next report row, in verdict-table order?" -> "Commit the fix and finalize its Fixed reply" [label="fix already committed on the branch"];
    "Next report row, in verdict-table order?" -> "Redraft the override's reply" [label="override"];
    "Next report row, in verdict-table order?" -> "Next report row, in verdict-table order?" [label="reply, skip, or fix under code-changes skip"];
    "Next report row, in verdict-table order?" -> "Any thread offered (a finalized fix or an override)?" [label="rows done"];
    "Implement the thread's fix" -> "Run the project's tests and checks on the fix";
    "Run the project's tests and checks on the fix" -> "Fix checks pass?";
    "Fix checks pass?" -> "Commit the fix and finalize its Fixed reply" [label="yes"];
    "Fix checks pass?" -> "run_budget {runDb, key: fix:<threadId>, limit: 3, stage}" [label="no: charge the failed attempt"];
    "run_budget {runDb, key: fix:<threadId>, limit: 3, stage}" -> "fix:<threadId> spent?";
    "fix:<threadId> spent?" -> "Implement the thread's fix" [label="no: another attempt"];
    "fix:<threadId> spent?" -> "Off-script gate: the thread's fix did not converge" [label="yes"];
    "Off-script gate: the thread's fix did not converge" -> "Unconverged fix answer?";
    "Unconverged fix answer?" -> "Make the recorded move once for the unconverged fix" [label="take"];
    "Unconverged fix answer?" -> "Implement the thread's fix" [label="iterate: try again with their note"];
    "Unconverged fix answer?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="hold"];
    "Unconverged fix answer?" -> "Failed or abandoned: is the run this verb's own?" [label="hand back"];
    "Make the recorded move once for the unconverged fix" -> "Next report row, in verdict-table order?";
    "Commit the fix and finalize its Fixed reply" -> "Next report row, in verdict-table order?";
    "Redraft the override's reply" -> "Next report row, in verdict-table order?";

    "Any thread offered (a finalized fix or an override)?" -> "Forge for the post side?" [label="no: no respond-post gate, no record"];
    "Any thread offered (a finalized fix or an override)?" -> "Build the respond-post open" [label="yes"];
    "Build the respond-post open" -> "Caller owns the receive-review gates at respond-post?";
    "Caller owns the receive-review gates at respond-post?" -> "gate_open {kind: respond-post, sourcePath: <dir>/respond-post.source.json, handBack: true, outPath: <dir>/respond-post.open.json, runDb, stage, scope: respond-post}" [label="yes, no post handed yet: a board wrapper said so"];
    "Caller owns the receive-review gates at respond-post?" -> "gate_open {kind: respond-post, sourcePath: <dir>/respond-post.source.json, runDb, stage, scope: respond-post}" [label="no: a direct run"];
    "Caller owns the receive-review gates at respond-post?" -> "gate_open {kind: respond-post, sourcePath: <dir>/respond-post.source.json, handBack: true, outPath: <dir>/respond-post.open.json, runDb, stage, scope: respond-post}" [label="post already handed: store its source"];
    "gate_open {kind: respond-post, sourcePath: <dir>/respond-post.source.json, runDb, stage, scope: respond-post}" -> "respond-post gate_open result?";
    "gate_open {kind: respond-post, sourcePath: <dir>/respond-post.source.json, handBack: true, outPath: <dir>/respond-post.open.json, runDb, stage, scope: respond-post}" -> "respond-post gate_open result?";
    "respond-post gate_open result?" -> "Gate respond-post: carry the opened gate through gate-protocol" [label="opened: the direct run"];
    "respond-post gate_open result?" -> "Write the run line before the respond-post hand-back" [label="handed back, no post handed yet"];
    "respond-post gate_open result?" -> "gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy}" [label="handed back, post already handed: record it"];
    "respond-post gate_open result?" -> "run_budget {runDb, key: respond-post-open, limit: 3, stage}" [label="refused: a line names a source field"];
    "respond-post gate_open result?" -> "Off-script gate: the respond-post open will not fit" [label="refused: nothing a source fix can mend"];
    "respond-post gate_open result?" -> "STOP: fit the respond-post open only with gate_open" [label="tempted to edit the open by hand, shorten a reply, or fit it with a script"];
    "STOP: fit the respond-post open only with gate_open" -> "Off-script gate: the respond-post open will not fit";
    "run_budget {runDb, key: respond-post-open, limit: 3, stage}" -> "respond-post-open spent?";
    "respond-post-open spent?" -> "Fix the respond-post source the gate_open refusal names" [label="no"];
    "respond-post-open spent?" -> "Off-script gate: the respond-post open will not fit" [label="yes"];
    "Fix the respond-post source the gate_open refusal names" -> "Caller owns the receive-review gates at respond-post?";
    "Off-script gate: the respond-post open will not fit" -> "respond-post fit answer?";
    "respond-post fit answer?" -> "Fix the respond-post source the gate_open refusal names" [label="take: the proposed change, once"];
    "respond-post fit answer?" -> "Fix the respond-post source the gate_open refusal names" [label="iterate: fix again with their note"];
    "respond-post fit answer?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="hold"];
    "respond-post fit answer?" -> "Failed or abandoned: is the run this verb's own?" [label="hand back"];
    "Write the run line before the respond-post hand-back" -> "Hand back the offered replies and the respond-post open's path";
    "Hand back the offered replies and the respond-post open's path" -> "gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy}" [label="caller hands {post} back: answers + decidedBy"];
    "Gate respond-post: carry the opened gate through gate-protocol" -> "respond-post next answer?";
    "respond-post next answer?" -> "gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy}" [label="proceed, in the pane or off it: gateId"];
    "respond-post next answer?" -> "Decide nothing at respond-post: no push, post, resolve or record" [label="hold: answer the gate (next: hold), record nothing"];
    "respond-post next answer?" -> "Apply the respond-post note" [label="iterate: answer the gate (next: iterate), record nothing"];
    "Decide nothing at respond-post: no push, post, resolve or record" -> "run_hold {runDb, stage, reason, decidedBy}";
    "Apply the respond-post note" -> "Build the respond-post open" [label="a new gate"];
    "gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy}" -> "Forge for the post side?";

    "Forge for the post side?" -> "respond_post_execute {runDb, tree, stage}" [label="GitLab"];
    "Forge for the post side?" -> "Posted already on GitHub: read every thread with gh" [label="GitHub: never respond_post_execute or an mr_ tool"];
    "respond_post_execute {runDb, tree, stage}" -> "respond_post_execute result?";
    "respond_post_execute result?" -> "run_field_set {runDb, key: hold, value: -, stage}" [label="held is empty"];
    "respond_post_execute result?" -> "Off-script gate: the forge refused a reply or resolve" [label="a reply or resolve held"];
    "respond_post_execute result?" -> "Report the held threads verbatim" [label="only push, mismatch or read held"];
    "respond_post_execute result?" -> "run_budget {runDb, key: post-execute-fix, limit: 2, stage}" [label="refused: a line names a field, a record or the tree"];
    "respond_post_execute result?" -> "Off-script gate: respond_post_execute refused" [label="refused: nothing a fix on this run can mend"];
    "respond_post_execute result?" -> "STOP: respond_post_execute pushes the fix; never push from the shell, never force" [label="tempted to push from the shell or force"];
    "respond_post_execute result?" -> "STOP: post replies only through respond_post_execute" [label="tempted to reply or resolve by hand"];
    "STOP: respond_post_execute pushes the fix; never push from the shell, never force" -> "Report the held threads verbatim";
    "STOP: post replies only through respond_post_execute" -> "Off-script gate: the forge refused a reply or resolve";
    "run_budget {runDb, key: post-execute-fix, limit: 2, stage}" -> "post-execute-fix spent?";
    "post-execute-fix spent?" -> "Fix what the respond_post_execute refusal names" [label="no"];
    "post-execute-fix spent?" -> "Off-script gate: respond_post_execute refused" [label="yes"];
    "Fix what the respond_post_execute refusal names" -> "respond_post_execute {runDb, tree, stage}";
    "Off-script gate: respond_post_execute refused" -> "respond_post_execute refusal answer?";
    "respond_post_execute refusal answer?" -> "Fix what the respond_post_execute refusal names" [label="take: the proposed move, once"];
    "respond_post_execute refusal answer?" -> "Fix what the respond_post_execute refusal names" [label="iterate: fix again with their note"];
    "respond_post_execute refusal answer?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="hold"];
    "respond_post_execute refusal answer?" -> "Failed or abandoned: is the run this verb's own?" [label="hand back"];
    "Off-script gate: the forge refused a reply or resolve" -> "Forge refusal answer?";
    "Forge refusal answer?" -> "respond_post_execute {runDb, tree, stage}" [label="take: the human posted or resolved by hand"];
    "Forge refusal answer?" -> "respond_post_execute {runDb, tree, stage}" [label="iterate: the cause is fixed"];
    "Forge refusal answer?" -> "Report the held threads verbatim" [label="hold: the tool already set hold"];
    "Forge refusal answer?" -> "Failed or abandoned: is the run this verb's own?" [label="hand back"];
    "Report the held threads verbatim" -> "Threads held: run left open for a resume";
    "run_field_set {runDb, key: hold, value: -, stage}" -> "Report the outcome";

    "Posted already on GitHub: read every thread with gh" -> "The GitHub read returned every thread due?";
    "The GitHub read returned every thread due?" -> "Picks post or resolve a gate-1: fix row?" [label="yes"];
    "The GitHub read returned every thread due?" -> "run_field_set {runDb, key: hold, value: held, stage: <stage>}" [label="no, or an error: report it verbatim"];
    "Picks post or resolve a gate-1: fix row?" -> "git branch --show-current" [label="yes"];
    "Picks post or resolve a gate-1: fix row?" -> "Next GitHub thread?" [label="no: push nothing"];
    "git branch --show-current" -> "git rev-parse --abbrev-ref @{push}";
    "git rev-parse --abbrev-ref @{push}" -> "Both name the MR's source branch?";
    "Both name the MR's source branch?" -> "git_push {tree: <worktree root>}" [label="yes"];
    "Both name the MR's source branch?" -> "Hold the picked fix rows and report the failure verbatim" [label="no, or an error"];
    "git_push {tree: <worktree root>}" -> "git_push result for the fix rows?";
    "git_push result for the fix rows?" -> "Next GitHub thread?" [label="pushed"];
    "git_push result for the fix rows?" -> "Hold the picked fix rows and report the failure verbatim" [label="any error"];
    "git_push result for the fix rows?" -> "STOP: a failed git_push holds the fix rows; never push from the shell, never force" [label="tempted to push from the shell or force"];
    "STOP: a failed git_push holds the fix rows; never push from the shell, never force" -> "Hold the picked fix rows and report the failure verbatim";
    "Hold the picked fix rows and report the failure verbatim" -> "Next GitHub thread?" [label="every other reply still acts"];
    "Next GitHub thread?" -> "Post the reply on GitHub with gh" [label="post: due (picked, or a gate-1: reply row), not held this pass, and the thread lacks this run's reply"];
    "Next GitHub thread?" -> "resolve: decided for this thread?" [label="no post due: not picked, held this pass, or already there"];
    "Next GitHub thread?" -> "Any GitHub fix row held this pass?" [label="threads done"];
    "Post the reply on GitHub with gh" -> "resolve: decided for this thread?";
    "resolve: decided for this thread?" -> "Resolve the thread on GitHub with gh" [label="yes, not held this pass"];
    "resolve: decided for this thread?" -> "Next GitHub thread?" [label="no, or held this pass"];
    "Resolve the thread on GitHub with gh" -> "Next GitHub thread?";
    "Any GitHub fix row held this pass?" -> "gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy, held}" [label="yes"];
    "Any GitHub fix row held this pass?" -> "Report the outcome" [label="no"];
    "gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy, held}" -> "run_field_set {runDb, key: hold, value: held, stage: <stage>}";
    "Report the outcome" -> "This verb started or resumed the run?";

    "This verb started or resumed the run?" -> "run_close {runDb, workType: receive-review, stage: receive-review, outcome}" [label="yes: outcome done"];
    "This verb started or resumed the run?" -> "Review feedback answered" [label="no: inherited, the caller closes"];
    "Failed or abandoned: is the run this verb's own?" -> "run_close {runDb, workType: receive-review, stage: receive-review, outcome}" [label="yes: close it failed or abandoned, with the reason"];
    "Failed or abandoned: is the run this verb's own?" -> "run_stage {action: fail, stage: <stage>, reason}" [label="no: inherited, the caller decides"];
    "run_close {runDb, workType: receive-review, stage: receive-review, outcome}" -> "receive-review closed as?";
    "receive-review closed as?" -> "Review feedback answered" [label="done"];
    "receive-review closed as?" -> "receive-review stage failed" [label="failed or abandoned"];
    "run_stage {action: fail, stage: <stage>, reason}" -> "receive-review stage failed";
    "run_hold {runDb, stage, reason, decidedBy}" -> "Held: end the turn naming the run and stage";
    "run_field_set {runDb, key: hold, value: held, stage: <stage>}" -> "Threads held: run left open for a resume";
}
```

## Run

`run_enter` starts, resumes or inherits the run, or returns the running
candidates; never list, read or build run dbs by hand. It takes `flags`
(this verb's block below, verbatim), `skillDir`
(this skill's directory), `stage: receive-review`, `runDb` only when a
caller handed one, `resume` when the caller or the developer names a run
id or a handed `--report` carries a `receive-review-run: <run id>` line
(that id, even in a pane a surface launched), and `spawnedBy` only when a
board or another surface launched this pane.

{{run-start.flags:receive-review}}

Pass the returned `runDb` to every `run_*` and gate call; nothing is
exported. `run_enter` is the first call of a pane with no run in hand: a
caller re-entering this pane after its hand-back continues at the box that
handed back, on the run the pane already holds. `<stage>` is
`receive-review` on a run you started or resumed; on an inherited run
(`mode: inherited`) it is the result's `at.stage`, and the caller closes
the run. A handed `runDb` whose run is no longer running is not inherited:
the result says `handedRunDb: "not-running"` and the run starts as if none
was handed.

Every gate passes `runDb` and `stage`, so the gate tools write the run's
gate fields; `respond-plan` and `respond-post` record only through this
verb's `gate_record`.

Each loop counter is one `run_budget {runDb, key, limit, stage}` call on
the counted failure, and its `<key> spent?` diamond reads `exhausted`. The
count lives on the run: after a compaction or resume, read a counter you
cannot remember with `increment: 0`, never restart it.

| Key | Limit | Charged when |
|---|---|---|
| `respond-plan-open` | 3 | a respond-plan `gate_open` refusal names a source field |
| `respond-post-open` | 3 | a respond-post `gate_open` refusal names a source field |
| `fix:<threadId>` | 3 | that thread's fix fails its tests and checks |
| `post-execute-fix` | 2 | a `respond_post_execute` refusal names something to fix (fixed once; the second opens the off-script gate) |

`respond_post_execute` bounds its own reply, resolve and push retries.

A Hold that ends the turn, own or inherited run, is one `run_hold {runDb,
stage, reason, decidedBy}`: `reason` the human's words or the quoted
error, `decidedBy` the answer's by. The clarify Hold comes before any run
and records nothing.

A thread hold makes no `run_hold` call: the run stays open with `hold` at
`held` (on GitLab `respond_post_execute` sets it and re-records the held
ids; on GitHub this verb does both). A resume calls the post side again,
acting only on the held threads; `run_enter` clears the field.

The close runs only when this verb started or resumed the run, once
nothing is left to post: `run_close {runDb, workType: receive-review,
stage: receive-review, outcome: done}`; a failure (a forge read error)
closes `failed`, a hand back `abandoned`, with `reason` the quoted error
or the why. On an inherited run either is `run_stage {action: fail,
stage, reason}`, and the caller decides.

`respond_post_execute` reads the run's `mr` and `branch`, so this verb
records both on any run that lacks them, inherited included. Run identity
below governs `ticket`.

{{include:run-identity}}

## Steps

### Gate clarify for receive-review: Resume / Start fresh / Hold

No run of yours exists yet, so this gate is the structured-question tool
in the pane. One sentence naming each `run_enter` candidate's
`spawnedBy`, `startedAt` and `currentStage`, then one **Resume** option
per run this pane may take (`ownSession: true`, recommended; or one no
live pane owns; a run another live pane owns is named unavailable), then
**Start fresh**, **Hold**. A surface-launched pane never reaches this
gate: with `spawnedBy` and no `resume`, `run_enter` starts fresh. Resume
passes the picked `runId` as `resume`; Start fresh passes `fresh: true`.
Hold records nothing and ends the turn.

### The refused receive-review run_enter carried resume?

A refused resume means the run is gone or no longer running: say so in one
line, then start fresh, keeping the first call's `spawnedBy`. Any other
refusal ends the verb: quote it verbatim, whole, never a paraphrase or a
guessed cause. Only when there is no `run_enter` tool at all, say rt
predates the run tools; update rt.

### What does the receive-review snapshot record?

The resumed run's decisions pick the re-entry; a question they answered is
never asked again.

- **No `respond-plan` record:** nothing is decided; go on as a fresh run.
- **`respond-plan` recorded, no `respond-post` record:** rewrite the
  report rows from the recorded decision joined to the stored cards (the
  `run_field_get` of `extra.gate-source.respond-plan`), then walk the
  rows. Never record respond-plan again: a second record moves its
  `decided_at`, which `respond_post_execute` reads for the decision's
  freshness and for which notes by this account count as already posted.
- **`respond-plan` recorded with `code-changes: revise`, no
  `respond-post` record, and the caller handed a `{plan}`:** the revise
  re-adjudicated and stored a new respond-plan source, and the handed plan
  answers that newer open. Take it through `What did the caller hand
  receive-review?` as an unspent plan: it records once against the stored
  cards. The revise record never acts (`respond_post_execute` refuses
  it), so rows rebuilt from it drop the human's newer answer.
- **The same, and the caller handed a `{post}`:** record it at once
  (`answers`, `decidedBy`), then the post side; the rows walk nothing.
- **A `respond-post` record, held or not:** the post side again, never a
  close on the record alone: a pane can record and die before it posts.
  On GitLab `respond_post_execute` counts what landed. On GitHub the gh
  read does, and the reply texts come from the stored cards, never this
  conversation: for a `gate-1: reply` row the
  respond-plan decision's `texts` entry, else its card's `reply.text`; for
  an offered thread the respond-post decision's `text`, else its `reply@1`
  card's `text` (`run_field_get {runDb, key:
  extra.gate-source.respond-post}`).

### What did the caller hand receive-review?

**Decision intake.** A caller that owns the gates hands decided answers
instead of a gate answer: `{plan}` alone (a board wrapper, after its own
first gate; `{post}` follows when respond-post offers a thread), or a
combined `{plan, post}`. Each half is that gate's raw per-question answers
(keyed by question id, option values verbatim); the caller's `by` records
as `decidedBy`. A `{plan}` asks nothing; the `post` half waits for gate
respond-post. A `{post}` alone records at once: its plan decision is on
the run, unless the pane is fresh with no run line or a refused resume,
and then `respond_post_execute`'s refusal goes to its off-script gate,
quoted. In the pane that handed the open back, the caller re-enters at
that hand-back box instead.

### Resolve the change and record its identity

The change and its requirements come from the caller or domain adapter:
the diff range, plus the requirements it is judged against. Report a fetch
failure or a mismatched pair exactly as found; never fabricate the missing
half.

On GitLab the MR is `mrUrl`, or `repoName` plus `iid`; with neither,
`mr_for_branch` with `repoName` = this checkout and `branches: [<the
checked-out branch>]` gives the iid. On GitHub it is the PR's URL. Then
record `mr` (the MR/PR URL) and `branch` (its source branch) on whatever
run this is, keeping a field the run already records (an inherited run's
`mr` above all; read an inherited run's with `run_field_get {runDb, key}`,
an unset-key error meaning not recorded). `ticket` is recorded only on a
run this verb started or resumed, per Run identity.

### Report that no open MR has this branch as its source

A null entry from `mr_for_branch`: report that no open MR has that branch
as its source, and stop. An `mr_for_branch` or `mr_threads` error is never
"no open MR" or "no threads": quote it unedited, and the stage
fails with it as the reason.

### Executing a caller-handed {plan}?

A caller-handed `{plan}` not yet spent is recorded, never re-adjudicated.
The record is `gate_record {runDb, stage,
scope: respond-plan, shape: respond-plan, answers: <the plan>, decidedBy}`,
plus `contextDropped: true` when the handed `--report` carries
`gate-1-context: dropped`. The rows come from the record; the thread read
(skipped when the threads are already in this conversation) supplies only
the bodies the fix and override rows need. The record needs the
respond-plan source on the run first: `respond_post_execute` refuses a run
without it, and a source stored after the decision makes it stale. The
plan is spent once recorded: go to the rows, never record it again; a
revise adjudicates afresh. A plan handed to a resumed run whose only
respond-plan record says `code-changes: revise` is not yet spent: that
record answered the earlier open, and this plan answers the open the
revise built.

### Read the handed plan's threads on GitHub with gh

Fetch every thread with `gh`, resolved ones included: no human-thread
filter applies to a handed plan.

### Keep exactly the threads the handed plan names

Keep every thread the plan names, resolved or not: the plan decides its
row. Capture each one's id, `file:line` and full note chain. A named
thread the forge no longer returns is held and reported. Unresolved
threads the plan does not name get no row; the outcome report names them
for the next run.

### The run stores a respond-plan source for the handed plan?

- **Yes:** record the plan against those cards.
- **No** (an unset-key error: a gate parked before this version, no run
  line, or a refused resume): build the open with no new adjudication or
  drafts, each card from the handed `--report`'s verdict table row
  (verdict, recommended action, reply) and the thread read (id,
  `file:line`, author, note chain). It has exactly the threads the plan
  names, each under the question id the plan keys it by (`thread-<n>`),
  plus `code-changes`. A thread the report has no row for gets `reply:
  {"kind": "none"}`, so its `reply:` answer without `text` records as an
  override. Store it with the hand-back `gate_open`, then record; never
  record the plan without the stored source.

### Read the PR's review threads with gh

On GitHub, fetch the threads with `gh`.

### Keep only unresolved human threads (GitHub)

On GitLab the `mr_threads` filter applies this rule: its result is the set to adjudicate, never filtered again, no
dropped thread added back. On GitHub apply it by hand: keep only
**unresolved** threads a **person** opened, dropping resolved threads,
system notes and bot authors (a username that starts `project_<n>_bot` or
`group_<n>_bot`, is `ghost`, or ends in `-bot`, `_bot` or `[bot]`).
Capture each thread's id, `file:line` and full note chain.

### Reading a GitLab fact no read tool returns

A GitLab fact the read tools do not return is read with `gitlab_get
{repoName, path}`: `repoName` = the checkout or tree this verb targets,
`path` relative to the API root with `:id` for this project (for example
`projects/:id/merge_requests/<iid>/versions`). It opens no gate. Quote a
GitLab error as written; its refusal of a credential path is final.

### Dispatch one fresh-context adjudicator over all the review threads

<HARD-GATE>
Do not judge the reviewer's comments in this session. You (helped) write this
code; reading the diff here re-derives the same assumptions and nods at them,
and reading harder buys confidence, not independence. A ruling formed here IS
the verdict whatever it is labeled, including "the reviewer clearly has a
point, I'll just add the guard."

**REQUIRED SUB-FLOW:** the review dispatch flow below, adjudicator shape,
ONE dispatch covering ALL the threads. Running a
self-review as an afterthought at the end does not satisfy this: the fresh context is how the
comments are adjudicated, not a final gut-check.
</HARD-GATE>

Hand the dispatch flow (below, after the Off-script gate section) the
numbered threads (`file:line` plus note chains), the requirements and the
diff range; it owns the template, the subagent and the standard blocks.

### Draft the verdict table and one reply per thread

Present the verdict table, a drafted reply per thread, then the
recommendation, in one structured block (the verdict report); nothing is
written to code or posted yet. Bucket each thread by verdict (`valid` /
`pushback` / `needs-clarification`) and recommended action (`fix` /
`reply` / `skip`); gate respond-plan reads this bucketing.

**Reply content is a seam.** **No Reply rules section below** (the slot is
unbound): **REQUIRED SUB-SKILL** `superpowers:receiving-code-review`. **A
Reply rules section below**: follow it. Compose in the voice the Writing
style section below names. On top of either branch:

- **Per verdict.** `valid` -> a technical acknowledgment of the fix.
  `pushback` -> the technical reason, referencing the code or test that
  shows it. `needs-clarification` -> one crisp question.
- **An ask is an ask.** A reply that asks the reviewer anything is
  `needs-clarification`, not a `pushback` ending in a question: when the
  answer would change the ruling, the question is the ruling.
- **No performative openers.** A reply states the technical content. An
  opener acknowledging the comment's quality or offering thanks carries
  none: "Good call", "You're right", "Great catch", "Nice find", "Thanks"
  -- and every variant, "Confirmed, thanks." included. Open on what the
  code does or what changes.

### Build the open

The verb adjudicates; it never decides what gets fixed or posted. A
handed `{plan}` not yet spent reaches this step only to store its source;
every other path, a revise after a spent plan included, builds the open
from the verdict report.

The gate (`respond-plan`, gate 1; `respond-post` is gate 2) carries
structured context per gate-protocol's
`## Structured context (gate-ctx@1)` and its sidecar
`structured-context.txt`. Make one scratch
directory, `<dir>`, inside this session's scratchpad (the Claude Code temp
root, the only place `gate_open` reads `sourcePath` and writes `outPath`),
never `mktemp -d`, and spell its path out literally from then on. Write
`<dir>/respond-plan.source.json`:

```json
{"context": {"gate-ctx": "plan@1", "reviewer": "<primary reviewer>",
             "threads": {"total": 2, "blocking": 1},
             "adjudication": "<tally> · fresh-context adjudicated"},
 "questions": [
   {"id": "thread-1", "label": "<file>:<line>", "multi": false,
    "context": {"gate-ctx": "thread@1", "author": "<reviewer>", "severity": "<severity>",
                "claim": {"summary": "<the ask>", "points": ["<one specific>"]},
                "verdict": {"call": "<verdict word>", "note": "<its reason>"},
                "reply": {"kind": "<kind>", "text": "<drafted reply>"}},
    "options": [{"value": "reply:<threadId>", "label": "reply", "description": "reply only; no code change"},
                {"value": "fix:<threadId>", "label": "fix", "recommended": true, "description": "<the planned change and where>"},
                {"value": "skip:<threadId>", "label": "skip", "description": "no reply, no code change"}]},
   {"id": "thread-2", "...": "the next thread in the same shape, its own id verbatim"},
   {"id": "code-changes", "label": "Approve the proposed code changes?", "multi": false,
    "options": ["approve", "revise", "skip"]}
 ]}
```

ONE single-select question per unresolved thread, in verdict-table order,
plus `code-changes`. A thread question's id is `thread-<n>` by 1-based
position, its label the thread's `file:line`, its options that thread's
verb triple with the thread id VERBATIM in the value and the bare
lowercase verb as the label. The member matching the recommended action
carries `"recommended": true`: that is how the recommendation reaches the
gate.

| Field | Filled from |
|---|---|
| `reviewer` | one name: the author with the most unresolved threads, ties to the first to appear; any other reviewer shows on their own threads' `author` |
| `threads` | `total`: the thread-question count; `blocking`: how many threads carry severity `blocking` |
| `adjudication` | `all valid` when every verdict is `valid`, else `<count> <verdict>` per verdict word in first-appearance order, comma-joined; then ` · fresh-context adjudicated` |
| `round` | only when the caller supplies it; otherwise omit the key |
| `author` | the author of the thread's opening note |
| `severity` | the reviewer's own words, never the verdict: an explicit softener (nit, optional, non-blocking, minor, suggestion) is `non-blocking`; a question that asks for no change is `question`; a thread with no ask (a summary, an FYI) is `none`; any other change request is `blocking` |
| `claim` | `summary`: the reviewer's ask in one or two sentences, their wording where it fits; `points`: their supporting specifics, one per string, the key omitted when there are none |
| `verdict` | `call`: the adjudicator's verdict word verbatim; `note`: its one-line reason (the warranted change, the pushback reason, or the question to ask) |
| `reply` | by the recommended action: `reply` is `verbatim` with the drafted reply as `text`; `fix` is `direction` with the drafted reply (it finalizes at Commit the fix and finalize its Fixed reply); `skip` is `{"kind": "none"}` |
| `fix` option `description` | the planned change and where, from the adjudicator's `valid` entry; a thread with no such entry gets `implement the reviewer's ask as written` |

Never shorten a reply to make an open fit: `gate_open` fits it, and a
context it cannot fit is dropped loudly (`contextDropped`).

### respond-plan gate_open result?

- **Opened** (the direct run): keep `id`, `paneAction`, `formContext`,
  `formChunks` and `contextDropped`. The run stores the untrimmed source
  as `extra.gate-source.respond-plan`, the cards `gate_record` and a
  resumed pane read.
- **Handed back, no unspent plan:** the open is at `outPath` in
  `gate-ctx.sh fit`'s shape, its source beside it, and the run stores the
  source. Keep `contextDropped` and `droppedContexts`.
- **Handed back, an unspent handed plan:** the source is stored (`gate:
  null`) and nothing goes to the caller. Record the plan, with
  `contextDropped: true` when this result or the handed `--report` says
  so.
- **Refused:** nothing opened, one problem per line. A line naming a
  question or a source field is fixable; a refusal no source fix can mend
  (an unreadable file, a path outside the read roots) goes straight to the
  off-script gate.

Only `gate_open` fits the open: a hand-edited open, a shortened reply or a
fit with the vendored script is this diamond's STOP.

### Fix the respond-plan source the gate_open refusal names

Fix exactly the question and field each refusal line names in
`<dir>/respond-plan.source.json`, never by shortening a reply, then open
again through `Caller owns the receive-review gates at respond-plan?`. A
take makes the recorded move once, then opens again.

### Off-script gate: the respond-plan open will not fit

Quote the last refusal's lines as the `context`. Propose, spelled in full,
one source change for the fields it named, never a shortened reply or a
hand-edited open.

### Write the receive-review-run line into the handed --report

Before the hand-back, write one line `receive-review-run: <run id>`
(`run_enter`'s `runId`) into the handed `--report`, replacing any earlier
one; with no `--report`, write nothing. A fresh pane the board later hands
a decision to passes that id as `resume` and lands on this run, which
holds the stored gate source. The board never reads the line.

### Hand back the verdict table and the respond-plan open's path

**A caller that owns the gates** (a board wrapper says so when it
delegates): open nothing in the pane. Hand back the verdict table plus the absolute
paths of `<dir>/respond-plan.open.json` (its source beside it as
`respond-plan.source.json`) and of this skill's vendored
`${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh`, which the caller runs in `prose`
mode on that source; the caller opens its gate from the open file's
`.questions` and `.context`, then hands `{plan}` back. When the result says
`contextDropped` or lists `droppedContexts`, say so: the caller writes
`gate-1-context: dropped` into its own report.

The caller's `{plan}` comes back to this pane, in the same conversation:
the re-entry goes on from this box with the `runDb` already in hand, and
its first call is the record, `gate_record {runDb, stage, scope:
respond-plan, shape: respond-plan, answers: <the plan>, decidedBy}`, with
`contextDropped: true` when the open's result or the saved report says
so. A fresh pane, with no hand-back in its conversation,
starts at the trigger and resumes through the run line.

### Gate respond-plan: carry the opened gate through gate-protocol

**Otherwise** (a direct terminal run) the verb runs the gate itself: enter
gate-protocol at `Trigger: a site opened its gate with gate_open` with the
result and walk on from `paneAction?`; a gate is never asked or answered
from the shell.

When the result says `contextDropped: true`, first write one line,
`gate-1-context: dropped`, into the saved verdict report (when there is
one), before presenting or waiting: a resumed pane has no other way to
know those cards never showed their drafts. The record then passes
`contextDropped: true`.

- **form:** `### Present the in-pane gate form`, holding `code-changes`
  back from the chunks. Then one last call: `code-changes`, only when some
  thread answered `fix:` (otherwise submit its sentinel `skip` unasked),
  plus a pane-only `next` question of **Continue** / **Iterate here** /
  **Hold**. That `next` never reaches the registry, and Iterate / Hold are
  never extra options on a thread or code-changes question.
  - **Continue:** ONE `gate_answer {id, answers, runDb?, stage?}` after
    that last call, carrying every thread answer plus `code-changes`. A
    replacement reply typed in the free-text field rides as `note`.
  - **Iterate here** or **Hold:** answer nothing. Hold leaves the gate
    open for another surface.
- **wait:** as gate-protocol draws it; an answer from the board or
  console carries no `next`: it is the `answered off the pane` edge.

Neither `gate_answer` nor `gate_reconcile` records this review gate:
`gate_record {..., gateId: <id>}` does. Never fold threads into one
multi-select: one question per thread stays under the form cap.
`fix:<threadId>` implies that thread's reply, `skip:<threadId>` means
neither.

### Redraft the replies with the respond-plan note

Redraft the replies the note asks about, per the reply rules, into the
verdict report, then build the open again: a NEW gate, never a second
answer to the one just closed.

### Rewrite the receive-review report rows

**Report rows.** Once gate 1 is recorded, rewrite each thread's row of the
verdict report (the saved report file too, when there is one), in
verdict-table order:

```text
- <threadId> · <file>:<line> · <verdict>, recommended <action> · gate-1: <reply|fix|skip|override> · reply: "<text>"
```

After `gate_record`, write one row per entry of its `rows`, in order, from
the entry's `threadId`, `file`, `verdict`, `recommended`, `gate1` and
`reply`. Never work them out yourself: the tool applies the override rule,
the edited replies and the notes.

On a resume there is no `rows` result: join the record to the stored card
for each thread (`extra.gate-source.respond-plan`, the question whose
option values carry that thread id): `file` is the card's label, `verdict`
its context's `verdict.call`, `recommended` its recommended option's verb;
`gate-1` is `override` for every thread under the record's `overrides`,
else that thread's `threads` verb; `reply` is its `texts` entry, else the
card's `reply.text`, else `none`. With no stored card the card's fields
read `unknown`, and a `reply` row whose reply would be `none` is an
override.

**An override** row's reply was never seen word for word (its card showed
a direction or no reply, its answer carried a note, or its context never
reached the gate). It is redrafted (folding in the record's `notes` entry)
and offered at gate 2 beside the finalized fixes, never posted from gate
1.

Every later posting, a resumed pane's included, reads these rows, never
the recommendation: a `gate-1: reply` row posts its row's reply; an
`override` row, and a `fix` row whose Fixed reply was finalized, are
offered at gate 2; a `skip` row, and a `fix` row under `code-changes:
skip`, post nothing.

`code-changes: revise` re-adjudicates with a fresh dispatch and their
note, never in this session (the bias HARD-GATE still applies); a handed
plan is single-use, so the revised verdicts get a new respond-plan open.
`code-changes: skip` implements nothing; the row loop still redrafts
overrides.

### Implement the thread's fix

Nothing is implemented until `code-changes: approve`: not "in a
follow-up commit", not while drafting. Implement the `fix:<threadId>`
threads one at a time. A fix whose commit is already on the branch (its
row carries `sha`, or the branch log shows it) is never implemented
again.

### Run the project's tests and checks on the fix

Verify this thread's fix before the next thread starts. Domain ship-time
gates still apply to these fixes; this skill never checks their box. Each
failed run charges `fix:<threadId>`.

### Off-script gate: the thread's fix did not converge

Quote the last failing test or check output as the `context`. Propose:
revert this thread's uncommitted attempt and leave the row unimplemented,
so no Fixed reply is offered and the row posts nothing.

### Make the recorded move once for the unconverged fix

Revert this thread's uncommitted attempt, exactly once, and leave its row
unimplemented, then go on to the next row.

### Commit the fix and finalize its Fixed reply

Commit the fix. Finalize its reply to "Fixed -- `file:line` / what
changed" and write it over the draft in the thread's row, with ` · sha:
<short sha>` before its `reply` field; the posted reply is the Fixed text
alone, never the sha. A fix already committed on the branch commits
nothing again: its Fixed reply and `sha` come from that commit.

### Redraft the override's reply

Redraft it now per the reply rules, as a reply with no code change,
folding in its answer's note when it has one, and write it into its row.

### Build the respond-post open

This gate offers exactly the replies the developer has not yet seen word
for word: every `gate-1: override` row, and every `gate-1: fix` row whose
Fixed reply was finalized. A `gate-1: reply` row is never offered: it
posts its row's reply, unresolved, once the post side runs. With nothing
offered there is no respond-post gate and no record; a caller that owns
the gates gets no open file, only that nothing is offered and which
replies posted.

<HARD-GATE>
Decision intake: when a combined `{plan, post}` already carries `post`,
ask nothing, but still build and store the open with the hand-back
`gate_open`, then record the `post`: `respond_post_execute` refuses every
pass without `extra.gate-source.respond-post` on the run.

**Build the open** in Build the open's scratch directory (a pane that made
none makes a new one the same way, never `mktemp -d`), as
`<dir>/respond-post.source.json`:

```json
{"context": {"gate-ctx": "post@1", "reviewer": "<as in Build the open>", "replies": 2,
             "fixes": [{"sha": "<short sha>"}]},
 "questions": [
   {"id": "thread-1", "label": "<file>:<line>", "multi": true,
    "context": {"gate-ctx": "reply@1", "thread": "<threadId>", "file": "<file>:<line>", "verb": "fix", "sha": "<short sha>", "text": "<the exact finalized reply>"},
    "options": [{"value": "post:<threadId>", "label": "post", "recommended": true, "description": "post this reply to the thread"},
                {"value": "resolve:<threadId>", "label": "resolve", "recommended": true, "description": "resolve the thread"}]},
   {"id": "thread-2", "...": "the next offered thread, its own id verbatim: a fix in this shape, or an override with verb reply, no sha, resolve not recommended"},
   {"id": "next", "label": "Next", "multi": false,
    "options": [{"value": "proceed", "label": "proceed", "recommended": true}, "iterate", "hold"]}
 ]}
```

ONE multi-select question per offered thread, in verdict-table order,
plus `next`. Its id is `thread-<n>` by 1-based position among the offered
threads, its label the thread's `file:line`, its options exactly
`post:<threadId>` and `resolve:<threadId>`, thread id VERBATIM, bare verb
as the label.

| Field | Filled from |
|---|---|
| `post` option | `"recommended": true` on every thread, so nothing drops silently |
| `resolve` option | `"recommended": true` only on a fixed thread; an override stays open for the reviewer unless the developer ticks it |
| `reply@1` context | that one thread: `verb` `fix` with its commit's short `sha` for a fixed thread (a fix with no commit carries no `sha`), `verb` `reply` with no `sha` for an override; `text` the exact reply from its row, never shortened |
| gate `replies` | the offered-thread count |
| gate `fixes` | one entry per commit the fix loop made, the key omitted when there are none |

Post and resolve are independent picks: both, post only, resolve without
replying, or neither (an explicit empty array). Nothing here is trimmable:
`gate_open` fits the open.
</HARD-GATE>

### respond-post gate_open result?

As `respond-plan gate_open result?`, with the source stored as
`extra.gate-source.respond-post`, which `respond_post_execute` checks
every decision against. Handed back for a combined `{plan, post}`: the
source is stored (`gate: null`); record the handed `post` (`answers`,
`decidedBy`). The same STOP holds.

### Fix the respond-post source the gate_open refusal names

As for respond-plan, in `<dir>/respond-post.source.json`, then open again
through `Caller owns the receive-review gates at respond-post?`. A take
makes the recorded move once, then opens again.

### Off-script gate: the respond-post open will not fit

As the respond-plan one: the last refusal's lines quoted, one source
change proposed in full, never a shortened reply or a hand-edited open.

### Write the run line before the respond-post hand-back

The same run line, into the handed `--report`, replacing any earlier
one; with no `--report`, write nothing. A fresh pane the board later hands
the `{post}` to resumes this run, where the plan decision and both gate
sources sit.

### Hand back the offered replies and the respond-post open's path

**A caller that owns the gates**: open nothing in the pane. Hand back the
offered replies plus the absolute paths of `<dir>/respond-post.open.json`
(its source beside it as `respond-post.source.json`) and of this skill's
vendored `${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh`, then wait for its
`{post}` (its `.questions` end with `next`, which a caller with its own
navigation drops). The `{post}` records first, then the post side acts;
hand back which replies posted.

### Gate respond-post: carry the opened gate through gate-protocol

**Otherwise** the verb runs the gate itself, entering gate-protocol at
`Trigger: a site opened its gate with gate_open` and walking on from
`paneAction?`; a gate is never asked or answered from the shell.

- **form:** `### Present the in-pane gate form`. Here `next` is a question
  of the open itself (**Proceed**, recommended / **Iterate here** /
  **Hold**), so it rides in the chunks; never fold it into a thread
  question. Then ONE `gate_answer {id, answers, runDb?, stage?}` carrying
  every thread answer plus `next`. The pane's answer never carries `text`:
  whatever the human types, a full replacement reply included, rides as
  `note`, and the drafted reply posts.
- **wait:** as gate-protocol draws it; an answer from the board or console
  carries the open's `next` and routes the same way.

A paragraph that lists the replies and waits is not this gate. Neither
`gate_answer` nor `gate_reconcile` records it: `gate_record {..., gateId:
<id>}` does, before the post side, only on a `next` of `proceed`
(`respond_post_execute` refuses any other), and builds the selection
itself.

### Decide nothing at respond-post: no push, post, resolve or record

A `hold` or `iterate` answer decides nothing, whatever its thread picks
say: nothing pushes, posts or resolves, and no respond-post decision is
recorded (no `gate_record`, no `respond_post_execute`), so every offered
thread stays pending and the `gate-1: reply` rows keep waiting. The gate
is still answered with its `next` (one `gate_answer`, unlike respond-plan's
pane-only `next`), so it closes. A `hold` ends the turn through
`run_hold`; that is not a respond-post decision.

### Apply the respond-post note

Redraft what the note asks (an override's reply, per the reply rules)
into its row, then build the open again: a NEW gate with its own id, whose
proceed records with that newest `gateId`. A record against the earlier
gate is stale and refused.

### respond_post_execute {runDb, tree, stage}

GitLab's whole post side is this one call, `tree` = this checkout's root
(where the fixes were committed, registered with rt as `git_push` needs).
It checks both decisions against their gate sources, pushes only when a
picked thread is a fix row, posts each picked reply and every `gate-1:
reply` row, resolves the picked threads, and counts what already landed
(`alreadyPosted`, `alreadyResolved`). It is idempotent, so a resume, a
take and an iterate all call it again.

### respond_post_execute result?

- **Refused** (nothing moved): a line naming a field, a record or the tree
  is fixable once; a refusal nothing on this run can mend (no respond-plan
  decision or gate source, a handed `{post}` in a fresh run) goes straight
  to its off-script gate, quoted.
- **`held` empty:** every due reply and resolve is done; clear `hold`,
  which an earlier pass or the tool may have set and the tool never
  clears.
- **A `reply` or `resolve` entry in `held`:** one off-script gate for the
  batch.
- **Only `push`, `mismatch` or `read` entries:** report them.

### Fix what the respond_post_execute refusal names

Fix exactly what the refusal names with a move this graph already draws
(the registered `tree` for a tree mismatch; a respond-post record for a
scope the run has not recorded), then call again. Never re-record a scope
the run already recorded, never edit the run by hand. A take makes the
recorded move once, then calls again.

### Off-script gate: respond_post_execute refused

Quote the refusal whole as the `context`. Propose, spelled in full, the
move that would let the call act (the record or source it names, a new
respond-post gate when it asks for an override).

### Off-script gate: the forge refused a reply or resolve

One gate for every reply or resolve the forge refused this pass. Quote each held entry as the `context`: its
`threadId`, `kind` and `error`, whole and unedited; any `push`, `mismatch`
or `read` entries ride in the same context and stay held. Propose: the
human posts or resolves those threads by hand, then this verb calls
`respond_post_execute` again, which finds them (`alreadyPosted`,
`alreadyResolved`). Take and iterate both call again; hold needs no
`run_hold` (the tool set `hold`) and ends with threads held.

### Report the held threads verbatim

Report every `held` entry: its thread, its `kind`, and its `error` whole
and unedited in a fenced block, never a summary, paraphrase or excerpt.
Say which replies posted and resolved (`posted`, `alreadyPosted`,
`resolved`, `alreadyResolved`), in the hand-back when a caller owns the
gates. A `mismatch` names what HEAD, `@{push}` and `@{u}` printed: never
switch branches, rebase or push to make them match, even when the error
names a fix; the developer decides, and a resume calls the tool again.
The run stays open with `hold` at `held`; no `run_hold`.

### Posted already on GitHub: read every thread with gh

Read every thread's full note chain with `gh`, fresh, every time the graph reaches this box; the earlier thread
read never stands in for it. A thread that carries this run's reply (a
note whose text is the reply due, or any note by the account this run
posts as dated after the run's `started_at`) is posted: it never posts
again. With no result (an error, or a thread whose notes did not come
back), nothing posts: set `hold` to `held`, report the error verbatim, and
leave the run open.

### Hold the picked fix rows and report the failure verbatim

A failed push (a target mismatch or a push error) holds the picked
`gate-1: fix` rows: post and resolve none of them, and report the two git
reads' output or the `git_push` error, whole and unedited, in a fenced
block. Never force, rebase or merge past it. Every other reply posts as
decided. Once the threads are done, re-record the decision with the held
ids (`gate_record {..., held}`) and set `hold` to `held`. That record
passes `gateId`, the `gate` in `extra.gate-source.respond-post`, when the
registry still has that gate. Otherwise (a `gate: null` source, or a gate
the registry no longer returns) it passes `decidedBy` the recorded
decider and `answers` rebuilt from the recorded decision: per offered
thread, the `post:<threadId>` and `resolve:<threadId>` values its
`threads` entry picks, as `{"value": [...], "text": ..., "note": ...}`
carrying that entry's recorded `text` and `note` (a bare array when it
has neither). Tell a caller that owns the gates which replies posted and
which threads are held.

### Post the reply on GitHub with gh

Post this thread's reply (per Acting per thread on GitHub) in the thread
with `gh`, never as a top-level comment.

### Resolve the thread on GitHub with gh

Resolve the thread with `gh`, after its reply when both are picked.

### Report the outcome

Zero unresolved human threads: say so. Otherwise say which replies posted
and which threads resolved (on GitLab from `posted`, `alreadyPosted`,
`resolved` and `alreadyResolved`), quoting any `writeErrors`; a caller
that owns the gates gets the same. Held threads are reported by Report the
held threads verbatim (GitHub: Hold the picked fix rows and report the
failure verbatim) instead.

## What the graph cannot show

**Acting on respond-post.** Never a top-level note, never approve the
change: that stays the developer's, however settled a thread looks.

**Push before any Fixed reply.** On GitHub, and only when the picks post
or resolve at least one `gate-1: fix` row; otherwise push nothing. Before
acting on those rows, `git branch --show-current` must print the MR's
source branch (the recorded `branch`, else the forge's) and `git
rev-parse --abbrev-ref @{push}` must print `origin/<source branch>`; any
other output, an error included, is a failed push, and never switch
branches to make it match. Then `git_push` with `tree` = this worktree
pushes only the current branch to its same-named upstream. The proceed is
the authorization: ask nothing more.

**Acting per thread on GitHub.** Walk the offered threads, then the
`gate-1: reply` rows; a held resume walks only the held threads, and a
thread held this pass acts on nothing. A `{value, note, text}` answer
unwraps to its `value` (the note never edits the reply); split each value
at the first `:`: `post:<threadId>` posts the answer's `text` when it
carries one, else the `reply@1` context's `text`; `resolve:<threadId>`
resolves, after the reply when both are picked; an empty array leaves the
thread untouched. A `gate-1: reply` row posts its row's reply, unresolved.
Nothing else posts, through any channel.

## Off-script gate

Every `Off-script gate: ...` box opens gate-protocol's `## Off-script
gate` with site `receive-review`: scope `off-script:receive-review:<n>`
(`n` from 1 within the site's attempt), `context` quoting the refusal or
failure verbatim, under the run with `runDb` and `stage`. A board that
owns the receive-review gates does not own these: they open in this pane.

The answer diamond reads it: `action: handback` is hand back whatever
`next` says; otherwise proceed takes the proposed move exactly once,
iterate redoes that site with their note, hold holds. After a take or
iterate the site's budget stays spent: the next failure returns to the
same gate. Hand back closes an own run `abandoned` or fails an inherited
run's stage, with the why as `reason` (also in the hand-back when a caller
owns the gates). A gate that comes back `closed` is a hold whose reason is
"gate closed".

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

## Criteria

{{slot:criteria}}

The Criteria section above is the domain's review standards, when the pack
binds them: evaluate the triage lines it declares against this change, and
pass its addendum with `{TRIAGE_FLAGS}` (those resolved values) and
`{SETUP_OBSERVATIONS}` (what was already gathered, else `none`) filled, the
rest verbatim. No depth block here; the addendum informs the per-thread
verdicts.

**One dispatch, all threads together**, whatever the slots bind: related
comments must be judged with shared context, or wrong conclusions and a
wrong implementation follow. Per thread it returns `valid` / `pushback` /
`needs-clarification`, plus that entry's relations.

{{include:review-dispatch-body}}

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

## Reviewer

{{slot:reviewer}}

{{include:review-dispatch-body-after}}

{{include:writing-style-lookup}}

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

## Reply rules

{{slot:reply-rules}}

## Red flags

| Thought | Reality |
|---|---|
| "I wrote this, I can tell if the reviewer is right" | That is the author bias. Dispatch the fresh-context adjudication. |
| "It's a small comment, I'll just judge it here" | Small own-code judgments are the peak of the bias. Dispatch it. |
| "I'll run self-review at the end as the check" | Too late. The fresh context adjudicates the comments; it is not a gut-check after. |
| "I'll open with 'Good call' / 'You're right'" | Performative. State the technical content. |
| "I'll process the resolved / bot threads too" | Unresolved human threads only; never filter the `mr_threads` result again or add a dropped thread back. |
| "The caller already handed `{plan, post}`, but I'll ask both gates" | A handed object answers both gates; ask nothing. |
| "I'll post the replies since they look right" | Post only what an answer picked; resolve only `resolve:`; never approve. |
| "I'll offer the reply-only threads at `respond-post` too, for a last look" | The developer already saw that exact reply. Only fixed threads and overrides are offered. |
| "I know the contexts were dropped; I'll apply that when the answer comes" | A pane that dies takes that with it. Write `gate-1-context: dropped` into the saved report right after the open. |
| "I'll work out the overrides and texts from the answers myself" | `gate_record` computes them. Write its `rows` as they come back. |
| "The resumed run lost its rows, so I'll record respond-plan again" | Never re-record a recorded scope: it moves `decided_at`. Join the decision to the stored cards. |
| "The run already records respond-plan (a revise), so the handed plan is spent and the record wins" | The revise answered the earlier open. A plan handed after it answers the newer open: record it once and walk its rows. |
| "The verdict report recommended a reply here, so it posts" | Posting reads each row's `gate-1` field, never the recommendation. |
| "The gate approved posting, not a push, so I'll ask before pushing" | The proceed authorizes the push. |
| "The fix is held on a branch mismatch; I'll switch branches, or push from the shell" | Never. Report it verbatim; the run stays open. Only `respond_post_execute` (GitLab) or `git_push` (GitHub) pushes, never forced. |
| "The forge refused one reply, so I'll post it myself with `mr_reply_thread`" | The tool already retried it. Open the one off-script gate; take and iterate call `respond_post_execute` again. |
| "They ticked post before choosing Iterate (or Hold), so those picks act now" | Only `proceed` acts. |
| "The run already records respond-post with nothing held, so it posted; I'll close" | A pane can record and die before it posts. Run the post side again. |
| "This one is clearly right, I'll add the guard in a follow-up commit" | Implementation follows `code-changes: approve`. |
| "It's wrong, but I need the reviewer to point me at it" | Then it is `needs-clarification`, not `pushback`. |
| "The pane is fresh, so I'll adjudicate again before applying the handed plan" | A handed plan answers an adjudication the human already saw. Record it and execute it. |
| "The run stores no respond-plan source, so I'll record the handed plan bare" | Build and store the open with the hand-back `gate_open`, then record. |
| "The caller asked the respond-plan gate, so it records the decision" | This verb records it with `gate_record`. |
| "I'll present the table and ask about fixes and posting in the same breath" | `respond-plan` and `respond-post` are two gates, in order. |

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
