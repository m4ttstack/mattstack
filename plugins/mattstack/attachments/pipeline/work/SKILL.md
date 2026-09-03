---
name: work
disable-model-invocation: true
description: "Use when running a unit of work through a configured pipeline -- 'run the feature pipeline', 'do this ticket end to end', 'start a unit of work', or when a repo's .mattstack/skills.jsonc defines pipelines and a ticket or task should flow through its stages."
allowed-tools:
  - Bash(rt runs:*)
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

```bash
PACK_DIRS="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd -P)"
```

`PACK_DIRS` is the pack root by the compiler's layout; `run-start` records
the pack's commit and dirty state only when that directory is a git
checkout (an installed plugin cache is not), so absent provenance there is
expected.

Then run `run-start` with the flags for the chosen work type, adding
`--ticket <id>` when the request named one and `--spawned-by "<surface>"`
when this run was spawned rather than started interactively. Never
fabricate a ticket.

{{run-start.flags}}

The response must parse as JSON with `ok: true` and a `runDb`. Anything
else (a listing of runs, usage text) means this rt predates the run DB
write verbs: stop, and tell the user to update rt before continuing. Do
not proceed without a `runDb`.

```bash
rt runs run-start <flags for the work type> --pack-dirs "$PACK_DIRS" [--ticket <id>] [--spawned-by "<surface>"]
export RT_RUN_DB=<runDb from the response>   # each tool call is a fresh shell: prefix every rt runs command with RT_RUN_DB=<runDb>
```

Back-fill any spawn-time decision made before the DB existed (account
selection per `account-pool@1`): `rt runs decision record
--contract account-pool@1 --scope run --selection '<JSON>' --decided-by
<spawning surface>`.

## 4. Walk the stages

For each entry, in order:

1. `rt runs stage-start --stage <stage>`
2. Read `<dir>/SKILL.md` and follow it. It carries its own domain rules
   inline and states what it consumes and produces.
3. When it finishes, `rt runs snapshot` and confirm every
   field in the entry's `produces` is non-null and not `-` (the cleared
   sentinel a redirect writes). A missing or cleared field means the stage
   did not finish: `stage-fail --stage <stage> --reason "<what>"`, then the
   failure gate below.
4. `rt runs stage-done --stage <stage>`

After the last entry, `## Close`.

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

## Resume

Re-entering existing work with no `RT_RUN_DB` set: list
`~/.mattstack/runs/<repo>/` (the `--repo` value above) for the newest run
whose status is `running` -- use `rt runs snapshot` with
`RT_RUN_DB` pointed at each candidate, never raw sqlite. One found: gate
`clarify`, one sentence naming it, the structured-question tool with
**Resume it** (recommended) / **Start fresh**; **Hold**. Start fresh: `## 3.
Start the run`; the found run keeps its status. Resume: re-export
`RT_RUN_DB` (each tool call is a fresh shell, so prefix every `rt runs`
command with it) and re-enter at
`run.current_stage` with the snapshot's fields and decisions (a fresh
`stage-start` for that stage records the new attempt). Do not re-ask
decided questions. Re-entering a held run clears the hold as `## Hold`
says.

## Redirect

A gate answer or a human message that names an earlier stage sends the
run back there. A stage that hands back such an answer (the ci gate's
*Fix and re-push*) has not finished, and its produces are not checked:
Redirect runs instead of step 3's completeness check, and no `stage-fail`
is written for it. In order:

1. `rt runs decision record --contract gate@1 --scope redirect:<from>:<attempt> --selection '{"from":"<current stage>","to":"<stage>","reason":"<their words>"}' --decided-by work`
   (the attempt is the current stage row's; the reason is what they said,
   never a category).
2. `rt runs stage-redirect --stage <from> --to <to> --reason "<their
   words>"`: the stage you leave closes as `redirected`, so `snapshot`
   never shows it `running` behind a later attempt. Exit 3 means that row
   was not running; say so in one line and continue.
3. For `<to>` and every stage after it in the list, `rt runs field set
   <key> - --stage <to>` for each key in that stage's `produces`: the
   cleared sentinel keeps the completeness check honest on the re-run.
4. `rt runs stage-start --stage <to>` (the DB bumps the attempt), then walk
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

`failed` and `abandoned` are written by the failure gate's or the ci
gate's Abandon answer or by a human saying so; never leave a finished run `running`, and never
leave `RT_RUN_DB` pointing at a finished run: the next verb in this shell
would `stage-start` into it.

## Sub-agent tiering

{{slot:tiering}}

## Wrap-up form contract

{{include:wrap-up-form}}

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
- About to describe each option under a form, or ask "which would you
  like?" after it? Stop. The one sentence sits above the form; the options
  are labels, nothing more.
