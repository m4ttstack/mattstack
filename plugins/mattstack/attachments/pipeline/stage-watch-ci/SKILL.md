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

Contract v2 (authoritative text: `references/convention.md` in the
parameterized-skills skill).

- First action: `"$RT_PIPELINE_STATE" stage-start --stage watch-ci`
- Read consumed fields with `"$RT_PIPELINE_STATE" field get <key>` before
  deriving or asking for them.
- Write each declared produce the moment it exists:
  `"$RT_PIPELINE_STATE" field set <key> <value> --stage watch-ci`
- Last action on success: `"$RT_PIPELINE_STATE" stage-done --stage watch-ci`;
  on failure: `"$RT_PIPELINE_STATE" stage-fail --stage watch-ci --reason
  "<what actually failed>" --detail-path <path to the triage report>`
  before you report it.

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

**Forge bound (no domain rules above):** launch
`${CLAUDE_SKILL_DIR}/scripts/ci-watch.sh --forge {{stage.dir}}/parts/forge/scripts/ci-forge.sh --ref <branch> --timeout 2700`
as a background task and react to its exit code: 0 = green. 1 = read the
triage report it printed; retry each INFRA-verdict blocking failure once
with the retry command the report prints and relaunch the watcher; stop
for the user on any REAL blocking failure. 2 = the pipeline outran the
timeout: relaunch the watcher once, then report the timeout and stop.
4 = no pipeline ever appeared: verify the branch was pushed, then stop
for the user.

**Neither bound:** poll the forge CLI (`gh pr checks <mr> --watch` or
`glab ci status --live`) until the pipeline settles. Green: done. Red:
read the failing job log, classify REAL (the change broke it) vs
INFRA/flake (unrelated, retry once), report the classification, and stop
for the user on any REAL failure.

Finish by writing `ci` (`green`, or `red: <one-line triage>`). (The
exit-2 and exit-4 stops write no `ci`: the stage is not done until a
verdict exists.)
