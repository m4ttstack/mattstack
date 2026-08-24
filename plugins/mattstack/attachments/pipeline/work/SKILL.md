---
name: work
disable-model-invocation: true
description: "Use when running a unit of work through a configured pipeline -- 'run the feature pipeline', 'do this ticket end to end', 'start a unit of work', or when a repo's .mattstack/skills.jsonc defines pipelines and a ticket or task should flow through its stages."
allowed-tools:
  - Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-pipeline.sh:*)
  - Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
  - Bash(${CLAUDE_SKILL_DIR}/scripts/pipeline-state.sh:*)
type: pipeline-step
slots:
  tiering: { contract: model-tiering@1, required: false }
metadata:
  slots: "tiering"
  slot-tiering: "optional model-tiering@1 -- given a unit of work, names the least capable model tier and effort that can succeed at it; used when dispatching sub-agents during stages"
---

# work -- the do-a-unit-of-work orchestrator

You run one unit of work through the pipeline the consumer's manifest
defines for its work type. You are domain-free: every domain behavior
arrives through the stage skills and their bindings. You never guess a
stage, a binding, or a chain -- the scripts decide.

## 1. Determine the work type

From the user's request or brief (feature, bugfix, review, ...). When only
one pipeline exists in the manifest, use it and say so. When several could
apply, ask one structured question.

## 2. Resolve the pipeline

```bash
"${CLAUDE_SKILL_DIR}/scripts/resolve-pipeline.sh" --work-type <type>
```

On nonzero exit: print the `errors` array verbatim and stop. Do not
improvise a pipeline, reorder stages, or substitute bindings.

On success, print one provenance line before continuing: the pipeline
(`workType`), the `manifest` path the resolution used, and each stage's
domain binding (`pipeline[].slots.domain.binding`) or `generic` when that
stage has no domain slot or it is unbound. This is the resolution's
record, not a guess -- read it from the resolver's own output, never
reconstruct it from memory.

In a compiled skill (see the header comment), bindings are already resolved
-- do not run resolve-args.sh. resolve-pipeline.sh is not resolution -- it
must still run.

On exit 0, also resolve your own slots:

```bash
"${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"
```

If `resolved.tiering.binding` is non-null, read the SKILL.md at
`resolved.tiering.path` now; apply it whenever a stage dispatches
sub-agents. An unbound tiering slot means sub-agents inherit your model.

## Run state

Every pipeline run records durable state in a run-scoped SQLite DB. You (the
orchestrator) own run genesis and closure; stages report their own lifecycle.
The DB is the source of truth for stage status, fields, and decisions — the
conversation is the work medium, never the record.

**Genesis — immediately after the pipeline resolves:**

1. `export RT_PIPELINE_STATE="${CLAUDE_SKILL_DIR}/scripts/pipeline-state.sh"`
2. Collect the installed pack roots, then start the run. Recording which
   commit was installed is the only chance to make this run explainable later:
   the compiled text it followed lives in git, but only if the run wrote down
   which commit was in force while it ran.

   ```bash
   PACK_DIRS=""
   for p in "$CLAUDE_SKILL_DIR" $RESOLVED_FILL_PATHS; do
     r=$(git_root_of "$p") || continue
     case ":$PACK_DIRS:" in *":$r:"*) continue ;; esac
     PACK_DIRS="${PACK_DIRS:+$PACK_DIRS:}$r"
   done
   ```

   `git_root_of` starts at the argument itself when it is a directory and at its
   parent when it is a file, since `CLAUDE_SKILL_DIR` is a directory that may
   itself be the checkout root while the resolved paths are files:

   ```bash
   git_root_of() {
     if [ -d "$1" ]; then start="$1"; else start=$(dirname -- "$1"); fi
     d=$(CDPATH= cd -- "$start" 2>/dev/null && pwd) || return 1
     while [ "$d" != "/" ]; do
       [ -e "$d/.git" ] && { printf %s "$d"; return 0; }
       d=$(dirname "$d")
     done
     return 1
   }
   ```

   `RESOLVED_FILL_PATHS` is the space-separated list of `resolved.*.path`
   values you already read in the pipeline resolution step above.

   Then run `"$RT_PIPELINE_STATE" run-start --repo <registry repo name>
   --work-type <work-type> --pipeline <resolved pipeline name>
   ${PACK_DIRS:+--pack-dirs "$PACK_DIRS"}` (the manifest key, e.g. `mattstack-skills` -- never an absolute path) (add `--spawned-by "<surface>"`, e.g. `shepherdr job <name>`, when this run was spawned rather than interactive).
3. `export RT_RUN_DB=<runDb from the response>`.
4. Back-fill any spawn-time decisions made before the DB existed (account
   selection per `account-pool@1`): `"$RT_PIPELINE_STATE" decision record
   --contract account-pool@1 --scope run --selection '<JSON>' --decided-by
   <spawning surface>`.
5. When the invoker already named a ticket (e.g. "work ACME-1234"), write it
   now so the DB carries it before any stage runs: `"$RT_PIPELINE_STATE"
   field set ticket <ticket> --stage work`. No ticket named yet -- the
   provision stage may still find or create one -- skip this call; never
   write a fabricated value.

**Closure — when the pipeline ends:** `"$RT_PIPELINE_STATE" run-status
--status done` (or `failed` / `abandoned`). Never leave a finished run
`running`.

**Resume — when re-entering existing work with no `RT_RUN_DB` set:** list
`~/.mattstack/runs/<registry repo name>/` (the manifest key, never an
absolute path) for the newest run whose status is `running`
(`sqlite3 <dir>/state.db "SELECT status FROM runs;"` is NOT yours to run —
use `"$RT_PIPELINE_STATE" snapshot` with `RT_RUN_DB` pointed at the
candidate), confirm the match with the user, re-export `RT_RUN_DB`, and
re-enter at `run.current_stage` with the snapshot's fields and decisions —
do not re-ask decided questions.

## 3. Seed or recover the unit-of-work record

Work id: the lowercased ticket id when one exists, else
`<repo-basename>-<YYYYMMDD-HHMMSS>`. Record path:
`~/.mattstack/work/<work-id>/uow.json` (schema:
`plugin/schemas/uow.md` in the mattstack-skills repo).

- **New work:** `mkdir -p` the dir and write the seed record: `version` 1,
  `work-type`, `ticket` (or null), `repo` (absolute path), `mode`
  (`worker` when your brief says you are a dispatched worker with a
  prepared worktree, else `interactive`), `stages` {}.
- **Existing record for this work id:** this is a resume. Re-run
  resolve-pipeline (bindings may have changed), read the record, and
  continue at the first stage whose status is not `done`. Never
  reconstruct state from conversation memory; the record is the state.

## 4. Execute the stages in order

For each entry of `pipeline`, in order:

1. Set `stages["<stage>"] = "running"` in the record (edit the JSON).
2. Read the SKILL.md at the entry's `path` and follow it. Tell it, in your
   working notes, the absolute record path -- stages read and write that
   file. Pass the entry's `slots` object along mentally: the stage's own
   prose re-runs its resolver, which must agree; a disagreement means the
   environment changed mid-run -- stop and tell the user.
3. When the stage's prose completes, verify every field in the entry's
   `produces` is now non-null in the record. Missing field = the stage did
   not finish; set `failed`, report, and stop.
4. Set `stages["<stage>"] = "done"`.

A stage failure stops the pipeline. Report which stage, the record path,
and that a resume will continue from that stage.

## 5. Wrap up

When every stage is `done`: summarize the record (ticket, branch, mr, ci)
and leave the record file in place -- it is the audit trail.

## Red flags -- stop yourself

- About to run a stage the resolver did not list, or skip one it did? Stop.
- About to hand-write a chain fix because chain-broken "looks wrong"? Stop:
  fix the manifest or the stage declaration, then re-run the script.
- About to carry state in prose because editing JSON feels slow? Stop: the
  record survives compaction; your prose does not.
