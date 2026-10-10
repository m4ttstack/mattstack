# Evidence skills: every case recorded, annotated or waived

SKILLS-97, shared-pipeline half. Builds on evidence@2 (RT-483, spec
`2026-10-10-evidence-v2-design.md`), which merged the shape, the
`run_field_set` validator and the record-checked `mr_upload {runId}`.
The claimview team pack is a separate later job and is not touched here.

## Problem

The shared stages still write `evidence@1`: one before, one after. A
ship-time capture of a second case has nowhere to go in the record, so it
goes around it and uploads raw. Nothing in the shared stages annotates an
image or asks for a reason when one goes out unmarked, and no upload passes
`runId`, so the daemon's record check never runs.

## Decisions (ratified at the brainstorm gate)

- **Annotate by default, gate only a waiver.** After each capture the agent
  draws its proposed marks and writes a caption, with no new gate. A gate
  that already asks which marks to draw (`evidence-attach`, a domain form)
  keeps asking. A waiver is never the agent's call: an annotations question
  answered with nothing selected, two failed draws, or the agent finding
  nothing worth marking each opens the `evidence-waiver` question for that
  image. A run that annotates everything sees no new gate.
- **The standalone `ship` verb follows the same rules as `stage-ship`**: it
  records its AFTER as a case in its own run's record, annotates or waives
  it, and passes `runId` on every evidence upload.

## Shape of the change

### New attachment: `evidence-record`

`plugins/mattstack/attachments/evidence-record/SKILL.md`, a hidden
attachment that `stage-evidence`, `stage-ship` and `ship` pull in with
`{{include:evidence-record}}`. It is the one place that says:

1. **The record.** The `evidence` run field is `evidence@2` JSON, one case
   per thing verified. A field that is set but not v2 is a
   prior record, and the merge rules in step 6 handle it. A case's `id`
   is a stable slug (`^[a-z0-9][a-z0-9-]{0,63}$`) and its `label` is what a
   reader sees. A slot is one image, or a `{light, dark}` pair only when the
   plan or the domain says the run's theme matters. Image paths are
   absolute. Unbound, files live under `~/.mattstack/work/<run id>/evidence/`.
2. **The run id.** `<run id>` is the path segment before `/state.db` in
   the `runDb` this verb carries.
3. **Annotate or waive, per image** (a small digraph):
   - Draw the proposed marks with the domain's method, else the
     `annotating-screenshots` skill, to a sibling `-annotated` file, and
     write a caption naming what the marks point at.
   - A draw that fails gets one retry; a second failure goes to the waiver
     question. So do an annotations question answered with nothing
     selected for that image, and an image the agent finds nothing worth
     marking on (for example, the before and after are pixel-identical).
     A video or a transcript is not drawn on, so it goes to the waiver
     question too.
   - **Gate `evidence-waiver`** (gate-protocol, scope
     `evidence-waiver:<stage>:<n>`): one sentence naming the images and
     why each needs a waiver. One question per image,
     `waiver-<case>-<slot>[-<theme>]`, options: the agent's proposed reason
     (Recommended) / **Annotate it after all**, with free text for a reason in
     the human's own words; when every image in a case needs a waiver, one
     question per case instead, recorded as the case's `waiver`. `next`:
     **Proceed** / **Hold**. Selection:
     `{"waivers":{"<case>/<slot>[/<theme>]|<case>":"<reason>|annotate"},"next":"proceed|hold","note":"<their words or null>"}`.
   - **Annotate it after all** draws once more; a failure there reopens the
     waiver question without that option. `Waiver rounds = 2?` counts
     openings of this gate per stage pass: the second opening without a
     reason for every image fails the stage, naming the images.
4. **Write before upload.** The record is written with `run_field_set
   {key: evidence, stage}` before any upload of its images. A refusal
   from the validator names the image: send that image back through step 3
   and write again. A second refusal fails the stage with the message
   quoted.
5. **Upload only what the record allows.** Upload every annotated path and
   every waived image's base path, never a base that has an annotated copy,
   each with `mr_upload {mrUrl, path, runId}`. A refusal that says the file
   is not in the record, or is a raw capture, is a record bug, not an
   upload-root problem: fix the record through steps 3 and 4 once, then the
   stage's existing upload off-script gate.
6. **Merging what is already there.** Read `evidence` with
   `run_field_get` and handle what comes back:
   - v2: add new cases, or set the AFTER of the case with the same `id`.
     Keep every other case and key.
   - v1: convert it to one case with id `case`, label = v1's `case` text or
     `Evidence`. The v1 record's annotated images have no caption, so each
     one gets a caption from the agent (no gate), and its raw images go
     through step 3.
   - unset (the read errors), `-`, or `{"plan": "none"}` with a ship-time
     capture: start a new v2 record.
   - legacy text (v0 links): start a new v2 record and carry the old text
     in `attach`, so the description still links it.
7. **The description from the record.** One evidence section, a block
   per case: the label in bold, then a line per image with its upload
   markdown (or its local path where nothing uploaded, which covers
   GitHub), then `Caption: <caption>` or `Waived: <reason>`. A case
   waiver prints once, under the label. The domain's template and heading
   rules win over this layout, never over its content: every caption and
   waiver reason appears.
8. **Domain precedence.** A domain rule that keeps a base capture with no
   waiver, or uploads a capture outside the record, is overridden by this
   attachment, the way a STOP node overrides a domain step today.

### `stage-evidence`

- Capture the BEFORE once per case the plan names, each with its id and
  label; the attempt counter stays per case.
- After capture: **Annotate or waive (evidence-record)**.
- The record is written (step 4) after the `evidence-attach` gate's
  answer and before any upload at its Attach now, so any upload there
  passes `runId`. The gate's `annotations` answer decides the marks; an
  image left with nothing selected goes to the waiver question.
  `attach` keeps its meaning, and after the upload the record is
  rewritten with `attach` set to the handed-back markdown.
- The finish paragraph describes `evidence@2`; `{"plan": "none"}` stays.
- A case whose BEFORE is only in the ticket has no image yet: it is
  recorded at ship with its AFTER, and the ticket's location goes in the
  run-level `url`. When every BEFORE is the ticket's, the stage writes
  `{"plan": "ticket", "url": "<location>"}`, which the merge keeps as `url`.

### `stage-ship`

- **Capture the AFTER** becomes one capture per case in the record, the
  same view as its BEFORE, plus any capture the domain names that matches
  no case, which goes in as a new case. Every one goes through **Annotate or
  waive** and the merge (step 6), and the record is written before
  any upload.
- `mr_upload` passes `runId`. "Files to attach" is every uploadable path
  in the record; a repeat upload of a file the evidence stage already
  attached is harmless, and the description uses one markdown per file.
- The node `evidence reads as evidence@1 JSON?` and its "leave it, link the
  AFTER only" edge are removed: step 6 covers every value.
- **Write the title and description** builds the evidence section from the
  record (step 7).

### `ship` (standalone)

The same changes as `stage-ship`. An own run uses its own `runDb`'s id, and
an inherited run uses the inherited one. With no BEFORE in the record,
its AFTERs come in as new cases.

### Untouched

`gate-protocol` (so no board skills re-expansion), `wrap-up-form`, the
slot contracts (`evidence-domain@1`, `ship-domain@1` keep their shape),
`stage-watch-ci`, the claimview pack, the console.

## Verification

- `rt skills check --strict`, `tests/certify.sh` for each changed or new
  skill dir, `check-dot` with no warnings on every changed digraph.
- `.claude-plugin/plugin.json` bumped from 0.30.27 to 0.31.0.
- writing-skills RED/GREEN evidence for `evidence-record`, `stage-evidence`,
  `stage-ship` and `ship`, recorded under
  `plugins/mattstack/docs/superpowers/tests/2026-10-10-evidence-skills/`.
  Pressure scenarios:
  - A ship-time re-capture of three cases with a pushed MR. RED uploads
    them raw, without `runId`. GREEN records them, annotates them, then
    uploads with `runId`.
  - A before and after that are pixel-identical. RED keeps the base
    silently. GREEN opens `evidence-waiver`.
  - Two failed draws. GREEN reaches the same waiver question.
  - A run that annotates everything. GREEN opens no gate beyond today's.
  - An upload refused as "not in the record". GREEN fixes the record, and
    never copies the file or drops `runId`.
- CERTIFICATION.md ledger rows for each changed skill.
