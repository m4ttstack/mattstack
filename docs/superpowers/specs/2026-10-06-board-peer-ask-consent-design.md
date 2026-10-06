# Board: asks for your agent wait for your OK

## Problem

A teammate can ask your board's agent to review, re-review or respond, and
with `board.peerAsks` on your Mac starts the agent at once. The run spends
your Claude usage on your machine, and you never agreed to it. With the
setting off, the ask shows up only as a status line on the MR row ("Rae asked
for a review · click review to start"), which is easy to miss and is exactly
the row clutter the face-lift removed.

## Goals

- Every ask waits for the person whose agent it would use, unless they have
  chosen to always allow that teammate.
- Asks arrive as a push notification and live in one place, an inbox in the
  board header, never as a status on an MR row.
- The asker sees where the ask stands: waiting, started, declined (with the
  reason), or no answer.
- The asker can attach an optional note, confirmed in a dialog before the ask
  goes.
- `board.peerAsks` stays the on/off switch for receiving asks at all; off
  takes you out of everyone's picker.

## Non-goals

- Asks between boards that are not peered through the switchboard.
- New ask kinds. The three that exist (review, re-review, respond) are all
  covered.
- Notification action buttons. The push only takes you to the ask.
- Per-kind trust ("always allow Rae's reviews but not responds").

## Design boards

`docs/apps/design/board/board.pen`, renders in
`docs/apps/design/board/renders/R*.light.png`, drawn on the fixture board
with invented names. They are the visual reference; any difference in the
built UI is a defect.

| Board | What it fixes |
|---|---|
| R1 · Where asks for your agent land | C, the header inbox button and dropdown, is chosen; A and B are kept for the record |
| R2 · The push lands you on the ask | the banner, the board opening with the dropdown open, the slow flash, the asker's band steps |
| R3 · Dropdown states | the inline decline form, the brief confirm after accepting, nothing waiting, history with the always-allowed list |
| R4 · Sending an ask | the row menu, the peer submenu with the cloud and agent glyph, the confirm dialog with the note |

## The ask kinds

All three exist today (`client/board/row-actions.ts:358-406`) and all three
need consent, since each runs on the recipient's Mac:

| Kind | Sent by | From the row menu | Card verb | Lane colour |
|---|---|---|---|---|
| review | the author, to a teammate not yet engaged | "request review from…" + peer submenu | Review | review blue |
| re-review | the author, to a peer whose agent reviewed with comments | "ask Tom's agent to re-review" | Re-review | review blue |
| respond | a reviewer whose review ended with comments, to the author | "ask Dani's agent to respond" | Respond | respond green |

## Receiving an ask

### What arrives

`ReReviewRequestPayload` (`peer/envelope.ts:43`) gains two optional fields
the sender fills from its own row, so the card renders even when the MR is
not on the recipient's board: `title?: string` and `sourceBranch?: string`
(the Linear link is read off the branch with `extractTicketId`, as
`MrLinks` does). `note?` already exists on the wire and in `NudgeState`;
this spec is the first thing that sets it. `parseReReviewRequestPayload`,
the materializer (`peer/inbox.ts:115`) and `NudgeState` all carry `title`
and `sourceBranch`. An older sender's ask carries none of them; the card
falls back to the recipient's own row data, then to `!iid` alone.

A waiting ask is kept whether or not its MR is on this board: today
`pruneNudges` (`nudges.ts:113`, run on every healthy snapshot) deletes any
nudge whose MR left the board, pending ones included. It changes to delete
only handled rows older than 14 days (history) and, as a safety net,
unhandled rows older than 14 days; a waiting ask is otherwise answered or
expired by the triage pass at 48h.

### The decision

The hold lives in `runNudgePass` (`triage/nudge.ts:208-318`), not in
`decideRequest`, which the re-review latch pass also calls
(`latch.ts:284`, with no sender). For each nudge, the pass reads the
sender (`nudge.from`, already canonical) against
`board.peerAsksAlwaysAllow` (canonicalized with `canonicalUsername`):

- Always-allowed: `decideRequest` exactly as today, budget and cooldown
  included, and a dispatch marks the nudge handled `launched` with reason
  `always-allowed`.
- Everyone else: `decideRequest` with budget and cooldown lifted (a person
  will decide). Its kind-specific refusals (in flight, already reviewed, not
  your MR) and stale expiry still answer the asker at once. A would-be
  dispatch becomes a hold instead: the nudge stays unhandled, the pass
  publishes a `nudge-outcome` with the new result `pending` and notifies once
  (below). `NudgeState` gains `notifiedAt?` so later passes stay quiet.

Stale asks still expire at 48h (`NUDGE_FRESH_MS`) and publish `expired`.

With `board.peerAsks` off, `runNudgePass` declines every unhandled nudge with
reason `asks-off` before it calls `decideRequest` (the board server's tick
does the same; see the relay section); `decideRequest`'s own `disabled` skip
stays as it is for the latch.

### Accepting and declining

Three new local-only routes on the board server, guarded like `/nudge`
(`isLocalRequest`), each taking a JSON body because the server's router
matches whole paths:

- `POST /asks/accept` with `{ id, alwaysAllow?: boolean }`: runs the
  kind-specific reject rules (an in-flight review still refuses), skips
  budget and cooldown (a click is an explicit human choice, like a row verb
  today), launches through the same launcher `bin/triage.ts:298-335` builds
  for the triage pass, marks the nudge handled `launched` with reason
  `accepted` and publishes `launched`. When a kind rule refuses or the ask
  went stale, the nudge is marked handled `rejected` or `expired`, the
  outcome goes to the asker, and the route answers 409 with the plain reason
  for the card to show. With `alwaysAllow` it adds the sender to the
  always-allow list only after the nudge is marked handled, so a triage pass
  running at the same moment cannot launch it a second time. Moving the
  launcher into a module both the server and triage import is part of this
  work; the route must not shell out to `board triage`.
- `POST /asks/decline` with `{ id, reason?: 'busy' | 'not-my-area' | 'later', note?: string }`:
  marks the nudge handled with result `rejected`, `declined: true`, the
  chip's words as its reason and the note, and publishes it.
- `POST /asks/always-allow` with `{ username, allow: boolean }`: adds to or
  removes from the always-allow list (the history view's chips).

Today a row verb launched on an ask never marks the nudge handled (the
server does not import `markNudgeHandled`). Accept fixes that for the inbox
path; the row's own verbs no longer show for inbound asks (below), so there
is no second path to keep in step.

### Always allow

A new registry row in `packages/rt-client/src/settings/registry-defs.ts`,
modelled on `board.hiddenMembers`:

```ts
{
  key: "board.peerAsksAlwaysAllow",
  type: "array",
  scopes: ["user"],
  merge: "replace",
  description: "Teammates (usernames) whose asks for this board's agent start without waiting for a go-ahead. Everyone else's ask waits in the asks inbox.",
}
```

No `default:`, per the `board.*` rule. The card's "always allow Rae" box adds
Rae when the card's verb is clicked with it ticked (ticking alone does
nothing); the history view lists the set as removable chips. Writes go
through `setSetting`, never a hand-edited store.

### `board.peerAsks` keeps its key, changes its meaning

Today on means "start every ask". From this change on it means "accept
asks": they reach the inbox and wait for consent unless always-allowed. Off
means nobody can ask you. Update the row's description to say so. Machines
that have it on see asks wait from the first launch after the update; that
is the point of the change and goes in the release notes.

Off must take you out of every picker, and today it cannot: `/peers` lists
every enrolled board (`switchboard/server.ts:155-163`) and a board cannot
withdraw itself. The relay gains:

- `PUT /boards/self/asks` with `{ enabled: boolean }`, authenticated by the
  board's own token, recorded in a new `asks_off` table (one row per board
  that turned asks off), so the existing `boards` table needs no migration.
  Deleting a board clears its row.
- `/peers` keeps `peers` as every enrolled board, because `rt team status`
  reads it for its `peered` field (`lib/team/board-peers.ts`), and adds
  `askable`: the enrolled boards with asks on. The board's
  `SwitchboardClient.peers()` reads `askable` when present and falls back to
  `peers` against an older relay, so `/data.json`'s `peers` (what every
  picker filters on) becomes the askable list. `firstReviewTargets` and
  `respondAskTarget` already filter on it; `nudgeTargets`
  (`client/board/format.ts:124`, the "ask Tom's agent to re-review" items)
  does not, and gains the same filter. An older client still offers asks to
  a board with asks off; the receiver answers that below.

The board's peer tick sends its current `board.peerAsks.enabled` whenever it
differs from the last value the relay accepted, so startup and a settings
change both reach the relay within one tick. A relay that predates the route
answers 404; the board logs once and carries on.

An ask that still arrives while asks are off, and any ask already waiting
when they are turned off, is declined with reason `asks-off` by the board
server's peer tick, which runs every minute whether or not a triage pass
does (with `board.peerAsks` off the board-peer trigger is uninstalled, and
the full pass runs only with `board.triage` or `board.reReview` on). The nudge
pass declines the same way when it runs, for a Mac whose board server is
down; both skip handled rows, so neither answers twice. While asks are off
the inbox therefore empties within a tick, and Accept answers 409.

## The notification

When the pass holds a new ask it posts to the tray (`triage/notify.ts`'s
socket path) with a new category `peer-ask`, independent of `triage.notify`:

- title: "Rae Marlow asked for a review" (re-review / "asked your agent to
  respond" for the others)
- body: "!1388 debounce the claim search input on slow networks", then
  "Your agent waits for your go ahead."
- url: `<board>/?ask=<nudge id>`

No tray change: a category the tray does not register (as `mr-doctor`
today) still shows as a banner and opens its url on click. The osascript
fallback carries no url and stays as is.

### Landing on the ask

`client/board/deep-link.ts` gains an `ask` param beside `gate` and `mr`:
open the asks dropdown, scroll the card into view, flash it, then strip the
param. The flash is two slow pulses of the accent tint and a 2px accent ring
on the card, about 1.2s each, then rest. Under `prefers-reduced-motion` the
card takes the tint once and fades it, no pulse. An `ask` id that is no
longer pending opens the dropdown with nothing flashed.

## The inbox (R1 C, R3)

A button in the header card's icon group, left of refresh: the inbox glyph
with a count badge while anything waits, no badge when nothing does, and the
open state tinted. It opens a dropdown whose right edge lines up with the
button, 6px below it. Board renders through `@mattstack/tui-kit`, which has
no anchored panel today (`ContextMenu` is a menu, with menu roles and item
focus, and cannot hold a form), so this work adds a `Popover` recipe to
tui-kit on Base UI's Popover, the same positioning box `ContextMenu` uses,
with `side="bottom"` and `align="end"`.

The dropdown: a head ("Asks for your agent", "N waiting", a "history" link),
one card per waiting ask, oldest first, and a foot ("Asks run on this Mac with
your Claude usage.").

A card, top to bottom:

1. avatar, name, "asked for a review" / "asked for a re-review" / "asked your
   agent to respond", `· !iid`, age on the right
2. the MR title, with the forge and Linear logo links on the right (reuse
   `MrLinks`)
3. the asker's note, when there is one
4. the verb button in its lane colour with the bot mark (Review, Re-review,
   Respond), a quiet Decline, and the "always allow Rae" checkbox on the right

States (R3):

- **Decline** swaps row 4 for an inline form: "Decline Rae's ask. Tell Rae
  why? (optional)", reason chips (busy right now, not my area, ask me later;
  single choice, none picked is fine), a one-line note, Cancel and a red
  Decline. Cancel restores the buttons.
- **After the verb** the card shrinks to one line for about 4s ("Your agent is
  reviewing !1388" with a focus link), then leaves for history. The MR row's
  own review lane carries the run from there.
- **Nothing waiting**: "No one has asked for your agent." with history one
  click away.
- **History** replaces the list: the last 14 days of handled asks, each with
  who, kind, `!iid`, title and outcome, then the always-allowed chips with
  their remove buttons. Handled rows are kept 14 days even after their MR
  leaves the board (`pruneNudges` changes accordingly). The outcome reads
  off the handled row:

  | Handled row | History says |
  |---|---|
  | `launched`, reason `accepted` | reviewed / re-reviewed / responded |
  | `launched`, reason `always-allowed` | the same, then "· always allowed" |
  | `rejected`, `declined` | "declined: busy right now", or "declined" |
  | `rejected`, any other reason (a board rule) | "skipped: " and `plainReason`'s words, e.g. "skipped: a review is already running" |
  | `expired` | "expired, no answer in 48h" |

  The handled record therefore gains `declined?: true` and `note?: string`
  beside `reason`, and the payload carries a `reasonText` the server fills
  from `plainReason` for board-rule rejections.

The data rides `/data.json` as a top-level `asks: { pending, history,
alwaysAllow }`, not on MR rows.

### Off the MR row

Inbound asks no longer render as status lines on the row:
`peerLines`'s nudge loop (`client/board/row-status.ts:599-614`) and
`awaitsClick` go. The asker's own row keeps its ask band (next section).

## Sending an ask (R4)

The row menu keeps its items and its peer submenu. The submenu rows and the
"request review from…" item take the cloud-plus-agent glyph: the cloud with
the bot mark overlapping its lower right on a knockout in the menu's
background, matching R4.

Picking a peer, or clicking the re-review or respond item, opens tui-kit's
`ConfirmDialog` with `intent="accent"`, never a bespoke dialog:

- title: "Ask Mira's agent to review !1271?"
- body: "It runs on Mira's Mac with Mira's Claude usage, once Mira says go
  ahead.", then tui-kit's `Field` labelled "Note for Mira (optional)" around
  a one-line input
- buttons: Cancel, Send ask

The bulk menu's "request review from…" opens one dialog for the whole
selection ("Ask Mira's agent to review 3 MRs?"), and its note rides every
ask. The client's ask request gains
`note`; `/nudge` passes it to `buildAskDraft` along with `title` and
`sourceBranch`, which the server reads off its own snapshot of the MR.

## The asker's band

`sentNudgeDisplay` (`peer/nudges.ts:393-400`) learns `pending` from the new
outcome. `NudgeResult` (`peer/envelope.ts:5`) becomes
`'pending' | 'launched' | 'rejected' | 'expired'`, and
`NudgeOutcomePayload` gains `declined?: true` (a person said no, as opposed
to a board rule refusing) and `declineNote?: string`; `SentNudgeResolution`
and the materializer carry both. The overwrite rules (`nudges.ts:211-214`)
let any later result replace `pending`.

Today an unanswered ask turns into `no-response` after 48h only because it
has no resolution; `pending` is a resolution, so `sentNudgeDisplay` treats a
`pending` older than `NUDGE_NO_RESPONSE_MS` as `no-response` too. A receiver
that goes offline after saying "pending" still ends in "no answer" with
Retry and Dismiss. `askInFlight` (`row-status.ts:617-620`) counts `pending`
as in flight beside `requested`, `confirmed` and `launched`.

`client/board/ask-band.ts`:

- `pending`: neutral, hourglass, "waiting for Mira's go ahead", with the
  "Sent 10:49 AM" note. A new step between Requested and Started.
- `rejected` from a decline: "Mira declined: busy right now" (the reason
  chip's words; the bare "Mira declined" when none was picked), the note in
  the band's expanded steps, and Dismiss only. A decline is never retried
  by a button. Other rejections keep Retry.
- `rejected` with reason `asks-off`: "Mira has asks turned off", Dismiss only.
- An always-allowed ask goes requested → reviewing as it does today.

A decline's `reason` on the wire is the chip's words ("busy right now"), or
absent when none was picked, so an older asker's band, which prints
`declined: ${reason}` or `declined`, still reads well.

## Versions in the field

- Old sender, new receiver: the ask waits for consent; the card has no note
  and takes its title from the recipient's board.
- New sender, old receiver: the old board auto-starts as today (or shows its
  row line with `peerAsks` off). Consent arrives when the receiver updates.
- An old asker's board drops the `pending` outcome it cannot parse and stays
  at "review requested" until the run starts or is declined.

## Testing

- `runNudgePass`: always-allowed dispatches, everyone else holds, held asks
  notify once, stale still expires, asks off publishes `rejected: asks-off`.
- Envelope: `pending` and `declineNote` round-trip; an unknown result is
  still dropped.
- `sentNudgeDisplay`: `pending` replaced by every later result, and read as
  `no-response` past 48h.
- The latch pass is unchanged: `decideRequest` gains no hold, and a latch
  re-review still dispatches.
- `pruneNudges`: a waiting ask for an MR off this board survives a snapshot.
- `nudgeTargets` drops a peer that is not in `peers`.
- Accept and decline routes: local-only guards, accept skips budget and
  cooldown but keeps the in-flight refusal, decline publishes the reason and
  note.
- Relay: `PUT /boards/self/asks` needs the board's own token; `/peers`'
  `askable` omits a board with asks off while `peers` still lists it.
- The board server's peer tick declines waiting asks with `asks-off` while
  asks are off, and leaves handled ones alone.
- `deep-link.ts`: `?ask=` opens and strips; a stale id flashes nothing.
- Stories in `Gates/Board/Gallery`'s neighbourhood for the dropdown (three
  kinds, decline form, brief confirm, empty, history) and the new ask bands,
  with invented names.
- Capture fixture: add pending asks to `tests/fixture` so `capture:compare`
  covers the header button; the dropdown states are checked by hand.
- Every UI milestone ends with Fast Browser screenshots in light and dark,
  compared against the boards. The boards are light only, so dark is judged
  by the role tokens and by eye, and anything that reads wrong is reported.
