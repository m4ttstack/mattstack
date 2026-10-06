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
this spec is the first thing that sets it. An older sender's ask carries
none of them; the card falls back to the recipient's own row data, then to
`!iid` alone.

### The decision

`decideRequest` (`triage/nudge.ts:49-103`) keeps its order (handled, peer
asks off, stale, kind-specific rejects) and adds one step before dispatch:

- Sender in `board.peerAsksAlwaysAllow`: dispatch as today, budget and
  cooldown included.
- Otherwise: a new action `hold`. The nudge stays unhandled, the pass
  publishes a `nudge-outcome` with the new result `pending`, and notifies
  once (below). A held nudge is not re-notified on later passes; `NudgeState`
  gains `notifiedAt?` to remember that.

Stale asks still expire at 48h (`NUDGE_FRESH_MS`) and publish `expired`.

### Accepting and declining

Two new local-only routes on the board server, guarded like `/nudge`
(`isLocalRequest` plus `hasLocalOrigin`):

- `POST /asks/:id/accept`: runs the kind-specific reject rules (an
  in-flight review still refuses), skips budget and cooldown (a click is an
  explicit human choice, like a row verb today), launches through the same
  `launchAsk` seam `bin/triage.ts:298-335` wires for the triage pass, marks
  the nudge handled and publishes `launched`. Moving `launchAsk` and
  `publishOutcome` into a module both the server and triage import is part of
  this work; the route must not shell out to `board triage`.
- `POST /asks/:id/decline` with `{ reason?: 'busy' | 'not-my-area' | 'later', note?: string }`:
  marks the nudge handled with result `rejected` and publishes it.

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
  board's own token, stored as a column on the `boards` row (default true).
- `/peers` returns only boards with asks enabled. Its shape (usernames) does
  not change, so every client's picker filters with no client change.

The board server sends its current `board.peerAsks.enabled` at startup and
whenever the setting changes. A relay that predates the route answers 404;
the board logs once and carries on, and the receiver still declines anything
that arrives while off (`decideRequest`'s existing `disabled` skip, which now
also publishes `rejected` with reason `asks off` so the asker is not left
waiting).

## The notification

When the pass holds a new ask it posts to the tray (`triage/notify.ts`'s
socket path) with a new category `peer-ask`, independent of `triage.notify`:

- title: "Rae Marlow asked for a review" (re-review / "asked your agent to
  respond" for the others)
- body: "!1388 debounce the claim search input on slow networks", then
  "Your agent waits for your go ahead."
- url: `<board>/?ask=<nudge id>`

The tray registers `peer-ask` with no actions (`NotificationManager.swift`'s
category list). The osascript fallback carries no url and stays as is.

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
open state tinted. It opens a Mantine `Popover` at `position="bottom-end"`
with a 6px offset, so its right edge lines up with the button.

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
  who, kind, `!iid`, title and outcome (reviewed, responded, always allowed,
  declined with its reason, expired), then the always-allowed chips with
  their remove buttons. Handled rows are kept 14 days even after their MR
  leaves the board (`pruneNudges` changes accordingly).

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

Picking a peer, or clicking the re-review or respond item, opens the kit's
`modals.prompt`, never a bespoke dialog:

- title: "Ask Mira's agent to review !1271?"
- message: "It runs on Mira's Mac with Mira's Claude usage, once Mira says go
  ahead."
- field: "Note for Mira (optional)", not required
- buttons: Cancel, Send ask

If `modals.prompt` cannot label its confirm button or leave the field
optional, that is a kit change raised before building, not a local dialog.
The bulk menu's "request review from…" opens one dialog for the whole
selection, and its note rides every ask. `action-runner.ts`'s ask payload
gains `note`, `title` and `sourceBranch`; `/nudge` passes them to
`buildAskDraft`.

## The asker's band

`sentNudgeDisplay` (`peer/nudges.ts:393-400`) learns `pending` from the new
outcome. `NudgeResult` (`peer/envelope.ts:5`) becomes
`'pending' | 'launched' | 'rejected' | 'expired'`, and
`NudgeOutcomePayload` gains `declineNote?: string`. The overwrite rules
(`nudges.ts:211-214`) let any later result replace `pending`.

`client/board/ask-band.ts`:

- `pending`: neutral, hourglass, "waiting for Mira's go ahead", with the
  "Sent 10:49 AM" note. A new step between Requested and Started.
- `rejected` from a decline: "Mira declined: busy right now" (the reason
  chip's words; the bare "Mira declined" when none was picked), the note in
  the band's expanded steps, and Dismiss only. A decline is never retried
  by a button. Other rejections keep Retry.
- `rejected` with reason `asks off`: "Mira has asks turned off", Dismiss only.
- An always-allowed ask goes requested → reviewing as it does today.

The decline `reason` on the wire is the chip's words ("busy right now"), so
an older asker's band, which prints `declined: ${reason}`, still reads well.

## Versions in the field

- Old sender, new receiver: the ask waits for consent; the card has no note
  and takes its title from the recipient's board.
- New sender, old receiver: the old board auto-starts as today (or shows its
  row line with `peerAsks` off). Consent arrives when the receiver updates.
- An old asker's board drops the `pending` outcome it cannot parse and stays
  at "review requested" until the run starts or is declined.

## Testing

- `decideRequest`: always-allowed dispatches, everyone else holds, held asks
  notify once, stale still expires, off now publishes `rejected: asks off`.
- Envelope: `pending` and `declineNote` round-trip; an unknown result is
  still dropped.
- `sentNudgeDisplay`: `pending` replaced by every later result.
- Accept and decline routes: local-only guards, accept skips budget and
  cooldown but keeps the in-flight refusal, decline publishes the reason and
  note.
- Relay: `PUT /boards/self/asks` needs the board's own token; `/peers` omits
  a board with asks off.
- `deep-link.ts`: `?ask=` opens and strips; a stale id flashes nothing.
- Stories in `Gates/Board/Gallery`'s neighbourhood for the dropdown (three
  kinds, decline form, brief confirm, empty, history) and the new ask bands,
  with invented names.
- Capture fixture: add pending asks to `tests/fixture` so `capture:compare`
  covers the header button; the dropdown states are checked by hand.
- Every UI milestone ends with Fast Browser screenshots in light and dark,
  compared against the boards. The boards are light only, so dark is judged
  by the role tokens and by eye, and anything that reads wrong is reported.
