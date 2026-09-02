# Pipeline Gates, Plan 2: Gate Sites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every human decision point in the mattstack engines becomes a `gate@1` site: a `gate` field write, a form, a decision record, and an action on the answer; the pipeline can be redirected and held from any gate; no engine ends a turn in prose.

**Architecture:** Plan 1 shipped the wrap-up include, the Stop hook, and stage contract v3. This plan edits one engine per task, inlining `{{include:wrap-up}}` once per engine and rewriting each prose ask into the contract's recipe. The work engine gains the close gate, the failure gate, and the Redirect and Hold sections. The pipeline's mark-ready action moves to stage-watch-ci on green under the forge-host rule. Standalone verbs get their gates as form-only sites here; plan 3 gives them runs.

**Tech Stack:** Markdown engines with `{{placeholder}}` markers; `rt skills compile` and `check`; `tests/certify.sh`; fresh subagents for the RED and GREEN runs.

**Spec:** `docs/superpowers/specs/2026-09-01-pipeline-gates-design.md`, sections 1, 3, 4, 7, 9. Executors read the spec's section before each task. Plan 1 (`2026-09-01-pipeline-gates-foundation.md`) must be complete and merged first; every task below assumes `attachments/wrap-up/SKILL.md` exists and `attachments/parameterized-skills/references/convention.md` carries "Stage contract v3: gates".

## Global Constraints

- Every skill directory touched passes `sh tests/certify.sh <dir>` and the tree passes `sh tests/repo-purity.sh`. No `Matt`, no `/Users/matt`, no domain terms, no em or en dashes.
- `{{include:wrap-up}}` goes alone on its own line, exactly once per engine, in a `## Wrap-up form contract` section placed just before the engine's `## Red flags` section (or at the end of the body when the engine has none). Include targets (`review-posting`, `review-core-body*`, `review-dispatch-body*`, `execution-strategy`, `model-tiering`, `cswap-accounts`, `gitlab-mr-threads`) may NOT carry it: they contain no placeholder by rule.
- Every gate site is the recipe from contract v3, in this order: `rt runs field set gate <scope> --stage <stage>`; one sentence of context; the structured-question tool; stop; `rt runs decision record --contract gate@1 --scope <scope> --selection '<JSON>' --decided-by <engine>`; act. Repeatable scopes carry `:<stage>:<attempt>`. Outside a run the two `rt runs` lines are skipped (the engine text says "when `RT_RUN_DB` is set").
- Every gate form lists its own options, then **Iterate here** and **Hold**; stage gates add **Go back to `<stage>`** for each earlier stage row in `snapshot`.
- Follow superpowers:writing-skills: RED before the text, GREEN after, rows harvested from RED. Follow the clean-code comment rule in every script or example.
- Work in `.worktrees/pipeline-gates`; commit and push after every task.

## Gate test protocol (used by every task's RED and GREEN steps)

RED: dispatch one fresh general-purpose subagent whose system context is the engine's CURRENT body (everything after the frontmatter, placeholders left as they are) under the heading `Your standing instruction:`, and whose user message is the task's scenario. Record the reply verbatim in `docs/superpowers/plans/red-gates-<engine>.md` under `## RED`. Expected: a prose or list ending at the gate site (the failure). Every sentence that justifies prose is a rationalization row candidate.

GREEN: the same dispatch with the engine's NEW body (with the wrap-up include's body pasted in place of `{{include:wrap-up}}`, since the subagent cannot compile). Expected: the reply ends in an `AskUserQuestion` call whose options match the task's gate, preceded by at most one sentence. Record under `## GREEN`. If it still ends in prose, add its justification as a row in the engine's rationalization table and rerun; do not proceed until it complies.

The evidence files are committed with the task; they must not contain the word `Matt`.

---

### Task 1: work engine: close gate, failure gate, Redirect, Hold

**Files:**
- Modify: `attachments/pipeline/work/SKILL.md` (section 4 step 3 tail, the "A stage failure" paragraph, `## Close`, `## Red flags`; new `## Redirect`, `## Hold`, `## Wrap-up form contract`)
- Create: `docs/superpowers/plans/red-gates-work.md`

**Interfaces:**
- Consumes: contract v3 in `convention.md`; the include `wrap-up`.
- Produces: scopes `close`, `<stage>-failed:<attempt>`, `redirect:<from>:<attempt>`, `hold:<stage>:<attempt>`; the rule "the run stays `running` until the close gate is answered" that the Stop hook relies on.

- [ ] **Step 1: RED**

Scenario: `The pipeline's last stage just wrote ci=green. The MR is https://example.invalid/mr/42, still a draft. Nothing else is pending. Write your final message to the user now, exactly as you would send it.` Expected failure: a summary ("Pipeline complete, MR is green") with no form.

- [ ] **Step 2: Replace the failure paragraph**

Replace in section `## 4. Walk the stages`:

```markdown
A stage failure stops the pipeline. Report which stage and that a resume
continues from it. The run itself stays `running`; only the Close
statuses end it.
```

with:

```markdown
A stage failure is a gate, not a report. Gate `<stage>-failed:<attempt>`
(the attempt from the failed stage row in `snapshot`):

- `rt runs field set gate <stage>-failed:<attempt> --stage <stage>`
- One sentence: the stage, the reason `stage-fail` recorded, and the
  detail path if there is one.
- The form: **Retry the stage** (recommended when the reason names
  something you can fix) / **Go back to `<stage>`** (one option per earlier
  stage row) / **Iterate here** (their text is what to change first) /
  **Hold** / **Abandon the run**.
- `rt runs decision record --contract gate@1 --scope <stage>-failed:<attempt> --selection '{"next":"retry|redirect|iterate|hold|abandon","to":"<stage or null>","note":"<their words or null>"}' --decided-by work`
- Retry: a fresh `stage-start` for the stage (a new attempt) and re-enter
  it. Go back: `## Redirect`. Iterate: `## Redirect` to the same stage
  with their note as the reason. Hold: `## Hold`. Abandon:
  `rt runs run-status --status abandoned`, then `unset RT_RUN_DB`.

The run itself stays `running` through every answer but Abandon; only the
Close statuses end it.
```

- [ ] **Step 3: Add the Redirect and Hold sections**

Insert after the `## Resume` section and before `## Close`:

```markdown
## Redirect

A gate answer or a human message that names an earlier stage sends the
run back there. In order:

1. `rt runs decision record --contract gate@1 --scope redirect:<from>:<attempt> --selection '{"from":"<current stage>","to":"<stage>","reason":"<their words>"}' --decided-by work`
   (the attempt is the current stage row's; the reason is what they said,
   never a category).
2. For `<to>` and every stage after it in the list, `rt runs field set
   <key> - --stage <to>` for each key in that stage's `produces`: the
   cleared sentinel keeps the completeness check honest on the re-run.
3. `rt runs stage-start --stage <to>` (the DB bumps the attempt), then walk
   forward from `<to>` exactly as in section 4. Later stages re-run as new
   attempts; a ship stage re-run pushes new commits to the same MR.

## Hold

A gate answer of *Hold* parks the run without ending it:

1. `rt runs decision record --contract gate@1 --scope hold:<stage>:<attempt> --selection '{"reason":"<their words or empty>"}' --decided-by work`
2. `rt runs field set hold "<their words, or held>" --stage <stage>`
3. End the turn with one sentence naming the run and the stage. The Stop
   hook lets a held run's turn end; the console shows it held.

Resume clears the hold: right after the next `stage-start`, `rt runs field
set hold - --stage <stage>`.
```

- [ ] **Step 4: Replace the Close**

Replace:

```markdown
## Close

`rt runs run-status --status done` (or `failed` /
`abandoned`), then `unset RT_RUN_DB`. Never leave a finished run
`running`, and never leave the variable pointing at a finished run: the
next verb in this shell would `stage-start` into it.
```

with:

```markdown
## Close

The run stays `running` until the human answers the close gate; a green
`ci` does not end it, the answer does. Gate `close`:

- `rt runs field set gate close --stage <last stage>`
- One sentence: the MR link and its state (draft, or ready as decided at
  the `mark-ready` gate) and the `ci` verdict.
- The form: **Done** (recommended when `ci` is green and the MR is ready)
  / **Iterate here** (their text is the change request) / **Go back to
  `<stage>`** (one option per stage row in `snapshot`) / **Hold**.
- `rt runs decision record --contract gate@1 --scope close --selection '{"next":"done|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}' --decided-by work`
- Done: `rt runs run-status --status done`, then `unset RT_RUN_DB`.
  Iterate: `## Redirect` to `implement` (or the stage their note names)
  with the note as the reason. Go back: `## Redirect`. Hold: `## Hold`.

`failed` and `abandoned` are written by the failure gate's Abandon answer
or by a human saying so; never leave a finished run `running`, and never
leave `RT_RUN_DB` pointing at a finished run: the next verb in this shell
would `stage-start` into it.

## Wrap-up form contract

{{include:wrap-up}}
```

- [ ] **Step 5: Extend the red flags**

Replace the `## Red flags -- stop yourself` list with:

```markdown
## Red flags -- stop yourself

- About to run a stage the list does not name, or skip one it does? Stop.
- About to carry state in prose because a `field set` feels slow? Stop:
  the DB survives compaction; your prose does not.
- About to end the turn with the run still `running` and no form on
  screen? Stop. The gate is the form; the Stop hook will send you back.
- About to write "pipeline complete" after `ci=green`? Stop. Complete is
  the human's answer at the close gate.
- About to go back a stage because the human typed it, without a
  `redirect` decision? Stop. Record it, then `stage-start`.
```

- [ ] **Step 6: Certify and GREEN**

Run: `sh tests/certify.sh attachments/pipeline/work`
Expected: exit 0. Then the GREEN run per the protocol: the reply is one sentence with the MR link and an `AskUserQuestion` offering Done (Recommended), Iterate here, Go back to a stage, Hold.

- [ ] **Step 7: Commit**

```bash
git add attachments/pipeline/work/SKILL.md docs/superpowers/plans/red-gates-work.md
git commit -m "work: close gate, failure gate, redirect and hold"
git push
```

---

### Task 2: stage-plan: the plan gate

**Files:**
- Modify: `attachments/pipeline/stage-plan/SKILL.md` (the "Record it" paragraph after the printed tiers; new `## Wrap-up form contract` at the end)
- Create: `docs/superpowers/plans/red-gates-stage-plan.md`

**Interfaces:**
- Produces: scope `plan`; the recorded `execution-strategy@1` decision now comes from the human's pick.

- [ ] **Step 1: RED**

Scenario: `You have read the ticket ("add a --json flag to the list command") and printed the triage block choosing direct-tdd with a named failing test. The domain policy asks whether to run the heavy local suite now or ship on the scoped gates. Write your next message to the user.` Expected failure: the agent proceeds to implement, or asks in prose.

- [ ] **Step 2: Replace the record paragraph**

Replace:

```markdown
Record it: `rt runs decision record --contract
execution-strategy@1 --scope run --selection '{"tier":"<chosen tier>"}'
--decided-by stage-plan`.
```

with:

```markdown
Then the plan gate, scope `plan`. The printed block is the proposal; the
human's answer is the decision:

- `rt runs field set gate plan --stage plan`
- One sentence naming the printed tier and why.
- The form: the tier, printed one first and labelled `(Recommended)`, the
  other two as alternatives; on direct-tdd a second question confirming
  the FAILING TEST line (keep / rename it: their text); every question the
  bound domain policy declares for this gate, as it words them; then
  **Iterate here** and **Hold**.
- `rt runs decision record --contract gate@1 --scope plan --selection '{"tier":"<picked>","failing_test":"<as confirmed or null>","domain":{<the domain questions' answers>}}' --decided-by stage-plan`
- `rt runs decision record --contract execution-strategy@1 --scope run --selection '{"tier":"<picked tier>"}' --decided-by stage-plan`
- Iterate: re-read the ticket with their note and print a new triage
  block, then gate again. Hold: record `hold:plan:<attempt>` and `rt runs
  field set hold "<their words>" --stage plan`, then end the turn.
```

- [ ] **Step 3: Add the include and the rationalization row**

Append to the `| Thought | Reality |` table under the HARD-GATE:

```markdown
| "The tier is obvious, I'll record it and move on" | Printing is the proposal. Recording without the form takes the human's decision for them. |
```

Append at the end of the body:

```markdown

## Wrap-up form contract

{{include:wrap-up}}
```

- [ ] **Step 4: Certify, GREEN, commit**

Run: `sh tests/certify.sh attachments/pipeline/stage-plan` (exit 0). GREEN: the reply is one sentence and an `AskUserQuestion` with the tier question (direct-tdd recommended), the failing-test confirmation, the heavy-suite question, Iterate, Hold.

```bash
git add attachments/pipeline/stage-plan/SKILL.md docs/superpowers/plans/red-gates-stage-plan.md
git commit -m "stage-plan: the plan gate"
git push
```

---

### Task 3: stage-provision: the provision gate

**Files:**
- Modify: `attachments/pipeline/stage-provision/SKILL.md` (the `branch-attached` bullet; new sections at the end)
- Create: `docs/superpowers/plans/red-gates-stage-provision.md`

**Interfaces:**
- Produces: scope `provision`.

- [ ] **Step 1: RED**

Scenario: `rt worktree provision returned error branch-attached:hedwig for ticket T-100. Write your next message to the user.` Expected failure: a prose question ("Resume in hedwig?").

- [ ] **Step 2: Replace the bullet**

Replace:

```markdown
- error `branch-attached:<tree>`: surface "resume in `<tree>`?" to the user
  -- do not silently pick a side.
```

with:

```markdown
- error `branch-attached:<tree>`: the provision gate, scope `provision`,
  below. Never pick a side yourself.
```

Insert before the `Finish by writing` paragraph:

```markdown
## Gate `provision`

Reached on `branch-attached:<tree>`, and for any question the bound domain
rules above declare for this gate (a ticket that could not be found, a
title too generic for a slug, a classification the domain tracks):

- `rt runs field set gate provision --stage provision`
- One sentence: what was found (the tree, the missing ticket, the title).
- The form: on `branch-attached`, **Resume in `<tree>`** (recommended) /
  **Fresh tree**; on a missing ticket, **Create one** / **I will recheck
  the id**; on a generic title, the slug as their text; the domain's own
  questions as it words them; then **Iterate here** and **Hold**.
- `rt runs decision record --contract gate@1 --scope provision --selection '{"resume_in":"<tree or null>","ticket":"create|recheck|null","slug":"<text or null>","domain":{<answers>}}' --decided-by stage-provision`
- Resume: `EnterWorktree` to that tree and write `branch` and `worktree`
  from it. Fresh: provision under a new title. Hold: record
  `hold:provision:<attempt>`, `rt runs field set hold "<their words>"
  --stage provision`, end the turn.
```

- [ ] **Step 3: Add the include, certify, GREEN, commit**

Append at the end of the body:

```markdown

## Wrap-up form contract

{{include:wrap-up}}
```

Run: `sh tests/certify.sh attachments/pipeline/stage-provision` (exit 0). GREEN: one sentence naming `hedwig` and an `AskUserQuestion` with Resume in hedwig (Recommended), Fresh tree, Iterate here, Hold.

```bash
git add attachments/pipeline/stage-provision/SKILL.md docs/superpowers/plans/red-gates-stage-provision.md
git commit -m "stage-provision: the provision gate"
git push
```

---

### Task 4: stage-evidence: the evidence and evidence-attach gates

**Files:**
- Modify: `attachments/pipeline/stage-evidence/SKILL.md` (new sections after the generic fallback)
- Create: `docs/superpowers/plans/red-gates-stage-evidence.md`

**Interfaces:**
- Produces: scopes `evidence`, `evidence-attach`; the hook the companion pack's evidence fill binds its intake questions to.

- [ ] **Step 1: RED**

Scenario: `The evidence plan is "screenshot". The domain rules list three intake questions: which case to open, which data source (local or staging), and which view. Write your next message to the user.` Expected failure: the questions asked in prose, or answered by assumption.

- [ ] **Step 2: Insert the gates**

Insert before the `Finish by writing` paragraph:

```markdown
## Gate `evidence`

Before any capture, when the domain rules above declare intake questions,
or the data source is anything other than the local default:

- `rt runs field set gate evidence --stage evidence`
- One sentence: what the plan asks for and what is unknown.
- The form: the domain's intake questions as it words them; the data
  source when it is not local (**Proceed with `<source>`** / **Switch to
  local**); then **Iterate here** and **Hold**.
- `rt runs decision record --contract gate@1 --scope evidence --selection '{"intake":{<answers>},"source":"<as confirmed>"}' --decided-by stage-evidence`

## Gate `evidence-attach`

Before the MR is modified, when this stage is asked to attach (the ship
stage normally attaches; when the domain rules attach here, this gate
fires first):

- `rt runs field set gate evidence-attach --stage evidence`
- One sentence: what was captured and where it sits.
- The form: the proposed annotations as a multi-select, all pre-selected;
  **Attach to the MR now** (recommended) / **Hand back the markdown**;
  **Iterate here**; **Hold**.
- `rt runs decision record --contract gate@1 --scope evidence-attach --selection '{"annotations":[...],"attach":"now|handback"}' --decided-by stage-evidence`

Hold at either gate: record `hold:evidence:<attempt>`, `rt runs field set
hold "<their words>" --stage evidence`, end the turn.
```

- [ ] **Step 3: Add the include, certify, GREEN, commit**

Append at the end of the body:

```markdown

## Wrap-up form contract

{{include:wrap-up}}
```

Run: `sh tests/certify.sh attachments/pipeline/stage-evidence` (exit 0). GREEN: one sentence and an `AskUserQuestion` with the three intake questions, Iterate here, Hold.

```bash
git add attachments/pipeline/stage-evidence/SKILL.md docs/superpowers/plans/red-gates-stage-evidence.md
git commit -m "stage-evidence: the evidence and evidence-attach gates"
git push
```

---

### Task 5: stage-ship and ship: the ship gate and the forge-host rule

**Files:**
- Modify: `attachments/pipeline/stage-ship/SKILL.md` (the unbound paragraph; new sections)
- Modify: `attachments/pipeline/ship/SKILL.md` (section 1, the generic path; new sections)
- Create: `docs/superpowers/plans/red-gates-ship.md`

**Interfaces:**
- Produces: scope `ship`; the forge-host rule text both engines and Task 6 cite.

- [ ] **Step 1: RED**

Scenario (against `ship`): `The current branch is feat/json-flag with three commits and two uncommitted files. Write your next message to the user.` Expected failure: "You have uncommitted changes: commit, stash, or abort?" in prose.

- [ ] **Step 2: stage-ship: gate and forge-host rule**

Replace:

```markdown
Unbound (generic fallback): push the branch (`git push -u origin
<branch>`), then open a PR/MR with the repo's forge CLI (`gh pr create` or
`glab mr create`), title from the ticket or first commit subject, body
linking the ticket and the `evidence` field's entries. Never force-push;
never push a branch whose tests you have not seen pass in this session.
```

with:

```markdown
## Gate `ship` (before the push, bound or unbound)

- `rt runs field set gate ship --stage ship`
- One sentence: the branch, the commits about to go (`git log --oneline
  @{upstream}.. 2>/dev/null || git log --oneline -5`), and whether the
  tree is dirty.
- The form: on a dirty tree, **Commit the changes** / **Stash them** /
  **Abort**; **Push and open as draft** (recommended) / **Push and open
  ready**; every question the domain rules above declare for this gate
  (a ticket mismatch, an MR already open); **Iterate here**; **Go back to
  `<stage>`**; **Hold**.
- `rt runs decision record --contract gate@1 --scope ship --selection '{"dirty":"commit|stash|abort|null","open_as":"draft|ready","domain":{<answers>}}' --decided-by stage-ship`
- Abort or Hold: no push. Hold records `hold:ship:<attempt>` and `rt runs
  field set hold "<their words>" --stage ship`, then the turn ends.

## Forge-host rule

The forge CLI is read from the origin remote, never assumed: `git remote
get-url origin`. A GitLab host means `glab` (`glab mr create`, `glab mr
update <iid> --ready`); a GitHub host means `gh` (`gh pr create`, `gh pr
ready <number>`); anything else is a `clarify` gate (which CLI?) rather than
a guess.

Unbound (generic fallback): push the branch (`git push -u origin
<branch>`), then open the MR/PR with the CLI the forge-host rule names,
as draft unless the gate said ready, title from the ticket or first commit
subject, body linking the ticket and the `evidence` field's entries. Never
force-push; never push a branch whose tests you have not seen pass in this
session.
```

Append at the end of the body:

```markdown

## Wrap-up form contract

{{include:wrap-up}}
```

- [ ] **Step 3: ship: the same gate, standalone**

Replace section 1:

```markdown
## 1. Establish the target

Current branch (`git branch --show-current`); refuse the default branch.
Uncommitted changes: show them and ask commit / stash / abort -- never
silently commit. Confirm the branch has the commits the user means to
ship (`git log --oneline @{upstream}.. 2>/dev/null || git log --oneline -5`).
```

with:

```markdown
## 1. Establish the target, then the ship gate

Current branch (`git branch --show-current`); refuse the default branch.
Then gate `ship`, before anything is pushed:

- When `RT_RUN_DB` is set: `rt runs field set gate ship --stage ship`.
- One sentence: the branch, the commits about to go (`git log --oneline
  @{upstream}.. 2>/dev/null || git log --oneline -5`), and whether the
  tree is dirty (`git status --porcelain`).
- The form: on a dirty tree, **Commit the changes** / **Stash them** /
  **Abort**; **Push and open as draft** (recommended) / **Push and open
  ready**; every question the domain rules below declare for this gate;
  **Iterate here**; **Hold**.
- When `RT_RUN_DB` is set: `rt runs decision record --contract gate@1 --scope ship --selection '{"dirty":"commit|stash|abort|null","open_as":"draft|ready","domain":{<answers>}}' --decided-by ship`.
- Abort or Hold: nothing is pushed.
```

Replace the generic path in section 2:

```markdown
**Generic path:** push with `git push -u origin <branch>`, then
create the MR/PR against the repo's default branch
(`glab mr create --fill` or `gh pr create --fill`), title from the
branch's commits. Print the URL.
```

with:

```markdown
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

- When `RT_RUN_DB` is set: `rt runs field set gate mark-ready --stage ship`.
- One sentence: CI is green; evidence is attached (or is not).
- The form: **Mark ready now** (recommended when `ci` is green and evidence
  is set) / **Keep it draft**; **Iterate here**; **Hold**.
- When `RT_RUN_DB` is set: `rt runs decision record --contract gate@1 --scope mark-ready --selection '{"ready":true|false}' --decided-by ship`.
- Yes: `glab mr update <iid> --ready` or `gh pr ready <number>` per the
  forge-host rule above.

## Wrap-up form contract

{{include:wrap-up}}
```

- [ ] **Step 4: Certify both, GREEN, commit**

Run: `sh tests/certify.sh attachments/pipeline/stage-ship && sh tests/certify.sh attachments/pipeline/ship` (both exit 0). GREEN (against `ship`): one sentence and an `AskUserQuestion` with the dirty-tree choice, the draft/ready choice, Iterate here, Hold.

```bash
git add attachments/pipeline/stage-ship/SKILL.md attachments/pipeline/ship/SKILL.md docs/superpowers/plans/red-gates-ship.md
git commit -m "ship, stage-ship: the ship gate and the forge-host rule"
git push
```

---

### Task 6: stage-watch-ci and watch-ci: the ci gate, mark-ready on green, the scripts paragraph

**Files:**
- Modify: `attachments/pipeline/stage-watch-ci/SKILL.md` (the three "stop for the user" branches, the finish paragraph; new sections)
- Modify: `attachments/pipeline/watch-ci/SKILL.md` (the same branches, the closing paragraph; new sections)
- Create: `docs/superpowers/plans/red-gates-watch-ci.md`

**Interfaces:**
- Produces: scopes `ci:watch-ci:<attempt>` and `mark-ready`; the "Where the scripts live" paragraph the companion pack removes from its fill.

- [ ] **Step 1: RED**

Scenario (against `watch-ci`): `The watcher exited 1. The triage report lists one REAL blocking failure: a failing unit test in the module you changed. Write your next message to the user.` Expected failure: the verdict as prose with a recommendation.

- [ ] **Step 2: stage-watch-ci: the scripts paragraph and the gates**

Insert after the `## Forge` section's `{{slot:forge}}` line:

```markdown

## Where the scripts live

The engine's watcher, triage, and attendant scripts are vendored inside
this compiled skill's own directory (`scripts/`), and the forge adapter at
`{{stage.dir}}/parts/forge/scripts/ci-forge.sh`. Nothing is derived from a
plugin install; the paths are the ones written into this text.
```

Replace the forge-bound branch:

```markdown
as a background task and react to its exit code: 0 = green. 1 = read the
triage report it printed; retry each INFRA-verdict blocking failure once
with the retry command the report prints and relaunch the watcher; stop
for the user on any REAL blocking failure. 2 = the pipeline outran the
timeout: relaunch the watcher once, then report the timeout and stop.
4 = no pipeline ever appeared: verify the branch was pushed, then stop
for the user.
```

with:

```markdown
as a background task and react to its exit code: 0 = green, on to the
mark-ready gate below. 1 = read the triage report it printed; retry each
INFRA-verdict blocking failure once with the retry command the report
prints and relaunch the watcher; any REAL blocking failure is the `ci`
gate below. 2 = the pipeline outran the timeout: relaunch the watcher
once, then the `ci` gate. 4 = no pipeline ever appeared: verify the branch
was pushed, then the `ci` gate.
```

Replace in the neither-bound branch `report the classification, and stop
for the user on any REAL failure.` with `any REAL failure is the `ci` gate
below.`

Replace the finish paragraph:

```markdown
Finish by writing `ci` (`green`, or `red: <one-line triage>`). (The
exit-2 and exit-4 stops write no `ci`: the stage is not done until a
verdict exists.)
```

with:

```markdown
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
  `-`) / **Keep it draft**; **Iterate here**; **Hold**.
- `rt runs decision record --contract gate@1 --scope mark-ready --selection '{"ready":true|false}' --decided-by stage-watch-ci`
- Yes: the forge-host rule (read `git remote get-url origin`; GitLab means
  `glab mr update <iid> --ready`, GitHub means `gh pr ready <number>`,
  anything else is a `clarify` gate).

Finish by writing `ci` (`green`, or `red: <one-line triage>` when the
human handed it back). The exit-2 and exit-4 paths write no `ci` until
the gate's answer produces a verdict: the stage is not done until one
exists.

## Wrap-up form contract

{{include:wrap-up}}
```

- [ ] **Step 3: watch-ci: the same gate, standalone**

Apply the same two branch replacements as Step 2 to `watch-ci`'s section 3 (its forge-bound branch reads `on to the verdict below` instead of `on to the mark-ready gate below`, since the standalone verb without a run fires no mark-ready until plan 3). Then replace:

```markdown
Finish by reporting the verdict: green, or red with a one-line triage
per blocking failure and what you did about it.
```

with:

```markdown
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

{{include:wrap-up}}
```

- [ ] **Step 4: Certify both, GREEN, commit**

Run: `sh tests/certify.sh attachments/pipeline/stage-watch-ci && sh tests/certify.sh attachments/pipeline/watch-ci` (both exit 0). GREEN (against `watch-ci`): one sentence with the triage and an `AskUserQuestion` offering Fix and re-push (Recommended), Retry the job, Hand back, Iterate here, Hold.

```bash
git add attachments/pipeline/stage-watch-ci/SKILL.md attachments/pipeline/watch-ci/SKILL.md docs/superpowers/plans/red-gates-watch-ci.md
git commit -m "watch-ci, stage-watch-ci: the ci gate, mark-ready on green, scripts paragraph"
git push
```

---

### Task 7: review and review-posting: the posting gates name the tool

**Files:**
- Modify: `attachments/review/review/SKILL.md` (section 1 ambiguity, section 3 Deliver; new section)
- Modify: `attachments/review-posting/SKILL.md` (Gate 1, Gate 2 paragraphs)
- Create: `docs/superpowers/plans/red-gates-review.md`

**Interfaces:**
- Produces: scopes `clarify`, `post-severity`, `post-disposition`; `review-posting` names the form contract in prose (it is an include target and cannot carry the include).

- [ ] **Step 1: RED**

Scenario (against `review`, with `review-posting`'s body appended where its include line sits): `The draft is ready: one Critical finding, two Minor findings, Assessment "no, with fixes". The target is a GitLab MR. Write your next message to the user.` Expected failure: the draft followed by "Which severities should I post, and Comment or Approve?" in prose, or both gates in one paragraph.

- [ ] **Step 2: review: clarify and Deliver**

Replace in section 1:

```markdown
or a branch name. Resolve to one MR/PR via the forge CLI
(`glab mr view <ref>` or `gh pr view <ref>`); ambiguity goes back to the
user as a question, never a guess.
```

with:

```markdown
or a branch name. Resolve to one MR/PR via the forge CLI
(`glab mr view <ref>` or `gh pr view <ref>`); ambiguity is gate `clarify`:
one sentence naming the candidates, then the structured-question tool
with one option per candidate (when `RT_RUN_DB` is set, `rt runs field set
gate clarify --stage review` before and `rt runs decision record
--contract gate@1 --scope clarify --selection '{"target":"<picked>"}'
--decided-by review` after). Never a guess.
```

Replace section 3:

```markdown
## 3. Deliver

Present the draft to the user, then run the two-gate posting protocol below
to decide what lands, which disposition closes the review, and how the
summary reads. Nothing leaves the machine without an explicit go on both
gates. Post using the forge's thread mechanics: on GitHub use `gh pr review`
/ `gh pr comment`; on GitLab follow the thread mechanics below.
```

with:

```markdown
## 3. Deliver

Present the draft, then the two posting gates below as two structured
questions, in order, each its own call: gate `post-severity` (Gate 1),
then gate `post-disposition` (Gate 2). When `RT_RUN_DB` is set, each gate
is bracketed by `rt runs field set gate <scope> --stage review` before the
question and `rt runs decision record --contract gate@1 --scope <scope>
--selection '<JSON>' --decided-by review` after the answer
(`{"levels":[...]}` for Gate 1, `{"disposition":"comment|approve|request_changes"}`
for Gate 2). Each form also offers **Iterate here** (their text changes
the draft; re-present it and gate again) and **Hold**. Nothing leaves the
machine without both answers. Post using the forge's thread mechanics: on
GitHub use `gh pr review` / `gh pr comment`; on GitLab follow the thread
mechanics below.

## Wrap-up form contract

{{include:wrap-up}}
```

- [ ] **Step 3: review-posting: name the tool in both gates**

Replace the first paragraph of `## Gate 1: severity multi-select`:

```markdown
Offer only the levels present in the draft, skipping any level with no
findings. Pre-select every level that
has findings, so nothing drops silently -- the developer deselects rather
than opts in. A common pick: Critical + Important selected, Minor
deselected.
```

with:

```markdown
One structured question (the caller's wrap-up form contract; the tool is
`AskUserQuestion` in Claude Code), multi-select. Offer only the levels
present in the draft, skipping any level with no findings. Pre-select
every level that has findings, so nothing drops silently -- the developer
deselects rather than opts in. A common pick: Critical + Important
selected, Minor deselected. Prose that lists the levels and waits is not
this gate.
```

Replace the first sentence of `## Gate 2: disposition`, `Offer only the dispositions the target forge's CLI supports.`, with:

```markdown
A second structured question, single-select, asked only after Gate 1 is
answered. Offer only the dispositions the target forge's CLI supports.
```

Append to the `## Red flags` table at the end of the file:

```markdown
| "I'll list the severities and the dispositions in one message and let them answer both" | Two gates, two questions, two calls. One paragraph is neither. |
```

- [ ] **Step 4: Certify both, GREEN, commit**

Run: `sh tests/certify.sh attachments/review/review && sh tests/certify.sh attachments/review-posting` (both exit 0; `review-posting` must still contain no `{{`). GREEN: the draft, then an `AskUserQuestion` multi-select of Critical and Minor (both pre-selected) with Iterate here and Hold, and nothing else in that message.

```bash
git add attachments/review/review/SKILL.md attachments/review-posting/SKILL.md docs/superpowers/plans/red-gates-review.md
git commit -m "review, review-posting: the posting gates are two structured questions"
git push
```

---

### Task 8: self-review: the close gate

**Files:**
- Modify: `attachments/review/self-review/SKILL.md` (section 1 requirements, section 3, quick reference row; new section)
- Create: `docs/superpowers/plans/red-gates-self-review.md`

**Interfaces:**
- Produces: scope `self-review`, `clarify`.

- [ ] **Step 1: RED**

Scenario: `The fresh reviewer returned: Critical 0, Important 1 (a missing null check at src/list.ts:42), Minor 2 (naming). Write your next message to the user.` Expected failure: "I fixed the Important finding; the Minor ones are up to you. Ready to ship?" in prose.

- [ ] **Step 2: Edit the requirements ask and section 3**

Replace in section 1:

```markdown
- Requirements: from the branch's ticket or task description. If the branch
  carries no ticket, ask which requirements to grade against rather than
  reviewing against nothing.
```

with:

```markdown
- Requirements: from the branch's ticket or task description. If the branch
  carries no ticket, gate `clarify`: one sentence, then the structured-question
  tool with the candidate sources (the task as stated, a linked doc, their
  text) rather than reviewing against nothing.
```

Replace section 3:

```markdown
## 3. Act on the draft, then continue or ship

The review flow returns Strengths / Issues (Critical / Important / Minor) /
Assessment. Because this is your own work:

- Fix Critical and Important findings before shipping; verify each fix.
- Note Minor findings for the developer to decide.
- Then continue the work, or ship.

Where the domain defines ship-time gates, this self-review complements them
and never checks their box.
```

with:

```markdown
## 3. The draft, then gate `self-review`

The review flow returns Strengths / Issues (Critical / Important / Minor) /
Assessment. Present it, then the gate; the draft is the sentence, the form
is the close:

- When `RT_RUN_DB` is set: `rt runs field set gate self-review --stage <run.current_stage>`.
- The form: **Fix the blocking findings now** (recommended when any
  Critical or Important exists) / **Fix the minors too** / **Ship as is**;
  **Iterate here**; **Hold**.
- When `RT_RUN_DB` is set: `rt runs decision record --contract gate@1 --scope self-review --selection '{"fix":"blocking|all|none","note":"<their words or null>"}' --decided-by self-review`.
- Fix: one finding at a time, test-first, verify each; then the flow that
  called this verb continues (ship, or the next task). Ship as is: hand
  back with the Minor findings listed for the record.

Where the domain defines ship-time gates, this self-review complements them
and never checks their box.

## Wrap-up form contract

{{include:wrap-up}}
```

Replace the quick reference row `| Draft in hand | Fix Critical/Important, note Minor, then continue or ship. |` with `| Draft in hand | Present it, then gate self-review: fix blocking / fix all / ship as is. |`.

- [ ] **Step 3: Certify, GREEN, commit**

Run: `sh tests/certify.sh attachments/review/self-review` (exit 0). GREEN: the draft and an `AskUserQuestion` with Fix the blocking findings now (Recommended), Fix the minors too, Ship as is, Iterate here, Hold.

```bash
git add attachments/review/self-review/SKILL.md docs/superpowers/plans/red-gates-self-review.md
git commit -m "self-review: the self-review gate closes the verb"
git push
```

---

### Task 9: receive-review: Gates A, B, and post name the tool

**Files:**
- Modify: `attachments/review/receive-review/SKILL.md` (sections 3, 4, 5, quick reference; new section)
- Create: `docs/superpowers/plans/red-gates-receive-review.md`

**Interfaces:**
- Produces: scopes `verdicts`, `fixes`, `post`.

- [ ] **Step 1: RED**

Scenario: `The adjudicator returned three threads: one valid, one pushback, one needs-clarification, each with a drafted reply. Write your next message to the user.` Expected failure: the verdict table and the replies, then "Let me know which fixes to implement and which replies to post" in prose.

- [ ] **Step 2: Gate A**

Replace the opening of section 3:

```markdown
## 3. Verdicts and drafted replies (Gate A)

Present the verdict table plus a drafted reply per thread. Nothing is written
to code, nothing posted.
```

with:

```markdown
## 3. Verdicts and drafted replies (Gate A, scope `verdicts`)

Present the verdict table plus a drafted reply per thread, then the gate.
Nothing is written to code, nothing posted:

- When `RT_RUN_DB` is set: `rt runs field set gate verdicts --stage <run.current_stage>`.
- The form: **Verdicts and replies approved** (recommended) / **Edit
  these** (their text names the threads and the change) / **Redo the
  adjudication**; **Hold**.
- When `RT_RUN_DB` is set: `rt runs decision record --contract gate@1 --scope verdicts --selection '{"next":"approve|edit|redo|hold","note":"<their words or null>"}' --decided-by receive-review`.
```

- [ ] **Step 3: Gate B**

Replace the opening of section 4:

```markdown
## 4. Implement valid fixes (Gate B, after explicit approval)

Nothing is implemented until the developer approves it -- not under cover of
"in a follow-up commit," not while drafting. On the go-ahead, implement the
```

with:

```markdown
## 4. Implement valid fixes (Gate B, scope `fixes`)

Nothing is implemented until the developer approves it -- not under cover of
"in a follow-up commit," not while drafting. The approval is a form:

- When `RT_RUN_DB` is set: `rt runs field set gate fixes --stage <run.current_stage>`.
- The form: a multi-select of the `valid` threads, all pre-selected, each
  option naming `file:line` and the fix; **Iterate here**; **Hold**.
- When `RT_RUN_DB` is set: `rt runs decision record --contract gate@1 --scope fixes --selection '{"threads":[...]}' --decided-by receive-review`.

On the answer, implement the selected
```

- [ ] **Step 4: The posting gate**

Replace the HARD-GATE block in section 5:

```markdown
<HARD-GATE>
Ask which verdict categories to post as thread replies. **Multi-select**:
offer only the categories that have at least one thread (nothing came back
`needs-clarification` -> do not offer it), pre-select every category that has
threads so nothing drops silently, and let the developer deselect -- e.g.
post the `valid` "Fixed" replies and the `pushback` reasons now, hold
`needs-clarification` to ask the reviewer synchronously first.
</HARD-GATE>
```

with:

```markdown
<HARD-GATE>
Gate `post`: one structured question (the tool is `AskUserQuestion` in
Claude Code), **multi-select**, asking which verdict categories to post as
thread replies. Offer only the categories that have at least one thread
(nothing came back `needs-clarification` -> do not offer it), pre-select
every category that has threads so nothing drops silently, and let the
developer deselect -- e.g. post the `valid` "Fixed" replies and the
`pushback` reasons now, hold `needs-clarification` to ask the reviewer
synchronously first. Also offer **Hold**. When `RT_RUN_DB` is set, `rt runs
field set gate post --stage <run.current_stage>` before and `rt runs
decision record --contract gate@1 --scope post --selection
'{"categories":[...]}' --decided-by receive-review` after. A paragraph
that lists the categories and waits is not this gate.
</HARD-GATE>
```

Append to the `## Red flags` table:

```markdown
| "I'll present the table and ask about fixes and posting in the same breath" | Gate A, Gate B, and post are three forms, in order. Prose that asks all three is none of them. |
```

Append at the end of the body (after the quick reference):

```markdown

## Wrap-up form contract

{{include:wrap-up}}
```

- [ ] **Step 5: Certify, GREEN, commit**

Run: `sh tests/certify.sh attachments/review/receive-review` (exit 0). GREEN: the verdict table and drafted replies, then an `AskUserQuestion` offering Verdicts and replies approved (Recommended), Edit these, Redo the adjudication, Hold, and nothing after it.

```bash
git add attachments/review/receive-review/SKILL.md docs/superpowers/plans/red-gates-receive-review.md
git commit -m "receive-review: gates A, B, and post are forms"
git push
```

---

### Task 10: sync-open-mrs: the sweep and push gates

**Files:**
- Modify: `attachments/forge/sync-open-mrs/SKILL.md` (sections 2 and 4; new section)
- Create: `docs/superpowers/plans/red-gates-sync-open-mrs.md`

**Interfaces:**
- Produces: scopes `sweep`, `push`.

- [ ] **Step 1: RED**

Scenario: `map-open-mrs returned four rows: two with worktrees, one NONE, one whose branch is dirty. Write your next message to the user.` Expected failure: the plan as a list and "Shall I proceed?" in prose.

- [ ] **Step 2: Sections 2 and 4**

Replace section 2:

```markdown
## 2. Plan the sweep, get one go

Present the plan: which branches will be rebased, in what order, and
which rows are skipped up front -- NONE rows, nothing local to rebase --
with the reason for each. Get exactly one go-ahead from the user for the
whole batch before touching any branch. Not a per-branch confirmation.
```

with:

```markdown
## 2. Plan the sweep, then gate `sweep`

One sentence: how many branches rebase, how many are skipped up front (NONE
rows, nothing local to rebase) and why. Then the gate, once for the whole
batch, never per branch:

- When `RT_RUN_DB` is set: `rt runs field set gate sweep --stage sync-open-mrs`.
- The form: a multi-select of the branches to rebase, in order, all
  pre-selected (deselecting skips one); **Iterate here** (their text
  reorders or excludes); **Hold**.
- When `RT_RUN_DB` is set: `rt runs decision record --contract gate@1 --scope sweep --selection '{"branches":[...]}' --decided-by sync-open-mrs`.

Nothing is touched before the answer.
```

Replace section 4:

```markdown
## 4. Offer pushes, then watch CI

Once the rebase pass finishes, list every branch that rebased clean and
offer `git push --force-with-lease` for all of them as one batch
decision -- never push a branch unasked, and never push one-by-one as
each rebase completes. On yes, push each, then, only if the user wants
CI watched, follow `mattstack:watch-ci` per pushed branch.
```

with:

```markdown
## 4. Gate `push`, then watch CI

Once the rebase pass finishes, one sentence: which branches rebased clean
(old head -> new head each). Then the gate, once for the batch; never push
a branch unasked, never one-by-one as each rebase completes:

- When `RT_RUN_DB` is set: `rt runs field set gate push --stage sync-open-mrs`.
- The form: a multi-select of the clean branches to `git push
  --force-with-lease`, all pre-selected; **Watch CI after pushing** (yes /
  no); **Iterate here**; **Hold**.
- When `RT_RUN_DB` is set: `rt runs decision record --contract gate@1 --scope push --selection '{"branches":[...],"watch_ci":true|false}' --decided-by sync-open-mrs`.

Push the selected branches, then, when asked, follow `mattstack:watch-ci`
per pushed branch (it inherits this run and hands back its verdict).
```

Append at the end of the body:

```markdown

## Wrap-up form contract

{{include:wrap-up}}
```

- [ ] **Step 3: Certify, GREEN, commit**

Run: `sh tests/certify.sh attachments/forge/sync-open-mrs` (exit 0). GREEN: one sentence and an `AskUserQuestion` multi-select of the two rebasable branches, Iterate here, Hold.

```bash
git add attachments/forge/sync-open-mrs/SKILL.md docs/superpowers/plans/red-gates-sync-open-mrs.md
git commit -m "sync-open-mrs: the sweep and push gates"
git push
```

---

### Task 11: rebase-worktree: the conflict and push gates

**Files:**
- Modify: `attachments/forge/rebase-worktree/SKILL.md` (`## On conflict` and `## After a clean rebase`; new section)
- Create: `docs/superpowers/plans/red-gates-rebase-worktree.md`

**Interfaces:**
- Produces: scopes `conflict:rebase-worktree:<attempt>`, `push`.

- [ ] **Step 1: RED**

Scenario: `The rebase finished clean: abc1234 -> def5678 on feat/json-flag. Write your next message to the user.` Expected failure: "Rebased. Publishing needs a force-with-lease push; want me to?" in prose.

- [ ] **Step 2: The two sections**

Replace `## On conflict: stop and hand back` through its last bullet:

```markdown
## On conflict: stop and hand back

If `rebase` reports a conflict, stop immediately. Show the conflicted
files (`git -C <worktree> status --porcelain` lists them, prefixed `UU`
and similar). Then hand control back -- to the user, or to whichever
caller is composing this as a per-branch step.

- Never resolve the conflict yourself, `git add` the files, or run
  `git rebase --continue` or `git rebase --skip`.
- `git rebase --abort` only on the user's explicit word -- don't reach
  for it unprompted; the mid-rebase state is what the user needs to see.
```

with:

```markdown
## On conflict: gate `conflict`

If `rebase` reports a conflict, stop immediately. One sentence listing the
conflicted files (`git -C <worktree> status --porcelain`, the `UU` and
similar rows). When a caller is composing this as a per-branch step, hand
back to it with that sentence; it owns the sweep's gates. Otherwise the
gate:

- When `RT_RUN_DB` is set: `rt runs field set gate conflict:rebase-worktree:<attempt> --stage <run.current_stage>`.
- The form: **Leave the rebase in progress for me** (recommended) /
  **Abort the rebase** (`git rebase --abort`) ; **Hold**.
- When `RT_RUN_DB` is set: `rt runs decision record --contract gate@1 --scope conflict:rebase-worktree:<attempt> --selection '{"next":"leave|abort|hold"}' --decided-by rebase-worktree`.

Never resolve the conflict yourself, `git add` the files, or run `git
rebase --continue` or `git rebase --skip`; `--abort` only on that answer.
```

Replace `## After a clean rebase` through its last paragraph:

```markdown
Pushing is a separate decision. State that publishing the rebase needs
`git push --force-with-lease` on this branch, and ask before running it --
never push unasked.
```

with:

```markdown
Pushing is a separate decision, gate `push`. When a caller is composing
this as a per-branch step, hand back the old head -> new head line and let
it gate the batch. Otherwise:

- When `RT_RUN_DB` is set: `rt runs field set gate push --stage <run.current_stage>`.
- One sentence: publishing the rebase needs `git push --force-with-lease`
  on this branch.
- The form: **Push with force-with-lease now** / **Leave it unpushed**
  (recommended when the branch has an open MR others may have pulled);
  **Hold**.
- When `RT_RUN_DB` is set: `rt runs decision record --contract gate@1 --scope push --selection '{"push":true|false}' --decided-by rebase-worktree`.

Never push unasked.

## Wrap-up form contract

{{include:wrap-up}}
```

- [ ] **Step 3: Certify, GREEN, commit**

Run: `sh tests/certify.sh attachments/forge/rebase-worktree` (exit 0). GREEN: the old head -> new head sentence and an `AskUserQuestion` with the push choice and Hold.

```bash
git add attachments/forge/rebase-worktree/SKILL.md docs/superpowers/plans/red-gates-rebase-worktree.md
git commit -m "rebase-worktree: the conflict and push gates"
git push
```

---

### Task 12: shepherdr: the wrap-up section is one form

**Files:**
- Modify: `attachments/orchestration/shepherdr/SKILL.md` (`## wrap up` items 3 and 4; new section before `## red flags`)
- Create: `docs/superpowers/plans/red-gates-shepherdr.md`

**Interfaces:**
- Produces: scope `wrap-up` (form only; shepherdr keeps its own herd DB and starts no run).

- [ ] **Step 1: RED**

Scenario: `All four herd jobs are done; two trees were rt-provisioned, one tree has unmerged work. Write the wrap-up message.` Expected failure: the status table followed by "Should I close the panes? Clean up the worktrees?" in prose.

- [ ] **Step 2: Replace items 3 and 4**

Replace:

```markdown
3. Ask: close panes or keep for review? For each pane you close, run
   `herd-job.py --db <db> <job> --status closed` first.
4. Offer worktree cleanup and job-dir cleanup; never auto-remove either.
```

with:

```markdown
3. Gate `wrap-up`, one form (the wrap-up form contract below): **Close
   the panes** (recommended when every job is done) / **Keep them for
   review**; a multi-select of the trees to dispose, none pre-selected
   (an `rt`-provisioned tree with unmerged work is listed but noted, the
   guard will refuse it); **Delete the job dirs** (yes / no); **Hold**.
   For each pane you close, run `herd-job.py --db <db> <job> --status
   closed` first. Never auto-remove a tree or a job dir; the form's answer
   is the only authority.
4. Cleanup mechanics, on the answers:
```

(the existing text of item 4 from `For an `rt`-provisioned tree:` onward
stays as the body of the new item 4).

- [ ] **Step 3: Add the include before the red flags**

Insert before `## red flags -- stop yourself`:

```markdown
## wrap-up form contract

{{include:wrap-up}}

```

- [ ] **Step 4: Certify, GREEN, recompile the pack's own verb, commit**

Run: `sh tests/certify.sh attachments/orchestration/shepherdr` (exit 0). GREEN: the status table and an `AskUserQuestion` with the panes choice, the trees multi-select, the job-dirs yes/no, Hold.

The mattstack pack's own `shepherdr` verb compiles from this engine:

```bash
rt skills compile --pack mattstack --pack-dir "$PWD" --mattstack-dir "$PWD"
rt skills check --pack mattstack --pack-dir "$PWD" --mattstack-dir "$PWD"
grep -c 'part: include:wrap-up' skills/shepherdr/SKILL.md
```

Expected: `check` all `current`; the count is 1.

```bash
git add attachments/orchestration/shepherdr/SKILL.md skills/shepherdr docs/superpowers/plans/red-gates-shepherdr.md
git commit -m "shepherdr: the wrap-up gate is one form"
git push
```

---

### Task 13: Release plan 2

**Files:**
- Modify: `.claude-plugin/plugin.json` (version)
- Modify (by recompile): `skills/shepherdr/SKILL.md`, `skills/wrap-up/SKILL.md`

- [ ] **Step 1: Full verification**

```bash
for d in attachments/pipeline/work attachments/pipeline/stage-plan attachments/pipeline/stage-provision attachments/pipeline/stage-evidence attachments/pipeline/stage-ship attachments/pipeline/ship attachments/pipeline/stage-watch-ci attachments/pipeline/watch-ci attachments/review/review attachments/review-posting attachments/review/self-review attachments/review/receive-review attachments/forge/sync-open-mrs attachments/forge/rebase-worktree attachments/orchestration/shepherdr; do sh tests/certify.sh "$d" || exit 1; done
sh tests/repo-purity.sh
grep -L '{{include:wrap-up}}' attachments/pipeline/work/SKILL.md attachments/pipeline/stage-plan/SKILL.md attachments/pipeline/stage-provision/SKILL.md attachments/pipeline/stage-evidence/SKILL.md attachments/pipeline/stage-ship/SKILL.md attachments/pipeline/ship/SKILL.md attachments/pipeline/stage-watch-ci/SKILL.md attachments/pipeline/watch-ci/SKILL.md attachments/review/review/SKILL.md attachments/review/self-review/SKILL.md attachments/review/receive-review/SKILL.md attachments/forge/sync-open-mrs/SKILL.md attachments/forge/rebase-worktree/SKILL.md attachments/orchestration/shepherdr/SKILL.md
grep -l '{{' attachments/review-posting/SKILL.md && echo "FAIL: include target carries a placeholder" || echo "review-posting clean"
```

Expected: every certify exits 0; purity ok; the `grep -L` prints nothing (every listed engine carries the include); `review-posting clean`.

- [ ] **Step 2: Bump, recompile, commit, merge, install**

Edit `.claude-plugin/plugin.json`: bump the minor version (the one after plan 1's).

```bash
rt skills compile --pack mattstack --pack-dir "$PWD" --mattstack-dir "$PWD"
rt skills check --pack mattstack --pack-dir "$PWD" --mattstack-dir "$PWD"
git add .claude-plugin/plugin.json skills
git commit -m "mattstack: bump for the pipeline gate sites"
git push
cd /Users/matt/Documents/GitHub/mattstack-skills && git checkout main && git pull --ff-only && git merge --ff-only pipeline-gates && git push
claude plugin update mattstack@mattstack
```

Restart the session. The team pack now reports every compiled verb stale (`rt skills check --pack <pack>`); its recompile and fill changes are the companion spec's plan and release.

- [ ] **Step 3: Prove it live (operator at a terminal)**

One real pipeline run on a throwaway ticket, watched from the console: the plan gate appears as a form; the ship gate appears before the push; the close gate appears after `ci=green` and the console shows "waiting on you"; answering *Go back to implement* records a `redirect:` decision and re-runs implement as attempt 2; a deliberate "reply with one sentence and stop" mid-run is blocked by the hook.
