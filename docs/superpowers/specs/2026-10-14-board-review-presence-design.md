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
- `config.orgTeams` holds every team in the org roster with its members.

## Design

### 1. Addressing: every org member, one envelope each

A new helper, `reviewPresenceRecipients(orgTeams, self, author, peers)`, in
`src/peer/`, returns the canonical usernames to notify:

- the union of every `orgTeams` member, plus the author (so an author outside
  the roster still gets today's envelope);
- minus this board's own `defaultMember`;
- intersected with the switchboard's `peers()` list when it answers, so
  un-peered members are not sent envelopes the relay would 4xx and the outbox
  would drop and log. When `peers()` answers null, no intersection.

The review sync and the closed-pane report each enqueue one `review-state` per
recipient with the same payload. Only the author's copy carries `nudgeId`
(the ask echo is the author's contract). `'*'` is never used.

The own-MR guard and `config.defaultMember === 'all'` guard stay as they are:
neither relays anything.

### 2. Receiving

No inbox change. A non-author board stores the state as a `PeerReviewState`
and the existing prune drops it when the MR is not on that board. The sent
nudge calls are no-ops there, since a non-author board's sent nudges on a
teammate's MR are respond asks whose reviewer is the author, not the sender.

### 3. Staleness

A `queued`/`reviewing` peer state whose `updatedAt` is more than 2 hours old
is stale: `peerLines` does not show it as reviewing, and it does not trigger
the launch warning. The cutoff is one exported constant,
`PEER_REVIEW_STALE_MS`, shared by server and client. This covers a reviewer
board that goes offline mid-review, which no closed-pane report reaches.

### 4. Launch warning

`Board.tsx`'s review launch checks the MR for a fresh `queued`/`reviewing`
peer state from someone other than this board's member. If one exists:

- an interactive launch opens a confirm, "<reviewer> is already reviewing
  this. Review anyway?", built on the existing confirm dialog pattern
  (`AskConfirmDialog`); confirming launches as today, cancelling does nothing;
- a quiet launch skips that MR and does not prompt.

Launching anyway needs no extra signal: the new review's own `review-state`
broadcasts, and both reviewers show.

### 5. Compatibility

- An older receiving board already handles `review-state`, so it shows the
  line from an updated sender.
- An older sender still addresses only the author, so its reviews stay
  invisible to third parties until it updates.
- The relay is unchanged.

## Testing

- `reviewPresenceRecipients`: union across teams, author included when off
  roster, self excluded, peers intersection, null peers.
- Review sync enqueues one envelope per recipient; only the author's carries
  `nudgeId`; own-MR and `defaultMember: "all"` still enqueue nothing.
- Closed-pane report fans out the same way and still reports once per run.
- Inbox: a `review-state` from a non-author peer leaves this board's sent
  nudges untouched.
- Staleness: fresh vs. 2h-old `reviewing` in `peerLines` and the warn
  predicate.
- Launch: interactive launch with a fresh peer review prompts; quiet launch
  skips; no peer review launches straight through.
- UI: a fixture board with a peer review in `reviewing`, checked in Fast
  Browser in light and dark, including the confirm.

## Out of scope

- Reviews started outside the board (GitLab's own "reviewer is reviewing"
  line already covers humans).
- Any switchboard change, including org scoping on the relay.
- A setting for the stale cutoff.
