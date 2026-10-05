# Board: whose turn is it, and a Show menu

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
- Reviewers can take every author's-turn MR off the board with one checkbox.
- The toolbar says what is on screen in positive terms ("show", never
  "hide"), with labeled group and sort controls.
- With the setting unset and every Show item checked, the same rows show as
  today. The only behaviour change is the Needs me fix below.

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

## The toolbar (option B)

Design: `docs/apps/design/board/board.pen`, frame "Toolbar redesign ·
filters, group, sort", Option B, light and dark.

The header's toolbar becomes one line of three labeled menu buttons, with the
actions moved out of it:

- **Actions:** refresh sits as a quiet icon button in the title row's
  top-right corner, next to the existing theme control, which is unchanged.
- The "copy summary for Slack" (copy every row) button is removed. Copying
  selected rows from the selection bar stays.
- **Group: <value> ▾** opens today's group choices (age, author, status, my
  reviews).
- **Sort: <value> ▾** opens today's sort choices (oldest, progress).
- **Showing N of M ▾** opens the Show menu. M is the rows on the current tab
  after the member filter; N is what is left after the Show menu.

### Turn summary line

The header's subtitle ("N awaiting review · pick one, it opens in gitlab") is
replaced by a whose-turn summary of the current tab, after the member filter
and before the Show menu:

> ● **2** need you · ● **12** need a reviewer · ● **17** waiting on author · ● **5** ready to merge · synced 14:43

- **need you:** rows where `needOf(mr, self, …)` is non-null, so it matches
  the Needs me tab. It links to that tab. Left out on a board with no seat.
- **waiting on author:** `authorTurn` fires with any signal except
  `readyToMerge`.
- **ready to merge:** `authorTurn` fires with `readyToMerge`.
- **need a reviewer:** every other row.
- Each count is its own bucket, so the four add up to the row count. A row
  counts once, in the first bucket that matches, in the order listed above.
- **synced HH:MM** is `dataAgeLabel`, moved up from the footer. The stale
  freshness banner is unchanged.
- Zero counts are left out. The line reads "nothing open" when all are zero.

### Show menu

Titled "Show on the board". Every item is a checkbox, and checked means those
rows are on the board. Each item has a one-line description and a count of
the rows it covers on the current tab.

| Item | Description | Rows |
|---|---|---|
| Posted to #<channel> | announced for review | `slack.posted` |
| Not Posted | not posted to #<channel> yet | `!slack.posted` |
| Waiting on author | comments, red CI, conflicts, ready to merge | `authorTurn(mr, cfg) !== null` |
| My drafts | your own draft MRs | `isDraft` |

`<channel>` is the MR's resolved `slackChannel` (the tab's `slackChannel`,
else `slack.channel`). The two Slack items only appear when Slack is enabled.
A row is shown when every item that matches it is checked. The menu's footer
links to the "Whose turn" settings section.

Below the menu buttons, an **Also show** line lists each unchecked item as a
`+ <item> <count>` pill. Clicking a pill checks that item, and "show everything"
checks them all. The line is absent when everything is checked.

### View state

- `ViewState.slack` and `ViewState.drafts` are replaced by `show`, the set of
  unchecked items (`notPosted`, `posted`, `authorTurn`, `myDrafts`). An empty
  set is the default.
- The URL and localStorage keep reading the old values once: `slack=posted`
  maps to unchecking Not Posted, and `drafts=hide` to unchecking My drafts.
- `filterBySlack` and `filterByDraft` become one `filterByShow` in `view.ts`.
  It returns the rows plus a per-item count, which replaces `slackHidden` and
  `draftsHidden`. The bottom-of-list "N items hidden" copy goes away, since
  the Also show line now says it.
- The Show menu applies on authors and codeowners tabs. On Needs me, the
  Waiting on author item is left out, since that tab is already turn-based.

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
- `view.test.ts`: `filterByShow` for each item and combinations, per-item
  counts, `ViewState` parse and serialize round trip for `show`, and the
  legacy `slack=posted` / `drafts=hide` mapping.
- Storybook stories for the toolbar, the open Show menu and the Also show
  line, with invented data.
- Visual check on `localhost:11006` in Fast Browser, light and dark, with
  everything shown and with items unchecked. The toolbar change is
  intentional, so re-run `bun run capture:baseline` after review, then
  `bun run capture:compare`.
