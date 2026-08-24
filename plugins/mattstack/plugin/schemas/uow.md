# uow.json -- the unit-of-work record

One record per unit of work at `~/.mattstack/work/<work-id>/uow.json`.
`<work-id>` is the lowercased ticket id when one exists, else
`<repo-basename>-<YYYYMMDD-HHMMSS>`. Machine schema: `uow.schema.json`
(draft-07, documentation-grade like the manifest schema; the runnable gate
is jq-structural).

## Field vocabulary

The tokens legal in `stage-consumes` / `stage-produces` are exactly the
record's property names: `work-type`, `ticket`, `repo`, `mode`, `branch`,
`worktree`, `approach`, `evidence-plan`, `evidence`, `commits`, `review`,
`mr`, `ci`. Domain packs put anything else under `extra` (never a chain
token in v1).

## Lifecycle

1. The orchestrator seeds the record (`version`, `work-type`, `ticket`,
   `repo`, `mode`, empty `stages`) after resolve-pipeline exits 0.
2. Before executing a stage it sets `stages["<stage>"] = "running"`.
3. The stage does its work, writes its produced fields, and the
   orchestrator sets `done` (or `failed` and stops).
4. Resume = re-run resolve-pipeline, read the record, continue at the
   first stage not `done`. The record is the recovery state; never
   reconstruct it from conversation memory.

## jq-structural gate

    jq -e '(.version == 1) and (."work-type" | type == "string")
      and (.repo | type == "string")
      and (.stages | type == "object")' ~/.mattstack/work/<id>/uow.json
