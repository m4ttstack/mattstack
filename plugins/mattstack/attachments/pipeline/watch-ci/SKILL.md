---
name: watch-ci
disable-model-invocation: true
description: "Use when the user wants CI watched or triaged outside a pipeline run -- 'watch CI', 'is the pipeline green', 'babysit this MR', or after a push when they want the red/green verdict and failures classified."
allowed-tools:
  - Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
  - Bash(${CLAUDE_SKILL_DIR}/scripts/ci-watch.sh:*)
  - Bash(${CLAUDE_SKILL_DIR}/scripts/ci-triage.sh:*)
  - Bash(${CLAUDE_SKILL_DIR}/scripts/ci-attendant.sh:*)
  - Bash(*/scripts/ci-forge.sh:*)
type: pipeline-step
slots:
  domain: { contract: watch-ci-domain@1, required: false }
  forge: { contract: ci-forge@1, required: false }
metadata:
  slots: "domain, forge"
  slot-domain: "optional watch-ci-domain@1 -- owns the domain's CI watching: which pipeline to watch, how to poll it, and how real failures are told apart from infrastructure noise"
  slot-forge: "optional ci-forge@1 -- speaks one forge's CI API: resolves pipelines for a ref, lists jobs across the whole pipeline tree, fetches traces, retries jobs"
---

# watch-ci

The standalone entry for CI watching: same watch-and-triage flow as the
pipeline's watch-ci stage, reached directly instead of through a unit of
work. There is no uow record; the target comes from the conversation and
the checkout, and the verdict goes to the user.

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

## 3. Resolve the slots

In a compiled skill (see the header comment), bindings are already resolved
-- do not run resolve-args.sh.

Run `"${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"`; nonzero exit: print
`errors` verbatim and stop. Both slots are optional -- an empty
resolution just means the generic path below.

## 4. Watch and triage

The first branch that matches:

**Domain bound:** read the SKILL.md at `resolved.domain.path` and follow
its watch-and-triage flow for the target MR and branch.

**Forge bound (domain unbound):** launch
`${CLAUDE_SKILL_DIR}/scripts/ci-watch.sh --forge <resolved.forge.path>/scripts/ci-forge.sh --ref <branch> --timeout 2700`
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

Finish by reporting the verdict: green, or red with a one-line triage
per blocking failure and what you did about it.
