# RED/GREEN: evidence skills on evidence@2

Scope: `attachments/pipeline/stage-evidence/SKILL.md` and
`attachments/pipeline/stage-ship/SKILL.md`, moving both from evidence@1
(one `before`, one `case`) to evidence@2 (a `cases` array, annotated
images with captions, `evidence-waiver` for an image that stays
unannotated, `runId` on every `mr_upload`). The spec is
`docs/superpowers/specs/2026-10-10-evidence-skills-design.md`.

Six scenarios, committed beside this record under `scenarios/`, all on one
invented project (`gitlab.example.com/acme/queue`, run `r-20261010-abc`,
runDb `/home/dev/.mattstack/runs/queue/r-20261010-abc/state.db`):

- S1 ship-recapture (`stage-ship`): v2 record with one case, domain names
  AFTERs for it plus two new views.
- S2 pixel-identical (`stage-evidence`): the before of `empty-state` has
  nothing worth marking; domain line "None selected keeps the base capture".
- S3 failed draws (`stage-evidence`): the annotation draw fails twice.
- S4 upload refused (`stage-ship`): `mr_upload` refuses an image absent from
  the evidence record.
- S5 v1 at ship (`stage-ship`): a v1 record meets a new AFTER.
- S6 happy path (`stage-evidence`): two cases, both draws succeed.

Method: single-shot, tool-less reps, `claude --model sonnet --tools ""
--strict-mcp-config --append-system-prompt-file <system-file> -p
"$(cat <scenario>)"`, a fresh empty directory per rep, 3 reps per scenario,
run in parallel and read by hand. System file: the verb compiled with no
fills from a scratch copy of `plugins/mattstack` taken from `main` (`git
archive main plugins/mattstack`), whose `pack/stubs.jsonc` also rosters
`stage-evidence`, `stage-ship` and `ship` (engine = the same name):
`bun cli.ts skills compile --pack-dir <copy> --mattstack-dir <scratch>
--verb <verb> --preview > <system-file>`. The real `stubs.jsonc` is
untouched. Each scenario asks for every tool call, in order, with exact
arguments, up to the stage's end or its first gate.

## Pass criteria

- S1: a v2 record with three cases is written before the first `mr_upload`;
  every `mr_upload` carries `runId: "r-20261010-abc"`; no raw base of an
  annotated image uploads; every new image is annotated with a caption or
  reaches `evidence-waiver`.
- S2: the `evidence-waiver` gate opens for that image, and no record is
  written with that image unwaived.
- S3: the `evidence-waiver` gate opens, offering **Annotate it after all**.
- S4: a record fix (annotate or waiver, then `run_field_set`), a retry with
  `runId`, no copy, no upload without `runId`.
- S5: a v2 record with case `case`, labelled "Retry badge", where
  `beforeAnnotated` gets a caption and the AFTER is annotated or waived,
  written before upload.
- S6: no gate opens, and one `run_field_set` writes valid evidence@2 with
  captions.

## RED (system file = the main tree before this branch's skill edits)

| Scenario | Pass |
|---|---|
| S1 ship-recapture | 0/3 |
| S2 pixel-identical | 0/3 |
| S3 failed draws | 0/3 |
| S4 upload refused | 0/3 |
| S5 v1 at ship | 0/3 |
| S6 happy path | 0/3 |

Failure classes: the engine knows only evidence@1, so no rep writes a v2
record, none can name `evidence-waiver`, and none sends `runId`. These are
structural gaps, so the fix is new recipe text and a required record shape,
not a nudge.

- S1 rep 1: reads the v2 record, calls it "not `evidence@1` JSON, so I
  write nothing back to `evidence`", then uploads `retry-after.png` raw
  with no `runId` and no annotation.
- S1 rep 2: same: "The `evidence` value you gave is `"v":2`, which is not
  `evidence@1` JSON ... no `run_field_set` on `evidence`"; three raw
  uploads, no `runId`.
- S1 rep 3: same skip of the record; three raw `mr_upload` calls without
  `runId`, AFTERs linked in prose only.
- S2 rep 1: first run died on an API safeguard error (no output); rerun
  writes `{"v":1,"before":".../empty-state-before.png","case":"empty-state"}`
  and no gate.
- S2 rep 2: "No gate opens on this path", writes the same v1 record with the
  before unannotated.
- S2 rep 3: "no `beforeAnnotated`", writes the v1 record, no waiver.
- S3 rep 1: "I don't open a gate"; writes v1 `{before, case}` with no
  annotated image.
- S3 rep 2: "No retry or gate: ... A third draw would repeat the same
  failure"; v1 record, no waiver, no **Annotate it after all**.
- S3 rep 3: "I also don't open a gate: `beforeAnnotated` is optional";
  v1 record.
- S4 rep 1: reads the refusal as a skipped `after` merge, writes the record
  with `after` added to the (assumed) evidence, then `mr_upload` with no
  `runId`, no annotation or waiver.
- S4 rep 2: same: `run_field_set` adds `after`, "I add no `afterAnnotated`",
  retries `mr_upload` without `runId`.
- S4 rep 3: same: adds `after`, uploads the raw file without `runId`.
- S5 rep 1: keeps the v1 shape, adds `after` ("no `afterAnnotated` key
  because no annotated AFTER was captured"), uploads `a.png` raw.
- S5 rep 2: v1 record plus `after`, `mr_upload` without `runId`, no caption.
- S5 rep 3: same v1 merge and raw upload.
- S6 rep 1: writes `"v":1` with an invented `cases` array beside top-level
  `before`/`case` ("The `cases` key is my own addition"); not valid
  evidence@2 and the label keys are wrong.
- S6 rep 2: same invented v1 plus `cases` hybrid.
- S6 rep 3: same hybrid, `"v":1`.

Observation: no rep opens a gate, which is right only for S6; for S2 and S3
the absence of a waiver gate is the failure.

## GREEN

Filled in by the GREEN task.
