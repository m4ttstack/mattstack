---
name: ship
disable-model-invocation: true
description: "Use when work on the current branch should leave the machine as an MR or PR -- 'ship this', 'ship it', 'push and open an MR', 'create the PR' -- outside a pipeline run."
type: pipeline-step
slots:
  domain: { contract: ship-domain@1, required: false }
---

# ship

The standalone entry for shipping the current branch. Same flow as the
pipeline's ship stage, reached directly: target from the checkout.

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
shows `run.status` = `running` and `run.work_type` = `ship` (read each with
`RT_RUN_DB` pointed at its `state.db`; never raw sqlite). Any found: gate
`clarify`, one sentence naming each candidate's `spawned_by`, `started_at`,
and `current_stage`, then the structured-question tool with one **Resume**
option per candidate (recommended for a run this session started earlier; a
run another live pane owns is not yours) / **Start fresh**; **Hold**.
Resume: `export RT_RUN_DB=<its state.db>`, then `rt runs stage-start --stage
ship` (a new attempt, which re-records this session) and `rt runs field set
hold - --stage ship`; re-enter with the snapshot's decisions and do not
re-ask a question it already answered. Each tool call is a fresh shell:
prefix every `rt runs` command with `RT_RUN_DB=<its state.db>`.

Fresh. The flags for this verb, rendered by the compiler:

{{run-start.flags:ship}}

```bash
PACK_DIRS="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd -P)"
rt runs run-start <the flags above> --pack-dirs "$PACK_DIRS" [--spawned-by "<surface>"]
export RT_RUN_DB=<runDb from the response>   # each tool call is a fresh shell: prefix every rt runs command with RT_RUN_DB=<runDb>
rt runs stage-start --stage ship
```

The response must parse as JSON with `ok: true` and a `runDb`; anything
else means this rt predates the run verbs: stop and tell the user to
update rt. Pass `--spawned-by` when a board or another surface launched
this pane.

Every gate in this verb then writes its `gate` field and its decision with
`--stage ship`. The close, after the final gate's answer and only when
this section ran `run-start`: `rt runs stage-done --stage ship`, `rt runs
run-status --status done` (or `abandoned` when the gate said so), then
`unset RT_RUN_DB`.

## 1. Establish the target, then the ship gate

Current branch (`git branch --show-current`); refuse the default branch.
Then gate `ship`, before anything is pushed:

- `rt runs field set gate ship --stage ship`.
- One sentence: the branch, the commits about to go (`git log --oneline
  @{upstream}.. 2>/dev/null || git log --oneline -5`), and whether the
  tree is dirty (`git status --porcelain`).
- The form: on a dirty tree, **Commit the changes** / **Stash them** /
  **Abort**; **Push and open as draft** (recommended) / **Push and open
  ready**; every question the domain rules below declare for this gate;
  **Iterate here**; **Hold**.
- `rt runs decision record --contract gate@1 --scope ship --selection '{"dirty":"commit|stash|abort|null","open_as":"draft|ready","domain":{<answers>}}' --decided-by ship`.
- Abort or Hold: nothing is pushed. Abort, when `## Run` started this run:
  `rt runs stage-done --stage ship`, `rt runs run-status --status
  abandoned`, `unset RT_RUN_DB`.

## Domain rules

{{slot:domain}}

When nothing is inlined above, follow the generic path below.

## 2. Ship

**Domain rules above:** follow them for the shipping flow.

**Generic path:** the forge CLI is read from the origin remote (`git
remote get-url origin`): a GitLab host means `glab`, a GitHub host means
`gh`, anything else is a `clarify` gate. Push with `git push -u origin
<branch>`, then create the MR/PR against the repo's default branch (`glab
mr create --fill --draft` or `gh pr create --fill --draft`; drop the draft
flag when the gate said ready), title from the branch's commits. Print the
URL.

## 3. Mark ready (standalone path)

When the domain flow above ran CI to green (its inherited watch-ci hands
back with the verdict; it fires no gate beyond `ci`), and the MR is a
draft: gate `mark-ready`.

- `rt runs field set gate mark-ready --stage ship`.
- One sentence: CI is green; evidence is attached (or is not).
- The form: **Mark ready now** (recommended when `ci` is green and evidence
  is set) / **Keep it draft**; **Iterate here**; **Go back to `<stage>`**
  (one option per earlier stage row when `snapshot` shows any); **Hold**.
- `rt runs decision record --contract gate@1 --scope mark-ready --selection '{"ready":true|false,"next":"proceed|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}' --decided-by ship`.
- Go back (inherited run only): hand control back to the caller with one
  sentence naming the answer.
- Yes: `glab mr update <iid> --ready` or `gh pr ready <number>` per the
  forge-host rule above.

Close, only when `## Run` started this run: after the mark-ready answer is
acted on (or the gate said keep it draft), or on the generic path after the
URL is printed, `rt runs stage-done --stage ship`, `rt runs run-status
--status done`, `unset RT_RUN_DB`. Abort at the ship gate closes with
`run-status --status abandoned` instead (section 1).

## Wrap-up form contract

{{include:wrap-up-form}}
