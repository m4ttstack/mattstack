# Ask about a review finding in the reviewer's own session

Supersedes `2026-10-23-board-finding-questions-design.md` and its plan.

## Why

The first design launched a separate, read-only question agent per finding
in its own herdr workspace. That agent had to rebuild the review's context
from the report, needed its own state table, lifecycle sweep, send-back verb
and a `revised` gate close reason in rt, and still had to hand any change
back to the review agent to rebuild the gate.

The review agent already holds everything the question needs: the diff, the
evidence it gathered and the reasoning behind the finding. So the question
goes to that session. The conversation happens in the review pane, and when
a finding changes the review agent re-raises its own gate. The board adds no
sqlite schema (it stays at version 5, so a board on this branch can share a
real `state.db` with a board on `main`) and rt gains nothing.

## Flow

1. On the review gate's sheet, a drafted finding's Agent Finding head offers
   **ask a question**. It opens an area under the finding: a textarea and
   **send to the review pane** / **cancel**.
2. Send posts `POST /review/finding-question`. The textarea holds while the
   request is in flight, and the other findings' ask links wait: one
   question at a time. The board's launch flow toasts
   `asking in the review pane for !<iid>…`, and on failure
   `question failed for !<iid> (<status>): <body>`.
3. The board types
   `/board:review-finding-question <gate-id> <finding-id> "<question>"` into
   the review pane and brings it forward in Flock.
4. On success the area reads **asked in the review pane**, with a link that
   focuses the review pane.
5. The human talks to the review agent in its pane. If they agree to revise,
   the agent edits its report, rebuilds the gate's open file and opens a new
   review-post gate, which supersedes the old one.
6. The sheet shows the new gate: ticks and edits carry over, and each
   revised finding carries a strip saying what changed.

## The skill

`apps/board/skills-src/review-finding-question/SKILL.md`, run only inside
the board review session that wrote the report. It restates the finding and
the question, explores through one read-only helper per new question,
reports a verdict with evidence, and changes nothing until the human says to
revise. A revise edits the report json and markdown, rebuilds the gate the
way the first one was built and re-opens it with `open-gate.sh`, then holds
at the new gate. A `closed (superseded)` result for the old gate is its own
rebuild.

## The route

`POST /review/finding-question`, local-only and JSON-only, in
`apps/board/src/finding-question.ts` behind an io seam (`server.ts` is the
shell).

- Body `{ mrUrl, iid, gateId, findingId, question, tabId? }`.
- `400` when the finding id is outside `[A-Za-z0-9._:-]`, or the question is
  empty or over 2000 characters.
- `409` when `gateId` is not the MR's open review-post gate in the gate
  cache, the gate's findings options do not list the finding, the review
  state has no `paneId` (`the review pane isn't running; resume the review
  from its row first`), or the pane will not take the line.
- The question collapses every run of whitespace to one space and escapes
  `"`.
- Delivery is rt's `paneSend`. A pane showing the gate's form refuses with
  `at a prompt`; the route sends one Escape (`herdr pane send-keys <pane>
  escape`), waits about 600ms and sends once more. `accepted` or `queued` is
  success, and the route then focuses the pane (`focusPane`).

## The revised strip

Derived with no stored state. The board's gate cache keeps, per subject and
kind, the row the current one replaced, and the supersede rule's
`gate/closed` frame stamps it with `supersededBy`. For the MR's open
review-post gate G, the predecessor is that closed row P with
`supersededBy === G.id`. Their `findings@1` entries are compared by id; a
finding counts as revised when its severity, anchor (`file`), title or body
differ. The MR's client data carries
`reviewRevision: { gateId, revised: { [findingId]: { original } } }`; a
dropped finding has no card and is left out. No predecessor in the cache
(after a board restart, say) means no strip.

The strip reads `Revised in the review pane · <parts>`, where the parts are
the severity change, the anchor change and "finding reworded"; **show
original** reveals the original title and body.

## Sheet-draft carry-over

The sheet's ticks, comment edits, verdict and notes are saved per MR in the
`kv` table (namespace `review-sheet-draft`, key the MR url) through
`GET`/`PUT /review/sheet-draft`, and restored once per gate. Only findings
the draft knew (`known`) are touched, so a finding new to the gate keeps its
default. A finding the gate on screen revised keeps its tick but takes the
agent's new comment draft. The draft is dropped by a fresh `/review` launch,
by `launchReReview`, by a verdict on the review gate (an answer whose `next`
is neither `iterate` nor `hold`, seen on the relay's `gate/answered/` frame
by the writer board) and by the MR leaving the board.
