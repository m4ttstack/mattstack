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
the Stop hook covers its pane. Skip this section when a caller handed you
a `runDb` (a pipeline invoking this verb carries it in context) and
`run_snapshot` with that `runDb` shows `run.status` = `running`: you were
invoked from inside that run, you inherit it, `run.current_stage` is your
stage, you pass that handed `runDb` on every `run_*` call, and you close
nothing at the end.

Otherwise, when a surface launched this pane (the `spawnedBy` case
below), start fresh: another pane's live run is not yours to resume.
Launched by hand, first the Resume offer: call `run_list` with `repo`
(the `--repo` value in the flags block below) and keep the runs
whose `status` is `running` and `work_type` is `review`; never read the
run dbs by hand. Any found: gate
`clarify`, one sentence naming each candidate's `spawned_by`, `started_at`,
and `current_stage`, then the structured-question tool with one **Resume**
option per candidate (recommended for a run this session started earlier; a
run another live pane owns is not yours) / **Start fresh**; **Hold**.
Resume: your `runDb` is `<home>/.mattstack/runs/<repo>/<its id>/state.db`
(the candidate row's `id`, the home directory written out, never `~`),
then `run_stage` with `action: "start"`, `stage: "review"` (a new
attempt, which re-records this session) and `run_field_set` with `key:
"hold"`, `value: "-"`, `stage: "review"`; re-enter with `run_snapshot`'s
decisions and do not re-ask a question it already answered. Keep `runDb`
and pass it on every `run_*` call.

Fresh. Start the run with the `run_start` tool: `flags` is this verb's
value in the block below, verbatim; `skillDir` is this skill's own
directory; add `spawnedBy` when a board or another surface launched this
pane.

{{run-start.flags:review}}

The result must carry `ok: true` and a `runDb`. Anything else means this
rt predates the run tools: stop and tell the user to update rt. Keep
`runDb` and pass it to every `run_*` call below; nothing is exported.
Then `run_stage` with `action: "start"`, `stage: "review"`.

Every gate in this verb then writes its `gate` field with `stage:
"review"`, and its decision. The close, after the final gate's answer and
only when this section called `run_start`: `run_stage` with `action:
"done"`, `stage: "review"`, then `run_status` with `status: "done"` (or
`abandoned` when the gate said so).

{{include:run-identity}}

## 1. Resolve the target

From the conversation: an MR/PR URL, a bare !iid or #number, a ticket id,
or a branch name. Resolve to one MR/PR: on GitLab with the `mr_view` tool
and `maxAgeMs: 5000`, so the read is live (`mrUrl` when you were given a
URL, else `repoName` = the checkout path plus `iid`; a branch name
resolves first with `mr_for_branch`, `repoName` = the checkout path and
`branches: [<branch>]`, then `mr_view` on the iid it returns; a ticket id
with no URL, iid or branch is gate `clarify`), on GitHub with `gh pr view
<ref>`. An `mr_view` not found, or a null `mr_for_branch` entry for the
branch, means rt's open-MR cache does not hold it
(outside its author or time window): say so, then Hold as below with that
message as the reason (`decidedBy: "pane"`), never a fallback to the
forge CLI. Ambiguity is gate `clarify`:
one sentence naming the candidates, then run gate-protocol's Runs
integration with kind `clarify` and these questions: `target`, one
option per candidate, and `next`: **Proceed** (recommended) / **Hold**
(`run_field_set` with `key: "gate"`, `value: "clarify"`, `stage:
<stage>` before, where `<stage>` is `review` for an own run and
`run.current_stage` when inherited, and `run_decision` with `contract:
"gate@1"`, `scope: "clarify"`, `selection: {"target": "<picked>"}`,
`decidedBy: <the answer's by>` after).
Hold: record `hold:<stage>:<attempt>` (`run_decision` with `contract:
"gate@1"`, `scope: "hold:<stage>:<attempt>"`, `selection: {"reason":
"<their words>"}`, `decidedBy: <the answer's by>`), `run_field_set` with
`key: "hold"`, `value: "<their words>"`, `stage: <stage>`, end the turn.
Never a guess.

When the run is yours, record the resolved target per Run identity above:
`mr` (the MR/PR URL), `branch` (its source branch), `ticket` (the id the
MR itself names in branch, title, or description, when one exists).

## 2. Review

Fetch the diff. On GitHub, `gh pr diff`. On GitLab, git reads in Bash,
fetching the MR ref so any MR works, as two separate commands:
`git fetch origin <targetBranch>
+refs/merge-requests/<iid>/head:refs/remotes/origin/mr-<iid>`, then
`git diff origin/<targetBranch>...origin/mr-<iid>`, with `targetBranch`
from step 1's live `mr_view`.
Then follow the review flow
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
| `outcome` options | `comment` and `approve`, each described by what picking it does for this review. `request_changes` joins them only when this verb runs the gate itself and the target is on GitHub (`gh pr review --request-changes`); rt's GitLab MR tools have no Request changes. The recommendation goes FIRST, its label ending ` (recommended)`: `approve` when readiness is `yes`, else `comment` |
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
verbatim, fitted to the shared budget. `"fits": false` means even the
prose is over the shared budget; the direct path still opens the file
verbatim and the daemon drops contexts loudly, while a caller that owns
the gates gets no daemon to do that for it, so drop whole question
contexts largest first itself and say so in the hand-back. A report json
from before version 2 carries no bodies, so fit opens it as prose on its
own; that is correct, not an error. Never hand-edit the open, and never
shorten a body to make it fit.

No report json at all (a terminal run with no report path) leaves nothing
to build from: the gate is the legacy set below.

### Hand back or run the gate

**A caller that owns the gates** (a board wrapper; it says so when it
delegates): open nothing. Hand back the severity line and the absolute
paths of `<dir>/review-post.open.json` (its source sits beside it as
`review-post.source.json`) and of the `gate-ctx.sh` that fitted it, then
wait for its `{findings, outcome}`.

**Otherwise** (a direct terminal run) this verb runs the gate:

- `run_field_set` with `key: "gate"`, `value: "post"`, `stage: <stage>`,
  where `<stage>` is `review` for an own run and `run.current_stage` when
  inherited.
- Run gate-protocol's Runs integration with kind `review-post`, the
  registry kind every review surface routes on (the run field and the
  decision record keep scope `post`), the open read from the file: read
  `<dir>/review-post.open.json` with the Read tool; call `gate_ask` with
  its `questions` array, `kind: "review-post"` and its `context`; act on
  the returned presentation as gate-protocol says.
- In-pane form (gate-protocol's presentation: "form" branch): the form
  never shows the JSON. Run
  `sh "${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh" prose < <dir>/review-post.source.json`,
  show its `.context` in the pane before the first form call, and make
  each `findings-<n>` question's form text its label, a newline, then its
  prose `context`; options keep the gate's labels and descriptions. Ask
  in gate order, up to four questions per call, then submit exactly ONE
  `gate_answer` carrying every question.
- No report json: the same bracket and `gate_ask` with `kind:
  "review-post"`, `context` the severity line verbatim and three questions:
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

Then, when a run is active, record the decision at execution time,
after posting: `run_decision` with `contract: "gate@1"`, `scope: "post"`,
`selection: {"findings": ["f1", "f3"], "disposition": "comment"}`,
`decidedBy: <decider>`, where `<decider>` names the surface that
actually answered -- `board`, `console`, `pane`, or `shepherd`: the
caller's named decider on intake, else the gate answer's `by`.

Post using the forge's thread mechanics: on GitHub use `gh pr review` / `gh
pr comment`; on GitLab follow the thread mechanics below.

Review verbs produce judgment and execute posting; they never decide what
posts.

Close, only when `## Run` started this run: `run_stage` with `action:
"done"`, `stage: "review"`, then `run_status` with `status: "done"`. The final
message still ends with the target's link (the close HARD-GATE below).

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}

{{include:writing-style-lookup}}

{{include:review-posting}}

Posting mechanics on GitLab: a positioned inline comment is the
`mr_comment_inline` tool, a thread reply is `mr_reply_thread`, the summary
is ONE `mr_comment`, and the Approve disposition is `mr_approve` once the
findings have posted. The summary posts resolvable (the default) when its
issue list carries a selected finding with no `file` anchor, and with
`resolvable: false` when it carries none. The daemon verifies DiffNote
placement and, on the silent general-note degrade, retries ONCE with fresh
diff_refs (deleting the stray notes; it cannot fix a position GitLab
rejects outright), so never hand-build a position payload.
`mr_comment` returns `mrUrl`, the link the close needs.
