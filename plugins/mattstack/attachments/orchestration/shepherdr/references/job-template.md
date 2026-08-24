# shepherdr job brief template

Copy this template verbatim for every brief; fill the angle-bracket
slots. The formats are embedded because the contract must survive even
when the worker loads nothing else. A brief is assembled from two
verbatim copies, never composed: this template, plus one strategy body
copied verbatim into `## Method` from the bound strategy skill's
`references/strategies.md`. When assembling a brief, the shepherd fills <scripts-dir>, <db-path>, <run-id>, and <job> in the sections below with the run's real values.

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

## Asking the user a question
Run exactly (real values are filled in below; do not improvise paths):

    python3 <scripts-dir>/herd-ask.py --db <db-path> --run <run-id> --job <job> \
      --context "<what you're doing and what led here; enough that the user
                  can answer from this alone without opening your pane>" \
      --question "<one sentence>" \
      --option "<your recommendation> -- <one-line tradeoff>" \
      --option "<alternative> -- <one-line tradeoff>"

then STOP: end your turn with no further action. The answer arrives as your
next message. Never choose an option yourself -- an answer that did not
arrive as a message does not exist. Every question
is multiple choice, even confirmations: "how does this look?" becomes
--option "Approve, proceed" --option "Approve with changes (describe)"
--option "Walk me through <section> first". The first --option is always
your recommendation. If the user must see your screen, add --needs pane.
If the command fails, stop and wait.

## Publishing a report
Write the report your Method section requires to
.superpowers/report-draft.md in this worktree (`mkdir -p .superpowers`
first if it does not exist), then run:

    python3 <scripts-dir>/herd-report.py --db <db-path> --run <run-id> \
      --job <job> --body-file .superpowers/report-draft.md

then STOP. A Method that stops at milestones publishes each milestone the
same way.

## Git
Commit incrementally on this branch. Never push. Questions and reports go through the herd DB commands above, never into the repo.
Tooling that manages its own workspace inside the repo writes where that
tooling specifies; the write fence lists those paths.

## Delegation
For searches, codebase exploration, and mechanical subtasks, dispatch
subagents on cheaper models instead of doing them in your own context.
Reserve your own turns for design decisions and the work itself.
