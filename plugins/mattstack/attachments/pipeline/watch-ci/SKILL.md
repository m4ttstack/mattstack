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

Green: one sentence, the verdict, then stop. Any other outcome is gate
`ci`:

- When `RT_RUN_DB` is set: `rt runs field set gate ci:<run.current_stage>:<attempt> --stage <run.current_stage>`.
- One sentence: the verdict and the one-line triage per blocking failure.
- The form: **Fix and re-push** (recommended for a REAL failure in the
  change) / **Retry the job** / **Hand back**; **Iterate here**; **Hold**.
- When `RT_RUN_DB` is set: `rt runs decision record --contract gate@1 --scope ci:<stage>:<attempt> --selection '{"next":"fix|retry|handback|iterate|hold","note":"<their words or null>"}' --decided-by watch-ci`.

A watch-ci invoked from inside another verb (a ship flow) inherits that
run, uses `run.current_stage` as its stage, fires no gate beyond `ci`,
writes no `stage-done` and no `run-status`, and hands control back with
the verdict.

## Wrap-up form contract

{{include:wrap-up-form}}
