# Respond knows the re-review latch

## Intent

The board posts a re-review latch on an MR when a review lands with a
`comment` outcome: one resolvable thread whose first line is
`<!-- mattstack:board re-review-latch v1 -->`. The author resolves it when
the feedback is addressed, and the reviewer's board launches a re-review on
its next triage pass (`apps/board/docs/agent-actions.md`, "Latch handling").

The respond flow (receive-review in the mattstack plugin, its board wrapper,
and the compiled team packs) does not know the latch. `mr_threads` returns it
as an ordinary unresolved human thread, so respond-plan triages it with
Reply, Fix and Skip, and the adjudicator has to work out from the prose that
it should be left alone. It is mattstack's own convention handled as a
stranger's comment.

Matt's direction: the latch is never actionable at respond-plan. Respond-post,
which comes after fixes and replies are done, asks one yes/no question:
trigger the re-review by resolving the latch.

## Goals

- Respond recognises the latch in code, never from the agent reading prose.
- Respond-plan shows no Reply, Fix or Skip for a latch.
- Respond-post carries a yes/no "trigger a re-review" question per open
  latch, recommended yes.
- A yes resolves the latch after the push and the replies have landed.

## Non-goals

- No change to how the board posts, rearms or spends a latch.
- No change to the board's "request re-review" row action.
- GitHub: `respond_post_execute` refuses GitHub today and the board only
  posts latches on GitLab. Nothing here changes either.

## Anti-goals

- A third gate. The question lives inside respond-post, never a gate of its
  own.
- A latch resolved while a fix push or a reply is still held: the reviewer
  would re-review an MR that does not yet carry the work.
- Respond deciding what a latch is from the body text in skill prose.

## Approaches

1. **The thread tool knows the latch (picked).** `mr_threads` recognises the
   marker, tags latch threads and keeps them out of the `unresolved-human`
   list. Respond-post's source gains a latch question, the board's respond
   sheet renders it, and `respond_post_execute` resolves the latch last.
   Touches rt's MCP tool, receive-review, the post-execute checks and the
   board sheet, plus a pack re-sync. Cannot drift: code decides.
2. **The skill knows the latch.** Receive-review's text tells the agent to drop
   any thread carrying the marker and add the question itself;
   `respond_post_execute` still learns to resolve it. Smaller, but rests on
   the agent reading the marker right every time, which is the failure Matt
   just hit.
3. **The board hides the latch.** Ruled out: the skill builds the gates, the
   board only renders them.

## Decided

- The latch is not in the respond-plan question list at all.
- Respond-post asks a binary yes/no per open latch: trigger a re-review by
  resolving it. Yes is recommended.
- The question is part of respond-post. When a round offers no reply for
  respond-post (everything skipped, or only plain `reply` rows), respond-post
  still opens when an armed latch is open, with the latch question and
  `next` alone. That is the existing second gate opening, not a new one.

## Design

### Recognising a latch

The marker and `latchKindOf` move out of `apps/board/src/latch/markers.ts`
into one module both the board and rt's MCP tools import; the board's
`markers.ts` re-exports or imports from it. A latch is a discussion whose
root note's first line is the armed or the spent marker, exactly as
`latchKindOf` reads it today.

### `mr_threads`

- With `filter: "unresolved-human"`, an armed latch is dropped from
  `discussions` and returned in a new top-level `latches` list:
  `{threadId, reviewer, resolved}` per armed latch, where `reviewer` is the
  root note author's username. A spent latch is dropped and counted in
  `dropped` (a new `latch` count beside `resolved`, `system`, `bot`).
- Without the filter, every discussion still comes back as today, plus the
  same `latches` list, so the resume path that reads resolved threads sees it
  too.
- The tool description and the generated `mcp-tools/reference.md` say so.

### Receive-review (plugin attachment)

- The thread read keeps `latches` from `mr_threads` beside the human threads.
  An MR with no unresolved human threads but an armed latch still says "none"
  at the read: there is nothing to triage, and no round runs for a latch alone.
- Respond-plan's context names each armed latch read-only (`reviewer`), so the
  developer can see one is open. No question, no verb.
- Respond-post's source gains one question per armed latch, after the thread
  questions and before `next`:
  `{"id": "latch-<n>", "label": "Re-review", "multi": false,
    "context": {"gate-ctx": "latch@1", "thread": "<threadId>", "reviewer": "<username>"},
    "options": [{"value": "rereview:<threadId>", "label": "yes", "recommended": true,
                 "description": "resolve <reviewer>'s latch so their board re-reviews"},
                {"value": "keep:<threadId>", "label": "no",
                 "description": "leave the latch open"}]}`
- The respond-post decision records the pick as `latches: {<threadId>: true|false}`
  beside `threads`.
- The board wrapper (`apps/board/skills-src/respond`) follows the same
  shape; `skills:expand:board` regenerates `apps/board/skills`.

### `respond_post_execute`

- Reads `latch@1` questions from the stored respond-post source and the
  `latches` entries from the decision, and refuses one that names a thread its
  source never asked about, or a source question the decision leaves out.
- Resolves each `true` latch after every push, reply and thread resolve in the
  pass, and only when that pass held nothing. A latch skipped because
  something was held is itself reported in `held` with kind `latch`, so the
  resume pass resolves it once the rest lands.
- A latch already resolved counts in `alreadyResolved`, as threads do.

### Board respond sheet

`RespondSheet.tsx` renders a `latch@1` question in the main column after the
reply cards: a card headed "Re-review" naming the reviewer, with the yes/no
choice. `gate-ctx.ts` parses the new shape. A gallery story covers a post
gate with replies plus a latch, and one with the latch alone.

## Constraints

- Plugin edits bump `.claude-plugin/plugin.json`; MCP changes regenerate the
  tool reference; a gate-protocol edit needs `skills:expand:board`.
- After merge, the claimview and ingestion-platform packs re-sync against the
  new plugin version, coordinated in #mattstack.
- No em or en dashes in skill or UI text.

## Left to the builder

- Where the shared marker module lives (rt-client, glance, or a small new
  shared file), as long as there is one source.
- The exact card copy, within Matt's yes/no framing.
