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
Launched by hand, first the Resume offer: run `rt runs --repo <repo>
--json` (the `--repo` value in the flags block below) and keep the runs
whose `status` is `running` and `work_type` is `review`; never read the
run dbs by hand. Any found: gate
`clarify`, one sentence naming each candidate's `spawned_by`, `started_at`,
and `current_stage`, then the structured-question tool with one **Resume**
option per candidate (recommended for a run this session started earlier; a
run another live pane owns is not yours) / **Start fresh**; **Hold**.
Resume: `export RT_RUN_DB=~/.mattstack/runs/<repo>/<its id>/state.db`
(the candidate row's `id`), then `rt runs stage-start --stage
review` (a new attempt, which re-records this session) and `rt runs field set
hold - --stage review`; re-enter with the snapshot's decisions and do not
re-ask a question it already answered. rt runs verbs resolve your run
automatically (env RT_RUN_DB first, else the run this session started,
else the newest running run in this worktree; ambiguity errors loudly).
Export RT_RUN_DB only to drive a different run than yours.

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
line -- for example "Findings: Critical (2), Important (1); 3 findings." --
skipping any level with no findings. The counts are the draft's own,
before any selection narrows what posts.

Decision intake: when the caller hands this step a decided selection (a
board wrapper, or any @2 caller, handing `{findings, outcome}` down through
the fill -- findings naming the finding ids from the report json, outcome
naming the disposition; an unmigrated caller hands the legacy `{tiers,
outcome}` instead, tiers naming severity levels), use it and ask nothing.
Use the decider the caller names alongside it. Every other path builds the
open first.

### Build the open

The posting gate carries structured context (gate-protocol's Structured
context), built from the report json. Make one scratch directory
(`mktemp -d`) and write its path out literally from then on: each tool
call is a fresh shell. Write `<dir>/review-post.extras.json`:

```json
{"target": "!87", "reviewer": "<the reviewer the caller names>", "round": 2,
 "questions": [
   {"id": "outcome", "label": "Verdict on !87: <readiness clause>", "multi": false,
    "options": [{"value": "comment", "label": "comment (recommended)", "description": "<what picking it does for this review>"},
                {"value": "approve", "label": "approve", "description": "<what picking it does for this review>"}]},
   {"id": "next", "label": "Next", "multi": false,
    "options": [{"value": "proceed", "label": "proceed (recommended)"}, "iterate", "hold"]}
 ]}
```

| Field | Filled from |
|---|---|
| `target` | the MR/PR reference as its forge writes it: `!<iid>` or `#<number>` |
| `reviewer`, `round` | only when the caller supplies them; otherwise omit the key |
| `outcome` label | `Verdict on <target>: ` plus a clause composed from the json's `summary`, never either field verbatim: readiness `yes` reads "ready to merge"; `with-fixes` or `no` reads "not ready" or "ready once <the gist of the reasoning>" |
| `outcome` options | `comment` and `approve`, each described by what picking it does for this review. `request_changes` joins them only when this verb runs the gate itself and the forge CLI supports it (`gh` does, `glab` does not; verify, don't assume). The recommendation goes FIRST, its label ending ` (recommended)`: `approve` when readiness is `yes`, else `comment` |
| `next` | only when this verb runs the gate itself; a caller that owns the gates navigates on its own, so omit the question |

Build it, then fit it:

```bash
sh "${CLAUDE_SKILL_DIR}/scripts/review-source.sh" <report json> <dir>/review-post.extras.json > <dir>/review-post.source.json
sh "${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh" fit < <dir>/review-post.source.json > <dir>/review-post.open.json
```

`review-source.sh` turns every finding into a `findings-<n>` option (tier
order, four per question) whose label and description are the recipe
older board renderers parse, and gives each question its findings in
full as context. Exit 1 from either script names the field to fix: in the
extras, or in the report json where it drifted from the draft. The output
file IS the open: its `.context` and `.questions` go to the gate
verbatim, fitted to the shared budget. A report json from before version
2 carries no bodies, so fit opens it as prose on its own; that is
correct, not an error. Never hand-edit the open, and never shorten a body
to make it fit.

No report json at all (a terminal run with no report path) leaves nothing
to build from: the gate is the legacy set below.

### Hand back or run the gate

**A caller that owns the gates** (a board wrapper; it says so when it
delegates): open nothing. Hand back the severity line and the absolute
paths of `<dir>/review-post.open.json` (its source sits beside it as
`review-post.source.json`) and of the `gate-ctx.sh` that fitted it, then
wait for its `{findings, outcome}`.

**Otherwise** (a direct terminal run) this verb runs the gate:

- `rt runs field set gate post --stage <stage>`, where `<stage>` is
  `review` for an own run and `run.current_stage` when inherited.
- Run gate-protocol's Runs integration with kind `review-post`, the
  registry kind every review surface routes on (the run field and the
  decision record keep scope `post`), the open read from the file:

  ```bash
  rt gate ask --questions "$(jq -c .questions <dir>/review-post.open.json)" --kind review-post --context "$(jq -r .context <dir>/review-post.open.json)"
  ```

- In-pane form (gate-protocol's presentation: "form" branch): the form
  never shows the JSON. Run
  `sh "${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh" prose < <dir>/review-post.source.json`,
  show its `.context` in the pane before the first form call, and make
  each `findings-<n>` question's form text its label, a newline, then its
  prose `context`; options keep the gate's labels and descriptions. Ask
  in gate order, up to four questions per call, then submit exactly ONE
  `rt gate answer` carrying every question.
- No report json: the same bracket and `rt gate ask --kind review-post`,
  with `--context` the severity line verbatim and three questions:
  `tiers` (multi-select over the levels present, each pre-selected), then
  `outcome` and `next` exactly as in the extras above.
- `next`: **Proceed** executes posting; **Iterate here** takes their text
  as changes to the draft, re-presents it, and opens a NEW gate; **Hold**
  stops with nothing posted.

Execute posting per review-posting (below), handing it the decided
selection as `{findings: <ids>, disposition: <outcome>}`: `<ids>` is the
union of every `findings-<n>` answer (unwrap a `{value, note}` object to
its value), empty when the gate carried none, and `<outcome>` the answered
value, already in posting's vocabulary (`comment`, `approve`,
`request_changes`). A caller that hands a tier-shaped selection (an
unmigrated wrapper), or a `tiers` answer, passes to posting as legacy
`{levels: <tiers>, disposition: <outcome>}`, which posting accepts
unchanged; the record below then carries that same legacy selection.

Then, when an rt-runs run is active, record the decision at execution time,
after posting: `rt runs decision record --contract gate@1 --scope post
--selection '{"findings":["f1","f3"],"disposition":"comment"}'
--decided-by <decider>`, where `<decider>` names the surface that
actually answered -- `board`, `console`, `pane`, or `shepherd`: the
caller's named decider on intake, else the gate answer's `by`.

Post using the forge's thread mechanics: on GitHub use `gh pr review` / `gh
pr comment`; on GitLab follow the thread mechanics below.

Review verbs produce judgment and execute posting; they never decide what
posts.

Close, only when `## Run` started this run: `rt runs stage-done --stage
review`, `rt runs run-status --status done`, `unset RT_RUN_DB`. The final
message still ends with the target's link (the close HARD-GATE below).

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}

{{include:review-posting}}

Posting mechanics: a positioned inline comment is the `mr_comment_inline`
tool and a thread reply is `mr_reply_thread`; the daemon verifies
DiffNote placement and, on the silent general-note degrade, retries ONCE
with fresh diff_refs (deleting the stray notes; it cannot fix a position
GitLab rejects outright), so never hand-build a `glab api` position
payload.
