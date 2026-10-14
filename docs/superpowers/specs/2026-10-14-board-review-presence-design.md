# Board review presence across the org

## Problem

When a teammate's MR is up for review, two people on the board can both pick
it up. The board already tells the MR author's board when a review starts
(`review-state` over the switchboard), but nobody else hears it, so Ed's board
cannot show that Matt is already reviewing.

## Goal

When anyone in the org starts a board review of a teammate's MR, every other
org member's board shows "<reviewer> is reviewing…" on that MR, and launching
a second review asks for confirmation first. Nothing leaves the org.

## What exists today

- `src/server.ts` (review sync, around the `review-state` `makeEnvelope`):
  on each review status transition of a teammate's MR, the board enqueues a
  `review-state` envelope addressed to the MR author. Reviews of the board's
  own MR are never relayed.
- `src/peer/closed-pane.ts`: when a review pane dies mid-run, the board sends
  the author an `error` `review-state`, so the author's line clears.
- `src/peer/inbox.ts`: a received `review-state` is stored as a
  `PeerReviewState` keyed by MR + reviewer, then resolves or finishes the
  board's sent nudge for that MR only when the nudge's reviewer is the
  envelope's sender.
- `src/server.ts` prunes stored peer reviews to the MRs on the board.
- `src/client/board/row-status.ts` (`peerLines`) already renders
  "<reviewer> is reviewing…" for any stored `queued`/`reviewing` state.
- The switchboard has no notion of org or team: boards are keyed by username,
  and `to: '*'` reaches every board on the relay, other orgs included.
- `config.orgTeams` holds every team in the org roster with its members;
  roster members with no team are not in it.

## Design

### 1. Addressing: every org member, one envelope each

**Recipient source.** A new config field, `orgMembers: string[]`, holds the
canonical usernames of every entry in `mattstack.roster`, whatever its
`teams` (teamless members and orgs with no teams included). `config.orgTeams`
is not used: `orgTeamsFromStore` drops members with no team.

**Enrolled list.** `SwitchboardClient` gains `enrolled(): Promise<string[] |
null>`, returning the relay's `/peers` `peers` field (every enrolled board).
`peers()` is unchanged; it returns `askable`, which drops anyone with asks
off and must not be used here. No relay change.

**Helper.** `reviewPresenceRecipients({ orgMembers, self, author, enrolled })`
in a new pure module `src/peer/presence.ts` (no `bun:sqlite`, `fs` or node
imports, so the client can import it too) returns:

- the author, always and unfiltered (today's envelope, unchanged);
- plus every `orgMembers` entry other than `self` and the author,
  intersected with `enrolled` when it answers; when `enrolled` is null, no
  intersection (un-enrolled members cost one logged outbox drop each).

**Senders.** The review sync in `src/server.ts` enqueues one `review-state`
per recipient with the same payload; only the author's copy carries
`nudgeId` (the ask echo is the author's contract). The closed-pane report
gets a new `ClosedPaneIO` dependency, `recipients(author)`, fetched alongside
executors and authors, and fans out the same way. All of one MR's envelopes
and its run marker commit in one transaction. `'*'` is never used.

The own-MR guard and the `config.defaultMember === 'all'` guard stay as they
are: neither relays anything.

### 2. Receiving and rendering

Storage is unchanged except that `PeerReviewState` gains `receivedAt` (the
envelope's relay clock, which `inbox.ts` already has); a state written
before this field exists reads `receivedAt` as `updatedAt`. The existing
prune drops states for MRs not on the board. The sent-nudge calls are no-ops
on a non-author board: its sent nudges on a teammate's MR are respond asks
whose reviewer is the author, and the inbox only resolves a nudge whose
reviewer is the envelope's sender.

`peerLines` renders by whether this board is the MR author's:

- **Author's board:** as today (reviewing line, then the done verdict line).
- **Any other board:** only a fresh `queued`/`reviewing` state renders, as
  "<reviewer> is reviewing" in tone `quiet`, led by a cloud spinner, and the
  existing `view-peer` verb. The cloud spinner is `AgentCloudGlyph`
  (`src/client/board/icons.tsx`, the peer-agent mark in the row menu) with
  its accent bot unchanged, animated two ways at once: the cloud's inside,
  clipped to the cloud path, pulses between two close skeleton greys over
  1.8s (ease-in-out), while a short darker dash (30% of the path length)
  runs clockwise round a light grey outline every 1.6s (an animated
  `stroke-dashoffset`). The bot holds still. It is a new `spin: 'cloud'`
  style on the candidate, independent of tone. Under
  `prefers-reduced-motion` both animations stop and the glyph rests with a
  plain outline and a mid-grey fill. The approved motion reference is
  option F in the preview built during design (light and dark). `quiet`, not `work`: `needs-me.ts` `lineNeed` reads a
  `work` line as busy, which would drop the MR from this member's Needs me
  tab even when they are the assigned reviewer. Needs me is unchanged.
  `done`, `error` and stale states render no line, so the row falls back to
  its normal reviewer line (launch verb, "author answered you", "changes
  requested" and the rest).

"The author's board" is `isOwnMr(mr, seat)`. The seat is null on an `all`
board or when the GitLab token user does not match the seat; those boards
follow the non-author rule, so they hide done verdicts even on the real
author's own MRs. Accepted: an `all` board is a view of everyone, and a
mismatched token is already a misconfiguration.

The client's `PeerReviewInfo` (`src/client/types.ts`) gains the same
optional `receivedAt`.

### 3. Staleness

A `queued`/`reviewing` state whose `receivedAt` is more than 2 hours old is
stale: it renders no line on any board (the author's included, which today
shows it forever) and does not trigger the launch warning.
`PEER_REVIEW_STALE_MS` lives in `src/peer/presence.ts` with an
`isFreshPeerReview(state, now)` predicate; only the client uses it. Judging
on `receivedAt` keeps the rule that freshness is judged on the relay's
clock. This covers a reviewer board that goes offline mid-review, which no
closed-pane report reaches.

### 4. Launch warning

A peer is "reviewing" an MR when it has a fresh `queued`/`reviewing` state
from a reviewer other than this board's member.

| Path | Behaviour when a peer is reviewing |
|---|---|
| Interactive `review` / `re-review` launch through `launch()` in `Board.tsx` | Confirm first |
| `resume-review`, `intent: 'focus'`, redo (`handleRedo`) | Launch as today, no confirm (it is this board's own run) |
| Bulk launch (`action-runner.ts` `bulkPlan` → `runMany`) | Drop the MR at target selection, before `runMany`, tracked as its own `presenceSkipped` list, separate from the existing "N didn't need it" count. The summary toast names each one ("skipped !N, <reviewer> is reviewing"), and still shows when every selected MR was dropped (the empty-`targets` early return in `runMany` must not swallow it) |
| Accepting an ask (`acceptAsk`, `src/peer/ask-actions.ts`) and triage auto-dispatch (`src/triage/nudge.ts`) | Launch as today; the author asked this person directly |

The confirm reads "<reviewer> is already reviewing this. Review anyway?" and
follows `RedoConfirmDialog`'s shape (a pending run, confirm or cancel, no
note field). Confirming launches as today; cancelling does nothing.
Launching anyway needs no extra signal: the new review's own `review-state`
fans out, and both reviewers show.

### 5. Compatibility

- An older receiving board already handles `review-state`, so it shows the
  line from an updated sender. It has no stale cutoff or author-only done
  rule, so a dead reviewer's line or a done verdict stays on it until it
  updates.
- An older sender still addresses only the author, so its reviews stay
  invisible to third parties until it updates.
- A board from before the sender gate on nudge resolution (#653) could have
  a third party's `review-state` confirm or finish its respond ask. Accepted:
  every board in the org runs a newer build.
- The relay is unchanged.

## Testing

- `reviewPresenceRecipients`: teamless members included, self excluded,
  author always included even when absent from `enrolled`, members with asks
  off still included, null `enrolled`.
- `orgMembers` built from a roster with teamed, teamless and no-team entries.
- `enrolled()` reads `peers`, not `askable`.
- Review sync enqueues one envelope per recipient; only the author's carries
  `nudgeId`; own-MR and `defaultMember: "all"` still enqueue nothing.
- Closed-pane report fans out through `recipients(author)`, commits envelopes
  and marker together, and still reports once per run.
- Inbox: a `review-state` from a non-author peer stores `receivedAt` and
  leaves this board's sent nudges untouched.
- `peerLines`: author board unchanged; non-author board shows fresh
  reviewing only, in tone `quiet` with the cloud spinner, and done/error/stale fall through to the
  reviewer line.
- Needs me: an MR where this member is the assigned reviewer stays in Needs
  me while a peer is reviewing it.
- Staleness: fresh vs. 2h-old `receivedAt`; a legacy state without
  `receivedAt`.
- Launch: interactive review prompts; resume, focus and redo do not; bulk
  drops the MR into `presenceSkipped`, apart from "didn't need it", and the
  toast shows even when every target was dropped; no peer review launches
  straight through.
- UI: a fixture board with a peer review in `reviewing`, checked in Fast
  Browser in light and dark, including the confirm and the bulk toast.

## Out of scope

- Reviews started outside the board (GitLab's own "reviewer is reviewing"
  line already covers humans).
- Any switchboard change, including org scoping on the relay.
- A setting for the stale cutoff.
