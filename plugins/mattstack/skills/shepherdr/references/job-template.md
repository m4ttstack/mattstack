Pointers here are `@keys`. Resolve them once per run: if you already hold a `skills_resolve` map that covers `mattstack@0.32.28:shepherdr`, use it; otherwise call `skills_resolve {id: "mattstack@0.32.28:shepherdr"}` and use the path it returns for each key. If it fails, stop and say so; never look for the file another way.

<!-- author -->
# shepherdr job brief template

Copy this template verbatim for every brief; fill the angle-bracket
slots. The formats are embedded because the contract must survive even
when the worker loads nothing else. A brief is assembled from two
verbatim copies, never composed: this template, plus one strategy body
copied verbatim into `## Method` from the bound strategy skill's
`references/strategies.md`.
<!-- /author -->

# JOB: <name>

<goal, one short paragraph>

## Method
<REQUIRED. One strategy body, copied verbatim from the bound strategy
skill's references/strategies.md with its slots filled. The body carries
this job's task list, verification, and report contract. A brief with no
Method section is a defect.>

## Write fence
You may write only under: <paths>. `.superpowers/` in this worktree is a permitted write path (superpowers owns `sdd/`; the report draft lives here too).

## Inputs (read-only)
<paths the worker may read and must not modify -- supplied specs or
plans, often gitignored and outside the worktree. "none" if none.>

## Repo conventions
<the gate skills that bind this job, named with absolute paths; task A0
for untracked state (dependency install, env or secrets sync); and the
branch name. "none" if the repo has no rules.>

## How this job runs

The herd_* tools read your herd, job and room from this pane's environment; never pass them to those tools.

Follow this graph. A move it does not show is a question for `herd_ask`,
never a judgment call. The sections after it give each tool's exact input.

```dot
digraph herd_job {
    rankdir=TB;

    trigger_brief_arrives [label="Trigger: this brief arrives" shape=ellipse];
    work_method [label="Work the Method" shape=box];
    method_need [label="What does the Method need next?" shape=diamond];
    stop_bare_pane_form [label="STOP: questions go through herd_ask, never a bare pane form" shape=octagon style=filled fillcolor=red fontcolor=white];
    herd_ask_decision [label="herd_ask {questions, context}: a decision" shape=plaintext];
    herd_milestone_spec_plan [label="herd_milestone {artifact, summary}: a spec or plan" shape=plaintext];
    run_enter [label="run_enter {flags, skillDir: <the verb's skill dir>, spawnedBy: herd:<HERD_ID>}" shape=plaintext];
    stop_shell_push [label="STOP: push only with git_push" shape=octagon style=filled fillcolor=red fontcolor=white];
    git_push_upstream [label="git_push {tree: <root>, setUpstream: true}" shape=plaintext];
    git_push_result [label="git_push result?" shape=diamond];
    herd_ask_push_refused [label="herd_ask {questions, context}: the push was refused" shape=plaintext];
    forge_host [label="Forge?" shape=diamond];
    mr_create [label="mr_create {repoName, sourceBranch, targetBranch, title, description}" shape=plaintext];
    gh_pr_create [label="gh pr create" shape=plaintext];
    gate_opened [label="Gate opened?" shape=diamond];
    stop_wait_for_herd_answer [label="STOP: wait; the answer comes only through herd_answer" shape=octagon style=filled fillcolor=red fontcolor=white];
    end_turn_wait [label="End the turn until the gate answer arrives" shape=box];
    trigger_gate_answered [label="Trigger: [gate] <id> answered" shape=ellipse];
    herd_answer [label="herd_answer {gate: <id>}" shape=plaintext];
    which_gate [label="Which gate was it?" shape=diamond];
    revision_rounds_spent [label="Revision rounds on this milestone = 3?" shape=diamond];
    revise_artifact [label="Revise the artifact" shape=box];
    herd_milestone_revised_artifact [label="herd_milestone {artifact, summary}: the revised artifact" shape=plaintext];
    herd_ask_keep_revising [label="herd_ask {questions, context}: keep revising?" shape=plaintext];
    trigger_chat_message [label="Trigger: a chat message arrives" shape=ellipse];
    needs_reply [label="Does it need a reply?" shape=diamond];
    stop_send_message [label="STOP: reply with chat_dm, never SendMessage" shape=octagon style=filled fillcolor=red fontcolor=white];
    chat_dm [label="chat_dm {to: <sender id>, body}" shape=plaintext];
    write_report_draft [label="Write the report draft" shape=box];
    herd_report [label="herd_report {body}" shape=plaintext];
    reported [label="Reported: stop" shape=doublecircle style=filled fillcolor=lightgreen];

    trigger_brief_arrives -> work_method;
    work_method -> method_need;
    method_need -> work_method [label="more of the task list"];
    method_need -> herd_ask_decision [label="a decision from the user"];
    method_need -> stop_bare_pane_form [label="tempted to put up a form in this pane"];
    stop_bare_pane_form -> herd_ask_decision;
    method_need -> herd_milestone_spec_plan [label="a milestone review"];
    method_need -> run_enter [label="a pipeline verb"];
    method_need -> git_push_upstream [label="a push or PR the goal asks for"];
    method_need -> stop_shell_push [label="tempted to push from the shell"];
    stop_shell_push -> git_push_upstream;
    method_need -> write_report_draft [label="the work is done"];
    run_enter -> work_method;
    git_push_upstream -> git_push_result;
    git_push_result -> forge_host [label="ok"];
    git_push_result -> herd_ask_push_refused [label="refused"];
    forge_host -> mr_create [label="GitLab"];
    forge_host -> gh_pr_create [label="GitHub"];
    mr_create -> work_method;
    gh_pr_create -> work_method;
    herd_ask_decision -> gate_opened;
    herd_ask_push_refused -> gate_opened;
    herd_ask_keep_revising -> gate_opened;
    herd_milestone_spec_plan -> gate_opened;
    herd_milestone_revised_artifact -> gate_opened;
    gate_opened -> end_turn_wait [label="yes"];
    gate_opened -> stop_wait_for_herd_answer [label="no: the call failed"];
    end_turn_wait -> trigger_gate_answered [style=dashed];
    trigger_gate_answered -> herd_answer;
    herd_answer -> which_gate;
    which_gate -> work_method [label="a question, or a milestone Approve: act on it"];
    which_gate -> revision_rounds_spent [label="a milestone Revise"];
    which_gate -> end_turn_wait [label="Spawn a reviewer: the findings come by DM"];
    revision_rounds_spent -> revise_artifact [label="no"];
    revision_rounds_spent -> herd_ask_keep_revising [label="yes: budget spent"];
    revise_artifact -> herd_milestone_revised_artifact;
    trigger_chat_message -> needs_reply;
    needs_reply -> chat_dm [label="yes"];
    needs_reply -> work_method [label="no: it informs, or is a new instruction"];
    needs_reply -> revision_rounds_spent [label="findings from review-<your job>"];
    needs_reply -> stop_send_message [label="tempted to reply with SendMessage"];
    stop_send_message -> chat_dm;
    chat_dm -> work_method;
    write_report_draft -> herd_report;
    herd_report -> reported;
}
```

### Work the Method

`## Method` above is the work: its task list, its verification, its
report contract and its own budgets. Come back to the graph whenever the
Method needs something the graph names.

### End the turn until the gate answer arrives

Nothing arms: no background wait, no polling, no reading the registry
yourself. The answer arrives in your context as a message; only then call
`herd_answer`. After **Spawn a reviewer**, what arrives next is the
reviewer's findings as a chat message from `review-<your job>`.

### Revise the artifact

Apply the note from a Revise answer, or the findings DM from
`review-<your job>`, to the artifact; then publish it again as a fresh
milestone. Each counts as a revision round; once three rounds on one
milestone have run, ask whether to keep revising instead.

### Write the report draft

Write the report your Method requires to `.superpowers/report-draft.md`
(`mkdir -p .superpowers` first); `## Publishing a report` below gives the
call.

## Pipeline runs
When your Method runs a pipeline verb (`work`, `ship`, `review`, ...),
load its skill and walk its graph. The verb opens its own run: its first
call is `run_enter`, the one start the run gets, and to that call you add
`spawnedBy: "herd:<HERD_ID>"`, with `skillDir` the base directory of the
pipeline verb's skill you just loaded (an absolute path), where
`<HERD_ID>` is the value of `HERD_ID` in this pane's environment
(`printenv HERD_ID` prints it). The
`spawnedBy` field makes the verb's run take its unattended branch, so the run's gated
questions ride the daemon's gate registry and reach the shepherd through
the same door as the questions below. Inside that run, questions go
through `gate_ask`, never a bare form.

## Asking the user a question
Call the `herd_ask` tool with exactly this input:

    {"questions": [{"id": "q1", "label": "<the decision, under 12 words>", "multi": false, "options": [
      {"value": "<your recommendation, in full>", "label": "<2 to 6 words>", "description": "<one sentence: what this choice does>"},
      {"value": "<alternative, in full>", "label": "<2 to 6 words>", "description": "<one sentence>"},
      {"value": "<alternative, in full>", "label": "<2 to 6 words>", "description": "<one sentence>"}]}],
     "context": "<two or three sentences: what you were doing and why it needs a decision>"}

The call is your first action, before any text. The user reads only each
option's `label` and `description`; `value` comes back to you verbatim,
so it carries the full wording. rt refuses a label over 60 characters.
The first option is always your recommendation, and every question is
multiple choice, even a confirmation ("Approve, proceed" / "Approve with
changes (describe)" / "Walk me through <section> first"). The answer
arrives as `[gate] <id> answered by <surface>; re-read the registry and
proceed on the recorded answer.`: call `herd_answer {gate: <id>}` and act
on what it returns, including any `note`. An answer that did not arrive
through `herd_answer` does not exist. If the call itself failed, wait:
no invented reason, no asking in the pane, no deciding yourself.

## Publishing a milestone
When your Method stops at a milestone (a spec or a plan is ready for
review), call the `herd_milestone` tool exactly:

    {"artifact": "<absolute path to the artifact>", "summary": "<one line>"}

The answer arrives like a question's. **Approve**: continue. **Revise**:
the `note` carries the feedback ("see pane" means it was left in your
pane). **Spawn a reviewer**: findings arrive as a chat message from
`review-<your job>`.

## Publishing a report
Write the report your Method section requires to
.superpowers/report-draft.md in this worktree, then call the
`herd_report` tool with that file's full contents as `body` (the tool
takes the report text, not a path):

    {"body": "<the full text of .superpowers/report-draft.md>"}

then STOP.

## Messages
Your shepherd is <shepherd handle> in chat (id <shepherd id>). Anything
you send the shepherd outside a gate, a milestone or a report goes by
`chat_dm` to <shepherd id>, never to a handle guessed from the role.

Chat arrives as `[#<room>] <name> #<n>: ...` or `[dm] <name> #<n>: ...`,
with a reply hint that names the sender's identity id
(`rt chat dm <id> "..."`). Reply with the `chat_dm` tool, `to` = that id. <!-- mcp-lint: allow -->
Only when `chat_sign_in` refuses because this session was replaced by
`/clear`, reply with `rt chat dm <id>` in Bash instead, the body on stdin <!-- mcp-lint: allow -->
from a quoted heredoc.

## Git
Commit incrementally on this branch. Push only when the goal above asks
you to ship, push, or open a PR or MR: `git_push` with `tree` = this
worktree's root and `setUpstream: true`, then `mr_create` on a GitLab
origin or `gh pr create` on a GitHub origin. Any other goal: never push;
the commits on this branch are the deliverable. Questions, milestones,
and reports go through the herd tools, never into the repo. Tooling that
manages its own workspace inside the repo writes where that tooling
specifies; the write fence lists those paths.

## Delegation
For searches, codebase exploration, and mechanical subtasks, dispatch
subagents on cheaper models instead of doing them in your own context.
Reserve your own turns for design decisions and the work itself.

## Processes
Stop only processes you started, by PID (`kill <pid>`) or through the
background task's own stop. Never kill by pattern (`pkill -f`, <!-- mcp-lint: allow -->
`killall`): other lanes run on this machine, and a pattern such as a test
command also matches their agents' command lines.
