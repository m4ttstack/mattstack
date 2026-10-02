# Board row menu: shorter top level, flyouts, nothing hidden by mistake

Ticket: BOARD-51. Design boards: Pencil, frame "Redraw: real action set".

## Problem

Right-clicking your own MR on the board shows about 20 rows in three flat
sections (agent actions, gitlab, slack). It is slow to scan and most rows are
rarely used. Shortening it by hiding rows is risky: `rowActions()` already
omits blocked actions, and a wrong predicate silently removes an action with
nothing on screen to say it exists.

## Goals

- The top level of an own-MR menu fits in about 8 rows.
- Every action reachable today stays reachable, in exactly one place.
- An action that cannot apply inside a flyout is shown disabled with a short
  reason, never removed.
- A test fails if any action key goes missing for a known MR state.
- Teammate MRs, remote boards and the bulk menu keep working.

## Non-goals

- New actions. GitLab approval stays out of the menu ("mark as approved" is a
  Slack reaction only, and its wording says so).
- Changing what any action does when run.

## Structure

Top level, own MR on a local board:

1. Reaction row (looking, commented, approved as toggles) when a Slack thread
   is found. When it is not found, a single "find slack thread" row takes its
   place, because the reactions have nothing to act on.
2. Agent actions:
   - the review lane's primary row (exactly one, always);
   - the respond lane's primary row (exactly one, always, own MR only);
   - "call doctor" when the pipeline is failing or there are conflicts;
   - "rebase locally" when there are conflicts, GitLab needs a rebase, or the
     branch is behind.
3. Flyout rows: sessions and reports, gitlab, slack, more.

Lane primary wording is unchanged from today (`reviewMenuItems`,
`respondItemLabel` in `format.ts`):

| Lane status | Review lane | Respond lane |
|---|---|---|
| none or error | review | respond |
| done (or a human review is logged, review lane only) | re-review | restart response |
| running | focus review | focus response |
| pane gone | relaunch review | relaunch response |

Today review and re-review can both show (no board review, human review
logged). The redesign shows one: re-review wins when `reviewLogged` is true,
since both launch the same review run.

## Placement of every action

| Action | Lives in | Condition (today's predicate) | When it does not apply |
|---|---|---|---|
| review lane primary | top | local | always one row |
| respond lane primary | top | local, own | always one row |
| call doctor / again / focus doctor | top | local, own, pipeline failing or conflicts | hidden when known healthy, shown when unknown |
| rebase locally | top | local, own, conflicts or `shouldBeRebased` or behind > 0 | hidden when known up to date; a null `behindTarget` shows it |
| resume review / resume response | sessions and reports | lane has a session id | disabled: "no session" |
| view agent review / view agent response | sessions and reports | lane `reportReady` | disabled: "no report yet" |
| dismiss {lane} line | sessions and reports | lane error, not dismissed | disabled: "nothing to dismiss" |
| ask X's agent to re-review | sessions and reports | own, peer review done with outcome comment, no ask outstanding | disabled: "no peer review" |
| request review from... | sessions and reports | own, a roster member not engaged; opens the picker stage | disabled: "everyone engaged" |
| ask {author}'s agent to respond | top (teammate MR) | not own, my review done with outcome comment, author enrolled, no ask outstanding | disabled with reason |
| merge | gitlab | own, open, not draft; enabled when `isReady` | disabled: merge-status reason |
| rebase on target | gitlab | own, `shouldBeRebased` or behind > 0, not loading | disabled: "up to date" |
| set / cancel auto-merge | gitlab | own, open, not draft; flips on `autoMergeEnabled` | disabled: "draft" |
| mark as draft / mark ready | gitlab | own; flips on draft | always enabled |
| open in gitlab | gitlab (inline on teammate MRs) | always | always enabled |
| mark / unmark reactions | top reaction row | Slack on, thread found | row replaced by "find slack thread" |
| open MR post in slack | slack | thread found with a permalink | disabled: "no thread" |
| find slack thread / find it again | top when no thread; also in slack | Slack on, thread not found | not shown once found |
| post to #channel / post to slack | slack | own, thread not found | disabled: "thread exists" |
| post to code owners... | slack | own, Slack on, repo in `ownerSlackRepos` | disabled: "repo not enabled" |
| copy for slack | slack (inline on teammate MRs) | always | always enabled |
| add a note / edit note | more (inline on teammate MRs) | always | always enabled |
| auto-doctor: ignore / re-enable | more | own; "stack" wording with descendants | always enabled |

Every `local` gate still applies. Flyout rows that fail only the `local` or
`own` gate are omitted, not disabled: those are role facts, not MR state, and
greying a whole flyout on a remote board helps nobody.

## Teammate MRs and remote boards

- Teammate MR: reaction row, review lane primary, ask-respond, view agent
  review, then inline "open in gitlab", "copy for slack", "add a note". No
  gitlab or more flyout, since each would hold one item.
- Remote board: the rows that need no local board (open in gitlab, copy for
  slack, note, report viewers) plus one disabled "agent actions need a local
  board" line, in the same style as today's seatless "author actions" hint.
- An empty section never renders its header.

## Disabled reasons from GitLab merge status

`merge`'s disabled hint maps `detailedMergeStatus` (already read by glance's
`MRDashboard.ts`) to a short phrase:

| Status | Hint |
|---|---|
| `ci_still_running`, `ci_must_pass` | pipeline running / pipeline must pass |
| `draft_status` | draft |
| `need_rebase` | needs rebase |
| `conflict` | conflicts |
| `not_approved`, `requested_changes` | needs approval / changes requested |
| `discussions_not_resolved` | open threads |
| `checking`, `unchecked`, `preparing`, `approvals_syncing` | checking |
| anything else | not mergeable yet |

The map lives next to `mergeButton` in glance so the board and any other
glance consumer word it the same way.

## Kit change

`@mattstack/tui-kit`'s `ContextMenu` has root, Item, Label and Separator, and
Item already supports `disabled` and `hint`. Add a `Sub` part: an Item with a
chevron that opens a nested menu on hover or Right arrow, closes on Left
arrow or Escape, and flips to the left edge when it would overflow the
viewport. The kit's keyboard and focus tests cover it, plus a visual test in
both schemes.

## Data model

- `Section` in `row-actions.ts` grows to `'top' | 'agent' | 'sessions' |
  'gitlab' | 'slack' | 'more'`, and `RowAction` gains `disabledReason?:
  string`.
- `rowActions()` stops omitting state-blocked flyout actions and returns them
  with `disabledReason` instead. Role gates (`local`, `own`) still omit.
- `ActionMenu.tsx` renders `top` and `agent` inline, and the other sections
  as `ContextMenu.Sub` rows, inlining any section with exactly one item.
- `bulkActions` keeps its own flat rendering. It filters out disabled rows,
  and `SECTION_RANK` and `BULK_RANK` are updated for the new section names.

Kept behaviour: merge's second-click confirm, the request-review picker
stage, alt-click to add a note before a launch, and the reaction row keeping
the menu open while several reactions are toggled.

## Tests

- `row-actions.test.ts`: a table of MR states (fresh, mid-flow, broken, no
  Slack thread, draft with auto-merge, teammate, remote, seatless). For each
  one, the union of action keys across all sections equals the expected set
  for that role. The guard is that a key present today is present after,
  enabled or disabled.
- One test per lane asserting exactly one primary row in every lane status.
- DOM tests: a flyout opens, a disabled row shows its hint and does not run,
  and a one-item section renders inline.
- The bulk menu, ask and pins DOM tests stay green.
- Browser check of the menu in light and dark mode before calling it done.

## Open questions

- Should "call doctor" move into sessions and reports when it is not needed,
  instead of hiding? Today it is omitted; the spec keeps that.
- The auto-doctor toggle shows even when triage is off (the default). Leave
  it, or disable it with "auto-doctor is off"? That needs triage state on the
  client.
