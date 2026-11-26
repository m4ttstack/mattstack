# Switchboard org tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each org on the switchboard its own token, record each board's org, keep every board-to-board route inside the sender's org, and move today's org off the shared master token without cutting off a board.

**Architecture:** The relay gains an `orgs` table (`apps/board/switchboard/orgs.ts`) and an `org_id` on boards and invites. Its admin routes resolve the bearer to the operator (the master) or one org, and every board route filters by the caller's org. rt keeps the key `switchboardAdminToken`, now holding the org token. It picks a token by where it came from (`pickAdminToken`), and never shares or sends a master kept on the Mac.

**Tech Stack:** Bun, `bun:sqlite`, `bun:test`, TypeScript. The relay imports only `switchboard/*.ts` and `src/peer/envelope.ts`.

**Spec:** `docs/superpowers/specs/2026-11-25-switchboard-org-tokens-design.md` (approved, revision 2). Read it before any task; this plan does not repeat its reasoning.

## Global Constraints

- Org token: `sbo_` followed by 64 lowercase hex characters, matched by `/^sbo_[0-9a-f]{64}$/`. Org id: 32 lowercase hex characters.
- The relay keeps the master in `SWITCHBOARD_ADMIN_TOKEN` and refuses to start when it starts with `sbo_`.
  - **Deviation from the spec:** for a master under 32 characters it logs a loud warning instead of refusing. `lib/daemon/__tests__/peer-waker-relay.test.ts` starts the relay with the 12-character `admin-secret`, sits outside the write fence, and must pass unchanged.
- Today's wire shapes stay byte-compatible: same routes, bodies and response keys. Fields are only added, and only on operator answers.
- No route answers another org's board differently from a username nobody holds. The exceptions are the 409 `username-taken` and the 403 `org-mismatch`, which is the same for every id that is not the caller's own.
- Every comparison of the master is constant time (`sameSecret` in `server.ts`).
- The relay must not import from outside `apps/board/switchboard/` and `apps/board/src/peer/envelope.ts`.
- User-facing copy says "the org's switchboard token" and "the relay operator's token", never "admin token". `--json` keys never change. Everything printed goes through `lib/ui/out.ts`. Failures are `UserActionableError` (`.claude/rules/output-layer.md`).
- After touching `packages/rt-client/src/switchboard.ts`, run `bun run build` in `packages/rt-client`.
- rt tests run from the worktree root (`bun test <file>`). Relay tests run from the board app: `(cd apps/board && bun test switchboard/__tests__/<file>)`.
- Write fence: `apps/board/switchboard/`, `commands/team.ts`, `lib/team/`, `lib/setup/`, `packages/rt-client/src/switchboard.ts`, `lib/command-tree-def.ts` (the `team admin-secrets` node), `.claude/rules/team-switchboard.md`, `apps/board/docs/peer-boards.md`, `docs/`, and those files' tests. Nothing else.
- Never run a built rt binary, start a daemon, or call the live relay.

## Review Focus

1. **A pre-change database.** A relay sqlite file made by today's code (no `org_id` columns, no `orgs`) opens and every board token still works. Pinned in Task 1, `migration.test.ts`.
2. **A username that differs only in case or spaces** (`' Ada '` vs `ada`) across orgs. Canonical comparison must still give 409, never a second board. Pinned in Task 2.
3. **The master sent where an org token is expected,** and an org token sent to a board route. Both give 401 or behave as the operator, never as some org's board. Pinned in Task 3.
4. **A Mac with two org clones and a token in its local secret.** Peer, status and remove for either org must not use it. Pinned in Task 5.
5. **An `--token-stdin` value with a trailing newline or spaces** (a paste). It is trimmed before the prefix check and the relay check. Pinned in Task 6.

---

### Task 1: Orgs table, `org_id` columns, legacy sweep

**Files:**
- Create: `apps/board/switchboard/orgs.ts`
- Modify: `apps/board/switchboard/store.ts` (constructor, `authBoard`)
- Test: `apps/board/switchboard/__tests__/orgs.test.ts`, `apps/board/switchboard/__tests__/migration.test.ts`

**Interfaces:**
- Produces (`orgs.ts`):
  - `ORG_TOKEN_PREFIX = 'sbo_'` and `ORG_TOKEN_RE = /^sbo_[0-9a-f]{64}$/`.
  - `class OrgStore`, built by `SwitchboardStore` and exposed as `store.orgs`.
  - `create(now: number): { id: string }`
  - `mintToken(id: string, now: number): string | null`. It mints a token or replaces the current one, and returns null for an unknown id.
  - `authOrg(token: string): string | null`, returning the org id.
  - `list(): Array<{ id: string; legacy: boolean; hasToken: boolean; boards: number; createdAt: number; tokenAt: number | null }>`
  - `exists(id: string): boolean`
  - `legacyId(): string | null`
  - `hasNonLegacy(): boolean`
  - `ensureLegacy(now: number): string | null`. It returns the legacy id, creating the org when none exists and `!hasNonLegacy()`. Otherwise it returns null.
  - `stampLegacyMaster(masterHash: string): void`. It records `relay_meta.legacy_master_hash` once (`INSERT OR IGNORE`), and only while a legacy org exists.
  - `masterGateClosed(masterHash: string): boolean`. True while the stored hash equals `masterHash`.
- Produces (`store.ts`): `SwitchboardStore.orgs: OrgStore`, and an exported `sweepNullOrgs(db, now): { moved: number; skipped: number }`, which the constructor calls.

- [ ] **Step 1: Write `orgs.test.ts`.**
  - `mint returns an sbo_ token that authOrg maps back to the org`
  - `mintToken again replaces the token, and the old one stops authenticating`
  - `mintToken on an unknown id returns null`
  - `ensureLegacy creates one legacy org, then returns the same id`
  - `ensureLegacy returns null once a non-legacy org exists and no legacy org does`
  - `masterGateClosed is true for the stamped hash, false for any other, and false when nothing is stamped`
  - `stampLegacyMaster does nothing without a legacy org, and never overwrites a stamp`
- [ ] **Step 2: Write `migration.test.ts`.**
  - Build a database with today's exact `CREATE TABLE` statements for `boards`, `invites`, `asks_off` and `envelopes`, copied from `store.ts` at `4bb7f8907f`. Insert two boards (known token hashes, from `hashToken`) and one open invite, then `new SwitchboardStore(db)`.
  - `pre-change boards keep authenticating and land in one legacy org`: both tokens pass `authBoard`, every row's `org_id` equals `orgs.legacyId()`, and `orgs.list()` has length 1 with `legacy: true, hasToken: false`.
  - `the sweep is idempotent across reopenings`
  - `NULL rows beside a non-legacy org are left alone and fail closed`: create a non-legacy org, insert a NULL-org board row by hand, then reopen. `authBoard(thatToken) === null` and `sweepNullOrgs` reports `skipped: 1`.
- [ ] **Step 3: Run both, and expect them to fail** (no `orgs.ts`): `(cd apps/board && bun test switchboard/__tests__/orgs.test.ts switchboard/__tests__/migration.test.ts)`
- [ ] **Step 4: Implement `orgs.ts` and the constructor changes.**
  - Tables: `orgs(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE, legacy INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, token_at INTEGER)` and `relay_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)`.
  - Add `org_id TEXT` to `boards` and `invites` when `PRAGMA table_info` lacks it.
  - `authBoard` adds `AND org_id IS NOT NULL`.
  - The sweep logs skipped rows with `console.warn`.
- [ ] **Step 5: Run the two new suites and the existing `store.test.ts`, and expect PASS.**
- [ ] **Step 6: Commit.** `switchboard: orgs table, org_id columns, legacy sweep`

### Task 2: Store scoping, usernames held by another org, support within an org

**Files:**
- Modify: `apps/board/switchboard/store.ts`, `apps/board/switchboard/support.ts`
- Test: `apps/board/switchboard/__tests__/store.test.ts`, `apps/board/switchboard/__tests__/invite-store.test.ts`, `apps/board/switchboard/__tests__/support.test.ts`

**Interfaces:**
- Consumes: Task 1's `OrgStore`.
- Produces (`store.ts`):
  - `class UsernameTakenError extends Error`.
  - `registerBoard(username: string, orgId?: string): { username: string; token: string }`. With no `orgId`, it uses `orgs.ensureLegacy(Date.now())`, and throws `Error('name-an-org')` when that returns null. It throws `UsernameTakenError` when another org holds the canonical username, through a board or an open invite.
  - `createInvite(username: string, now?: number, orgId?: string)`, with the same rules.
  - `redeemInvite(...)`: its error union adds `'taken'`. An invite row whose `org_id` is NULL answers `'unknown'`.
  - `boardOrg(username: string): string | null`
  - `listBoards(orgId?: string): Array<{ username: string; createdAt: number; org: string | null }>`
  - `listAskableUsernames(orgId?: string): string[]`
  - `recipients(from: string, to: string): string[]`. For `to === '*'` that is the sender's org minus the sender. Otherwise it is `[to]` only when `to` is in the sender's org, else `[]`.
  - `deleteBoard(username: string, orgId?: string): boolean`. False when the board is in another org.
  - `publish` keeps its signature and return shape, and delivers to `recipients(from, draft.to)`.
- Produces (`support.ts`): `SupportStore.sameOrg(a: string, b: string): boolean`. `publish` answers `unknown-recipient` when `!sameOrg(from, draft.to)`.

- [ ] **Step 1: Add the failing tests.**
  - **`store.test.ts`:**
    - `a username another org holds is refused, and the first board keeps its token`: org A registers `ada`; org B's `registerBoard(' Ada ', B)` throws `UsernameTakenError`; A's token still authenticates.
    - `an open invite in another org holds the username`
    - `re-register in the same org still reissues`
    - `publish to * reaches only the sender's org`
    - `a direct publish to another org's board is unknown-recipient`
    - `listBoards(org) and listAskableUsernames(org) list only that org`
    - `deleteBoard with another org's id returns false and keeps the board`
    - `registerBoard with no org after a non-legacy org exists throws name-an-org`
  - **`invite-store.test.ts`:**
    - `redeem registers into the invite's org`
    - `redeem returns taken, and consumes nothing, when another org registered the username since`
    - `redeem of a NULL-org invite is unknown`
  - **`support.test.ts`:**
    - `support publish to another org's board is unknown-recipient`
    - `sameOrg is false across orgs and for unknown usernames`
- [ ] **Step 2: Run them, and expect FAIL:** `(cd apps/board && bun test switchboard/__tests__/store.test.ts switchboard/__tests__/invite-store.test.ts switchboard/__tests__/support.test.ts)`
- [ ] **Step 3: Implement.** The holder check compares `canonicalUsername` values and runs inside the same transaction as the write.
- [ ] **Step 4: Run Step 2's command, and expect PASS** (the existing cases included).
- [ ] **Step 5: Commit.** `switchboard: scope the store by org, refuse usernames another org holds`

### Task 3: Relay routes

**Files:**
- Modify: `apps/board/switchboard/server.ts`, `apps/board/switchboard/support.ts` (the `/support/host/<u>` handler)
- Test: `apps/board/switchboard/__tests__/server.test.ts`, `apps/board/switchboard/__tests__/invite-server.test.ts`, `apps/board/switchboard/__tests__/inbox-wait.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces:
  - `export type AdminScope = { kind: 'operator' } | { kind: 'org'; org: string }`.
  - `export function masterTokenProblem(token: string): { refuse: boolean; message: string } | null`, used in `import.meta.main`.
  - `makeFetchHandler`'s positional parameters do not change. At construction it calls `store.orgs.stampLegacyMaster(hashToken(adminToken))` when a legacy org exists, and again after any master register that names no org.

- [ ] **Step 1: Add the failing tests to `server.test.ts`.** Create orgs with `store.orgs.create` and `mintToken`.
  - `an org token cannot list, register, reissue or delete another org's board`:
    - `GET /boards` lists only its own org, with today's `{username, createdAt}` keys;
    - `POST /boards {username: <B's user>}` is 409 `{"error":"username-taken"}`;
    - `DELETE /boards/<B's user>` is 404, and B's token still works.
  - `an org token naming any other org is 403 org-mismatch on /boards and /invites`, for an existing id and for a random one.
  - `an org token's org field naming its own org is accepted`
  - `the master lists every board with an org field`
  - `the master with no org registers into the legacy org on a fresh relay` (today's body, today's 201 `{username, token}`).
  - `the master with no org after a non-legacy org exists, and no legacy org, is 400 name-an-org`
  - `POST /orgs is 409 rotate-master-first while the master matches the legacy stamp`: build a second handler over the same db with a different master and expect 201 `{id, token}`, the token matching `ORG_TOKEN_RE`.
  - `POST /orgs/<id>/token rotates: the old org token is 401, boards are untouched`
  - `/orgs routes refuse org tokens and board tokens with 401`
  - `a board token on /boards and an org token on /peers are 401`
  - `/peers lists only the caller's org`
  - `/envelopes to * reaches only the caller's org; a direct send to another org is 422 unknown-recipient`
  - `/support/messages to another org is 422; /support/host/<other org's user> reads {accepting:false,lastSeenAt:null}`
  - `today's request bodies get today's response shapes`, covering every route in the spec's tables with no `org` field sent.
  - `masterTokenProblem refuses sbo_ and warns under 32 characters`
- [ ] **Step 2: Add to `invite-server.test.ts`.**
  - `redeem answers 409 when another org took the username`
  - `an org token's invite lands in its org`
- [ ] **Step 3: Add to `inbox-wait.test.ts`.**
  - `a broadcast wakes only the sender's org`: a waiter in another org stays asleep until its timeout.
- [ ] **Step 4: Run them, and expect FAIL:** `(cd apps/board && bun test switchboard/__tests__/server.test.ts switchboard/__tests__/invite-server.test.ts switchboard/__tests__/inbox-wait.test.ts)`
- [ ] **Step 5: Implement.**
  - `adminScope(req): AdminScope | null`: the master through `sameSecret`, then `orgs.authOrg`.
  - Add the `/orgs` routes to the spec's table.
  - Wake `store.recipients(username, draft.to)` in place of `waiters.boards()`.
  - The redeem 409 body is the text `that username already has a board in another org`.
  - `import.meta.main` exits 1 on `refuse`, and `console.warn`s the message otherwise.
- [ ] **Step 6: Run Step 4's command, and every other suite in `switchboard/__tests__`, and expect PASS.** Then run `bun test lib/daemon/__tests__/peer-waker-relay.test.ts lib/support/__tests__/end-to-end.test.ts` from the root, unchanged, and expect PASS. Run `bun run board:typecheck`, and expect it clean.
- [ ] **Step 7: Commit.** `switchboard: org-scoped admin routes, /orgs, routing within an org`

### Task 4: Operator script

**Files:**
- Create: `apps/board/switchboard/operator.ts`
- Test: `apps/board/switchboard/__tests__/operator.test.ts`

**Interfaces:**
- Produces:
  - `export async function runOperator(argv: string[], env: Record<string, string | undefined>, fetchFn: typeof fetch): Promise<{ code: number; stdout: string; stderr: string }>`.
  - The CLI runs only under `import.meta.main`.
  - Verbs: `orgs`, `mint`, `token <id>`.
  - The master comes from `env.SWITCHBOARD_OPERATOR_TOKEN`.
  - The URL is `env.SWITCHBOARD_URL ?? 'https://switchboard.mattstack.dev'`, accepted only when it is https or http to `localhost`, `127.0.0.1` or `[::1]`. Copy the rule from `acceptedOverride` in `packages/rt-client/src/switchboard.ts`, since the relay can't import it.

- [ ] **Step 1: Write the failing tests.**
  - `mint prints the new token once on stdout`
  - `token <id> calls POST /orgs/<id>/token`
  - `refuses with no SWITCHBOARD_OPERATOR_TOKEN, and never reads SWITCHBOARD_ADMIN_TOKEN`
  - `refuses an http URL that is not loopback`
  - `prints the relay's 409 rotate-master-first plainly`
- [ ] **Step 2: Run, and expect FAIL.** **Step 3: Implement.** **Step 4: Run, and expect PASS.**
- [ ] **Step 5: Commit.** `switchboard: operator script for minting and rotating org tokens`

### Task 5: rt picks the token by its source

**Files:**
- Modify: `packages/rt-client/src/switchboard.ts`, `lib/team/board-peers.ts`, `lib/team/peer.ts`, `lib/team/invite.ts`, `lib/team/join.ts`
- Test: `lib/team/__tests__/org-token-parity.test.ts` (new), `lib/team/__tests__/board-peers.test.ts`, `lib/team/__tests__/peer.test.ts`, `lib/team/__tests__/invite.test.ts`, `lib/team/__tests__/join.test.ts`

**Interfaces:**
- Produces:
  - `ORG_TOKEN_PREFIX` and `isOrgToken(token: string | null | undefined): boolean` in rt-client's `switchboard.ts`.
  - `pickAdminToken(file: string | null, own: Array<() => Promise<string | null>>, oneOrg: boolean): Promise<string | null>` in `board-peers.ts`, which tries:
    1. `file` when it is an org token;
    2. else, when `oneOrg`, each `own` thunk in order, returning the first org token (a thrown read propagates);
    3. else `file` when it is non-empty;
    4. else null.
  - `readAdminToken` and `readStoredAdminToken` keep their signatures. `readStoredAdminToken` gains a trailing `oneOrg = true`, so `lib/daemon/handlers/secrets.ts` needs no edit. `readAdminToken` passes `discoverOrgs(p).length === 1`.
  - Invite reads `pickAdminToken(file, [local], oneOrg)`. Join's `rejoinAdminToken` does the same, and `readTeamSecret` leaves `JoinRedeemSeams` and its fixtures.
  - Peer throws `UserActionableError("username-taken", "Another org on the switchboard already has a board for <username>", {}, { why: "Usernames are unique across the switchboard. Ask the relay operator." })` on a 409 from `POST /boards`.
  - Invite sets `embedFailure` to `another org on the switchboard already has a board for <handle>` on a 409.
  - Join's re-register warns with the same words on a 409 and returns its reinvite outcome.

- [ ] **Step 1: Write the failing tests.**
  - **Parity:** `rt's ORG_TOKEN_PREFIX matches the relay's`, which imports `apps/board/switchboard/orgs.ts`.
  - **`board-peers.test.ts`:**
    - `pickAdminToken prefers the file's org token over own sources`
    - `uses an own org token on a one-org Mac`
    - `never uses an own master`
    - `uses the file's master only when nothing else gives an org token`
    - `on a two-org Mac ignores own sources`
    - `does not call a later own thunk once an org token is found`
  - **`peer.test.ts`:**
    - `a 409 from register throws username-taken`
    - `a master in env is never sent`, asserting the fetch seam never sees it as a bearer.
  - **`invite.test.ts`:**
    - `a 409 from register becomes the username-taken embed failure`
    - `a local master is never sent`
  - **`join.test.ts`:**
    - `rejoin never reads member-wide team secrets`
    - `rejoin with no admin token is idle`
    - `a 409 on rejoin warns and asks for a re-invite`
- [ ] **Step 2: Run them, and expect FAIL:** `bun test lib/team/__tests__/org-token-parity.test.ts lib/team/__tests__/board-peers.test.ts lib/team/__tests__/peer.test.ts lib/team/__tests__/invite.test.ts lib/team/__tests__/join.test.ts`
- [ ] **Step 3: Implement.** Update the existing fixtures that pass a non-org admin token (`'admin'`, `'admin-secret'`, and so on) to an org-shaped token, and give one-org cases an org clone dir under the test HOME, as `discoverOrgs` expects. Do not weaken any assertion.
- [ ] **Step 4: Run `bun run build` in `packages/rt-client`, then Step 2's command plus `bun test lib/team/__tests__/members.test.ts lib/team/__tests__/create.test.ts lib/daemon/__tests__/secrets-handler.test.ts packages/rt-client/test/dist-freshness.test.ts`, and expect PASS.**
- [ ] **Step 5: Commit.** `team: pick the switchboard token by its source; never send a master kept on the Mac`

### Task 6: `rt team admin-secrets` shares only org tokens; create says what it waits for

**Files:**
- Modify: `lib/team/admin-secrets.ts`, `commands/team.ts` (`teamAdminSecrets`, `TOKEN_BLOCKS`, `adminSecretsBlocks`, `autoPeer` and its create caller, `TeamDeps`), `lib/command-tree-def.ts` (the `admin-secrets` node)
- Test: `lib/team/__tests__/admin-secrets.test.ts`, `commands/__tests__/team.test.ts`, and the command-tree tests that pin the node (`rg -l "admin-secrets" lib/__tests__ scripts`)

**Interfaces:**
- Consumes: `isOrgToken`, plus `pickAdminToken`'s one-org rule (`discoverOrgs`).
- Produces:
  - `TokenOutcome` gains `"operator"`.
  - `placeToken` never writes a token that is not an org token. `syncAdminSecrets` skips its `notThisMac` check for such a token.
  - `TeamDeps.readStdin?: () => Promise<string>`, defaulting to `new Response(Bun.stdin.stream()).text()`.
  - Errors: `not-org-token` ("That is not an org switchboard token", why: "Org tokens start with sbo_. The relay operator's own token is never shared.") and `org-token-rejected` ("The switchboard did not accept that token", why: "Nothing was changed. Check the token with the relay operator.").
  - Create prints `out.line("pending", "Your board connects once the relay operator gives this org its switchboard token")` and `out.callout("next", out.cmd("rt team admin-secrets --token-stdin"))` when `autoPeer` hits `peer-needs-admin`.
  - Tree node description: "Share your org's switchboard token with its owners and admins, and keep it locked to them". New flag row: `{ name: "Token from stdin", flag: "--token-stdin", type: "boolean", default: false, hint: "Read your org's switchboard token from stdin and share it" }`.

- [ ] **Step 1: Write the failing tests.**
  - **`admin-secrets.test.ts`:**
    - `syncAdminSecrets never writes a master and reports operator`
    - `with the rule unset and only a master, the state is unused and the token is operator`
  - **`team.test.ts`:**
    - `--token-stdin trims, checks against GET /boards, then shares`
    - `--token-stdin refuses a master with not-org-token and writes nothing`
    - `--token-stdin refuses when the relay answers 401, with org-token-rejected`
    - `without --token-stdin, a master on this Mac prints the refused line and still relocks`
    - `on a two-org Mac without --token-stdin, no token is read from this Mac`
    - `the removal callout names the relay operator`
    - `create with no org token prints the pending line and the next step`
    - `--json keys are unchanged`
- [ ] **Step 2: Run them, and expect FAIL:** `bun test lib/team/__tests__/admin-secrets.test.ts commands/__tests__/team.test.ts`
- [ ] **Step 3: Implement.**
  - Without `--token-stdin`, `teamAdminSecrets` reads this Mac's raw sources (env `SWITCHBOARD_ADMIN_TOKEN`, then `boardEnvValue(p, "SWITCHBOARD_ADMIN_TOKEN")`, then the local secret), and only on a one-org Mac.
  - The `operator` block is `out.line("refused", "This Mac's switchboard token is the relay operator's, so rt did not share it")` plus a `next` callout: `rt team admin-secrets --token-stdin`.
- [ ] **Step 4: Run Step 2's command plus the command-tree tests, and expect PASS.**
- [ ] **Step 5: Commit.** `team admin-secrets: share only org tokens; add --token-stdin`

### Task 7: Setup rows

**Files:**
- Modify: `lib/setup/validators/admin-secrets.ts`, `lib/setup/validators/accounts.ts` (`canSelfInvite`)
- Test: `lib/setup/__tests__/validators-admin-secrets.test.ts`, `lib/setup/__tests__/validators-accounts.test.ts`

**Interfaces:**
- Consumes: `isOrgToken` and `pickAdminToken`.
- Produces: `ownTokens(p, secrets): Promise<OwnToken[]>`, replacing `ownToken` and listing every source that holds a token. The row's verdicts, in the spec's order, use this exact copy:
  - **Verdict 1:** detail "The org shares the relay operator's token, not its own". Steps:
    - "Ask the relay operator for your org's switchboard token"
    - "Run rt team admin-secrets --token-stdin --replace-token and paste it"
    - "Re-check this row"
  - **Verdict 2:** detail "This Mac keeps the relay operator's switchboard token in <where>". Steps: one "Remove it from <where>; the relay operator keeps it outside rt" per source, then "Re-check this row".
  - **Verdict 3:** the existing "not shared yet" and "differs" verdicts, for org tokens on a one-org Mac only.

- [ ] **Step 1: Write the failing tests.**
  - **`validators-admin-secrets.test.ts`:**
    - `a shared master reads needs-you with the operator steps`
    - `a master in env, board .env or the local secret reads needs-you naming each place`
    - `a master on this Mac never produces "cannot use it yet"`
    - `an org token not yet shared still asks to share it`
    - `on a two-org Mac no share verdict fires`
    - `a Mac whose age key is not its roster key still reads skipped`
  - **`validators-accounts.test.ts`:**
    - `a Mac holding only an operator token is not told to run rt team peer`
    - `a Mac holding an org token still is`
- [ ] **Step 2: Run them, and expect FAIL:** `bun test lib/setup/__tests__/validators-admin-secrets.test.ts lib/setup/__tests__/validators-accounts.test.ts`
- [ ] **Step 3: Implement.** Update fixtures to org-shaped tokens where a test means an org token, as in Task 5.
- [ ] **Step 4: Run Step 2's command plus `bun test lib/setup/__tests__/steps-c.test.ts commands/__tests__/team-status.test.ts`, and expect PASS.**
- [ ] **Step 5: Commit.** `setup: the admin-secrets and board-peering rows tell org tokens from the operator's`

### Task 8: Docs and the runbook

**Files:**
- Create: `docs/switchboard-org-tokens.md`
- Modify: `apps/board/docs/peer-boards.md` (Operator setup, Inviting teammates, Privacy), `.claude/rules/team-switchboard.md`

- [ ] **Step 1: Write `docs/switchboard-org-tokens.md`.**
  - The operator runbook: steps 0 to 5 exactly as the spec's decision 2 gives them.
    - The step 0 checks.
    - The step 3 list: env, the local secret, the board's `.env` plus a board restart, and the member-wide hand edit (`sops mattstack/org/secrets/rt.json`, delete `switchboardAdminToken`, commit and publish).
    - The step 4 board restarts.
  - Minting an org for a new org, through `operator.ts` and `SWITCHBOARD_OPERATOR_TOKEN`; it is refused until step 5.
  - Rotating an org token, after which admins run `--token-stdin --replace-token`.
  - No rollback past this change once a second org exists.
  - No board keeps the master after step 5, the operator's included.
- [ ] **Step 2: Update `peer-boards.md` and the rule file.** Keep each fact once: the rule file points to the runbook instead of copying it.
- [ ] **Step 3: Run `bun test lib/__tests__/no-switchboard-url-setting.test.ts` and `bun run typecheck`, and expect PASS and clean.**
- [ ] **Step 4: Commit.** `docs: switchboard org tokens runbook, peer-boards and rule updates`
