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
  for them only once phase 2 lands.
- **Fills are inlined whole.** The compiler has no anchor matching:
  `{{slot:domain}}` pastes the fill, and an `At:` heading is prose the agent
  maps to a node by sense. A renamed host node therefore breaks no compile
  or check; the fill's rules stay in the verb, under a heading that names
  the old node, until the pack replay renames it.
- **#822 (composed evidence) is still open.** Box 2 keeps main's draw
  (`<name>-annotated.<ext>`). Its `import` and `redaction` refusal buckets
  fall into box 3's "any other bucket" route (the off-script gate) until
  #822 adds its own route; main's guard never produces them.
- **Counters** follow ship-ci-skills' convention: `run_budget {key:
  evidence:<slug>, limit: N, stage}` each time the counted event happens,
  then a diamond `<slug> past its limit?` reading `spent > limit`. Holds go
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
   uncovered listed                          -> run_budget {key: evidence:cover-rounds, limit: 3, stage}
                                                -> cover-rounds past its limit?
                                                   no  -> Annotate or waive each image the record does not yet cover (evidence-record)
                                                   yes -> Failed: the images named
   error: the evidence field changed during this call
                                             -> run_budget {key: evidence:record-retries, limit: 1, stage}
                                                -> record-retries past its limit?  no -> the same call again; yes -> Failed, quoted
   any other error                           -> Failed, the error quoted
Annotate or waive outcome?
   ready                     -> evidence_record {..., the same images with their covers}
   held at evidence-waiver   -> Held: the verb's hold path
   waiver openings spent     -> Failed: the images named
```

The first call carries the captures as `path`s (plus labels for new
cases); every later call names the same images by the paths in the
returned `value`, with their covers. Outcomes: **Recorded**, **Held**,
**Failed** (reason). `cover-rounds` is 3:
the first call on raw captures always lists them, one correction, and one
re-record from box 3.

### Box 2: `Annotate or waive each image the record does not yet cover (evidence-record)`

Node text kept (ship and stage-ship draw it). Today's graph, fed by
`uncovered` (`{case, slot, theme?, path, why}`) instead of the agent
working out coverage, with two counters moved to `run_budget`:
- `evidence:draw-failures:<case>/<slot>[/<theme>]`, limit 1 (one retry);
- `evidence:waiver-openings:<case>/<slot>[/<theme>]`, limit 2.

The draw writes `<name>-annotated.<ext>` beside the run-folder copy. The
`evidence-waiver` gate, its table and selection are unchanged.

### Box 3: `Attach the evidence (evidence-record)`

Entered only after the verb's attach gate proceeds. The domain supplies
`heading`, `before` and `appendix`; unbound, `heading` is the repo MR
template's evidence heading when it has one, else `## Evidence`.

```
Attach the evidence (ellipse)
-> Forge host?
   GitLab -> evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl}
             -> evidence_attach result?
                descriptionWritten, or notWritten: unchanged   -> Attached (green)
                refused: record or raw-capture                 -> run_budget {key: evidence:record-recalls, limit: 1, stage}
                                                                  -> record-recalls past its limit?
                                                                     no  -> Record the evidence (evidence-record) [the named files]
                                                                            -> Recorded -> evidence_attach (again)
                                                                     yes -> STOP
                any other refused bucket, or timedOutTwice     -> STOP
                tempted to copy the file or upload another way -> STOP
                writeErrors, or the call refused               -> Failed, quoted
             STOP: a refused file moves only by the human's hand
             -> Off-script gate: upload refused (gate-protocol, scope off-script:<stage>:<n>)
             -> upload off-script answer?
                proceed + take       -> Does this verb attach again later?
                                        yes (stage-evidence: ship attaches) -> Taken: nothing written
                                        no (ship)  -> evidence_attach {..., linkRefused: true} -> take result?
                                                      descriptionWritten -> Attached; writeErrors -> Failed, quoted
                proceed + hand back  -> Failed, the refusal quoted
                iterate              -> run_budget {key: evidence:upload-off-script, limit: 1, stage}
                                        -> past its limit? no -> evidence_attach (again); yes -> Failed, quoted
                hold                 -> Held: the verb's hold path
   GitHub -> gh pr view <n> --json body
             -> evidence_attach {runDb, stage, heading, before?, appendix?, mrUrl, description: <the body>}
             -> gh pr edit <n> --body-file <a file holding the returned description>
             -> Attached
```

A `record` or `raw-capture` refusal means the record the guard reads is
not the one box 1 wrote (the field changed, or box 1 never wrote). The
re-record sends box 1 the same images the verb last recorded, by their
`value` paths with their covers, once; the next refusal goes to the gate.

Outcomes: **Attached**, **Taken** (refused files left for a later attach),
**Held**, **Failed** (reason). Box 1's Held and
Failed reached from here are box 3's Held and Failed.

The off-script gate node lives in the include, so each verb that inlines
it gets its own copy, scoped `off-script:<stage>:<n>` with `n` shared with
the verb's other off-script gates. Its section keeps today's rule: Take
links the refused files' local paths (the tool records them so the next
attach sends them again); Iterate means the human moved the file, widened
`rt.mcp.uploadRoots` or recaptured; copying a file under an allowed root is
only ever the human's move.

### Kept sections

- **Domain precedence**, reworded: a domain rule that keeps a base capture
  with no waiver, uploads outside `evidence_attach`, or writes the record
  outside `evidence_record` is overridden by this page.
- **Bridge sections** (until ship's phase 2 deletes them), written for a
  verb that still draws the old nodes:
  - `Merge into the record`: run box 1 here. It merges, covers (box 2
    inside it) and writes, so the verb's own box 2 pass and its
    `run_field_set` evidence write that follow are already done: skip them.
  - `Write before upload`: box 1 wrote the record; never write `evidence`
    with `run_field_set`.
  - `Upload only what the record allows` and `The evidence section of the
    description`: where the verb's own upload loop starts, run box 3
    instead; it uploads, renders and writes the section, so skip the verb's
    `mr_upload`, `mr_view` and `mr_update` nodes.

### Removed

The JSON example, the merge table, the string-serialization rule, the
upload-set rule, the per-file retry rules and the section format. Each is
now inside a tool, and the tool's own description carries what a caller
must know.

## stage-evidence, after

Kept as is (node text and sections): entry, the `evidence-plan` and
`worktree` reads, the domain steps box, the `rt_verb` STOP, the evidence
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
| `Domain attaches evidence to an MR here?` -> `run_field_get branch` -> `mr_for_branch` | the same, plus `Forge host?` from `git -C <worktree> remote get-url origin`: GitHub -> `gh pr view <branch> --json number,url` |
| the upload off-script gate section | moves into the include (box 3) |
| `run_decision {... hold:evidence:<attempt> ...}` + `run_field_set {key: hold, ...}` | `run_hold {runDb, stage: evidence, reason, decidedBy}` |
| `Attempts for this case = 3?`, `Off-script rounds = 2?` | `run_budget` pairs (`evidence:capture-attempts:<case>`, limit 2; `evidence:source-off-script`, limit 1) |
| Capture section: "store under `~/.mattstack/work/<run id>/evidence/`" | leave the capture where it was written; box 1 files it. A text capture goes to a file in the session temp root and rides as `transcript`. |
| Domain rules tail: the four encodings and "`value` is a string" | one line: finish through box 1; ship adds the AFTERs to the same record. |

## Fill anchors (for the pack replay)

| Fill section (both evidence fills) | Host node today | After |
|---|---|---|
| `At: mr_upload {mrUrl, path} per file; keep each markdown` | `mr_upload {mrUrl, path, runId} per uploadable file; keep each markdown` (already drifted: no `runId`) | `Attach the evidence (evidence-record)`. The fill's rules there become the `heading`, `before` and `appendix` it passes (ingestion's `<details>` text blocks are the `appendix`); the per-file upload text and the "never copy" line go. |
| `At: Capture the BEFORE` | `Capture the BEFORE for the next case` (already drifted) | unchanged host text; the replay renames the fill heading to match. |
| `At: Run the domain steps before the gate (none when unbound)` | unchanged | unchanged. The replay can route the target graph's port lookups to `dev_endpoints` and drop the `rt.mcp.uploadRoots` read. |
| `At: Gate evidence (table below)` | unchanged | unchanged. The `upload_root` question is obsolete: captures no longer need an upload root. |
| `At: Gate evidence-attach (table below)` | unchanged | unchanged. Drop the `rt.mcp.uploadRoots` re-read. |
| the "evidence tree" paragraphs | none | obsolete: captures stay where taken and box 1 files them. |

## Behavior changes

| # | Change | Status |
|---|---|---|
| C1 | The record is written by `evidence_record`, which copies captures (whole bundles) into `~/.mattstack/work/<run id>/evidence/<case>/` and never rewrites a file there, instead of hand-built JSON through `run_field_set`. | Approved in wave 2 (tools B1, B8). |
| C2 | Upload and the description splice go through `evidence_attach`: earlier uploads are reused by sha256, and `evidence` is no longer rewritten with "the record plus attach" after the description write. | Approved in wave 2 (tools B2, B5). |
| C3 | A `missing` refusal (path not found, not absolute) goes to the off-script gate instead of a corrected-path retry. Paths now come from the record, so there is nothing for the agent to correct. | My call. |
| C4 | A file that times out twice is reported with the rest still uploaded, instead of stopping at the first. | Tools B6. |
| C5 | (dropped) Take at stage-evidence stays as today: nothing is written, and ship's attach sends the refused files again. | Shepherd's condition on gate `269aef04`: `linkRefused` prints bare absolute local paths into an employer-visible description. Ship's Take (phase 2, ship-ci-skills) keeps today's local-path link, a pre-existing leak; a tool follow-up (a neutral "<file name> (attached separately)" link for linked files, `lib/evidence/section.ts`) is flagged to the shepherd (DM #6040). |
| C6 | On GitHub, stage-evidence finds the PR with `gh pr view` and writes the section through `gh pr edit`. Today it calls `mr_for_branch`, which is GitLab-only and fails. | Bug fix. |
| C7 | Dev-server ports come from one bounded `dev_endpoints` call instead of the domain's `rt endpoint lookup` reads and curl probe. | Tools ruling (C3 in recon). |
| C8 | Loop counters persist on the run through `run_budget`, so they survive compaction and resume; holds use `run_hold` (same decision and field). | My call, matching ship-ci-skills. |
| C9 | Unbound, the section heading is the MR template's evidence heading, else `## Evidence`. Today it is unspecified. | My call. |
| C10 | A capture whose source sits outside the tool's allowed sources fails the stage with the refusal quoted. Today nothing checks it. | My call: a new location is not the agent's to invent. |

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
| E3 refused upload | `refused.roots` opens the off-script gate scoped `off-script:evidence:<n>` quoting the refusal; on Take, the stage ends with nothing written (no `linkRefused` call at this stage); no copy, no `mr_upload` |
| E4 GitHub PR | no `mr_for_branch` or `mr_upload`; `gh pr view`, `evidence_attach` with `description`, `gh pr edit --body-file` |
| E5 dev servers | one `dev_endpoints {tree, roles}`; no `rt_verb` endpoint lookup, no curl loop |

GREEN passes a scenario when no run makes an anti-goal call (a
`run_field_set` evidence write, an evidence `mr_upload`, an `mr_update` of
the section, a copy of a refused file) and at least 4 of 5 runs meet every
pass item. A miss changes the skill text and reruns that scenario's 5, at
most 3 rounds, then the table goes to the shepherd. The spec gets a
deviation table (scenario, run, deviation, RED or GREEN) when the runs
finish.

## My calls

- `cover-rounds` limit 3, `record-recalls` limit 1, `upload-off-script`
  limit 1, `capture-attempts` limit 2 (today's "= 3?" on the third
  failure), `source-off-script` limit 1.
- The include owns the upload off-script gate (agreed with ship-ci-skills).
- Shim headings stay until ship's phase 2, then that lane deletes them.
- Box 3 checks the forge itself, so a verb need not.
- The re-record after a `record`/`raw-capture` refusal resends the last
  recorded images (by `value` path, with covers) rather than going straight
  to the gate, because "box 1 never wrote" is fixable by the agent.
- `import` and `redaction` buckets go to the off-script gate until #822.
- The GREEN pass bar above.
