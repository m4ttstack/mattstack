---
name: work
disable-model-invocation: true
description: "Use when running a unit of work through a configured pipeline -- 'run the feature pipeline', 'do this ticket end to end', 'start a unit of work', or when a repo's .mattstack/skills.jsonc defines pipelines and a ticket or task should flow through its stages."
allowed-tools:
  - Bash(${CLAUDE_SKILL_DIR}/scripts/pipeline-state.sh:*)
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
export RT_PIPELINE_STATE="${CLAUDE_SKILL_DIR}/scripts/pipeline-state.sh"
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

```bash
"$RT_PIPELINE_STATE" run-start <flags for the work type> --pack-dirs "$PACK_DIRS" [--ticket <id>] [--spawned-by "<surface>"]
export RT_RUN_DB=<runDb from the response>
```

Back-fill any spawn-time decision made before the DB existed (account
selection per `account-pool@1`): `"$RT_PIPELINE_STATE" decision record
--contract account-pool@1 --scope run --selection '<JSON>' --decided-by
<spawning surface>`.

## 4. Walk the stages

For each entry, in order:

1. `"$RT_PIPELINE_STATE" stage-start --stage <stage>`
2. Read `<dir>/SKILL.md` and follow it. It carries its own domain rules
   inline and states what it consumes and produces.
3. When it finishes, `"$RT_PIPELINE_STATE" snapshot` and confirm every
   field in the entry's `produces` is non-null. A missing field means the
   stage did not finish: `stage-fail --stage <stage> --reason "<what>"`,
   report, stop.
4. `"$RT_PIPELINE_STATE" stage-done --stage <stage>`

A stage failure stops the pipeline. Report which stage and that a resume
continues from it. The run itself stays `running`; only the Close
statuses end it.

## Resume

Re-entering existing work with no `RT_RUN_DB` set: list
`~/.mattstack/runs/<repo>/` (the `--repo` value above) for the newest run
whose status is `running` -- use `"$RT_PIPELINE_STATE" snapshot` with
`RT_RUN_DB` pointed at each candidate, never raw sqlite -- confirm the
match with the user, re-export `RT_RUN_DB`, and re-enter at
`run.current_stage` with the snapshot's fields and decisions (a fresh
`stage-start` for that stage records the new attempt). Do not re-ask
decided questions.

## Close

`"$RT_PIPELINE_STATE" run-status --status done` (or `failed` /
`abandoned`). Never leave a finished run `running`.

## Sub-agent tiering

{{slot:tiering}}

## Red flags -- stop yourself

- About to run a stage the list does not name, or skip one it does? Stop.
- About to carry state in prose because a `field set` feels slow? Stop:
  the DB survives compaction; your prose does not.
