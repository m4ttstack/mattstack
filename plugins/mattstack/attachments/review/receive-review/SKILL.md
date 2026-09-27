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
question for a gate, never a judgment call.

```dot
digraph receive_review {
    rankdir=TB;

    "Trigger: review feedback to answer on your own MR/PR" [shape=ellipse];
    "A caller handed a runDb that run_snapshot shows running?" [shape=diamond];
    "Inherit the caller's run: no run_start, no close" [shape=box];
    "Launched by a surface (spawnedBy)?" [shape=diamond];
    "run_list {repo}" [shape=plaintext];
    "Running receive-review runs in this repo?" [shape=diamond];
    "Gate clarify for receive-review: Resume / Start fresh / Hold" [shape=box];
    "receive-review clarify answer?" [shape=diamond];
    "run_start {flags, skillDir, spawnedBy?}" [shape=plaintext];
    "run_start returned ok: true with a runDb?" [shape=diamond];
    "STOP: rt predates the run tools; tell the user to update rt" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "run_stage {action: start, stage: receive-review}" [shape=plaintext];
    "Resume the receive-review run from run_snapshot" [shape=box];
    "run_stage {action: start, stage: receive-review} on resume" [shape=plaintext];
    "run_field_set {key: hold, value: -, stage: receive-review}" [shape=plaintext];
    "What does the receive-review snapshot record?" [shape=diamond];
    "What did the caller hand receive-review?" [shape=diamond];

    "Resolve the change and record its identity" [shape=box];
    "Forge of the change?" [shape=diamond];
    "MR url or iid in hand?" [shape=diamond];
    "mr_for_branch {repoName: <root>, branches: [<branch>]}" [shape=plaintext];
    "Open MR with this source branch?" [shape=diamond];
    "Report that no open MR has this branch as its source" [shape=box];
    "mr_threads {mrUrl, refresh: true}" [shape=plaintext];
    "Read the PR's review threads with gh" [shape=box];
    "Keep only unresolved human threads" [shape=box];
    "Any unresolved human threads?" [shape=diamond];

    "Dispatch one fresh-context adjudicator over all the review threads" [shape=box];
    "Draft the verdict table and one reply per thread" [shape=box];
    "Caller handed the respond-plan answers?" [shape=diamond];
    "Build the open" [shape=box];
    "sh ${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh fit < <dir>/respond-plan.source.json > <dir>/respond-plan.open.json" [shape=plaintext];
    "respond-plan fit exit code?" [shape=diamond];
    "respond-plan fit attempts = 3?" [shape=diamond];
    "Fix the respond-plan source the fit names" [shape=box];
    "Off-script gate: the respond-plan open will not fit" [shape=box];
    "Answer at the respond-plan fit off-script gate?" [shape=diamond];
    "Make the recorded move once at the respond-plan fit" [shape=box];
    "Caller owns the receive-review gates at respond-plan?" [shape=diamond];
    "Hand back the verdict table and the respond-plan open's path" [shape=box];
    "Gate respond-plan through gate-protocol" [shape=box];
    "respond-plan pane next answer?" [shape=diamond];
    "Redraft the replies with the respond-plan note" [shape=box];
    "run_decision {contract: gate@1, scope: respond-plan, selection, decidedBy}" [shape=plaintext];
    "Rewrite the receive-review report rows" [shape=box];
    "code-changes answer?" [shape=diamond];

    "Next report row, in verdict-table order?" [shape=diamond];
    "Implement the thread's fix" [shape=box];
    "Run the project's tests and checks on the fix" [shape=box];
    "Fix checks pass?" [shape=diamond];
    "Fix attempts on this thread = 3?" [shape=diamond];
    "Off-script gate: the thread's fix did not converge" [shape=box];
    "Answer at the unconverged-fix off-script gate?" [shape=diamond];
    "Make the recorded move once for the unconverged fix" [shape=box];
    "Commit the fix and finalize its Fixed reply" [shape=box];
    "Redraft the override's reply" [shape=box];

    "Resumed, or re-asking after respond-post Hold or Iterate?" [shape=diamond];
    "Posted already: read each thread on the forge" [shape=box];
    "Forge for the posted-already read?" [shape=diamond];
    "mr_threads {mrUrl, refresh: true} for the posted-already read" [shape=plaintext];
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
    "Retried git_push with the printed root?" [shape=diamond];
    "git_push {tree: <the root the error prints>}" [shape=plaintext];
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
    "run_stage {action: done, stage: receive-review}" [shape=plaintext];
    "run_status {status: done|abandoned}" [shape=plaintext];
    "run_stage {action: fail, stage: <stage>, reason}" [shape=plaintext];
    "run_decision {contract: gate@1, scope: hold:<stage>:<attempt>, selection: {reason}, decidedBy}" [shape=plaintext];
    "run_field_set {key: hold, value: <their words, or held>, stage: <stage>}" [shape=plaintext];
    "run_field_set {key: hold, value: held, stage: <stage>}" [shape=plaintext];

    "No open MR: nothing to answer" [shape=doublecircle];
    "Held: end the turn naming the run and stage" [shape=doublecircle];
    "Threads held: run left open for a resume" [shape=doublecircle];
    "receive-review stage failed" [shape=doublecircle];
    "Review feedback answered" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Trigger: review feedback to answer on your own MR/PR" -> "A caller handed a runDb that run_snapshot shows running?";
    "A caller handed a runDb that run_snapshot shows running?" -> "Inherit the caller's run: no run_start, no close" [label="yes"];
    "A caller handed a runDb that run_snapshot shows running?" -> "Launched by a surface (spawnedBy)?" [label="no"];
    "Inherit the caller's run: no run_start, no close" -> "What did the caller hand receive-review?";
    "Launched by a surface (spawnedBy)?" -> "run_start {flags, skillDir, spawnedBy?}" [label="yes: start fresh"];
    "Launched by a surface (spawnedBy)?" -> "run_list {repo}" [label="no: by hand"];
    "run_list {repo}" -> "Running receive-review runs in this repo?";
    "Running receive-review runs in this repo?" -> "run_start {flags, skillDir, spawnedBy?}" [label="none"];
    "Running receive-review runs in this repo?" -> "Gate clarify for receive-review: Resume / Start fresh / Hold" [label="one or more"];
    "Gate clarify for receive-review: Resume / Start fresh / Hold" -> "receive-review clarify answer?";
    "receive-review clarify answer?" -> "Resume the receive-review run from run_snapshot" [label="resume"];
    "receive-review clarify answer?" -> "run_start {flags, skillDir, spawnedBy?}" [label="start fresh"];
    "receive-review clarify answer?" -> "Held: end the turn naming the run and stage" [label="hold"];
    "run_start {flags, skillDir, spawnedBy?}" -> "run_start returned ok: true with a runDb?";
    "run_start returned ok: true with a runDb?" -> "run_stage {action: start, stage: receive-review}" [label="yes: keep runDb"];
    "run_start returned ok: true with a runDb?" -> "STOP: rt predates the run tools; tell the user to update rt" [label="no"];
    "run_stage {action: start, stage: receive-review}" -> "What did the caller hand receive-review?";
    "Resume the receive-review run from run_snapshot" -> "run_stage {action: start, stage: receive-review} on resume";
    "run_stage {action: start, stage: receive-review} on resume" -> "run_field_set {key: hold, value: -, stage: receive-review}";
    "run_field_set {key: hold, value: -, stage: receive-review}" -> "What does the receive-review snapshot record?";
    "What does the receive-review snapshot record?" -> "Resolve the change and record its identity" [label="no respond-plan record"];
    "What does the receive-review snapshot record?" -> "Rewrite the receive-review report rows" [label="respond-plan recorded, no respond-post record"];
    "What does the receive-review snapshot record?" -> "Posted already: read each thread on the forge" [label="respond-post record carrying held"];
    "What does the receive-review snapshot record?" -> "Report the outcome (to the caller when it owns the gates)" [label="respond-post recorded, nothing held"];
    "What did the caller hand receive-review?" -> "Resolve the change and record its identity" [label="nothing, or a {plan} (alone or in {plan, post})"];
    "What did the caller hand receive-review?" -> "Posted already: read each thread on the forge" [label="a {post} alone, with its report rows"];

    "Resolve the change and record its identity" -> "Forge of the change?";
    "Forge of the change?" -> "MR url or iid in hand?" [label="GitLab"];
    "Forge of the change?" -> "Read the PR's review threads with gh" [label="GitHub"];
    "MR url or iid in hand?" -> "mr_threads {mrUrl, refresh: true}" [label="yes"];
    "MR url or iid in hand?" -> "mr_for_branch {repoName: <root>, branches: [<branch>]}" [label="no"];
    "mr_for_branch {repoName: <root>, branches: [<branch>]}" -> "Open MR with this source branch?";
    "Open MR with this source branch?" -> "mr_threads {mrUrl, refresh: true}" [label="yes: its iid"];
    "Open MR with this source branch?" -> "Report that no open MR has this branch as its source" [label="null entry"];
    "Report that no open MR has this branch as its source" -> "No open MR: nothing to answer";
    "mr_threads {mrUrl, refresh: true}" -> "Keep only unresolved human threads";
    "Read the PR's review threads with gh" -> "Keep only unresolved human threads";
    "Keep only unresolved human threads" -> "Any unresolved human threads?";
    "Any unresolved human threads?" -> "Dispatch one fresh-context adjudicator over all the review threads" [label="yes"];
    "Any unresolved human threads?" -> "Report the outcome (to the caller when it owns the gates)" [label="none: say so"];

    "Dispatch one fresh-context adjudicator over all the review threads" -> "Draft the verdict table and one reply per thread";
    "Draft the verdict table and one reply per thread" -> "Caller handed the respond-plan answers?";
    "Caller handed the respond-plan answers?" -> "run_decision {contract: gate@1, scope: respond-plan, selection, decidedBy}" [label="yes, not yet spent: ask nothing, record it"];
    "Caller handed the respond-plan answers?" -> "Build the open" [label="no, or the handed plan is spent"];
    "Build the open" -> "sh ${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh fit < <dir>/respond-plan.source.json > <dir>/respond-plan.open.json";
    "sh ${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh fit < <dir>/respond-plan.source.json > <dir>/respond-plan.open.json" -> "respond-plan fit exit code?";
    "respond-plan fit exit code?" -> "Caller owns the receive-review gates at respond-plan?" [label="0"];
    "respond-plan fit exit code?" -> "respond-plan fit attempts = 3?" [label="1: contract problems"];
    "respond-plan fit attempts = 3?" -> "Fix the respond-plan source the fit names" [label="no"];
    "respond-plan fit attempts = 3?" -> "Off-script gate: the respond-plan open will not fit" [label="yes"];
    "Fix the respond-plan source the fit names" -> "sh ${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh fit < <dir>/respond-plan.source.json > <dir>/respond-plan.open.json";
    "Off-script gate: the respond-plan open will not fit" -> "Answer at the respond-plan fit off-script gate?";
    "Answer at the respond-plan fit off-script gate?" -> "Make the recorded move once at the respond-plan fit" [label="take"];
    "Answer at the respond-plan fit off-script gate?" -> "Fix the respond-plan source the fit names" [label="iterate: fix again with their note"];
    "Answer at the respond-plan fit off-script gate?" -> "run_decision {contract: gate@1, scope: hold:<stage>:<attempt>, selection: {reason}, decidedBy}" [label="hold"];
    "Answer at the respond-plan fit off-script gate?" -> "run_stage {action: fail, stage: <stage>, reason}" [label="hand back"];
    "Make the recorded move once at the respond-plan fit" -> "sh ${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh fit < <dir>/respond-plan.source.json > <dir>/respond-plan.open.json";
    "Caller owns the receive-review gates at respond-plan?" -> "Hand back the verdict table and the respond-plan open's path" [label="yes"];
    "Caller owns the receive-review gates at respond-plan?" -> "Gate respond-plan through gate-protocol" [label="no: a direct run"];
    "Hand back the verdict table and the respond-plan open's path" -> "run_decision {contract: gate@1, scope: respond-plan, selection, decidedBy}" [label="caller hands {plan} back"];
    "Gate respond-plan through gate-protocol" -> "respond-plan pane next answer?";
    "respond-plan pane next answer?" -> "run_decision {contract: gate@1, scope: respond-plan, selection, decidedBy}" [label="continue, or answered off the pane"];
    "respond-plan pane next answer?" -> "Redraft the replies with the respond-plan note" [label="iterate here"];
    "respond-plan pane next answer?" -> "run_decision {contract: gate@1, scope: hold:<stage>:<attempt>, selection: {reason}, decidedBy}" [label="hold"];
    "Redraft the replies with the respond-plan note" -> "Build the open" [label="a new gate"];
    "run_decision {contract: gate@1, scope: respond-plan, selection, decidedBy}" -> "Rewrite the receive-review report rows";
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
    "Fix checks pass?" -> "Fix attempts on this thread = 3?" [label="no"];
    "Fix attempts on this thread = 3?" -> "Implement the thread's fix" [label="no: another attempt"];
    "Fix attempts on this thread = 3?" -> "Off-script gate: the thread's fix did not converge" [label="yes"];
    "Off-script gate: the thread's fix did not converge" -> "Answer at the unconverged-fix off-script gate?";
    "Answer at the unconverged-fix off-script gate?" -> "Make the recorded move once for the unconverged fix" [label="take"];
    "Answer at the unconverged-fix off-script gate?" -> "Implement the thread's fix" [label="iterate: try again with their note"];
    "Answer at the unconverged-fix off-script gate?" -> "run_decision {contract: gate@1, scope: hold:<stage>:<attempt>, selection: {reason}, decidedBy}" [label="hold"];
    "Answer at the unconverged-fix off-script gate?" -> "run_stage {action: fail, stage: <stage>, reason}" [label="hand back"];
    "Make the recorded move once for the unconverged fix" -> "Next report row, in verdict-table order?";
    "Commit the fix and finalize its Fixed reply" -> "Next report row, in verdict-table order?";
    "Redraft the override's reply" -> "Next report row, in verdict-table order?";

    "Resumed, or re-asking after respond-post Hold or Iterate?" -> "Posted already: read each thread on the forge" [label="yes"];
    "Resumed, or re-asking after respond-post Hold or Iterate?" -> "Any thread offered (a finalized fix or an override)?" [label="no"];
    "Posted already: read each thread on the forge" -> "Forge for the posted-already read?";
    "Forge for the posted-already read?" -> "mr_threads {mrUrl, refresh: true} for the posted-already read" [label="GitLab"];
    "Forge for the posted-already read?" -> "Read the PR's threads with gh for the posted-already test" [label="GitHub"];
    "mr_threads {mrUrl, refresh: true} for the posted-already read" -> "Which threads does the posted-already read show carrying this run's reply?";
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
    "Answer at the respond-post fit off-script gate?" -> "run_decision {contract: gate@1, scope: hold:<stage>:<attempt>, selection: {reason}, decidedBy}" [label="hold"];
    "Answer at the respond-post fit off-script gate?" -> "run_stage {action: fail, stage: <stage>, reason}" [label="hand back"];
    "Make the recorded move once at the respond-post fit" -> "sh ${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh fit < <dir>/respond-post.source.json > <dir>/respond-post.open.json";
    "Caller owns the receive-review gates at respond-post?" -> "Hand back the offered replies and the respond-post open's path" [label="yes"];
    "Caller owns the receive-review gates at respond-post?" -> "Gate respond-post through gate-protocol" [label="no: a direct run"];
    "Hand back the offered replies and the respond-post open's path" -> "Picks post or resolve a gate-1: fix row?" [label="caller hands {post} back"];
    "Gate respond-post through gate-protocol" -> "respond-post next answer?";
    "respond-post next answer?" -> "Picks post or resolve a gate-1: fix row?" [label="proceed"];
    "respond-post next answer?" -> "Decide nothing at respond-post: no push, post, resolve or record" [label="hold"];
    "respond-post next answer?" -> "Apply the respond-post note" [label="iterate"];
    "Decide nothing at respond-post: no push, post, resolve or record" -> "run_decision {contract: gate@1, scope: hold:<stage>:<attempt>, selection: {reason}, decidedBy}";
    "Apply the respond-post note" -> "Posted already: read each thread on the forge" [label="a new gate"];

    "Picks post or resolve a gate-1: fix row?" -> "git branch --show-current" [label="yes"];
    "Picks post or resolve a gate-1: fix row?" -> "Next thread to act on: offered threads, then gate-1: reply rows?" [label="no: push nothing"];
    "git branch --show-current" -> "git rev-parse --abbrev-ref @{push}";
    "git rev-parse --abbrev-ref @{push}" -> "Both name the MR's source branch?";
    "Both name the MR's source branch?" -> "git_push {tree: <worktree root>}" [label="yes"];
    "Both name the MR's source branch?" -> "Hold the picked fix rows and report the failure verbatim" [label="no, or an error"];
    "git_push {tree: <worktree root>}" -> "git_push result for the fix rows?";
    "git_push {tree: <the root the error prints>}" -> "git_push result for the fix rows?";
    "git_push result for the fix rows?" -> "Next thread to act on: offered threads, then gate-1: reply rows?" [label="pushed"];
    "git_push result for the fix rows?" -> "Retried git_push with the printed root?" [label="tree must be the absolute path of the root"];
    "git_push result for the fix rows?" -> "Hold the picked fix rows and report the failure verbatim" [label="any other error"];
    "git_push result for the fix rows?" -> "STOP: a failed git_push holds the fix rows; never push from the shell, never force" [label="tempted to push from the shell or force"];
    "Retried git_push with the printed root?" -> "git_push {tree: <the root the error prints>}" [label="no"];
    "Retried git_push with the printed root?" -> "Hold the picked fix rows and report the failure verbatim" [label="yes"];
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
    "Answer at the refused-reply off-script gate?" -> "run_stage {action: fail, stage: <stage>, reason}" [label="hand back"];
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
    "Answer at the refused-resolve off-script gate?" -> "run_stage {action: fail, stage: <stage>, reason}" [label="hand back"];
    "Make the recorded move once for the refused resolve" -> "Next thread to act on: offered threads, then gate-1: reply rows?";
    "Resolve the thread on GitHub with gh" -> "Next thread to act on: offered threads, then gate-1: reply rows?";

    "respond-post decided by a gate or a handed post?" -> "run_decision {contract: gate@1, scope: respond-post, selection, decidedBy}" [label="yes, or a held resume re-records"];
    "respond-post decided by a gate or a handed post?" -> "Any thread held this pass: a failed push or a forge refusal?" [label="no: nothing was offered or handed"];
    "run_decision {contract: gate@1, scope: respond-post, selection, decidedBy}" -> "Any thread held this pass: a failed push or a forge refusal?";
    "Any thread held this pass: a failed push or a forge refusal?" -> "run_field_set {key: hold, value: held, stage: <stage>}" [label="yes"];
    "Any thread held this pass: a failed push or a forge refusal?" -> "Report the outcome (to the caller when it owns the gates)" [label="no"];
    "Report the outcome (to the caller when it owns the gates)" -> "This verb started or resumed the run?";
    "This verb started or resumed the run?" -> "run_stage {action: done, stage: receive-review}" [label="yes"];
    "This verb started or resumed the run?" -> "Review feedback answered" [label="no: inherited, the caller closes"];
    "run_stage {action: done, stage: receive-review}" -> "run_status {status: done|abandoned}";
    "run_status {status: done|abandoned}" -> "Review feedback answered";
    "run_stage {action: fail, stage: <stage>, reason}" -> "receive-review stage failed";
    "run_decision {contract: gate@1, scope: hold:<stage>:<attempt>, selection: {reason}, decidedBy}" -> "run_field_set {key: hold, value: <their words, or held>, stage: <stage>}";
    "run_field_set {key: hold, value: <their words, or held>, stage: <stage>}" -> "Held: end the turn naming the run and stage";
    "run_field_set {key: hold, value: held, stage: <stage>}" -> "Threads held: run left open for a resume";
}
```

## Run

Outside a pipeline this verb is its own run, so the console shows it and
the Stop hook covers its pane. Pass `runDb` on every `run_*` call; nothing
is exported.

An inherited run (a caller handed a `runDb` that `run_snapshot` shows
`running`) is the caller's to close: its `run.current_stage` is your
stage, and you close nothing at the end (no `run_stage` done, no
`run_status`). A hand back still fails that stage (Off-script gate).

When a surface launched this pane (the `spawnedBy` case), start fresh:
another pane's live run is not yours to resume.

`run_start` takes `flags`, this verb's value in the block below, verbatim;
`skillDir`, this skill's own directory; and `spawnedBy` when a board or
another surface launched this pane.

{{run-start.flags:receive-review}}

A result without `ok: true` and a `runDb` means this rt predates the run
tools.

`<stage>` below is `receive-review`, or the inherited run's
`current_stage`. Every gate in this verb writes its `gate` field with
`stage: <stage>`, and its decision. The close runs only when this verb
started or resumed the run, after every reply has posted and every
decision is recorded: `run_stage` with `action: "done"`, `stage:
"receive-review"`, then `run_status` with `status: "done"` (or `abandoned`
when a gate said so).

A gate's Hold answer that ends the turn (the edge to Held: end the turn
naming the run and stage), with a run, own or inherited, is recorded
before the turn ends: `run_decision` with `contract: "gate@1"`, `scope:
"hold:<stage>:<attempt>"`, `selection: {"reason": "<their words>"}`,
`decidedBy: <the answer's by>`, then `run_field_set` with `key: "hold"`,
`value: "<their words, or held>"`, `stage: <stage>`. A thread hold is
the other case: threads left held (a failed push, or a forge-refusal Hold
that holds only its thread) and a posted-already read that returned no
result or an error record no `hold:<stage>:<attempt>` decision (held
threads keep their `"held"` entry), and set `run_field_set` with `key:
"hold"`, `value: "held"`, `stage: <stage>` before the turn ends. A read
error is reported verbatim (to the caller when it owns the gates), the
run stays open, and a resume retries the read. The
clarify Hold comes before any run and records nothing. A resume clears
the field.

{{include:run-identity}}

## Steps

### Inherit the caller's run: no run_start, no close

A caller handed you a `runDb` (a pipeline invoking this verb carries it in
context) and `run_snapshot` with that `runDb` shows `run.status` =
`running`: you were invoked from inside that run, you inherit it,
`run.current_stage` is your stage, you pass that handed `runDb` on every
`run_*` call, and you close nothing at the end.

### Gate clarify for receive-review: Resume / Start fresh / Hold

Launched by hand, the Resume offer comes first: call `run_list` with
`repo` (the `--repo` value in the flags block under Run) and keep the runs
whose `status` is `running` and `work_type` is `receive-review`; never
read the run dbs by hand. Any found: gate `clarify`, one sentence naming
each candidate's `spawned_by`, `started_at`, and `current_stage`, then the
structured-question tool with one **Resume** option per candidate
(recommended for a run this session started earlier; a run another live
pane owns is not yours) / **Start fresh**; **Hold**.

### Resume the receive-review run from run_snapshot

Your `runDb` is `<home>/.mattstack/runs/<repo>/<its id>/state.db` (the
candidate row's `id`, the home directory written out, never `~`). The
`run_stage` start is a new attempt, which re-records this session, and the
`run_field_set` clears the hold. Re-enter with `run_snapshot`'s decisions
and do not re-ask a question it already answered. Keep `runDb` and pass it
on every `run_*` call.

What the snapshot records picks the re-entry:

- **No `respond-plan` record:** nothing is decided; resolve the change and
  fetch the threads again.
- **`respond-plan` recorded, no `respond-post` record:** rewrite the report
  rows from the record alone (the snapshot-only reading under Rewrite the
  receive-review report rows), then walk the rows. A fix row whose commit
  is already on the branch implements nothing again: its Fixed reply is
  written from that commit, and nothing is re-committed.
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
  pane without it, from the snapshot: the respond-post entry's `text` when
  it has one, else the respond-plan record read as the snapshot-only
  reading under Rewrite the receive-review report rows describes. A held
  override posts only the text recorded for it (the respond-post entry's
  `text`, else the respond-plan record's `texts` entry). With neither, it
  is never posted as a redraft the developer has not seen: redraft it
  (Redraft the override's reply) and offer it, with every held thread not
  yet posted, at a new respond-post gate. A held fix row with neither gets its Fixed reply text written again from the
  committed change, in the shape Commit the fix and finalize its Fixed
  reply gives it, before it posts; nothing is committed again.
- **`respond-post` recorded, nothing held:** report the outcome and close.

### Resolve the change and record its identity

The change and its requirements come from the caller or domain adapter: the
diff range, plus the requirements it is judged against. Report a fetch
failure or a mismatched pair exactly as found; never fabricate the missing
half.

When the run is yours, record the resolved change per Run identity above:
`mr` (the MR/PR URL), `branch` (its source branch), `ticket` (the id it
names, when one exists).

On GitLab the threads come from `mr_threads` with the MR (`mrUrl`, or
`repoName` plus `iid`) and `refresh: true`; with neither in hand,
`mr_for_branch` with `repoName` = this checkout and `branches: [<the
checked-out branch>]` gives the iid.

### Report that no open MR has this branch as its source

A null entry from `mr_for_branch` means no open MR in rt's cache has that
branch as its source: report that and stop.

### Read the PR's review threads with gh

On GitHub, fetch the threads with `gh`.

### Keep only unresolved human threads

Keep only **unresolved human** threads: drop system notes and bot authors.
Capture each thread's id, its `file:line`, and its full note chain.

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

The verb adjudicates; it never decides what gets fixed or posted. Decision
intake: when the caller hands this step decided answers -- the `{plan}`
half alone (a board wrapper hands it after its own first gate, `{post}`
following later when gate respond-post offers a thread) or a combined `{plan, post}` object from a
caller that collected both up front -- use `plan` and ask nothing here: its
per-question answers, keyed by question id with verbatim option strings,
are the decision. Use the decider the caller names alongside it. Record
that `plan` with the same `run_decision` a pane answer gets, `decidedBy`
that decider. Its answers are per-question, so normalize them first into
exactly the selection under Gate respond-plan through gate-protocol, by
the join a pane answer gets: unwrap each `{value, note, text}` object to
its `value`, split the value at the first `:`, and key `threads` by the
thread id read out of it (never by `thread-<n>`), with `texts`,
`overrides`, `notes` and `code-changes` filled as that bullet says. A handed plan answers one adjudication: once recorded it is
spent (a revise re-adjudicates and builds a new open). The `post` half
of a combined object waits for gate respond-post, where it is the caller-handed `post`. Every other path
builds the open first.

The gate (`respond-plan`, gate 1; `respond-post` is gate 2) carries
structured context (gate-protocol's Structured context), built from the
verdict report's buckets. Make one scratch directory (`mktemp -d`) and
write its path out literally from then on: each tool call is a fresh
shell. Write `<dir>/respond-plan.source.json`:

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

Fit it:

```bash
sh "${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh" fit < <dir>/respond-plan.source.json > <dir>/respond-plan.open.json
```

The output file IS the open: its
`.context` and `.questions` go to the gate verbatim, fitted to the shared
budget (points and notes trimmed, or every context prose when nothing
else fits; `"fits": false` means even the prose is over, and the daemon
will drop contexts loudly). Never hand-edit it, and never shorten a reply
to make an open fit.

### Fix the respond-plan source the fit names

Exit 1 prints one line per contract problem, naming the question and the
field: fix the source and rerun. The counter is fit attempts within this
build of the open.

### Off-script gate: the respond-plan open will not fit

Quote the third fit's problem lines as the `context`. Propose, spelled in
full, one source change for the fields the fit named, never a shortened
reply or a hand-edited open. The take makes that change, then the fit
reruns. Ask it per the Off-script gate section.

### Make the recorded move once at the respond-plan fit

Make the source change the answer recorded, exactly once, then rerun the
fit. Exit 0 goes on as normal. Exit 1 finds the attempt counter already
spent and returns to this same off-script gate, where the human answers
again.

### Hand back the verdict table and the respond-plan open's path

**A caller that owns the gates** (it delegated the adjudication to this
verb and presents the gates itself; a board wrapper does, and says so when
it delegates): open nothing. Hand back the verdict table plus the absolute
path of `<dir>/respond-plan.open.json`; the caller opens its gate from
that file's `.questions` and `.context`, then hands `{plan}` back.
Record that `{plan}` with `run_decision` before rewriting the rows,
normalized into the respond-plan selection as the decision intake under
Build the open says, `decidedBy` the decider the caller names: this verb writes the
respond-plan record whoever asked the gate.

### Gate respond-plan through gate-protocol

**Otherwise** (a direct terminal run) the verb runs the gate itself. It asks with the
`gate_ask` tool and answers a pane form with the `gate_answer` tool, per
gate-protocol's Runs integration; a gate is never asked or answered from
the shell.

- `run_field_set` with `key: "gate"`, `value: "respond-plan"`, `stage:
  <stage>`.
- Run gate-protocol's Runs integration with kind `respond-plan`, the open
  read from the file: read `<dir>/respond-plan.open.json` with the Read
  tool; call `gate_ask` with its `questions` array, `kind:
  "respond-plan"` and its `context`; act on the returned presentation as
  gate-protocol says.

  One question per thread keeps every question at three options, under
  the form cap, so a herdr pane gets `form` for any thread count; never
  fold several threads into one multi-select. It also makes reply / fix /
  skip mutually exclusive per thread by construction. The thread id lives
  in the option VALUE, never in the question id: every consumer joins by
  reading each `answers` key other than `code-changes`, unwrapping a
  `{value, note, text}` object to its `value`, and splitting at the first `:`;
  `thread-<n>` is a container, nothing keys on it.
- Over budget (the fit printed `"fits": false`, or the ask reported
  `contextOmitted`): right after the ask and before waiting on any
  answer, write one line, `gate-1-context: dropped`, into the saved
  verdict report (when there is one). A resumed pane has no other way to know
  those cards never showed their drafts (A dropped context, below).
- In-pane form (gate-protocol's presentation: "form" branch): the form
  never shows the JSON. Running
  `sh "${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh" prose < <dir>/respond-plan.source.json`
  prints the same open with every
  context as prose: show its `.context` as one line in the pane before
  the first form call, and make each thread question's form text its
  `label`, a newline, its prose `context`, then `Reply, fix, or skip?`,
  under the header `Thread <n>`. The form tool takes at most four
  questions per call, so ask the thread questions in order, up to four
  per call, until every thread is asked. Then one last call:
  `code-changes`, only when some thread answered `fix:` (otherwise submit
  its sentinel `skip` unasked, the same hide rule the board and console
  cards apply), plus a pane-only `next` question of **Continue** /
  **Iterate here** / **Hold**. That pane-only question never reaches the
  registry, and Iterate / Hold are never extra options on a thread or
  code-changes question: a fourth and fifth option there would push it
  over the cap.
  Continue: submit exactly ONE `gate_answer` after that last call,
  carrying every thread answer plus `code-changes`, never one per chunk.
  The pane's answer never carries `text`: a replacement reply the human
  types in the form's free-text field rides as `note`, which makes a
  `reply:` thread an override (Report rows, under Rewrite the
  receive-review report rows).
- `fix:<threadId>` implies that thread's reply; `skip:<threadId>` means
  neither.
- `run_decision` with `contract: "gate@1"`, `scope: "respond-plan"`, `selection: {"threads":{"<threadId>":"reply|fix|skip","...":"one entry per thread, keyed by the id read out of its answer value"},"texts":{"<threadId>":"<the answer's text>"},"overrides":["<threadId>"],"notes":{"<threadId>":"<the answer's note>"},"code-changes":"approve|revise|skip"}`, `decidedBy: <the answer's by>` (for a caller-handed `{plan}`, the decider the caller names).
  `threads` values stay the bare verbs. `texts` holds one entry per
  `reply:` answer that carries `text`; `overrides` lists every
  `gate-1: override` thread (Report rows); `notes` holds one entry
  per `gate-1: override` thread whose answer carried a note, that note;
  omit any of the three keys when it would be empty.

**Edited replies.** A `reply:<threadId>` answer may be an object whose
`text` is the reply to post for that thread, in place of the drafted
`reply.text`: `{"value": "reply:<threadId>", "text": "<edited reply>"}`.
A `reply:` answer that carries `text` posts that text, whether or not it
also carries a note, because the human wrote the exact words. `text` on a
`fix:` or `skip:` answer changes nothing.

**A dropped context.** When the respond-plan open reports `contextOmitted`,
its stderr ends "shorten and re-ask": do neither. Never shorten a reply
and never re-ask to fit. Keep the gate as opened, take its answers as
given, and count every thread's context as dropped, so every `reply:`
answer with no `text` is an override. On any resume, a caller-handed
`{plan}` in a fresh pane included, a report carrying the line
`gate-1-context: dropped` means the same, whoever opened the gate: a
caller that owns the gates writes that line into its own report.

### Redraft the replies with the respond-plan note

Redraft the replies the note asks about, per the reply rules, into the
verdict report, then build the open again. The re-ask is a NEW gate
(gate-protocol's Closed gates, Hold / Iterate), never a second answer to
the one just closed.

### Rewrite the receive-review report rows

**Report rows.** Once gate 1 is answered, rewrite each thread's row of
the verdict report (the saved report file too, when there is one) in this
shape, in verdict-table order:

```text
- <threadId> · <file>:<line> · <verdict>, recommended <action> · gate-1: <reply|fix|skip|override> · reply: "<text>"
```

| Field | Filled from |
|---|---|
| `gate-1` | the verb the developer answered, never the verdict report's recommendation: `reply`, `fix` or `skip`, except that a `reply:` is `override` when its answer carries no `text` and any one of these holds, whoever answered: its gate 1 reply was not verbatim (the card showed a `direction` or no reply); the answer carries a `note`; or its question context never reached the gate, so its draft may never have been shown: you dropped it for the size budget, or the open was whole-open over budget (a `"fits": false` open, one that reported `contextOmitted`, or a report carrying the line `gate-1-context: dropped`), which counts every thread's context as dropped |
| `reply` | the answer's `text` when it has one, else the verdict report's draft, else `none`; Commit the fix and finalize its Fixed reply rewrites a fixed row's reply and Redraft the override's reply an override's |

Every later posting, a resumed pane's included, reads these rows, never
the verdict report's recommendation: a `gate-1: reply` row posts its row's reply from
gate 1; an `override` row, and a `fix` row whose Fixed reply was finalized, are offered
at gate 2; a `skip` row, and a `fix` row under `code-changes: skip`, post
nothing. A resume with only the snapshot at hand reads the
respond-plan record instead: `threads` gives each verb, `texts` the
edited replies, `overrides` the reply overrides, offered at gate 2
beside any finalized fix, and `notes` the note to fold into an
override's redraft, so it never posts a draft an override was meant to
replace and never redrafts one without its note. A `reply` thread with
no `texts` entry has no recoverable gate 1 draft there, so count it as
an override (`gate-1: override`): redraft it and offer it at gate 2
beside the other overrides, never posting it from gate 1, however
closely the redraft follows the lost one.

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
this skill never checks their box. The counter is attempts on this thread.

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
reaches this box: `mr_threads {mrUrl, refresh: true} for the posted-already read` on GitLab, Read the PR's threads with gh for the posted-already test on GitHub. A read made earlier
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

Every `Off-script gate: ...` box asks this one gate, through
gate-protocol's Runs integration (this engine does not include
work-next-gate). Its scope is `off-script:receive-review:<n>`, `n`
counting from 1 within the stage attempt; its `context` quotes the refusal
or failure. Ask it with the `gate_ask` tool and submit the answer, a Hold
included, through the `gate_answer` tool (`id` the gate's id, `answers`
keyed by question id) before `run_decision` records it, per
gate-protocol's Acting on the response, so the registry gate never stays
open.

| Question | Options (recommended first) |
|---|---|
| `action` | **Take the proposed move** (its value spells the move in full) / **Hand back** |
| `next` | **Proceed** (Recommended) / **Iterate here** / **Hold** |

Selection: `{"move":"<the move>","why":"<the refusal or failure>","action":"take|handback","next":"proceed|iterate|hold","note":"<their words or null>"}`.

The answer diamond after each box reads it: `action: handback` is hand
back; otherwise `next` picks, proceed taking the move, iterate redoing
that site with their note, hold holding (at the two forge-refusal
sites, that thread only). After an iterate or take answer, the site's
attempt counter stays spent: the next failure there returns to the same
off-script gate, where the human answers again. Take makes exactly that move
once. Hand back is the `run_stage` fail node, with the why as its
`reason`; when a caller owns the gates, also carry the why in the
hand-back.

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
| "I'll process the resolved / bot threads too" | Unresolved human threads only. |
| "I'll ask both gate questions, the caller already handed `{plan, post}`" | Decision intake first: a caller-handed object answers `respond-plan` and `respond-post` -- ask nothing. |
| "I'll post the replies since they look right" | Post only what an answer picked: a `gate-1: reply` row, or an offered thread whose answer carries `post:`; resolve only those carrying `resolve:`; never approve for the developer. |
| "I'll offer the reply-only threads at `respond-post` too, for a last look" | The developer already saw that exact reply. `respond-post` offers only the replies they have not seen word for word: fixed threads and `reply:` overrides with no `text`. |
| "Gate 2's answer doesn't name the reply-only thread, so it stays unposted" | Gate 1 decided it. It posts once gate 2 proceeds, whatever gate 2 picked for its own threads, unless the open offered it or an answer value names it. |
| "They answered `reply:`, so the drafted reply posts now" | Only a reply they saw word for word posts from gate 1. A `reply:` with no `text` is an override when its card showed a direction or no reply, its answer carries a note, or its question context never reached the gate: redrafted and offered at `respond-post`. |
| "The pane showed the prose, so a dropped context does not matter" | The rule holds whoever answered. A `reply:` with no `text` on a thread whose question context never reached the gate is an override. |
| "The stderr says shorten and re-ask, so I'll trim the replies and open it again" | Never shorten a reply and never re-ask to fit. Take the answers as given; every `reply:` with no `text` is an override. |
| "I know the contexts were dropped; I'll apply that when the answer comes" | A pane that dies takes that knowledge with it. Write `gate-1-context: dropped` into the saved report right after the open. |
| "The draft is gone, but I know what it said, so I'll rebuild it and post it from gate 1" | A rebuilt reply is words the developer never saw. From the snapshot alone, a `reply` thread with no `texts` entry is redrafted and offered at `respond-post`. |
| "It's only a note, so the verbatim draft still posts" | A note on a `reply:` may change the reply, and in the pane form it is the only place a typed replacement can go. Redraft with it and offer the thread at `respond-post`. |
| "The verdict report recommended a reply here, so it posts" | Posting reads each report row's `gate-1` field, never the recommendation. A `gate-1: skip` row posts nothing. |
| "The plan record has no slot for the edited reply" | It goes in `texts` beside `threads`, and over the draft in the report's row for that thread. Overrides go in `overrides`, and an override's note in `notes`. |
| "The gate approved posting, not a push, so the Fixed reply goes up (or I ask first)" | "Fixed" with nothing on the remote is false. The proceed authorizes the push: check the branch and `@{push}`, push first, and a mismatch or failed push holds every picked `gate-1: fix` row. |
| "A plain push from the shell pushes the MR" | It pushes whatever branch is checked out, to its own destination, and any configured push refspec or mirror refs with it. Check both against the MR's source branch, then push that one branch: `git_push` with `tree` = this worktree, never forced. |
| "The fix is held, so I'll record respond-post once it posts" | A resume from the snapshot would re-offer the replies that already posted. Record now, with the fix threads under `"held"`. |
| "They ticked post before choosing Iterate (or Hold), so those picks act now" | Only `proceed` acts. On `hold` or `iterate` nothing pushes, posts, resolves or records, whatever the picks; every offered thread stays pending, and the re-ask is a new gate over the threads not yet posted. |
| "The snapshot has no respond-post record, so nothing has posted yet" | A pane can post and die before it records. On a resume, read each thread on the forge before its reply posts or a re-asked gate offers it: one carrying this run's reply (the same text, or a note by this run's account since `started_at`) is posted, counted as posted, never posted or offered again. |
| "This one is clearly right, I'll add the guard in a follow-up commit" | Implementation follows `respond-plan`'s `code-changes: approve`, not a line in the draft. |
| "It's wrong, but I need the reviewer to point me at it" | Then it is `needs-clarification`, not `pushback`. |
| "The caller asked the respond-plan gate, so it records the decision" | This verb records it: a handed `{plan}` gets the same `run_decision` as a pane answer, `decidedBy` the decider the caller names. A resume reads that record. |
| "I'll present the table and ask about fixes and posting in the same breath" | `respond-plan` and `respond-post` are two gates, in order. Prose that asks both at once is neither. |

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
