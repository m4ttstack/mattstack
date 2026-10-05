# Board: whose turn is it

## Problem

The team view groups MRs by review state, so "needs review" means "not
approved yet", not "a reviewer can act on this". About half the board is
waiting on its author (threads awaiting a reply, red CI, conflicts) but sits
in the same lists as work reviewers can pick up. On the live board on
2026-10-05, 35 of 72 MRs were the author's move, including 17 of one
author's 32. To find "what can I act on", reviewers rebuild the view by hand
every time: all members, group by status, Slack posted only, collapse the
groups they don't need.

The board already knows whose turn it is. `authorNeed()` in
`client/board/needs-me.ts` decides it for the Needs me tab, but only for the
viewer's own MRs, and its rules are hard-coded. Needs me also misses an MR
where the author answered your thread but you are not an assigned reviewer
(`reviewerNeed()` requires assignment).

## Goals

- One definition of "whose turn" drives both the team view and Needs me.
- A team can set which signals count; a person can override it for themselves.
- Reviewers can hide every author's-turn MR with one toggle.
- With the setting unset and the toggle off, nothing on the board changes
  except the Needs me fix below.

## Non-goals

- Hiding individual MRs by hand. That is its own spec, written after this one.
- Code-owner sections as a Needs me signal. The Codeowner Queue tab covers them.
- Changing `statusBucket` groups. Blockers stay row flags there.

## The setting: `board.turn`

A new registry row in `packages/rt-client/src/settings/registry-defs.ts`,
with its schema in `registry-schemas.ts`:

```ts
{
  key: "board.turn",
  type: "object",
  scopes: ["team", "user"],
  merge: "replace",
  description: "What makes an open MR someone's turn. author: blockers that make it the author's move (the board's 'Waiting on author' filter, Needs me respond/fix/merge). reviewer: what puts it in a reviewer's Needs me queue. An absent list means every signal (fallback lives in the board reader).",
}
```

Schema: `{ author?: AuthorSignal[], reviewer?: ReviewerSignal[] }`.

No `default:` on the row, because `board.*` rows never carry one. The board
reader treats an absent list as "every signal".

### Author signals

| Signal | Author's turn when |
|---|---|
| `threads` | a thread is awaiting the author (`threadSummary.awaiting > 0`) |
| `changesRequested` | `hasChangesRequested(mr)` |
| `conflicts` | `blockers.hasConflicts` |
| `rebase` | `blockers.needsRebase` |
| `ciFailing` | `blockers.pipelineFailing` |
| `readyToMerge` | `reviews.isApproved` and no blockers |

A running pipeline and a loading row are nobody's turn yet. Neither signal
fires for them.

### Reviewer signals

| Signal | Your turn when |
|---|---|
| `assigned` | you are an assigned reviewer and have not started or finished (`UNREVIEWED`, `REVIEW_STARTED`) |
| `approvalReset` | your approval was reset by a push (`UNAPPROVED`) |
| `repliedThreads` | the author answered or resolved one of your threads (`myThreads.replied + resolved > 0`), assigned or not |

The existing precedence rule stays the same: if one of your threads is still
awaiting the author, the MR is the author's turn, not yours.

`repliedThreads` dropping the assignment requirement is the one behaviour
change with the setting unset. It surfaces MRs where the author answered
your thread but you were never assigned.

## Shared predicate

Move the turn logic out of `needs-me.ts` into `src/turn.ts`, which is
bundled for both server and browser like `view.ts`:

- `resolveTurnConfig(raw)` turns the setting into full signal sets
  (absent list means all signals).
- `authorTurn(mr, cfg)` returns the first author signal that fires, or null.
- `reviewerTurn(mr, self, cfg)` returns the first reviewer signal that
  fires, or null.

`needs-me.ts` maps these onto its existing `Need` values (`respond`, `fix`,
`merge`, `review`, `re-review`) and keeps its hot-line handling (`lineNeed`)
as it is.

The server reads `getSetting('board.turn')` and ships the resolved config in
`/data.json`, next to `staleAfterDays`.

## The "Waiting on author" toggle

- `ViewState` gains `authorTurn: 'all' | 'hide'`. It is stored in
  localStorage and the URL like `slack` and `drafts`. The default is `'all'`.
- The toggle sits next to the Slack and drafts filters.
- `filterByAuthorTurn` in `view.ts` runs after `filterByDraft` in the
  `boardView` pipeline.
- `authorTurnHidden` is counted like `draftsHidden`. The hidden-rows copy
  reads "N waiting on author", and clicking it sets the toggle back to `'all'`.
- It applies on authors tabs and codeowners tabs, and does nothing on Needs
  me, which is already turn-based.

## Editing the setting

The board's settings modal gets a "Whose turn" section with one checkbox per
signal, in two groups (author, reviewer). It writes the team scope, the
same way `board.tabs` does. A per-person override is set from the shell with
`rt settings set board.turn --scope user`.

## Testing

- `turn.test.ts`: each signal on its own, absent config means all signals,
  an empty list means none, precedence (my awaiting thread beats
  `repliedThreads`), running pipeline is nobody's turn.
- `needs-me` tests: with the setting unset, existing cases keep their
  `Need`. The new case is an unassigned reviewer with a replied thread, which
  maps to `re-review`.
- `view.test.ts`: `filterByAuthorTurn`, the hidden count and copy, and
  `ViewState` parse and serialize round trip for the new field.
- A Storybook story for the toggle and hidden-rows copy, with invented data.
- Visual check on `localhost:11006` in Fast Browser, light and dark, with the
  toggle on and off. Then `bun run capture:compare`.
