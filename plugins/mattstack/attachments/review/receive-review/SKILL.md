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
    "STOP: never hand-edit or hand-fit the respond-plan open; open its off-script gate" [shape=octagon style=filled fillcolor=red fontcolor=white];
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

    "Resumed, or re-asking after respond-post Hold or Iterate?" [shape=diamond];
    "Posted already: read each thread on the forge" [shape=box];
    "Forge for the posted-already read?" [shape=diamond];
    "mr_threads {mrUrl} for the posted-already read" [shape=plaintext];
    "Read the PR's threads with gh for the posted-already test" [shape=box];
    "Which threads does the posted-already read show carrying this run's reply?" [shape=diamond];
    "Resuming a respond-post record that carries held?" [shape=diamond];
    "Any thread offered (a finalized fix or an override)?" [shape=diamond];
    "Nothing offered: caller handed a respond-post decision?" [shape=diamond];
    "Threads offered: caller handed the respond-post answers?" [shape=diamond];
    "Build the respond-post open" [shape=box];
    "sh ${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh fit < <dir>/respond-post.source.json > <dir>/respond-post.open.json" [shape=plaintext];
    "respond-post fit exit code?" [shape=diamond];
    "respond-post fit attempts = 3?" [shape=diamond];
    "Fix the respond-post source the fit names" [shape=box];
    "Off-script gate: the respond-post open will not fit" [shape=box];
    "Answer at the respond-post fit off-script gate?" [shape=diamond];
    "Make the recorded move once at the respond-post fit" [shape=box];
    "Caller owns the receive-review gates at respond-post?" [shape=diamond];
    "Hand back the offered replies and the respond-post open's path" [shape=box];
    "Gate respond-post through gate-protocol" [shape=box];
    "respond-post next answer?" [shape=diamond];
    "Decide nothing at respond-post: no push, post, resolve or record" [shape=box];
    "Apply the respond-post note" [shape=box];

    "Picks post or resolve a gate-1: fix row?" [shape=diamond];
    "git branch --show-current" [shape=plaintext];
    "git rev-parse --abbrev-ref @{push}" [shape=plaintext];
    "Both name the MR's source branch?" [shape=diamond];
    "git_push {tree: <worktree root>}" [shape=plaintext];
    "git_push result for the fix rows?" [shape=diamond];
    "STOP: a failed git_push holds the fix rows; never push from the shell, never force" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Hold the picked fix rows and report the failure verbatim" [shape=box];
    "Hold the thread the forge refused and report the refusal verbatim" [shape=box];

    "Next thread to act on: offered threads, then gate-1: reply rows?" [shape=diamond];
    "post: decided for this thread?" [shape=diamond];
    "Thread already carries this receive-review run's reply?" [shape=diamond];
    "Forge for the reply?" [shape=diamond];
    "mr_reply_thread {mrUrl, discussionId, body}" [shape=plaintext];
    "mr_reply_thread result?" [shape=diamond];
    "Retried this mr_reply_thread once?" [shape=diamond];
    "STOP: a refused mr_reply_thread goes to its off-script gate, never the GitLab CLI" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Off-script gate: the forge refused the reply" [shape=box];
    "Answer at the refused-reply off-script gate?" [shape=diamond];
    "Make the recorded move once for the refused reply" [shape=box];
    "Post the reply on GitHub with gh" [shape=box];
    "resolve: decided for this thread?" [shape=diamond];
    "Forge for the resolve?" [shape=diamond];
    "mr_resolve_thread {mrUrl, discussionId}" [shape=plaintext];
    "mr_resolve_thread result?" [shape=diamond];
    "Retried this mr_resolve_thread once?" [shape=diamond];
    "STOP: a refused mr_resolve_thread goes to its off-script gate, never the GitLab CLI" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Off-script gate: the forge refused the resolve" [shape=box];
    "Answer at the refused-resolve off-script gate?" [shape=diamond];
    "Make the recorded move once for the refused resolve" [shape=box];
    "Resolve the thread on GitHub with gh" [shape=box];

    "respond-post decided by a gate or a handed post?" [shape=diamond];
    "run_decision {contract: gate@1, scope: respond-post, selection, decidedBy}" [shape=plaintext];
    "Any thread held this pass: a failed push or a forge refusal?" [shape=diamond];
    "Report the outcome (to the caller when it owns the gates)" [shape=box];
    "This verb started or resumed the run?" [shape=diamond];

    "Own receive-review run: close it as failed?" [shape=diamond];
    "Own receive-review run: close it as abandoned?" [shape=diamond];
    "run_close {runDb, workType: receive-review, stage: receive-review, outcome}" [shape=plaintext];
    "receive-review closed as?" [shape=diamond];
    "run_stage {action: fail, stage: <stage>, reason}" [shape=plaintext];
    "run_hold {runDb, stage, reason, decidedBy}" [shape=plaintext];
    "run_field_set {key: hold, value: held, stage: <stage>}" [shape=plaintext];

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
    "What does the receive-review snapshot record?" -> "Posted already: read each thread on the forge" [label="respond-post record carrying held"];
    "What does the receive-review snapshot record?" -> "Report the outcome (to the caller when it owns the gates)" [label="respond-post recorded, nothing held"];
    "run_field_get {runDb, key: extra.gate-source.respond-plan}" -> "Rewrite the receive-review report rows" [label="the stored cards, or an unset-key error: none stored"];
    "What did the caller hand receive-review?" -> "Resolve the change and record its identity" [label="nothing, or a {plan} (alone or in {plan, post})"];
    "What did the caller hand receive-review?" -> "Posted already: read each thread on the forge" [label="a {post} alone, with its report rows"];

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
    "Executing a caller-handed {plan}?" -> "gate_record {runDb, stage, scope: respond-plan, shape: respond-plan, gateId | answers + decidedBy, contextDropped?}" [label="yes, not yet spent: record it, read no threads, never re-adjudicate"];
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
    "respond-plan gate_open result?" -> "STOP: never hand-edit or hand-fit the respond-plan open; open its off-script gate" [label="tempted to edit the open by hand, shorten a reply, or fit it with a script"];
    "STOP: never hand-edit or hand-fit the respond-plan open; open its off-script gate" -> "Off-script gate: the respond-plan open will not fit";
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
    "Next report row, in verdict-table order?" -> "Resumed, or re-asking after respond-post Hold or Iterate?" [label="rows done"];
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

    "Resumed, or re-asking after respond-post Hold or Iterate?" -> "Posted already: read each thread on the forge" [label="yes"];
    "Resumed, or re-asking after respond-post Hold or Iterate?" -> "Any thread offered (a finalized fix or an override)?" [label="no"];
    "Posted already: read each thread on the forge" -> "Forge for the posted-already read?";
    "Forge for the posted-already read?" -> "mr_threads {mrUrl} for the posted-already read" [label="GitLab"];
    "Forge for the posted-already read?" -> "Read the PR's threads with gh for the posted-already test" [label="GitHub"];
    "mr_threads {mrUrl} for the posted-already read" -> "Which threads does the posted-already read show carrying this run's reply?";
    "Read the PR's threads with gh for the posted-already test" -> "Which threads does the posted-already read show carrying this run's reply?";
    "Which threads does the posted-already read show carrying this run's reply?" -> "Resuming a respond-post record that carries held?" [label="none: every thread due still posts or is offered"];
    "Which threads does the posted-already read show carrying this run's reply?" -> "Resuming a respond-post record that carries held?" [label="some or all: count those posted, never post or offer them again"];
    "Which threads does the posted-already read show carrying this run's reply?" -> "run_field_set {key: hold, value: held, stage: <stage>}" [label="no result, or an error: hold, the error verbatim"];
    "Resuming a respond-post record that carries held?" -> "Picks post or resolve a gate-1: fix row?" [label="yes: act on the held threads only"];
    "Resuming a respond-post record that carries held?" -> "Any thread offered (a finalized fix or an override)?" [label="no, or a held override has no recorded text: offer it again"];
    "Any thread offered (a finalized fix or an override)?" -> "Nothing offered: caller handed a respond-post decision?" [label="no"];
    "Any thread offered (a finalized fix or an override)?" -> "Threads offered: caller handed the respond-post answers?" [label="yes"];
    "Nothing offered: caller handed a respond-post decision?" -> "Picks post or resolve a gate-1: fix row?" [label="yes: it decides first"];
    "Nothing offered: caller handed a respond-post decision?" -> "Next thread to act on: offered threads, then gate-1: reply rows?" [label="no: no gate, no record"];
    "Threads offered: caller handed the respond-post answers?" -> "Picks post or resolve a gate-1: fix row?" [label="yes: ask nothing"];
    "Threads offered: caller handed the respond-post answers?" -> "Build the respond-post open" [label="no"];
    "Build the respond-post open" -> "sh ${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh fit < <dir>/respond-post.source.json > <dir>/respond-post.open.json";
    "sh ${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh fit < <dir>/respond-post.source.json > <dir>/respond-post.open.json" -> "respond-post fit exit code?";
    "respond-post fit exit code?" -> "Caller owns the receive-review gates at respond-post?" [label="0"];
    "respond-post fit exit code?" -> "respond-post fit attempts = 3?" [label="1: contract problems"];
    "respond-post fit attempts = 3?" -> "Fix the respond-post source the fit names" [label="no"];
    "respond-post fit attempts = 3?" -> "Off-script gate: the respond-post open will not fit" [label="yes"];
    "Fix the respond-post source the fit names" -> "sh ${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh fit < <dir>/respond-post.source.json > <dir>/respond-post.open.json";
    "Off-script gate: the respond-post open will not fit" -> "Answer at the respond-post fit off-script gate?";
    "Answer at the respond-post fit off-script gate?" -> "Make the recorded move once at the respond-post fit" [label="take"];
    "Answer at the respond-post fit off-script gate?" -> "Fix the respond-post source the fit names" [label="iterate: fix again with their note"];
    "Answer at the respond-post fit off-script gate?" -> "run_hold {runDb, stage, reason, decidedBy}" [label="hold"];
    "Answer at the respond-post fit off-script gate?" -> "Own receive-review run: close it as abandoned?" [label="hand back"];
    "Make the recorded move once at the respond-post fit" -> "sh ${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh fit < <dir>/respond-post.source.json > <dir>/respond-post.open.json";
    "Caller owns the receive-review gates at respond-post?" -> "Hand back the offered replies and the respond-post open's path" [label="yes"];
    "Caller owns the receive-review gates at respond-post?" -> "Gate respond-post through gate-protocol" [label="no: a direct run"];
    "Hand back the offered replies and the respond-post open's path" -> "Picks post or resolve a gate-1: fix row?" [label="caller hands {post} back"];
    "Gate respond-post through gate-protocol" -> "respond-post next answer?";
    "respond-post next answer?" -> "Picks post or resolve a gate-1: fix row?" [label="proceed"];
    "respond-post next answer?" -> "Decide nothing at respond-post: no push, post, resolve or record" [label="hold"];
    "respond-post next answer?" -> "Apply the respond-post note" [label="iterate"];
    "Decide nothing at respond-post: no push, post, resolve or record" -> "run_hold {runDb, stage, reason, decidedBy}";
    "Apply the respond-post note" -> "Posted already: read each thread on the forge" [label="a new gate"];

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
    "Hold the thread the forge refused and report the refusal verbatim" -> "Next thread to act on: offered threads, then gate-1: reply rows?" [label="every other thread still acts"];

    "Next thread to act on: offered threads, then gate-1: reply rows?" -> "post: decided for this thread?" [label="next thread; a held resume walks only the held threads; a thread held this pass acts on nothing"];
    "Next thread to act on: offered threads, then gate-1: reply rows?" -> "respond-post decided by a gate or a handed post?" [label="threads done"];
    "post: decided for this thread?" -> "Thread already carries this receive-review run's reply?" [label="yes"];
    "Thread already carries this receive-review run's reply?" -> "resolve: decided for this thread?" [label="yes: count it posted, never post again"];
    "Thread already carries this receive-review run's reply?" -> "Forge for the reply?" [label="no: post it"];
    "post: decided for this thread?" -> "resolve: decided for this thread?" [label="no"];
    "Forge for the reply?" -> "mr_reply_thread {mrUrl, discussionId, body}" [label="GitLab"];
    "Forge for the reply?" -> "Post the reply on GitHub with gh" [label="GitHub"];
    "mr_reply_thread {mrUrl, discussionId, body}" -> "mr_reply_thread result?";
    "mr_reply_thread result?" -> "resolve: decided for this thread?" [label="posted"];
    "mr_reply_thread result?" -> "Retried this mr_reply_thread once?" [label="error"];
    "mr_reply_thread result?" -> "STOP: a refused mr_reply_thread goes to its off-script gate, never the GitLab CLI" [label="tempted by the GitLab CLI"];
    "Retried this mr_reply_thread once?" -> "Thread already carries this receive-review run's reply?" [label="no: re-test, then retry"];
    "Retried this mr_reply_thread once?" -> "Off-script gate: the forge refused the reply" [label="yes"];
    "STOP: a refused mr_reply_thread goes to its off-script gate, never the GitLab CLI" -> "Off-script gate: the forge refused the reply";
    "Off-script gate: the forge refused the reply" -> "Answer at the refused-reply off-script gate?";
    "Answer at the refused-reply off-script gate?" -> "Make the recorded move once for the refused reply" [label="take"];
    "Answer at the refused-reply off-script gate?" -> "Thread already carries this receive-review run's reply?" [label="iterate: re-test, then retry with their note"];
    "Answer at the refused-reply off-script gate?" -> "Hold the thread the forge refused and report the refusal verbatim" [label="hold: this thread only"];
    "Answer at the refused-reply off-script gate?" -> "Own receive-review run: close it as abandoned?" [label="hand back"];
    "Make the recorded move once for the refused reply" -> "resolve: decided for this thread?";
    "Post the reply on GitHub with gh" -> "resolve: decided for this thread?";
    "resolve: decided for this thread?" -> "Forge for the resolve?" [label="yes"];
    "resolve: decided for this thread?" -> "Next thread to act on: offered threads, then gate-1: reply rows?" [label="no"];
    "Forge for the resolve?" -> "mr_resolve_thread {mrUrl, discussionId}" [label="GitLab"];
    "Forge for the resolve?" -> "Resolve the thread on GitHub with gh" [label="GitHub"];
    "mr_resolve_thread {mrUrl, discussionId}" -> "mr_resolve_thread result?";
    "mr_resolve_thread result?" -> "Next thread to act on: offered threads, then gate-1: reply rows?" [label="resolved"];
    "mr_resolve_thread result?" -> "Retried this mr_resolve_thread once?" [label="error"];
    "mr_resolve_thread result?" -> "STOP: a refused mr_resolve_thread goes to its off-script gate, never the GitLab CLI" [label="tempted by the GitLab CLI"];
    "Retried this mr_resolve_thread once?" -> "mr_resolve_thread {mrUrl, discussionId}" [label="no"];
    "Retried this mr_resolve_thread once?" -> "Off-script gate: the forge refused the resolve" [label="yes"];
    "STOP: a refused mr_resolve_thread goes to its off-script gate, never the GitLab CLI" -> "Off-script gate: the forge refused the resolve";
    "Off-script gate: the forge refused the resolve" -> "Answer at the refused-resolve off-script gate?";
    "Answer at the refused-resolve off-script gate?" -> "Make the recorded move once for the refused resolve" [label="take"];
    "Answer at the refused-resolve off-script gate?" -> "mr_resolve_thread {mrUrl, discussionId}" [label="iterate: retry with their note"];
    "Answer at the refused-resolve off-script gate?" -> "Hold the thread the forge refused and report the refusal verbatim" [label="hold: this thread only"];
    "Answer at the refused-resolve off-script gate?" -> "Own receive-review run: close it as abandoned?" [label="hand back"];
    "Make the recorded move once for the refused resolve" -> "Next thread to act on: offered threads, then gate-1: reply rows?";
    "Resolve the thread on GitHub with gh" -> "Next thread to act on: offered threads, then gate-1: reply rows?";

    "respond-post decided by a gate or a handed post?" -> "run_decision {contract: gate@1, scope: respond-post, selection, decidedBy}" [label="yes, or a held resume re-records"];
    "respond-post decided by a gate or a handed post?" -> "Any thread held this pass: a failed push or a forge refusal?" [label="no: nothing was offered or handed"];
    "run_decision {contract: gate@1, scope: respond-post, selection, decidedBy}" -> "Any thread held this pass: a failed push or a forge refusal?";
    "Any thread held this pass: a failed push or a forge refusal?" -> "run_field_set {key: hold, value: held, stage: <stage>}" [label="yes"];
    "Any thread held this pass: a failed push or a forge refusal?" -> "Report the outcome (to the caller when it owns the gates)" [label="no"];
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
nothing is exported. `<stage>` below is `receive-review` on a run you
started or resumed. On a run you inherited (`mode: inherited`, a running
run a caller handed you), it is the result's `at.stage`, and the caller
closes the run. A handed `runDb` whose run is no longer running is not
inherited: `run_enter` carries on as if none was handed, and its result
says `handedRunDb: "not-running"`.

Every gate after `run_enter` runs through gate-protocol with `runDb` and
`stage`, so the gate tools write the run's gate fields. The clarify and
off-script gates record their answers map when answered. `respond-plan` is
a review gate: its answer records nothing until this verb's `gate_record`.
The respond-plan path writes no `gate` field and no gate decision by hand.

Every loop counter is a `run_budget {runDb, key, limit, stage}` call: each
counted failure charges `increment: 1` (the default), the counter diamond
reads the result's `exhausted`, and the count survives compaction and
resume, so a resumed pane never restarts it. The keys:

| Key | Limit | Counts |
|---|---|---|
| `respond-plan-open` | 3 | respond-plan `gate_open` refusals that name a source field |
| `fix:<threadId>` | 3 | failed test-and-check runs on that thread's fix |

A Hold that ends the turn (the edge to Held: end the turn naming the run
and stage), own or inherited run, is the one `run_hold {runDb, stage,
reason, decidedBy}` call: `reason` the human's words or the quoted error,
`decidedBy` the answer's by. It computes the attempt and writes the `hold`
field; then the turn ends. The clarify Hold comes before any run and
records nothing.

A thread hold is the other case: threads left held (a failed push, or a
forge-refusal Hold that holds only its thread) and a posted-already read
that returned no result or an error make no `run_hold` call (held threads
keep their `"held"` entry); set `run_field_set` with `key: "hold"`,
`value: "held"`, `stage: <stage>` before the turn ends. A read error is
reported verbatim (to the caller when it owns the gates), the run stays
open, and a resume retries the read. A resume clears the field.

The close runs only when this verb started or resumed the run, after every
reply has posted and every decision is recorded: `run_close {runDb,
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
- **A `respond-post` record carrying `"held"`:** read each thread on the
  forge first (Posted already), then treat every other offered thread as
  already acted on and act only on the held threads. Push only when a held
  thread is a `gate-1: fix` row whose picks post or resolve it, and act on
  those rows only once the branch check and the push succeed (Push before
  any Fixed reply); a held override or `gate-1: reply` row acts with no
  push. A held thread the forge already shows carrying this run's reply
  goes straight to its resolve decision. Then record again, without
  `"held"`, or with the threads still held. The reply due for a held
  thread comes from the report rows when the report exists; in a fresh
  pane without it, from the run: the respond-post entry's `text` when it
  has one, else the respond-plan decision joined to the stored cards, as
  under Rewrite the receive-review report rows. A held override posts only
  the text recorded for it (the respond-post entry's `text`, else the
  respond-plan record's `texts` entry). With neither, it is never posted
  as a redraft the developer has not seen: redraft it (Redraft the
  override's reply) and offer it, with every held thread not yet posted, at
  a new respond-post gate. A held fix row with neither gets its Fixed reply
  text written again from the committed change, in the shape Commit the
  fix and finalize its Fixed reply gives it, before it posts; nothing is
  committed again.
- **`respond-post` recorded, nothing held:** report the outcome and close.

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
respond-post, where it is the caller-handed `post`. A `{post}` alone goes
straight to the post side: its plan decision is already on the run.

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

A caller-handed `{plan}` not yet spent records at once, before any thread
read: `gate_record {runDb, stage, scope: respond-plan, shape:
respond-plan, answers: <the plan>, decidedBy: <the decider the caller
names>}`, plus `contextDropped: true` when the handed `--report` carries
the line `gate-1-context: dropped`. Never dispatch the adjudicator or draft
a new verdict table for it: a plan answers an adjudication the human
already saw, so a fresh one would change the drafts it approved.

It reads no threads either. Its rows come from the record and the cards the
open stored on the run (`extra.gate-source.respond-plan`), so every thread
the plan names gets its row, resolved on the forge or not, and a thread it
does not name gets none. A card carries what the row walk needs: the
thread's `file:line`, the reviewer's claim and points, the verdict, the
drafted reply and the planned change.

On a run with no stored cards (no `receive-review-run:` line in the handed
`--report`, or a refused resume), the plan still records: with no card to
show a draft was seen, every `reply:` answer without `text` comes back an
override.

The plan is spent once the run records it. Spent, not a revise: go to the
rows from that record, never record it again. A revise: adjudicate afresh.

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

The way past a refusal is the source fix or the off-script gate. A
hand-edited open, a shortened reply or a fit with the vendored script is
the STOP on this diamond.

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

Record that `{plan}` before rewriting the rows: `gate_record {runDb,
stage, scope: respond-plan, shape: respond-plan, answers: <the plan>,
decidedBy: <the decider the caller names>}`, plus `contextDropped: true`
when the open's result said so or the saved report carries the line
`gate-1-context: dropped`. This verb records the respond-plan decision
whoever asked the gate.

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

### Posted already: read each thread on the forge

**Posted already.** On any resume, a caller replaying a parked gate's
answer into a fresh pane or the snapshot alone, read each thread on the
forge (its full note chain, the `mr_threads` fetch, or `gh` on
GitHub) before its reply posts or a
re-asked `respond-post` offers it. A thread that already carries this
run's reply, a note whose text is the reply due to post or any note by
the account this run posts as dated after the run's `started_at`, is
posted: the close no longer waits on it, an offered thread's respond-post
entry reads `post: true` (a `gate-1: reply` row gets no entry, as ever),
it is never offered at a re-asked gate, and it is never posted again,
whatever the snapshot or the report says of it. Only a thread with no
such note posts or is offered.

This read is made here, after the report rows, every time the graph
reaches this box: `mr_threads {mrUrl} for the posted-already read` on GitLab, Read the PR's threads with gh for the posted-already test on GitHub. A read made earlier
in the run, for a redraft or at the start, never stands in for it; its
result, and only its result, is what the post-site test uses. Write the
verdict down here, one line per thread, from the notes this read
returned, before anything is offered or posted: the thread, then
`posted` (naming the note that shows it) or `not posted`. Each verdict
comes only from the notes this read returned. When those notes are not
in front of you (describing the run rather than making it), a thread's
verdict line gives both outcomes: if it carries this run's reply, it is
counted posted and nothing posts or is offered for it; if not, it posts
or is offered. Never a single verdict inferred from thread open times,
the snapshot or the report. Threads it shows carrying this run's reply
are counted posted and drop out of every
post and offer; the rest still post or are offered. With no result (an
error, or a thread whose notes did not come back), nothing posts and
nothing is offered: the run holds. No gate answered, so there is no
`hold:<stage>:<attempt>` decision: set `hold` to `held`, report the
error verbatim (to the caller when it owns the gates), and leave the run
open. A resume retries the read.

The ask that follows a respond-post hold, once it lifts, or an iteration,
once it is applied, is a NEW gate (gate-protocol's Closed gates, Hold /
Iterate). Read the forge first, then build its open: the report rows
minus every thread already posted, one whose respond-post record entry
has `post: true`, or one the forge shows carrying this run's reply. A
thread that has posted is never offered twice. Name the read even when
you expect it to find nothing: a pane can post and die before it records.

On a resume or a re-ask, this read alone answers the test at the post
site, Thread already carries this receive-review run's reply?, one thread
at a time: from the notes it returned, never from when a thread was
opened, how old its last note is, the snapshot or the report. Yes counts
the reply posted and goes on to the thread's resolve decision, never
posting it again; no posts it. Only a run that was never resumed or re-asked answers no
without a read, and only for a thread it has not yet tried to post; after
an `mr_reply_thread` error, re-read that thread before the retry.

### Read the PR's threads with gh for the posted-already test

Read every thread's full note chain with `gh`, fresh, for this test. The
earlier read of the PR's review threads does not stand in for it.

### Build the respond-post open

This gate offers exactly the replies the developer has not yet seen word
for word: every `gate-1: override` row, and every `gate-1: fix` row whose
Fixed reply was finalized (Report rows). A `gate-1: reply` row is never
offered: it posts its row's reply and is never resolved, except as a
retired-shape `post` decides it (Acting on respond-post, below). A `skip`
row, and a `fix` row whose Fixed reply was never finalized, post nothing.

- **No thread offered** (no finalized fix and no override) **and no
  caller-handed `post`**: post the `gate-1: reply` rows now, each one
  not already carrying this run's reply (Posted already). There is no
  respond-post gate and no respond-post record: open nothing, record
  nothing for this scope (the respond-plan record covers those replies),
  and close only when no thread was held this pass: a forge refusal held
  here leaves the run open for a resume, which finds the thread through
  Posted already. A caller that owns the gates gets no open file back, only
  that nothing is offered and which replies posted.
- **No thread offered, but the caller handed a `post`** (in a
  `{plan, post}` object, or on its own): that `post` decides first. Post
  no `gate-1: reply` row before reading it; act on it as Acting on
  respond-post says, and record its selection there, a retired-shape
  `post` unchanged.
- **Threads offered:** the `gate-1: reply` rows wait, and post once this
  gate proceeds (Acting on respond-post).

<HARD-GATE>
Decision intake: when the caller's `{plan, post}` object already carries
`post`, use it and ask nothing here. Otherwise build the open, then hand
it back or run the gate.

**Build the open** in the scratch directory Build the open made, as
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

- Fit it:

  ```bash
  sh "${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh" fit < <dir>/respond-post.source.json > <dir>/respond-post.open.json
  ```

  Nothing here is trimmable (a reply is never shortened), so an open over
  the budget goes all prose.

### Fix the respond-post source the fit names

Exit 1 names the question and field to fix. The counter is fit attempts
within this build of the open.

### Off-script gate: the respond-post open will not fit

Quote the third fit's problem lines as the `context`. Propose, spelled in
full, one source change for the fields the fit named, never a shortened
reply or a hand-edited open. The take makes that change, then the fit
reruns. Ask it per the Off-script gate section.

### Make the recorded move once at the respond-post fit

Make the source change the answer recorded, exactly once, then rerun the
fit. Exit 0 goes on as normal. Exit 1 finds the attempt counter already
spent and returns to this same off-script gate, where the human answers
again.

### Hand back the offered replies and the respond-post open's path

**A caller that owns the gates**: open nothing. Hand back the offered
replies plus the absolute path of `<dir>/respond-post.open.json`, then
wait for its `{post}`. Its `.questions` end with `next`; a caller with its
own navigation drops that question. Once you have acted on its `{post}`,
hand back which replies posted, as the no-offer path does.

### Gate respond-post through gate-protocol

**Otherwise** the verb runs the gate itself. It asks with the
`gate_ask` tool and answers a pane form with the `gate_answer` tool, per
gate-protocol's Runs integration; a gate is never asked or answered from
the shell.

- `run_field_set` with `key: "gate"`, `value: "respond-post"`, `stage:
  <stage>`.
- Run gate-protocol's Runs integration with kind `respond-post`, the open
  read from the file: read `<dir>/respond-post.open.json` with the Read
  tool; call `gate_ask` with its `questions` array, `kind:
  "respond-post"` and its `context`; act on the returned presentation as
  gate-protocol says.

  `next` carries the navigation verbs -- **Proceed** (recommended) /
  **Iterate here** / **Hold** -- and never folds into a thread question.
  A paragraph that lists the replies and waits is not this gate.
- In-pane form: run
  `sh "${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh" prose < <dir>/respond-post.source.json`.
  Show its `.context` as one line before the form; each thread
  question's form text is its `label`, a newline, its prose context
  (`<file> FIX · <sha>: <text>` or `<file> REPLY: <text>`), then `Post,
  resolve, both, or neither?`, under the header `Thread <n>`, as a
  multi-select. Ask the thread questions in order, up to four per call,
  then `next` in one last call, and submit exactly ONE `gate_answer`
  carrying every thread answer plus `next`. The pane's answer never
  carries `text`: whatever the human types in the form's free-text
  field, a full replacement reply included, rides as `note`, and the
  drafted reply posts. The JSON never reaches the form.
</HARD-GATE>

### Decide nothing at respond-post: no push, post, resolve or record

A `hold` or `iterate` answer decides nothing, whatever its thread picks
say: nothing pushes, no reply posts, no thread resolves, and no
respond-post decision is recorded, so every offered thread stays pending
in the record and the `gate-1: reply` rows keep waiting. A `hold` still
records the hold itself and sets the `hold` field (Run); neither is a
respond-post decision.

### Apply the respond-post note

Redraft what the note asks (an override's reply, per the reply rules) and
write it into its row. The re-ask is a new gate over the threads not yet
posted (Posted already).

### Hold the picked fix rows and report the failure verbatim

A failed push (a target mismatch or a push error) holds those rows: post
and resolve none of them, report the mismatch or the error verbatim (in
the hand-back when a caller owns the gates), and leave the run open,
since the close waits for every reply. Never force, rebase or merge past
it. Every other reply posts as decided either way. Then record the
respond-post decision at once, with the held thread ids under `"held"`.

Verbatim means the text itself: the error `git_push` returned, or for a
mismatch the output of the two git reads, whole and unedited, in a fenced
block. Never a summary, a paraphrase, or an excerpt with parts elided.

The held path ends at the run left open, not at Report the outcome, so
say it before the turn ends: a caller that owns the gates gets which
replies posted and which threads are held, with each failure verbatim.

### Hold the thread the forge refused and report the refusal verbatim

A Hold answer at the refused-reply or refused-resolve off-script gate
holds only that thread, as a failed push holds the fix rows: nothing more
acts on it this pass. Report the refusal verbatim, the forge's error whole
and unedited in a fenced block, never a summary, a paraphrase, or an
excerpt with parts elided (in the hand-back when a caller owns the gates),
and leave the run open, since the close waits for every reply. Every other thread still acts. The respond-post record lists
the thread under `"held"` (The respond-post record). With nothing offered
and no caller-handed `post` there is no respond-post record; a resume
then finds the unposted thread through Posted already. As with a failed
push, a caller that owns the gates is told which replies posted and which
threads are held before the turn ends.

### Off-script gate: the forge refused the reply

Quote the `mr_reply_thread` error from the retry as the `context`. A
retry, the budgeted one or an iterate answer's, first re-tests the thread
(Thread already carries this receive-review run's reply?), so a reply
that landed despite an error never posts twice.
Propose the move: the human posts this reply by hand, and this run
counts the reply posted once the forge shows it. A retry after they fix the cause is
the iterate answer, never the take. A Hold holds this thread only (Hold
the thread the forge refused and report the refusal verbatim). Ask it per
the Off-script gate section.

### Make the recorded move once for the refused reply

Read the thread on the forge; once it carries the reply the human posted,
count the reply posted, exactly once, then go on to this thread's resolve
pick.

### Post the reply on GitHub with gh

Post this thread's reply (the text Acting on respond-post names) in the
thread with `gh`, never as a top-level comment. On other forges posting
mechanics belong to the forge CLI and the adapter.

### Off-script gate: the forge refused the resolve

Quote the `mr_resolve_thread` error from the retry as the `context`.
Propose the move: the human resolves this thread by hand, and this run
counts it resolved once the forge shows it. A retry after they fix the cause is the
iterate answer, never the take. A Hold holds this thread only (Hold the
thread the forge refused and report the refusal verbatim). Ask it per the
Off-script gate section.

### Make the recorded move once for the refused resolve

Read the thread on the forge; once it shows the thread resolved, count it
resolved, exactly once, then go on to the next thread to act on.

### Resolve the thread on GitHub with gh

Resolve the thread with `gh`, after its reply when both are picked. On
other forges resolving belongs to the forge CLI and the adapter.

### Report the outcome (to the caller when it owns the gates)

Zero unresolved human threads: say so. A caller that owns the gates gets
which replies posted: with nothing offered, no open file back, only that
nothing is offered and which replies posted; after acting on its
`{post}`, which replies posted. When threads are held, the run ends held
instead, and the two hold sections carry this report.

## What the graph cannot show

**Push before any Fixed reply.** Only when the picks post or resolve at
least one `gate-1: fix` row; otherwise push nothing. Once respond-post
proceeds, or a caller hands `post`, and before acting on those rows:

1. Check the target: `git branch --show-current` must print the MR's
   source branch (the `branch` recorded at Resolve the change and record
   its identity, else the forge's), and `git
   rev-parse --abbrev-ref @{push}` must print that branch on its remote
   (`origin/<source branch>`). Any other output, an error included, is a
   failed push; never switch branches to make it match.
2. Push that one branch with `git_push`, `tree` = this worktree: it
   pushes only the current branch (the one the check verified) to its
   same-named upstream by explicit refspec, never a bare push, which can
   publish other refs under a configured push refspec or a mirror
   remote. That proceed is the authorization: ask nothing more.

**Acting on respond-post.** Act only once respond-post proceeds: its
`next` answer is `proceed`, or a caller handed `post`, which carries no
`next`. A `hold` or `iterate` answer decides nothing (Decide nothing at
respond-post). A thread that already carries this run's reply (Posted
already) never posts again, whatever its pick or its row says.

On proceed, act per thread, reading each `thread-<n>` answer (a `{value,
note, text}` object unwraps to its `value`; the note rides the decision
record and never edits the reply) and splitting each value at the first
`:` into the verb and the thread id: `post:<threadId>` posts that
thread's reply, which is the answer's `text` when it carries one and the
`reply@1` context's `text` otherwise (`text` on a thread with no `post:`
posts nothing); `resolve:<threadId>` resolves the thread, after its reply
when both are picked and on its own when only resolve is, where the forge
distinguishes resolve from reply; an empty array leaves the thread
untouched. Then post every `gate-1: reply` row that does not already
carry this run's reply, its row's reply, unresolved: this gate never offers those threads, so they post whatever
it picked for its own threads. When the open offers such a thread, or an
answer value names it (an open built before this rule), that thread's
answer decides it instead, an empty array included, and no reply posts
twice. Nothing else posts, through any channel. Never a top-level note, never approve the
change: that stays the developer's, however settled a thread looks once
its reply is written. On GitLab a reply posts with the `mr_reply_thread`
tool and a resolve is `mr_resolve_thread`, after its reply when both are
picked; on other forges posting mechanics belong to the forge CLI and the
adapter. A caller-handed `post` in the retired shape (a `replies` list, or
its `replies-1`, `replies-2`, ... chunks read as one union, of bare thread
ids plus `disposition`) posts the listed replies, resolves them only on
`resolve-addressed`, and records that selection unchanged. That shape
offered every thread with a reply, so it decides each `gate-1: reply`
row fully, as that older gate did: one it lists posts once and is
resolved only on `resolve-addressed`, and one it omits (an empty list
included) posts nothing.

**The respond-post record.** At execution time, after acting: `run_decision` with `contract:
"gate@1"`, `scope: "respond-post"`, `selection:
{"threads":{"<threadId>":{"post":true,"resolve":false},"...":"one entry per offered thread"}}`,
`decidedBy: <the answer's by>` (for a caller-handed `post`, the decider
the caller names). An entry carries `text` only when its
thread's answer was an object with `text` and `post:`, and then it is the
answer's: `{"post":true,"resolve":true,"text":"<the answer's text>"}`
when that answer also carries `resolve:`, `"resolve":false` when it does
not. A reply posted from the `reply@1` context never adds `text`. An
entry whose thread's answer carries a note adds it as `note`:
`{"post":true,"resolve":false,"note":"<the note>"}`. After a failed push,
or a Hold at a forge-refusal off-script gate, the selection adds
`"held":["<threadId>"]` beside `threads`, each held offered thread's entry
still its answer's picks; a held `gate-1: reply` row is listed under
`"held"` with no entry under `threads`. Every offered
thread gets an entry, and only offered threads: a `gate-1: reply`
row's reply rides the respond-plan record. An answer's values name its thread; an empty
array names none, so take that thread from the question's options in the
open, or, when the open is not at hand (a caller handed `post` to a
fresh pane), record every offered thread (a `gate-1: override` row, or
a `gate-1: fix` row whose Fixed reply was finalized) that no answer value names as both `false`. Never map a
`thread-<n>` key to a thread by its position.

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
move, iterate redoing that site with their note, hold holding (at the two
forge-refusal sites, that thread only). After an iterate or take answer,
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
| "Gate 2's answer doesn't name the reply-only thread, so it stays unposted" | Gate 1 decided it. It posts once gate 2 proceeds, whatever gate 2 picked for its own threads, unless the open offered it or an answer value names it. |
| "I know the contexts were dropped; I'll apply that when the answer comes" | A pane that dies takes that knowledge with it. Write `gate-1-context: dropped` into the saved report right after the open. |
| "I'll work out the overrides and texts from the answers myself" | `gate_record` computes them, keyed by thread id. Write its `rows` as they come back. |
| "The resumed run lost its rows, so I'll record respond-plan again to get them back" | Never re-record a recorded scope: it moves `decided_at`, which the post side reads. Join the recorded decision to the stored cards instead. |
| "The verdict report recommended a reply here, so it posts" | Posting reads each report row's `gate-1` field, never the recommendation. A `gate-1: skip` row posts nothing. |
| "The gate approved posting, not a push, so the Fixed reply goes up (or I ask first)" | "Fixed" with nothing on the remote is false. The proceed authorizes the push: check the branch and `@{push}`, push first, and a mismatch or failed push holds every picked `gate-1: fix` row. |
| "A plain push from the shell pushes the MR" | It pushes whatever branch is checked out, to its own destination, and any configured push refspec or mirror refs with it. Check both against the MR's source branch, then push that one branch: `git_push` with `tree` = this worktree, never forced. |
| "The fix is held, so I'll record respond-post once it posts" | A resume from the snapshot would re-offer the replies that already posted. Record now, with the fix threads under `"held"`. |
| "They ticked post before choosing Iterate (or Hold), so those picks act now" | Only `proceed` acts. On `hold` or `iterate` nothing pushes, posts, resolves or records, whatever the picks; every offered thread stays pending, and the re-ask is a new gate over the threads not yet posted. |
| "The snapshot has no respond-post record, so nothing has posted yet" | A pane can post and die before it records. On a resume, read each thread on the forge before its reply posts or a re-asked gate offers it: one carrying this run's reply (the same text, or a note by this run's account since `started_at`) is posted, counted as posted, never posted or offered again. |
| "This one is clearly right, I'll add the guard in a follow-up commit" | Implementation follows `respond-plan`'s `code-changes: approve`, not a line in the draft. |
| "It's wrong, but I need the reviewer to point me at it" | Then it is `needs-clarification`, not `pushback`. |
| "The pane is fresh, so I'll adjudicate again before applying the handed plan" | A handed plan answers an adjudication the human already saw. Record it and execute it; a fresh adjudication would change the drafts it approved. Its rows come from the record and the stored cards, so it reads no threads. |
| "The caller asked the respond-plan gate, so it records the decision" | This verb records it: a handed `{plan}` goes through `gate_record {..., answers, decidedBy}`, the same record a pane answer gets with `gateId`. A resume reads that record. |
| "I'll present the table and ask about fixes and posting in the same breath" | `respond-plan` and `respond-post` are two gates, in order. Prose that asks both at once is neither. |

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
