---
name: self-review
disable-model-invocation: true
description: >-
  Use when reviewing, sanity-checking, or gut-checking work this session
  produced on the current branch, before shipping or between tasks --
  "review my work", "is this solid?", "gut-check my changes",
  "self-review this branch". For a teammate's MR/PR use the domain's
  review skill instead.
type: pipeline-step
slots:
  criteria: { contract: review-criteria@1, required: false }
  reviewer: { contract: reviewer-dispatch@1, required: false }
---

# Self-review (your own branch)

Reviewing the change you just made, at any checkpoint between tasks or right
before shipping. This is the self-facing caller of the review flow inlined
below: point the engine at the current branch, then act on the draft it
returns.

## Run

Outside a pipeline this verb is its own run, so the console shows it and
the Stop hook covers its pane. Skip this section when `RT_RUN_DB` is set
and `rt runs snapshot` shows `run.status` = `running`: you were invoked
from inside that run, you inherit it, `run.current_stage` is your stage,
and you close nothing at the end.

Otherwise, when a surface launched this pane (the `--spawned-by` case
below), start fresh: another pane's live run is not yours to resume.
Launched by hand, first the Resume offer: list `~/.mattstack/runs/<repo>/`
(the `--repo` value in the flags block below) for runs whose `snapshot`
shows `run.status` = `running` and `run.work_type` = `self-review` (read each with
`RT_RUN_DB` pointed at its `state.db`; never raw sqlite). Any found: gate
`clarify`, one sentence naming each candidate's `spawned_by`, `started_at`,
and `current_stage`, then the structured-question tool with one **Resume**
option per candidate (recommended for a run this session started earlier; a
run another live pane owns is not yours) / **Start fresh**; **Hold**.
Resume: `export RT_RUN_DB=<its state.db>`, then `rt runs stage-start --stage
self-review` (a new attempt, which re-records this session) and `rt runs field set
hold - --stage self-review`; re-enter with the snapshot's decisions and do not
re-ask a question it already answered.

Fresh. The flags for this verb, rendered by the compiler:

{{run-start.flags:self-review}}

```bash
PACK_DIRS="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd -P)"
rt runs run-start <the flags above> --pack-dirs "$PACK_DIRS" [--spawned-by "<surface>"]
export RT_RUN_DB=<runDb from the response>
rt runs stage-start --stage self-review
```

The response must parse as JSON with `ok: true` and a `runDb`; anything
else means this rt predates the run verbs: stop and tell the user to
update rt. Pass `--spawned-by` when a board or another surface launched
this pane.

Every gate in this verb then writes its `gate` field and its decision with
`--stage self-review`. The close, after the final gate's answer and only when
this section ran `run-start`: `rt runs stage-done --stage self-review`, `rt runs
run-status --status done` (or `abandoned` when the gate said so), then
`unset RT_RUN_DB`.

Whoever wrote the code re-derives the same assumptions while reading it back
and nods at them; a bug on the page reads as the intent that produced it. The
judgment does not happen here -- it happens in the fresh context that
the review flow dispatches.

<HARD-GATE>
Do not form the code-quality judgment yourself -- not even a careful first
pass meant to be backed up by a fresh review later. The fresh-context
reviewer is the PRIMARY reviewer, not an optional escalation, and this skill
owns dispatching it (via the review flow below) rather than suggesting the
developer get a review elsewhere. Objective checks (tests, type checks,
linters) are fine and expected -- authorship does not bias a compiler.
Reading the diff and deciding whether it is "solid" is not; that is the
reviewer's job.

A request to skip the dispatch -- "don't burn tokens on subagents," a late
hour, a partner who just wants a gut check -- does not waive this gate; the
gate outranks it. The fresh review is one dispatch, not a proliferation of
subagents; skipping it does not save the partner's time, it moves the cost
downstream to production. Diligence performed inside the biased context is
still the biased context, so checking carefully before the inline verdict
does not launder it into independence. And a plausible issue turned up
inline is evidence of what surfaced, not of what a fresh, unbiased read would
catch that this one missed.
</HARD-GATE>

## 1. Point at the branch

- Diff: the merge-base with the default branch (`git merge-base origin/HEAD
  HEAD`, falling back to the default branch by name) through `HEAD`, plus any
  uncommitted changes -- review the work as it stands now.
- Requirements: from the branch's ticket or task description. If the branch
  carries no ticket, gate `clarify`: one sentence, then the structured-question
  tool with the candidate sources (the task as stated, a linked doc, their
  text) rather than reviewing against nothing.

## 2. Delegate to the review engine

Follow the review flow below -- with the diff,
requirements, and a label (the branch or task name). It triages depth, sets up, dispatches the fresh-context
reviewer, and returns the draft. Already in the worktree, so `verify` /
`repro` setup is just running the checks -- no provisioning needed. Do not
skip the fresh reviewer and read the diff for judgment yourself, however
small the change -- see the HARD-GATE above.

{{include:review-core-body}}

## Criteria

{{slot:criteria}}

{{include:review-core-body-after}}

{{include:review-dispatch-body}}

## Reviewer

{{slot:reviewer}}

{{include:review-dispatch-body-after}}

{{include:review-core-body-tail}}

## 3. The draft, then gate `self-review`

The review flow returns Strengths / Issues (Critical / Important / Minor) /
Assessment. Present it, then the gate; the draft is the sentence, the form
is the close:

- `rt runs field set gate self-review --stage <stage>` (`self-review` for an
  own run, `run.current_stage` when inherited).
- The form: **Fix the blocking findings now** (recommended when any
  Critical or Important exists) / **Fix the minors too** / **Ship as is**;
  **Iterate here**; **Hold**.
- `rt runs decision record --contract gate@1 --scope self-review --selection '{"fix":"blocking|all|none","note":"<their words or null>"}' --decided-by self-review`.
- Fix: one finding at a time, test-first, verify each; then the flow that
  called this verb continues (ship, or the next task). Ship as is: hand
  back with the Minor findings listed for the record.

Where the domain defines ship-time gates, this self-review complements them
and never checks their box.

Close, only when `## Run` started this run: after the fixes the gate
selected are verified, `rt runs stage-done --stage self-review`, `rt runs
run-status --status done`, `unset RT_RUN_DB`.

## Wrap-up form contract

{{include:wrap-up-form}}

## Red flags

| Thought | Reality |
|---|---|
| "For a change this small I'll just give my own read" | Small, own-authored changes are peak author bias, not an exemption. Dispatch the fresh reviewer. |
| "I'll do a first-pass read myself and a fresh review can back it up" | The fresh reviewer IS the review, not a backup for one already formed. Don't pre-empt it with an inline verdict. |
| "I'll suggest the developer get a review elsewhere" | This skill owns the dispatch; don't outsource it back to whoever is waiting. |
| "Re-reading my own lines is low-value, I'll just eyeball and ship" | Right that re-reading is low-value -- which is why a fresh context, not this eyeball, does the reading. |
| "I know what this does, I just wrote it" | That is the bias stated as a qualification. Dispatch the reviewer. |

## Quick reference

| Signal | Action |
|---|---|
| "Is this solid?" on the current branch | Point at the branch: diff + requirements (step 1). |
| Diff + requirements in hand | Delegate to the review flow (triage -> fresh reviewer -> draft). |
| About to give an own read of the diff | Don't. The fresh reviewer is primary; this skill owns dispatching it. |
| Draft in hand | Present it, then gate self-review: fix blocking / fix all / ship as is. |
