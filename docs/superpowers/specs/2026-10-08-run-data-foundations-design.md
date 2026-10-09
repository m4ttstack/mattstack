# Run data foundations

Spec 0 of the console runs redesign. It changes no UI. It gives the three UI
specs that follow (run page and gate, run record, runs page) the data they
need, plus a tested layer of pure selectors to build them on.

The mocks live in pen.dev (`console work runs.pen`): Runs A (lanes) with B
(day timeline) as a toggle, Run A (story) with B's evidence viewer, and the
Record view for finished runs.

## Problem

The redesigned pages read data that rt either drops or never records:

- The decision log for a finished run needs every gate the run opened.
  `activeGatesForRun` hides answered gates once a run ends, `/api/gates`
  fetches every `run:` gate with no subject filter, and the gates sweep
  hard-deletes terminal rows past 7 days once the table passes 50,000
  terminal rows, while a run lives `rt.runsPruneDays` (30 by default).
- A gate carries no stage, so the UI cannot place a decision under the
  stage that asked it.
- The runs list payload has no stage end times, no attempt numbers, and no
  per-run decision or evidence counts, though the store reads all of it.
- `evidence` is a free-form field written by a skill prompt; the AFTER
  capture at ship is never recorded, and the console cannot show an image
  from disk.
- The derived facts the pages show (took the recommendation, time waiting
  on you, held time, how to render a field) have no implementation.

## Design

### A. Gates

1. **Exact filters.** `GatesStore.list` and the `gate:list` handler accept
   `subject` (exact match) and `status` (an array of `GateStatus`) beside the
   existing `subjectPrefix`, `open`, `kind`, `limit`, `cursor`. The console's
   `GET /api/gates` accepts `?subject=`; with it, the route returns that
   subject's gates in every status, all pages. Without it, the route behaves
   as today.
2. **Run gates live as long as their run.** The retention sweep
   (`sweepStmt`, `lib/daemon/gates-store.ts`) keeps a terminal `run:<id>`
   row for as long as a run directory named `<id>` exists under the runs
   root (any repo). Once `pruneRuns` (`lib/runs/prune.ts`) removes the run,
   the next sweep treats its gates like any other terminal row. The store
   takes the existence check as an injected `runExists(id)` so its tests
   need no filesystem. One mechanism, no new daemon verb, and nothing to
   retry when the daemon was down during a prune.
3. **Every run gate knows its stage.** When `gate:ask` (and `gate:open`)
   resolves the subject to `run:<id>`, the daemon reads that run's
   `current_stage` and stores it as `meta.stage`, unless the caller's `meta`
   already names one. No agent or skill change is needed. Gates opened
   before this change have no `meta.stage`; the console falls back to the
   stage whose `started_at`..`ended_at` window holds the gate's `openedAt`
   (see D).
4. **`overridden` is documented.** `GateAnswer.overridden` means "answered
   past the herd-owner guard"; the console sets it on every answer. A doc
   comment on the type says so. No behavior change.

### B. Runs list payload

In `lib/runs/store.ts` (`withAttention` and the cached path) and the
`RunSummary` type in `packages/rt-client`:

- Each entry of `stages` gains `ended_at` and `attempt`.
- `RunSummary` gains `decision_count` (rows in `decisions`) and
  `evidence_count` (image entries in a parsed `evidence@1` field, 0 when the
  field is absent or unparseable).

Gate counts are not added here: gates live in the daemon's gate store, which
the console already fetches whole for the runs page. An `outcome` field and a
merged-count source wait for the runs page spec.

### C. Evidence

1. **Shape `evidence@1`.** The `evidence` field holds JSON:

   ```json
   {
     "v": 1,
     "before": "<path>",
     "beforeAnnotated": "<path>",
     "after": "<path>",
     "afterAnnotated": "<path>",
     "transcript": "<path>",
     "case": "<free text>",
     "url": "<url>",
     "attach": "ship"
   }
   ```

   Only `v` and `before` are required. `stage-evidence`
   (`plugins/mattstack/attachments/pipeline/stage-evidence/SKILL.md`) writes
   this shape; the `{{slot:domain}}` contract (`evidence-domain@1`) names
   which keys a pack fills. `{plan: none}` stays the no-evidence value.
2. **Ship records the AFTER.** `stage-ship` reads the field with
   `run_field_get`, merges `after` and `afterAnnotated` when it captures
   them, and writes the merged object back with `run_field_set`. Both skill
   edits bump the plugin version and go through `writing-skills`.
3. **A tolerant parser.** The console's `parseEvidence(value)` returns
   `{version: 1, items, meta}` for `evidence@1`, and for anything else a
   `{version: 0, links}` list of every absolute path or URL it finds, so runs
   recorded before this change still show their files.
4. **Image route.** The console server never reads rt's files, so the check
   lives in a daemon verb, `runs:evidence {runId, repo?, key}`, which returns
   `{mime, base64}` (capped at 15MB for the socket). The console's
   `GET /api/runs/:repo/:runId/evidence/:key` only relays it. The verb:
   - `key` must be one of `before`, `beforeAnnotated`, `after`,
     `afterAnnotated`; anything else is 404.
   - The path is the value under `key` in that run's own `evidence` field,
     never a caller-supplied path.
   - The file goes through `checkUploadPath`
     (`lib/daemon/upload-guard.ts`) with the run's worktree as its root:
     realpath first, a regular single-link file, inside the evidence roots,
     image bytes matching the extension, read without following symlinks,
     capped at 50MB.
   - The console route returns the bytes with their mime type and
     `Cache-Control: private, max-age=3600`.

### D. Pure selectors (console)

New module `apps/console/src/app/runs/derive/`, each function pure and
unit-tested:

| Function | Returns |
|---|---|
| `decisionLogForRun(gates, runId)` | the run's gates in every status, oldest first, superseded rows linked to their replacement |
| `gateStage(gate, stages)` | `meta.stage`, else the stage whose window holds `openedAt`, else `null` |
| `tookRecommendation(question, answer)` | `true`, `false`, or `null` when no option was recommended |
| `waitingOnYou(gates, now)` | total ms a person was the blocker: open and parked time count, overlapping gates merge into one interval |
| `heldSpans(stages, decisions)` | intervals between a `hold:<stage>:<attempt>` decision and the next attempt's `started_at` |
| `fieldKind(key, value)` | `cleared` for `-` or empty, then `url`, `sha-list`, `json`, `gate-ref`, else `text` |

`activeGatesForRun` stays as is for the current page until the run page spec
replaces it.

## Testing

- `lib/daemon/__tests__` gates-store: exact `subject` and `status` filters;
  the sweep keeps an old answered `run:` gate while `runExists` says yes,
  sweeps it once it says no, and still deletes an old answered non-run
  gate; `meta.stage` is stamped from `current_stage` and a caller's own
  `meta.stage` wins.
- `lib/runs/__tests__`: the summary carries `ended_at`, `attempt`,
  `decision_count`, `evidence_count`.
- Console server: `/api/gates?subject=`; the evidence route serves a valid
  png, and refuses an unknown key, a key absent from the field, a symlink, a
  file outside the roots, and bytes that are not an image.
- Console vitest for every selector in D, and for `parseEvidence` on both
  versions.
- Plugin: `rt skills check --strict` and the version bump the
  `plugin-mattstack` job enforces.

## Out of scope

- Any UI change. The current run page and runs board keep working on the
  new payload.
- A recorded "doing now" activity line (the Now card uses existing signals).
- Run outcome and merged counts for the runs page.
- Pack semver in effective inputs.
