# Switchboard org tokens: operator runbook

Each org on the switchboard relay has its own switchboard token (`sbo_` and 64
hex characters). The relay's master token (`SWITCHBOARD_ADMIN_TOKEN` on
Railway) belongs only to the relay operator. This runbook moves today's boards
onto an org token, then covers minting and rotating tokens later.

The master has operator reach: it lists every org's boards, deletes any board,
registers into any org and replaces any org's token. Until step 5 below, every
owner and admin of the legacy org holds it. So the relay refuses to mint a new
org (`409 rotate-master-first`) until the master is rotated.

## The move, steps 0 to 6

No board token changes at any step. Do them in order, and run step 6 right
after step 5.

0. **Check access first.** Before the new rt release reaches the legacy org's
   owners and admins (it stops using a master kept on the Mac as soon as it
   lands), each of them checks while their Mac still holds its own copy:
   - The `org.admin-secrets` row must not read `skipped`. On the old rt and the
     new one alike, `skipped` means this Mac's age key is not the one the
     roster holds.
   - `rt team admin-secrets` must name nobody who "cannot open them yet" (in
     `rt team admin-secrets --json`, nobody under `withoutKey`).

   Fix any Mac that fails before going on.
1. **Merge the relay change.** The relay deploys itself when the PR merges to
   `main` (Railway's watch paths, see
   [Operator setup](../apps/board/docs/peer-boards.md#operator-setup-run-a-switchboard)).
   Existing boards and invites land in one legacy org that has no token yet.
   The master acts as that org on the old routes, so the rt released today is
   unaffected.
2. **The operator mints the legacy org's token.** `mint` is not the command
   here (it makes a new org, and is refused before step 5). Run
   `bun apps/board/switchboard/operator.ts orgs`, take the id on the row
   marked `legacy`, then run
   `bun apps/board/switchboard/operator.ts token <that id>`. The token it
   prints goes to Matt, who runs step 4.
3. **Every owner and admin clears the master from their Mac.** This comes
   before the share, so no older rt is left holding a master it could write
   back over the org token. Clear each of:
   - The environment rt runs in.
   - The local secret. rt has no verb that deletes a secret, so edit the
     personal store by hand. The age key lives only in the keychain, and sops
     reads it from `SOPS_AGE_KEY`. Run this from `~/.mattstack/user` (sops
     matches `.sops.yaml` relative to that folder), delete the
     `switchboardAdminToken` line in the editor, then save and quit. When it
     was the last key, also delete the comma at the end of the line before
     it, or sops refuses the save and reopens the editor:

     ```sh
     cd ~/.mattstack/user
     SOPS_AGE_KEY="$(security find-generic-password -a mattstack -s mattstack-age-key -w)" sops secrets/rt.json
     ```

     The keychain may ask you to allow the read. If the file has no
     `switchboardAdminToken` key, there is nothing to remove.
   - The board's `.env`, then restart the board (it reads `.env` only at
     start).

   An org admin also removes `switchboardAdminToken` from the legacy org's
   member-wide team secrets, where an older join kept it and every member can
   read it. rt has no verb for one key there, so edit by hand in the org
   clone. Run this from the clone (sops matches its `.sops.yaml` relative to
   that folder), with your org's folder name in place of `<org>`:

   ```sh
   cd ~/.mattstack/orgs/<org>
   SOPS_AGE_KEY="$(security find-generic-password -a mattstack -s mattstack-age-key -w)" sops mattstack/org/secrets/rt.json
   ```

   Delete the `switchboardAdminToken` line, and the comma before it when it
   was the last key, then save and quit. Commit the file unless rt's daemon
   already has (`git status` shows it clean), then push it:

   ```sh
   git commit -m "Remove the relay operator's token from the member secrets" mattstack/org/secrets/rt.json
   rt team publish --team <org>
   ```

   The shared admin-only file still holds the master, so nothing stops working
   meanwhile. On the new rt the `org.admin-secrets` row names each copy.
4. **Matt puts the org token in the admin-only file.** He copies the org
   token, then runs
   `pbpaste | rt team admin-secrets --token-stdin --replace-token` (typed in
   by hand instead, the token ends with Ctrl-D). The other admins get it on
   their next pull, then restart their boards (a board keeps the token it read
   at start), so no board still uses the master when step 5 rotates it.
5. **The operator rotates the master on Railway.** Set
   `SWITCHBOARD_ADMIN_TOKEN` to at least 32 random characters
   (`openssl rand -hex 32`). This also kills the copy in the org repo's git
   history and lifts the second-org gate. From here no board keeps the master,
   the operator's own included, and rt keeps it on no Mac. The operator then
   sets their own `SWITCHBOARD_OPERATOR_TOKEN` (kept outside rt) to the new
   master, or every `operator.ts` call gets a 401. The rules for the master's value are in
   [Operator setup](../apps/board/docs/peer-boards.md#operator-setup-run-a-switchboard).
   Never set the old master back after this step: the relay revokes the
   legacy org's token only once, and it refuses to mint any org token under
   the old master again (`409 rotate-master-first`).
6. **The operator mints the legacy org's token again, right after step 5.**
   Anyone who held the old master could mint a legacy org token between steps
   2 and 5, so on its first start with the new master the relay revokes the
   legacy org's token, and every token minted under the old master is dead. It
   logs a line saying so. Until this step is done, admin actions and the
   boards' peered badge fail. Board tokens and board-to-board traffic are not
   affected. With `SWITCHBOARD_OPERATOR_TOKEN` set to the new master, run
   `bun apps/board/switchboard/operator.ts token <legacy id>`, the same id as
   in step 2. Matt shares the token with
   `pbpaste | rt team admin-secrets --token-stdin --replace-token`. The other
   admins pull, then restart their boards. If `operator.ts` prints
   `the relay answered 503: relay-not-ready`, the relay logged that the revoke
   failed: restart the relay, then run this step. The revoke also dropped the
   legacy org's open invites, so admins send again any they still need
   (`rt team invite --handle <username>`).

   Then the operator checks the legacy org's boards. Anyone who read the old
   master could register an extra board before step 5, and its board token
   still works after it. Compare the `boards=` count on the `legacy` row of

   ```sh
   bun apps/board/switchboard/operator.ts orgs
   ```

   and the boards whose `org` is the legacy id in

   ```sh
   curl -sS -H "Authorization: Bearer $SWITCHBOARD_OPERATOR_TOKEN" \
     "${SWITCHBOARD_URL:-https://switchboard.mattstack.dev}/boards"
   ```

   against the org's roster. Delete each board nobody recognises, by its
   `username` from that list. This revokes its token and drops what waits in
   its inbox, and the relay answers `{"ok":true}`:

   ```sh
   curl -sS -X DELETE -H "Authorization: Bearer $SWITCHBOARD_OPERATOR_TOKEN" \
     "${SWITCHBOARD_URL:-https://switchboard.mattstack.dev}/boards/<username>"
   ```

   The roster check cannot see one more case. Anyone with the old master could
   also have reissued a roster member's board token through `POST /boards`,
   which leaves the member's real board with a token the relay rejects. So
   every legacy member confirms their board still connects. After the restart
   above, wait a minute, then run on their Mac

   ```sh
   curl -s http://localhost:11006/data.json | grep -o '"peers":\[[^]]*\]'
   ```

   It prints `"peers":[...]` (usernames in the org, maybe `[]`) only once
   the relay has accepted the board's own token since the board started: the
   board fills that field from a 200 to its token on `/peers` and leaves it out
   otherwise. Do not go by `peering`: it reads `ok` until three polls in a row
   are refused, and a restart starts that count over. The board polls once
   when it gets its token, then every 60 seconds. If nothing prints two minutes
   after the restart, the relay is not taking the board's token.

   A board that stopped working between step 1 and step 6 gets a fresh token,
   which kills the token someone else holds. On a Mac that holds the org's
   switchboard token, its owner runs `rt team peer --rotate`. Any other
   member gets a re-invite: an admin runs `rt team invite --handle <username>`,
   then the member runs `rt team join`.

Rolling the relay back is safe for boards until a second org exists: board
tokens work on the old image, but org tokens get a 401 there until it rolls
forward again. Once a second org exists, there is no rollback. The old image
ignores orgs entirely: every board can list and reach every other org's
boards, and org tokens stop working. Rolling forward again cannot tell the
rows written meanwhile apart, so they keep no org and fail closed.

## The operator script

Run it from a checkout:

```sh
bun apps/board/switchboard/operator.ts <orgs | mint | token <org id>>
```

- It reads the master from `SWITCHBOARD_OPERATOR_TOKEN`, never from
  `SWITCHBOARD_ADMIN_TOKEN`.
- It reads the relay URL from `SWITCHBOARD_URL`, default
  `https://switchboard.mattstack.dev` (https, or http to a loopback host only:
  `localhost`, `127.0.0.1` or `[::1]`).
- `orgs` lists the orgs.
- `mint` creates a new org and prints its token once on stdout. Before step 5
  the relay refuses it. Give the token to the org's owner, who runs
  `pbpaste | rt team admin-secrets --token-stdin` to share it with the org's
  admins.
- `token <org id>` mints or rotates that org's token.

## Rotating an org token

Run `token <org id>`. Rotating leaves the org's boards untouched. Give the new
token to an owner or admin, who copies it and runs
`pbpaste | rt team admin-secrets --token-stdin --replace-token`. The other admins pull and
restart their boards.
