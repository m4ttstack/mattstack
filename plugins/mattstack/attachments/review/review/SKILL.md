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

## 1. Resolve the target

From the conversation: an MR/PR URL, a bare !iid or #number, a ticket id,
or a branch name. Resolve to one MR/PR via the forge CLI
(`glab mr view <ref>` or `gh pr view <ref>`); ambiguity is gate `clarify`:
one sentence naming the candidates, then the structured-question tool
with one option per candidate (when `RT_RUN_DB` is set, `rt runs field set
gate clarify --stage review` before and `rt runs decision record
--contract gate@1 --scope clarify --selection '{"target":"<picked>"}'
--decided-by review` after). Never a guess.

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
then gate `post-disposition` (Gate 2). When `RT_RUN_DB` is set, each gate
is bracketed by `rt runs field set gate <scope> --stage review` before the
question and `rt runs decision record --contract gate@1 --scope <scope>
--selection '<JSON>' --decided-by review` after the answer
(`{"levels":[...]}` for Gate 1, `{"disposition":"comment|approve|request_changes"}`
for Gate 2). Each form also offers **Iterate here** (their text changes
the draft; re-present it and gate again) and **Hold**. Nothing leaves the
machine without both answers. Post using the forge's thread mechanics: on
GitHub use `gh pr review` / `gh pr comment`; on GitLab follow the thread
mechanics below.

## Wrap-up form contract

{{include:wrap-up-form}}

{{include:review-posting}}

{{include:gitlab-mr-threads}}
