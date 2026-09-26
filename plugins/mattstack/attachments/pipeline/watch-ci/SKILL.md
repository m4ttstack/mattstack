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
the Stop hook covers its pane. Skip this section when the engine that
invoked you handed you a `runDb` and `run_snapshot` on it shows
`run.status` = `running`: you were invoked from inside that run, you
inherit it, `run.current_stage` is your stage, and you close nothing at
the end.

Otherwise, when a surface launched this pane (the `spawnedBy` case
below), start fresh: another pane's live run is not yours to resume.
Launched by hand, first the Resume offer: call `run_list` with `repo` =
the `--repo` value in the flags block below, and keep the runs whose
`status` is `running` and `work_type` is `watch-ci`; never read the run
dbs by hand. Any found: gate
`clarify`, one sentence naming each candidate's `spawned_by`, `started_at`,
and `current_stage`, then the structured-question tool with one **Resume**
option per candidate (recommended for a run this session started earlier; a
run another live pane owns is not yours) / **Start fresh**; **Hold**.
Resume: use
`runDb` = `<absolute home>/.mattstack/runs/<repo>/<its id>/state.db` (the
candidate row's `id`; the run tools refuse `~` and relative paths). If a
run tool refuses it with an error naming a different runs root, use that
root instead. Then `run_stage` with `action: "start"`,
`stage: "watch-ci"` (a new attempt, which re-records this session) and `run_field_set` with
`key: "hold"`, `value: "-"`, `stage: "watch-ci"`; re-enter with
`run_snapshot`'s decisions and do not re-ask a question it already
answered.

Fresh. The flags for this verb, rendered by the compiler:

{{run-start.flags:watch-ci}}

Start the run with the `run_start` tool: `flags` is the `watch-ci` flag
string from the block above, verbatim (the value, never its key);
`skillDir` is this skill's own directory, `${CLAUDE_SKILL_DIR}`, as an
absolute path; add `spawnedBy` when a board or another surface launched
this pane. The result must carry `ok: true` and a `runDb`. A tool error:
stop and report its message. No `run_start` tool available at all: this
rt is too old; stop and tell the user to update rt. Keep `runDb` and
pass it to every `run_*` call in this verb; nothing is exported. Then `run_stage` with `action: "start"`,
`stage: "watch-ci"`.

Every gate in this verb then writes its `gate` field and its decision with
`stage: "watch-ci"`. The close, after the final gate's answer and only
when this section ran `run_start`: `run_stage` with `action: "done"`,
`stage: "watch-ci"`, then `run_status` with `status: "done"` (or
`"abandoned"` when the gate said so).

{{include:run-identity}}

## 1. Establish the target

- **Branch**: the one the user named, else `git branch --show-current`.
- **MR**: the one the user named or linked, else look it up for the
  branch by the forge-host rule (`git remote get-url origin`): on GitLab
  the `mr_for_branch` tool (`repoName` = this worktree's absolute path,
  `branches: ["<branch>"]`), on GitHub `gh pr list --head <branch>`. No
  MR: the lease step is skipped. The branch pipeline still watches on
  the forge-bound path (`ci-watch.sh --ref`); on the generic path there
  is nothing to watch, which section 3 sends to the `ci` gate.

When the run is yours, record the target per Run identity above:
`branch`, and `mr` when one exists.

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
the commands below, `<scripts>` is `${CLAUDE_SKILL_DIR}/scripts/` and
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

**Neither section above has content:** every GitLab MR tool call in this
verb targets the MR with `repoName` = this worktree's absolute path and
`iid` = the MR's iid. On GitLab poll the `mr_pipeline` tool (`repoName`,
`iid`; live by default) until the pipeline settles, then `mr_job_trace`
(`repoName`, `iid`, `jobId`) for each failed job; on GitHub
`gh pr checks <mr> --watch`. Between `mr_pipeline` calls wait about 60
seconds by running `sleep 60` as a background Bash task (never a
foreground sleep) and poll again when it finishes; refresh the attendant
lease heartbeat each round, and if the pipeline has not settled after 45
minutes, treat it as a timeout and go to the `ci` gate.
No MR or PR (either forge): do not poll; go straight
to the `ci` gate with the reason "no MR to watch; ship first".
Green: done. Red: read the failing job log, classify REAL (the change
broke it) vs INFRA/flake (unrelated, retry once: on GitLab the `mr_retry`
tool with `repoName`, `iid`, and the failed job's id as `jobId`); any
REAL failure is the `ci` gate below.

## Verdict

Green: one sentence, the verdict. Then, only when `## Run` started this
run, `mr` is set, and the MR is a draft, gate `mark-ready`:

- `run_field_set` with `key: "gate"`, `value: "mark-ready"`, `stage: "watch-ci"`
- One sentence: CI is green for the MR's head.
- Run gate-protocol's Runs integration with kind `mark-ready` and these
  questions, each its own question (never fold one list into another --
  a question over 4 options sends the whole gate to the wait queue):
  - `ready`: **Mark ready now** (recommended) / **Keep it draft**
  - `next`: **Proceed** (recommended) / **Iterate here** / **Go back** /
    **Hold**
  - `to`, only when **Go back** is answered and `run_snapshot` shows
    more than one earlier stage row: one option per earlier stage, split
    `to-1`, `to-2`, ... over 4; with exactly one candidate stage label
    it **Go back to `<stage>`** in `next` and skip this question
- `run_decision` with `contract: "gate@1"`, `scope: "mark-ready"`, `selection: {"ready":true|false,"next":"proceed|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}`, `decidedBy: <the answer's by>`
- Yes: the forge-host rule (read `git remote get-url origin`; GitLab means
  the `mr_ready` tool with `repoName` and `iid`; GitHub means
  `gh pr ready <number>`, anything else
  is a `clarify` gate).

Then the close below (own run only; on green with no `mark-ready` gate,
close right after the verdict). Any other outcome is gate `ci`:

- `run_field_set` with `key: "gate"`, `value: "ci:<stage>:<attempt>"`, `stage: "<stage>"`.
- One sentence: the verdict and the one-line triage per blocking failure.
- Run gate-protocol's Runs integration with kind `ci:<stage>:<attempt>` and
  these questions, each its own question (never fold one list into
  another -- a question over 4 options sends the whole gate to the wait
  queue):
  - `action`: **Fix and re-push** (recommended for a REAL failure in the
    change) / **Retry the job** / **Hand back** / **Abandon the run**
    (own run only)
  - `next`: **Proceed** (recommended) / **Iterate here** / **Hold**
- `run_decision` with `contract: "gate@1"`, `scope: "ci:<stage>:<attempt>"`, `selection: {"next":"fix|retry|handback|abandon|iterate|hold","note":"<their words or null>"}`, `decidedBy: <the answer's by>`.

A watch-ci invoked from inside another verb (a ship or sync flow) inherits that
run and its `runDb`, uses `run.current_stage` as its stage, fires no gate
beyond `ci`, calls no `run_stage` done and no `run_status`, and hands
control back with the verdict.

Close, only when `## Run` started this run: after the green verdict (and
its mark-ready answer when that gate fired), or after the `ci` gate's Hand
back, `run_stage` with `action: "done"`, `stage: "watch-ci"`, then
`run_status` with `status: "done"`; Abandon the run closes with
`status: "abandoned"` instead.
Fix and re-push keeps the run `running`: push with the `git_push` tool
(`tree` = the worktree root, the absolute path
`git rev-parse --show-toplevel` prints). An error starting
`tree must be the absolute path of the root` fires for a subdirectory as
well as for a repo not registered with rt: retry once with that root, and
only when the root is refused too, push on Bash instead with plain
`git push`. <!-- mcp-lint: allow -->
Then re-enter section 3 (a new `run_stage` start for `watch-ci`). Retry
the job, forge bound: the report's retry command, then relaunch the
watcher. Retry the job, neither bound: on GitLab the `mr_retry` tool with
`repoName`, `iid`, and the failed job's id as `jobId`; on GitHub
`gh run rerun <run-id> --failed`, the run id taken from the failed
check's link in `gh pr checks <mr>`. A job retry is not a new stage
attempt: no `run_stage` start; re-enter section 3.

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
