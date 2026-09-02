---
name: stage-watch-ci
description: "Pipeline stage: watch the pipeline the ship stage triggered and triage a red result. Reached only through a resolved pipeline; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
slots:
  domain: { contract: watch-ci-domain@1, required: false }
  forge: { contract: ci-forge@1, required: false }
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/ci-watch.sh:*), Bash(${CLAUDE_SKILL_DIR}/scripts/ci-triage.sh:*), Bash(${CLAUDE_SKILL_DIR}/scripts/ci-attendant.sh:*), Bash(*/scripts/ci-forge.sh:*)
metadata:
  stage: "watch-ci"
  stage-consumes: "mr branch"
  stage-produces: "ci"
---

# stage: watch-ci

{{stage.fields}}

## Run state

Contracts v2 and v3 (authoritative text: the parameterized-skills skill's convention reference).

- First action: `rt runs stage-start --stage watch-ci`
- Read consumed fields with `rt runs field get <key>` before
  deriving or asking for them.
- Write each declared produce the moment it exists:
  `rt runs field set <key> <value> --stage watch-ci`
- Last action on success: `rt runs stage-done --stage watch-ci`;
  on failure: `rt runs stage-fail --stage watch-ci --reason
  "<what actually failed>" --detail-path <path to the triage report>`
  before you report it.

## Where the scripts live

The engine's watcher, triage, and attendant scripts are vendored inside
this compiled skill's own directory, and the forge adapter beside them. In
the commands below, `<scripts>` is `{{stage.dir}}/scripts/` and `<forge>` is
`{{stage.dir}}/parts/forge/scripts/ci-forge.sh`. Nothing is derived from a
plugin install; the paths are the ones written into this text.

## Domain rules

{{slot:domain}}

When nothing is inlined above, follow the generic path below.

## Forge

{{slot:forge}}

## The attendant lease (before any watching, when `mr` is set)

Exactly one actor attends an MR's CI at a time: this stage, or the
mr-board auto-doctor. Both honor the same lease files
(`~/.mattstack/ci-attendants/`), and the doctor's dispatcher skips MRs
you hold. Claim before doing anything else:

`"${CLAUDE_SKILL_DIR}/scripts/ci-attendant.sh" claim <mr-url> <iid> --branch <branch>`

- **Exit 0**: the MR is yours. Proceed.
- **Exit 3**: the auto-doctor is actively repairing this MR. STAND DOWN:
  report it and stop, or watch READ-ONLY. A repair action is any commit,
  push, or job retry; while the doctor holds the lease, every one of
  them belongs to the doctor.

While watching, refresh each poll round with
`ci-attendant.sh heartbeat <mr-url> <iid>`; a lease without heartbeats
goes stale in 10 minutes and the doctor may take over. When the stage
finishes (verdict written, or you stop), release with
`ci-attendant.sh release <mr-url> <iid>`. A crashed session needs no
cleanup: staleness handles it.

| Thought | Reality |
|---------|---------|
| "The doctor's on it, but I can fix it faster" | Two actors pushing to one branch race each other's work. Stand down or watch read-only. |
| "I'll just retry the flaky job while the doctor works" | A retry IS a repair action. The lease holder does it, not you. |
| "No time for the lease, the pipeline just went red" | The claim is one command and beats un-racing two half-pushed fixes. |

## Watch and triage

Then the first branch that matches:

**Domain rules inlined above:** follow that flow for `mr` and `branch`.
Its red verdict lands at the `ci` gate below and its green at
`mark-ready`.

**Forge bound (no domain rules above):** launch
`${CLAUDE_SKILL_DIR}/scripts/ci-watch.sh --forge {{stage.dir}}/parts/forge/scripts/ci-forge.sh --ref <branch> --timeout 2700`
as a background task and react to its exit code: 0 = green, on to the
mark-ready gate below. 1 = read the triage report it printed; retry each
INFRA-verdict blocking failure once with the retry command the report
prints and relaunch the watcher; any REAL blocking failure is the `ci`
gate below. 2 = the pipeline outran the timeout: relaunch the watcher
once, then the `ci` gate. 4 = no pipeline ever appeared: verify the branch
was pushed, then the `ci` gate.

**Neither bound:** poll the forge CLI (`gh pr checks <mr> --watch` or
`glab ci status --live`) until the pipeline settles. Green: the
mark-ready gate below. Red: read the failing job log, classify REAL (the
change broke it) vs INFRA/flake (unrelated, retry once); any REAL failure
is the `ci` gate below.

## Gate `ci` (red, timeout, or no pipeline)

- `rt runs field set gate ci:watch-ci:<attempt> --stage watch-ci`
- One sentence: the verdict and the one-line triage per blocking failure.
- The form: **Fix and re-push** (recommended for a REAL failure in your
  change) / **Retry the job** (for a flake the report did not already
  retry) / **Hand back** (leave it red for the human) / **Abandon the
  run**; **Iterate here**; **Go back to `<stage>`**; **Hold**.
- `rt runs decision record --contract gate@1 --scope ci:watch-ci:<attempt> --selection '{"next":"fix|retry|handback|abandon|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}' --decided-by stage-watch-ci`
- Fix: write no `ci`; hand control back to the orchestrator with one
  sentence naming the answer, and it redirects to `implement` with the
  triage as the reason (the work engine's `## Redirect`; the gate answer
  is what names the stage). Retry: the report's retry command, relaunch
  the watcher. Hand back: write `ci` as `red: <triage>` and `stage-done`.
  Abandon: `rt runs run-status --status abandoned`, `unset RT_RUN_DB`.

## Gate `mark-ready` (green, `mr` set, MR still a draft)

- `rt runs field set gate mark-ready --stage watch-ci`
- One sentence: CI is green for the MR's head; `evidence` is set (or is
  `-`).
- The form: **Mark ready now** (recommended when `evidence` is set and not
  `-`) / **Keep it draft**; **Iterate here**; **Go back to `<stage>`** (one
  option per earlier stage row); **Hold**.
- `rt runs decision record --contract gate@1 --scope mark-ready --selection '{"ready":true|false,"next":"proceed|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}' --decided-by stage-watch-ci`
- Go back: hand control back to the orchestrator with one sentence naming
  the answer; it runs `## Redirect`.
- Yes: the forge-host rule (read `git remote get-url origin`; GitLab means
  `glab mr update <iid> --ready`, GitHub means `gh pr ready <number>`,
  anything else is a `clarify` gate).

Finish by writing `ci` (`green`, or `red: <one-line triage>` when the
human handed it back). The exit-2 and exit-4 paths write no `ci` until
the gate's answer produces a verdict: the stage is not done until one
exists.

## Wrap-up form contract

{{include:wrap-up-form}}
