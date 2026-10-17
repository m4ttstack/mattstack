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

The review comments left on **your own** change: pull the open threads, judge
each against the codebase, decide what to change, reply. Implementation and
posting each wait for their gate's answer.

Baseline agents already fetch threads, verify before implementing, clarify
vague comments, and gate posting; this skill cross-references those rather
than re-teaching them. It exists for the two things agents get wrong on their
**own** change: adjudicating the comments in the context that wrote the code
(author bias), and performative agreement leaking into the replies.

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
    "STOP: rt predates the run tools; tell the user to update rt" [shape=octagon style=filled fillcolor=red fontcolor=white];
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
    "The handed plan's threads already in this conversation?" [shape=diamond];
    "Forge for the handed plan's thread read?" [shape=diamond];
    "mr_threads {mrUrl} for the handed plan's threads" [shape=plaintext];
    "Read the handed plan's threads on GitHub with gh" [shape=box];
    "Keep exactly the threads the handed plan names" [shape=box];
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
    "respond-plan open attempts = 3?" [shape=diamond];
    "Fix the respond-plan source the gate_open refusal names" [shape=box];
    "Off-script gate: the respond-plan open will not fit" [shape=box];
    "Answer at the respond-plan fit off-script gate?" [shape=diamond];
    "Make the recorded move once at the respond-plan fit" [shape=box];
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
    "Fix attempts on this thread = 3?" [shape=diamond];
    "Off-script gate: the thread's fix did not converge" [shape=box];
    "Answer at the unconverged-fix off-script gate?" [shape=diamond];
    "Make the recorded move once for the unconverged fix" [shape=box];
    "Commit the fix and finalize its Fixed reply" [shape=box];
    "Redraft the override's reply" [shape=box];

    "Any thread offered (a finalized fix or an override)?" [shape=diamond];
    "Threads offered: caller handed the respond-post answers?" [shape=diamond];
    "Build the respond-post open" [shape=box];
    "Caller owns the receive-review gates at respond-post?" [shape=diamond];
    "gate_open {kind: respond-post, sourcePath: <dir>/respond-post.source.json, runDb, stage, scope: respond-post}" [shape=plaintext];
    "gate_open {kind: respond-post, sourcePath: <dir>/respond-post.source.json, handBack: true, outPath: <dir>/respond-post.open.json, runDb, stage, scope: respond-post}" [shape=plaintext];
    "respond-post gate_open result?" [shape=diamond];
    "gate_open {kind: respond-post, sourcePath: <dir>/respond-post.source.json, handBack: true, outPath: <dir>/respond-post.open.json, runDb, stage, scope: respond-post} to store the handed post's source" [shape=plaintext];
    "Handed post: respond-post gate_open result?" [shape=diamond];
    "STOP: fit the respond-post open only with gate_open" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "run_budget {runDb, key: respond-post-open, limit: 3, stage}" [shape=plaintext];
    "respond-post open attempts = 3?" [shape=diamond];
    "Fix the respond-post source the gate_open refusal names" [shape=box];
    "Off-script gate: the respond-post open will not fit" [shape=box];
    "Answer at the respond-post fit off-script gate?" [shape=diamond];
    "Make the recorded move once at the respond-post fit" [shape=box];
    "Write the receive-review-run line into the handed --report before the respond-post hand-back" [shape=box];
    "Hand back the offered replies and the respond-post open's path" [shape=box];
    "Gate respond-post: carry the opened gate through gate-protocol" [shape=box];
    "respond-post next answer?" [shape=diamond];
    "Decide nothing at respond-post: no push, post, resolve or record" [shape=box];
    "Apply the respond-post note" [shape=box];
    "gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy}" [shape=plaintext];

    "Forge for the post side?" [shape=diamond];
    "respond_post_execute {runDb, tree, stage}" [shape=plaintext];
    "respond_post_execute result?" [shape=diamond];
    "run_budget {runDb, key: post-execute-fix, limit: 1, increment: 0, stage}" [shape=plaintext];
    "Fixed what a respond_post_execute refusal named once already?" [shape=diamond];
    "run_budget {runDb, key: post-execute-fix, limit: 1, stage}" [shape=plaintext];
    "Fix what the respond_post_execute refusal names" [shape=box];
    "Off-script gate: respond_post_execute refused" [shape=box];
    "Answer at the respond_post_execute refusal off-script gate?" [shape=diamond];
    "Make the recorded move once for the respond_post_execute refusal" [shape=box];
    "STOP: respond_post_execute pushes the fix; never push from the shell, never force" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "STOP: post replies only through respond_post_execute" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Off-script gate: the forge refused a reply or resolve" [shape=box];
    "Answer at the refused reply-or-resolve off-script gate?" [shape=diamond];
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
    "Next thread to act on: offered threads, then gate-1: reply rows?" [shape=diamond];
    "post: decided for this thread?" [shape=diamond];
    "Thread already carries this receive-review run's reply?" [shape=diamond];
    "Post the reply on GitHub with gh" [shape=box];
    "resolve: decided for this thread?" [shape=diamond];
    "Resolve the thread on GitHub with gh" [shape=box];
    "Any GitHub fix row held this pass?" [shape=diamond];
    "gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy, held}" [shape=plaintext];
    "run_field_set {key: hold, value: held, stage: <stage>}" [shape=plaintext];

    "Report the outcome (to the caller when it owns the gates)" [shape=box];
    "This verb started or resumed the run?" [shape=diamond];

    "Own receive-review run: close it as failed?" [shape=diamond];
    "Own receive-review run: close it as abandoned?" [shape=diamond];
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
    "The refused receive-review run_enter carried resume?" -> "run_enter {flags, skillDir, stage: receive-review, fresh: true, spawnedBy?}" [label="yes: say the resume was refused, start fresh"];
    "The refused receive-review run_enter carried resume?" -> "STOP: rt predates the run tools; tell the user to update rt" [label="no"];
    "Gate clarify for receive-review: Resume / Start fresh / Hold" -> "receive-review clarify answer?";
    "receive-review clarify answer?" -> "run_enter {flags, skillDir, stage: receive-review, resume: <picked runId>}" [label="resume"];
    "receive-review clarify answer?" -> "run_enter {flags, skillDir, stage: receive-review, fresh: true, spawnedBy?}" [label="start fresh"];
    "receive-review clarify answer?" -> "Held: end the turn naming the run and stage" [label="hold: no run yet, record nothing"];
    "run_snapshot {runDb: <resumed receive-review>}" -> "What does the receive-review snapshot record?";
    "What does the receive-review snapshot record?" -> "What did the caller hand receive-review?" [label="no respond-plan record"];
    "What does the receive-review snapshot record?" -> "run_field_get {runDb, key: extra.gate-source.respond-plan}" [label="respond-plan recorded, no respond-post record: never record it again"];
    "What does the receive-review snapshot record?" -> "gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy}" [label="respond-plan recorded, no respond-post record, a {post} handed: record it"];
    "What does the receive-review snapshot record?" -> "Forge for the post side?" [label="respond-post recorded, held or not: the post side again"];
    "run_field_get {runDb, key: extra.gate-source.respond-plan}" -> "Rewrite the receive-review report rows" [label="the stored cards, or an unset-key error: none stored"];
    "What did the caller hand receive-review?" -> "Resolve the change and record its identity" [label="nothing, or a {plan} (alone or in {plan, post})"];
    "What did the caller hand receive-review?" -> "gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy}" [label="a {post} alone: its plan decision is on the run"];

    "Resolve the change and record its identity" -> "Forge of the change?";
    "Forge of the change?" -> "MR url or iid in hand?" [label="GitLab"];
    "Forge of the change?" -> "The run already records mr?" [label="GitHub: the PR url"];
    "MR url or iid in hand?" -> "The run already records mr?" [label="yes"];
    "MR url or iid in hand?" -> "mr_for_branch {repoName: <root>, branches: [<branch>]}" [label="no"];
    "mr_for_branch {repoName: <root>, branches: [<branch>]}" -> "Open MR with this source branch?";
    "Open MR with this source branch?" -> "The run already records mr?" [label="yes: its iid"];
    "Open MR with this source branch?" -> "Report that no open MR has this branch as its source" [label="null entry"];
    "Open MR with this source branch?" -> "Own receive-review run: close it as failed?" [label="an error: a failure, quoting its text (never read as none)"];
    "Report that no open MR has this branch as its source" -> "No open MR: nothing to answer";
    "The run already records mr?" -> "run_field_set {runDb, key: mr, value: <MR or PR url>, stage}" [label="no: write it, own or inherited run"];
    "The run already records mr?" -> "The run already records branch?" [label="yes: keep it"];
    "run_field_set {runDb, key: mr, value: <MR or PR url>, stage}" -> "The run already records branch?";
    "The run already records branch?" -> "run_field_set {runDb, key: branch, value: <source branch>, stage}" [label="no: write it, own or inherited run"];
    "The run already records branch?" -> "Executing a caller-handed {plan}?" [label="yes: keep it"];
    "run_field_set {runDb, key: branch, value: <source branch>, stage}" -> "Executing a caller-handed {plan}?";
    "Executing a caller-handed {plan}?" -> "The handed plan's threads already in this conversation?" [label="yes, not yet spent: never re-adjudicate"];
    "The handed plan's threads already in this conversation?" -> "gate_record {runDb, stage, scope: respond-plan, shape: respond-plan, gateId | answers + decidedBy, contextDropped?}" [label="yes: read nothing, record it"];
    "The handed plan's threads already in this conversation?" -> "Forge for the handed plan's thread read?" [label="no"];
    "Forge for the handed plan's thread read?" -> "mr_threads {mrUrl} for the handed plan's threads" [label="GitLab"];
    "Forge for the handed plan's thread read?" -> "Read the handed plan's threads on GitHub with gh" [label="GitHub"];
    "mr_threads {mrUrl} for the handed plan's threads" -> "Keep exactly the threads the handed plan names" [label="threads returned, resolved ones included"];
    "mr_threads {mrUrl} for the handed plan's threads" -> "Own receive-review run: close it as failed?" [label="an error: a failure, quoting its text (never read as none)"];
    "Read the handed plan's threads on GitHub with gh" -> "Keep exactly the threads the handed plan names";
    "Keep exactly the threads the handed plan names" -> "gate_record {runDb, stage, scope: respond-plan, shape: respond-plan, gateId | answers + decidedBy, contextDropped?}" [label="record it"];
    "Executing a caller-handed {plan}?" -> "Forge for the thread read?" [label="no, or the handed plan is spent by a revise"];
    "Executing a caller-handed {plan}?" -> "run_field_get {runDb, key: extra.gate-source.respond-plan}" [label="spent: the run already records it, not a revise"];
    "Forge for the thread read?" -> "mr_threads {mrUrl, filter: \"unresolved-human\"}" [label="GitLab"];
    "Forge for the thread read?" -> "Read the PR's review threads with gh" [label="GitHub"];
    "mr_threads {mrUrl, filter: \"unresolved-human\"}" -> "Any unresolved human threads?" [label="threads returned: already filtered, never filter again"];
    "mr_threads {mrUrl, filter: \"unresolved-human\"}" -> "Own receive-review run: close it as failed?" [label="an error: a failure, quoting its text (never read as none)"];
    "Read the PR's review threads with gh" -> "Keep only unresolved human threads (GitHub)";
    "Keep only unresolved human threads (GitHub)" -> "Any unresolved human threads?";
    "Any unresolved human threads?" -> "Dispatch one fresh-context adjudicator over all the review threads" [label="yes"];
    "Any unresolved human threads?" -> "Report the outcome (to the caller when it owns the gates)" [label="none: say so"];

    "Dispatch one fresh-context adjudicator over all the review threads" -> "Draft the verdict table and one reply per thread";
    "Draft the verdict table and one reply per thread" -> "Build the open";
    "Build the open" -> "Caller owns the receive-review gates at respond-plan?";
    "Caller owns the receive-review gates at respond-plan?" -> "gate_open {kind: respond-plan, sourcePath: <dir>/respond-plan.source.json, handBack: true, outPath: <dir>/respond-plan.open.json, runDb, stage, scope: respond-plan}" [label="yes: a board wrapper said so"];
    "Caller owns the receive-review gates at respond-plan?" -> "gate_open {kind: respond-plan, sourcePath: <dir>/respond-plan.source.json, runDb, stage, scope: respond-plan}" [label="no: a direct run"];
    "gate_open {kind: respond-plan, sourcePath: <dir>/respond-plan.source.json, runDb, stage, scope: respond-plan}" -> "respond-plan gate_open result?";
    "gate_open {kind: respond-plan, sourcePath: <dir>/respond-plan.source.json, handBack: true, outPath: <dir>/respond-plan.open.json, runDb, stage, scope: respond-plan}" -> "respond-plan gate_open result?";
    "respond-plan gate_open result?" -> "Gate respond-plan: carry the opened gate through gate-protocol" [label="opened: the direct run"];
    "respond-plan gate_open result?" -> "Write the receive-review-run line into the handed --report" [label="handed back: the open is at outPath"];
    "respond-plan gate_open result?" -> "run_budget {runDb, key: respond-plan-open, limit: 3, stage}" [label="refused: a line names a source field to fix"];
    "respond-plan gate_open result?" -> "Off-script gate: the respond-plan open will not fit" [label="refused: nothing a source fix can mend"];
    "respond-plan gate_open result?" -> "STOP: fit the respond-plan open only with gate_open" [label="tempted to edit the open by hand, shorten a reply, or fit it with a script"];
    "STOP: fit the respond-plan open only with gate_open" -> "Off-script gate: the respond-plan open will not fit";
    "run_budget {runDb, key: respond-plan-open, limit: 3, stage}" -> "respond-plan open attempts = 3?";
    "respond-plan open attempts = 3?" -> "Fix the respond-plan source the gate_open refusal names" [label="no: not exhausted"];
    "respond-plan open attempts = 3?" -> "Off-script gate: the respond-plan open will not fit" [label="yes: exhausted"];
    "Fix the respond-plan source the gate_open refusal names" -> "Caller owns the receive-review gates at respond-plan?";
    "Off-script gate: the respond-plan open will not fit" -> "Answer at the respond-plan fit off-script gate?";
    "Answer at the respond-plan fit off-script gate?" -> "Make the recorded move once at the respond-plan fit" [label="take"];
    "Answer at the respond-plan fit off-script gate?" -> "Fix the respond-plan source the gate_open refusal names" [label="iterate: fix again with their note"];
    "Answer at the respond-plan fit off-script gate?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="hold"];
    "Answer at the respond-plan fit off-script gate?" -> "Own receive-review run: close it as abandoned?" [label="hand back"];
    "Make the recorded move once at the respond-plan fit" -> "Caller owns the receive-review gates at respond-plan?";
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
    "code-changes answer?" -> "Dispatch one fresh-context adjudicator over all the review threads" [label="revise: a fresh dispatch with their note; a handed plan is spent"];

    "Next report row, in verdict-table order?" -> "Implement the thread's fix" [label="fix, code-changes approve, not yet on the branch"];
    "Next report row, in verdict-table order?" -> "Commit the fix and finalize its Fixed reply" [label="fix whose commit is on the branch (sha in its row, or the branch log): implement nothing again"];
    "Next report row, in verdict-table order?" -> "Redraft the override's reply" [label="override"];
    "Next report row, in verdict-table order?" -> "Next report row, in verdict-table order?" [label="reply, skip, or fix under code-changes skip: nothing now"];
    "Next report row, in verdict-table order?" -> "Any thread offered (a finalized fix or an override)?" [label="rows done"];
    "Implement the thread's fix" -> "Run the project's tests and checks on the fix";
    "Run the project's tests and checks on the fix" -> "Fix checks pass?";
    "Fix checks pass?" -> "Commit the fix and finalize its Fixed reply" [label="yes"];
    "Fix checks pass?" -> "run_budget {runDb, key: fix:<threadId>, limit: 3, stage}" [label="no: charge the failed attempt"];
    "run_budget {runDb, key: fix:<threadId>, limit: 3, stage}" -> "Fix attempts on this thread = 3?";
    "Fix attempts on this thread = 3?" -> "Implement the thread's fix" [label="no: not exhausted, another attempt"];
    "Fix attempts on this thread = 3?" -> "Off-script gate: the thread's fix did not converge" [label="yes: exhausted"];
    "Off-script gate: the thread's fix did not converge" -> "Answer at the unconverged-fix off-script gate?";
    "Answer at the unconverged-fix off-script gate?" -> "Make the recorded move once for the unconverged fix" [label="take"];
    "Answer at the unconverged-fix off-script gate?" -> "Implement the thread's fix" [label="iterate: try again with their note"];
    "Answer at the unconverged-fix off-script gate?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="hold"];
    "Answer at the unconverged-fix off-script gate?" -> "Own receive-review run: close it as abandoned?" [label="hand back"];
    "Make the recorded move once for the unconverged fix" -> "Next report row, in verdict-table order?";
    "Commit the fix and finalize its Fixed reply" -> "Next report row, in verdict-table order?";
    "Redraft the override's reply" -> "Next report row, in verdict-table order?";

    "Any thread offered (a finalized fix or an override)?" -> "Forge for the post side?" [label="no: no respond-post gate and no record; the gate-1: reply rows post"];
    "Any thread offered (a finalized fix or an override)?" -> "Threads offered: caller handed the respond-post answers?" [label="yes"];
    "Threads offered: caller handed the respond-post answers?" -> "Build the respond-post open" [label="yes: a combined {plan, post}; build and store the source first, ask nothing"];
    "Threads offered: caller handed the respond-post answers?" -> "Build the respond-post open" [label="no: ask it, or hand it back"];
    "Build the respond-post open" -> "Caller owns the receive-review gates at respond-post?";
    "Caller owns the receive-review gates at respond-post?" -> "gate_open {kind: respond-post, sourcePath: <dir>/respond-post.source.json, handBack: true, outPath: <dir>/respond-post.open.json, runDb, stage, scope: respond-post}" [label="yes: a board wrapper said so"];
    "Caller owns the receive-review gates at respond-post?" -> "gate_open {kind: respond-post, sourcePath: <dir>/respond-post.source.json, runDb, stage, scope: respond-post}" [label="no: a direct run"];
    "Caller owns the receive-review gates at respond-post?" -> "gate_open {kind: respond-post, sourcePath: <dir>/respond-post.source.json, handBack: true, outPath: <dir>/respond-post.open.json, runDb, stage, scope: respond-post} to store the handed post's source" [label="the caller already handed the post answers (a combined {plan, post})"];
    "gate_open {kind: respond-post, sourcePath: <dir>/respond-post.source.json, runDb, stage, scope: respond-post}" -> "respond-post gate_open result?";
    "gate_open {kind: respond-post, sourcePath: <dir>/respond-post.source.json, handBack: true, outPath: <dir>/respond-post.open.json, runDb, stage, scope: respond-post}" -> "respond-post gate_open result?";
    "respond-post gate_open result?" -> "Gate respond-post: carry the opened gate through gate-protocol" [label="opened: the direct run"];
    "respond-post gate_open result?" -> "Write the receive-review-run line into the handed --report before the respond-post hand-back" [label="handed back: the open is at outPath"];
    "respond-post gate_open result?" -> "run_budget {runDb, key: respond-post-open, limit: 3, stage}" [label="refused: a line names a source field to fix"];
    "respond-post gate_open result?" -> "Off-script gate: the respond-post open will not fit" [label="refused: nothing a source fix can mend"];
    "respond-post gate_open result?" -> "STOP: fit the respond-post open only with gate_open" [label="tempted to edit the open by hand, shorten a reply, or fit it with a script"];
    "gate_open {kind: respond-post, sourcePath: <dir>/respond-post.source.json, handBack: true, outPath: <dir>/respond-post.open.json, runDb, stage, scope: respond-post} to store the handed post's source" -> "Handed post: respond-post gate_open result?";
    "Handed post: respond-post gate_open result?" -> "gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy}" [label="handed back: the source is stored; record the handed answers"];
    "Handed post: respond-post gate_open result?" -> "run_budget {runDb, key: respond-post-open, limit: 3, stage}" [label="refused: a line names a source field to fix"];
    "Handed post: respond-post gate_open result?" -> "Off-script gate: the respond-post open will not fit" [label="refused: nothing a source fix can mend"];
    "Handed post: respond-post gate_open result?" -> "STOP: fit the respond-post open only with gate_open" [label="tempted to edit the open by hand, shorten a reply, or fit it with a script"];
    "STOP: fit the respond-post open only with gate_open" -> "Off-script gate: the respond-post open will not fit";
    "run_budget {runDb, key: respond-post-open, limit: 3, stage}" -> "respond-post open attempts = 3?";
    "respond-post open attempts = 3?" -> "Fix the respond-post source the gate_open refusal names" [label="no: not exhausted"];
    "respond-post open attempts = 3?" -> "Off-script gate: the respond-post open will not fit" [label="yes: exhausted"];
    "Fix the respond-post source the gate_open refusal names" -> "Caller owns the receive-review gates at respond-post?";
    "Off-script gate: the respond-post open will not fit" -> "Answer at the respond-post fit off-script gate?";
    "Answer at the respond-post fit off-script gate?" -> "Make the recorded move once at the respond-post fit" [label="take"];
    "Answer at the respond-post fit off-script gate?" -> "Fix the respond-post source the gate_open refusal names" [label="iterate: fix again with their note"];
    "Answer at the respond-post fit off-script gate?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="hold"];
    "Answer at the respond-post fit off-script gate?" -> "Own receive-review run: close it as abandoned?" [label="hand back"];
    "Make the recorded move once at the respond-post fit" -> "Caller owns the receive-review gates at respond-post?";
    "Write the receive-review-run line into the handed --report before the respond-post hand-back" -> "Hand back the offered replies and the respond-post open's path";
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
    "respond_post_execute result?" -> "run_field_set {runDb, key: hold, value: -, stage}" [label="held is empty: every due reply and resolve is done"];
    "respond_post_execute result?" -> "Off-script gate: the forge refused a reply or resolve" [label="a reply or resolve held, whatever else is held"];
    "respond_post_execute result?" -> "Report the held threads verbatim" [label="only push, mismatch or read held"];
    "respond_post_execute result?" -> "run_budget {runDb, key: post-execute-fix, limit: 1, increment: 0, stage}" [label="refused: a line names a field, a record or the tree to fix"];
    "respond_post_execute result?" -> "Off-script gate: respond_post_execute refused" [label="refused: nothing a fix on this run can mend"];
    "respond_post_execute result?" -> "STOP: respond_post_execute pushes the fix; never push from the shell, never force" [label="tempted to push from the shell or force"];
    "respond_post_execute result?" -> "STOP: post replies only through respond_post_execute" [label="tempted to reply or resolve by hand"];
    "STOP: respond_post_execute pushes the fix; never push from the shell, never force" -> "Report the held threads verbatim";
    "STOP: post replies only through respond_post_execute" -> "Off-script gate: the forge refused a reply or resolve";
    "run_budget {runDb, key: post-execute-fix, limit: 1, increment: 0, stage}" -> "Fixed what a respond_post_execute refusal named once already?";
    "Fixed what a respond_post_execute refusal named once already?" -> "run_budget {runDb, key: post-execute-fix, limit: 1, stage}" [label="no: charge the fix"];
    "Fixed what a respond_post_execute refusal named once already?" -> "Off-script gate: respond_post_execute refused" [label="yes: exhausted"];
    "run_budget {runDb, key: post-execute-fix, limit: 1, stage}" -> "Fix what the respond_post_execute refusal names";
    "Fix what the respond_post_execute refusal names" -> "respond_post_execute {runDb, tree, stage}";
    "Off-script gate: respond_post_execute refused" -> "Answer at the respond_post_execute refusal off-script gate?";
    "Answer at the respond_post_execute refusal off-script gate?" -> "Make the recorded move once for the respond_post_execute refusal" [label="take"];
    "Answer at the respond_post_execute refusal off-script gate?" -> "Fix what the respond_post_execute refusal names" [label="iterate: fix again with their note"];
    "Answer at the respond_post_execute refusal off-script gate?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="hold"];
    "Answer at the respond_post_execute refusal off-script gate?" -> "Own receive-review run: close it as abandoned?" [label="hand back"];
    "Make the recorded move once for the respond_post_execute refusal" -> "respond_post_execute {runDb, tree, stage}";
    "Off-script gate: the forge refused a reply or resolve" -> "Answer at the refused reply-or-resolve off-script gate?";
    "Answer at the refused reply-or-resolve off-script gate?" -> "respond_post_execute {runDb, tree, stage}" [label="take: the human posted or resolved by hand; call again"];
    "Answer at the refused reply-or-resolve off-script gate?" -> "respond_post_execute {runDb, tree, stage}" [label="iterate: the cause is fixed; call again"];
    "Answer at the refused reply-or-resolve off-script gate?" -> "Report the held threads verbatim" [label="hold: the tool already set hold"];
    "Answer at the refused reply-or-resolve off-script gate?" -> "Own receive-review run: close it as abandoned?" [label="hand back"];
    "Report the held threads verbatim" -> "Threads held: run left open for a resume";
    "run_field_set {runDb, key: hold, value: -, stage}" -> "Report the outcome (to the caller when it owns the gates)";

    "Posted already on GitHub: read every thread with gh" -> "The GitHub read returned every thread due?";
    "The GitHub read returned every thread due?" -> "Picks post or resolve a gate-1: fix row?" [label="yes"];
    "The GitHub read returned every thread due?" -> "run_field_set {key: hold, value: held, stage: <stage>}" [label="no, or an error: hold, the error verbatim"];
    "Picks post or resolve a gate-1: fix row?" -> "git branch --show-current" [label="yes"];
    "Picks post or resolve a gate-1: fix row?" -> "Next thread to act on: offered threads, then gate-1: reply rows?" [label="no: push nothing"];
    "git branch --show-current" -> "git rev-parse --abbrev-ref @{push}";
    "git rev-parse --abbrev-ref @{push}" -> "Both name the MR's source branch?";
    "Both name the MR's source branch?" -> "git_push {tree: <worktree root>}" [label="yes"];
    "Both name the MR's source branch?" -> "Hold the picked fix rows and report the failure verbatim" [label="no, or an error"];
    "git_push {tree: <worktree root>}" -> "git_push result for the fix rows?";
    "git_push result for the fix rows?" -> "Next thread to act on: offered threads, then gate-1: reply rows?" [label="pushed"];
    "git_push result for the fix rows?" -> "Hold the picked fix rows and report the failure verbatim" [label="any other error"];
    "git_push result for the fix rows?" -> "STOP: a failed git_push holds the fix rows; never push from the shell, never force" [label="tempted to push from the shell or force"];
    "STOP: a failed git_push holds the fix rows; never push from the shell, never force" -> "Hold the picked fix rows and report the failure verbatim";
    "Hold the picked fix rows and report the failure verbatim" -> "Next thread to act on: offered threads, then gate-1: reply rows?" [label="every other reply still acts"];
    "Next thread to act on: offered threads, then gate-1: reply rows?" -> "post: decided for this thread?" [label="next thread; a held resume walks only the held threads; a thread held this pass acts on nothing"];
    "Next thread to act on: offered threads, then gate-1: reply rows?" -> "Any GitHub fix row held this pass?" [label="threads done"];
    "post: decided for this thread?" -> "Thread already carries this receive-review run's reply?" [label="yes"];
    "post: decided for this thread?" -> "resolve: decided for this thread?" [label="no"];
    "Thread already carries this receive-review run's reply?" -> "resolve: decided for this thread?" [label="yes: count it posted, never post again"];
    "Thread already carries this receive-review run's reply?" -> "Post the reply on GitHub with gh" [label="no: post it"];
    "Post the reply on GitHub with gh" -> "resolve: decided for this thread?";
    "resolve: decided for this thread?" -> "Resolve the thread on GitHub with gh" [label="yes"];
    "resolve: decided for this thread?" -> "Next thread to act on: offered threads, then gate-1: reply rows?" [label="no"];
    "Resolve the thread on GitHub with gh" -> "Next thread to act on: offered threads, then gate-1: reply rows?";
    "Any GitHub fix row held this pass?" -> "gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy, held}" [label="yes"];
    "Any GitHub fix row held this pass?" -> "Report the outcome (to the caller when it owns the gates)" [label="no"];
    "gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy, held}" -> "run_field_set {key: hold, value: held, stage: <stage>}";
    "Report the outcome (to the caller when it owns the gates)" -> "This verb started or resumed the run?";

    "This verb started or resumed the run?" -> "run_close {runDb, workType: receive-review, stage: receive-review, outcome}" [label="yes: outcome done"];
    "This verb started or resumed the run?" -> "Review feedback answered" [label="no: inherited, the caller closes"];
    "Own receive-review run: close it as failed?" -> "run_close {runDb, workType: receive-review, stage: receive-review, outcome}" [label="yes: own run, outcome failed with the error"];
    "Own receive-review run: close it as failed?" -> "run_stage {action: fail, stage: <stage>, reason}" [label="no: inherited, the caller decides"];
    "Own receive-review run: close it as abandoned?" -> "run_close {runDb, workType: receive-review, stage: receive-review, outcome}" [label="yes: own run, outcome abandoned with the why"];
    "Own receive-review run: close it as abandoned?" -> "run_stage {action: fail, stage: <stage>, reason}" [label="no: inherited, the caller decides"];
    "run_close {runDb, workType: receive-review, stage: receive-review, outcome}" -> "receive-review closed as?";
    "receive-review closed as?" -> "Review feedback answered" [label="done"];
    "receive-review closed as?" -> "receive-review stage failed" [label="failed or abandoned"];
    "run_stage {action: fail, stage: <stage>, reason}" -> "receive-review stage failed";
    "run_hold {runDb, stage, reason, decidedBy}" -> "Held: end the turn naming the run and stage";
    "run_field_set {key: hold, value: held, stage: <stage>}" -> "Threads held: run left open for a resume";
}
```

## Run

Outside a pipeline this verb is its own run, so the console shows it and
the Stop hook covers its pane. The graph's first call, `run_enter`, starts,
resumes or inherits the run, or returns the running candidates to choose
between. Never list, read or build run dbs by hand.

`run_enter` takes:

- `flags`: this verb's value in the block below, verbatim;
- `skillDir`: this skill's own directory;
- `stage: receive-review`;
- `runDb`: only when a caller handed you one;
- `resume`: a receive-review run id to resume, when the caller or the
  developer names one, or when a handed `--report` carries a
  `receive-review-run: <run id>` line (that id, even in a pane a surface
  launched);
- `spawnedBy`: only when a board or another surface launched this pane.

{{run-start.flags:receive-review}}

Keep the `runDb` it returns and pass it to every `run_*` and gate call;
nothing is exported. `run_enter` is the first call of a pane with no run in
hand: a caller re-entering this pane after its hand-back continues at the
box that handed back, on the run the pane already holds. `<stage>` below is `receive-review` on a run you
started or resumed. On a run you inherited (`mode: inherited`, a running
run a caller handed you), it is the result's `at.stage`, and the caller
closes the run. A handed `runDb` whose run is no longer running is not
inherited: `run_enter` carries on as if none was handed, and its result
says `handedRunDb: "not-running"`.

Every gate after `run_enter` runs through gate-protocol with `runDb` and
`stage`, so the gate tools write the run's gate fields. The clarify and
off-script gates record their answers map when answered. `respond-plan`
and `respond-post` are review gates: an answer records nothing until this
verb's `gate_record`. Neither writes a `gate` field or a gate decision by
hand.

Every loop counter is a `run_budget {runDb, key, limit, stage}` call: each
counted failure charges `increment: 1` (the default), the counter diamond
reads the result's `exhausted`, and the count survives compaction and
resume, so a resumed pane never restarts it. The keys:

| Key | Limit | Counts |
|---|---|---|
| `respond-plan-open` | 3 | respond-plan `gate_open` refusals that name a source field |
| `respond-post-open` | 3 | respond-post `gate_open` refusals that name a source field |
| `fix:<threadId>` | 3 | failed test-and-check runs on that thread's fix |
| `post-execute-fix` | 1 | fixes made to what a `respond_post_execute` refusal named |

The once-only `post-execute-fix` is two calls: a read with `increment: 0`
before its diamond, then the charge on the diamond's `no` edge, right
before the fix.

A Hold that ends the turn (the edge to Held: end the turn naming the run
and stage), own or inherited run, is the one `run_hold {runDb, stage,
reason, decidedBy}` call: `reason` the human's words or the quoted error,
`decidedBy` the answer's by. It computes the attempt and writes the `hold`
field; then the turn ends. The clarify Hold comes before any run and
records nothing.

A thread hold is the other case, and makes no `run_hold` call: threads
the post side could not finish leave the run open with the `hold` field at
`held`. On GitLab `respond_post_execute` sets it whenever it returns a
`held` entry and re-records the respond-post decision with those ids; it
never clears the field, so a pass that ends with nothing held clears it
(`run_field_set {runDb, key: hold, value: -, stage}`). On GitHub this verb
records the held ids with `gate_record` and sets the field itself. A held
thread is reported verbatim (to the caller when it owns the gates), and a
resume calls the post side again, acting only on the held threads.
`run_enter` clears the field on a resume.

The close runs only when this verb started or resumed the run, once
nothing is left to post (the post side ended with nothing held, or there
were no threads to answer): `run_close {runDb,
workType: receive-review, stage: receive-review, outcome: done}`. A
failure (a forge read error) closes it with `outcome: failed`, and a hand
back with `outcome: abandoned`, each with `reason` the quoted error or the
why. `run_close` refuses an inherited run, which never reaches it: there a
failure or a hand back is `run_stage {action: fail, stage, reason}`, and
the caller decides.

`respond_post_execute` reads the run's `mr` and `branch`, so this verb
records both on any run that lacks them, inherited included (Resolve the
change and record its identity). Run identity below governs `ticket`.

{{include:run-identity}}

## Steps

### Gate clarify for receive-review: Resume / Start fresh / Hold

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

### The refused receive-review run_enter carried resume?

A refused resume means the run is gone or no longer running: say so in one
line, then start fresh, keeping the first call's `spawnedBy`. Any other
refusal, or no `run_enter` tool at all, is an rt that predates the run
tools.

### What does the receive-review snapshot record?

The resumed run's decisions pick the re-entry; a question they already
answered is never asked again.

- **No `respond-plan` record:** nothing is decided. Go on as a run that
  just started: what the caller handed, then resolve the change and read
  the threads.
- **`respond-plan` recorded, no `respond-post` record:** read the cards
  the open stored on the run, `run_field_get {runDb, key:
  extra.gate-source.respond-plan}`, and rewrite the report rows from the
  recorded decision joined to them (Rewrite the receive-review report
  rows), then walk the rows. Never call `gate_record` again for
  respond-plan: a second record moves its `decided_at`, and
  `respond_post_execute` reads that time both for the decision's freshness
  and for which notes by this account count as already posted. A fix row
  whose commit is already on the branch implements nothing again: its
  Fixed reply is written from that commit, and nothing is re-committed.
- **`respond-plan` recorded, no `respond-post` record, and the caller
  handed a `{post}`:** record it at once (`gate_record {..., scope:
  respond-post, shape: respond-post, answers, decidedBy}`), then the post
  side. The rows walk nothing again: the `{post}` answers the gate those
  rows already reached.
- **A `respond-post` record, held or not:** the post side again, never a
  close on the record alone. A pane can record and die before it posts, so
  the record says what was decided, not what landed. On GitLab
  `respond_post_execute` is idempotent: what already posted comes back
  `alreadyPosted`, what already resolved `alreadyResolved`, and a record
  carrying `held` acts only on the held threads. On GitHub the gh read
  (Posted already on GitHub) does the same job before anything posts.

### What did the caller hand receive-review?

**Decision intake.** A caller that owns the gates hands decided answers
instead of a gate answer: the `{plan}` half alone (a board wrapper hands it
after its own first gate, `{post}` following later when gate respond-post
offers a thread), or a combined `{plan, post}` object from a caller that
collected both up front. Each half is that gate's raw per-question answers:
keyed by question id, option values verbatim, thread ids inside the
values. The decider the caller names alongside it (its `by`) records as
`decidedBy`. A `{plan}` records at `Executing a caller-handed {plan}?` and
asks nothing; the `post` half of a combined object waits for gate
respond-post, where it is the caller-handed `post`. A `{post}` alone
records at once (`gate_record {..., scope: respond-post, shape:
respond-post, answers, decidedBy}`), then goes to the post side: its plan
decision is already on the run. A fresh pane handed a `{post}` with no
`receive-review-run:` line, or whose resume was refused, has no plan
decision on its run: `respond_post_execute` refuses, and that refusal goes
to its off-script gate, quoted.

In the pane that handed the open back, the caller re-enters at that box
instead: Hand back the verdict table and the respond-plan open's path.

### Resolve the change and record its identity

The change and its requirements come from the caller or domain adapter: the
diff range, plus the requirements it is judged against. Report a fetch
failure or a mismatched pair exactly as found; never fabricate the missing
half.

On GitLab the MR is `mrUrl`, or `repoName` plus `iid`; with neither in
hand, `mr_for_branch` with `repoName` = this checkout and `branches: [<the
checked-out branch>]` gives the iid. On GitHub it is the PR's URL.

Then the identity, each field its own `run_field_set` node, on whatever run
this is, own or inherited: `mr` (the MR/PR URL) and `branch` (its source
branch). `respond_post_execute` reads both from the run. A field the run
already records is kept, an inherited run's `mr` above all. A run that just
started records neither; a resumed run's snapshot shows them; on an
inherited run, read each with `run_field_get {runDb, key}`, an unset-key
error meaning it is not recorded. `ticket` (the id the change names, when
one exists) is recorded only on a run this verb started, per Run identity
under Run.

### Report that no open MR has this branch as its source

A null entry from `mr_for_branch` means GitLab has no open MR with that
branch as its source: report that and stop.

An `mr_for_branch` or `mr_threads` error is never read as "no open MR" or
as "no threads". Quote it, not paraphrased: GitLab's 404 or 403 is the usual
case, though an error can also be rt's (target not resolved, daemon
unreachable, timeout). The stage fails with that text as the reason: an
own run closes `failed`, an inherited run fails its stage.

### Executing a caller-handed {plan}?

A caller-handed `{plan}` not yet spent is recorded, never re-adjudicated:
never dispatch the adjudicator or draft a new verdict table for it. A plan
answers an adjudication the human already saw, so a fresh one would change
the drafts it approved. The record is `gate_record {runDb, stage, scope:
respond-plan, shape: respond-plan, answers: <the plan>, decidedBy: <the
decider the caller names>}`, plus `contextDropped: true` when the handed
`--report` carries the line `gate-1-context: dropped`.

Before the record, the steps after it need each named thread's id,
`file:line` and full note chain: fix rows to implement, override rows to
redraft. When those threads are already in this conversation, read nothing.
Otherwise read them first (Keep exactly the threads the handed plan
names). The rows still come from the record: `gate_record`'s `rows`, or on
a resume the decision joined to the stored cards. The read supplies the
bodies.

On a run with no stored cards (no `receive-review-run:` line in the handed
`--report`, or a refused resume), the plan still records: with no card to
show a draft was seen, every `reply:` answer without `text` comes back an
override.

The plan is spent once the run records it. Spent, not a revise: go to the
rows from that record, never record it again. A revise: adjudicate afresh.

### mr_threads {mrUrl} for the handed plan's threads

The handed plan's read takes no `filter`: the plan decides each thread it
names, resolved or not, so the read returns every thread and Keep exactly
the threads the handed plan names picks them out. It is a different read
from `mr_threads {mrUrl, filter: "unresolved-human"}`, which only a fresh
adjudication makes.

### Read the handed plan's threads on GitHub with gh

On GitHub, fetch every thread with `gh`, as Read the PR's review threads
with gh does, resolved ones included: no human-thread filter applies to a
handed plan.

### Keep exactly the threads the handed plan names

Keep every thread the plan names, resolved or not: the plan decides its
row, not the resolved state. Capture each one's id, its `file:line`, and
its full note chain. A named thread the forge no longer returns is held
and reported. Unresolved threads the plan does not name get no row; the
outcome report names them for the next run.

### mr_threads {mrUrl, filter: "unresolved-human"}

On GitLab the filter is the thread read: it drops resolved threads, system
notes and threads a bot opened (the username rule under Keep only
unresolved human threads (GitHub)), and reports each count under
`dropped`. What it returns is the set to adjudicate, each thread with its
id, `file:line` and full note chain. Never filter it again by hand, and
never add a dropped thread back.

A GitLab fact the thread read does not return is read as in "Reading a
GitLab fact no read tool returns".

### Read the PR's review threads with gh

On GitHub, fetch the threads with `gh`.

### Keep only unresolved human threads (GitHub)

No tool filters on GitHub, so apply the GitLab filter's rule by hand: keep
only **unresolved** threads a **person** opened, dropping resolved threads,
system notes and bot authors. A bot is an author whose username starts
`project_<n>_bot` or `group_<n>_bot`, is `ghost`, or ends in `-bot`,
`_bot` or `[bot]`; every other username is a person. Capture each thread's
id, its `file:line`, and its full note chain.

### Reading a GitLab fact no read tool returns

At any step of this verb, a GitLab fact the read tools do not return is
read with `gitlab_get {repoName, path}`: `repoName` = the checkout or
tree this verb already targets, `path` relative to the API root with `:id`
for this project, for example `projects/:id/merge_requests/<iid>/versions`.
The read is part of the step that needs it, not an off-script move, so it
opens no gate. A GitLab error is quoted as GitLab wrote it. Its refusal of
a credential path is final.

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

Hand the dispatch flow the numbered threads (`file:line` plus note chains),
the requirements, and the diff range; it owns the template, the subagent,
and the standard blocks. The dispatch flow is below, after the Off-script
gate section.

### Draft the verdict table and one reply per thread

Present the verdict table plus a drafted reply per thread, then the
recommendation, in one structured block (the verdict report) -- nothing is
written to code, nothing posted yet. Bucket each thread by its verdict
(`valid` / `pushback` / `needs-clarification`) and its recommended action
(`fix` / `reply` / `skip`); gate respond-plan reads from this bucketing,
not from a fresh pass over the threads.

**Reply content is a seam.** **No Reply rules section below** (the slot is
unbound): **REQUIRED SUB-SKILL** `superpowers:receiving-code-review`. **A
Reply rules section below**: follow it. Compose in the voice the Writing
style section below names. On top of either branch, these hold:

- **Per verdict.** `valid` -> a technical acknowledgment of the fix.
  `pushback` -> the technical reason, referencing the code or test that shows
  it. `needs-clarification` -> one crisp question.
- **An ask is an ask.** If the reply asks the reviewer anything, its verdict
  is `needs-clarification`, not a `pushback` ending in a question: when the
  answer would change the ruling, the question is the ruling.
- **No performative openers.** A reply states the technical content. An
  opener acknowledging the comment's quality or offering thanks is
  performative and carries none: "Good call", "You're right", "Great catch",
  "Nice find", "Thanks" -- and every variant, "Confirmed, thanks." included.
  Open on what the code does or what changes.

### Build the open

The verb adjudicates; it never decides what gets fixed or posted. A
caller-handed `{plan}` not yet spent never reaches this step (the decision
intake under What did the caller hand receive-review?); every other path
builds the open first.

The gate (`respond-plan`, gate 1; `respond-post` is gate 2) carries
structured context, built from the verdict report's buckets per
gate-protocol's `## Structured context (gate-ctx@1)` and its sidecar
`structured-context.md`. Make one scratch directory, `<dir>`: a new
directory inside this session's scratchpad (the Claude Code temp root, the
only place `gate_open` reads `sourcePath` and writes `outPath`), never
`mktemp -d`. Write its path out literally from then on: each tool call is a
fresh shell. Write `<dir>/respond-plan.source.json`:

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
verb triple with the thread id VERBATIM in the value and the bare verb in
the label. The triple's member matching the verdict report's recommended action
carries `"recommended": true` -- this is how the recommendation reaches
the gate; rt-client normalization renders it as the label's
"(Recommended)" suffix and capitalizes the bare verb, so labels stay
lowercase here.

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
| `reply` | by the verdict report's recommended action: `reply` is `verbatim` with the drafted reply as `text`; `fix` is `direction` with the drafted reply (it finalizes at Commit the fix and finalize its Fixed reply); `skip` is `{"kind": "none"}` |
| `fix` option `description` | the planned change and where, from the adjudicator's `valid` entry; a thread with no such entry gets `implement the reviewer's ask as written` |

Never shorten a reply to make an open fit. `gate_open` fits the open to
the shared budget itself (points and notes trimmed first, every context as
prose when nothing else fits) and says so in its result; a context it
still cannot fit is dropped loudly (`contextDropped`), never by hand.

### respond-plan gate_open result?

- **Opened** (the direct run): keep the result's `id`, `paneAction`,
  `formContext`, `formChunks` and `contextDropped`. Under the run
  `gate_open` has already written the `gate` field and stored the
  untrimmed source as `extra.gate-source.respond-plan`: the cards
  `gate_record` and a resumed pane read.
- **Handed back:** nothing opened. The open is written at `outPath` in
  `gate-ctx.sh fit`'s shape, its source beside it, and the run still
  stores the source as `extra.gate-source.respond-plan`. Keep
  `contextDropped` and `droppedContexts`.
- **Refused:** nothing opened, one problem per line. A line that names a
  question or a field of the source is a source field to fix. A refusal no
  source fix can mend (a file it cannot read or parse, a path outside the
  read roots) goes straight to the off-script gate.

The way past a refusal is the source fix or the off-script gate: only
`gate_open` fits the open. A hand-edited open, a shortened reply or a fit
with the vendored script is the STOP on this diamond.

### Fix the respond-plan source the gate_open refusal names

Each refusal line names a question and a field: fix exactly those in
`<dir>/respond-plan.source.json`, never by shortening a reply, then go back
through `Caller owns the receive-review gates at respond-plan?` to the
same open. The `respond-plan-open` budget was charged for this refusal just
before.

### Off-script gate: the respond-plan open will not fit

Quote the last refusal's lines as the `context`. Propose, spelled in full,
one source change for the fields it named, never a shortened reply or a
hand-edited open. The take makes that change, then `gate_open` runs again.
Ask it per the Off-script gate section.

### Make the recorded move once at the respond-plan fit

Make the source change the answer recorded, exactly once, then open again
(`Caller owns the receive-review gates at respond-plan?` picks which
`gate_open`). Opened or handed back goes on as normal. A refusal that
names a field charges the `respond-plan-open` budget, finds it already
exhausted, and returns to this same off-script gate, where the human
answers again.

### Write the receive-review-run line into the handed --report

Before the hand-back, write one line `receive-review-run: <run id>`
(`run_enter`'s `runId`) into the handed `--report` file, replacing any
earlier `receive-review-run:` line; with no `--report`, write nothing. A
fresh pane the board later hands a decision to passes that id as `resume`
and lands on this run, which holds the stored gate source. The board never
reads the line.

### Hand back the verdict table and the respond-plan open's path

**A caller that owns the gates** (it delegated the adjudication to this
verb and presents the gates itself; a board wrapper does, and says so when
it delegates): open nothing in the pane. Hand back the verdict table plus
the absolute path of `<dir>/respond-plan.open.json` (its source beside it
as `respond-plan.source.json`); the caller opens its gate from that file's
`.questions` and `.context`, then hands `{plan}` back. When the result says
`contextDropped` or lists `droppedContexts`, say so in the hand-back: the
caller writes `gate-1-context: dropped` into its own report.

The caller's `{plan}` comes back to this pane, after this hand-back in the
same conversation. The re-entry goes on from this box with the `runDb`
already in hand, and its first call is this record: `gate_record {runDb,
stage, scope: respond-plan, shape: respond-plan, answers: <the plan>,
decidedBy: <the decider the caller names>}`, plus `contextDropped: true`
when the open's result said so or the saved report carries the line
`gate-1-context: dropped`. Then the rows. This verb records the
respond-plan decision whoever asked the gate. A fresh pane, one with no
hand-back in its conversation, is the other case: it starts at the trigger
and resumes through the run line.

### Gate respond-plan: carry the opened gate through gate-protocol

**Otherwise** (a direct terminal run) the verb runs the gate itself.
`gate_open` opened it, so enter gate-protocol at `Trigger: a site opened
its gate with gate_open` with its result and walk on from `paneAction?`;
a gate is never asked or answered from the shell.

When the result says `contextDropped: true`, first write one line,
`gate-1-context: dropped`, into the saved verdict report (when there is
one), before presenting or waiting on any answer: a resumed pane has no
other way to know those cards never showed their drafts.

- **form:** `### Present the in-pane gate form`. Show `formContext` in the
  pane, then ask the `formChunks` chunks in order, one AskUserQuestion call
  per chunk, holding `code-changes` back from them. Then one last call:
  `code-changes`, only when some thread answered `fix:` (otherwise submit
  its sentinel `skip` unasked, the same hide rule the board and console
  cards apply), plus a pane-only `next` question of **Continue** /
  **Iterate here** / **Hold**. That `next` question never reaches the
  registry, and Iterate / Hold are never extra options on a thread or
  code-changes question: a fourth and fifth option there would push it
  over the cap.
  - **Continue:** submit exactly ONE `gate_answer {id, answers, runDb?,
    stage?}`, with this run's `runDb` and `stage`, after that last call,
    carrying every thread answer plus `code-changes`, never one per chunk.
    A replacement reply the human types in the form's free-text field
    rides as `note`.
  - **Iterate here** or **Hold:** answer nothing. Hold leaves the gate
    open for another surface.
- **wait:** `rt gate wait <id> as a background Bash task`, then `End the
  turn: holding at gate <id>`; the re-entry is `gate_reconcile {id,
  runDb?, stage?}` with this run's `runDb` and `stage`. An answer from the
  board or console carries no `next`: it is the `answered off the pane`
  edge.

On this review gate neither `gate_answer` nor `gate_reconcile` records
anything: `gate_record {..., gateId: <id>}` is the record. One question
per thread keeps every question at three options, under the form cap, so
a herdr pane gets `form` for any thread count; never fold several threads
into one multi-select. The thread id lives in the option VALUE, never in
the question id. `fix:<threadId>` implies that thread's reply;
`skip:<threadId>` means neither.

### Redraft the replies with the respond-plan note

Redraft the replies the note asks about, per the reply rules, into the
verdict report, then build the open again. The re-ask is a NEW gate
(gate-protocol's Closed gates, Hold / Iterate), never a second answer to
the one just closed.

### Rewrite the receive-review report rows

**Report rows.** Once gate 1 is recorded, rewrite each thread's row of
the verdict report (the saved report file too, when there is one) in this
shape, in verdict-table order:

```text
- <threadId> · <file>:<line> · <verdict>, recommended <action> · gate-1: <reply|fix|skip|override> · reply: "<text>"
```

After `gate_record`, write one row per entry of its `rows`, in order: the
entry's `threadId`, `file`, `verdict`, `recommended`, `gate1` and `reply`
fill the fields above. Never work them out yourself: the tool applies the
override rule, the edited replies and the notes, keyed by thread id.
`contextDropped`: pass `true` when the open's result said so, or the saved
report carries the line `gate-1-context: dropped`; the tool also reads the
run's own `extra.context-dropped.respond-plan`.

On a resume the respond-plan record already exists and there is no `rows`
result, so write each row from the record joined to the stored card for
its thread (`extra.gate-source.respond-plan`, the question whose option
values carry that thread id): `file` is the card's label, `verdict` its
context's `verdict.call`, `recommended` its recommended option's verb;
`gate-1` is `override` for every thread under the record's `overrides`,
else that thread's `threads` verb; `reply` is its `texts` entry, else the
card's `reply.text`, else `none`. With no stored card the card's fields
read `unknown`, and a `reply` row whose reply would be `none` is an
override.

**What an override means for the row walk.** A `gate-1: override` row's
reply was never seen word for word (its card showed a direction or no
reply, its answer carried a note, or its context never reached the gate).
It is redrafted (Redraft the override's reply), folding in the record's
`notes` entry for it when there is one, and offered at gate 2 beside the
finalized fixes, never posted from gate 1.

Every later posting, a resumed pane's included, reads these rows, never
the verdict report's recommendation: a `gate-1: reply` row posts its row's
reply from gate 1; an `override` row, and a `fix` row whose Fixed reply was
finalized, are offered at gate 2; a `skip` row, and a `fix` row under
`code-changes: skip`, post nothing.

`code-changes: revise` re-adjudicates: back to Dispatch one fresh-context
adjudicator over all the review threads, a fresh dispatch with their note
-- never revised in this session, the bias HARD-GATE still applies. A
handed plan is single-use: once recorded it is spent, and the revised
verdicts get a new respond-plan open (handed back to a caller that owns
the gates, asked in the pane on a direct run), never the same plan
again.
`code-changes: skip` (the no-fix sentinel) implements nothing: on to the
row loop, which still redrafts overrides, then gate respond-post. A thread answered `fix:` under `skip` stays
unimplemented and has no finalized reply, so gate respond-post neither
offers nor posts it.

### Implement the thread's fix

Nothing is implemented until `respond-plan` approves it -- not under cover
of "in a follow-up commit," not while drafting. On `code-changes: approve`,
implement the `fix:<threadId>` threads one at a time, verifying each with
the project's tests and checks before the next. A fix row whose commit is
already on the branch (its row carries `sha`, or the branch log shows that
thread's fix) is never implemented again, on a resume or anywhere else.

### Run the project's tests and checks on the fix

Verify this thread's fix with the project's tests and checks before the
next thread starts. Domain ship-time gates still apply to these fixes;
this skill never checks their box. Each failed run charges `run_budget
{runDb, key: fix:<threadId>, limit: 3, stage}`, and `Fix attempts on this
thread = 3?` reads its `exhausted`: the count lives on the run, so a
resumed or compacted pane goes on from it, never from zero.

### Off-script gate: the thread's fix did not converge

Quote the last failing test or check output as the `context`. Propose
the move: revert this thread's uncommitted attempt and leave the row
unimplemented, so no Fixed reply is offered and the row posts nothing.
Ask it per the Off-script gate section.

### Make the recorded move once for the unconverged fix

Revert this thread's uncommitted attempt, exactly once, and leave its row
unimplemented (no Fixed reply, nothing posts for it), then go on to the
next report row.

### Commit the fix and finalize its Fixed reply

Commit the fix. Finalize its reply to "Fixed -- `file:line` / what
changed" and write it over the draft in the thread's report row, with
` · sha: <short sha>` before its `reply` field. The sha belongs to the
report row only: the reply posted to the forge is the Fixed text alone,
never the ` · sha:` field.

A fix whose commit is already on the branch commits nothing again: its
Fixed reply is written from that commit, and its row gets that commit's
`sha`.

### Redraft the override's reply

An override's reply was never seen word for word: redraft it now, per the
reply rules (Draft the verdict table and one reply per thread) as a reply
with no code change and folding in its answer's note when it has one, and
write it into its row.

### Build the respond-post open

This gate offers exactly the replies the developer has not yet seen word
for word: every `gate-1: override` row, and every `gate-1: fix` row whose
Fixed reply was finalized (Report rows). A `gate-1: reply` row is never
offered: it posts its row's reply, unresolved, once the post side runs. A
`skip` row, and a `fix` row whose Fixed reply was never finalized, post
nothing.

- **No thread offered** (no finalized fix and no override): there is no
  respond-post gate and no respond-post record. Go straight to the post
  side, which posts the `gate-1: reply` rows (the respond-plan record
  covers them). A caller that owns the gates gets no open file back, only
  that nothing is offered and which replies posted.
- **Threads offered:** the `gate-1: reply` rows wait, and post once this
  gate proceeds.

<HARD-GATE>
Decision intake: when the caller's `{plan, post}` object already carries
`post`, ask nothing here, but still build the open and store it: the
hand-back `gate_open` (`handBack: true`) keeps the source on the run as
`extra.gate-source.respond-post`, which `respond_post_execute` checks the
decision against, and hands nothing back. Then record the `post` with
`gate_record` (`answers` and `decidedBy`). Otherwise build the open, then
hand it back or run the gate.

**Build the open** in the scratch directory Build the open made (a pane
that made none, a resumed one, makes a new directory inside this session's
scratchpad the same way, never `mktemp -d`), as
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
plus `next`; a `gate-1: reply` row never gets one. Its question's
id is `thread-<n>` by 1-based position among the offered threads, its
label the thread's `file:line`, and its options exactly
`post:<threadId>` and `resolve:<threadId>`, thread id VERBATIM, bare
verb as the label.

| Field | Filled from |
|---|---|
| `post` option | `"recommended": true` on every thread, so nothing drops silently |
| `resolve` option | `"recommended": true` only on a fixed thread; an override stays open for the reviewer unless the developer ticks it |
| `reply@1` context | that one thread: `verb` `fix` with its commit's short `sha` for a fixed thread (a fix with no commit carries no `sha`), `verb` `reply` with no `sha` for an override; `text` the exact reply from its row, never shortened |
| gate `replies` | the offered-thread count |
| gate `fixes` | one entry per commit the fix loop made, the key omitted when there are none |

Post and resolve are independent picks: both, post only, resolve
without replying, or neither (an explicit empty array). Two options per
question keeps every thread under the form cap, whatever the count.
Nothing here is trimmable (a reply is never shortened): `gate_open` fits
the open, and one over the budget goes all prose.
</HARD-GATE>

### respond-post gate_open result?

Read it as `respond-plan gate_open result?` says: opened (the direct run)
keeps `id`, `paneAction`, `formContext` and `formChunks`, and the run now
stores the source as `extra.gate-source.respond-post`, which
`respond_post_execute` checks every decision against; handed back means
the open is at `outPath`; a refused open opened nothing. The way past a
refusal is the source fix or the off-script gate: only `gate_open` fits
the open. A hand-edited open, a shortened reply or a fit with the vendored
script is the STOP on this diamond.

### Handed post: respond-post gate_open result?

A combined `{plan, post}` still stores its respond-post source before the
record: without `extra.gate-source.respond-post` on the run,
`respond_post_execute` refuses every pass. This `gate_open` hands nothing
back to the caller (it already answered); handed back means the source is
stored, with `gate: null`, and the record follows: `gate_record {...,
scope: respond-post, shape: respond-post, answers: <the post>, decidedBy:
<the decider the caller names>}`. A refusal takes the same
`respond-post-open` budget and off-script gate as any respond-post open,
and the fix comes back through `Caller owns the receive-review gates at
respond-post?` to this same call. Never record the handed answers without
the stored source.

### Fix the respond-post source the gate_open refusal names

Each refusal line names a question and a field: fix exactly those in
`<dir>/respond-post.source.json`, never by shortening a reply, then go back
through `Caller owns the receive-review gates at respond-post?` to the
same open. The `respond-post-open` budget was charged for this refusal just
before.

### Off-script gate: the respond-post open will not fit

Quote the last refusal's lines as the `context`. Propose, spelled in full,
one source change for the fields it named, never a shortened reply or a
hand-edited open. The take makes that change, then `gate_open` runs again.
Ask it per the Off-script gate section.

### Make the recorded move once at the respond-post fit

Make the source change the answer recorded, exactly once, then open again
(`Caller owns the receive-review gates at respond-post?` picks which
`gate_open`). Opened or handed back goes on as normal. A refusal that
names a field charges the `respond-post-open` budget, finds it already
exhausted, and returns to this same off-script gate, where the human
answers again.

### Write the receive-review-run line into the handed --report before the respond-post hand-back

The same line as before the respond-plan hand-back: `receive-review-run:
<run id>`, replacing any earlier one, into the handed `--report`; with no
`--report`, write nothing. A fresh pane the board later hands the `{post}`
to resumes this run through it, where the respond-plan decision and both
gate sources already sit.

### Hand back the offered replies and the respond-post open's path

**A caller that owns the gates**: open nothing in the pane. Hand back the
offered replies plus the absolute path of `<dir>/respond-post.open.json`,
then wait for its `{post}`. Its `.questions` end with `next`; a caller
with its own navigation drops that question. Its `{post}` records first
(`gate_record` with `answers: <the post>` and `decidedBy: <the decider the
caller names>`), then the post side acts; hand back which replies posted,
as the no-offer path does.

### Gate respond-post: carry the opened gate through gate-protocol

**Otherwise** the verb runs the gate itself. `gate_open` opened it, so
enter gate-protocol at `Trigger: a site opened its gate with gate_open`
with its result and walk on from `paneAction?`; a gate is never asked or
answered from the shell.

- **form:** `### Present the in-pane gate form`. Show `formContext` in the
  pane, then ask the `formChunks` chunks in order, one AskUserQuestion call
  per chunk. Here `next` is a question of the open itself (**Proceed**,
  recommended / **Iterate here** / **Hold**), so it rides in the chunks:
  never fold it into a thread question. Then submit exactly ONE
  `gate_answer {id, answers, runDb?, stage?}`, with this run's `runDb` and
  `stage`, carrying every thread answer plus `next`. The pane's answer
  never carries `text`: whatever the human types in the form's free-text
  field, a full replacement reply included, rides as `note`, and the
  drafted reply posts.
- **wait:** `rt gate wait <id> as a background Bash task`, then `End the
  turn: holding at gate <id>`; the re-entry is `gate_reconcile {id,
  runDb?, stage?}` with this run's `runDb` and `stage`. An answer from the
  board or console carries the open's `next` like a pane answer, and
  routes the same way: proceed records, hold and iterate record nothing.

A paragraph that lists the replies and waits is not this gate. On this
review gate neither `gate_answer` nor `gate_reconcile` records anything:
the record is `gate_record {..., gateId: <id>}`, and only a `next` of
`proceed` reaches it (`respond_post_execute` refuses a gate whose `next`
is anything else).

### Decide nothing at respond-post: no push, post, resolve or record

A `hold` or `iterate` answer decides nothing, whatever its thread picks
say: nothing pushes, no reply posts, no thread resolves, and no
respond-post decision is recorded (no `gate_record`, no
`respond_post_execute`), so every offered thread stays pending and the
`gate-1: reply` rows keep waiting. The gate is still answered with its
`next` (one `gate_answer` in the pane, unlike respond-plan's pane-only
`next`), so it closes rather than staying open. A `hold` ends the turn
through `run_hold` (Run); that is not a respond-post decision.

### Apply the respond-post note

Redraft what the note asks (an override's reply, per the reply rules) and
write it into its row, then build the open again. The re-ask is a NEW gate
(gate-protocol's Closed gates, Hold / Iterate) with its own id, never a
second answer to the one just closed: its proceed records with that new
`gateId`. A record against the earlier gate is stale and refused.

### gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy}

The respond-post decision records BEFORE the post side, once per gate:
`gateId` for the gate this pane carried (after an Iterate, the newest
gate's id), or `answers` plus `decidedBy` for a caller-handed `{post}`.
The tool builds the `{threads, held?}` selection from the answers and the
stored source, keyed by thread id; never build it by hand. Nothing else
records this scope on GitLab: `respond_post_execute` re-records the
decision itself with the ids it holds.

### respond_post_execute {runDb, tree, stage}

GitLab's whole post side is this one call: `runDb`, `tree` = this
checkout's root (the tree the fixes were committed in, a checkout or
worktree registered with rt, as `git_push` needs), and `stage`. It checks
both recorded decisions against their gate sources, reads every thread
once, pushes the run's branch only when a picked thread is a fix row,
posts each picked reply and every `gate-1: reply` row, resolves the picked
threads, and counts what already landed (`alreadyPosted`,
`alreadyResolved`). It is idempotent, so a resume, a take and an iterate
all call it again; on a held resume it acts only on the held threads. It
refuses GitHub: there the gh sub-graph posts, and no `mr_*` tool is
called.

### respond_post_execute result?

- **Refused** (an error before anything moved): a line naming a field, a
  record or the tree is fixable once; a refusal nothing on this run can
  mend (no respond-plan decision or gate source on it, a handed `{post}`
  in a fresh run) goes straight to its off-script gate, quoted.
- **`held` is empty:** every due reply and resolve is done (posted or
  already there). `hold` may still read `held` from an earlier pass, and
  the tool never clears it.
- **A `reply` or `resolve` entry in `held`:** one off-script gate for the
  batch, whatever else is held.
- **Only `push`, `mismatch` or `read` entries in `held`:** nothing the
  human can answer here changes them this pass; report them.

The tool already set `hold` to `held` whenever `held` is not empty.
`writeErrors`, when present, is quoted in the report.

### Fix what the respond_post_execute refusal names

Fix exactly what the refusal line names with a move this graph already
draws (the registered `tree` for a tree mismatch; a respond-post record
for a scope the run has not recorded), then call again. Never re-record a
scope the run already recorded, and never edit the run by hand. The
`post-execute-fix` budget was read and then charged just before; a second
refusal finds it exhausted and opens the off-script gate.

### Off-script gate: respond_post_execute refused

Quote the refusal whole as the `context`. Propose, spelled in full, the
move that would let the call act (the record or source it names, a new
respond-post gate when it asks for an override). The take makes that move
once, then calls again. Ask it per the Off-script gate section.

### Make the recorded move once for the respond_post_execute refusal

Make the move the answer recorded, exactly once, then call
`respond_post_execute` again. A refusal after it returns to this same
off-script gate, since the `post-execute-fix` budget stays spent.

### Off-script gate: the forge refused a reply or resolve

One gate for every reply or resolve the forge refused this pass. The tool
already retried each once, re-reading a reply before its retry. Quote each
held entry as the `context`: its `threadId`, `kind` and `error`, the error
whole and unedited, never a summary. Any `push`, `mismatch` or `read`
entries ride in the same context and stay held whatever the answer.
Propose the move: the human posts or resolves those threads by hand, then
this verb calls `respond_post_execute` again, which finds them on the
forge (`alreadyPosted`, `alreadyResolved`). Ask it per the Off-script gate
section.

- **Take:** the human made the move; call again.
- **Iterate:** they fixed the cause; call again.
- **Hold:** the tool already set `hold`, so no `run_hold`: report the held
  threads verbatim and end with threads held.
- **Hand back:** close as abandoned (own run) or fail the stage.

### Report the held threads verbatim

Report every `held` entry: its thread, its `kind`, and its `error` whole
and unedited in a fenced block, never a summary, a paraphrase, or an
excerpt with parts elided. Say which replies posted and resolved
(`posted`, `alreadyPosted`, `resolved`, `alreadyResolved`), in the
hand-back when a caller owns the gates. A `mismatch` names what HEAD,
`@{push}` and `@{u}` printed: never switch branches, rebase or push to
make them match, even when the error names a fix; the developer decides,
and a resume calls the tool again, acting only on the held threads. The
run stays open with `hold` at `held` (the tool set it); no `run_hold`.

### run_field_set {runDb, key: hold, value: -, stage}

A pass that ends with nothing held clears `hold`: an earlier pass, a take
or an iterate in this session, or the tool itself may have set it, and
the tool never clears it. Then report and close.

### Posted already on GitHub: read every thread with gh

GitHub has no composite tool, so read every thread's full note chain with
`gh`, fresh, every time the graph reaches this box; the earlier read of
the PR's review threads never stands in for it. A thread that already
carries this run's reply (a note whose text is the reply due, or any note
by the account this run posts as dated after the run's `started_at`) is
posted: it never posts again, whatever the record or the report says. On
a resume whose respond-post record carries `held`, act only on the held
threads. With no result (an error, or a thread whose notes did not come
back), nothing posts: set `hold` to `held`, report the error verbatim, and
leave the run open; a resume retries the read.

### Hold the picked fix rows and report the failure verbatim

On GitHub, a failed push (a target mismatch or a push error) holds the
picked `gate-1: fix` rows: post and resolve none of them, and report the
mismatch or the error verbatim, the error `git_push` returned or the
output of the two git reads, whole and unedited, in a fenced block. Never
force, rebase or merge past it. Every other reply posts as decided. Once
the threads are done, the decision records again with the held ids
(`gate_record {..., held}`) and `hold` is set to `held`, so a resume acts
only on them; a caller that owns the gates is told which replies posted
and which threads are held before the turn ends.

### Post the reply on GitHub with gh

Post this thread's reply (the text Acting on respond-post names) in the
thread with `gh`, never as a top-level comment.

### Resolve the thread on GitHub with gh

Resolve the thread with `gh`, after its reply when both are picked.

### Report the outcome (to the caller when it owns the gates)

Zero unresolved human threads: say so. Otherwise say which replies posted
and which threads resolved (on GitLab from `posted`, `alreadyPosted`,
`resolved` and `alreadyResolved`), quoting any `writeErrors`. A caller
that owns the gates gets the same: with nothing offered, no open file
back, only that nothing is offered and which replies posted; after acting
on its `{post}`, which replies posted. When threads are held, the run ends
held instead, and Report the held threads verbatim (GitHub: Hold the
picked fix rows and report the failure verbatim) carries this report.

## What the graph cannot show

**Acting on respond-post.** Act only once respond-post proceeds: its
`next` answer is `proceed`, or a caller handed `post`, which carries no
`next`. A `hold` or `iterate` answer decides nothing (Decide nothing at
respond-post). Never a top-level note, never approve the change: that
stays the developer's, however settled a thread looks once its reply is
written. On GitLab `respond_post_execute` does every act below; on GitHub
the gh sub-graph does them by hand.

**Push before any Fixed reply.** On GitHub (on GitLab
`respond_post_execute` pushes), and only when the picks post or resolve
at least one `gate-1: fix` row; otherwise push nothing. Once
respond-post proceeds, or a caller hands `post`, and before acting on
those rows:

1. Check the target: `git branch --show-current` must print the MR's
   source branch (the `branch` recorded at Resolve the change and record
   its identity, else the forge's), and `git rev-parse --abbrev-ref
   @{push}` must print that branch on its remote
   (`origin/<source branch>`). Any other output, an error included, is a failed push;
   never switch branches to make it match.
2. Push that one branch with `git_push`, `tree` = this worktree: it
   pushes only the current branch (the one the check verified) to its
   same-named upstream by explicit refspec, never a bare push. That
   proceed is the authorization: ask nothing more.

**Acting per thread on GitHub.** Read each `thread-<n>` answer (a
`{value, note, text}` object unwraps to its `value`; the note rides the
decision record and never edits the reply) and split each value at the first `:`
into the verb and the thread id: `post:<threadId>` posts that thread's
reply, which is the answer's `text` when it carries one and the `reply@1`
context's `text` otherwise; `resolve:<threadId>` resolves the thread,
after its reply when both are picked and on its own when only resolve is;
an empty array leaves the thread untouched. Then post every `gate-1:
reply` row that does not already carry this run's reply, its row's reply,
unresolved: this gate never offers those threads, so they post whatever
it picked for its own threads. Nothing else posts, through any channel.

## Off-script gate

Every `Off-script gate: ...` box opens gate-protocol's `## Off-script
gate` with site `receive-review`: scope `off-script:receive-review:<n>`
(`n` from 1 within the site's attempt), `context` quoting the refusal or
failure verbatim, and its `action` and `next` questions, under the run with
`runDb` and `stage`. The include defines the questions and what the answers
map records. A board that owns the receive-review gates does not own these:
they open in this pane.

The answer diamond after each box reads it: `action: handback` is hand
back whatever `next` says; otherwise `next` picks, proceed taking the
move, iterate redoing that site with their note, hold holding (at the
forge-refusal site the threads stay held with no `run_hold`: the tool
already set `hold`; take and iterate there both call `respond_post_execute`
again). After an iterate or take answer,
the site's budget stays spent: the next failure there returns to the same
off-script gate, where the human answers again. Take makes exactly that
move once. Hand back closes an own run with `outcome: abandoned` and fails
an inherited run's stage, with the why as its `reason`; when a caller owns
the gates, also carry the why in the hand-back. A gate that comes back
`closed` is a hold whose reason is "gate closed".

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

## Criteria

{{slot:criteria}}

The Criteria section above is the domain's review standards, when the pack
binds them: evaluate the triage lines it declares against this change, and
pass its addendum with `{TRIAGE_FLAGS}` (those resolved values) and
`{SETUP_OBSERVATIONS}` (what was already gathered, else `none`) filled, the
rest verbatim. No depth block here; the addendum informs the per-thread
verdicts.

**One dispatch, all threads together.** Related comments must be judged with
shared context; a partial reading produces wrong conclusions and a wrong
implementation follows it. This batching rule is this skill's own, held
whatever the slots bind.

Per thread it returns `valid` / `pushback` / `needs-clarification`, plus that
entry's relations.

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
| "I wrote this, I can tell if the reviewer is right" | That is the author bias. Dispatch the fresh-context adjudication (Dispatch one fresh-context adjudicator over all the review threads). |
| "It's a small comment, I'll just judge it here" | Small own-code judgments are the peak of the bias. Dispatch it. |
| "I'll run self-review at the end as the check" | Too late. The fresh context adjudicates the comments; it is not a gut-check after. |
| "I'll open with 'Good call' / 'You're right'" | Performative. State the technical content; no agreement, no thanks. |
| "I'll process the resolved / bot threads too" | Unresolved human threads only. On GitLab `mr_threads {filter: "unresolved-human"}` already dropped the rest: never filter its result again or add a dropped thread back. On GitHub, apply the username rule by hand. |
| "I'll ask both gate questions, the caller already handed `{plan, post}`" | Decision intake first: a caller-handed object answers `respond-plan` and `respond-post` -- ask nothing. |
| "I'll post the replies since they look right" | Post only what an answer picked: a `gate-1: reply` row, or an offered thread whose answer carries `post:`; resolve only those carrying `resolve:`; never approve for the developer. |
| "I'll offer the reply-only threads at `respond-post` too, for a last look" | The developer already saw that exact reply. `respond-post` offers only the replies they have not seen word for word: fixed threads and `reply:` overrides with no `text`. |
| "I know the contexts were dropped; I'll apply that when the answer comes" | A pane that dies takes that knowledge with it. Write `gate-1-context: dropped` into the saved report right after the open. |
| "I'll work out the overrides and texts from the answers myself" | `gate_record` computes them, keyed by thread id. Write its `rows` as they come back. |
| "The resumed run lost its rows, so I'll record respond-plan again to get them back" | Never re-record a recorded scope: it moves `decided_at`, which the post side reads. Join the recorded decision to the stored cards instead. |
| "The verdict report recommended a reply here, so it posts" | Posting reads each report row's `gate-1` field, never the recommendation. A `gate-1: skip` row posts nothing. |
| "The gate approved posting, not a push, so I'll ask before pushing" | The proceed authorizes the push. On GitLab `respond_post_execute` pushes before any Fixed reply; on GitHub check the branch and `@{push}`, then `git_push`. |
| "The fix is held on a branch mismatch; I'll switch branches, or push from the shell, and go on" | Never. A held push, mismatch or read is reported verbatim and the run stays open for a resume. On GitLab only `respond_post_execute` pushes; on GitHub only `git_push`, never forced. |
| "The forge refused one reply, so I'll post it myself with `mr_reply_thread`" | The tool already retried it. Open the one off-script gate for the batch; take and iterate both call `respond_post_execute` again, which counts a reply the human posted. |
| "They ticked post before choosing Iterate (or Hold), so those picks act now" | Only `proceed` acts. On `hold` or `iterate` nothing pushes, posts, resolves or records, whatever the picks; every offered thread stays pending, and the re-ask is a new gate over the threads not yet posted. |
| "The run already records respond-post with nothing held, so it posted; I'll close" | A pane can record and die before it posts. Run the post side again: `respond_post_execute` counts what landed, and on GitHub the gh read does. |
| "This one is clearly right, I'll add the guard in a follow-up commit" | Implementation follows `respond-plan`'s `code-changes: approve`, not a line in the draft. |
| "It's wrong, but I need the reviewer to point me at it" | Then it is `needs-clarification`, not `pushback`. |
| "The pane is fresh, so I'll adjudicate again before applying the handed plan" | A handed plan answers an adjudication the human already saw. Record it and execute it; a fresh adjudication would change the drafts it approved. Read the threads only for what execution needs. |
| "The caller asked the respond-plan gate, so it records the decision" | This verb records it: a handed `{plan}` goes through `gate_record {..., answers, decidedBy}`, the same record a pane answer gets with `gateId`. A resume reads that record. |
| "I'll present the table and ask about fixes and posting in the same breath" | `respond-plan` and `respond-post` are two gates, in order. Prose that asks both at once is neither. |

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
