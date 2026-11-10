# Ask about a review finding in the reviewer's own session

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
sqlite schema, so a board on this branch can share a real `state.db` with a
board on `main`. rt changes in one place: opening a gate supersedes a
`parked` gate of the same subject and kind as well as an `open` one, so a
session resumed off a park can re-raise its gate.

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
   the review pane and brings it forward in Flock. A parked gate's pane was
   closed on park, so its question resumes the session with that line as
   the prompt instead.
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
- `409` when `gateId` is not the MR's open or parked review-post gate in
  the gate cache, the gate's findings options do not list the finding, or
  the pane will not take the line.
- The pane is never the one on file: that can be stale, or another agent's
  by now. The route asks rt which pane runs the review's Claude session
  (`paneSelf` with no pane given) and types nothing when none does. An open
  gate then gets `409` (`the review pane isn't running; resume the review
  from its row first`), as does a review with no session on file.
- A parked gate with no pane running the session resumes the review's
  agent (`resumeAgentPane`) with the line as its prompt, under the tab
  label the parked-gate resume uses (`mrTabLabel(iid, undefined, '↺')`).
  When that tab is already open the daemon only focuses it, so the route
  answers `409` (`the review pane is already reopening; ask again once it
  is up`), and a later answer to the parked gate focuses the same tab
  rather than starting a second pane. The resume writes the new pane ids to
  the review state and keeps the run's `runStartedAt`.
- The question collapses every run of whitespace to one space and escapes
  `"`.
- Delivery is rt's `paneSend`. A pane showing the gate's form refuses with
  `at a prompt`; the route sends one Escape (`herdr pane send-keys <pane>
  escape`), waits about 600ms and sends once more. An Escape herdr fails to
  send is a `409`. `accepted` or `queued` is success, and the route then
  focuses the pane (`focusPane`).

## The revised strip

Derived with no stored state. The board's gate cache keeps, per subject and
kind, the last five rows the current one replaced, and the supersede rule's
`gate/closed` frame stamps it with `supersededBy`. For the MR's open
review-post gate G, the predecessor is that closed row P with
`supersededBy === G.id`. A P opened before the review lane's `runStartedAt`
belongs to another run (a fresh launch or a re-review supersedes the last
run's gate too, and finding ids are positional), so it does not count.
Their `findings@1` entries are compared by id; a finding counts as revised
when its severity, anchor (`file`), title, body, fix or drafted comment
differ. The MR's client data carries `reviewRevision: { gateId,
previousGateId, previousFindingIds, revised: { [findingId]: { original } }
}`; a dropped finding has no card and is left out. No predecessor in the
cache (after a board restart, say) means no strip.

The cache's `replacements()` (old gate id to the newest gate in its chain)
rides `/data.json` as `gateReplacements`, so an open sheet follows a
re-raised gate onto its successor, even across a re-raise it missed.

The strip reads `Revised in the review pane`, then the severity change, the
anchor change, "finding reworded", "fix changed" and "comment rewritten",
each its own element with spacing between; **show original** reveals the
original title and body.

## Draft carry-over

The sheet's form is gate-kit's per-gate localStorage draft (`useGateDraft`
through `useGateForm`), which already keeps every pick, note and edited
text. A re-raised gate has no draft of its own yet, so the queue modal
seeds its form from the draft on `reviewRevision.previousGateId`
(`review-draft-seed.ts`), then drops that draft:

- every pick, note and text carries over, the verdict and earlier-thread
  picks included;
- a finding both gates carry keeps the reviewer's tick, and a finding new to
  the gate (not in `previousFindingIds`) is ticked, as a fresh gate does;
- a finding the gate on screen revised loses its edited comment, so the
  agent's new draft shows instead of the edit it replaces.

A gate with a draft of its own keeps it. Nothing carries across runs: the
server names a predecessor only within the lane's current run.
