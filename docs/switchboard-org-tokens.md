# Switchboard org tokens: operator runbook

Each org on the switchboard relay has its own switchboard token (`sbo_` and 64
hex characters). The relay's master token (`SWITCHBOARD_ADMIN_TOKEN` on
Railway) belongs only to the relay operator. This runbook moves today's boards
onto an org token, then covers minting and rotating tokens later.

The master has operator reach: it lists every org's boards, deletes any board,
registers into any org and replaces any org's token. Until step 5 below, every
owner and admin of the legacy org holds it. So the relay refuses to mint a new
org (`409 rotate-master-first`) until the master is rotated.

## The move, steps 0 to 5

Each step is safe on its own, and no board token changes. Do them in order.

0. **Check access first.** Before the new rt release reaches the legacy org's
   owners and admins (it stops using a master kept on the Mac as soon as it
   lands), each of them checks while their Mac still holds its own copy:
   - The `org.admin-secrets` row must not read `skipped`. On the old rt and the
     new one alike, `skipped` means this Mac's age key is not the one the
     roster holds.
   - `rt team admin-secrets` must report nobody under `withoutKey`.

   Fix any Mac that fails before going on.
1. **Deploy the relay.** Existing boards and invites land in one legacy org
   that has no token yet. The master acts as that org on the old routes, so
   the rt released today is unaffected.
2. **The operator mints the legacy org's token.**
3. **Every owner and admin clears the master from their Mac.** This comes
   before the share, so no older rt is left holding a master it could write
   back over the org token. Clear each of:
   - The environment rt runs in.
   - The local secret.
   - The board's `.env`, then restart the board (it reads `.env` only at
     start).

   An org admin also removes `switchboardAdminToken` from the legacy org's
   member-wide team secrets, where an older join kept it and every member can
   read it. rt has no verb for one key there, so edit by hand in the org clone:
   run `sops mattstack/org/secrets/rt.json`, delete the key, then commit and
   publish.

   The shared admin-only file still holds the master, so nothing stops working
   meanwhile. On the new rt the `org.admin-secrets` row names each copy.
4. **Put the org token in the admin-only file.** Run
   `rt team admin-secrets --token-stdin --replace-token` and paste the org
   token. The other admins get it on their next pull, then restart their
   boards (a board keeps the token it read at start), so their peered badge
   does not fail after step 5.
5. **The operator rotates the master on Railway, last.** Set
   `SWITCHBOARD_ADMIN_TOKEN` to at least 32 random characters
   (`openssl rand -hex 32`). This also kills the copy in the org repo's git
   history and lifts the second-org gate. From here no Mac and no board keeps
   the master, the operator's included.

The relay refuses to start when `SWITCHBOARD_ADMIN_TOKEN` starts with `sbo_`,
and warns when it is under 32 characters.

There is no rollback once a second org exists.

## The operator script

Run it from a checkout:

```sh
bun apps/board/switchboard/operator.ts <orgs | mint | token <org id>>
```

- It reads the master from `SWITCHBOARD_OPERATOR_TOKEN`, never from
  `SWITCHBOARD_ADMIN_TOKEN`.
- It reads the relay URL from `SWITCHBOARD_URL`, default
  `https://switchboard.mattstack.dev` (https, or http to localhost only).
- `orgs` lists the orgs.
- `mint` creates a new org and prints its token once on stdout. Before step 5
  the relay refuses it. Give the token to the org's owner, who runs
  `rt team admin-secrets --token-stdin` to share it with the org's admins.
- `token <org id>` mints or rotates that org's token.

## Rotating an org token

Run `token <org id>`. Rotating leaves the org's boards untouched. Give the new
token to an owner or admin, who runs
`rt team admin-secrets --token-stdin --replace-token`. The other admins pull and
restart their boards.
