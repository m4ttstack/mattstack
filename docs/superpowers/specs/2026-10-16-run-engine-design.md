# Run engine: run lifecycle, loop budgets and a pipeline manifest behind rt's MCP server

## Why

Pipeline skills draw run bookkeeping as dot graphs: start or resume, check a
stage's produces, write done or fail, find the next stage, apply a retry or a
go back, clear stale produces and `shipTarget`, record a hold, count retries.
That is code written in English. Agents pay for it on every run and drift
from it: a skipped `shipTarget` clear reuses an old ship consent for an
outward push, a skipped produce clear lets the completeness check pass on
stale values, a repeated `run_stage start` can leave two rows running, a
retry counter held in prose resets on compaction, and a hand-built
`<attempt>` in a decision scope silently overwrites an earlier decision.

This wave moves those mechanics into rt: six MCP tools over the run DB, a
supersede rule in `run_stage start`, and a compiler that emits each pack's pipeline
manifest and checks its field contract at compile time. Wave 3 shrinks the
skills to call these tools; this wave edits no skill.

## Goals

- `run_enter`: start or resume one entry point (the `work` orchestrator or a
  standalone verb such as `ship`) in one call.
- `run_next`: after a stage returns, check its declared produces, write done
  or fail, and return the next stage (started) or how the stage ended.
- `run_resolve`: apply a retry, go back, iterate, hold, abandon or done
  answer, clearing stale produces and `shipTarget` on every redirect.
- `run_hold`, `run_close`: the hold pair and a standalone verb's exit, with
  attempts computed.
- `run_stage start` on a stage whose latest row is still running ends that
  row as redirected and starts the next attempt, so no stage ever has two
  rows running; the engine itself still refuses to start over a running row.
- `run_budget`: persisted per-run loop counters that survive compaction and
  resume.
- `rt skills compile` writes `pack/pipelines.json` (stages, consumes,
  produces, file) that the run engine reads, and warns about a pack whose
  skills read a run field nothing in the pack writes.

## Non-goals

- No skill edits under `plugins/mattstack` (wave 3). The only plugin files
  this PR touches are the generated `attachments/mcp-tools/reference.md` and
  the `.claude-plugin/plugin.json` version line, both required by the
  `plugin-mattstack` CI job whenever `lib/mcp` changes.
- No CLI verbs for the new operations. They are MCP tools only; the existing
  `rt runs` write verbs stay as they are.
- No gate tools. `gate_ask`/`gate_answer` and the `gate`/`waiting-gate`
  fields belong to the gate-tools lane.
- No change to `lib/state` (the global state DB). The run DB is the per-run
  `state.db` under the runs root, versioned by `KNOWN_SCHEMA_VERSION` in
  `lib/runs/write.ts`.

## Anti-goals

- **A tool that opens a gate or acts on a spent budget.** Tools return
  results; skills own gates. A failed stage, a spent budget or a refusal
  comes back as data and the skill's graph routes it.
- **A tool that picks an answer.** `run_resolve` applies the answer a human
  gave; it never chooses between options.
- **Breaking the field contract the stop hook and console read.** Keys stay
  `hold`, `waiting-gate`, `gate`, `pipeline-stages`, `shipTarget`; their
  `at` column stays the write time; decision scopes stay `hold:<stage>:<n>`
  and `redirect:<from>:<n>` with the same selection shapes.
- **Reading the pack at every step.** The manifest is copied into the run DB
  at start, so a recompile mid-run cannot change a running pipeline.

## Constraints

- `.claude/rules/mcp-and-gates.md`: every tool on the server is an
  unprompted grant on every estate machine. The new tools only touch run DBs
  under the runs root (`checkRunDb` confinement, unchanged) and read
  `<pack>/pack/pipelines.json` under a validated pack root (the same
  `skillDir` check `run_start` does). Every result still passes through
  `callTool` redaction.
- Every tool is stateless over the run DB: the MCP server is per session and
  runs resume across sessions and compactions.
- Multi-row writes run in one SQLite transaction.
- Field contract (from the hook and console readers):
  - `pipeline-gate-stop.sh` treats a run as held when `hold` or
    `waiting-gate` is set (not `''`/`-`) with `at` strictly after the latest
    stage `started_at`.
  - The console treats `''`/`-` as cleared, closes a hold span at the
    `hold` field's clear time or the next attempt's start, reads
    `hold:<stage>:<n>` selections as `{reason}` and `redirect:<stage>:<n>`
    as `{from,to,reason}`, and splits `pipeline-stages` on whitespace.
- Agreed with gate-tools (chat, 2026-10-16): the engine never writes `gate`
  or `waiting-gate`; gate-tools never writes `hold`, stage rows, run status
  or `pipeline-stages`. The gate's own decision (`<stage>-failed:<n>`,
  `close`, site scopes) is recorded by the gate path, not by `run_resolve`.
- `bun run purity` before every push; the PR body carries no employer names,
  slugs or ticket ids.

## Decided with the operator (gate a1dcb967, 2026-10-16)

1. Regenerate `reference.md` and bump the mattstack plugin version in this
   PR (generated file and version line only).
2. Wiring edits in `commands/skills.ts` are allowed (write
   `pack/pipelines.json` beside `pack/requires.json`, its drift check in
   `skills check`, the pack-wide field-contract check beside the chain
   check), plus tests in `commands/__tests__/skills.test.ts`. The logic lives
   in `lib/skills`.
3. The field-contract check is an **error** in `rt skills compile` and
   `rt skills check`. A pack with an unwritten `extra.plan-verdict` read fails
   to compile until wave 3 fixes that read, so that fix must ship with or
   before the rt that carries this.
4. `run_stage start` **refuses** a second start on a running stage.
   `run_enter`'s resume adopts the running attempt instead. Until wave 3
   moves skills to `run_enter`, today's resume paths (a held `work` stage, a
   standalone ship/watch-ci/review resume) get the refusal and stop.

## Revised by the operator (2026-10-16)

Items 3 and 4 above are superseded, and both revisions are temporary:

1. `run_stage start` (the `stage-start` write verb and `rt runs stage-start`)
   **supersedes** a running latest attempt instead of refusing: in one
   transaction it ends that attempt `redirected` with reason `superseded by
   attempt <n+1>` and inserts attempt n+1 running. The same transaction records a `gate@1`
   decision `redirect:<stage>:<n>` (`decided_by` `run_stage`) with selection
   `{from: <stage>, to: <stage>, reason: "superseded by attempt <n+1>"}`.
   `nextStage`, `resolveStage` and `enterRun` still never supersede; they call
   `stageStart` with `onRunning: "refuse"`. The refusal returns to the
   `run_stage` path in wave 3, by changing the one `onRunning` value
   `stage-start` passes in `commands/runs-write.ts` back to `"refuse"`.
2. The field-contract check **warns** and never fails: compile still writes
   and check sets neither drift nor an exit code, even under `--strict`. The
   lines ride in a `fieldContract: string[]` key of the `--json` output of
   both verbs and show as a warning in the human output. It becomes an error
   again once the pack fix merges, by flipping the one constant
   `FIELD_CONTRACT_SEVERITY` in `lib/skills/field-contract.ts` from `"warn"`
   to `"error"`; the error routing is already tested.
   The warnings surface in `rt skills compile` and `rt skills check`;
   `rt skills sync` does not show them while the severity is `warn`.

Both revisions ended on 2026-10-18, once every caller had moved onto the
new tools: `run_stage start` on a running stage refuses like the engine
paths (the `onRunning` option is gone), and
`FIELD_CONTRACT_SEVERITY` is `"error"`. Under `"error"`, `rt skills compile
--json` still lists the lines under `fieldContract` (its envelope has no
failures key), beside `written: false` and exit 1.

## Design

### Run DB schema v3

`KNOWN_SCHEMA_VERSION` goes 2 → 3 (the per-run DB, not `lib/state`). Two
tables, both created by `createRunDb` and by `migrate` with
`CREATE TABLE IF NOT EXISTS` before the version is stamped:

```sql
CREATE TABLE IF NOT EXISTS manifest (
  run_id TEXT NOT NULL REFERENCES runs(id), ordinal INTEGER NOT NULL,
  stage TEXT NOT NULL, name TEXT, file TEXT, pack_root TEXT,
  consumes TEXT NOT NULL, produces TEXT NOT NULL,   -- JSON string arrays
  PRIMARY KEY (run_id, ordinal));
CREATE TABLE IF NOT EXISTS budgets (
  run_id TEXT NOT NULL REFERENCES runs(id), key TEXT NOT NULL,
  spent INTEGER NOT NULL, "limit" INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, key));
```

`file` is the stage's compiled `SKILL.md` relative to the pack root, and
`pack_root` the absolute pack root of the call that wrote the row; a
position's `file` is the two joined. Both are null for a single-stage run
(the verb is its own stage). *My call:* installed packs live under a
versioned plugin cache folder, so a plugin update while a run is held moves
the files; `run_enter`'s resume rewrites `pack_root` to the resuming caller's
pack root. The stage list itself never changes after start. `snapshot` gains `manifest` and `budgets` arrays (empty when the
tables have no rows). An older rt reading a v3 DB already reports
`schemaAhead`; an older rt writing one is unaffected (the new tables are
additive).

### `run_stage start` on a running stage

`stageStart(db, name, env, now)` inserts only when the stage's latest row
is not `running`, in the same statement (`INSERT ... SELECT ... WHERE NOT
EXISTS`), so a concurrent start cannot slip between check and write. A
running latest row returns code 2 with: `stage <name> attempt <n> is still
running; resume it with run_enter, end it with run_next, or start its next
attempt with run_resolve (next: iterate)`, and nothing is written. Every
caller gets this, the MCP `run_stage` tool and `rt runs stage-start`
included; the `onRunning: "supersede"` option the revision above added was
deleted on 2026-10-18 with its last caller.

### The position object

Every engine result that leaves the run at a stage carries:

```ts
type Position = { stage: string; attempt: number; status: "running" | "done" | "failed" | "redirected"; file: string | null };
```

### `run_enter`

Input: `{flags, skillDir, stage?, pipeline?, runDb?, resume?, fresh?, ticket?, spawnedBy?}`.
`flags` and `skillDir` are validated exactly as `run_start` validates them
(plain flag tokens, the allowed flag set, a pack root with a plugin
manifest). `--repo` and `--work-type` come from `flags`.

Precedence:

1. **Inherited.** `runDb` given, confined, and its run is `running`: return
   `{mode: "inherited", runDb, runId, at}` where `at` is the run's
   `current_stage` and its latest row. Writes nothing. A handed runDb whose
   run is not running is ignored and the call continues (the result carries
   `handedRunDb: "not-running"`).
2. **Resume.** `resume` names a run id: the runDb is
   `<runs root>/<repo>/<id>/state.db` (the server's own runs root, so no
   root switching). Refused when the DB is missing, the run is not
   `running`, or its `work_type` differs from the flags' `--work-type`.
   Then, in one transaction:
   - record identity (`claude-session`, `herdr-pane`) and clear `hold` to `-`
     when it is set;
   - when the run has no manifest rows (started by an older rt, by
     `run_start`, or a start that crashed before writing them), backfill
     them from this caller's pack exactly as a start would (`stage`, else
     `pipelines.json`), and refuse ("this run's stages do not match the
     pack's pipeline; start fresh") when a stage the run has rows for is
     not in it;
   - otherwise rewrite the rows' `pack_root` to this caller's pack root;
   - when `current_stage` is null (a start that crashed before its first
     stage), start the first manifest stage.
   The latest row is adopted, never restarted: a running attempt continues
   at the same attempt number, so decisions keyed by that attempt stay
   decided. Returns `{mode: "resumed", runDb, runId, at, clearedHold}`. A
   `failed` or `done` latest row is returned as is: the skill reopens its
   failure gate or close gate. Adopting also registers the session with the
   daemon (`adoptRunSession`), best effort.
3. **Start.** `fresh: true` or `spawnedBy` given: start a new run.
4. **Candidates.** Otherwise scan `<runs root>/<repo>/*/state.db` for
   `running` runs with the same `work_type`. None: start a new run. Some:
   return `{mode: "candidates", candidates: [{runId, runDb, startedAt,
   spawnedBy, currentStage, ownSession}]}`, newest first, where
   `ownSession` is true when the run's `claude-session` is this server's
   `CLAUDE_CODE_SESSION_ID`. The skill asks its clarify gate and calls again
   with `resume` or `fresh`.

Starting a new run: `runStart` as today (provenance, ticket, identity), then
the manifest, then the first stage, in one call:

- `stage` given: a single-stage manifest `[{stage}]` (standalone verbs).
- Otherwise read `<pack root>/pack/pipelines.json` and pick the pipeline:
  the `pipeline` input when given; else the flags' `--pipeline` when it is
  a key of the file; else the only pipeline; else refuse, listing the keys.
  A missing file is refused too ("recompile the pack with this rt, or pass
  stage"). *My call:* the compiled `work` flags carry `--pipeline work`
  while the file's keys are the work types (`feature`), so the flag alone
  cannot pick; the input exists for a pack with several work types.
  `runs.pipeline` keeps the flag's value as today.
- Write the manifest rows and the `pipeline-stages` field (stage names joined
  by single spaces, `produced_by` = first stage), then start the first stage.

Returns `{mode: "started", runDb, runId, at, stages}`. `run_start` stays for
callers that have not moved.

### `run_next`

Input: `{runDb|cwd, stage}`. Called by the orchestrator when a stage's file
returns. In one transaction it reads how the stage ended and acts:

| Found | Writes | Returns |
|---|---|---|
| run not `running` | nothing | `{ended: "closed", status}` |
| latest row `failed` | nothing | `{ended: "failed", at, reason, detailPath, scope: "<stage>-failed:<n>", earlier}` |
| row `running`, `hold` set after its start | nothing | `{ended: "held", at, reason}` |
| row `running`, `waiting-gate` set after its start | nothing | `{ended: "waiting", at, gate}` |
| row `running`, a produce unset, `''` or `-` | `fail` with reason `missing produce: a, b` | `{ended: "failed", at, missing, scope, earlier}` |
| row `running`, every produce set, a later stage exists | `done`; start the next stage (clearing `hold` if set) | `{ended: "done", next: Position}` |
| row `running`, every produce set, last stage | `done` | `{ended: "done", last: true, stages, scope: "close"}` |
| row `done` and the next stage is the run's running `current_stage` | nothing | the `done` result again with `repeated: true` |

`earlier` lists the manifest stages before this one that have at least one
row (the failure gate's `to` candidates). `stages` is every manifest stage
(the close gate's). Any other mismatch (the stage is not `current_stage`, it
never started, its row is `redirected`) is refused with what the run is at.
A run with no manifest rows is refused by `run_next` and `run_resolve`
("this run has no pipeline manifest; resume it with run_enter to record
one"); `run_hold` and `run_budget` need no manifest.
`run_next` never opens a gate; the skill opens the failure or close gate
from the result.

### `run_resolve`

Input: `{runDb|cwd, stage, next, to?, note?, decidedBy}`; `next` is one of
`retry`, `redirect`, `iterate`, `hold`, `abandon`, `done` (the vocabulary
today's failure and close selections already use). `stage` is the gate's
stage. One transaction per call.

- **retry**: the stage's latest row must be `failed`. Clear the consent
  fields of that stage (below), start a new attempt. Returns
  `{applied: "retry", next: Position}`.
- **redirect / iterate**: `to` is required for redirect; iterate defaults
  `to` to `stage`. `to` must be a manifest stage at or before `stage`.
  1. Record `gate@1` `redirect:<stage>:<attempt>` with
     `{from: stage, to, reason: note ?? "redirected to <to>"}`, `decidedBy`.
  2. When the stage's row is still `running`, end it `redirected` with that
     reason (after a close or a failure gate the row is already done or
     failed, and the decision alone records the move).
  3. Set every produce of every manifest stage from `to` onward to `-`
     (`produced_by` = `to`).
  4. Clear the consent fields of every stage from `to` onward.
  5. Start `to`. Returns `{applied, next: Position, cleared: [keys]}`.
- **hold**: as `run_hold` with `reason: note`. Returns `{applied: "hold", held}`.
- **abandon**: end a still-running row `failed` (reason `note ?? "abandoned"`),
  set run status `abandoned`. Returns `{applied: "abandon", status}`.
- **done**: `stage` must be the last manifest stage with a `done` latest row;
  set run status `done`. Returns `{applied: "done", status}`.

Consent fields are fields a stage records that are not produces and must not
survive a re-run: `{ship: ["shipTarget"]}`, a constant in the engine. A
cleared consent field is set to `-` with `produced_by` = its stage.

`run_resolve` does not record the gate's own decision; the gate path did.

### `run_hold`

Input: `{runDb|cwd, stage, reason?, decidedBy}`. The stage must have a row;
the attempt is its latest. Records `gate@1` `hold:<stage>:<attempt>` with
`{reason: reason ?? "held"}`, then sets `hold` to the same text
(`produced_by` = stage). Returns `{held: true, at, scope}`. A hold at close
records against the last stage's row, which is what passing that stage does.

### `run_close`

Input: `{runDb|cwd, workType, stage, outcome, reason?, detailPath?}`;
`outcome` is `done`, `failed` or `abandoned`; `workType` is the closing
verb's own `--work-type` from its compiled flags. For a standalone verb's
own run. Refused when `workType` differs from the run's `work_type` ("this
run belongs to <work_type>; an inherited run closes nothing"), and when the
manifest has more than one stage ("a pipeline run closes through
run_resolve"). *My call:* the engine is stateless, so the work-type match
is what stops a verb that inherited a run (watch-ci inside ship's run, ship
inside a `work` run, an old run with no manifest) from closing it. Ends a
still-running row (`done`, or `failed` with the reason), then sets the run
status. Returns `{closed: true, status}`.

### `run_budget`

Input: `{runDb|cwd, key, limit, increment?, stage?}`. `key` is 1-200
characters with no control characters; `limit` an integer ≥ 1; `increment`
an integer ≥ 0, default 1 (0 reads). With `stage`, the stored key is
`<stage>:<latest attempt>:<key>`, so a new attempt starts at zero; without
it the counter spans the run. One upsert:
`INSERT ... ON CONFLICT DO UPDATE SET spent = spent + ?, "limit" = ? RETURNING spent`.
Returns `{key, spent, limit, remaining: max(0, limit - spent), exhausted:
spent >= limit}`. It counts past the limit and never refuses.

### Events and session adoption

Each engine write emits `run-updated` (as the write verbs do now) with a
`kind` naming the tool (`run-next`, `run-resolve`, ...), so the console
refreshes. `run_enter`'s start and resume adopt the session with the daemon,
best effort, as `run-start` and `stage-start` do.

### Where the code goes

- `lib/runs/engine.ts`: pure functions over an open `Database` (manifest,
  next, resolve, hold, close, budget, position). Tested against real temp
  DBs.
- `lib/runs/enter.ts`: `run_enter`'s start/resume/candidate logic over the
  runs root, using `runStart` and the manifest reader.
- `lib/runs/write.ts`: schema v3, the `stageStart` refusal, `snapshot`
  additions.
- `commands/runs-write.ts`: one structured entry point for the engine ops
  that resolves and opens the DB, runs the op, emits and adopts, reusing
  `withRunDbAsync`. No new CLI leaves.
- `lib/mcp/run-tools.ts`: the six tool definitions, reusing `runTarget`,
  `checkRunDb`, `splitFlags` and the pack-root check. They are spread into
  the roster by the existing `...runToolDefs()` in `lib/mcp/tools.ts`; the
  roster test's `NAMES` list gains them.
- `lib/skills/pipeline-manifest.ts`: render, parse and write
  `pack/pipelines.json`.
- `lib/skills/field-contract.ts`: scan and check.
- `commands/skills.ts`: the call sites only.

### `pack/pipelines.json`

```json
{
  "version": 1,
  "pipelines": {
    "feature": [
      { "stage": "provision", "name": "stage-provision", "file": "attachments/stage-provision/SKILL.md",
        "consumes": ["ticket", "repo"], "produces": ["branch", "worktree"] }
    ]
  }
}
```

Rendered from `resolved.stageEntries` (the pack's manifest pipelines, which
`skills.jsonc` declares), with `file` relative to the pack root and derived
from the entry's side and name. Written by `performCompile` beside
`pack/requires.json`, on a full compile only, and listed in the compile's
written files; removed when the pack declares no pipelines. `rt skills check`
reports it stale like the floor file: "pack/pipelines.json is out of date
with the pack's pipelines". A scoped compile (`--verb`) neither writes nor
checks it.

`run_enter` parses it strictly: unknown `version`, a non-array pipeline, a
stage without a string `stage`, or a `file` that is absolute or climbs out
of the pack root is refused.

### The field-contract check

`lib/skills/field-contract.ts` scans text for run field uses:

- reads: `run_field_get {... key: X ...}` and `rt runs field get X`;
- writes: `run_field_set {... key: X ...}` and `rt runs field set X`.

`X` is a literal key (`[A-Za-z][\w.-]*`). A key followed by `<` is a
template (`extra.context-dropped.<scope>`): a templated write registers a
prefix; a templated read is not checked.

On a full compile and in `rt skills check`, after every target compiled, it
scans every compiled Markdown file of the pack (`SKILL.md` and `.md` step
files). The pack's written keys are the union of:

- every stage's produces in every pipeline;
- every write found in the pack;
- keys rt writes itself: `work-type`, `ticket`, `repo`, `mode` (the run-start
  seed), `claude-session`, `herdr-pane`, `agent` (identity), `pipeline-stages`,
  `hold` (engine), `gate`, `waiting-gate` and the prefixes
  `extra.context-dropped.` and `extra.gate-source.` (gate tools).

Each read of a key outside that set is a finding, attributed through the
compiled file's `<!-- part: ... -->` markers to the source it came from:

`field contract: attachments/stage-gates/SKILL.md:88 (from acme:plan-gates attachments/plan-gates/SKILL.md:34) reads "extra.plan-verdict", which nothing in this pack writes`

Findings are routed by `routeFieldContract` according to
`FIELD_CONTRACT_SEVERITY`, which shipped as `"warn"` and is `"error"` since
2026-10-18. As warnings they never
change an exit code or block a write: `rt skills compile` writes as usual and
reports them under `fieldContract` in `--json` (always present, `[]` when
clean) and as a warning in the human output; `rt skills check` carries the
same `fieldContract` key and sets neither drift nor an exit code. Set to
`"error"`, they join compile `failures` (nothing is written, exit 1; `--json`
still lists them under `fieldContract`) and check `compileErrors` (check
exits 1). Both run only when every target compiled (a
failure elsewhere is reported first) and only on a full compile.

### MCP reference and plugin version

After the tools land, regenerate `plugins/mattstack/attachments/mcp-tools/reference.md`
(`bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts`)
and bump the patch version in `plugins/mattstack/.claude-plugin/plugin.json`.

## Verification

- Targeted `bun test` on every test file added or touched, from the worktree
  root, including `lib/mcp/__tests__/run-tools.test.ts` and
  `lib/mcp/__tests__/tools.test.ts`.
- `bun run check` and `bun run purity`.
- The field-contract check run read-only over the compiled sibling team
  and mattstack packs on this machine: any finding beyond the one known
  unwritten read is raised before shipping, since it would also break a
  pack's compile once the severity is flipped to `"error"`.
- `bun cli.ts skills compile --dry-run --pack-dir plugins/mattstack
  --mattstack-dir <temp>` still passes (CI runs it).

## Left to the builder

- Exact error wording beyond the strings quoted above, following
  `.claude/rules/output-layer.md` (the envelope's keys are frozen; its
  sentences read as plain copy).
- Test layout and fixtures; how much of `commands/runs-write.ts`'s
  `withRunDbAsync` to share.
- Whether the MCP handlers call the engine through a `RunToolDeps` seam
  (so `run-tools.test.ts` can fake it) plus one real-DB integration test, or
  real temp DBs throughout.
