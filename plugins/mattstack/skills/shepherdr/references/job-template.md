# shepherdr job brief template

Copy this template verbatim for every brief; fill the angle-bracket
slots. The formats are embedded because the contract must survive even
when the worker loads nothing else. A brief is assembled from two
verbatim copies, never composed: this template, plus one strategy body
copied verbatim into `## Method` from the bound strategy skill's
`references/strategies.md`. The sections below need no fill: the tools read `HERD_ID`, `HERD_JOB`, and `HERD_ROOM` from the environment the herd spawn gave this pane.

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

## Pipeline runs
When your Method runs a pipeline verb (`work`, `ship`, `review`, ...),
start its run with the `run_start` tool and pass
`spawnedBy: "herd:<HERD_ID>"`, where `<HERD_ID>` is the value of
`HERD_ID` in this pane's environment (`printenv HERD_ID` prints it). That
field makes the verb's own attendance test take the unattended branch, so the
run's gated questions ride the daemon's gate registry and reach the
shepherd through the same door as the questions below.

## Never raise a form the shepherd cannot see

A structured question (this runtime's native form tool) is safe only when
it is the declared presentation of a gate already open in the daemon's
registry (`presentation: "form"` plus a `paneId`, which is what lets a
remote answer reach you). Never put up a bare pane-local form on your own
initiative outside that path: it makes this pane unreachable from every
channel at once, not only from the shepherd, and a form with no backing
gate can sit unanswered indefinitely because nothing else knows it
exists. Every question this brief asks you to raise goes through the
`herd_ask` tool below, or through the `gate_ask` tool inside a pipeline
run -- both open the backing gate before anything appears on screen.

## Asking the user a question
Call the `herd_ask` tool with exactly this input:

    {"questions": [{"id": "q1", "label": "<the decision, under 12 words>", "multi": false, "options": [
      {"value": "<your recommendation, in full>", "label": "<2 to 6 words>", "description": "<one sentence: what this choice does>"},
      {"value": "<alternative, in full>", "label": "<2 to 6 words>", "description": "<one sentence>"},
      {"value": "<alternative, in full>", "label": "<2 to 6 words>", "description": "<one sentence>"}]}],
     "context": "<two or three sentences: what you were doing and why it needs a decision>"}

then END YOUR TURN with no further action. The user reads only each
option's `label` and `description`, on a small form; `value` is what comes
back to you verbatim, so it carries the full wording. rt refuses a label
over 60 characters. The answer arrives as a message
in your context, naming the surface that recorded it: `[gate] <id> answered
by <surface>; re-read the registry and proceed on the recorded answer.` The
daemon never sends this push to the surface that recorded the answer. When it
does, call `herd_answer {gate: <id>}`
and continue on what it returns,
including any `note` the user added. Never choose an option yourself; an
answer that did not arrive through `herd_answer` does not exist. Every
question is multiple choice, even confirmations: "how does this look?"
becomes options labelled "Approve, proceed", "Approve with changes
(describe)", "Walk me through <section> first". The first option is always your
recommendation. Your first action is the `herd_ask` call itself, its
`questions` and `context` filled in exactly as shaped above, before any
text -- not a sentence about whether it will work, not a summary of the
decision, the call first. Only after the call returns may you say whether
it succeeded or failed. If it failed, stop and wait exactly as written: no
invented reason (an unset variable, a missing tool, a daemon version), no
asking the user to just answer directly instead, no proceeding on your own
judgment -- nothing further until the answer arrives through `herd_answer`.

## Publishing a milestone
When your Method stops at a milestone (a spec or a plan is ready for
review), call the `herd_milestone` tool exactly:

    {"artifact": "<absolute path to the artifact>", "summary": "<one line>"}

then END YOUR TURN. The answer arrives like a question's: call
`herd_answer {gate: <id>}`. **Approve**: continue. **Revise**: the `note`
carries the feedback ("see pane" means it was left in your pane); revise,
then publish the milestone again. **Spawn a reviewer**: findings arrive as
a chat message from `review-<your job>`; revise, then publish the
milestone again.

## Publishing a report
Write the report your Method section requires to
.superpowers/report-draft.md in this worktree (`mkdir -p .superpowers`
first if it does not exist), then call the `herd_report` tool with that
file's full contents as `body` (the tool takes the report text, not a
path):

    {"body": "<the full text of .superpowers/report-draft.md>"}

then STOP.

## Messages
Anything from the shepherd or a reviewer arrives in your context as a chat
message (`[#<room>] <handle> #<n>: ...` or `[dm] <handle> #<n>: ...`).
Reply with `rt chat dm <handle> "..."`, never with SendMessage. A message
that changes your task is a new instruction; a message that only informs
needs no reply.

## Git
Commit incrementally on this branch. Never push. Questions, milestones, and reports go through the herd tools above, never into the repo.
Tooling that manages its own workspace inside the repo writes where that
tooling specifies; the write fence lists those paths.

## Delegation
For searches, codebase exploration, and mechanical subtasks, dispatch
subagents on cheaper models instead of doing them in your own context.
Reserve your own turns for design decisions and the work itself.
