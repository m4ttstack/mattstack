# Org announcements

## Intent

Org owners and admins need a way to interrupt everyone in the org when
something needs action now: "update rt today", "CI is down". Today every rt
notification is local: the daemon on a Mac raises it for that same Mac, so
nothing can reach a teammate. Announcements add a way to reach every member
in seconds, and to see who has confirmed reading it.

## Goals

- An org owner or admin sends one message to every member of the org.
- A member's Mac shows a native banner within seconds, whether or not they run
  a board.
- A Mac that was asleep or offline shows the banner when it comes back, while
  the announcement is still current.
- The banner has a "Got it" button.
- The sender can see, per member: confirmed, reached but not confirmed, or not
  reached.

## Non-goals

- Targeting one team or a chosen group.
- Sending from the console. An `rt` command comes first.
- Scheduling, replies, threads, or a member-facing history page.
- Phones, email or Slack fallback.
- Apple Push Notification service. The app has no push entitlement, and the
  daemon is already running whenever a Mac is awake.
- End-to-end encryption of announcement text.

## Anti-goals

This fails even if it technically works when:

- a person outside the org receives an announcement;
- someone who is not an owner or admin can reach the whole org;
- a member sees the same announcement again after a restart;
- an announcement reaches an agent, as chat, as a pane message or as context.
  Announcements are for people;
- a board silently consumes an announcement.

## Constraints

- **The relay has no concept of an org.** `apps/board/switchboard/store.ts`
  keeps one flat `boards` table, and `to: '*'` reaches every board on it.
- **Any board token can send `to: '*'`,** so the existing `/envelopes` route
  cannot enforce who sends.
- **Boards ack their whole inbox,** including types they do not know
  (`apps/board/src/peer/inbox.ts`). Announcements must stay out of `/inbox`.
- **The relay's long-poll waiters are in-process** and cap at 25 seconds
  (`waiters.ts`). The relay runs as a single replica, so this holds.
- **A relay change deploys on merge to main** when it touches
  `apps/board/switchboard/**`, and it must be live before the release that
  depends on it.
- **The TypeScript CLI is UI-free.** Any prompt renders through the Go `rt-ui`
  helper (`.claude/rules/output-layer.md`).
- **A built binary or app only ever runs under an isolated HOME,** and blessed
  app bundles are never rebuilt (`AGENTS.md`).
- **`SCHEMA_VERSION` is claimed across sessions** if a state.db change is
  needed (`.claude/rules/state.md`).

## Approaches

**1. New announcements channel on the relay (picked by Matt).** Separate relay
routes and tables, admin token to send, and the daemon listens on every Mac.
It is the fastest and reaches everyone. It is the most new relay code, and
the relay holds announcement text unencrypted while it is current.

**2. Reuse board messages.** Send with `to: '*'` and have each board pass the
message to its Mac. It is the smallest build, but Macs without a running board
miss it, any board token can send, and older boards ack and discard it.

**3. Org repo holds the text, relay sends a wake-up.** The relay never sees the
text and there is a permanent history, but each banner waits on a git pull, and
"Got it" still needs relay routes because members cannot push to main.

Matt picked 1 for speed and reach.

## Decided by Matt

- Purpose: act-now heads-ups, which must arrive fast and reach everyone.
- Audience: the whole org.
- Senders: org owners and admins only.
- Receipts: the sender sees who confirmed, through a "Got it" button.
- Approach: a new relay channel.

Proposed by me, shown to Matt with no objection:

- The rt daemon listens, not the board.
- The relay holds an announcement for a Mac that is away, and anything older
  than a day is dropped.
- The banner uses the existing tray notification path.
- Sending is an `rt` command first.

## Design

### Relay

New tables, separate from `envelopes`:

- `announcements`: id, sender handle, title, body, optional url, sent time,
  expiry time.
- `announcement_recipients`: announcement id, username, reached time, confirmed
  time.

New routes:

| Route | Auth | Does |
|---|---|---|
| `POST /announcements` | admin token | Stores it for the named recipients, wakes their waiters, returns names with no registered board |
| `GET /announcements/mine` | board token | Current announcements this user has not confirmed |
| `GET /announcements/wait` | board token | Long-poll, same shape as `/inbox/wait`, with its own waiter pool |
| `POST /announcements/:id/reached` | board token | Records the Mac received it |
| `POST /announcements/:id/confirm` | board token | Records "Got it" |
| `GET /announcements` | admin token | Recent sends with per-recipient state |

The relay trusts the recipient list from the admin-token holder, and that list
is what keeps an announcement inside the org. A recipient's token must match
the row for any read or write.

Expiry is 24 hours. At expiry the relay clears title and body and keeps the
receipts for 7 days, matching `ENVELOPE_TTL_MS`, then prunes them.

### Sending

`rt team announce` (exact verb shape is the builder's call, under `team` in the
command tree):

1. Refuses unless this Mac's role in the org is owner or admin, checked with
   the same role seam as `lib/team/roles.ts`, and refuses if the admin token is
   unreadable (`readAdminToken`).
2. Pulls the org clone so the roster is current, then reads recipients from the
   roster, canonicalized with `canonicalHandle`. The sender is left out.
3. Shows the text and recipient count, and asks for confirmation through
   `rt-ui`.
4. Sends, then lists anyone with no registered board as unreachable.

A status verb shows each member as confirmed, reached, or not reached.

Sending is deliberately not added to `rt_verb` or the MCP tool roster.

### Receiving

A new long-running daemon loop, not a sweep:

1. Reads the token through `readBoardSwitchboardToken`. No token means the loop
   stays idle and re-checks on a slow interval.
2. Long-polls `/announcements/wait`, then fetches `/announcements/mine`.
3. Skips ids already shown on this Mac, using a daemon-owned record that
   survives restarts. Queues the rest with `enqueueNotification`, category
   `announcement`, then posts `reached`.
4. Backs off on network failure. A 401 is logged once and the loop backs off
   rather than retrying fast.

Text from the relay is treated as untrusted: length-capped, and `url` is kept
only if it is http or https.

### Banner

The tray gets a new `UNNotificationCategory` for `announcement` with one "Got
it" action. `NotificationEvent` gains an `announcementId` field carried through
`userInfo`. The action follows the `ADD_MEMBER` pattern: the tray runs the
bundled `rt` to post the confirm. Clicking the banner body opens `url` when
there is one and does not count as confirming.

## Calls I made

- The sender is left out of the recipients.
- A person with two Macs sees the banner on both, and one "Got it" confirms for
  that person. The other Mac's banner stays until dismissed.
- "Reached" means the daemon received it and queued the banner. It does not
  prove the banner was seen, which is what "Got it" is for.
- Title is capped at 80 characters and body at 500, enforced by the relay and
  the CLI.
- Members with old rt stay "not reached" until they update; nothing is done for
  them specially.
- When there is no tray, the existing `osascript` fallback has no button, so
  a confirm verb must also work from the command line.
- The sender handle shown on the banner is the sender's recorded forge username.
  The admin token does not name a person, so this is trusted from the sender's
  rt.

## Left to the builder

- Exact verb names and output, following the output rules and the rt:ui-copy
  skill.
- Where the "already shown" record lives, and whether it needs a schema bump.
- The relay's response shapes and status codes.
- Banner sound choice through `NotificationManager.playSound(for:)`.
- Whether removing a member also deletes their recipient rows.
- Docs through the rt:docs skill, and `apps/board/docs/api.md`.

## Verification

- Unit tests for the relay routes: admin-only send, a user reading only their
  own rows, expiry clearing text, and `/inbox` never returning an announcement.
- Daemon loop tests: dedupe across restarts, backoff, no token, bad url dropped.
- A real run between two Macs or two isolated HOMEs against a local relay
  (`RT_SWITCHBOARD_URL`).
- The banner and "Got it" checked by eye on the dev app, built through the
  rt:build-dev-app skill.
- Rollout order: merge and confirm the relay is live, then release rt.
