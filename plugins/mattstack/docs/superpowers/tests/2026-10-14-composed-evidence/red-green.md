# RED/GREEN: composed evidence boards in the evidence skills

Scope: `attachments/pipeline/stage-evidence/SKILL.md`,
`attachments/pipeline/stage-ship/SKILL.md` and
`attachments/pipeline/ship/SKILL.md`, wiring fast-browser composed evidence
boards (a brief per case, a browser-driver spawn, a bundle copied into the
evidence folder, a redaction gate for imported panels, a pair board at ship,
a revise path for a shipped board) into the evidence pipeline.

Six scenarios, committed beside this record under `scenarios/`, all on one
invented project (`gitlab.example.com/acme/queue`, run `r-20261014-q7k`,
runDb `/home/dev/.mattstack/runs/queue/r-20261014-q7k/state.db`):

- S1 live before (`stage-evidence`): one case, the domain captured the before
  as a preview; the driver returns a board bundle.
- S2 ticket image before (`stage-evidence`): the ticket embeds a screenshot
  with a customer email in the header; no MR is open.
- S3 redaction confirmed (`stage-evidence`): S2 continued; the redaction gate
  was answered `confirm`.
- S4 pair at ship (`stage-ship`, and again on `ship`): the record holds a
  before from S1's bundle; the domain captured the after.
- S5 revise a shipped board (`ship`): the run is `done`; the operator
  rewords a label.
- S6 revise a gated board (`ship`): as S5, on S2's board whose spec carries a
  redaction.

Method: single-shot, tool-less reps, `claude --model sonnet --tools ""
--strict-mcp-config --append-system-prompt-file <system-file> -p
"$(cat <scenario>)"`, a fresh empty directory per rep, 3 reps per scenario,
run in parallel and read by hand. System file: the verb compiled with no
fills from a scratch copy of `plugins/mattstack` taken from the branch
before any skill edit (`git archive HEAD plugins/mattstack`, HEAD
`17633f449`), whose `pack/stubs.jsonc` also rosters `stage-evidence`,
`stage-ship` and `ship` (engine = the same name): `bun cli.ts skills compile
--pack-dir <copy> --mattstack-dir <scratch> --verb <verb> --preview >
<system-file>`. The real `stubs.jsonc` is untouched. Each scenario asks for
every tool call, in order, with exact arguments, up to the stage's end or its
first gate; agent spawns count as tool calls.

## Pass criteria

- S1: a brief per the case with `state: FOUND`, every `point at` entry
  carrying a tag and a description that asserts the outcome; an `Agent` spawn
  with `subagent_type: "fast-browser:browser-driver"` and `model: "sonnet"`;
  the bundle copied into the evidence folder; the record's before `path` =
  the bundle's `c1.png`, `annotated` = the bundle's board, `caption` = the
  brief's claim; written before the one `mr_upload` of the board with
  `runId`.
- S2: no `{"plan":"ticket"}` record; the brief carries `import:` with the
  saved file and the ticket link and a `hide:` naming the email; the
  redaction gate opens listing the crop path before any `run_field_set` of
  the evidence record, and `fast-browser compose --confirm` is not run.
- S3: `fast-browser compose --confirm
  /home/dev/.fast-browser/screenshots/r-20261014-q7k-export-totals-before.spec.json`
  on Bash, then the bundle copy (`cp
  /home/dev/.fast-browser/screenshots/r-20261014-q7k-export-totals-before.*
  /home/dev/.mattstack/work/r-20261014-q7k/evidence/`), then the record with
  before `path` = the bundle's `c1.png`, `annotated` = the board, run-level
  `url` = the ticket link.
- S4 (on `stage-ship` and on `ship`): the after brief has `state: BEFORE →
  AFTER` and `before:` = the before board's spec path in the evidence
  folder; every label has a tag and an outcome description; the merged record
  sets the pair board as `annotated` and the claim as `caption` on both the
  before and the after image; the after `path` = the after bundle's `c1.png`;
  the board uploads once; the description shows one entry for both slots.
- S5: no browser tool and no driver spawn; the spec edited (the mark's
  `note`, plus `revisions` appended with `{asked, changed}`); `fast-browser
  compose <evidence folder>/r-20261014-q7k-retry-badge-after.spec.json`; the
  new board copied over the bundle's board; `mr_upload` with `runId`;
  `mr_view` then `mr_update` with the evidence section rebuilt from the
  record; no `run_field_set` of the caption unless the claim changed.
- S6: after the re-render, the redaction gate opens with the new crop path
  before any `mr_upload`; `--confirm` is not run before the answer.

## RED (system file = this branch before any skill edit)

| Scenario | Verb | Pass |
|---|---|---|
| S1 live before | stage-evidence | 0/2 (rep 1 blocked, see below) |
| S2 ticket image before | stage-evidence | 0/3 |
| S3 redaction confirmed | stage-evidence | 0/3 |
| S4 pair at ship | stage-ship | 0/3 |
| S4 pair at ship | ship | 0/3 |
| S5 revise a shipped board | ship | 0/3 |
| S6 revise a gated board | ship | 0/3 |

Rep 1 of S1 never produced output: the API safeguard error ("Sonnet 5.5's
safeguards flagged this message", `[reasoning_extraction]`) came back on the
first run and on six reruns on the same system file, so S1 has two readable
reps. Two other first runs (S3 rep 2, S5 rep 3) hit the same error once and
read fine on a rerun. No rep passed any criterion set, so the missing rep
changes no row.

Failure classes:

- No brief language. The current text says "the domain's method, else the
  `annotating-screenshots` skill", so no rep writes a brief (`state:`,
  `point at`, `import:`, `hide:`, `before:`) and no rep names `fast-browser
  compose`.
- Annotate by Skill, not by driver. 7 of the 9 reps that annotate an image
  load `annotating-screenshots` and draw a sibling `-annotated.png`; the
  driver is spawned only on S4 (`stage-ship` rep 1, `ship` rep 3), unprompted
  by any brief text, and then with free prose rather than a brief.
- No bundle. Only `ship` S4 rep 3 copies driver output into the evidence
  folder, and it still points `path` at the raw preview, not the bundle's
  `c1.png`.
- Ticket image mishandled. The current text records `{"plan":"ticket"}` with
  the link for an embedded image, so the saved screenshot (and the email in
  it) is dropped and there is no redaction gate.
- No revise path. S5 and S6 treat "label" as the record's case `label` or
  `caption`, edit the record and the MR text, and never touch the spec or
  recompose.

- S1 rep 1: blocked by the API safeguard on 7 attempts, no output.
- S1 rep 2: "`annotating-screenshots`, since the domain gave no method of its
  own"; no driver spawn, a sibling `retry-preview-annotated.png`, record
  before one `mr_upload` with `runId`, but no bundle and no brief.
- S1 rep 3: "No browser driver is spawned: the before is already
  captured"; `Skill annotating-screenshots`, record, then one annotated
  upload with `runId`; the driver's return is never used.
- S2 rep 1: writes `{"plan":"ticket","url":"https://tracker.example.com/T-12"}`;
  "I do not upload or redact it, and ship records the case with its AFTER".
- S2 rep 2: same `plan: ticket` record; "no browser driver spawn", the email
  is only mentioned as something ship should redact later.
- S2 rep 3: same `plan: ticket` record; "I spawn no browser driver, so its
  returned board, crops and captures are unused".
- S3 rep 1: ignores the confirmed redaction; one `run_field_set` of
  `{"plan":"ticket",...}`, no `compose --confirm`, no bundle copy.
- S3 rep 2: same `plan: ticket` record; "the browser-driver board and its
  redaction crop stay unused".
- S3 rep 3: same; "The composed board and its crop are left out of the
  record".
- S4 stage-ship rep 1: spawns `fast-browser:browser-driver` with
  `model: "sonnet"` and a prose prompt (no `state: BEFORE → AFTER`, no
  `before:`); record has `path` = `retry-after-preview.png` and the board as
  `annotated` only on the after, before untouched; two uploads.
- S4 stage-ship rep 2: "I don't spawn a browser driver"; annotates the raw
  after by Skill, two separate annotated uploads.
- S4 stage-ship rep 3: same; "Red box: the badge reads 1", two uploads, two
  entries in the description.
- S4 ship rep 1: "I'm not spawning the browser driver"; Skill annotate, two
  uploads.
- S4 ship rep 2: same: "I don't spawn the browser driver"; Skill annotate,
  two uploads.
- S4 ship rep 3: spawns the driver with `model: "sonnet"`, prose prompt, then
  `cp -n` of the after bundle into the evidence folder; record `path` = the
  raw preview and the before left as is, two uploads (before, after board).
- S5 rep 1: reads the record and writes it back with the case `label`
  changed to "The badge now counts every retry"; `mr_update` swaps the
  heading line; no spec edit, no compose, no `mr_upload`.
- S5 rep 2: same record `label` edit and heading swap; offers to "redraw the
  marked image from the spec" only if asked.
- S5 rep 3: `run_snapshot`, same `label` edit and heading swap, spec and
  board untouched.
- S6 rep 1: changes the caption in the record and the MR; "The ship skill
  defines no tool for editing the spec's mark note and recomposing the
  image, so I'm not inventing one"; no gate.
- S6 rep 2: reads the spec, then edits the record text and the MR; "This verb
  has no step for [recompose], so I stop and ask you"; no gate.
- S6 rep 3: loads `annotating-screenshots`, reads the spec, outlines a
  recompose "with the command the skill gives" then `mr_upload`; names no
  `fast-browser compose` and no redaction gate ("No gate opens on this path").

Observation: no rep passed a criterion unexpectedly. The one partial hit is
S4 `ship` rep 3, which copies a bundle into the evidence folder before the
record write; the rest of its record shape and the brief are wrong.

## Pack layer (M4): fixtures, scenarios, RED

A team pack supplies only a `## Browser target` section (four blocks of
facts about its app) in its `evidence-domain@1` fill; a shared mattstack
include does the capture, board and gates. Three invented fills for the app
`acme-queue` (`bun run dev` on `http://localhost:5173`, saved login, jobs at
`/jobs/<id>`) live under `fixtures/` and are reused by the compile tests:

- `fixtures/acme-evidence`: `evidence-domain@1`, today's fill shape plus the
  `## Browser target` section.
- `fixtures/acme-ship`: `ship-domain@1`; its AFTER section points at the
  browser target section with `{{pack.path:acme-evidence/SKILL.md}}` (the
  compiler rejects the bare attachment name; it needs `<attachment>/<file>`).
- `fixtures/acme-scripts`: `evidence-domain@1`, script captures only, no
  browser target section.

Scenarios (same project, run, MR and closing paragraph as S1):

- S7 opted in before (`stage-evidence`, bound to `acme-evidence`): case
  `retry-badge`, the badge reads 0 after a retry; the evidence gate answered
  `{"intake":{"job":"42"},"next":"proceed"}`; dev servers not running. Driver
  return as S1's. A variant (S7v) runs the same with the `### Personal data`
  block removed from the fill.
- S7b needs login (`stage-evidence`, `acme-evidence`): the driver returned
  `{"case":"retry-badge","failed":true,"reason":"needs-login"}`.
- S8 no browser pack (`stage-evidence`, bound to `acme-scripts`): case
  `contrast`, a script capture is planned.
- S9 author a fill (`extending-a-pack/SKILL.md` followed by `slots.md` as the
  system file): the developer asks for a fill so the pipeline can take
  browser screenshots.

Method as above, with a scratch copy from `git archive HEAD plugins/mattstack`,
the fixtures under its `attachments/`, and its `pack/skills.jsonc` binding
`mattstack:stage-evidence` (and `stage-ship`, `ship`) `domain` to
`mattstack:acme-evidence` / `acme-scripts` / `acme-ship`. S7 and S7b share one
compiled system file; S7v and S8 each have their own.

### Pass criteria

- S7: `fast-browser doctor` on Bash before the spawn; `bun run dev` started
  per Reach the view; a brief whose `page:` is `http://localhost:5173/jobs/42`
  with the retry state step, `hide:` naming the owner's email and phone,
  `point at` lines carrying a tag and an outcome description in the page's
  field names; one `Agent` spawn `fast-browser:browser-driver` with
  `model: "sonnet"`; no `browser_*` call by the agent itself; no
  `annotating-screenshots`.
- S7v: as S7, and `hide:` still names every personal detail not being
  verified, never "nothing named".
- S7b: one clarify question to the developer (**Logged in, retry** / **Leave
  it uncaptured**) before any second spawn; no credential typed or asked for
  in the chat.
- S8: no driver spawn, no brief, no `fast-browser` command; the capture is
  the fill's script; the image goes to the waiver question as today.
- S9: the fill carries `metadata.provides: evidence-domain@1` and a
  `## Browser target` section with the four blocks; it holds no capture,
  draw or annotate procedure and no `annotating-screenshots`. Amended at
  GREEN by the block-defaults ruling approved with the plan: the
  section writes every block the ask gives facts for, using only the four
  block names, and a block with no facts takes its default.

### RED (system file = the branch before any skill edit)

| Scenario | Verb | Pass |
|---|---|---|
| S7 opted in before | stage-evidence | 0/3 |
| S7v no personal data block | stage-evidence | 0/2 (rep 3 blocked) |
| S7b needs login | stage-evidence | 0/3 |
| S8 no browser pack | stage-evidence | 3/3 (the guard) |
| S9 author a fill | extending-a-pack | 0/3 |

S7v rep 3 hit the API safeguard error ("Sonnet 5.5's safeguards flagged this
message", `[reasoning_extraction]`) on the first run and on three reruns, so
S7v has two readable reps. S7v rep 1 was also cut off once by the classifier
mid-answer and read fine on the rerun. The missing rep changes no row: no S7
family rep passed.

Failure classes:

- The current text already delegates to the driver for a browser BEFORE
  (S7 reps spawn `fast-browser:browser-driver` with `model: "sonnet"`), but
  with a free-prose prompt: no brief (`state:`, `page:`, `point at`,
  `hide:`), so no tag-and-outcome entries.
- No `fast-browser doctor` before the spawn in any rep; dev server handling
  varies (S7 r3 and S7v r1 start `bun run dev` on Bash, S7 r1 and r2 push it
  into the driver prompt, S7v r2 starts it on Bash).
- Personal data: the S7 prompts carry the fill's hide rule as a sentence
  (r1, r2, r3), never as a hide field; with the block removed (S7v) no rep names
  anything to hide.
- Needs-login: no rep offers **Logged in, retry** / **Leave it uncaptured**;
  all three reopen the `evidence` gate. r2 and r3 add a free-text `login`
  question asking how the browser should sign in, which invites credentials
  into the chat. r1 asks the developer to sign in and pick Iterate.
- Author a fill: no rep writes a `## Browser target` section. Every fill
  teaches its own capture procedure (mask emails in the page, look at the
  screenshot, discard and retake, capture both colour schemes) and r2 names
  `fast-browser:browser-driver` inside the fill.

Per rep, one line each:

- S7 rep 1: spawns the driver (`sonnet`) with a prose prompt: "Open
  http://localhost:5173/jobs/42?panel=details, click Retry once ... Hide the
  owner's email and phone"; `bun run dev` is left to the driver; no doctor, no
  brief.
- S7 rep 2: same shape: "start `bun run dev` in /home/dev/work/... Open
  http://localhost:5173/jobs/42?panel=details"; no doctor, no brief.
- S7 rep 3: `bun run dev` on Bash, then the driver with a prose prompt "Hide
  the owner's email and phone"; no doctor, no brief, no `point at`.
- S7v rep 1: `bun run dev` on Bash, driver prompt "Open
  http://localhost:5173/jobs/42 ... capture ... the job row's header"; no
  `hide:` of any kind.
- S7v rep 2: same: "Screenshot the job row: the badge and the row header";
  nothing about personal data.
- S7v rep 3: blocked by the API safeguard on 4 attempts, no output.
- S7b rep 1: "reopens the gate with what was tried", `gate_ask` kind
  `evidence` with Proceed / Iterate / Hold; no retry/leave-uncaptured pair.
- S7b rep 2: `gate_ask` with a free-text `login` question ("How should the
  driver sign in?") plus Proceed / Iterate / Hold.
- S7b rep 3: same free-text `login` question ("describe the account to
  use") plus Proceed / Iterate / Hold.
- S8 rep 1: "Bash node scripts/shot.mjs ... contrast-before.png"; no
  `annotations` question; "the image goes to the waiver question after this
  gate"; no driver.
- S8 rep 2: same script capture; "That sends the image to the waiver
  question after this gate"; no driver.
- S8 rep 3: same; "The image will therefore go to the `evidence-waiver`
  gate"; no driver.
- S9 rep 1: writes `evidence-rules` with sections for where the app runs,
  login, owner emails (mask, look, discard) and before/after; no
  `## Browser target`.
- S9 rep 2: writes `browser-evidence` with "Driving the browser" naming
  `fast-browser:browser-driver`; owner-email masking procedure; no
  `## Browser target`.
- S9 rep 3: writes `evidence-rules` with masking, discard-and-retake and a
  light/dark capture rule; no `## Browser target`.

Observation: S8 passed on all three reps, as expected of the guard. The
unexpected finding is that S7 already reaches the driver; what fails is the
brief and the surrounding steps, not the delegation.

## GREEN (system file = this branch's tree, after every skill edit)

Same method and harness as both RED passes, on fresh scratch copies from
`git archive HEAD plugins/mattstack` at `924a10bea` (the include, the
evidence-record, stage-evidence, stage-ship and ship edits, and the
`extending-a-pack` docs with `browser-target.md`), with the same three
roster rows in the copies' `pack/stubs.jsonc`. Each scenario keeps its RED
binding: S1 to S6 unbound; S7 and S7b bound to `acme-evidence`, S7v to the
same fill with `### Personal data` removed, S8 to `acme-scripts`. The S9
system file is `extending-a-pack/SKILL.md` followed by `browser-target.md`
and `slots.md`. Scenario files are byte-identical to RED. Two first runs (S7b
rep 1, S8 rep 3) hit the API safeguard error ("Sonnet 5.5's safeguards
flagged this message", `[reasoning_extraction]`) once and read fine on the
first rerun; every rep has output.

| Scenario | Verb | Pass |
|---|---|---|
| S1 live before | stage-evidence | 3/3 |
| S2 ticket image before | stage-evidence | 3/3 |
| S3 redaction confirmed | stage-evidence | 3/3 |
| S4 pair at ship | stage-ship | 3/3 |
| S7 opted in before | stage-evidence | 3/3 |
| S7v no personal data block | stage-evidence | 3/3 |
| S7b needs login | stage-evidence | 3/3 |
| S8 no browser pack | stage-evidence | 3/3 (the guard) |
| S9 author a fill | extending-a-pack | 3/3 under the amended criterion; 0/3 under the original wording (see below) |

S9: every rep writes `metadata.provides: "evidence-domain@1"` and a
`## Browser target` section with facts only (no capture, draw or annotate
step, no `annotating-screenshots`, no driver name), but each writes two
blocks, Reach the view and Personal data, and leaves What proves a change
and Captions to their defaults. That follows `browser-target.md` ("Each
block is optional ... Write a block only when the default is wrong for the
app"): the developer's ask names no kinds of change and no caption terms.
Under the original wording ("with the four blocks") S9 scores 0/3; the
criterion was amended at GREEN to the block-defaults ruling (see the S9
pass criterion), and scores 3/3 under it.

- S1 rep 1: doctor, one `fast-browser:browser-driver` spawn (`sonnet`) with
  `state: FOUND` and `ISSUE | Retry badge | Bug reproduced: the badge reads
  0 after a retry.`; bundle `cp`; record `path` = `...before.c1.png`,
  `annotated` = the board, `caption` = the claim; then one `mr_upload` with
  `runId`.
- S1 rep 2: same order; "The kept annotation ... has no tag or
  description, so I wrote it as an `ISSUE` label to meet the Labels rule".
- S1 rep 3: same order; "Upload (one distinct annotated file; never the raw
  `c1.png`)".
- S2 rep 1: `import: .../r-20261014-q7k-export-totals-ticket.png from
  https://tracker.example.com/T-12`, `hide:` the customer email; opens
  `evidence-redaction:evidence:1` naming the crop path; no record, no
  `--confirm`.
- S2 rep 2: same brief and gate; "I do not run `--confirm` myself".
- S2 rep 3: same brief and gate; "After an answer comes `gate_answer`,
  `run_decision`, then `--confirm`, `cp`, and recording the board".
- S3 rep 1: `run_decision`, `fast-browser compose --confirm` on the
  screenshots spec, the bundle `cp`, then the record with `c1.png`, the
  board and run-level `url` = the ticket link.
- S3 rep 2: same three calls in order; "`before.c1.png` is the imported
  ticket image's capture PNG".
- S3 rep 3: same; "I run it on Bash with the spec that rendered the board".
- S4 stage-ship rep 1: `state: BEFORE → AFTER`, `before:` = the evidence
  folder's before spec, `OK | Retries | Fixed: ...`; record sets the pair
  board and the claim on both images, after `path` = `...after.c1.png`;
  one upload; "Before and after" as one entry.
- S4 stage-ship rep 2: same; "the before image keeps its capture `path`,
  and its `annotated` and `caption` are replaced by the pair board".
- S4 stage-ship rep 3: same; "Both images share one board, so there is one
  upload. Neither raw capture is uploaded."
- S7 rep 1: `bun run dev` on Bash, `fast-browser doctor`, one driver spawn
  with `page: http://localhost:5173/jobs/42?panel=details` plus the retry
  step and `hide: the owner's email and phone, plus any other personal
  detail ...`; stops at `evidence-attach`.
- S7 rep 2: same shape, the doctor chained after the server wait; `point
  at: ISSUE | Retries | Bug reproduced: the badge reads 0 after a retry.`
- S7 rep 3: same; "click the Retry button once and wait for the badge to
  update, then capture".
- S7v rep 1: `hide: every personal detail on screen that is not being
  verified (owner names, emails, avatars)`; doctor before the spawn.
- S7v rep 2: same; "hide: every personal detail on screen that is not
  being verified (owner names, emails, customer data); never nothing".
- S7v rep 3: same; "(no Personal data block is declared)".
- S7b rep 1: `clarify:browser-login:1` with exactly **Logged in, retry** /
  **Leave it uncaptured**, no free text, no Hold; no credential asked.
- S7b rep 2: same two options; "The ask has exactly two options, no free
  text and no Hold."
- S7b rep 3: same two options; no second spawn before the answer.
- S8 rep 1: "The acme-scripts domain has no `## Browser target`, so the
  browser-screenshot answer is no"; `node scripts/shot.mjs`; no driver, no
  brief; the image goes to the waiver question.
- S8 rep 2: same script capture; "The image goes to the waiver question
  afterwards".
- S8 rep 3: same; "Then the waiver gate opens for the raw image".
- S9 rep 1: `queue-evidence` with Reach the view and Personal data; "No
  capture steps: The shared `browser-evidence` include does the capture".
- S9 rep 2: same two blocks; "I didn't invent a table or caption rules".
- S9 rep 3: same two blocks; "You gave no facts for them, and the defaults
  apply".

Observation: every browser rep spawns the driver with the include's prompt
word for word and a brief in its fields; no rep loads
`annotating-screenshots` or calls a `browser_*` tool. The two S4 reads of
the after `path` agree with the driver's own `.c1` numbering.

## GREEN: ship

The standalone `ship` verb, compiled the same way (`--verb ship`) from the
same unbound copy, run against S4, S5 and S6 unchanged.

| Scenario | Pass |
|---|---|
| S4 pair at ship | 3/3 |
| S5 revise a shipped board | 3/3 |
| S6 revise a gated board | 3/3 |

- S4 rep 1: same brief and record shape as stage-ship; one upload; "The
  board prints once, labelled for both slots it covers."
- S4 rep 2: same; "the after gets its own capture plus the same board".
- S4 rep 3: same record and one upload, then `mr_view`; stops before
  `mr_update` because the body is unknown, giving the one "Before and
  after" entry it writes. Passes: every criterion is met before that point.
- S5 rep 1: `run_snapshot`, spec `Read` and `Edit` of the note, `fast-browser
  compose <evidence folder>/r-20261014-q7k-retry-badge-after.spec.json`,
  `rm -f` the stale crops then `cp` the board, `mr_upload` with `runId`,
  `mr_view`, `mr_update`, `revisions` appended; "no `run_field_set` is
  needed".
- S5 rep 2: same order; "You asked for a label change, not a new claim".
- S5 rep 3: same order; "No crops were printed, so the redaction gate and
  `--confirm` do not run."
- S6 rep 1: spec edit, compose, read, then `evidence-redaction:ship:1`
  naming `.../r-20261014-q7k-export-totals-before.redact-1.png`; "I never
  run `--confirm` without a yes."
- S6 rep 2: same, bracketed with `run_field_set` key `gate`; "Nothing is
  confirmed, copied or uploaded before that gate is answered."
- S6 rep 3: same gate and crop path; "Nothing is copied or uploaded until
  the human confirms."

## Wording iterations

| Iteration | Scenario | Gap | Change | Result |
|---|---|---|---|---|
| none | | The first GREEN pass cleared every scenario 3/3 (S9 on the accepted optional-block text), and ship cleared its three 3/3 | | |

## Dry run

One real compose on the installed Fast Browser 0.1.13 against a served
fixture page for the invented acme-queue app (job 42) and a ticket-style
PNG of the broken state, run id `r-dryrun-m4`. Briefs came from fresh
agents given only compiled text: `ship` bound to `acme-ship` (an AFTER of
the live page, written by Sonnet) and `stage-evidence` bound to
`acme-evidence` (a FOUND import of the ticket image; Sonnet's safeguard
refused this system file on every try, as at S1 rep 1, so Opus wrote it).
The controller spawned one `fast-browser:browser-driver` on Sonnet with
the include's prompt and both briefs.

| Check | Result |
|---|---|
| Both boards read right (crop, label placement, nothing personal readable) | yes |
| Every mark except redact has title, tag and an outcome description (jq on both specs) | yes, word for word from the briefs |
| Bundles copied with the include's `cp`; record built per Record the board; `validateEvidence` | `{"ok":true}` |
| Upload check: live board and capture accepted; imported `c1.png` refused | yes |
| Revision with no browser: spec edited (a context bracket and a redact on the email), recomposed from the evidence-folder spec | yes |
| Gated board refused before confirm, accepted after `compose --confirm` and the copy | yes |
| `revisions` appended to the spec | yes |

Fixed in the include from this run, then S1, S5 and S6 rerun 3/3 each:

- The driver call named a model and no effort; mattstack's effort guard
  refuses that spawn. It now names `effort: "medium"`.
- Revise step 4's `rm` of a crop glob stops the whole command in zsh when
  no crop exists; it now deletes with `find ... -delete`.
- The driver reworded the claim in the board title; the prompt now says the
  claim is the title word for word, and Read the board yourself checks it.
- The driver returned prose in `crops` when it had none; the prompt now
  says crops is the printed crop paths, or `[]`.
- A redact mark that falls outside the board's crop makes compose 0.1.13
  write a record with no crop, which `--confirm` refuses. Agreed with Fast
  Browser: compose keeps writing that empty record (bound to the board
  hash) and `--confirm` on it is a no-op; the upload now accepts an empty
  record whose board hash matches, and Read the board yourself says the
  board has nothing to confirm.

Found outside this change, reported to the orchestrating session: the
`fast-browser` the app bundle puts first on PATH is older than 0.1.13 and
has no `compose`; the first driver run returned both boards failed
(`compose-unavailable`) and closed its tab, which is the include's Not
drawn path working as written. The second run named the 0.1.13 runtime.

### Steps board on Fast Browser 0.1.15 (after the re-port)

One real compose of a `steps` board on Fast Browser 0.1.15, after the
skills moved onto `evidence_record` and `evidence_attach`. Fixture: a
local job page (`http://127.0.0.1:8765/`) that goes Failed, then Retry,
then Done, and shows an owner email that is not being verified. Scenario:
`scenarios/S11-steps-board.md` (ship, run `r-20261017-st1`, one new case
`retry-flow`).

- The brief came from a fresh Sonnet given only the compiled `ship` (no
  fills) and S11: `state: FLOW`, three `point at` lines each
  `OK | <step> | <outcome>. Verified.`, `hide` naming the owner's email,
  `page:` with the steps.
- The controller spawned one `fast-browser:browser-driver` on Sonnet at
  `effort: medium` with the include's prompt and that brief; compose ran
  on the 0.1.15 runtime (the `fast-browser` first on PATH was older). The
  driver closed its tab and left the window size alone.
- The record went through the real `evidence_record` handler and run
  tools against a fresh run under an isolated HOME, with `path` = the last
  step's capture and `annotated` = the board.

| Check | Result |
|---|---|
| `layout: steps`; the title is the claim word for word | yes |
| Each step carries a tag and an outcome description; marks inside a step carry no text | yes (three steps, all `OK`) |
| Nothing personal readable (the email redacted on every step) | yes |
| `evidence_record` writes `evidence@2` with the board as `annotated` and the claim as `caption`, nothing uncovered | `written: true` |
| The whole bundle (board, spec, three captures and sidecars) copied into `evidence/retry-flow/` | yes |
| `mr_upload`'s checks on the recorded board: record membership, redaction | both accepted (a live capture has no redaction record to confirm) |
| The raw capture refused | yes: "is the raw capture for case ... upload its annotated image" |
| The bundle copy re-renders with no browser | byte-identical board |

The driver noted the click step shows the page just before the click (the
fixture's 1.5 s retry finished before a post-click capture), which the
composing skill allows for a click step.

## Final-review fixes

One rep each against fresh compiles of `ea921e7dd..c5629d94f` (the redaction
repair route, the shared browser rule, the confirm result edge, the compose
check, theme stems), same harness and bindings as GREEN. Every rep ran on
the first try; none hit the safeguard.

- S1 (stage-evidence): pass; doctor, `fast-browser compose --help`, one spawn, `mkdir -p` then `cp`, record, one upload. "Read (the compose record, which decides `Crops returned?`)"
- S2 (stage-evidence): pass; import brief hiding the email, `evidence-redaction:evidence:1` naming the crop, no record, no `--confirm`. "Read the board, and the compose record rather than the driver's `crops` list"
- S4 (ship): pass; `BEFORE → AFTER` with the before spec, pair board on both images, one upload, one "Before and after" entry. "No record exists, so the board takes the no-crops path and skips the redaction gate and `--confirm`."
- S6 (ship): pass; spec edit, compose, then `evidence-redaction:ship:1` with the crop path before any upload. "Step 4 clears the old crops and record, then copies the board, crops and record into the evidence folder."
- S7b (stage-evidence, acme-evidence): pass; `clarify:browser-login:1` with exactly the two options, no credential asked. "That gate also offers **Hand back** and **Go on without this BEFORE**."
- S8 (stage-evidence, acme-scripts): pass; the script capture, no driver, no brief, the waiver question. "A bound domain with no `## Browser target` always answers \"no\" to the browser screenshot question"

## Review repro (S10)

A review's `repro` depth captures before/after evidence, and a pack's
review-criteria fill points that capture at its evidence fill. Once the
evidence fill keeps only browser-target facts, a review repro gets no
browser procedure. Scope: `attachments/review-core-body/SKILL.md` (the
repro rule), `attachments/review/review/SKILL.md` and
`attachments/review/self-review/SKILL.md` (the browser diamond, its box
and `## Browser evidence` with the include). receive-review prints no
depth block and runs no repro, so it is unchanged.

Fixture: `fixtures/acme-review-criteria` (`review-criteria@1`), whose
repro line points at the browser target section of `acme-evidence`.
Scenario: `scenarios/S10-review-repro.md`, a teammate's MR !57 on the same
invented project, review run `r-20261014-rv1`, depth `repro`, EVIDENCE
CHECK `screenshot`, the MR-head tree provisioned, lint and tests green,
dev servers not running.

Method: as the pack layer, compiling `review` (`--verb review --preview`)
from a scratch copy whose `pack/stubs.jsonc` rosters `review` and
`self-review` and whose `pack/skills.jsonc` binds their `criteria` to
`mattstack:acme-review-criteria`. The tool-less rep cannot open the file
the criteria point at, so the system file is the compiled verb followed
by that file's text (`acme-evidence`). RED compiles `git archive HEAD`
at `2201512bb`; GREEN compiles the edited tree. The scenario's closing
line reads "List the tool calls you would make, in order, with their
arguments as JSON": the usual "Write every tool call you make" line drew
the safeguard error (`[reasoning_extraction]`) on all four RED tries
against this system file, and the reworded line ran on the first try
for every rep, RED and GREEN.

### Pass criteria

- A brief per browser-evidence's The brief: `case`, `stem:
  review-57-<case>-after`, `claim`, `show`, `point at` lines carrying a
  tag and an outcome description, `hide` naming the owner's email and
  phone, `state: AFTER`, and `page:` from Reach the view.
- `fast-browser doctor` and `fast-browser compose --help` before one
  `Agent` spawn with `subagent_type: "fast-browser:browser-driver"`,
  `model: "sonnet"` and an `effort`.
- The board read with the image-reading tool.
- No run evidence: no `run_field_set` of `evidence`, no `mr_upload`, no
  redaction gate or `--confirm`; the bundle copied into
  `~/.mattstack/work/review-57/evidence/` and its path in the setup
  observations.

### Results

| Phase | Pass |
|---|---|
| RED (HEAD before the edit) | 0/1 |
| GREEN (the edited tree) | 3/3 |

- RED rep 1: no brief; the driver prompt is free prose with a stem of its
  own (`queue-pr57-job42-retry-badge`) and no tags or outcome
  descriptions; no doctor or compose check; spawned on
  `claude-sonnet-5-5` at `effort: high` (the session's own routing rule,
  not the skill, chose the driver); the board stays in
  `~/.fast-browser/screenshots/` with no bundle copy. No run evidence was
  written.
- GREEN rep 1: doctor, compose usage, one spawn (`sonnet`, `medium`) with
  the include's prompt word for word and a full brief (`stem:
  review-57-retry-badge-after`, `state: AFTER`, `OK | Retries | Fixed:
  ...`), `Read` of the board, `mkdir -p` and `cp` into the review folder.
  "Per the review's browser rules it ends there: nothing uploads and no
  evidence field is recorded."
- GREEN rep 2: same order and brief; "Keep the bundle (the walk ends here;
  nothing is uploaded or recorded to the run)".
- GREEN rep 3: same, with case `job-42` (`stem: review-57-job-42-after`);
  "Nothing is uploaded and no run evidence is recorded."

Observation: no GREEN rep compared the board with the MR's attached
images. Each said it had not viewed them and handed the reviewer the
claim alone ("I have no read route to its upload paths"). No tool reads
an MR's uploaded image, so the comparison rests on the description.

## Re-port onto the evidence tools (2026-10-17)

Main rewrote evidence-record, stage-evidence, ship, stage-ship and the
review verbs onto `evidence_record`, `evidence_attach`, `run_budget`,
`run_hold` and the gate tools, with short digraph ids, while this branch
waited. The branch was re-ported onto that text: browser-evidence records
through `evidence_record` (which copies the bundle) instead of a hand
`cp`; `Compose the board (browser-evidence)` replaces `Draw the marks`;
the redaction repair lives in `Attach the evidence`; every counter is a
`run_budget`.

GREEN on the ported text (compiled with `build.sh`, tool-less Sonnet, 3
reps, read by hand; S7 and S10 bound to the acme fixtures). The scenarios'
evidence paths moved to the per-case folders `evidence_record` writes.

| Scenario | GREEN |
|---|---|
| S1 live before | 2/3 (r2 re-asked the attach gate the scenario had answered) |
| S2 ticket image before | 3/3 |
| S3 redaction confirmed | 3/3 |
| S4 pair at ship (stage-ship) | 2/3 (r2's spawn named no `effort`) |
| S4 pair at ship (ship) | 2/2, one rep refused by the safeguard |
| S5 revise shipped | 2/3, then 3/3 after the fix below |
| S6 revise gated | 3/3, and 3/3 again after the fix below |
| S7 opted in before | 3/3 |
| S10 review repro | 3/3 |

No rep wrote `evidence` with `run_field_set`, uploaded with `mr_upload`,
edited the section with `mr_update` or copied into the run folder.

Fixed from this run: ship's "this is the last attach, so Take sends
`linkRefused: true`" read as always sending it (S5 r3 and every S6 rep
planned it on the first attach); ship and stage-ship now say only a Take
at the upload off-script gate sends it. S5 and S6 then ran 3/3 each with
no `linkRefused` on the first attach.

Noted, not changed here: the evidence-attach gate always recommends Hand
back even when a bound domain says to attach when an MR is open (S7 r1,
r2); this predates the port.
