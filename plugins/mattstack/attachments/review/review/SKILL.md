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
(`glab mr view <ref>` or `gh pr view <ref>`); ambiguity goes back to the
user as a question, never a guess.

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

## 3. Deliver

Present the draft to the user. Nothing leaves the machine without an
explicit go. On approval, post using the forge's thread mechanics: on GitHub
use `gh pr review` / `gh pr comment`; on GitLab follow the thread mechanics
below.

{{include:gitlab-mr-threads}}
