# Review gate shows the comments it will post

Status: draft, awaiting Matt's approval
Mock: `docs/apps/design/board/board.pen`, board "B15 · Review gate drafts its comments" (option A is the chosen one)

## Why

A new user asked to edit the review comments before they go onto someone
else's MR. Today they can't. The `review-post` gate lists each finding
(title, anchor, the reviewer's reasoning, a one-line fix) and the verdict,
but the comment that actually posts is written after the gate. The wrapper
composes each body at `Compose the submitted review (review)` in
`apps/board/skills-src/review/SKILL.md`, in the writing-style voice. The
human never sees that text. The only lever is a note on the answer, which
the agent reads as a steer.

Respond already works the way people expect. `respond-post` shows each
drafted reply in a "Will post as reply" box with an edit button, and an
edited reply posts as written. Review should feel the same.

## Goals

- The review drafts every comment body, and the summary note, before the
  gate opens, in the loaded writing-style voice.
- In the board, every ticked finding shows the comment that will post, in
  an editable box. The summary comment is editable too.
- What's in the box is what posts, character for character. The post step
  stops writing comments.
- It stays one gate: `review-post`.

## Non-goals

- No change to the respond flow.
- No change to the board wrapper's generic path (a review with no domain
  skill). It writes Markdown only and keeps its tier-level questions, so
  it gets no comment boxes.
- No change to how findings are found, tiered, chunked or ordered.
- No editor on surfaces other than the board (the pane's native form, herd
  relays). They show the drafted text and post it unedited.
- No change to re-review carryover replies or restored skipped findings.
  Carryover replies are already drafted and editable. Restored findings
  post their recorded text.

## Anti-goals

- The board shows one text and a different one posts. Every surface reads
  the same drafted string, so this can't happen.
- A second gate, or a "preview" step after the verdict.
- The rail gets more crowded. The summary goes in the main column.

## The gate, as it looks (option A)

**Field style (Matt's call, 2026-10-20, mock B17 "V4 · Framed composer").**
Every editable comment in the review sheet (the summary line, each folded
finding, each anchored finding's comment) is an always-editable,
auto-growing text area (`useAutoGrowTextarea`), never a display box with
an `edit` button. Each field is framed like a small comment composer: a
teal strip across the top ("WILL POST AS COMMENT", "WILL POST AS THE
SUMMARY"; "posts as you" on its right) joined to a white text area with
ink text. An edited field shows "edited · reset" in place of "posts as
you". A folded finding's field carries "× remove" in its strip. This
supersedes the teal display boxes and `edit`/`done`/`revert to draft`
buttons described below. Respond keeps its own reply boxes.

Use B15's "A · gate" frame as the picture. Main column, top to bottom:

1. **Summary comment card**, above "Post which findings". Its header says
   "Summary comment" with a "posts on !iid" pill. Its body is the same teal
   "Will post as the review summary" box respond uses, with an `edit`
   button. Under it is a hint like "includes 1 finding with no diff line"
   when that applies.
2. **Finding cards**, same order and checkbox as today. Each one keeps its
   title, kind pill, anchor and the reviewer's reasoning. Below that is a
   teal "Will post as comment" box with the drafted body and `edit`.
   - The "→ fix" line goes away, because the comment says what to change.
   - An edited comment shows an "edited" chip, like respond's.
   - Editing opens a text box in place, with `done` and `revert to draft`.
   - **Unticked finding: the comment box is hidden**, and the card dims.
     An edit made before unticking is kept and comes back on re-tick.
   - A finding with no diff line has no box of its own. It shows a pointer
     ("No diff line, so this posts in the summary comment above"). Its
     comment appears in the summary card instead (see below).
3. Full report disclosure, unchanged.

Rail: unchanged. The post button counts what will go out:
`post 3 comments + summary · Approve`.

Below 720px the sheet stacks as today. The summary card stays first.

## How the summary card is built

The summary that posts is made of two parts:

- **The summary line.** One editable box with the review's opening note.
- **Folded-in findings.** Each ticked finding with no diff line, as its own
  editable comment, listed under the summary line inside the same card.
  Unticking such a finding drops it from the card and from what posts.

**The summary line follows the verdict (Matt's call, 2026-10-20).** The
review drafts one summary line per verdict the gate offers (`approve`,
`comment`, and `request_changes` on GitHub). The box shows the draft for
the selected verdict and swaps when the verdict changes. Each verdict keeps
its own edit: switching away and back brings the earlier edit back, like
unticking a finding. Only the selected verdict's line posts. So an
all-clear written for Approve can never post under a Comment, from the
board or from the pane.

This keeps "untick removes it" true without trying to cut text out of a
free-form summary someone may have edited. (My call. The mock draws the
summary as one box. The builder should draw the folded findings as
separate boxes inside the card.)

The 100-comment cap still applies. An anchored finding the cap pushes
into the summary posts its inline draft word for word. (My call.)

When GitLab rejects an anchor (`badAnchors` from `mr_review_submit`),
the finding moves into the summary note as today. Its body stays word
for word, and only its `file:line` is added. This is the one change the
post step may make to text the human saw. (My call.)

## Which paths change (Matt's calls)

Today, per-finding review gates come from two places, and in both the
posting happens outside the board wrapper's Compose step:

1. **The shared review engine** in the mattstack plugin
   (`plugins/mattstack/attachments/review-core-body-tail/SKILL.md`).
   Domain skills under the `mr-review@2` slot compile from it. It writes
   the json report (version 3), builds the fitted gate file, and does the
   posting when the wrapper hands it the answer
   (`Hand the answer to the domain skill to post` in the board wrapper).
2. **The standalone `mattstack:review` verb**
   (`plugins/mattstack/attachments/review/review/SKILL.md`). It builds
   its gate through the same `lib/gates/review-source.ts`, opens the same
   `review-post` kind, and posts on GitLab (its own Compose step) and on
   GitHub (`gh pr review`). Its `run:` gates reach the board through
   `src/gates/ingest.ts`.

**Both are in scope.** Both draft before the gate and post edits word for
word, on GitLab and GitHub. The board wrapper's generic path is out of
scope (see Non-goals).

## Where the drafts live (Matt's call, revised 2026-10-20)

The full drafts ride **in the gate**, untrimmed. The gate is the one
source of truth for what was asked and answered, and the drafts are what
the human approves.

- **No size limit on what a gate stores.** Today the daemon caps a gate's
  context at 8192 bytes, and every gate builder trims to fit that cap.
  Nobody recorded a reason for the number. This work removes the cap for
  every gate kind, so a big review keeps all its comments whole.
- **Board-only fields.** The one place size matters is the Claude Code
  pane, which renders a gate as prose in its native form. Drafted
  comments and the drafted summary are marked board-only. The pane's
  prose leaves them out, so the pane keeps titles, reasoning and the
  verdict. Answering in the pane still posts the drafts word for word.
- **A pane budget.** The size budget moves to the pane's prose alone. It
  never applies to what the daemon stores or what the board draws.
- The poster reads the drafts from the same gate source it opened the
  gate with. It never reads a second copy that could drift.

## Where the change lands

- **Gate storage and the pane budget.** The daemon stops rejecting and
  dropping oversized context (`lib/daemon/handlers/gate.ts`), and so do
  the CLI and board callers. The fitter in `lib/gates/ctx.ts` and its jq
  twin become the pane-prose fitter only. Skill and tool text that tells
  agents about the 8192-byte budget is updated to match.
- **Report json.** Each finding gains a drafted comment string. The
  summary gains a drafted string for the summary line. The builder picks
  the field names and whether this is a new report `version`.
- **Gate context.** `lib/gates/review-source.ts` carries the full drafts
  into `findings@1` and `review@1`. `lib/gates/ctx.ts` validates them and
  marks them board-only. The builder decides whether this stays `@1` with
  an optional field or bumps to `@2`. Old gates without the field must
  still render.
- **"This gate's poster honors edits" signal.** Edit boxes show only when
  the gate says its poster will post edits word for word. Both posters
  set it once updated. A gate without it renders as today. The builder
  picks the field, but it lives in the gate, never in a guess about which
  skill ran.
- **Answer payload.** Edited text rides back on the answer, like a
  carryover thread's `text` does. A findings chunk holds up to four
  findings, so the answer needs per-finding text keyed by finding id. The
  summary line needs its own slot. Only edited entries need to ride. An
  absent entry means "post the draft". The builder picks the shape.
- **Board.** `apps/board/src/client/board/ReviewGateSheet.tsx` renders the
  summary card and the per-finding boxes from the gate's drafts. It
  reuses respond's editable reply pieces (`RespondSheet.tsx`
  `editableReply`, `EditedChip`, `sheet-payload.ts`'s text handling)
  rather than building new ones. Add a gallery story for the new face in
  `gate-gallery.fixtures.ts` / `GateGallery.stories.tsx`, with invented
  data.
- **Shared review engine.** It drafts every comment and the summary line,
  in the loaded writing-style voice, into the report before the gate. Its
  posting step takes the edited text from the answer, else the draft, and
  never rewrites either. A note on the answer no longer changes wording.
  It needs a plugin version bump and pack recompiles
  (`mattstack:editing-skills`).
- **Standalone `mattstack:review` verb.** It makes the same change: draft
  before the gate, then post edit-or-draft word for word, on GitLab and
  GitHub. On GitHub the summary line is the `gh pr review` body.
- **Board wrapper** (`apps/board/skills-src/review/SKILL.md`, then
  `bun run skills:expand:board`). `Hand the answer to the domain skill to
  post` passes the edited texts through. Resumed panes hand over the same
  answer, so a parked-gate resume posts the text the gate showed. Its
  generic path and its Compose step are unchanged.

## Acceptance

- A fresh review on a board-tracked MR opens one `review-post` gate. Each
  anchored finding shows its drafted comment, and the summary card shows
  the summary line and any no-diff-line findings.
- Editing a finding's comment and approving posts that exact text as the
  inline comment, on GitLab. Same for the summary line.
- Not editing posts the drafted text, unchanged.
- Unticking a finding hides its box. Nothing for it posts, and if it had
  no diff line, it is gone from the summary.
- Answering from the pane's native form posts the same drafted text the
  board would have shown.
- A parked gate answered later posts the text the gate showed.
- The same holds for a `mattstack:review` run on GitLab and on GitHub,
  answered from the board.
- A review with 12 findings keeps the full review sheet, with every
  comment box showing its whole draft.
- No drafted comment ever appears in the Claude Code pane's form.
- A gate without the "poster honors edits" signal (an old gate, or a
  pack not yet recompiled) renders as today and posts as today.
- Board gallery has a story for the new face. Capture baselines are
  regenerated on purpose (`bun run capture:baseline` in `apps/board`).

## Left to the builder

- Field names, report version, gate-ctx shape versioning.
- The answer payload shape for per-finding edited text.
- Component structure inside `ReviewGateSheet.tsx`.
- How the editable box handles very long comments (respond-post's
  long-replies story is the model).
