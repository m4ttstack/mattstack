# Respond knows the re-review latch

## Intent

The board posts a re-review latch on an MR when a review lands with a
`comment` outcome: one resolvable thread whose first line is
`<!-- mattstack:board re-review-latch v1 -->`. Resolving it makes the
reviewer's board re-review on its next triage pass. Today respond triages
that thread like any reviewer comment (Reply, Fix, Skip), which looks bad:
it is mattstack's own convention.

Matt wants two things:

1. Triage ignores latch threads.
2. When a respond-post gate opens on an MR with an open latch, the board
   offers its own option to trigger a re-review once the agent has finished
   posting.

## Non-goals

- No change to the respond skills, the gate shapes, `respond_post_execute`
  or the respond slot contract. The agent never sees the option.
- No change to how the board posts, rearms or spends a latch, or to the
  "request re-review" row action.

## Approaches

- **Picked: the thread tool drops latches; the board owns the option.**
  `mr_threads` filters latches out of `unresolved-human`, so every triage
  path (board wrapper and team packs) stops seeing them. The board adds a
  control to its respond-post sheet, keeps the pick server side, and
  resolves the latch itself when the run finishes, with the same resolve
  the row action uses.
- **Dropped: the agent's pipeline carries the question.** It needs a new gate
  shape and the latch rule written into both posting paths (the shared
  posting tool and the board wrapper's own path), which is far more work for
  the same result.

## Design

### 1. Triage ignores latches (rt)

- The marker constants and `latchKindOf` move from
  `apps/board/src/latch/markers.ts` into `packages/rt-client`, so rt and the
  board read one source; the board's `markers.ts` imports them.
- `filterHumanThreads` (`lib/mcp/mr-read-tools.ts`) drops any discussion
  whose root note is an armed or spent latch and counts it in a new
  `dropped.latch`. The unfiltered `mr_threads` read is unchanged.
- The tool description and the generated `mcp-tools/reference.md` say so.

### 2. The board-only re-review option

- **When it shows:** the respond-post sheet is open, the MR's
  `reviewerLatches` has a reviewer whose latch is not already requested, and
  the gate is answered from the board. One checkbox per such reviewer:
  "Ask <reviewer> for a re-review once posting finishes".
- **Answering:** the sheet sends the gate answer exactly as today and posts
  the ticked reviewers to a board route that stores them on the MR's
  respond state (`pendingReReview: string[]` of discussion ids). Nothing
  reaches the agent.
- **Firing:** when the respond run reports `done` with no `held`, the board
  resolves each stored latch through `latch/gateway.ts`, then clears the
  field. On `error`, or `done` with anything held, it clears the field
  without resolving, so the row's "request re-review" action is the way
  back.
- **Rounds with no post sheet:** no option that round; the row action covers
  it.

## Calls made by Claude (Matt to check)

- Checkboxes start unticked: it triggers someone else's work, so it is never
  done by default.
- In a respond run scoped to one person, only that person's latch is
  offered.
- A gate answered outside the board (the console) gets no option.

## Constraints

- No em or en dashes in UI text.
- Light and dark checks of the sheet in Storybook, with a gallery story for a
  respond-post gate on an MR with a latch.
