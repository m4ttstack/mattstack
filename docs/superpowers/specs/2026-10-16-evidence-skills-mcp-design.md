# Evidence skills on the evidence tools

Wave 3 of the digraph-to-MCP herd, evidence lane. Skill text only: the
tools merged in #851 (`evidence_record`, `evidence_attach`, batch
`mr_upload`, `dev_endpoints`).

## Why

The `evidence-record` page (1,762 words) is inlined whole into six
compiled verbs (stage-evidence, stage-ship and ship, for each team). It
teaches an agent to build evidence@2 JSON by hand, merge it with whatever
the field held, serialize it as a string, upload each file with `runId`,
retry timeouts and corrected paths, then read the MR description back and
splice the evidence section in by hand. stage-evidence (3,074 words) draws
the same loop again as 20-odd nodes. Every one of those steps is now a tool
call that returns data. What stays with the agent is the capture itself
(Fast Browser), the page-state verdict, the marks, the captions, and every
gate.

Recon: `05-evidence.md` and `00-SYNTHESIS.md` in the herd's recon folder.
The tools' contract: `docs/superpowers/specs/2026-10-16-evidence-tools-design.md`.

## Goals

- `evidence-record` shrinks to the record's concepts and three boxes a verb
  draws: record, annotate-or-waive, attach. Target: under 1,100 words.
- stage-evidence draws those boxes instead of its own write and upload
  loop, and reads dev-server ports with `dev_endpoints`. Target: under
  2,400 words.
- ship and stage-ship (owned by ship-ci-skills) can call the same three
  boxes in their phase 2, so every verb attaches evidence one way.
- Fix the drift the recon found (below).

## Non-goals

- No edits to ship, stage-ship, gate-protocol, or any team pack.
- No tool changes. Anything a tool cannot do is listed, not worked around.
- No change to the capture method, the page-state verdict, or how marks
  are chosen and drawn.

## Anti-goals

- A skill that still tells the agent to write `evidence` with
  `run_field_set`, to upload evidence with `mr_upload`, or to edit the
  evidence section with `mr_update`.
- A refused file copied somewhere the guard accepts, or uploaded without
  the record. Moving a refused file stays the human's move.
- A host node renamed without a row in the fill-anchors table.

## Constraints

- **Write fence:** the two skill folders, `plugin.json`,
  `pack/requires.json`, plugin tests and fixtures for these skills, and the
  spec and plan folders.
- **Fills attach by exact node text.** Keep attached node text, or list the
  rename for the pack replay (table below). Never compile, sync or edit the
  team packs.
- **Shim for ship.** ship and stage-ship on main still draw "Merge into the
  record (evidence-record)", then box 2, then their own `run_field_set`
  evidence write and `mr_upload` loop. Until ship-ci-skills lands its phase
  2 (agreed by DM #6035), the removed headings stay as short bridge
  sections (see "Kept sections"). The window lives only on main between the
  two merges: the herd's merge queue ships both lanes in one release, and
  ship-ci-skills rebases its phase 2 onto this branch. Inside that window
  the compiled ship verbs still name `mr_upload`, so the anti-goal holds
  for them only once phase 2 lands. They also still label the
  `Files to attach` edge "no, or GitHub: link the paths"; the
  `Upload only what the record allows` bridge overrides that label by
  sense, since box 3 runs whatever the decision answers.
- **Fills are inlined whole.** The compiler has no anchor matching:
  `{{slot:domain}}` pastes the fill, and an `At:` heading is prose the agent
  maps to a node by sense. A renamed host node therefore breaks no compile
  or check; the fill's rules stay in the verb, under a heading that names
  the old node, until the pack replay renames it.
- **#822 (composed evidence) is still open.** Box 2 keeps main's draw
  (`<name>-annotated.<ext>`). Its `import` and `redaction` refusal buckets
  fall into box 3's "any other bucket" route (the off-script gate) until
  #822 adds its own route; main's guard never produces them.
- **Counters** follow ship-ci-skills' convention: `run_budget {runDb, key:
  evidence:<slug>, limit: N, stage}` each time the counted event happens,
  then a diamond `<slug> spent?`, yes when `spent > limit` (read `spent`
  against `limit`; ignore the tool's `exhausted`, which is `spent >= limit`,
  and `remaining`). Holds go
  through `run_hold`, which writes the same `hold:<stage>:<attempt>`
  decision and `hold` field as today's `run_decision` plus `run_field_set`
  pair.
- **Digraph rules** (mattstack:process-digraphs): one exact call per
  `plaintext` node, STOP text never quotes a shell form, every judgment box
  has its own `### <node text>` section, dot fences at column 1.
- Employer-visible text carries no mattstack strings; fixtures use generic
  names (`acme`, `web`, `api`).

## evidence-record, after

### Opening

The `evidence` run field is what this run verified and the only list of
what may leave the machine. `evidence_record` writes it and
`evidence_attach` uploads from it and writes the MR's evidence section.
Never write `evidence` with `run_field_set`, upload evidence with
`mr_upload`, or edit the evidence section by hand.

### The record (concepts, no JSON to build)

- One case per thing verified, in reading order; `id` is a stable slug
  (`^[a-z0-9][a-z0-9-]{0,63}$`), `label` is what a reader sees.
- A case has a before, an after, or both. A slot is one image, or a
  `{light, dark}` pair only when the plan or the domain says the theme
  matters (`theme` on each image).
- Every image is annotated (a board plus a caption naming what the marks
  point at) or waived (its own reason, or its case's). A case waiver covers
  only the images the case holds when it is written.
- `transcript` (a text file, never uploaded, never waived) and `url` (where
  the ticket shows the broken state) are run-level. A run with no image is
  still recorded the same way: the tool picks the encoding.
- Captures stay where the capture wrote them (Fast Browser's screenshot
  folder, the session temp root, the worktree). `evidence_record` copies
  each into the run's folder and the record stores the copy; draw marks and
  name files by the paths in its returned `value`, never the source.
- A file in the run folder is never rewritten: a recapture lands in a
  content folder beside the old one, and the record moves when it is
  written.

### Box 1: `Record the evidence (evidence-record)`

```
Record the evidence (ellipse)
-> evidence_record {runDb, stage, tree: <worktree>, images, cases?, transcript?, url?}
-> evidence_record result?
   written                                   -> Recorded (green)
   uncovered listed                          -> run_budget {runDb, key: evidence:cover-rounds, limit: 3, stage}
                                                -> cover-rounds spent?
                                                   no  -> Annotate or waive each image the record does not yet cover (evidence-record)
                                                   yes -> Record failed
   error: the evidence field changed during this call
                                             -> run_budget {runDb, key: evidence:record-retries, limit: 1, stage}
                                                -> record-retries spent?  no -> the same call again; yes -> Record failed
   any other error                           -> Record failed
Annotate or waive outcome?
   Ready                     -> evidence_record {..., each image uncovered lists, by its path there, with its cover and a new case's label}
   Waiver held               -> Record held
   Waiver openings spent     -> Record failed
```

The first call carries the captures as `path`s; every later call names
the same images by the paths in the returned `value`, with their covers
(`annotated` is the board's path). The call that first writes a new case
carries its `label` (on the image or in `cases`), so every call until the
record is written carries each new case's `label`: the first call writes
nothing while an image is uncovered, and the tool refuses a new case with
no label. Outcomes: **Recorded**, **Record held** (the verb's hold path),
**Record failed** (the verb fails, naming the images or quoting the
error); the reason rule is stated once in the box's prose. `cover-rounds`
is 3: the first call, one correction, and one re-record after a
recapture.

### Box 2: `Annotate or waive each image the record does not yet cover (evidence-record)`

Node text kept (ship and stage-ship draw it). Today's graph, fed by
`uncovered` (`{case, slot, theme?, path, why}`) instead of the agent
working out coverage, with two counters moved to `run_budget`:
- `evidence:draw-failures:<case>/<slot>[/<theme>]`, limit 1 (one retry);
- `evidence:waiver-openings:<case>/<slot>[/<theme>]`, limit 2.

The draw writes `<name>-annotated.<ext>` beside the run-folder copy. The
`evidence-waiver` gate, its table and selection are unchanged. Outcomes:
**Ready**, **Waiver held**, **Waiver openings spent**.

### Box 3: `Attach the evidence (evidence-record)`

Entered only after the verb's attach gate proceeds (ship and stage-ship:
at the bridge). The domain supplies
`heading`, `before` and `appendix`; unbound, `heading` is the repo MR
template's evidence heading when it has one, else `## Evidence`.

```
Attach the evidence (ellipse)
-> Forge host?
   GitLab -> evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl}
             -> evidence_attach result?
                descriptionWritten, or notWritten: unchanged   -> Attached (green)
                any refused bucket, or timedOutTwice           -> STOP
                tempted to copy the file or upload another way -> STOP
                writeErrors, or the call errored               -> Attach failed
             STOP: only the human moves a refused file
             -> Off-script gate: upload refused (gate-protocol, scope off-script:<stage>:<n>)
             -> upload off-script answer?
                proceed + take, a later stage attaches (stage-evidence) -> Taken
                proceed + take, the last attach (ship, stage-ship)      -> evidence_attach {..., linkRefused: true}
                                                                           -> Linked description written? yes -> Attached; no -> Attach failed
                proceed + hand back  -> Attach failed
                iterate              -> run_budget {runDb, key: evidence:upload-off-script, limit: 1, stage}
                                        -> upload-off-script spent?  yes -> Attach failed
                                           no -> Iterate needs a re-record?
                                                 yes: size, bytes or missing (a recapture), a new file, or a record or raw-capture refusal
                                                      -> Re-record the images through Record the evidence (box 1)
                                                         -> Recorded -> evidence_attach (again); Record held -> Attach held; Record failed -> Attach failed
                                                 no: timedOutTwice, the human checked the daemon -> evidence_attach (again)
                hold                 -> Attach held
   GitHub -> gh pr view <n> --json body
             -> evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, description: <the body>}
             -> description returned?  no -> Attach failed
             -> gh pr edit <n> --body-file <a file holding the returned description>
             -> Attached (a failed edit is Attach failed, by the box's prose rule)
```

A `record` or `raw-capture` refusal goes to the upload off-script gate like
any other refused bucket: the Task 3b trim (operator ruling #6050) dropped
main's one agent fix (`Record fixed once already?`; an earlier draft's
`record-recalls`).
Iterate re-records through box 1 before it attaches again when the human
recaptured, the note names a new file, or the refusal was `record` or
`raw-capture` (box 1 then gets the last recorded images by their `value`
paths, with covers). After `timedOutTwice` the human checked the daemon, so
Iterate attaches again directly. Both count against `upload-off-script`.

Outcomes: **Attached**, **Taken** (nothing written; a later attach sends
the refused files), **Attach held** (the verb's hold path), **Attach
failed** (the verb fails, quoting the reason). Box 1's Record held and
Record failed reached from here are Attach held and Attach failed.

The off-script gate node lives in the include, so each verb that inlines
it gets its own copy, scoped `off-script:<stage>:<n>` with `n` shared with
the verb's other off-script gates. Records hold run-folder copies, so the
`roots` bucket cannot fire. Its section names the scope and `context` and
that moving or copying a file is only ever the human's move. Take routes
by the two labelled edges: at stage-evidence it ends Taken; at ship and
stage-ship it calls `linkRefused: true`, which names each file "<file
name> (attached separately)", never its path. Iterate routes by the
re-record edge labels: `timedOutTwice` means the human checked the daemon;
`size`, `bytes` or `missing` means a recapture the agent re-records;
`record` or `raw-capture` means the record the guard read is not the one
written, so the agent re-records the last recorded images.

### Kept sections

- **Domain precedence**, reworded: a domain rule that keeps a base capture
  with no waiver, uploads outside `evidence_attach`, or writes the record
  outside `evidence_record` is overridden by this page.
- **Bridges until ship's phase 2** (one `##` section, deleted by that
  lane), written for a verb that still draws the old nodes. Each bullet's
  bold lead keeps the old heading text, so ship and stage-ship's
  "(evidence-record)" references still resolve by name:
  - **Merge into the record**: run box 1 here. It merges, covers (box 2
    inside it) and writes, so the verb's own box 2 pass and its
    `run_field_set` evidence write that follow are already done: skip
    them. Record held and Record failed take the verb's `Annotate or waive
    outcome?` hold and failure edges.
  - **Write before upload**: already done by box 1.
  - **Upload only what the record allows**: run box 3 at the verb's
    `Files to attach` decision, whatever it answers (GitHub and no files
    included), instead of the verb's `mr_upload` loop. Attach held and
    Attach failed take the verb's upload gate's hold and hand-back edges.
  - **The evidence section of the description**: box 3 wrote the section;
    the verb writes the title and description around it byte for byte as
    it stands on the MR (or the returned `section`), never a second
    evidence block.

### Removed

The JSON example, the merge table, the string-serialization rule, the
upload-set rule, the per-file retry rules and the section format. Each is
now inside a tool, and the tool's own description carries what a caller
must know.

## stage-evidence, after

Kept as is (node text and sections): entry, the `evidence-plan` and
`worktree` reads (now one node each), the domain steps box, the `rt_verb`
STOP (`STOP: rt reads go through rt_verb, never rt on Bash`), the evidence
gate and its table, the ticket diamond and box, the capture loop with its
attempt counter, the data-source off-script gate, the attach gate and its
table, the GitLab-fact read section.

Changed:

| Today | After |
|---|---|
| `run_field_set {key: evidence, value: {"plan": "none"}, ...}` | `evidence_record {runDb, stage: evidence, plan: "none"}` |
| `Domain needs an rt read (ports, endpoints)?` -> `rt_verb` | `Domain needs dev servers or another rt read?`: dev servers -> `dev_endpoints {tree: <worktree>, roles: <the domain's roles>}`; another read -> `rt_verb` (kept). A role in `waiting`, or unclaimed, goes in the evidence gate's sentence. |
| attach gate's **Hand back the markdown** | unchanged label and meaning: record only, attach nothing; ship attaches later (today's flow, which also produces no markdown at this stage) |
| attach gate, then annotate-or-waive, then the `evidence@2` / `plan:ticket` / `plan:text` writes, the validator loop, then the upload loop, `mr_view`, `mr_update` and the "record plus attach" write | attach gate (unchanged), then `Record the evidence (evidence-record)`, then `Attach now answered?`, then `Attach the evidence (evidence-record)` |
| `Domain attaches evidence to an MR here?` -> `run_field_get branch` -> `mr_for_branch` | the same, plus `Forge host?` from `git -C <worktree> remote get-url origin`: GitHub -> `gh pr view <branch> --json number,url,state` (a PR not `OPEN` means ship attaches); another host -> ship attaches |
| the upload off-script gate section | moves into the include (box 3) |
| `run_decision {... hold:evidence:<attempt> ...}` + `run_field_set {key: hold, ...}` | `run_hold {runDb, stage: evidence, reason, decidedBy}` |
| `Attempts for this case = 3?`, `Off-script rounds = 2?` | `run_budget` pairs (`evidence:capture-attempts:<case>`, limit 2; `evidence:source-off-script`, limit 1) |
| Capture section: "store under `~/.mattstack/work/<run id>/evidence/`" | leave the capture where it was written; box 1 files it. A text capture goes to a file in the session temp root and rides as `transcript`. |
| Domain rules tail: the four encodings and "`value` is a string" | one line: finish through box 1; ship adds the AFTERs to the same record. |

## Fill anchors (for the pack replay)

| Fill section (both evidence fills) | Host node today | After |
|---|---|---|
| `At: mr_upload {mrUrl, path} per file; keep each markdown` | `mr_upload {mrUrl, path, runId} per uploadable file; keep each markdown` (already drifted: no `runId`) | `Attach the evidence (evidence-record)`. The fill's rules there become the `heading`, `before` and `appendix` it passes (one fill's `<details>` text blocks are the `appendix`); the per-file upload text and the "never copy" line go. |
| `At: Capture the BEFORE` | `Capture the BEFORE for the next case` (already drifted) | unchanged host text; the replay renames the fill heading to match. |
| `At: Run the domain steps before the gate (none when unbound)` | unchanged | unchanged. The replay can route the target graph's port lookups to `dev_endpoints` and drop the `rt.mcp.uploadRoots` read. |
| `At: Gate evidence (table below)` | unchanged | unchanged. The `upload_root` question is obsolete: captures no longer need an upload root. |
| `At: Gate evidence-attach (table below)` | unchanged | unchanged. Drop the `rt.mcp.uploadRoots` re-read. |
| the "evidence tree" paragraphs | none | obsolete: captures stay where taken and box 1 files them. |
| a fill's capture root (where its captures are written) | none | Dropping `upload_root` is safe only for a capture root under an allowed source (the repo checkout or worktrees, the Claude Code temp root, `~/.mattstack/evidence`, the configured upload roots, a run's evidence folder, `~/.fast-browser/screenshots`); elsewhere box 1 refuses the capture (C10). A fill whose capture root sat outside the allowed sources: the pack-fixes replay moves it under `~/.mattstack/evidence`, so dropping `upload_root` is safe. |
| none (no fill anchors here) | `Open MR on the branch?` | `Open MR or PR on the branch?` |
| none (no fill anchors here) | stage-evidence's data-source off-script gate, `Off-script gate (gate-protocol, scope off-script:evidence:<n>)` | `Off-script gate: a new data source` |
| none (no fill anchors here) | stage: `run_field_get {key: evidence-plan}; run_field_get {key: worktree}`; `Domain needs an rt read (ports, endpoints)?`; `Attempts for this case = 3?`; `Off-script rounds = 2?`; `STOP: upload only with mr_upload; another route is off-script`. Box 2: `Draw the marks to a sibling -annotated file`; `Nothing selected for it at an annotations question?` and `Video, or nothing worth marking?`; `Drawn after an Annotate it after all answer?`; `Draw failures for this image = 2?`; `Waiver openings for this image = 2?`; `Record the waiver`; `STOP: a waiver is the human's answer, never the agent's` | stage: split into `run_field_get {key: evidence-plan}` and `run_field_get {key: worktree}`; `Domain needs dev servers or another rt read?`; `capture-attempts spent?`; `source-off-script spent?`; box 3's `STOP: only the human moves a refused file`. Box 2: `Draw the marks beside the value copy`; merged into `Nothing selected, a video, or nothing worth marking?`; folded into `Drawn?` (its edge `no, after Annotate it after all`); `draw-failures spent?`; `waiver-openings spent?`; dropped (`waiver answer?` goes to `Ready`); `STOP: only the human waives an image`. The upload loop, validator, evidence-write and hold nodes are removed (Changed table above). |

## Behavior changes

| # | Change | Status |
|---|---|---|
| C1 | The record is written by `evidence_record`, which copies captures (whole bundles) into `~/.mattstack/work/<run id>/evidence/<case>/` and never rewrites a file there, instead of hand-built JSON through `run_field_set`. | Approved in wave 2 (tools B1, B8). |
| C2 | Upload and the description splice go through `evidence_attach`: earlier uploads are reused by sha256, and `evidence` is no longer rewritten with "the record plus attach" after the description write. | Approved in wave 2 (tools B2, B5). |
| C3 | A `missing` refusal (path not found, not absolute) goes to the off-script gate instead of a corrected-path retry. Paths now come from the record, so there is nothing for the agent to correct. | My call. |
| C4 | A file that times out twice is reported with the rest still uploaded, instead of stopping at the first. | Tools B6. |
| C5 | Take at stage-evidence writes nothing, and ship's attach sends the refused files. Take at ship and stage-ship calls `evidence_attach {linkRefused: true}`, which since #853 (on main) names each refused file "<file name> (attached separately)", never by path; ship and stage-ship reach it through this branch's bridge. | Tools (#853), which meets the shepherd's condition on gate `269aef04`. |
| C6 | On GitHub, stage-evidence finds the PR with `gh pr view` and writes the section through `gh pr edit`. Today it calls `mr_for_branch`, which is GitLab-only and fails. | Bug fix. |
| C7 | Dev-server ports come from one bounded `dev_endpoints` call instead of the domain's `rt endpoint lookup` reads and curl probe. | Tools ruling (C3 in recon). |
| C8 | Loop counters persist on the run through `run_budget`, so they survive compaction and resume; holds use `run_hold` (same decision and field). | My call, matching ship-ci-skills. |
| C9 | Unbound, the section heading is the MR template's evidence heading, else `## Evidence`. Today it is unspecified. | My call. |
| C10 | A capture whose source sits outside the tool's allowed sources fails the stage with the refusal quoted. Today nothing checks it. | My call: a new location is not the agent's to invent. |
| C11 | A `record` or `raw-capture` refusal goes straight to the upload off-script gate; main fixed the record once (`Record fixed once already?`). Iterate after a recapture, a new file or such a refusal re-records through box 1, then attaches again. | Operator ruling #6050 (the trim); the re-record on Iterate is the controller's final-review ruling. |
| C12 | A dev-server role left waiting, unclaimed or with an `error` opens the evidence gate even with no intake question; Iterate re-runs `dev_endpoints`. | My call. |
| C13 | On GitHub the lookup is `gh pr view <branch> --json number,url,state`; a merged or closed PR means ship attaches. A host neither GitLab nor GitHub skips the attach at this stage. | Bug fix. |
| C14 | ship and stage-ship pick up C1-C4 and C9 at this merge through the bridges, not at their phase 2: box 1 records the copies, box 3 uploads and splices through `evidence_attach`, no corrected-path retry, and Take lists refused files as attached separately. | My call (the shim, agreed by DM #6035). |
| C15 | A GitHub section names each file "(attached separately)" where main printed local paths. | Tools (#853). |
| C16 | The evidence gate's Iterate on a dev-server role left waiting or unclaimed re-runs `dev_endpoints` at most twice (`run_budget {runDb, key: evidence:gate-iterates, limit: 2, stage: evidence}`); the third Iterate fails the stage, naming the roles. Failing reads cleanest: it matches `source-off-script spent?`, and the gate's table needs no conditional option. | My call (PR review). |

The PR review's shorter outcome names (box 1 `Recorded` / `Record held` /
`Record failed`, box 2 `Ready` / `Waiver held` / `Waiver openings spent`,
box 3 `Attached` / `Taken` / `Attach held` / `Attach failed`) change no
behavior: they are internal texts no fill or verb anchors on. Carrying
each new case's `label` until the record is written fixes this branch's
own draft; main built the record by hand with every label in it.

## Test plan

**Static:** `render.sh` and `check-dot.py` on both SKILL.md files;
`certify.sh` on both skill dirs; `rt skills check --strict` and
`rt skills compile --dry-run` under an isolated HOME; `bun run purity`;
the plugin-mattstack CI job.

**RED/GREEN** (superpowers:writing-skills): the approved tool-less recipe
(herd room #m-6019): `claude --model sonnet --tools "" --strict-mcp-config
--setting-sources local --settings '{"disableAllHooks":true}'
--disable-slash-commands --no-session-persistence -p "<scenario + compiled
stage-evidence>"`, from an empty scratch dir. RED compiles main's text,
GREEN this branch's, both with no fills and the same scenario, which lists
the tools available and the results they return. 5 runs per scenario.

| Scenario | Pass |
|---|---|
| E1 happy path, GitLab, attach now | `evidence_record` with the raw paths and `tree`; marks drawn beside the returned copies; a second `evidence_record` with covers; `evidence_attach` with `heading` and `mrUrl`; no `run_field_set {key: evidence}`, `mr_upload` or `mr_update` |
| E2 recapture | a new BEFORE for an existing case goes in as `images` for that slot; the annotation is drawn beside the content-folder path the tool returned; no hand merge |
| E3 refused upload | `refused.size` (a waived video over the cap) opens the off-script gate scoped `off-script:evidence:<n>` quoting the refusal; on Take, the stage ends with nothing written (no `linkRefused` call at this stage); no copy, no `mr_upload` |
| E4 GitHub PR | no `mr_for_branch` or `mr_upload`; `gh pr view`, `evidence_attach` with `description`, `gh pr edit --body-file` |
| E5 dev servers | one `dev_endpoints {tree, roles}`; no `rt_verb` endpoint lookup, no curl loop |
| E6 label carry (added at the PR review) | one new case; the first `evidence_record` returns `written: false` with its image uncovered, and the scenario names no label rule or second-call shape. Pass: the second `evidence_record` carries the new case's `label` (on the image or in `cases`) with the cover, by the `value` path |

GREEN passes a scenario when no run makes an anti-goal call (a
`run_field_set` evidence write, an evidence `mr_upload`, an `mr_update` of
the section, a copy of a refused file) and at least 4 of 5 runs meet every
pass item. A miss changes the skill text and reruns that scenario's 5, at
most 3 rounds, then the table goes to the shepherd. The spec gets a
deviation table (scenario, run, deviation, RED or GREEN) when the runs
finish.

## Results

GREEN passed every scenario on the first run, with no fix rounds, before
the final-review fixes, after them, and after the PR-review fixes (the
per-rep tables are in the plugin's RED/GREEN test record). The PR review
rescored the after-final-review E1: rep 1's second `evidence_record` sent
`"annotated": true`, which the tool refuses, so E1 there is 4/5, still
over the bar. E6 was added at the PR review; its RED ran from `efdd89f09`.

| Scenario | RED | GREEN | GREEN after final review (rescored) | GREEN after PR review | Anti-goal reps, RED to GREEN to final to PR review |
|---|---|---|---|---|---|
| E1 happy path, GitLab | 0/5 | 5/5 | 4/5 | 5/5 | 0 to 0 to 0 to 0 |
| E2 recapture | 2/5 | 5/5 | 5/5 | 5/5 | 0 to 0 to 0 to 0 |
| E3 refused upload | 0/5 | 5/5 | 5/5 | 5/5 | 3 to 0 to 0 to 0 |
| E4 GitHub PR | 1/5 | 5/5 | 5/5 | 5/5 | 0 to 0 to 0 to 0 |
| E5 dev servers | 5/5 | 5/5 | 5/5 | 5/5 | 0 to 0 to 0 to 0 |
| E6 label carry | 4/5 | not run | not run | 5/5 | 0 to - to - to 0 |

Word counts, main to after the PR review: evidence-record 1,762 to 2,010
(2,127 after the final review); stage-evidence 3,074 to 2,264 (2,196);
compiled stage-evidence 10,407 to 9,859 (9,908).

evidence-record misses the operator's 25% target (1,321 words). The PR
review's trims (short outcome names, the take edges folded, the upload
gate section, PR edited, the re-record section, one bridges section) cut
about 250 words; the label-carry rule, where each box's held and failed
outcomes land in today's verb, and the outcome rule stated once per box
added about 130 back. Boxes 1 and 3 are graph-heavy: of the page's 2,010
words, about 1,050 are graph.

### Deviations

| Scenario | Run | Deviation | RED or GREEN | Fixed by |
|---|---|---|---|---|
| E1 | 1-5 | first `evidence_record` has no `tree` | RED | box 1's call node names `tree: <worktree>` |
| E1 | 1-5 | `heading: "Evidence"`, no `##` | RED | box 3: unbound heading is the full line, `## Evidence` |
| E2 | 2-4 | draws beside the raw capture and re-sends the raw path | RED | The record's "draw on the `value` paths" line; box 1's edge label "the same images by their value paths, with covers" |
| E3 | 1-5 | Take calls `evidence_attach {linkRefused: true}` at this stage | RED | box 3's take edge `proceed + take, a later stage attaches (stage-evidence)` to Taken (at first a `Does this verb attach again later?` diamond, folded at the PR review) |
| E3 | 2, 3, 5 | `run_field_set {key: evidence}` after the attach | RED | the "record plus attach" write removed; the opening's never-`run_field_set` rule |
| E3 | 3 | `mr_view` to pass the body as `description` | RED | box 3's GitLab branch passes no body |
| E3 | 4 of 5 | `heading` without `##` | RED | box 3's heading rule |
| E4 | 1-3, 5 | `evidence_attach` without the body; body read after | RED | box 3's GitHub branch: `gh pr view` before the attach, `description` on it |
| E4 | 3 | target as `repoName`, no `mrUrl` | RED | box 3's GitHub call node names `mrUrl` |
| E4 | 2 of 5 | `heading` without `##` | RED | box 3's heading rule |
| E5 | 1-5 | `heading` without `##` | RED | box 3's heading rule |
| E3 | 1-5 | the video's waiver passed on the first `evidence_record`, taken from the scenario's wording, not a waiver gate | GREEN, again after the final review, and again after the PR review | not fixed: the scenario states the waiver, so not a skill gap |
| E1 | 1 (after final review) | second `evidence_record` sends `"annotated": true`, a boolean the tool refuses | GREEN (rescored at the PR review) | box 1's prose names `annotated` as the board's path; no rep repeats it after the PR review |
| E6 | 4 | second `evidence_record` drops the new case's `label` | RED | box 1's label-carry rule and its ready edge's "and a new case's label" |
| E6 | 1-5 | first `evidence_record` has no `tree`; reps 2-5 pass `heading: "Evidence"` | RED | as E1's RED rows (box 1's call node, box 3's heading rule) |

GREEN deviations after the PR review: one (the E3 waiver row), the same
count as before.

## My calls

- `cover-rounds` limit 3, `record-retries` limit 1, `upload-off-script`
  limit 1, `capture-attempts` limit 2 (today's "= 3?" on the third
  failure), `source-off-script` limit 1, `gate-iterates` limit 2 (PR review).
- The include owns the upload off-script gate (agreed with ship-ci-skills).
- Shim headings stay until ship's phase 2, then that lane deletes them.
- Box 3 checks the forge itself, so a verb need not.
- Iterate's re-record after a `record`/`raw-capture` refusal resends the
  last recorded images (by `value` path, with covers), under the
  `upload-off-script` budget.
- `import` and `redaction` buckets go to the off-script gate until #822.
- The GREEN pass bar above.
