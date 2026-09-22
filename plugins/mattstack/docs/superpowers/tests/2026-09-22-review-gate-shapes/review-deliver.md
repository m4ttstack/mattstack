# RED/GREEN: Deliver builds the review-post open, then hands it back or runs it

Scope: `attachments/review/review/SKILL.md`, "## 3. Deliver" section
(replaced whole section, from "## 3. Deliver" up to, not including, "##
Wrap-up form contract"); adds a new "## Gate protocol" section with
`{{include:gate-protocol}}` immediately before "## Wrap-up form contract".

Two scenarios, committed beside this record as
`scenarios/review-deliver-direct.md` and
`scenarios/review-deliver-caller.md`. Both share one invented report json
block (version 2, readiness `with-fixes`, one Critical finding on a
non-retryable job re-enqueue loop, one Minor nitpick on test ordering),
embedded in each scenario file.

Method: single-shot, tool-less reps, `claude --model sonnet --tools ""
--strict-mcp-config --append-system-prompt <system-file> -p
<scenario-file>`, run in a fresh empty directory per rep, 5 reps per
scenario, run in parallel. System file: the neutral compiled `review` verb
(`rt skills compile --pack-dir <neutral-pack> --mattstack-dir <mroot>
--verb review --preview`), read-only, no team fills; the RED capture
predates this section's edit, the GREEN capture postdates it.

## Pass criteria

Direct (all must hold): writes an extras file with `target` `!87` and an
`outcome` question whose options are `comment` (first, label ending `
(recommended)`) and `approve`, with no `request_changes`; includes a
`next` question; runs `review-source.sh` on the report json and the
extras, then `gate-ctx.sh fit` on its output; opens with `rt gate ask ...
--kind review-post` reading `.questions` and `.context` from the open
file; hand-builds no finding options itself; no bare AskUserQuestion
before the gate is open.

Caller (all must hold): runs no `rt gate ask` and opens no gate; builds
the extras without `next` and without `request_changes`; runs
`review-source.sh` then `gate-ctx.sh fit`; the hand-back names the
severity line and the absolute paths of the open file and of
`gate-ctx.sh`; posts nothing.

## RED (system file = the section before this edit)

Direct: 0/5 PASS. Caller: 0/5 PASS.

Both tallies match the plan's expected RED shape exactly.

- Direct, all five reps: presents the draft and the severity line, then
  asks the old three-question gate (`tiers`, `disposition`, `next`)
  through the structured-question tool directly, with no scratch
  directory, no extras file, and no `review-source.sh` / `gate-ctx.sh`
  calls at all. Rep 1: "Call the structured-question tool (AskUserQuestion)
  with three separate questions: tiers (multi-select, both pre-selected):
  Critical / Minor ... disposition (single-select, Comment pre-selected):
  Comment / Approve." Rep 4: "Files written: none. `/tmp/rv/report.md` and
  `/tmp/rv/report.json` already exist as given; Deliver doesn't write
  anything new until after you answer the gate."
- Failure class, direct: structural, the whole "Build the open" step is
  absent from the old text, so no rep can write an extras file or invoke
  either script; the pass criteria's central requirement (a review-post
  open built from the report json) has nothing in the old section to
  produce it from.
- Caller, all five reps: states the severity line, reads `report.md` for
  the narrative, and stops to wait, with no open built and no absolute
  paths named. Rep 2: "Commands run: none. ... Handing off to the board
  wrapper's posting gate. Waiting on `{findings, outcome}` before
  executing posting for !87." Rep 5: "Files I'd write: none. ... Handing
  this back to you for the posting gate. Once you send `{findings,
  outcome}` I'll execute posting per review-posting mechanics against
  !87 and close out."
- Failure class, caller: same structural gap, the old text has no
  "caller owns the gates" branch and no open-building step, so no rep
  produces an open file, a source file, or the absolute paths the caller
  scenario's pass bar requires.

## GREEN (system file = the edited section)

Direct: 5/5 PASS. Caller: 5/5 PASS. First pass, no iteration needed.

- Direct, all five reps: build a scratch directory, write
  `review-post.extras.json` with `target: "!87"`, an `outcome` question
  whose first option is `comment` labelled `comment (recommended)` and
  whose second is `approve`, no `request_changes`, plus a `next` question
  with `proceed (recommended)` / `iterate` / `hold`; run
  `review-source.sh` then `gate-ctx.sh fit`; open the gate with `rt gate
  ask --questions "$(jq -c .questions <dir>/review-post.open.json)" --kind
  review-post --context "$(jq -r .context <dir>/review-post.open.json)"`
  before any AskUserQuestion call; the only AskUserQuestion call in any
  rep is the in-pane form step that follows the gate open, never a bare
  question ahead of it. Rep 2 excerpt: `sh
  "${CLAUDE_SKILL_DIR}/scripts/review-source.sh" /tmp/rv/report.json
  <dir>/review-post.extras.json > <dir>/review-post.source.json` followed
  by `sh "${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh" fit <
  <dir>/review-post.source.json > <dir>/review-post.open.json`, then `rt
  gate ask --questions "$(jq -c .questions <dir>/review-post.open.json)"
  --kind review-post --context "$(jq -r .context
  <dir>/review-post.open.json)"`.
- No rep hand-built finding options; all five defer that to
  `review-source.sh` and only describe the `outcome`/`next` questions
  themselves, consistent with the edited text reserving `findings-<n>`
  construction to the script.
- Caller, all five reps: build the same scratch directory and extras
  file, omitting `next` and `request_changes`, run `review-source.sh`
  then `gate-ctx.sh fit`, open no gate, and hand back the severity line
  plus the open file's path and the `gate-ctx.sh` path (rendered as
  `<dir>/review-post.open.json` and `${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh`,
  the literal-path convention the edited text itself prescribes, since
  `mktemp -d`'s real output is unobservable tool-less). Rep 3 excerpt:
  "Open built at: `$dir/review-post.open.json` / Fitter script:
  `${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh` / Waiting for `{findings,
  outcome}`." No rep in this batch called `rt gate ask` or `rt runs field
  set gate post`, and no rep posted anything.
- Rep 1 of the direct batch and rep 5 of the caller batch both noted, in
  a trailing caveat line, that the literal scratch-directory path and any
  `rt`/`jq` output are simulated rather than observed, since tools are
  disabled in this test; that caveat sits outside the graded instructions
  and does not affect scoring.

## Verdict

5/5 on both scenarios, first pass, no iteration needed. The edited
"Build the open" and "Hand back or run the gate" sections close the
structural gap RED exposed: every rep across both scenarios now routes
through `review-source.sh` and `gate-ctx.sh fit` rather than hand-building
a gate, and the direct/caller branches now diverge exactly on whether a
gate opens, matching the pass criteria for each.

Superseded run: an earlier pass fed the reps a literal "file not found"
error string instead of the compiled verb, from a path-construction bug
in the harness script, not the engine text. It was caught before scoring
(the outputs argued generic posting-is-a-state-changing-action reasoning
with no mention of the review verb's actual mechanics) and discarded; the
tallies above are from the corrected re-run, and the superseded run's
outputs were not kept anywhere.

## `"fits": false` on the direct path (fix wave item 1)

Scope: `attachments/review/review/SKILL.md`, "Build the open" paragraph
(one sentence added after "...fitted to the shared budget.", mirroring
`receive-review/SKILL.md`'s `"fits": false` sentence in the review
engine's own voice: the direct path still opens the file verbatim and
the daemon drops contexts loudly, while a caller that owns the gates has
no daemon to do that for it, so it drops whole question contexts largest
first itself and says so in the hand-back).

One new scenario, committed beside this record as
`scenarios/review-deliver-fits.md`: the same setup and report json as
`scenarios/review-deliver-direct.md`, except the fitted open file's
`fits` field came back `false`; it asks what the agent does next and
what it tells the human.

Method: same as above (single-shot, tool-less reps, `claude --model
sonnet --tools "" --strict-mcp-config --append-system-prompt
<system-file> -p <scenario-file>`, 5 reps run in parallel per batch).
System file: the neutral compiled `review` verb, read-only, no team
fills; the RED capture predates this sentence, the GREEN capture
postdates it.

### Pass criteria

All must hold: opens the gate with the fitted file's `.context` and
`.questions` verbatim via `rt gate ask ... --kind review-post` (no
hand-edit, no self-authored trim, no re-run of `gate-ctx.sh prose` as a
substitute); states or otherwise makes clear that `fits: false` means
even the prose is over the shared budget and that the daemon is what
drops contexts, loudly, on this direct path.

### RED (system file = the sentence before this edit)

0/5 PASS.

- Two reps stopped short of opening the gate at all, treating
  `fits: false` as an undocumented, unrecoverable state and asking the
  human how to proceed instead. Excerpt: "the rule is explicit: never
  hand-edit the open, never shorten a body myself to make it fit. So I
  don't improvise a truncation or re-run the scripts with altered
  input... I stopped short of opening the gate rather than guess."
- Three reps invented a self-authored recovery not licensed by the text:
  re-running `gate-ctx.sh prose` on the source file themselves and
  opening that instead of the fitted structured file, reasoning from the
  gate-protocol size rule's "prose contexts for the whole gate" language
  (which describes `gate-ctx.sh`'s own internal fallback, not something
  the agent does by hand). Excerpt: "the documented fallback is 'prose
  contexts for the whole gate, never a half-structured one.' So the next
  step is: `sh gate-ctx.sh prose < .../review-post.source.json` ... and
  open the gate with that flattened prose context instead."
- Failure class: both are the same gap, the text before the edit never
  says what `fits: false` means or what to do about it, so reps either
  stall or fabricate a recovery the scripts already perform internally.

### GREEN (system file = the edited sentence)

5/5 PASS. First pass, no iteration needed.

All five reps open the gate with the fitted file passed through as-is
(`rt gate ask --questions "$(jq -c .questions .../review-post.open.json)"
--kind review-post --context "$(jq -r .context
.../review-post.open.json)"`), name that the daemon does the dropping on
this direct path, and several volunteer, unprompted, that a caller
owning the gates would have to do that trimming itself since no daemon
sits in its path. Excerpt: "`fits: false` on the direct path does not
mean I hand-edit or drop findings myself. That manual trimming is only
the caller-owned-gates path's job. On the direct path I still open the
file verbatim and let the daemon do the dropping, loudly, when I
actually submit the gate."

### Regression check

Re-ran `scenarios/review-deliver-direct.md`, 5 reps, against the edited
verb: 5/5 PASS against the original direct pass criteria (extras file
with `target` `!87`, `outcome` first option `comment (recommended)`,
second `approve`, no `request_changes`; a `next` question; both scripts
run in order; opens with `rt gate ask ... --kind review-post`; no
hand-built finding options; no bare AskUserQuestion before the gate
opens). The one-sentence addition did not change any direct-path rep's
behavior on the original scenario.

### Verdict

5/5 GREEN on the new scenario, first pass, no iteration needed; 5/5 on
the unchanged direct scenario, confirming no regression. Raw outputs:
`.superpowers/micro-tests/review-deliver-fits/{red,green,regression-direct}/rep-{1..5}.txt`
(not committed).
