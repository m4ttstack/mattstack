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
- Every action key reachable today stays reachable, in exactly one place.
- An action that cannot apply because of MR state is shown inside its flyout
  as blocked with a short reason, never removed.
- A test fails if any action key goes missing for a known MR state.
- Teammate MRs, remote boards, seatless boards and the bulk menu keep working.

## Non-goals

- New actions. GitLab approval stays out of the menu ("mark as approved" is a
  Slack reaction only).
- Changing what any action does when run.

## Omit versus block

Two kinds of gate, treated differently:

- **Role gates omit the row.** `env.local`, own versus teammate, a seat
  (`self`), and `env.slackEnabled`. These describe who is looking and how the
  board is configured, not the MR, so a greyed row would only be noise.
- **State gates block the row.** Everything about the MR or its lanes
  (pipeline, draft, thread found, session exists, report ready). The row
  stays in its section with `blocked` set to the reason.

Blocking reuses the existing `MenuEntry.blocked` field (row-actions.ts), which
`ActionMenu` already renders as a disabled item with the reason under the
label. No new field.

## Sections

`Section` in `row-actions.ts` becomes
`'top' | 'agent' | 'sessions' | 'gitlab' | 'slack' | 'more'`.

- `top`: the reaction row, or "find slack thread" when Slack is on and no
  thread is found.
- `agent`: the review lane primary, the respond lane primary, call doctor,
  rebase locally, ask-respond (teammate MRs) and the seatless `seat-hint`.
- `sessions`, `gitlab`, `slack`, `more`: flyouts.

`ActionMenu` renders `top` and `agent` inline, and each other section as one
`ContextMenu.Sub` row. A section with exactly one row renders that row
inline instead of as a one-item flyout. An empty section renders nothing.

## Lane primaries

Lane primary wording is unchanged (`reviewMenuItems`, `respondItemLabel` in
`format.ts`):

| Lane status | Review lane | Respond lane |
|---|---|---|
| none or error | review | respond |
| done | re-review | restart response |
| running | focus review | focus response |
| pane gone | relaunch review | relaunch response |

Today `review` and `re-review` can both show: the board's review lane is none
or error, and `reviewLogged` is true because a human reviewed on GitLab. They
are different actions (`re-review` resumes the prior session or launches with
the re-review framing; `review` is a plain first review). In that case
`re-review` is the `agent` primary and `review` moves to `sessions` with the
label "review from scratch". Both keys stay.

## Placement of every action

| Key / action | Section | Shown when (role gates) | Blocked when (reason) |
|---|---|---|---|
| review / re-review / focus / relaunch review | agent | local | never; always one primary |
| review (when re-review is primary) | sessions | local, `reviewLogged`, lane none or error | never |
| respond / restart / focus / relaunch response | agent | local, own | never; always one primary |
| call doctor / again / focus doctor | agent | local, own | omitted when `pipelineFailing` and `hasConflicts` are both false (no unknown state exists; both are always booleans) |
| rebase locally | agent | local, own | omitted when no conflicts, no `shouldBeRebased` and `(behindTarget ?? 0) === 0`, as today. Null counts as 0 on purpose: the daemon's project list sync (`fetchPullRequests` with `projectPath`, GitLabProvider.ts) passes no diverged count, so null is the common case, not an unknown, and showing the row on null would put it on nearly every MR |
| resume review | sessions | local | no session id: "no session" |
| resume response | sessions | local, own | no session id: "no session" |
| view agent review | sessions | always (no local gate today) | report not ready: "no report yet" |
| view agent response | sessions | own (always shown when its report is ready, as today) | report not ready: "no report yet" |
| dismiss review line | sessions | local | lane not in error or already dismissed: "nothing to dismiss" |
| dismiss respond line / dismiss doctor line | sessions | local, own | lane not in error or already dismissed: "nothing to dismiss" |
| ask X's agent to re-review (`nudge-<reviewer>`) | sessions | local, own | when no reviewer qualifies, one placeholder `nudge-none` blocked with "no peer review" or "ask already sent" |
| request review from... | sessions | local, own | no roster member left: "everyone engaged"; an ask outstanding: "ask already sent" |
| ask {author}'s agent to respond | agent | local, seat, not own | "no finished review with comments", "author not enrolled" or "ask already sent" |
| seat-hint (author actions) | agent | local, no seat | always blocked, as today |
| merge | gitlab | local, own, open | draft: "draft"; merging: "merging"; not `isReady`: merge-status reason |
| rebase on target | gitlab | local, own | rebasing: "rebasing"; `behindTarget === 0` and no `shouldBeRebased`: "up to date" (a null `behindTarget` leaves it enabled; GitLab refuses a no-op rebase) |
| set / cancel auto-merge | gitlab | local, own, open | draft: "draft" |
| mark as draft / mark ready | gitlab | local, own | never |
| open in gitlab | gitlab | always | never |
| mark / unmark looking, commented, approved | top (reaction row) | local, Slack on, thread found | never |
| find slack thread / find it again | top | local, Slack on, thread not found | never |
| open MR post in slack | slack | local, Slack on | no thread: "no thread"; no permalink: "no link yet" |
| post to #channel / post to slack | slack | local, Slack on, own | thread found: "thread exists" |
| post to code owners... | slack | local, Slack on, own, repo in `ownerSlackRepos` | never (repo not listed is a config fact, so omitted) |
| copy for slack | slack | always | never |
| add a note / edit note | more | always | never |
| auto-doctor: ignore | more | local, own, seat | triage off and no doctor run active: "auto-doctor is off" |
| re-enable auto-doctor | more | local, own, seat | never |

"find slack thread" lives only in `top`; it is not repeated in the slack
flyout.

## Role menus

Following the table's role gates, with single-row sections inlined:

- **Own MR, local:** top (reactions or find thread), agent (two primaries,
  doctor and rebase locally when needed), then sessions, gitlab, slack and
  more flyouts.
- **Teammate MR, local:** top, agent (review primary, ask-respond), then
  sessions (resume review, review from scratch when it applies, view reports,
  dismiss review line), slack (open MR post, copy for slack), and inline
  "open in gitlab" and "add a note" (one-row sections).
- **Remote board:** no local gate passes, so only view reports (sessions),
  open in gitlab, copy for slack and the note row. `dismiss-*` and
  `stand-down` are dropped on purpose: their server routes refuse non-local
  requests today. One blocked line "agent actions need a local board" sits in
  `agent`, like the seat hint.
- **Seatless board:** as today, the `seat-hint` row in `agent` stands in for
  every own-only action.
- **Slack off:** no reaction row, no find thread, and the slack section holds
  only "copy for slack", so it renders inline.

## Disabled reasons from GitLab merge status

`merge`'s reason maps `detailedMergeStatus` to a short phrase, in a helper
next to `mergeButton` in glance's `MRDashboard.ts` so every glance consumer
words it the same way:

| Status | Reason |
|---|---|
| `ci_still_running` | pipeline running |
| `ci_must_pass` | pipeline must pass |
| `draft_status` | draft |
| `need_rebase` | needs rebase |
| `conflict` | conflicts |
| `not_approved` | needs approval |
| `requested_changes` | changes requested |
| `discussions_not_resolved` | open threads |
| `checking`, `unchecked`, `preparing`, `approvals_syncing` | checking |
| anything else | not mergeable yet |

## Auto-doctor toggle and triage state

The board's client payload gains `triageEnabled: boolean` (from
`triage.enabled`, default false in `apps/board/src/triage/config.ts`). The
toggle is blocked with "auto-doctor is off" only when triage is off AND no
doctor run is active on the MR. Turning stand-down on also stops a live
doctor pane and drops its held drafts, so a manually called doctor keeps
that path; "re-enable auto-doctor" is never blocked.

## Kit change

`@mattstack/tui-kit`'s `ContextMenu` has root, Item, Label and Separator, and
Item already supports `disabled` and `hint`. The whole recipe is rebuilt on
Base UI's Menu (`@base-ui/react`), the way soribashi's own recipes compose
Base UI, so submenu pointer travel, arrow-key focus, typeahead, focus return
and collision placement come from the library rather than hand-rolled code.
Its public API is unchanged. Two additions:

- **`Sub`**: an Item with a chevron that opens a nested menu on hover, or on
  Right arrow / Enter when the Sub row has focus. Left arrow or Escape closes
  only the open submenu; a second Escape closes the menu. The outside-click
  check treats the submenu's element as inside. The submenu flips to the
  left edge when it would overflow the viewport. The kit has no arrow-key
  navigation between items today and this spec does not add it.
- **`Row`**: a horizontal group of Items in one menu row, for the reaction
  toggles. Each toggle is still an Item (its own button, `keepOpen`
  behaviour unchanged).

Kit tests cover open and close by hover, keyboard and Escape, the outside
click, the edge flip, and a visual test in both schemes.

## Bulk menu

The bulk menu has no renderer of its own: Board.tsx passes `bulkActions(...)`
into the same `ActionMenu`. `ActionMenu` gains a `flat` prop; the bulk call
site passes it, and in flat mode every section renders inline with its
header, as today. `bulkActions` drops every row with `blocked` set from each
MR's `rowActions` output first, before the offered set and the target list
are built, so a blocked row is never counted as a target (the stack
merge block keeps working, since it is set by `bulkActions` itself after
that filter). Each bulk entry's section is folded back onto the three bulk
headings (`top`, `slack` and `more` to slack; `agent` and `sessions` to
agent; `gitlab` stays), so the bulk menu reads exactly as it does today, and
`SECTION_RANK` and `BULK_RANK` are unchanged.

## Kept behaviour

Merge's second-click confirm, the request-review picker stage, alt-click to
add a note before a launch, and the reaction row keeping the menu open while
several reactions are toggled.

## Tests

- `row-actions.test.ts`: a table of MR states (own fresh, own mid-flow, own
  broken, own no Slack thread, own draft with auto-merge, teammate, remote,
  seatless, Slack off). For each, the keys across all sections include every
  key `rowActions()` returns on the base commit for the same input, captured
  as a fixture. This is the guard: a key present before is present after,
  blocked or not. New keys (blocked rows that were omitted before,
  `nudge-none`, the remote hint) are allowed. The
  deliberate drops (`dismiss-*` and `stand-down` on remote boards) are listed
  in the test by name.
- One test per lane asserting exactly one primary row in `agent` for every
  lane status.
- A test that every blocked row carries a non-empty reason.
- DOM tests: a flyout opens, a blocked row shows its reason and does not run,
  a one-row section renders inline, and `flat` renders no Sub rows.
- The existing bulk, ask and pins DOM tests stay green.
- A browser check of the menu in light and dark mode before calling it done.

## Decided

- "call doctor" stays omitted at top level when the pipeline is healthy and
  there are no conflicts, as today.
- The auto-doctor toggle is blocked when triage is off, with the
  active-doctor exception above.
