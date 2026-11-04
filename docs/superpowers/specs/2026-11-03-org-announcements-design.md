# Org announcements

## Intent

Org owners and admins need a simple way to tell the org something needs action
now: "update rt today", "CI is down". Today every rt notification is local to
one Mac. Announcements send a macOS notification to teammates' Macs by reusing
the existing switchboard, without building anything new on it.

## Goals

- An org owner or admin sends one message from an `rt` command.
- Members with a connected, running board get a macOS notification within about
  a minute.
- A Mac that was asleep gets it when it comes back, unless it is over a day old.

## Non-goals

- Relay changes, a new daemon loop, or a tray app change.
- "Got it" or any record of who read it. Matt dropped this to keep the build
  small; it can be added later.
- Reaching Macs with no connected, running board.
- Team targeting, scheduling, replies, or sending from the console.
- Breaking through Focus or Do Not Disturb.

## Anti-goals

- A notification from anyone who is not an owner or admin of this Mac's org.
- An announcement reaching an agent. These are for people.

## Approaches

**1. New relay channel.** Admin-only routes, the daemon listening on every Mac,
and receipts. It is fast and reaches everyone, but it is far more to build.
Matt picked this first, then replaced it to avoid overbuilding.

**2. Reuse the switchboard's existing messages (picked).** No relay work, at the
cost of the limits below.

**3. Org repo plus a wake-up.** Still needs relay work, and banners wait on a
git pull.

## Design

**Sending.** `rt team announce` (exact verb shape is the builder's call):

1. Refuses unless `isOrgAdmin` is true for this Mac's role.
2. Reads this Mac's board token with `readBoardSwitchboardToken`, and refuses
   if there is none.
3. Posts to the existing `POST /envelopes` with `to: '*'`, type `announcement`,
   and payload `{ title, message }`.
4. Reports the `delivered` count from the reply, worded as queued, since it
   counts boards that will receive it rather than people who have read it.

**Receiving.** `materializeEnvelope` in `apps/board/src/peer/inbox.ts` gains an
`announcement` branch:

1. Parses the payload with a parser shared with `rt` through rt-client, capping
   length. It stays out of `envelope.ts`, which the relay imports and whose
   edits trigger a relay deploy.
2. Drops it unless the relay-stamped `e.from` is an org owner or admin in this
   Mac's org roles. This check is what enforces who can send, since any board
   token can post to `*`, and it also drops anything from another org.
3. Drops it if `e.receivedAt` is over 24 hours old.
4. Posts to `tray.sock` the same way the board's other notifications do,
   with a new `announcement` category.

The existing ack means each announcement shows once.

## Known limits

These come with this approach, and need Matt's approval with this document:

- Delivery takes up to about 60 seconds, the board's tick.
- A Mac only gets announcements if its board is running and connected.
- A board on an older version acks and discards announcements, so members need
  the release first.
- With boards on two Macs under one token, the first to check gets it.
- The text is plain on the relay for up to 7 days, and if another org shares
  the relay, its boards fetch and drop it.
- The notification follows the member's notification and Focus settings.

## Calls I made

- `announcement` is a new notification category. It plays the tray's neutral
  sound, because a louder tier would need a tray change, and rt's notification
  settings cannot mute it, because the board posts straight to the tray.
- Title and message are capped at 80 and 500 characters.
- The notification body ends with "From <sender>", the same shape as the board's
  ask notifications.
- The sender does not receive their own announcement, which is how `to: '*'`
  already behaves.

## Verification

- Board tests for the new branch: accepted from an admin, dropped from a member,
  dropped when stale, malformed payload logged.
- CLI tests: non-admin refused, no token refused.
- A real send between two isolated HOMEs against a local relay
  (`RT_SWITCHBOARD_URL`).
- A look at the real macOS notification on the dev app.
