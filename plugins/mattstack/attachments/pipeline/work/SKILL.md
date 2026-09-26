---
name: work
disable-model-invocation: true
description: "Use when running a unit of work through a configured pipeline -- 'run the feature pipeline', 'do this ticket end to end', 'start a unit of work', or when a repo's .mattstack/skills.jsonc defines pipelines and a ticket or task should flow through its stages."
allowed-tools:
  - Bash(git -C *:*)
type: pipeline-step
slots:
  tiering: { contract: model-tiering@1, required: false }
---

# work -- the do-a-unit-of-work orchestrator

You run one unit of work through the pipeline compiled into this skill.
Everything below the stage list is baked: you never resolve a stage, a
binding, or a chain -- the compiler already did.

## 1. Work type

{{work-type}}

## 2. Stages

Read the list for the chosen work type. Each entry is a compiled stage
skill sitting beside this one; `dir` is where to read it.

{{pipeline.stages}}

## 3. Start the run

Start the run with the `run_start` tool: `flags` is the chosen work type's
flag string from the block below, verbatim (the value, never its work-type
key); `skillDir` is this skill's own directory, `${CLAUDE_SKILL_DIR}`, as
an absolute path; add `ticket` when the request named one and `spawnedBy`
when this run was spawned rather than started interactively. Never
fabricate a ticket.

{{run-start.flags}}

The result must carry `ok: true` and a `runDb`. A tool error: stop and
report its message. No `run_start` tool available at all: this rt is too
old; stop and tell the user to update rt. Keep
`runDb` and pass it to every `run_*` call below; nothing is exported.
`runDb` is the one value to carry forward when summarising; if it is gone
mid-run, recover it through `## Resume` (the running run in this repo)
rather than treating the request as new work.

When the run carries a ticket, update its tracker now as the opening act:
set it In Progress and ensure it is assigned to the operating user (for
Linear, `save_issue` with state In Progress and assignee `me`).

Back-fill any spawn-time decision made before the DB existed (account
selection per `account-pool@1`): `run_decision` with
`contract: "account-pool@1"`, `scope: "run"`, `selection` = the decision
as an object, `decidedBy` = the spawning surface.

## 4. Walk the stages

Each stage receives `runDb` and passes it on every `run_*` call it makes.
For each entry, in order:

1. `run_stage` with `action: "start"`, `stage: "<stage>"`
2. Read `<dir>/SKILL.md` and follow it. It carries its own domain rules
   inline and states what it consumes and produces.
3. When it finishes, `run_snapshot` and confirm every
   field in the entry's `produces` is non-null and not `-` (the cleared
   sentinel a redirect writes). A missing or cleared field means the stage
   did not finish: `run_stage` with `action: "fail"`, `stage: "<stage>"`,
   `reason: "<what>"`, then the failure gate below.
4. `run_stage` with `action: "done"`, `stage: "<stage>"`

After the last entry, `## Close`.

A stage failure is a gate, not a report. Gate `<stage>-failed:<attempt>`
(the attempt from the failed stage row in `run_snapshot`):

- `run_field_set` with `key: "gate"`, `value: "<stage>-failed:<attempt>"`, `stage: "<stage>"`
- One sentence: the stage, the reason the failed `run_stage` recorded,
  and the detail path if there is one.
- Run gate-protocol's Runs integration with kind `<stage>-failed:<attempt>`
  and these questions, each its own question (never fold one list into
  another -- a question over 4 options sends the whole gate to the wait
  queue):
  - `action`: **Retry the stage** (recommended when the reason names
    something you can fix) / **Abandon the run**
  - `next`: **Proceed** (recommended) / **Iterate here** (their text is
    what to change first) / **Go back** / **Hold**
  - `to`, only when **Go back** is answered and more than one earlier
    stage row exists: one option per earlier stage, split `to-1`,
    `to-2`, ... over 4; with exactly one candidate stage label it **Go
    back to `<stage>`** in `next` and skip this question
- `run_decision` with `contract: "gate@1"`, `scope: "<stage>-failed:<attempt>"`, `selection: {"next":"retry|redirect|iterate|hold|abandon","to":"<stage or null>","note":"<their words or null>"}`, `decidedBy: <the answer's by>`
- Retry: a fresh `run_stage` start for the stage (a new attempt) and
  re-enter it. Go back: `## Redirect`. Iterate: `## Redirect` to the same
  stage with their note as the reason. Hold: `## Hold`. Abandon:
  `run_status` with `status: "abandoned"`.

The run itself stays `running` through every answer but Abandon; only the
Close statuses end it.

## Resume

Re-entering existing work with no `runDb` in context: call `run_list`
with `repo` = the `--repo` value in the flags above, and keep the newest
run whose `status` is `running`; never read the run dbs by hand. One
found: gate `clarify`, one sentence naming it, the structured-question
tool with **Resume it** (recommended) / **Start fresh**; **Hold**. Start
fresh: `## 3. Start the run`; the found run keeps its status. Resume: use
`runDb` = `<absolute home>/.mattstack/runs/<repo>/<its id>/state.db` (the
candidate row's `id`; the run tools refuse `~` and relative paths). If a
run tool refuses it with an error naming a different runs root, use that
root instead. Re-enter at
`run.current_stage` with `run_snapshot`'s fields and decisions (a fresh
`run_stage` start for that stage records the new attempt). Do not re-ask
decided questions. Re-entering a held run clears the hold as `## Hold`
says.

## Redirect

A gate answer or a human message that names an earlier stage sends the
run back there. A stage that hands back such an answer (the ci gate's
*Fix and re-push*) has not finished, and its produces are not checked:
Redirect runs instead of step 3's completeness check, and no failed
`run_stage` is written for it. In order:

1. `run_decision` with `contract: "gate@1"`, `scope: "redirect:<from>:<attempt>"`, `selection: {"from":"<current stage>","to":"<stage>","reason":"<their words>"}`, `decidedBy: <the answer's by>`
   (the attempt is the current stage row's; the reason is what they said,
   never a category). A human-typed redirect with no open gate has no
   answer to cite: record `decidedBy: "pane"`.
2. `run_stage` with `action: "redirect"`, `stage: "<from>"`, `to: "<to>"`,
   `reason: "<their words>"`: the stage you leave closes as `redirected`,
   so `run_snapshot` never shows it `running` behind a later attempt. An
   error saying that row was not running: say so in one line and
   continue.
3. For `<to>` and every stage after it in the list, `run_field_set` with
   `key` = each key in that stage's `produces`, `value: "-"`,
   `stage: "<to>"`: the cleared sentinel keeps the completeness check
   honest on the re-run.
4. `run_stage` with `action: "start"`, `stage: "<to>"` (the DB bumps the
   attempt), then walk forward from `<to>` exactly as in section 4. Later
   stages re-run as new attempts; a ship stage re-run pushes new commits
   to the same MR.

## Hold

A gate answer of *Hold* parks the run without ending it:

1. `run_decision` with `contract: "gate@1"`, `scope: "hold:<stage>:<attempt>"`, `selection: {"reason":"<their words or empty>"}`, `decidedBy: <the answer's by>`
2. `run_field_set` with `key: "hold"`, `value: "<their words, or held>"`, `stage: "<stage>"`
3. End the turn with one sentence naming the run and the stage. The Stop
   hook lets a held run's turn end; the console shows it held.

Resume clears the hold: right after the next `run_stage` start,
`run_field_set` with `key: "hold"`, `value: "-"`, `stage: "<stage>"`.

## Close

The run stays `running` until the human answers the close gate; a green
`ci` does not end it, the answer does. Gate `close`:

- `run_field_set` with `key: "gate"`, `value: "close"`, `stage: "<last stage>"`
- One sentence: the MR link and its state (draft, or ready as decided at
  the `mark-ready` gate) and the `ci` verdict.
- Run gate-protocol's Runs integration with kind `close` and these
  questions, each its own question (never fold one list into another --
  a question over 4 options sends the whole gate to the wait queue):
  - `next`: **Done** (recommended when `ci` is green and the MR is
    ready) / **Iterate here** (their text is the change request) / **Go
    back** / **Hold**
  - `to`, only when **Go back** is answered and `run_snapshot` shows more
    than one stage row: one option per stage, split `to-1`, `to-2`, ...
    over 4; with exactly one candidate stage label it **Go back to
    `<stage>`** in `next` and skip this question
- `run_decision` with `contract: "gate@1"`, `scope: "close"`, `selection: {"next":"done|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}`, `decidedBy: <the answer's by>`
- Done: `run_status` with `status: "done"`.
  Iterate: `## Redirect` to `implement` (or the stage their note names)
  with the note as the reason. Go back: `## Redirect`. Hold: `## Hold`.

`failed` and `abandoned` are written by the failure gate's or the ci
gate's Abandon answer or by a human saying so; never leave a finished run
`running`, and never carry a finished run's `runDb` into new work: a
later `run_stage` start would write into it.

## Sub-agent tiering

{{slot:tiering}}

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}

## Red flags -- stop yourself

- About to run a stage the list does not name, or skip one it does? Stop.
- About to carry state in prose because a `run_field_set` feels slow?
  Stop: the DB survives compaction; your prose does not.
- About to end the turn with the run still `running` and no form on
  screen? Stop. The gate is the form; the Stop hook will send you back.
- About to write "pipeline complete" after `ci=green`? Stop. Complete is
  the human's answer at the close gate.
- About to go back a stage because the human typed it, without a
  `redirect` decision? Stop. Record it, then a `run_stage` start.
- About to describe each option under a form, or ask "which would you
  like?" after it? Stop. The one sentence sits above the form; the options
  are labels, nothing more.
