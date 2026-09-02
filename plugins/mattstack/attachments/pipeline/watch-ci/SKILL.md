---
name: watch-ci
disable-model-invocation: true
description: "Use when the user wants CI watched or triaged outside a pipeline run -- 'watch CI', 'is the pipeline green', 'babysit this MR', or after a push when they want the red/green verdict and failures classified."
allowed-tools:
  - Bash(${CLAUDE_SKILL_DIR}/scripts/ci-watch.sh:*)
  - Bash(${CLAUDE_SKILL_DIR}/scripts/ci-triage.sh:*)
  - Bash(${CLAUDE_SKILL_DIR}/scripts/ci-attendant.sh:*)
  - Bash(*/scripts/ci-forge.sh:*)
type: pipeline-step
slots:
  domain: { contract: watch-ci-domain@1, required: false }
  forge: { contract: ci-forge@1, required: false }
---

# watch-ci

The standalone entry for CI watching: same watch-and-triage flow as the
pipeline's watch-ci stage, reached directly instead of through a unit of
work. The target comes from the conversation and the checkout, and the
verdict goes to the user.

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
shows `run.status` = `running` and `run.work_type` = `watch-ci` (read each with
`RT_RUN_DB` pointed at its `state.db`; never raw sqlite). Any found: gate
`clarify`, one sentence naming each candidate's `spawned_by`, `started_at`,
and `current_stage`, then the structured-question tool with one **Resume**
option per candidate (recommended for a run this session started earlier; a
run another live pane owns is not yours) / **Start fresh**; **Hold**.
Resume: `export RT_RUN_DB=<its state.db>`, then `rt runs stage-start --stage
watch-ci` (a new attempt, which re-records this session) and `rt runs field set
hold - --stage watch-ci`; re-enter with the snapshot's decisions and do not
re-ask a question it already answered.

Fresh. The flags for this verb, rendered by the compiler:

{{run-start.flags:watch-ci}}

```bash
PACK_DIRS="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd -P)"
rt runs run-start <the flags above> --pack-dirs "$PACK_DIRS" [--spawned-by "<surface>"]
export RT_RUN_DB=<runDb from the response>
rt runs stage-start --stage watch-ci
```

The response must parse as JSON with `ok: true` and a `runDb`; anything
else means this rt predates the run verbs: stop and tell the user to
update rt. Pass `--spawned-by` when a board or another surface launched
this pane.

Every gate in this verb then writes its `gate` field and its decision with
`--stage watch-ci`. The close, after the final gate's answer and only when
this section ran `run-start`: `rt runs stage-done --stage watch-ci`, `rt runs
run-status --status done` (or `abandoned` when the gate said so), then
`unset RT_RUN_DB`.

## 1. Establish the target

- **Branch**: the one the user named, else `git branch --show-current`.
- **MR**: the one the user named or linked, else look it up for the
  branch (`glab mr list --source-branch <branch>` or
  `gh pr list --head <branch>`). No MR is fine -- branch pipelines still
  watch; the lease step is skipped.

## 2. The attendant lease (when there is an MR)

Exactly one actor attends an MR's CI at a time: you, or the mr-board
auto-doctor. Both honor the same lease files
(`~/.mattstack/ci-attendants/`). Claim before doing anything else:

`"${CLAUDE_SKILL_DIR}/scripts/ci-attendant.sh" claim <mr-url> <iid> --branch <branch>`

- **Exit 0**: the MR is yours. Proceed.
- **Exit 3**: the auto-doctor is actively repairing this MR. STAND DOWN:
  report it and stop, or watch READ-ONLY. A repair action is any commit,
  push, or job retry; while the doctor holds the lease, every one of
  them belongs to the doctor.

While watching, refresh each poll round with
`ci-attendant.sh heartbeat <mr-url> <iid>`; release with
`ci-attendant.sh release <mr-url> <iid>` when done. A crashed session
needs no cleanup: staleness handles it.

## Where the scripts live

The engine's watcher, triage, and attendant scripts are vendored inside
this compiled skill's own directory, and the forge adapter beside them. In
the commands below, `<scripts>` is `${CLAUDE_SKILL_DIR}/scripts` and
`<forge>` is `${CLAUDE_SKILL_DIR}/parts/forge/scripts/ci-forge.sh`. Nothing
is derived from a plugin install; the paths are the ones written into this
text.

## Domain rules

{{slot:domain}}

## Forge

{{slot:forge}}

Both slots are optional; when neither is inlined above, follow the
generic path below.

## 3. Watch and triage

The first branch that matches:

**Domain rules above non-empty:** follow them for the watch-and-triage
flow for the target MR and branch.

**Forge rules above non-empty (domain rules above empty):** launch
`${CLAUDE_SKILL_DIR}/scripts/ci-watch.sh --forge ${CLAUDE_SKILL_DIR}/parts/forge/scripts/ci-forge.sh --ref <branch> --timeout 2700`
as a background task and react to its exit code: 0 = green, on to the
verdict below. 1 = read the triage report it printed; retry each
INFRA-verdict blocking failure once with the retry command the report
prints and relaunch the watcher; any REAL blocking failure is the `ci`
gate below. 2 = the pipeline outran the timeout: relaunch the watcher
once, then the `ci` gate. 4 = no pipeline ever appeared: verify the branch
was pushed, then the `ci` gate.

**Neither section above has content:** poll the forge CLI (`gh pr checks
<mr> --watch` or `glab ci status --live`) until the pipeline settles.
Green: done. Red: read the failing job log, classify REAL (the change
broke it) vs INFRA/flake (unrelated, retry once); any REAL failure is the
`ci` gate below.

## Verdict

Green: one sentence, the verdict. Then, only when `## Run` started this
run, `mr` is set, and the MR is a draft, gate `mark-ready`:

- `rt runs field set gate mark-ready --stage watch-ci`
- One sentence: CI is green for the MR's head.
- The form: **Mark ready now** (recommended) / **Keep it draft**;
  **Iterate here**; **Go back to `<stage>`** (one option per earlier stage
  row when `snapshot` shows any); **Hold**.
- `rt runs decision record --contract gate@1 --scope mark-ready --selection '{"ready":true|false,"next":"proceed|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}' --decided-by watch-ci`
- Yes: the forge-host rule (read `git remote get-url origin`; GitLab means
  `glab mr update <iid> --ready`, GitHub means `gh pr ready <number>`,
  anything else is a `clarify` gate).

Then the close below (own run only; on green with no `mark-ready` gate,
close right after the verdict). Any other outcome is gate `ci`:

- `rt runs field set gate ci:<stage>:<attempt> --stage <stage>`.
- One sentence: the verdict and the one-line triage per blocking failure.
- The form: **Fix and re-push** (recommended for a REAL failure in the
  change) / **Retry the job** / **Hand back** / **Abandon the run** (own
  run only); **Iterate here**; **Hold**.
- `rt runs decision record --contract gate@1 --scope ci:<stage>:<attempt> --selection '{"next":"fix|retry|handback|abandon|iterate|hold","note":"<their words or null>"}' --decided-by watch-ci`.

A watch-ci invoked from inside another verb (a ship or sync flow) inherits that
run, uses `run.current_stage` as its stage, fires no gate beyond `ci`,
writes no `stage-done` and no `run-status`, and hands control back with
the verdict.

Close, only when `## Run` started this run: after the green verdict (and
its mark-ready answer when that gate fired), or after the `ci` gate's Hand
back, `rt runs stage-done --stage watch-ci`, `rt runs run-status --status
done`, `unset RT_RUN_DB`; Abandon the run closes with `run-status --status
abandoned` instead.
Fix and re-push keeps the run `running` and re-enters section 3 after the
push (a new `stage-start --stage watch-ci`).

## Wrap-up form contract

{{include:wrap-up-form}}
