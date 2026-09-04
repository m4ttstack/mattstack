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

Otherwise, when a surface launched this pane (the `--spawned-by` case
below), start fresh: another pane's live run is not yours to resume.
Launched by hand, first the Resume offer: list `~/.mattstack/runs/<repo>/`
(the `--repo` value in the flags block below) for runs whose `snapshot`
shows `run.status` = `running` and `run.work_type` = `review` (read each with
`RT_RUN_DB` pointed at its `state.db`; never raw sqlite). Any found: gate
`clarify`, one sentence naming each candidate's `spawned_by`, `started_at`,
and `current_stage`, then the structured-question tool with one **Resume**
option per candidate (recommended for a run this session started earlier; a
run another live pane owns is not yours) / **Start fresh**; **Hold**.
Resume: `export RT_RUN_DB=<its state.db>`, then `rt runs stage-start --stage
review` (a new attempt, which re-records this session) and `rt runs field set
hold - --stage review`; re-enter with the snapshot's decisions and do not
re-ask a question it already answered. Each tool call is a fresh shell:
prefix every `rt runs` command with `RT_RUN_DB=<its state.db>`.

Fresh. The flags for this verb, rendered by the compiler:

{{run-start.flags:review}}

```bash
PACK_DIRS="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd -P)"
rt runs run-start <the flags above> --pack-dirs "$PACK_DIRS" [--spawned-by "<surface>"]
export RT_RUN_DB=<runDb from the response>   # each tool call is a fresh shell: prefix every rt runs command with RT_RUN_DB=<runDb>
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

{{include:run-identity}}

## 1. Resolve the target

From the conversation: an MR/PR URL, a bare !iid or #number, a ticket id,
or a branch name. Resolve to one MR/PR via the forge CLI
(`glab mr view <ref>` or `gh pr view <ref>`); ambiguity is gate `clarify`:
one sentence naming the candidates, then the structured-question tool
with one option per candidate and **Hold** (`rt runs field set gate clarify --stage
<stage>` before, where `<stage>` is `review` for an own run and
`run.current_stage` when inherited, and `rt runs decision record --contract gate@1 --scope
clarify --selection '{"target":"<picked>"}' --decided-by review` after).
Never a guess.

When the run is yours, record the resolved target per Run identity above:
`mr` (the MR/PR URL), `branch` (its source branch), `ticket` (the id the
MR itself names in branch, title, or description, when one exists).

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

Present the draft, then state the severity levels present in one structured
line -- for example "Findings: Critical (2), Important (1)." -- skipping
any level with no findings.

Decision intake: when the caller hands this step a decided selection (a
board wrapper, or any @2 caller, handing `{tiers, outcome}` down through the
fill -- tiers naming the severity levels, outcome naming the disposition),
use it and ask nothing. Otherwise (a direct terminal run) ask ONE combined
question with the runtime's structured-question tool: tiers multi-select
over the levels present (every level with findings pre-selected),
disposition single-select (Comment pre-selected; the offered set is
forge-conditional -- Request changes only where the target forge's CLI
supports it, `gh` does, `glab` does not; verify before offering, don't
assume from memory), plus **Iterate here** (their text changes the draft;
re-present it and ask again) and **Hold**. The old two-gate protocol --
`post-severity` then `post-disposition` as two sequential structured
questions -- retires: nothing here presents two gates in a row.

When this step asks its own question, bracket it the way every gate does:
`rt runs field set gate post --stage <stage>` before the question. Skip
that write when the caller already handed the decision -- nothing is
pending in that case.

Execute posting per review-posting (below), handing it the decided
selection as `{levels: <tiers>, disposition: <outcome>}`. Then, when an
rt-runs run is active, record the decision at execution time, after
posting: `rt runs decision record --contract gate@1 --scope post
--selection '{"levels":[...],"disposition":"..."}' --decided-by <decider>`,
where `<decider>` names the surface that actually answered -- `board`,
`console`, `pane`, or `shepherd`. Use the decider the caller names alongside
its handed selection; when this step asked its own question, `<decider>` is
`pane`. This replaces the old `post-severity` + `post-disposition` record
pair with one record at scope `post`.

Post using the forge's thread mechanics: on GitHub use `gh pr review` / `gh
pr comment`; on GitLab follow the thread mechanics below.

Review verbs produce judgment and execute posting; they never decide what
posts.

Close, only when `## Run` started this run: `rt runs stage-done --stage
review`, `rt runs run-status --status done`, `unset RT_RUN_DB`. The final
message still ends with the target's link (the close HARD-GATE below).

## Wrap-up form contract

{{include:wrap-up-form}}

{{include:review-posting}}

{{include:gitlab-mr-threads}}
