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
the Stop hook covers its pane. Skip this section when the engine that
invoked you handed you a `runDb` and `run_snapshot` on it shows
`run.status` = `running`: you were invoked from inside that run, you
inherit it, `run.current_stage` is your stage, and you close nothing at
the end.

Otherwise, when a surface launched this pane (the `spawnedBy` case
below), start fresh: another pane's live run is not yours to resume.
Launched by hand, first the Resume offer: call `run_list` with `repo` =
the `--repo` value in the flags block below, and keep the runs whose
`status` is `running` and `work_type` is `ship`; never read the run dbs
by hand. Any found: gate
`clarify`, one sentence naming each candidate's `spawned_by`, `started_at`,
and `current_stage`, then the structured-question tool with one **Resume**
option per candidate (recommended for a run this session started earlier; a
run another live pane owns is not yours) / **Start fresh**; **Hold**.
Resume: use
`runDb` = `<absolute home>/.mattstack/runs/<repo>/<its id>/state.db` (the
candidate row's `id`; the run tools refuse `~` and relative paths). If a
run tool refuses it with an error naming a different runs root, use that
root instead. Then `run_stage` with `action: "start"`, `stage: "ship"`
(a new attempt, which re-records this session) and `run_field_set` with `key: "hold"`,
`value: "-"`, `stage: "ship"`; re-enter with `run_snapshot`'s decisions
and do not re-ask a question it already answered.

Fresh. The flags for this verb, rendered by the compiler:

{{run-start.flags:ship}}

Start the run with the `run_start` tool: `flags` is the `ship` flag
string from the block above, verbatim (the value, never its key);
`skillDir` is this skill's own directory, `${CLAUDE_SKILL_DIR}`, as an
absolute path; add `spawnedBy` when a board or another surface launched
this pane. The result must carry `ok: true` and a `runDb`. A tool error:
stop and report its message. No `run_start` tool available at all: this
rt is too old; stop and tell the user to update rt. Keep `runDb` and
pass it to every `run_*` call in this verb; nothing is exported. Then `run_stage` with `action: "start"`, `stage: "ship"`.

Every gate in this verb then writes its `gate` field and its decision with
`stage: "ship"`. The close, after the final gate's answer and only when
this section ran `run_start`: `run_stage` with `action: "done"`,
`stage: "ship"`, then `run_status` with `status: "done"` (or
`"abandoned"` when the gate said so).

{{include:run-identity}}

## 1. Establish the target, then the ship gate

Current branch (`git branch --show-current`); refuse the default branch.

When the run is yours, record `branch` per Run identity above.

Then gate `ship`, before anything is pushed:

- `run_field_set` with `key: "gate"`, `value: "ship"`, `stage: "ship"`.
- One sentence: the branch, the commits about to go (`git log --oneline
  @{upstream}.. 2>/dev/null || git log --oneline -5`), and whether the
  tree is dirty (`git status --porcelain`).
- Run gate-protocol's Runs integration with kind `ship` and these
  questions, each its own question (never fold one list into another --
  a question over 4 options sends the whole gate to the wait queue):
  - `dirty`, only on a dirty tree: **Commit the changes** / **Stash
    them** / **Abort**
  - `open_as`: **Push and open as draft** (recommended) / **Push and
    open ready**
  - every question the domain rules below declare for this gate
  - `next`: **Proceed** (recommended) / **Iterate here** / **Hold**
- `run_decision` with `contract: "gate@1"`, `scope: "ship"`, `selection: {"dirty":"commit|stash|abort|null","open_as":"draft|ready","domain":{<answers>}}`, `decidedBy: <the answer's by>`.
- Abort or Hold: nothing is pushed. Abort, when `## Run` started this run:
  `run_stage` with `action: "done"`, `stage: "ship"`, then `run_status`
  with `status: "abandoned"`.

## Domain rules

{{slot:domain}}

When nothing is inlined above, follow the generic path below.

## 2. Ship

**Domain rules above:** follow them for the shipping flow.

**Generic path:** the forge is read from the origin remote (`git remote
get-url origin`): a GitLab host means rt's MR tools (`mr_create`,
`mr_ready`), a GitHub host means `gh`, anything else is a `clarify` gate.
Push with the `git_push` tool (`tree` = the worktree root, the absolute
path `git rev-parse --show-toplevel` prints; `setUpstream: true`). An
error starting `tree must be the absolute path of the root` fires for a
subdirectory as well as for a repo not registered with rt: retry once with
that root, and only when the root is refused too, push with plain git on
Bash instead (`git push -u origin <branch>`). <!-- mcp-lint: allow -->
Then create the MR/PR against the
repo's default branch (`git symbolic-ref --short refs/remotes/origin/HEAD`,
minus `origin/`): on GitLab the `mr_create` tool (`draft: false` only when
the gate said ready; write the title from the branch's commits), on GitHub
`gh pr create --fill --draft` (drop the draft flag when the gate said
ready). Print the URL.

Either path, when the run is yours: record `mr` (the created MR/PR URL)
per Run identity above.

## 3. Mark ready (standalone path)

When the domain flow above ran CI to green (its inherited watch-ci hands
back with the verdict; it fires no gate beyond `ci`), and the MR is a
draft: gate `mark-ready`.

- `run_field_set` with `key: "gate"`, `value: "mark-ready"`, `stage: "ship"`.
- One sentence: CI is green; evidence is attached (or is not).
- Run gate-protocol's Runs integration with kind `mark-ready` and these
  questions, each its own question (never fold one list into another --
  a question over 4 options sends the whole gate to the wait queue):
  - `ready`: **Mark ready now** (recommended when `ci` is green and
    evidence is set) / **Keep it draft**
  - `next`: **Proceed** (recommended) / **Iterate here** / **Go back** /
    **Hold**
  - `to`, only when **Go back** is answered and `run_snapshot` shows
    more than one earlier stage row: one option per earlier stage, split
    `to-1`, `to-2`, ... over 4; with exactly one candidate stage label
    it **Go back to `<stage>`** in `next` and skip this question
- `run_decision` with `contract: "gate@1"`, `scope: "mark-ready"`, `selection: {"ready":true|false,"next":"proceed|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}`, `decidedBy: <the answer's by>`.
- Go back (inherited run only): hand control back to the caller with one
  sentence naming the answer.
- Yes: the `mr_ready` tool on GitLab, `gh pr ready <number>` on GitHub,
  per the forge-host rule above.

Close, only when `## Run` started this run: after the mark-ready answer is
acted on (or the gate said keep it draft), or on the generic path after the
URL is printed, `run_stage` with `action: "done"`, `stage: "ship"`, then
`run_status` with `status: "done"`. Abort at the ship gate closes with
`status: "abandoned"` instead (section 1).

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
