# Peer boards and the switchboard

When your teammates each run their own board, a small relay called the
switchboard lets those boards ask each other for reviews and re-reviews
without either board talking to the other directly. It is entirely optional: skip it and the
board works exactly as it does without it.

What it adds:

- **Live peer badges.** When a peer's board reports a review going into or out
  of flight on one of your MRs, your row picks up the badge.
- **Request re-review.** A row action on your own MR ("request re-review from
  `<reviewer>`") asks that reviewer's board directly.
- **Request review.** "request review from…" on your own MR picks any roster
  member not already engaged with it and asks their board for a first look.
  A peer board running a version without this ask drops it silently; the chip
  self-expires to "no-response" after 48 hours.
- **Request response.** The reverse direction: once your review of a
  teammate's MR finishes with comments, "ask `<author>`'s agent to respond"
  asks the author's board to answer the feedback. Their board reports the
  respond lifecycle back so your chip confirms and clears.
- **The ask band.** Whatever you asked a teammate's agent for shows as a band
  at the foot of the row, outside the status line and its "+N active" count:
  requested, running, done (with the verdict), failed, declined or no answer.
  Clicking it opens the trail with times. A finished ask stays for 24 hours.
  **Dismiss** (done, failed, declined, no answer) drops it from the row;
  **Retry** (failed, declined, no answer) scraps the recorded ask and sends the
  same kind of ask to the same teammate again.
- **Enrollment-aware pickers.** The relay tells each peered board who is
  enrolled (usernames only, refreshed on the board's peer tick), and the ask
  actions offer only those teammates. Against an older relay without the
  listing, the pickers fall back to the whole roster and an ask to an
  unenrolled member surfaces the relay's refusal as before.
- **Author-driven re-review.** Independent of the switchboard: the MR author can
  ask by resolving the latch thread on the MR itself, with no peer board
  involved. See [agent actions](agent-actions.md#reviewer-side-automation).
- **Guarded auto re-review.** The reviewer side can run `bun run triage` on a
  cron so an incoming nudge is picked up and re-dispatched automatically. See
  [agent actions](agent-actions.md#reviewer-side-automation) for the
  guardrails.

## Teammate setup

Peer features need `defaultMember` set to your own GitLab username. That is how
the board tells your MRs from everyone else's, so with `"all"` it stays silent
and publishes nothing to peers.

`bun run setup` prompts once for a board invite. Paste the whole link your
operator gave you (`.../invite/<code>`) and setup redeems it, writing the
token it gets back to `.env` as `SWITCHBOARD_TOKEN`. Blank input keeps
whatever is already configured. The board only accepts an invite from
mattstack's own switchboard; an invite link on any other host is refused.

Everything degrades cleanly when peer features are not set up: no badges, no
nudge action, and `POST /nudge` returns `400`.

On a Mac in an rt team, `rt team join` with the invite your team owner sent
stores the board's switchboard token for you. If the switchboard ever stops
accepting this board's token, because the owner removed or re-minted it for
instance, ask the owner for a fresh invite (`rt team invite`) and run
`rt team join` with it.

## Operator setup: run a switchboard

The switchboard is a separate deployable in `switchboard/`: a store-and-forward
relay, one process, one SQLite file. To deploy it to
[Railway](https://railway.app):

- **Service root**: the apps repo root, not `apps/board/switchboard/`. The
  relay imports shared types from the board's `src/peer/`, so a service rooted
  at the switchboard folder cannot resolve them.
- **Builder**: Dockerfile, path `apps/board/switchboard/Dockerfile` (the
  `RAILWAY_DOCKERFILE_PATH` variable). It copies only the relay's files and
  runs no `bun install`, because the board's `package.json` has workspace
  dependencies that only resolve in the workspace.
- **Watch paths**: `apps/board/switchboard/**` and
  `apps/board/src/peer/envelope.ts`, so pushes elsewhere in the workspace do
  not trigger a redeploy of the relay.
- **Volume**: attach one and point `SWITCHBOARD_DB` at a path on it. Otherwise
  the database lives on ephemeral disk and every redeploy loses all board
  registrations.
- **Env**: `SWITCHBOARD_ADMIN_TOKEN`, a value you pick, is the bearer token for
  minting boards. `PORT` is supplied by Railway.

### Push

Asks reach a board in seconds rather than on its 60s poll. The rt daemon on
each Mac holds a long-poll on the relay
(`GET /inbox/wait?since=<cursor>&timeout=25`), which returns the moment mail
lands for that board without consuming it. The daemon then broadcasts
`peer-inbox`: the board pulls its inbox on that event, and rt's `board-peer`
cron trigger runs `board triage --peer` to start the agent. The board's own
60s poll stays as the fallback, so a daemon or relay that is down only costs
speed.

Deploy the relay before shipping a release that carries the waker; the relay
change is additive and older boards keep polling.

## Inviting teammates

Inviting and removing teammates is the CLI's job, run on the Mac that holds
the switchboard admin token (`rt secrets set rt switchboardAdminToken`):

- `rt team invite --handle <username>` mints the teammate's board token and
  seals it into their team invite, so `rt team join` peers their board.
- `rt team members remove <username>` takes them off the team and deletes
  their board's registration on the switchboard. Their token stops working
  immediately, pending envelopes for them are dropped, and the handle leaves
  every board's enrolled list on its next refresh. Run on a Mac without the
  admin token, it does everything else and says their board is still
  connected: only the switchboard owner can disconnect it. Scripted, it is
  `DELETE $URL/boards/<username>` with the admin bearer.
- `rt team status --json` carries a `peered` flag per member: true or false
  when the switchboard answered, null when nothing on this Mac can ask it.

The board's settings ("team members") shows the same thing read-only: with
the admin token in place, a teammate whose board is connected gets a
**peered** badge beside their name.

The invite code travels in the URL path, so it shows up in the relay host's
access logs (the platform's edge logs) even though the relay itself never logs
it. Treat invite links as short-lived secrets: hand them over the way you would
a password, and if one may have leaked, re-invite that handle. The relay keeps
one outstanding invite per handle, so minting a fresh one replaces the old code
and the leaked link stops working.

## Scripted operator setup

The relay endpoints stay plain HTTP with the admin bearer token, for scripting
or a headless operator setup:

```sh
# Mint a board directly. username = their GitLab username, lowercased; one board
# per username; re-minting rotates the token, so hand out the new one if you do.
curl -X POST $URL/boards \
  -H "Authorization: Bearer $SWITCHBOARD_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"username":"grace"}'

# Or mint a one-time invite link.
curl -X POST $URL/invites \
  -H "Authorization: Bearer $SWITCHBOARD_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"username":"grace"}'
# -> {"code":"...","username":"grace","expiresAt":...}; hand out "$URL/invite/<code>"
```

The invite link works in `bun run setup`'s prompt. A raw `POST /boards` token is for headless operator setups
only: put it in `.env` as `SWITCHBOARD_TOKEN` yourself.

## Privacy

The switchboard stores envelopes it never inspects. Payloads carry MR URLs,
iids, statuses, usernames, and timestamps only, never titles, diff content, or
credentials. Board endpoints, `/nudge` included, stay local-only whether or not
peer features are configured.
