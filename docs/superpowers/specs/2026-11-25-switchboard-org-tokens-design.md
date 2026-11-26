# Switchboard: keep orgs apart, one token per org (RT-613)

## Why

One relay (`switchboard.mattstack.dev`) serves every mattstack install and
has no notion of an org. Its one admin token (`SWITCHBOARD_ADMIN_TOKEN`)
lists, mints, reissues and deletes every board, and `rt team admin-secrets`
(#829) shares that token with every owner and admin of the org. Any board
can list everyone on the relay, message anyone by username, and broadcast
to every board. A register call for a username that already exists
overwrites that board's token, so a second org that registers the same
username takes over the first org's board.

Sealed text stays unreadable, but who, when and which MR do not, and a
board that has been taken over can send asks as that person. Only one org
is on the relay today, so nothing has leaked yet. This must ship before a
second org joins.

MAT-379 ruled (2026-08-12) that per-team owner credentials replace the
global admin secret, and that the relay stays one hosted, multi-tenant door
(ruling 3). The phases that carried it were cancelled when the team
definition moved to the org repo.

## Goals

- The relay's operator keeps the master token. rt never puts it in an org's
  files, and no rt command or setup row offers to share it.
- Each org has its own token, minted by the operator. Owners and admins
  share that one through the org's admin-only file, as they share the master
  today.
- The relay records each board's org. An org's token works only on its own
  org's boards and invites.
- People lists, direct messages, broadcasts and support stay inside the
  sender's org.
- A username another org already holds is refused, and the first board keeps
  working.
- Today's org moves to its own token without cutting off any board. Older
  boards, daemons and rt keep working against the new relay.

## Non-goals

- The same username in two orgs. Usernames stay unique across the relay.
  Scoping them per org would first need the org in the seal binding and the
  support MAC; that is later work.
- Self-serve org creation. `rt team create` does not ask the relay for a
  token (side decision, below).
- Org-scoped team invites. `/v1/invites/*` is unauthenticated by design (the
  invite id is the secret, and the blob is sealed), so it has nothing to
  scope and stays as it is.
- Deleting an org, moving a board between orgs, or a grace window for a
  rotated org token.
- Changing the board app (`apps/board/src`). It reads the admin token through
  the daemon and keeps working with an org token unchanged.

## Anti-goals

- Any step that changes a board's own token. A board cut off mid-move is the
  failure this design must not produce.
- A relay change that breaks the released rt between the deploy and the
  operator's mint. The relay deploys the moment the PR merges (Railway watch
  paths `apps/board/switchboard/**` and `apps/board/src/peer/envelope.ts`),
  well before any rt release.
- Plaintext employer data on the relay. An org is an opaque random id with no
  name or label. The operator keeps their own note of which id is which org.
- An oracle across orgs. Another org's board answers exactly as a username
  nobody holds would (`unknown-recipient`, 404, a host that is not
  accepting). The one deliberate exception is the 409 on a username that is
  already taken, which the ticket asks for.

## Constraints

- The relay image copies only `apps/board/switchboard/*.ts` and
  `apps/board/src/peer/envelope.ts` (its `Dockerfile`), so the relay cannot
  import `packages/rt-client`. Shared constants are declared twice, and a
  test pins them equal.
- The relay deploys before the rt that uses it, so every relay change is
  additive for today's clients: same routes, same request bodies, same
  response shapes, with fields only ever added.
- The org's admin-only file keeps the key name `switchboardAdminToken`, with
  the org token in it, so every reader (invite, join, peer, members remove,
  team status, the daemon's `secrets:read` for the board) keeps working,
  older rt included.
- Change invite, join, peer, the board-token seams and the setup rows
  together (`.claude/rules/team-switchboard.md`).
- Never touch the live relay, a real token or the org repo. The steps that
  need the operator go in the PR description as steps for Matt.

## Approaches

There was one sensible way to build this, and Matt took it:

- **Chosen: orgs on the one relay.** Add an orgs table with token hashes, an
  org on every board and invite, and operator-only routes to mint and rotate.
  Org tokens are accepted on today's admin routes, limited to their own org.
  This is the ticket's smallest version, and existing clients keep their
  wire.
- **Ruled out: usernames keyed by org.** This would let the same username
  live in two orgs, but it needs the org in the seal binding and the support
  MAC first. The ticket defers it.
- **Ruled out: one relay per org.** This goes against MAT-379 ruling 3 (one
  hosted multi-tenant door), and it makes a new org deploy a relay.

## Decisions Matt made

1. **The operator mints a new org's token by hand** (side decision). The
   master token calls `POST /orgs` through a small operator script in
   `apps/board/switchboard/`. The operator gives the token to the org's
   owner, who stores it with `rt team admin-secrets --token-stdin`. Until
   then, `rt team create` says the org's boards wait for its switchboard
   token. Nothing new is open to the internet, and only orgs the operator
   lets in use the relay.
2. **The migration and rotation order** (each step is safe on its own, and
   no board token changes):
   1. Deploy the relay. Existing boards and invites land in one *legacy* org
      that has no token yet. The master token acts as that org on the old
      routes, so the rt released today is unaffected.
   2. The operator mints the legacy org's token.
   3. Every owner and admin clears the master from their Mac's local secret
      and their board's `.env`. The shared file still holds it, so nothing
      stops working, and on the new rt the `org.admin-secrets` row names each
      copy. The runbook lists the owners and admins to check. This comes
      before the share, so no older rt is left holding a local master it
      could write back over the org token (an older rt's "differs" advice
      is `--replace-token`).
   4. Matt runs the new rt's
      `rt team admin-secrets --token-stdin --replace-token` to put the org
      token in the org's admin-only file. The other admins get it on their
      next pull.
   5. The operator rotates the master on Railway last. That also kills the
      copy in the org repo's git history.
3. **Docs and the command tree:** the write fence widens to
   `.claude/rules/team-switchboard.md`, `apps/board/docs/peer-boards.md` and
   `lib/command-tree-def.ts` (the `team admin-secrets` node, plus any
   command-tree test that pins it).

## Design

### Relay data

A new `orgs.ts` beside `store.ts` (`OrgStore`):

```
orgs (
  id          TEXT PRIMARY KEY,     -- 32 lowercase hex, random
  token_hash  TEXT UNIQUE,          -- sha256 of the org token; NULL until minted
  legacy      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  token_at    INTEGER               -- when the current token was minted
)
```

`boards` and `invites` each gain an `org_id TEXT` column (`ALTER TABLE ...
ADD COLUMN`, when `PRAGMA table_info` does not list it). Every write sets
it. When the store opens and any board or invite has a NULL `org_id`, one
transaction finds the legacy org (`legacy = 1`), creating it with no token
if there is none, and moves every NULL row into it. The step runs at every
start and does nothing once the rows are filled. A fresh relay with no rows
makes no legacy org.

`boards.username` stays the primary key, so a username is unique across the
relay. Every other table (`asks_off`, `envelopes`, `support_messages`,
`support_hosts`) keeps keying on username alone, which stays sound because
each username belongs to exactly one org.

### Tokens

- **Org tokens** are `sbo_` followed by 64 lowercase hex characters. The
  relay stores only the sha256. `ORG_TOKEN_PREFIX` is declared in `orgs.ts`
  and in `packages/rt-client/src/switchboard.ts` (with `isOrgToken`), and an
  rt test imports both and asserts they are equal.
- **The master** stays `SWITCHBOARD_ADMIN_TOKEN` on Railway; renaming the
  variable would be a Railway change with no gain. The relay refuses to
  start when it starts with `sbo_`, so rt can tell the two apart offline. It
  is compared in constant time (the `/boards` checks use `!==` today).
- **Board tokens** do not change.

The relay resolves a bearer on an admin route to one of three scopes:
`operator` (the master), `org <id>` (a hash in `orgs.token_hash`), or
nothing (401). A board token on an admin route, or an org token on a board
route, is a 401.

### Routes

The admin routes keep their request and response shapes:

| Route | Operator (master) | Org token |
|---|---|---|
| `GET /boards` | Every board, each with an added `org` field | Its own org's boards, shaped as today |
| `POST /boards {username[, org]}` | Registers into `org`, or the legacy org when `org` is missing (400 when there is no legacy org, 404 for an unknown org) | Registers into its own org |
| `DELETE /boards/<u>` | Any board | Its own org's boards only. Another org's board is 404 |
| `POST /invites {username[, org]}` | As `POST /boards` | Its own org |

- **Register and reissue.** A register for a username in the same org
  reissues its token, as today; `rt team peer --rotate`, a re-join and a
  re-invite rely on that. When another org holds the username, through a
  board or an invite that is still open, the answer is
  `409 {"error":"username-taken"}`. Nothing is written, so the other org's
  board keeps its token.
- **Board invites.** `POST /invites` gets the same 409, so it can no longer
  replace another org's invite that is still open. `POST /invites/redeem`
  registers into the invite's org, and checks again inside its transaction
  as a backstop: 409 `that username already has a board in another org`,
  with nothing consumed.

New operator-only routes (master only; an org token or a board token gets
401):

| Route | Does |
|---|---|
| `GET /orgs` | `{orgs: [{id, legacy, hasToken, boards, createdAt, tokenAt}]}` |
| `POST /orgs` | Makes a new org: `201 {id, token}` |
| `POST /orgs/<id>/token` | Mints the org's token, or replaces it at once (the old one stops working): `200 {id, token}`. Unknown id: 404 |

The board-token routes keep their shapes, limited to the caller's org:

- `/peers`: `peers` and `askable` list only the caller's org.
- `/envelopes`: `to: "*"` reaches the caller's org minus the caller. A
  direct `to` naming a board in another org is `422 unknown-recipient`, the
  same as a username nobody holds. Only the actual recipients are woken:
  `publish` returns them, and the waker no longer uses `waiters.boards()`.
- `/support/messages` POST: a recipient in another org is
  `422 unknown-recipient`.
- `/support/host/<u>` GET: a host in another org reads
  `{accepting: false, lastSeenAt: null}`, as an unknown username does.
- `/inbox*`, `/inbox/ack`, `/support/wait`, `/support/ack`,
  `/boards/self/asks`: unchanged, since they act only on the caller's own
  rows.
- `/telemetry/*`, `/healthz`, `/invite/*`, `/v1/invites/*`: unchanged.

### Operator script

`apps/board/switchboard/operator.ts` is a Bun script for the operator that
only calls the routes above: `orgs` (list), `mint` (a new org), and
`token <id>` (mint or rotate). It reads `SWITCHBOARD_ADMIN_TOKEN` from the
environment and `SWITCHBOARD_URL` with the production default, and prints
the new token once to stdout, never to a file. It is not part of rt or the
app bundle.

### rt

- **`packages/rt-client/src/switchboard.ts`:** `ORG_TOKEN_PREFIX` and
  `isOrgToken`. Rebuild rt-client's `dist/` after touching it.
- **Picking the admin token** (`lib/team/board-peers.ts`, my call after the
  builder check): `pickAdminToken` takes the sources in their usual order
  (environment, the board's `.env`, the admin-only file, the local secret,
  then join's team secrets) and returns the first org token. Failing that, it
  returns a token that is not an org token only when it came from one of the
  org's own shared stores (the admin-only file, or join's member-wide team
  secrets): that is where #829 put the master, and only the legacy org
  holds it there. A master in the environment, a board's `.env` or the
  local secret is never used, because rt cannot tell which org it would act
  for. On the relay, a master with no `org` lands in the legacy org and
  lists or deletes any board, so a second org created on a Mac holding it
  would mix into the legacy org. `readAdminToken`, `readStoredAdminToken`,
  invite's read and join's `rejoinAdminToken` all use it. So the legacy org
  keeps working until step 5, and a master left on a Mac never shadows the
  org's token. "No org token" everywhere below means `pickAdminToken`
  returned null. A local read that throws still reaches the caller, and is
  skipped when an earlier source already gave an org token.
- **`username-taken`:** `rt team peer` and `rt team create`'s auto-peer
  throw a `UserActionableError` (code `username-taken`): another org on the
  switchboard already has a board under that username, so ask the relay
  operator. `rt team invite` treats it as a failure to embed peering, with
  its own wording, and refuses under `requirePeering`. `rt team join`'s
  re-register warns and returns the re-invite outcome.
- **`rt team admin-secrets`:**
  - `--token-stdin` reads the org token from stdin and trims it. A token that
    is not an org token is refused (`not-org-token`: the relay operator's
    own token is never shared). The token is then checked against the relay
    (`GET /boards` must answer 200, else `org-token-rejected`), so a typo
    never replaces a working token. It is then the token to share, and
    `--replace-token` still decides whether it replaces a different one.
  - Without `--token-stdin`, the verb reads this Mac's own sources as
    today (environment, the board's `.env`, the local secret), raw rather
    than through `pickAdminToken`, so it can see an operator token and say
    so. A token that is not an org token is never written: the outcome is a new `operator`, drawn as
    a `refused` line ("This Mac's switchboard token is the relay operator's,
    so rt did not share it"), with the next step "ask the relay operator for
    your org's token, then `rt team admin-secrets --token-stdin`". Locking
    the rule to the current owners and admins still runs.
  - `syncAdminSecrets` (`lib/team/admin-secrets.ts`) enforces the same rule,
    whoever calls it: `placeToken` never writes a token that is not an org
    token, and returns `operator`.
  - The callout after a removal says to ask the relay operator to change the
    org's switchboard token, then share the new one with `--token-stdin
    --replace-token`.
- **`org.admin-secrets` row** (`lib/setup/validators/admin-secrets.ts`).
  Tokens found on this Mac (environment, the board's `.env`, rt's secret) are
  split into org tokens and operator tokens. The new verdicts sit after the
  lock check:
  1. The shared file holds a token that is not an org token. needs-you: "The
     org shares the relay operator's token, not its own." Steps: ask the
     relay operator for the org's switchboard token, run
     `rt team admin-secrets --token-stdin --replace-token`, then re-check.
  2. This Mac keeps an operator token. needs-you: "This Mac keeps the relay
     operator's switchboard token in <where>." Steps: remove it from
     <where> (the operator keeps it outside rt), then re-check. One step is
     listed for each place that holds it.
  3. The existing "not shared yet" verdict and the "differs" verdict count
     only org tokens.

  When the admins rule does not exist yet and this Mac holds only an
  operator token, the row shows verdict 2, never "share it". The row stays
  hidden from anyone who is not an owner or admin.
- **`rt team create`:** when there is no org token, the auto-peer prints a
  `pending` line: the org's boards connect once the relay operator gives it
  a switchboard token. Next: `rt team admin-secrets --token-stdin`, then
  `rt team peer`. Today this step is silent.
- **Copy:** user-facing words say "the org's switchboard token" and "the
  relay operator's token", never "admin token". `--json` keys stay frozen.
  The `team admin-secrets` node in `lib/command-tree-def.ts` gets a
  `--token-stdin` flag row, and its description becomes "Share your org's
  switchboard token with its owners and admins, and keep it locked to
  them".

### Docs

- `apps/board/docs/peer-boards.md`: the operator setup covers org tokens,
  the legacy org, `operator.ts` and the start-up prefix check. "Inviting
  teammates" names the org token. A Privacy note says the relay records an
  opaque org id per board and nothing else about the org.
- `.claude/rules/team-switchboard.md`: the admin-only file holds the org's
  token. Readers pick an org token first. `admin-secrets` and the row never
  share a token that is not an org token. Note `--token-stdin` and
  `username-taken`.
- `docs/switchboard-org-tokens.md`: the operator runbook for the five-step
  move and for later rotations. The PR description repeats the move as steps
  for Matt.

## Verification

Each acceptance bullet in RT-613 is proved by a test:

- **An org token cannot reach another org's board.** In the relay's suite,
  an org token cannot list, register (connect), reissue, delete or invite a
  board in another org (`server.test.ts`, `store.test.ts`,
  `invite-server.test.ts`).
- **A board reaches only its own org, support host included.** Covered for
  `/peers`, `/envelopes` direct and broadcast, `/support/messages` and
  `/support/host` (`server.test.ts`, `support.test.ts`).
- **A username another org holds is refused, and the first board keeps
  working.** A 409 from register, invite and redeem, after which the first
  board's token still authenticates and its inbox is intact.
- **No rt command or setup row offers the master token.**
  `admin-secrets.test.ts`, `team.test.ts` and
  `validators-admin-secrets.test.ts` cover the verb, `syncAdminSecrets` and
  the row.
- **The move cuts off no board.** A database made with today's schema
  opens in the new store. Every board token still authenticates, peers
  still see each other, and the master registers into the legacy org.
  Minting the legacy org's token, then rotating it, leaves every board
  token working (`migration.test.ts`).
- **Older clients still work.** Today's request bodies get today's
  response shapes on every route (`server.test.ts`).
- **rt picks the org token first, and uses a master only from the org's
  shared stores.** Covered in `board-peers.test.ts`, `invite.test.ts`,
  `join.test.ts` and `peer.test.ts`: a master in the environment, a board's
  `.env` or the local secret is never sent. Plus the prefix-parity test.
- Each touched suite passes when run on its own from the worktree root, and
  `bun run typecheck` is clean.

## Calls I made (check these)

- The org token format is `sbo_` plus 64 hex characters, and the relay
  refuses to start with a master that has the prefix.
- An org has an opaque id and no name or label on the relay.
- The master keeps its `SWITCHBOARD_ADMIN_TOKEN` name on Railway.
- Rotating an org token is immediate, with no grace window. It cuts off
  only admin actions, never boards.
- rt uses a master only when it comes from the org's own shared stores.
- `--token-stdin` checks the token against the relay before it writes, so a
  typo never replaces a working token.
- A board in another org answers exactly as a username nobody holds would.
  The only exception is the 409 on a username that is taken.

## Left to the builder

- Error message wording within the copy rules (`rt:ui-copy`, output layer),
  and how `operator.ts` lays out its output.
- How `OrgStore` and `SwitchboardStore` divide the work, and whether the
  migration lives in the constructor or in a function called from it.
- Test file names beyond those listed.
