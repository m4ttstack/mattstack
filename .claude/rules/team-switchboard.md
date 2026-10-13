---
paths:
  - "lib/team/**"
  - "packages/rt-client/src/switchboard.ts"
  - "lib/setup/validators/accounts.ts"
  - "commands/team.ts"
---

# Switchboard and team join

## Switchboard and `rt team join`

Join refuses an invite whose `username` is not the signed-in forge login,
checks that the cloned roster lists that username, records `forgeUsername`
on this Mac, and sets `mattstack.activeTeam` to the invite's first team.
`rt team invite` pushes the roster entry before it makes the invite.

The switchboard URL is a built-in constant, `SWITCHBOARD_URL` in
`packages/rt-client/src/switchboard.ts`, read only through `switchboardUrl()`.
No setting holds it and no setup row asks for it; the hidden
`RT_SWITCHBOARD_URL` override (https, or http to loopback, never written or
shown) exists for local relay work and tests. A board token is only ever sent
to `switchboardUrl()`. `rt team invite` mints the invitee's board token there
when this Mac holds the switchboard admin token and seals only the token into
the invite; `rt team join` stores it under the rt secrets scope, writes no URL
setting, and refuses a pointer from an older rt whose URL is not
`switchboardUrl()`. `rt team peer` connects the own board of a Mac holding
the switchboard admin token, in practice the org admin's (`lib/team/peer.ts`): with the admin token readable it registers the
board under the username this Mac recorded for the org, the handle join
registers (else `board.defaultMember`, else the org forge's login), stores the
token in that same `switchboardToken` secret, and leaves a board whose token
already works alone; `rt team create` runs it and degrades to a warning. `rt team members remove` deletes the member's
board registration and `rt team status --json` reports `peered` per member.
The board's own roster only shows a read-only peered badge; it no longer
invites, removes or joins.
The `account.board-peering` row applies on a Mac in a team (created or
joined) that runs a board (the team's `board.projects` tracks projects). It never shows on a Just Me Mac,
nor on a creator's Mac that lacks the switchboard admin token (in rt's
secrets, the environment or the board's `.env`) and joined no other team,
since nothing there can peer it. It reads `needs-you` when neither the
board's `.env` nor rt's `switchboardToken` holds a token (with the
re-invite remedy, or, on any Mac holding the admin token, the
`rt team peer` steps, which `verify`'s note names too), `error` with a re-check when
`<url>/healthz` (no auth header; `/health` is not a route) does not answer
200, `ready` otherwise. It is never required or finish-gated (only the org admin
can fix it), but `verify` reports it, so `rt setup update` notifies. The
stored copies older rt wrote (`board.switchboardUrl`,
`rt.integrations.switchboardUrl`, the board's `config.json` `switchboard.url`)
are retired keys deleted by the `2026-10-02-retire-switchboard-url`
migration, and `lib/__tests__/no-switchboard-url-setting.test.ts` fails any
code that names one. Change invite, join, peer and the row together or not
at all; `lib/team/invite.ts`, `lib/team/join.ts`, `lib/team/peer.ts`,
`lib/team/board-token.ts` and `lib/setup/validators/accounts.ts` are the
seams, and RT-260 is the incident
that made this a rule.
