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

The standalone entry for reviewing someone else's change.

## Run

Outside a pipeline this verb is its own run, so the console shows it and
the Stop hook covers its pane. Skip this section when `RT_RUN_DB` is set
and `rt runs snapshot` shows `run.status` = `running`: you were invoked
from inside that run, you inherit it, `run.current_stage` is your stage,
and you close nothing at the end.

Otherwise, first the Resume offer: list `~/.mattstack/runs/<repo>/` (the
`--repo` value in the flags block below) for a run whose `snapshot` shows
`status` = `running` and `work_type` = `review`
(read each with `RT_RUN_DB` pointed at its `state.db`; never raw sqlite).
One found: gate `clarify`, one sentence naming it, the structured-question
tool with **Resume it** (recommended) / **Start fresh**. Resume: `export
RT_RUN_DB=<its state.db>`, then `rt runs stage-start --stage review` (a new
attempt, which re-records this session) and `rt runs field set hold -
--stage review`.

Fresh. The flags for this verb, rendered by the compiler:

{{run-start.flags:review}}

```bash
PACK_DIRS="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd -P)"
rt runs run-start <the flags above> --pack-dirs "$PACK_DIRS" [--spawned-by "<surface>"]
export RT_RUN_DB=<runDb from the response>
rt runs stage-start --stage review
```

The response must parse as JSON with `ok: true` and a `runDb`; anything
else means this rt predates the run verbs: stop and tell the user to
update rt. Pass `--spawned-by` when a board or another surface launched
this pane.

Every gate in this verb then writes its `gate` field and its decision with
`--stage review`. The close, after the final gate's answer and only when
this section ran `run-start`: `rt runs stage-done --stage review`, `rt runs
run-status --status done` (or `abandoned` when the gate said so), then
`unset RT_RUN_DB`.

## 1. Resolve the target

From the conversation: an MR/PR URL, a bare !iid or #number, a ticket id,
or a branch name. Resolve to one MR/PR via the forge CLI
(`glab mr view <ref>` or `gh pr view <ref>`); ambiguity is gate `clarify`:
one sentence naming the candidates, then the structured-question tool
with one option per candidate (`rt runs field set gate clarify --stage
<stage>` before and `rt runs decision record --contract gate@1 --scope
clarify --selection '{"target":"<picked>"}' --decided-by review` after).
Never a guess.

## 2. Review

Fetch the diff (`glab mr diff` / `gh pr diff`). Then follow the review flow
below for depth triage, fresh-context reviewer dispatch, and the structured
draft. Its Criteria section carries the domain's review standards when the
pack binds them; apply its triage lines and addendum exactly as it directs.

{{include:review-core-body}}

## Criteria

{{slot:criteria}}

{{include:review-core-body-after}}

{{include:review-dispatch-body}}

## Reviewer

{{slot:reviewer}}

{{include:review-dispatch-body-after}}

{{include:review-core-body-tail}}

## 3. Deliver

Present the draft, then the two posting gates below as two structured
questions, in order, each its own call: gate `post-severity` (Gate 1),
then gate `post-disposition` (Gate 2). Each gate is bracketed by `rt runs
field set gate <scope> --stage <stage>` before the question and `rt runs
decision record --contract gate@1 --scope <scope> --selection '<JSON>'
--decided-by review` after the answer (`{"levels":[...]}` for Gate 1,
`{"disposition":"comment|approve|request_changes"}` for Gate 2). Each form
also offers **Iterate here** (their text changes the draft; re-present it
and gate again) and **Hold**. Nothing leaves the machine without both
answers. Post using the forge's thread mechanics: on GitHub use `gh pr
review` / `gh pr comment`; on GitLab follow the thread mechanics below.

Close, only when `## Run` started this run: `rt runs stage-done --stage
review`, `rt runs run-status --status done`, `unset RT_RUN_DB`. The final
message still ends with the target's link (the close HARD-GATE below).

## Wrap-up form contract

{{include:wrap-up-form}}

{{include:review-posting}}

{{include:gitlab-mr-threads}}
