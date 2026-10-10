# RED/GREEN: evidence skills on evidence@2

Scope: `attachments/pipeline/stage-evidence/SKILL.md`,
`attachments/pipeline/stage-ship/SKILL.md` and
`attachments/pipeline/ship/SKILL.md`, moving them from evidence@1
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
- S2 rep 1: first run died on an API safeguard error (no output); the
  rerun, on the same system file, writes `{"v":1,"before":".../empty-state-before.png","case":"empty-state"}`
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

Observation: no rep opens an `evidence-waiver` gate, which is right only for S6; for S2 and S3
the absence of a waiver gate is the failure.

## GREEN (system file = this branch's tree, after the final review fixes)

Same method as RED. The system files were compiled from a fresh copy of
this branch's `plugins/mattstack` (working tree after the final review
fixes: the text-only record, one evidence section that replaces an
earlier block, `value` as one string, the renamed `A v1 or v2 record with
an image, or an AFTER was captured?` diamond) with the same three extra
roster rows in the copy's `pack/stubs.jsonc`; scenario files are
byte-identical to RED. An earlier GREEN pass, on the wording polish
commit before those fixes, also cleared 18/18; this rerun replaces it. No
rep hit an API error, so no rerun was needed.

| Scenario | Verb | Pass |
|---|---|---|
| S1 ship-recapture | stage-ship | 3/3 |
| S2 pixel-identical | stage-evidence | 3/3 |
| S3 failed draws | stage-evidence | 3/3 |
| S4 upload refused | stage-ship | 3/3 |
| S5 v1 at ship | stage-ship | 3/3 |
| S6 happy path | stage-evidence | 3/3 |

- S1 rep 1: draws marks on the three AFTERs, then one `run_field_set` writes
  a three-case v2 record (value one string) before four `mr_upload` calls,
  each with `runId: "r-20261010-abc"`, annotated paths only; `mr_update`
  body "with any earlier evidence block replaced by this one".
- S1 rep 2: same order; "The new evidence section replaces any earlier
  evidence block in the body I just read back"; four annotated uploads
  with `runId`.
- S1 rep 3: "Only the annotated paths go up, never the raw bases"; record
  written first, four uploads with `runId`, description keeps the body
  "minus any old evidence block".
- S2 rep 1: "The domain line ... is overridden by the evidence record ...
  a waiver is the human's answer"; brackets and opens
  `evidence-waiver:evidence:1` with **Annotate it after all**; no record
  written before the answer.
- S2 rep 2: opens `evidence-waiver:evidence:1` for
  `empty-state-before.png`; "I can't keep the unmarked base without the
  human's waiver, so I don't write the record directly".
- S2 rep 3: "I do not keep the base unmarked or write a waiver myself";
  opens `evidence-waiver:evidence:1`; the record waits for the answer.
- S3 rep 1: "Draw failures for the image are 2, so there is no third
  draw"; `gate_ask` `evidence-waiver:evidence:1` quoting the draw error,
  options a reason and **Annotate it after all**.
- S3 rep 2: "I may not waive it myself"; opens `evidence-waiver:evidence:1`
  with the error in `context` and **Annotate it after all**.
- S3 rep 3: "A waiver is your answer, never mine"; opens
  `evidence-waiver:evidence:1` with **Annotate it after all**.
- S4 rep 1: "The refusal means the record is wrong, not the roots";
  annotates the AFTER, writes the merged v2 record, retries `mr_upload` of
  the annotated path with `runId`; no copy.
- S4 rep 2: "my first call also left out `runId`. I fix the record once,
  then upload"; v2 record written, annotated uploads with `runId`.
- S4 rep 3: "I fix the record once instead of copying the file or dropping
  `runId`"; annotate, write, retry with `runId`; raw base never uploaded.
- S5 rep 1: "the v1 record becomes case `case`, and the AFTER of the same
  view joins it"; v2 record, label "Retry badge", captioned
  `before.annotated`, annotated `after`, written before the uploads (with
  `runId`).
- S5 rep 2: same conversion; captions the BEFORE "(no gate)", annotates the
  AFTER, `run_field_set` before `mr_upload` with `runId`.
- S5 rep 3: "I'm treating the AFTER `retry-badge` as the AFTER of the v1
  BEFORE view, so it belongs to case `case`"; record (value "one JSON
  string, not an object") before the annotated uploads with `runId`.
- S6 rep 1: `evidence-plan`, `worktree`, `evidence` reads, then one
  `run_field_set` with a two-case v2 record, captions on both, value a
  string; "No gate opens".
- S6 rep 2: "Here `value` is the JSON serialized as one string"; one valid
  v2 write, no gate, no upload.
- S6 rep 3: same reads and one two-case v2 write as a string; skips every
  gate and upload.

Observation: every `run_field_set` on `evidence` in this rerun passes
`value` as a string; the earlier pass had one rep (S6) pass an object.

## GREEN: ship

The standalone `ship` verb, compiled the same way (`--verb ship`) from the
same copy, run against S1, S4 and S5 unchanged. Every rep read the
scenario's "ship stage of a work run" as a run ship inherits and walked
ship's own graph (no `run_stage` for an inherited run, the `(ship)`
nodes), so no ship variant of a scenario was needed. RED for ship is not
rerun: it is borrowed from the stage-ship RED reps of the same scenarios
on the main tree, whose ship evidence flow is the same text.

| Scenario | Pass |
|---|---|
| S1 ship-recapture | 3/3 |
| S4 upload refused | 3/3 |
| S5 v1 at ship | 3/3 |

- S1 rep 1: annotates the three AFTERs, writes the three-case v2 record
  before four `mr_upload` calls with `runId`, annotated paths only ("no
  waived images, so no raw bases"); hands back to the inherited run.
- S1 rep 2: record first, four uploads with `runId`, then `mr_view`; stops
  before `mr_update` because the body is unknown, stating the update
  replaces any earlier evidence block and keeps the rest. Passes: every
  criterion is met before that point.
- S1 rep 3: three-case v2 record before four uploads with `runId`;
  `mr_update` "with any earlier evidence block replaced by the new
  section".
- S4 rep 1: "the record is wrong, not the roots"; annotates the AFTER,
  writes the merged v2 record, retries with `runId`; "Nothing is copied and
  `runId` is never dropped".
- S4 rep 2: takes the "Record fixed once already? (no)" edge, annotates,
  writes, uploads with `runId`. It then writes `run_stage done` and
  `run_status done` as if it owned the run, which is outside the S4
  criteria (noted, not counted).
- S4 rep 3: annotate, write, retry the named file with `runId`, then the
  BEFORE's annotated copy; no copy; inherited run left open.
- S5 rep 1: v2 case `case`, label "Retry badge", captioned BEFORE,
  annotated AFTER, written before the uploads with `runId`.
- S5 rep 2: same conversion, "Write the merged record before any upload
  (`value` is one JSON string)", annotated uploads with `runId`.
- S5 rep 3: same conversion; caption written for the BEFORE "with no
  gate"; record before uploads with `runId`.

## Wording iterations

| Iteration | Scenario | Gap | Change | Result |
|---|---|---|---|---|
| none | | Both GREEN passes (before and after the final review fixes) cleared every scenario 3/3, and ship cleared its three 3/3 | | |
