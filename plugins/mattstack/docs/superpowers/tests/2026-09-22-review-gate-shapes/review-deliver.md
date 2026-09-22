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
