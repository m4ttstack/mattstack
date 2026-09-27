# Lane 1a: rt state layer

> **Shepherd ruling (supersedes CONTRACT ISSUE 1 below):** adopt the reorder. `resolveHandle(x)`: (1) `x` is a `chat_identities` id, (2) a live display name, (3) the most recently minted identity named `x`, (4) `x` itself as a legacy id. Write Task 2's tests to this order, including "`@kai` reaches the live `kai.x7p2` while a legacy `kai` has memberships" and "no live kai, minted `kai.x7p2` offline beats legacy `kai`". The spec and master plan already carry this order. Your extra exports and the colon error wording are accepted.
>
> **Shepherd ruling 2 (adopted legacy handles):** step 1 matches only minted ids. `chat_identities` carries `minted INTEGER NOT NULL DEFAULT 1`; `adoptLegacy` writes `0`; `resolveHandle` step 1 uses `SELECT_MINTED_SQL` (`WHERE id = ? AND minted = 1`). Add a Task 2 test: legacy `kai` is adopted (its session signs in again), a live `kai.x7p2` exists, and `resolveHandle("kai")` returns `kai.x7p2`; with no live kai and the adoption newer than `kai.x7p2`'s mint, step 3 returns the adopted `kai` (most recent holder of the name).

Part of `docs/superpowers/plans/2026-09-27-chat-identity.md` (the master plan). Read the master plan's Global Constraints, Review Focus and FROZEN CONTRACT first; this file only adds the lane's own tasks. Spec: `docs/superpowers/specs/2026-09-27-chat-identity-design.md`.

**Worktree:** repo-tools, this lane's own rt worktree on a branch cut from `chat-identity`. Every command below runs from the worktree root (bun reads `bunfig.toml` only from the cwd, so `bun test` from anywhere else keeps the real HOME).

## CONTRACT ISSUE 1: resolution order lets a legacy handle shadow a live name

The frozen `resolveHandle` order is: (1) `x` is a known id, (2) a live session's display name, (3) newest identity by name, (4) `x`. Every one of the 253 original pool names already exists as a legacy id in `chat_members` (memberships are never pruned) and in `chat_messages` (90 days). So after rollout, `@kai`, `rt chat dm kai` and `--as kai` resolve at step 1 to the legacy `kai`, never to the live `kai.x7p2`, for every recycled pool name, indefinitely. A mention of a live agent by its shown name wakes nobody. The spec's own incident test ("`rt chat dm remy` from kai reaches B") only passes when the old remy was minted under this design; with the real 2026-09-27 data (old remy is the bare legacy `remy`) it fails.

Proposed fix (needs the shepherd's ruling; this lane plans against the contract as written): split step 1 into "a `chat_identities` id" first and "any other known id" after the live-name step:

1. `x` has a `chat_identities` row: that id.
2. A live session's display name is `x`: its id.
3. `x` is otherwise a known id (legacy): that id.
4. Newest identity named `x`: its id.
5. `x`.

Review Focus 3 still holds: a dotted legacy handle resolves as itself unless a live session is displaying that exact dotted string. If accepted, the only code change is `resolveHandle` in Task 2 (swap the order), plus one test in Task 2: a legacy member `kai` and a live `kai.<suffix>` showing `kai`, and `resolveHandle("kai")` returns the live id. The incident test in Task 11 then gains a legacy-remy variant for "`rt chat dm remy` reaches B".

## Notes for lane 1b (not contract changes)

- The store refuses `continueId` of the human (`chat.humanHandle`, read with `getSetting` inside `identity-store.ts`) and of `herdr`, and refuses an id live in another session. The `--as <x>` fallback ("live elsewhere, so mint `x-2`") is the handler's job: resolve `x`, and if `presenceForHandle(id)` is live in another session, call `signIn({ baseHandle: identityName(id) })` instead of `continueId`.
- `herd:resume` taking over a shepherd id from a live but replaced session: `signOut(oldSessionId)` first; a signed-out holder is reclaimable, so `continueId` then succeeds.
- `reserveAgentHandle` now returns an id. The agent sign-in path in `lib/daemon/handlers/chat.ts` (the `getAgent(sessionId, db)?.handle` block) must pass it as `continueId`, not `baseHandle`; until 1b lands, that path mints a nested `remy.k3f9.<suffix>`.
- `postMessage` resolves every mention (body and explicit) with `resolveHandle` before storing; the handler does not need to pre-resolve (doing so is harmless, since an id resolves to itself).
- `assertSessionOwnsHandle`'s message changes one character: the em dash after "handle reclaimed" becomes a colon (Global Constraints forbid the dash). Every consumer matches the substring `handle reclaimed`, which is unchanged.
- Extra exports beyond the frozen Store API (additions, nothing renamed): `getIdentity`, `renameIdentity`, `fixedIdentityRefusal`, `HERD_SYSTEM_ID` from `identity-store.ts`; `type SignInResult` from `presence-store.ts`. `HERD_SYSTEM_ID` equals `SYSTEM_HANDLE` in `lib/daemon/handlers/herd.ts`; 1b may re-point `SYSTEM_HANDLE` at it.
- `bindIdentitySession` also adopts a legacy id (inserts a row named after itself) so a legacy handle can be continued and bound.
- Schema v14 adds two indexes beyond the spec's one (`chat_identities_session`, `chat_messages_handle`): `identityForSession` and `isKnownId` run on every sign-in and every mention.
- Task 8 removes the pane-pin call sites in `lib/daemon/handlers/chat.ts` and `commands/chat.ts` (deletion only, to keep `bun run typecheck` green). 1b rebases over that.
- `listRooms`' `unread` count still includes the reader's own posts; only `peekUnread` and `readUnread` exclude them (contract scope).

## Lane gate and expected red outside it

This lane is green when `bun test lib/state lib/__tests__/chat-names.test.ts` passes and `bun run typecheck` passes. From Task 3 on, `signIn` returns ids, so suites that assert a handle equals its display name go red until lane 1b rebases: `lib/daemon/__tests__/chat-*.test.ts`, `lib/daemon/__tests__/agent*.test.ts`, `lib/daemon/__tests__/herd*.test.ts`, `lib/daemon/__tests__/pane*.test.ts`, `lib/mcp/__tests__/*chat*.test.ts`, `commands/__tests__/chat.test.ts`, `e2e/tests/chat-*`. Do not fix those here; Task 12 records the list for 1b.

## Files

| File | Change |
|---|---|
| `lib/state/db.ts` | `V14_SCHEMA` (`chat_identities` + 3 indexes), `SCHEMA_VERSION` 14 |
| `lib/state/identity-store.ts` | new: the frozen Store API plus the extras above |
| `lib/state/index.ts` | re-exports; pane-pin exports removed |
| `lib/state/presence-store.ts` | `signIn` minting, continuation, display names; `PresenceRow.name`; `reserveAgentHandle` mints; pane pin deleted |
| `lib/chat-names.ts` | `AGENT_NAMES` grows to 1,000 |
| `lib/state/chat-store.ts` | `ChatMessage.name`/`mentionNames`, `ChatMember.name`, mention resolution, self-unread exclusion |
| `lib/state/dm-store.ts` | unchanged (verified by test) |
| `lib/daemon/handlers/chat.ts`, `commands/chat.ts`, `commands/__tests__/chat.test.ts` | pane-pin call sites deleted (Task 8 only) |
| Tests | `lib/state/__tests__/{db,identity-store,presence-store,chat-store,dm-store,chat-identity-incident}.test.ts`, `lib/__tests__/chat-names.test.ts` |

---

### Task 1: Schema v14 and identity-store basics

**Files:**
- Modify: `lib/state/db.ts:24-25` (version), after `V13_SCHEMA` (new block), `:345` (`SCHEMAS`)
- Create: `lib/state/identity-store.ts`
- Modify: `lib/state/index.ts` (new export block after the `dm-store` export)
- Test: `lib/state/__tests__/db.test.ts`, `lib/state/__tests__/identity-store.test.ts` (new)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `IdentityRow`; `mintIdentity(args: { base: string; name: string; sessionId: string | null; now?: number }, db?): IdentityRow`; `identityForSession(sessionId: string, db?): IdentityRow | undefined`; `bindIdentitySession(id: string, sessionId: string, db?): void`; `identityName(id: string, db?): string`; `identityNames(ids: Iterable<string>, db?): Map<string, string>`; `isKnownId(x: string, db?): boolean` (identities and members only until Task 2); `getIdentity(id: string, db?): IdentityRow | undefined`; `renameIdentity(id: string, name: string, baseName: string, db?): void`.

- [ ] **Step 1: Write the failing schema test**

In `lib/state/__tests__/db.test.ts`, replace the first test of the first `describe` block (the fresh-open block; the test is titled "a fresh database reaches v13 directly...") with:

```ts
  test("a fresh database reaches v14 directly, gaining every v1 through v14 change", () => {
    const dbPath = join(dir, "state.db");
    const db = openStateDb(dbPath, "cli");
    expect(SCHEMA_VERSION).toBe(14);
    expect(userVersion(db)).toBe(SCHEMA_VERSION);
    const cols = (db.query("PRAGMA table_info(chat_rooms);").all() as { name: string }[]).map(c => c.name);
    expect(cols).toContain("archived_at");
    const agentCols = (db.query("PRAGMA table_info(agents);").all() as { name: string }[]).map(c => c.name);
    expect(agentCols).toContain("handle");
    const claimCols = (db.query("PRAGMA table_info(endpoint_claims);").all() as { name: string }[]).map(c => c.name);
    expect(claimCols).toContain("start_time");
    const identityCols = (db.query("PRAGMA table_info(chat_identities);").all() as { name: string }[]).map(c => c.name);
    expect(identityCols).toEqual(["id", "name", "base_name", "minted_at", "session_id"]);
    const indexes = db
      .query("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('chat_identities_name', 'chat_identities_session', 'chat_messages_handle') ORDER BY name;")
      .all();
    expect(indexes).toEqual([{ name: "chat_identities_name" }, { name: "chat_identities_session" }, { name: "chat_messages_handle" }]);
    db.close();
  });

  test("v14 adds chat_identities to a v13 database without touching a chat row", () => {
    const dbPath = join(dir, "state.db");
    const db = openStateDb(dbPath, "cli");
    db.exec("DROP TABLE chat_identities;");
    db.exec("INSERT INTO chat_members (room, handle, joined_at, last_read_id, wake_on) VALUES ('r', 'remy', 1, 0, 'mention');");
    db.exec("PRAGMA user_version = 13;");
    db.close();
    const re = openStateDb(dbPath, "cli");
    expect(userVersion(re)).toBe(14);
    expect(re.query("SELECT handle FROM chat_members;").all()).toEqual([{ handle: "remy" }]);
    expect(re.query("SELECT COUNT(*) AS n FROM chat_identities;").get()).toEqual({ n: 0 });
    re.close();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test lib/state/__tests__/db.test.ts`
Expected: FAIL, `expect(SCHEMA_VERSION).toBe(14)` receives 13.

- [ ] **Step 3: Add the v14 block**

In `lib/state/db.ts`, change the version line and its doc comment:

```ts
/** PRAGMA user_version target for the combined schema below (v1 + v2 + v3 + v4 + v6 + v7 + v8 + v9 + v12 + v13 + v14; v10 and v11 are DML-only migrations, not DDL blocks in SCHEMAS). */
export const SCHEMA_VERSION = 14;
```

After the `V13_SCHEMA` constant add:

```ts
// Tables (v14): chat identities (lib/state/identity-store.ts is the only
// writer). A handle with no row here is a legacy id and its own display name.
const V14_SCHEMA = `
CREATE TABLE IF NOT EXISTS chat_identities (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,   -- display name, suffix included (remy-2)
  base_name   TEXT NOT NULL,   -- remy
  minted_at   INTEGER NOT NULL,
  minted      INTEGER NOT NULL DEFAULT 1,  -- 0 for an adopted legacy handle
  session_id  TEXT             -- null for a reservation not yet signed in
);
CREATE INDEX IF NOT EXISTS chat_identities_name ON chat_identities(name, minted_at);
CREATE INDEX IF NOT EXISTS chat_identities_session ON chat_identities(session_id);
CREATE INDEX IF NOT EXISTS chat_messages_handle ON chat_messages(handle);
`;
```

and append it to the array:

```ts
const SCHEMAS = [V1_SCHEMA, V2_SCHEMA, V3_SCHEMA, V4_SCHEMA, V6_SCHEMA, V7_SCHEMA, V8_SCHEMA, V9_SCHEMA, V12_SCHEMA, V13_SCHEMA, V14_SCHEMA];
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test lib/state/__tests__/db.test.ts lib/state/__tests__/db-schema-convergence.test.ts`
Expected: PASS (the convergence test derives its table list from db.ts, so it now covers `chat_identities` too).

- [ ] **Step 5: Write the failing identity-store tests**

Create `lib/state/__tests__/identity-store.test.ts`:

```ts
/**
 * lib/state/identity-store.ts: the hidden id behind every chat handle
 * (spec 2026-09-27-chat-identity-design.md).
 */
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { tmpdir } from "os";
import { join } from "path";
import { openStateDb } from "../db.ts";
import {
  bindIdentitySession,
  getIdentity,
  identityForSession,
  identityName,
  identityNames,
  isKnownId,
  mintIdentity,
} from "../identity-store.ts";

let n = 0;
function fresh(): Database {
  return openStateDb(join(tmpdir(), `identity-test-${process.pid}-${n++}.db`));
}

/** The spec's suffix derivation, spelled out independently of the store. */
function suffix(seed: string, length: number): string {
  const hex = new Bun.CryptoHasher("sha256").update(seed).digest("hex");
  return BigInt(`0x${hex}`).toString(36).slice(-length);
}

function member(db: Database, handle: string): void {
  db.run("INSERT INTO chat_members (room, handle, joined_at, last_read_id, wake_on) VALUES ('r', ?, 1, 0, 'mention')", [handle]);
}

test("a minted id is the base, a dot, and 4 base36 chars of sha256(sessionId:mintedAt)", () => {
  const db = fresh();
  const row = mintIdentity({ base: "remy", name: "remy", sessionId: "s1", now: 1000 }, db);
  expect(row).toEqual({ id: `remy.${suffix("s1:1000", 4)}`, name: "remy", baseName: "remy", mintedAt: 1000, sessionId: "s1" });
  expect(row.id).toMatch(/^remy\.[a-z0-9]{4}$/);
  expect(getIdentity(row.id, db)).toEqual(row);
});

test("a clash with a known id lengthens the suffix to 6, then salts the seed", () => {
  const db = fresh();
  member(db, `remy.${suffix("s1:1000", 4)}`);
  const six = mintIdentity({ base: "remy", name: "remy", sessionId: "s1", now: 1000 }, db);
  expect(six.id).toBe(`remy.${suffix("s1:1000", 6)}`);
  const salted = mintIdentity({ base: "remy", name: "remy", sessionId: "s1", now: 1000 }, db);
  expect(salted.id).toBe(`remy.${suffix("s1:1000:1", 6)}`);
});

test("two unbound reservations in the same millisecond still get distinct ids", () => {
  const db = fresh();
  const a = mintIdentity({ base: "remy", name: "remy", sessionId: null, now: 5 }, db);
  const b = mintIdentity({ base: "remy", name: "remy", sessionId: null, now: 5 }, db);
  expect(a.id).toBe(`remy.${suffix(":5", 4)}`);
  expect(b.id).toBe(`remy.${suffix(":5", 6)}`);
});

test("identityName falls back to the id; identityNames maps every input id", () => {
  const db = fresh();
  const remy = mintIdentity({ base: "remy", name: "remy-2", sessionId: "s1", now: 1 }, db);
  expect(identityName(remy.id, db)).toBe("remy-2");
  expect(identityName("kai", db)).toBe("kai");
  const names = identityNames([remy.id, "kai", remy.id], db);
  expect([...names.entries()]).toEqual([[remy.id, "remy-2"], ["kai", "kai"]]);
});

test("identityNames answers more ids than one statement can bind", () => {
  const db = fresh();
  const ids = Array.from({ length: 1200 }, (_, i) => `legacy-${i}`);
  const minted = mintIdentity({ base: "remy", name: "remy", sessionId: "s1", now: 1 }, db);
  const names = identityNames([...ids, minted.id], db);
  expect(names.size).toBe(1201);
  expect(names.get("legacy-1199")).toBe("legacy-1199");
  expect(names.get(minted.id)).toBe("remy");
});

test("identityForSession finds the session's identity; a later mint for that session takes the binding", () => {
  const db = fresh();
  const first = mintIdentity({ base: "remy", name: "remy", sessionId: "s1", now: 1 }, db);
  expect(identityForSession("s1", db)?.id).toBe(first.id);
  const second = mintIdentity({ base: "kai", name: "kai", sessionId: "s1", now: 2 }, db);
  expect(identityForSession("s1", db)?.id).toBe(second.id);
  expect(getIdentity(first.id, db)?.sessionId).toBeNull();
  expect(identityForSession("nobody", db)).toBeUndefined();
});

test("bindIdentitySession moves a reservation onto a session and adopts a legacy id named after itself", () => {
  const db = fresh();
  const reserved = mintIdentity({ base: "remy", name: "remy", sessionId: null, now: 1 }, db);
  bindIdentitySession(reserved.id, "s9", db);
  expect(identityForSession("s9", db)?.id).toBe(reserved.id);
  bindIdentitySession("kai-2", "s9", db);
  expect(identityForSession("s9", db)).toMatchObject({ id: "kai-2", name: "kai-2", baseName: "kai", sessionId: "s9" });
  expect(getIdentity(reserved.id, db)?.sessionId).toBeNull();
});

test("isKnownId: a minted id and a member handle are known; a stranger is not", () => {
  const db = fresh();
  const remy = mintIdentity({ base: "remy", name: "remy", sessionId: "s1", now: 1 }, db);
  member(db, "kai");
  expect(isKnownId(remy.id, db)).toBe(true);
  expect(isKnownId("kai", db)).toBe(true);
  expect(isKnownId("nobody", db)).toBe(false);
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `bun test lib/state/__tests__/identity-store.test.ts`
Expected: FAIL, `Cannot find module '../identity-store.ts'`.

- [ ] **Step 7: Create `lib/state/identity-store.ts`**

```ts
/**
 * lib/state/identity-store.ts: chat identities (spec
 * 2026-09-27-chat-identity-design.md). The only module that writes
 * `chat_identities`. An id is `<base>.<suffix>`; a handle with no row here
 * is a legacy id whose display name is itself.
 */

import { Database } from "bun:sqlite";
import { baseOfHandle } from "../chat-names.ts";
import { getStateDb } from "./db.ts";

export interface IdentityRow {
  id: string;
  name: string;
  baseName: string;
  mintedAt: number;
  sessionId: string | null;
}

interface IdentityRawRow {
  id: string;
  name: string;
  base_name: string;
  minted_at: number;
  session_id: string | null;
}

function rowToIdentity(row: IdentityRawRow): IdentityRow {
  return { id: row.id, name: row.name, baseName: row.base_name, mintedAt: row.minted_at, sessionId: row.session_id };
}

const IDENTITY_COLUMNS = "id, name, base_name, minted_at, session_id";
const SELECT_IDENTITY_SQL = `SELECT ${IDENTITY_COLUMNS} FROM chat_identities WHERE id = ?;`;
const SELECT_IDENTITY_BY_SESSION_SQL = `SELECT ${IDENTITY_COLUMNS} FROM chat_identities WHERE session_id = ? ORDER BY minted_at DESC, rowid DESC LIMIT 1;`;
const SELECT_NAME_SQL = `SELECT name FROM chat_identities WHERE id = ?;`;
const INSERT_IDENTITY_SQL = `INSERT INTO chat_identities (id, name, base_name, minted_at, session_id) VALUES (?, ?, ?, ?, ?);`;
const ADOPT_LEGACY_SQL = `INSERT INTO chat_identities (id, name, base_name, minted_at, minted, session_id) VALUES (?, ?, ?, ?, 0, NULL) ON CONFLICT(id) DO NOTHING;`;
const SELECT_MINTED_SQL = `SELECT 1 FROM chat_identities WHERE id = ? AND minted = 1;`;
const UNBIND_SESSION_SQL = `UPDATE chat_identities SET session_id = NULL WHERE session_id = ? AND id <> ?;`;
const BIND_SESSION_SQL = `UPDATE chat_identities SET session_id = ? WHERE id = ?;`;
const RENAME_IDENTITY_SQL = `UPDATE chat_identities SET name = ?, base_name = ? WHERE id = ?;`;

// Reads other modules' tables on purpose: an id minted onto a handle any of
// them already holds would inherit that handle's footprint.
const KNOWN_ID_SQL = `
SELECT 1 AS known FROM chat_identities WHERE id = $id
UNION ALL SELECT 1 FROM chat_members WHERE handle = $id
LIMIT 1;`;

// Well under SQLite's bound-parameter limit on every build bun ships.
const NAME_LOOKUP_CHUNK = 500;

/** True when `x` is a known id: a chat_identities row, or a handle in chat_presence, chat_members, chat_messages or chat_dms. */
export function isKnownId(x: string, db: Database = getStateDb()): boolean {
  return db.query(KNOWN_ID_SQL).get({ $id: x }) !== null;
}

function base36Suffix(seed: string, length: number): string {
  const hex = new Bun.CryptoHasher("sha256").update(seed).digest("hex");
  return BigInt(`0x${hex}`).toString(36).slice(-length);
}

function freshId(base: string, sessionId: string | null, mintedAt: number, db: Database): string {
  const seed = `${sessionId ?? ""}:${mintedAt}`;
  const short = `${base}.${base36Suffix(seed, 4)}`;
  if (!isKnownId(short, db)) return short;
  for (let salt = 0; ; salt++) {
    const id = `${base}.${base36Suffix(salt === 0 ? seed : `${seed}:${salt}`, 6)}`;
    if (!isKnownId(id, db)) return id;
  }
}

/** Mints and inserts a fresh identity. `name` is the display name (suffix included); `base` is the pool or chosen base. */
export function mintIdentity(
  args: { base: string; name: string; sessionId: string | null; now?: number },
  db: Database = getStateDb(),
): IdentityRow {
  const mintedAt = args.now ?? Date.now();
  const run = db.transaction((): IdentityRow => {
    const id = freshId(args.base, args.sessionId, mintedAt, db);
    if (args.sessionId !== null) db.query(UNBIND_SESSION_SQL).run(args.sessionId, id);
    db.query(INSERT_IDENTITY_SQL).run(id, args.name, args.base, mintedAt, args.sessionId);
    return { id, name: args.name, baseName: args.base, mintedAt, sessionId: args.sessionId };
  });
  // BEGIN IMMEDIATE when standalone: the known-id probe and the insert must
  // hold the write lock together or a racing mint lands the same id.
  return db.inTransaction ? run() : run.immediate();
}

export function getIdentity(id: string, db: Database = getStateDb()): IdentityRow | undefined {
  const row = db.query(SELECT_IDENTITY_SQL).get(id) as IdentityRawRow | null;
  return row ? rowToIdentity(row) : undefined;
}

/** The identity a session already holds, if any (survives presence prune). */
export function identityForSession(sessionId: string, db: Database = getStateDb()): IdentityRow | undefined {
  const row = db.query(SELECT_IDENTITY_BY_SESSION_SQL).get(sessionId) as IdentityRawRow | null;
  return row ? rowToIdentity(row) : undefined;
}

/** Binds an existing identity (a reservation or a continuation) to a session, releasing any other identity that session held. A legacy id with no row is adopted under its own name. */
export function bindIdentitySession(id: string, sessionId: string, db: Database = getStateDb()): void {
  const run = db.transaction(() => {
    db.query(ADOPT_LEGACY_SQL).run(id, id, baseOfHandle(id), Date.now());
    db.query(UNBIND_SESSION_SQL).run(sessionId, id);
    db.query(BIND_SESSION_SQL).run(sessionId, id);
  });
  if (db.inTransaction) run();
  else run.immediate();
}

export function renameIdentity(id: string, name: string, baseName: string, db: Database = getStateDb()): void {
  db.query(RENAME_IDENTITY_SQL).run(name, baseName, id);
}

/** Display name for one id; falls back to the id itself. */
export function identityName(id: string, db: Database = getStateDb()): string {
  const row = db.query(SELECT_NAME_SQL).get(id) as { name: string } | null;
  return row?.name ?? id;
}

/** Display names for many ids in one query; every input id is a key, missing rows map to themselves. */
export function identityNames(ids: Iterable<string>, db: Database = getStateDb()): Map<string, string> {
  const names = new Map<string, string>();
  for (const id of ids) names.set(id, id);
  const all = [...names.keys()];
  for (let i = 0; i < all.length; i += NAME_LOOKUP_CHUNK) {
    const chunk = all.slice(i, i + NAME_LOOKUP_CHUNK);
    const sql = `SELECT id, name FROM chat_identities WHERE id IN (${chunk.map(() => "?").join(", ")});`;
    for (const row of db.query(sql).all(...chunk) as { id: string; name: string }[]) names.set(row.id, row.name);
  }
  return names;
}
```

- [ ] **Step 8: Re-export from the barrel**

In `lib/state/index.ts`, directly after `export { dmRoomFor, dmParticipants, listDms } from "./dm-store.ts";` add:

```ts
export {
  bindIdentitySession,
  getIdentity,
  identityForSession,
  identityName,
  identityNames,
  isKnownId,
  mintIdentity,
  renameIdentity,
  type IdentityRow,
} from "./identity-store.ts";
```

- [ ] **Step 9: Run the tests and typecheck**

Run: `bun test lib/state/__tests__/identity-store.test.ts lib/state/__tests__/db.test.ts lib/state/__tests__/barrel.test.ts`
Expected: PASS.
Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add lib/state/db.ts lib/state/identity-store.ts lib/state/index.ts lib/state/__tests__/db.test.ts lib/state/__tests__/identity-store.test.ts
git commit -m "state: chat_identities table (v14) and identity store" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: resolveHandle and the full isKnownId

**Files:**
- Modify: `lib/state/identity-store.ts` (`KNOWN_ID_SQL`, new `resolveHandle`)
- Modify: `lib/state/index.ts` (identity export block)
- Test: `lib/state/__tests__/identity-store.test.ts`

**Interfaces:**
- Consumes: Task 1's `mintIdentity`, `isKnownId`.
- Produces: `resolveHandle(x: string, db?): string` in the ruled order (minted id, live display name, most recent minted identity by name, `x` as a legacy id); `isKnownId` covering all five tables (it guards minting and continuation, not resolution).

- [ ] **Step 1: Write the failing tests**

Add `resolveHandle` to the `../identity-store.ts` import in `lib/state/__tests__/identity-store.test.ts`, then append:

```ts
function seat(db: Database, sessionId: string, handle: string, base: string, at: number, signedOutAt: number | null = null): void {
  db.run(
    "INSERT INTO chat_presence (session_id, handle, base_handle, signed_in_at, last_seen_at, signed_out_at) VALUES (?, ?, ?, ?, ?, ?)",
    [sessionId, handle, base, at, at, signedOutAt],
  );
}

test("isKnownId sees a handle in chat_presence, chat_messages and either side of chat_dms", () => {
  const db = fresh();
  seat(db, "s1", "pres", "pres", 1);
  db.run("INSERT INTO chat_messages (room, handle, body, posted_at) VALUES ('r', 'author', 'hi', 1)");
  db.run("INSERT INTO chat_dms (room, a, b, created_at) VALUES ('dm-1', 'left', 'right', 1)");
  for (const x of ["pres", "author", "left", "right"]) expect(isKnownId(x, db)).toBe(true);
  expect(isKnownId("nobody", db)).toBe(false);
});

test("resolveHandle: a minted id, then a live display name, then the newest identity by name, then the input", () => {
  const db = fresh();
  const old = mintIdentity({ base: "remy", name: "remy", sessionId: "s-old", now: 1 }, db);
  const newer = mintIdentity({ base: "remy", name: "remy", sessionId: "s-new", now: 2 }, db);
  expect(resolveHandle("remy", db)).toBe(newer.id);
  seat(db, "s-old", old.id, "remy", 3);
  expect(resolveHandle("remy", db)).toBe(old.id);
  expect(resolveHandle(newer.id, db)).toBe(newer.id);
  expect(resolveHandle("nobody", db)).toBe("nobody");
});

test("resolveHandle: @kai reaches the live kai.x7p2 while a legacy kai has memberships", () => {
  const db = fresh();
  member(db, "kai");
  const live = mintIdentity({ base: "kai", name: "kai", sessionId: "s1", now: 5 }, db);
  seat(db, "s1", live.id, "kai", 5);
  expect(resolveHandle("kai", db)).toBe(live.id);
});

test("resolveHandle: with no live kai, an offline minted kai.x7p2 beats the legacy kai", () => {
  const db = fresh();
  member(db, "kai");
  const minted = mintIdentity({ base: "kai", name: "kai", sessionId: "s1", now: 5 }, db);
  expect(resolveHandle("kai", db)).toBe(minted.id);
  expect(resolveHandle("legacy-only", db)).toBe("legacy-only");
});

test("resolveHandle: a signed-out session's display name is not live", () => {
  const db = fresh();
  const old = mintIdentity({ base: "remy", name: "remy", sessionId: "s-old", now: 1 }, db);
  const newer = mintIdentity({ base: "remy", name: "remy", sessionId: "s-new", now: 2 }, db);
  seat(db, "s-old", old.id, "remy", 3, 4);
  expect(resolveHandle("remy", db)).toBe(newer.id);
});

test("resolveHandle: a suffixed display name resolves to the session showing it", () => {
  const db = fresh();
  const first = mintIdentity({ base: "remy", name: "remy", sessionId: "s1", now: 1 }, db);
  const second = mintIdentity({ base: "remy", name: "remy-2", sessionId: "s2", now: 1 }, db);
  seat(db, "s1", first.id, "remy", 1);
  seat(db, "s2", second.id, "remy", 1);
  expect(resolveHandle("remy", db)).toBe(first.id);
  expect(resolveHandle("remy-2", db)).toBe(second.id);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/state/__tests__/identity-store.test.ts`
Expected: FAIL, `resolveHandle` is not exported (SyntaxError on import), so the whole file fails.

- [ ] **Step 3: Implement**

In `lib/state/identity-store.ts`, replace `KNOWN_ID_SQL` with:

```ts
const KNOWN_ID_SQL = `
SELECT 1 AS known FROM chat_identities WHERE id = $id
UNION ALL SELECT 1 FROM chat_presence WHERE handle = $id
UNION ALL SELECT 1 FROM chat_members WHERE handle = $id
UNION ALL SELECT 1 FROM chat_messages WHERE handle = $id
UNION ALL SELECT 1 FROM chat_dms WHERE a = $id OR b = $id
LIMIT 1;`;
```

Add these constants next to the other SQL:

```ts
const SELECT_LIVE_BY_NAME_SQL = `
SELECT p.handle AS id FROM chat_presence p LEFT JOIN chat_identities i ON i.id = p.handle
WHERE p.signed_out_at IS NULL AND COALESCE(i.name, p.handle) = ?
ORDER BY p.signed_in_at DESC LIMIT 1;`;
const SELECT_LATEST_BY_NAME_SQL = `SELECT id FROM chat_identities WHERE name = ? ORDER BY minted_at DESC, rowid DESC LIMIT 1;`;
```

and the function after `isKnownId`:

```ts
/** Spec "Resolving a typed name": minted id (chat_identities row), else live display name, else most recent minted identity by name, else `x` as a legacy id. */
export function resolveHandle(x: string, db: Database = getStateDb()): string {
  if (db.query(SELECT_MINTED_SQL).get(x)) return x;
  const live = db.query(SELECT_LIVE_BY_NAME_SQL).get(x) as { id: string } | null;
  if (live) return live.id;
  const latest = db.query(SELECT_LATEST_BY_NAME_SQL).get(x) as { id: string } | null;
  return latest?.id ?? x;
}
```

In `lib/state/index.ts`, add `resolveHandle,` to the identity export block (after `renameIdentity,`).

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test lib/state/__tests__/identity-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/state/identity-store.ts lib/state/index.ts lib/state/__tests__/identity-store.test.ts
git commit -m "state: resolve typed chat names to identity ids" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: signIn mints ids; same session keeps its id; live display names stay unique

**Files:**
- Modify: `lib/state/presence-store.ts` (header, imports, `PresenceRow`, `rowToPresence`, `suffixOf`/`suffixToHandle` docs, delete `SELECT_BASE_HANDLE_ROWS_SQL` and `findOpenSuffix`, rewrite `signIn`, `drawPoolName`, `listBuddies`, `presenceForHandle`, `presenceForSession`)
- Modify: `lib/state/index.ts` (presence export block: add `type SignInResult`)
- Test: `lib/state/__tests__/presence-store.test.ts`

**Interfaces:**
- Consumes: Task 1's `mintIdentity`, `identityForSession`, `bindIdentitySession`, `renameIdentity`, `identityName`, `identityNames`, `type IdentityRow`.
- Produces: `signIn(args, db?, deps?): SignInResult | undefined` where `SignInResult = { handle: string; baseHandle: string; name: string; reclaimed: boolean; continued: boolean }` (`continued` is always false until Task 5); `PresenceRow.name: string`. Invariant later tasks rely on: display names are unique across all of `chat_presence`.

- [ ] **Step 1: Update the existing tests to the id model and add the new ones**

In `lib/state/__tests__/presence-store.test.ts`:

Add `presenceForHandle` and `type SignInResult` to the `../presence-store.ts` import, and add these imports below the existing ones:

```ts
import { identityForSession, mintIdentity } from "../identity-store.ts";
import { setKvValue } from "../kv-blob.ts";
```

Replace `mustSignIn` with:

```ts
function mustSignIn(...args: Parameters<typeof signIn>): SignInResult {
  const result = signIn(...args);
  if (!result) throw new Error("mustSignIn: signIn() unexpectedly returned undefined");
  return result;
}
```

Replace these existing tests' bodies (titles stay unless given):

```ts
test("a base held by a live row is suffixed; the suffix is stable", () => {
  const db = fresh();
  const a = mustSignIn({ sessionId: "s1", baseHandle: "x", now }, db);
  const b = mustSignIn({ sessionId: "s2", baseHandle: "x", now }, db);
  const c = mustSignIn({ sessionId: "s3", baseHandle: "x", now }, db);
  expect([a.name, b.name, c.name]).toEqual(["x", "x-2", "x-3"]);
  expect(new Set([a.handle, b.handle, c.handle]).size).toBe(3);
  for (const r of [a, b, c]) expect(r.handle).toMatch(/^x\.[a-z0-9]{4}$/);
});

test("a session-stale holder with no live binding is never reclaimed inside the session-stale window", () => {
  const db = fresh();
  mustSignIn({ sessionId: "s1", baseHandle: "x", cwd: "/w", now }, db);
  const r = mustSignIn({ sessionId: "s2", baseHandle: "x", cwd: "/w", now: now + MIN }, db);
  expect(r).toMatchObject({ name: "x-2", reclaimed: false });
});

test("a stale same-seat row gives up its display name to a restarted process, which gets a new id", () => {
  const db = fresh();
  const first = mustSignIn({ sessionId: "s1", baseHandle: "x", cwd: "/w", pane: "3", now }, db);
  const r = mustSignIn({ sessionId: "s2", baseHandle: "x", cwd: "/w", pane: "3", now: now + 2 * HOUR }, db);
  expect(r).toMatchObject({ name: "x", reclaimed: true });
  expect(r.handle).not.toBe(first.handle);
  expect(db.query("SELECT COUNT(*) c FROM chat_presence").get()).toMatchObject({ c: 1 });
});

test("a live registry binding blocks reclaim even when the session heartbeat is hours old", () => {
  const db = fresh();
  mustSignIn({ sessionId: "s1", baseHandle: "x", now }, db);
  const deps = fakeBinding("idle");
  expect(mustSignIn({ sessionId: "s2", baseHandle: "x", now: now + 3 * HOUR + MIN }, db, deps).name).toBe("x-2");
});

test("a dead registry binding does not block reclaim once session-stale", () => {
  const db = fresh();
  mustSignIn({ sessionId: "s1", baseHandle: "x", now }, db);
  const r = mustSignIn({ sessionId: "s2", baseHandle: "x", now: now + 3 * HOUR + MIN }, db, NO_BINDING);
  expect(r).toMatchObject({ name: "x", reclaimed: true });
});
```

In "listBuddies: a live-binding row with a 25h-old stamp...", change the two finds to match on `name`:

```ts
  const live = buddies.find((b) => b.name === "live-stale");
  const dead = buddies.find((b) => b.name === "dead-stale");
```

In "signIn scans the registry exactly once per call...", change `expect(r.handle).toBe("x-4");` to `expect(r.name).toBe("x-4");`.

Replace "assertSessionOwnsHandle throws only on a mismatched signed handle":

```ts
test("assertSessionOwnsHandle throws only on a mismatched signed handle", () => {
  const db = fresh();
  const { handle } = mustSignIn({ sessionId: "s1", baseHandle: "x", now }, db);
  expect(() => assertSessionOwnsHandle(handle, "s1", db)).not.toThrow();
  expect(() => assertSessionOwnsHandle(handle, "s2", db)).toThrow(/handle reclaimed/);
  expect(() => assertSessionOwnsHandle("unsigned", "s2", db)).not.toThrow();
  expect(() => assertSessionOwnsHandle(handle, undefined, db)).not.toThrow();
});
```

Replace the four same-session and family tests:

```ts
test("a repeat sign-in from the same session, same base, keeps its id and name", () => {
  const db = fresh();
  const first = mustSignIn({ sessionId: "s1", baseHandle: "x", now }, db);
  const r = mustSignIn({ sessionId: "s1", baseHandle: "x", now: now + MIN }, db);
  expect(r).toMatchObject({ handle: first.handle, name: "x" });
  expect(db.query("SELECT COUNT(*) c FROM chat_presence").get()).toMatchObject({ c: 1 });
});

test("a repeat sign-in from the same session comes back to its own higher suffix rather than filling a lower gap", () => {
  const db = fresh();
  mustSignIn({ sessionId: "s0", baseHandle: "x", now }, db);
  mustSignIn({ sessionId: "s-mid", baseHandle: "x", now }, db);
  const first = mustSignIn({ sessionId: "s1", baseHandle: "x", now }, db);
  expect(first.name).toBe("x-3");
  db.run("DELETE FROM chat_presence WHERE session_id = 's-mid'");
  expect(mustSignIn({ sessionId: "s1", baseHandle: "x", now: now + MIN }, db)).toMatchObject({ handle: first.handle, name: "x-3" });
});

test("a repeat sign-in with a different base keeps the id, shows the new name, and frees the old one", () => {
  const db = fresh();
  const first = mustSignIn({ sessionId: "s1", baseHandle: "x", now }, db);
  expect(mustSignIn({ sessionId: "s1", baseHandle: "y", now: now + MIN }, db)).toMatchObject({ handle: first.handle, name: "y" });
  expect(mustSignIn({ sessionId: "s2", baseHandle: "x", now: now + 2 * MIN }, db)).toMatchObject({ name: "x", reclaimed: false });
});

test("signIn skips a display name that's held by an unrelated base family", () => {
  const db = fresh();
  mustSignIn({ sessionId: "s1", baseHandle: "x", now }, db);
  mustSignIn({ sessionId: "s2", baseHandle: "x", now }, db);
  expect(mustSignIn({ sessionId: "s3", baseHandle: "x-2", now }, db).name).toBe("x-2-2");
});

test("signIn reclaims a display name held by a reclaimable row of another family", () => {
  const db = fresh();
  mustSignIn({ sessionId: "s1", baseHandle: "x", now }, db);
  mustSignIn({ sessionId: "s2", baseHandle: "x-2", now }, db);
  const r = mustSignIn({ sessionId: "s3", baseHandle: "x-2", now: now + 2 * HOUR }, db);
  expect(r).toMatchObject({ name: "x-2", reclaimed: true });
});

test("own-seat preference: a reclaimable row with matching cwd+pane wins over an earlier lower-suffix reclaimable row", () => {
  const db = fresh();
  mustSignIn({ sessionId: "s1", baseHandle: "x", now }, db);
  mustSignIn({ sessionId: "s2", baseHandle: "x", cwd: "/other", now }, db);
  mustSignIn({ sessionId: "s3", baseHandle: "x", cwd: "/mine", pane: "7", now }, db);
  const later = now + 2 * HOUR;
  db.run("UPDATE chat_presence SET last_seen_at = ? WHERE session_id = 's1'", [later]);
  const r = mustSignIn({ sessionId: "s4", baseHandle: "x", cwd: "/mine", pane: "7", now: later }, db);
  expect(r).toMatchObject({ name: "x-3", reclaimed: true });
  expect(presenceForSession("s2", db)?.name).toBe("x-2");
});

test("the joinRoom cwd guard is scoped to unsigned handles", () => {
  const db = fresh();
  joinRoom({ room: "a", handle: "x", cwd: "/one" }, db);
  expect(() => joinRoom({ room: "b", handle: "x", cwd: "/two" }, db)).toThrow(/--as/);
  const db2 = fresh();
  const y = mustSignIn({ sessionId: "s1", baseHandle: "y", now }, db2);
  joinRoom({ room: "a", handle: y.handle, cwd: "/one" }, db2);
  expect(() => joinRoom({ room: "b", handle: y.handle, cwd: "/two" }, db2)).not.toThrow();
});

test("signIn without a base draws a pool name that no live session holds", () => {
  const db = fresh();
  const a = mustSignIn({ sessionId: "s1", now }, db);
  const b = mustSignIn({ sessionId: "s2", now }, db);
  expect(AGENT_NAMES).toContain(a.baseHandle);
  expect(AGENT_NAMES).toContain(b.baseHandle);
  expect(a.name).toBe(a.baseHandle);
  expect(a.handle).toMatch(new RegExp(`^${a.baseHandle}\\.[a-z0-9]{4}$`));
  expect(b.baseHandle).not.toBe(a.baseHandle);
});
```

Append the new tests (the two Review Focus tests are marked):

```ts
// ─── Identities ──────────────────────────────────────────────────────────────

test("a chosen name mints a new id with that display name, even when an older identity carries the name", () => {
  const db = fresh();
  const old = mintIdentity({ base: "remy", name: "remy", sessionId: "s-old", now: 1 }, db);
  const r = mustSignIn({ sessionId: "s1", baseHandle: "remy", now }, db, NO_BINDING);
  expect(r).toMatchObject({ name: "remy", baseHandle: "remy", continued: false });
  expect(r.handle).not.toBe(old.id);
  expect(identityForSession("s1", db)?.id).toBe(r.handle);
});

// Review Focus 1
test("a session whose presence row was pruned signs back in under the same id", () => {
  const db = fresh();
  const first = mustSignIn({ sessionId: "s1", now }, db, NO_BINDING);
  signOut("s1", now, db);
  expect(prunePresence(now + 25 * HOUR, db, NO_BINDING)).toBe(1);
  expect(presenceForSession("s1", db)).toBeNull();
  const again = mustSignIn({ sessionId: "s1", now: now + 25 * HOUR }, db, NO_BINDING);
  expect(again).toMatchObject({ handle: first.handle, name: first.name, baseHandle: first.baseHandle });
});

// Review Focus 1
test("a returning session keeps its id when its name was taken meanwhile, and shows a suffix instead", () => {
  const db = fresh();
  const first = mustSignIn({ sessionId: "s1", baseHandle: "remy", now }, db, NO_BINDING);
  signOut("s1", now, db);
  prunePresence(now + 25 * HOUR, db, NO_BINDING);
  const other = mustSignIn({ sessionId: "s2", baseHandle: "remy", now: now + 25 * HOUR }, db, NO_BINDING);
  expect(other.name).toBe("remy");
  expect(other.handle).not.toBe(first.handle);
  const again = mustSignIn({ sessionId: "s1", now: now + 25 * HOUR + MIN }, db, NO_BINDING);
  expect(again).toMatchObject({ handle: first.handle, name: "remy-2" });
});

// Review Focus 2
test("two connections signing in the same display name at once get remy and remy-2 under distinct ids", () => {
  const path = join(tmpdir(), `presence-race-${process.pid}-${n++}.db`);
  const one = openStateDb(path, "daemon");
  const two = openStateDb(path, "cli");
  const a = mustSignIn({ sessionId: "s1", baseHandle: "remy", now }, one, NO_BINDING);
  const b = mustSignIn({ sessionId: "s2", baseHandle: "remy", now }, two, NO_BINDING);
  expect([a.name, b.name]).toEqual(["remy", "remy-2"]);
  expect(a.handle).not.toBe(b.handle);
  for (const r of [a, b]) expect(r.handle).toMatch(/^remy\.[a-z0-9]{4}$/);
  expect(one.query("SELECT COUNT(*) AS n FROM chat_identities").get()).toEqual({ n: 2 });
});

test("a session still holding a legacy presence row keeps that handle as its id", () => {
  const db = fresh();
  db.run("INSERT INTO chat_presence (session_id, handle, base_handle, signed_in_at, last_seen_at) VALUES ('s1', 'kai-2', 'kai', ?, ?)", [now, now]);
  const r = mustSignIn({ sessionId: "s1", now: now + MIN }, db, NO_BINDING);
  expect(r).toMatchObject({ handle: "kai-2", name: "kai-2", baseHandle: "kai" });
  expect(identityForSession("s1", db)).toMatchObject({ id: "kai-2", name: "kai-2", baseName: "kai" });
});

test("presence rows carry the display name", () => {
  const db = fresh();
  mustSignIn({ sessionId: "s1", baseHandle: "remy", now }, db, NO_BINDING);
  const second = mustSignIn({ sessionId: "s2", baseHandle: "remy", now }, db, NO_BINDING);
  db.run("INSERT INTO chat_presence (session_id, handle, base_handle, signed_in_at, last_seen_at) VALUES ('s3', 'kai', 'kai', ?, ?)", [now, now]);
  expect(presenceForSession("s2", db)?.name).toBe("remy-2");
  expect(presenceForHandle(second.handle, db)?.name).toBe("remy-2");
  expect(listBuddies(now, db, NO_BINDING).map((b) => b.name).sort()).toEqual(["kai", "remy", "remy-2"]);
});

test("the pool draw skips a name a live session shows, even though its id carries a suffix", () => {
  const db = fresh();
  const remyOldest = (at: number) => Object.fromEntries(AGENT_NAMES.map((name) => [name, name === "remy" ? 0 : at]));
  setKvValue("chat", "names", remyOldest(now), db);
  expect(mustSignIn({ sessionId: "s1", now }, db, NO_BINDING).name).toBe("remy");
  setKvValue("chat", "names", remyOldest(now), db);
  expect(mustSignIn({ sessionId: "s2", now: now + MIN }, db, NO_BINDING).baseHandle).not.toBe("remy");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/state/__tests__/presence-store.test.ts`
Expected: FAIL, the rewritten tests fail on `name` (undefined) and on handles not matching `^x\.[a-z0-9]{4}$`; the pane-pin tests at the bottom still pass.

- [ ] **Step 3: Implement**

In `lib/state/presence-store.ts`:

Replace the module header with:

```ts
/**
 * lib/state/presence-store.ts: sign-in presence for `rt chat` (RT-48).
 * The only module that touches `chat_presence`; `chat_room_defaults` and
 * `chat_dms` remain chat-store.ts's and dm-store.ts's respectively, and
 * identities and display names come from identity-store.ts.
 */
```

Add the import:

```ts
import { bindIdentitySession, identityForSession, identityName, identityNames, mintIdentity, renameIdentity, type IdentityRow } from "./identity-store.ts";
```

Add `name: string;` to `PresenceRow` after `baseHandle: string;`, and make `rowToPresence` take it:

```ts
function rowToPresence(row: PresenceRawRow, name: string): PresenceRow {
  const presence: PresenceRow = {
    sessionId: row.session_id,
    handle: row.handle,
    baseHandle: row.base_handle,
    name,
    signedInAt: row.signed_in_at,
    lastSeenAt: row.last_seen_at,
  };
  if (row.cwd !== null) presence.cwd = row.cwd;
  if (row.repo !== null) presence.repo = row.repo;
  if (row.branch !== null) presence.branch = row.branch;
  if (row.pane !== null) presence.pane = row.pane;
  if (row.status_text !== null) presence.statusText = row.status_text;
  if (row.signed_out_at !== null) presence.signedOutAt = row.signed_out_at;
  return presence;
}
```

Delete `SELECT_BASE_HANDLE_ROWS_SQL` (and its comment block) and `findOpenSuffix` (and its doc comment). Add:

```ts
const SELECT_ALL_PRESENCE_SQL = `SELECT ${PRESENCE_COLUMNS} FROM chat_presence;`;
```

Replace the doc comments on `suffixOf` and `suffixToHandle` (bodies unchanged):

```ts
/** The suffix number a display name occupies within `baseHandle`'s family (`x` is 1, `x-2` is 2, ...), or null when it is not one of that family's names. */
function suffixOf(handle: string, baseHandle: string): number | null {
```

```ts
/** The display name for suffix `suffix` of `baseHandle`'s family. */
function suffixToHandle(suffix: number, baseHandle: string): string {
```

Replace the whole `signIn` function with:

```ts
export type SignInResult = { handle: string; baseHandle: string; name: string; reclaimed: boolean; continued: boolean };

type Seat = PresenceRawRow & { name: string; reclaimable: boolean };

/** Every presence row by display name. signIn deletes a reclaimable holder before reusing its name, so names are unique across chat_presence and the map drops nothing. */
function seatsByName(db: Database, sessionStaleCutoff: number, deps: RegistryDeps): Map<string, Seat> {
  const rows = db.query(SELECT_ALL_PRESENCE_SQL).all() as PresenceRawRow[];
  const names = identityNames(rows.map((row) => row.handle), db);
  const seats = new Map<string, Seat>();
  for (const row of rows) {
    const name = names.get(row.handle)!;
    seats.set(name, { ...row, name, reclaimable: isReclaimable(row, sessionStaleCutoff, deps) });
  }
  return seats;
}

/**
 * The session's own previous name when it is free; else the name of a
 * reclaimable row on the same cwd and pane (a restarted process keeps its
 * seat's name, never its id); else the lowest free or reclaimable suffix.
 */
function pickDisplayName(
  baseHandle: string,
  preferred: string | undefined,
  seat: { cwd: string | null; pane: string | null },
  seats: Map<string, Seat>,
): string {
  const free = (name: string): boolean => seats.get(name)?.reclaimable ?? true;
  if (preferred !== undefined && suffixOf(preferred, baseHandle) !== null && free(preferred)) return preferred;
  const sameSeat = [...seats.values()]
    .filter((row) => row.reclaimable && row.cwd === seat.cwd && row.pane === seat.pane && suffixOf(row.name, baseHandle) !== null)
    .sort((a, b) => suffixOf(a.name, baseHandle)! - suffixOf(b.name, baseHandle)!);
  if (sameSeat.length > 0) return sameSeat[0]!.name;
  for (let suffix = 1; ; suffix++) {
    const name = suffixToHandle(suffix, baseHandle);
    if (free(name)) return name;
  }
}

/** False when a live session other than the caller sits on `id`; a reclaimable holder is deleted so the id can be seated again. */
function claimIdentitySeat(id: string, sessionStaleCutoff: number, deps: RegistryDeps, db: Database): boolean {
  const holder = db.query(SELECT_PRESENCE_BY_HANDLE_SQL).get(id) as PresenceRawRow | null;
  if (!holder) return true;
  if (!isReclaimable(holder, sessionStaleCutoff, deps)) return false;
  db.query(DELETE_PRESENCE_BY_SESSION_SQL).run(holder.session_id);
  return true;
}

/** A presence row written before identities existed: its handle is the session's id. */
function legacyIdentity(row: PresenceRawRow): IdentityRow {
  return { id: row.handle, name: row.handle, baseName: row.base_handle, mintedAt: row.signed_in_at, sessionId: row.session_id };
}

export function signIn(
  args: {
    sessionId: string;
    baseHandle?: string;
    continueId?: string;
    cwd?: string;
    repo?: string;
    branch?: string;
    pane?: string;
    statusText?: string;
    now?: number;
  },
  db: Database = getStateDb(),
  deps: RegistryDeps = defaultRegistryDeps,
): SignInResult | undefined {
  const { sessionId, statusText } = args;
  // Defense in depth: session_id is a bare TEXT PRIMARY KEY with no NOT
  // NULL/CHECK constraint (bun:sqlite binds undefined as NULL), so a direct
  // caller must not be able to wedge a NULL-keyed row.
  if (!sessionId) throw new Error("signIn: sessionId is required");
  const cwd = args.cwd ?? null;
  const repo = args.repo ?? null;
  const branch = args.branch ?? null;
  const pane = args.pane ?? null;
  const now = args.now ?? Date.now();
  const th = presenceThresholds();
  const sessionStaleCutoff = now - th.sessionStaleMs;

  const run = db.transaction((): SignInResult => {
    // One registry scan for the whole transaction.
    const scoped = snapshotRegistryDeps(deps);
    prunePresence(now, db, scoped);

    const ownPriorRow = db.query(SELECT_PRESENCE_BY_SESSION_SQL).get(sessionId) as PresenceRawRow | null;
    if (ownPriorRow) db.query(DELETE_PRESENCE_BY_SESSION_SQL).run(sessionId);

    let identity = identityForSession(sessionId, db) ?? (ownPriorRow ? legacyIdentity(ownPriorRow) : undefined);
    if (identity && !claimIdentitySeat(identity.id, sessionStaleCutoff, scoped, db)) identity = undefined;
    const baseHandle = args.baseHandle ?? identity?.baseName ?? drawPoolName(db);

    const seats = seatsByName(db, sessionStaleCutoff, scoped);
    const name = pickDisplayName(baseHandle, identity?.name, { cwd, pane }, seats);
    const displaced = seats.get(name);
    if (displaced) db.query(DELETE_PRESENCE_BY_SESSION_SQL).run(displaced.session_id);

    let handle: string;
    if (identity) {
      handle = identity.id;
      bindIdentitySession(handle, sessionId, db);
      renameIdentity(handle, name, baseHandle, db);
    } else {
      handle = mintIdentity({ base: baseHandle, name, sessionId, now }, db).id;
    }
    db.query(INSERT_PRESENCE_SQL).run(sessionId, handle, baseHandle, cwd, repo, branch, pane, statusText ?? null, now, now);
    recordPoolNameUse(baseHandle, now, db);

    return { handle, baseHandle, name, reclaimed: displaced !== undefined, continued: false };
  });

  // A signed-in identity is not re-derivable from anything else (R057): a
  // busy connection here must retry, not warn-and-drop.
  return runCriticalWrite("signIn", () => run.immediate(), { sessionId });
}
```

Replace `SELECT_ALL_HANDLES_SQL` and `drawPoolName` with:

```ts
const SELECT_ALL_BASES_SQL = `SELECT base_handle FROM chat_presence;`;

/** Runs after the prune, so every remaining row's base counts as held: signed-out rows in their offline window included, which is exactly the buddy list. */
function drawPoolName(db: Database): string {
  const taken = (db.query(SELECT_ALL_BASES_SQL).all() as { base_handle: string }[]).map((r) => r.base_handle);
  return pickAgentName(taken, getKvValue<Record<string, number>>(NAMES_KV_NS, NAMES_KV_KEY, {}, db));
}
```

Replace the three readers:

```ts
export function listBuddies(
  now: number,
  db: Database = getStateDb(),
  deps: RegistryDeps = defaultRegistryDeps,
): Array<PresenceRow & { status: BuddyStatus }> {
  const th = presenceThresholds();
  const dayAgo = now - th.pruneMs;
  const rows = db.query(SELECT_ROSTER_SQL).all(dayAgo) as PresenceRawRow[];
  const names = identityNames(rows.map((row) => row.handle), db);
  // One registry scan for the whole roster, reused by every row's status.
  const scoped = snapshotRegistryDeps(deps);
  return rows.map((raw) => {
    const presence = rowToPresence(raw, names.get(raw.handle)!);
    return { ...presence, status: buddyStatus(presence, now, th, scoped) };
  });
}

export function presenceForHandle(handle: string, db: Database = getStateDb()): PresenceRow | null {
  const row = db.query(SELECT_PRESENCE_BY_HANDLE_SQL).get(handle) as PresenceRawRow | null;
  return row ? rowToPresence(row, identityName(row.handle, db)) : null;
}

export function presenceForSession(sessionId: string, db: Database = getStateDb()): PresenceRow | null {
  const row = db.query(SELECT_PRESENCE_BY_SESSION_SQL).get(sessionId) as PresenceRawRow | null;
  return row ? rowToPresence(row, identityName(row.handle, db)) : null;
}
```

In `lib/state/index.ts`, add `type SignInResult,` to the presence export block (after `type RegistryDeps,`).

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test lib/state/__tests__/presence-store.test.ts lib/state/__tests__/identity-store.test.ts`
Expected: PASS.
Run: `bun run typecheck`
Expected: exit 0 (the handler reads `data.handle`/`data.baseHandle`, both still present).

- [ ] **Step 5: Commit**

```bash
git add lib/state/presence-store.ts lib/state/index.ts lib/state/__tests__/presence-store.test.ts
git commit -m "state: mint chat identities on sign-in" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: A dotted legacy handle resolves and survives as a known id

Pins Review Focus 3 against what Tasks 1 to 3 built. These tests are expected to PASS on first run; if one fails, the fix belongs in `isKnownId`/`resolveHandle` (Task 2) or `freshId` (Task 1), never in a dot-parsing special case.

**Files:**
- Test: `lib/state/__tests__/identity-store.test.ts`, `lib/state/__tests__/presence-store.test.ts`

**Interfaces:**
- Consumes: `isKnownId`, `resolveHandle`, `identityName`, `mintIdentity` (Tasks 1 and 2), `signIn` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Write the tests**

Append to `lib/state/__tests__/identity-store.test.ts`:

```ts
// Review Focus 3
test("a legacy handle containing a dot resolves as itself, never as base remy plus a suffix", () => {
  const db = fresh();
  db.run("INSERT INTO chat_dms (room, a, b, created_at) VALUES ('dm-old', 'kai', 'remy.old', 1)");
  db.run("INSERT INTO chat_messages (room, handle, body, posted_at) VALUES ('dm-old', 'remy.old', 'hi', 1)");
  const live = mintIdentity({ base: "remy", name: "remy", sessionId: "s1", now: 5 }, db);
  seat(db, "s1", live.id, "remy", 5);
  expect(isKnownId("remy.old", db)).toBe(true);
  expect(resolveHandle("remy.old", db)).toBe("remy.old");
  expect(identityName("remy.old", db)).toBe("remy.old");
  expect(resolveHandle("remy", db)).toBe(live.id);
  expect(resolveHandle(live.id, db)).toBe(live.id);
});

test("a dotted legacy handle known only as a DM participant is never read as base plus suffix", () => {
  const db = fresh();
  db.run("INSERT INTO chat_dms (room, a, b, created_at) VALUES ('dm-old', 'chat.c6', 'kai', 1)");
  const remy = mintIdentity({ base: "chat", name: "chat", sessionId: "s1", now: 5 }, db);
  expect(resolveHandle("chat.c6", db)).toBe("chat.c6");
  expect(resolveHandle("chat", db)).toBe(remy.id);
});
```

Append to `lib/state/__tests__/presence-store.test.ts`:

```ts
// Review Focus 3
test("signIn never mints an id equal to a dotted legacy handle", () => {
  const db = fresh();
  const hash = (seed: string, length: number) =>
    BigInt(`0x${new Bun.CryptoHasher("sha256").update(seed).digest("hex")}`).toString(36).slice(-length);
  const legacy = `remy.${hash(`s1:${now}`, 4)}`;
  db.run("INSERT INTO chat_members (room, handle, joined_at, last_read_id, wake_on) VALUES ('r', ?, 1, 0, 'mention')", [legacy]);
  const r = mustSignIn({ sessionId: "s1", baseHandle: "remy", now }, db, NO_BINDING);
  expect(r.handle).toBe(`remy.${hash(`s1:${now}`, 6)}`);
  expect(r.name).toBe("remy");
});
```

- [ ] **Step 2: Run them**

Run: `bun test lib/state/__tests__/identity-store.test.ts lib/state/__tests__/presence-store.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/state/__tests__/identity-store.test.ts lib/state/__tests__/presence-store.test.ts
git commit -m "state: pin dotted legacy handles as known ids" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Continuation

**Files:**
- Modify: `lib/state/identity-store.ts` (`HERD_SYSTEM_ID`, `fixedIdentityRefusal`, settings import)
- Modify: `lib/state/presence-store.ts` (imports, `heldByAnotherSession`, `continuationTarget`, `signIn` identity selection, `assertSessionOwnsHandle`)
- Modify: `lib/state/index.ts` (identity export block)
- Test: `lib/state/__tests__/presence-store.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3 (`resolveHandle`, `isKnownId`, `getIdentity`, `claimIdentitySeat`, `signIn`).
- Produces: `signIn({ continueId })` semantics: continues a known identity with no live session (`continued: true`); throws `chat: handle reclaimed: "<id>" is now held by another session; sign in again` when the id is live elsewhere; throws `chat: may not continue "<x>": that handle speaks for the human` (or `: that handle is the herd's system poster`) for fixed ids; a `continueId` naming no known identity mints under that display name (`continued: false`). `fixedIdentityRefusal(x: string): string | undefined`; `HERD_SYSTEM_ID = "herdr"`.

- [ ] **Step 1: Write the failing tests**

In `lib/state/__tests__/presence-store.test.ts` add `getIdentity` to the `../identity-store.ts` import, then append:

```ts
// ─── Continuation ────────────────────────────────────────────────────────────

test("continueId continues a reservation: the session takes the reserved id and its name", () => {
  const db = fresh();
  const reserved = mintIdentity({ base: "remy", name: "remy", sessionId: null, now: 1 }, db);
  const r = mustSignIn({ sessionId: "s1", continueId: reserved.id, now }, db, NO_BINDING);
  expect(r).toMatchObject({ handle: reserved.id, name: "remy", baseHandle: "remy", continued: true });
  expect(identityForSession("s1", db)?.id).toBe(reserved.id);
});

test("continueId by name continues an offline identity and moves its binding off the old session", () => {
  const db = fresh();
  const first = mustSignIn({ sessionId: "s1", baseHandle: "remy", now }, db, NO_BINDING);
  signOut("s1", now + MIN, db);
  const r = mustSignIn({ sessionId: "s2", continueId: "remy", now: now + 2 * MIN }, db, NO_BINDING);
  expect(r).toMatchObject({ handle: first.handle, name: "remy", continued: true });
  expect(identityForSession("s1", db)).toBeUndefined();
  expect(presenceForSession("s1", db)).toBeNull();
});

test("a dead session's id can be continued (the herd:resume takeover)", () => {
  const db = fresh();
  const first = mustSignIn({ sessionId: "s1", baseHandle: "shepherd", now }, db, NO_BINDING);
  const r = mustSignIn({ sessionId: "s2", continueId: first.handle, now: now + 2 * HOUR }, db, NO_BINDING);
  expect(r).toMatchObject({ handle: first.handle, continued: true });
});

// Review Focus 5
test("continuing an id live in another session is refused with the reclaimed wording and changes nothing", () => {
  const db = fresh();
  const live = mustSignIn({ sessionId: "s1", baseHandle: "remy", now }, db, NO_BINDING);
  expect(() => signIn({ sessionId: "s2", continueId: live.handle, now: now + MIN }, db, NO_BINDING)).toThrow(
    `chat: handle reclaimed: "${live.handle}" is now held by another session; sign in again`,
  );
  expect(() => signIn({ sessionId: "s2", continueId: "remy", now: now + MIN }, db, NO_BINDING)).toThrow(/handle reclaimed/);
  expect(presenceForSession("s1", db)?.handle).toBe(live.handle);
  expect(presenceForSession("s2", db)).toBeNull();
  expect(identityForSession("s1", db)?.id).toBe(live.handle);
});

// Review Focus 5
test("continuing the human or the herd system poster is refused, whether or not either has rows yet", () => {
  const db = fresh();
  expect(() => signIn({ sessionId: "s1", continueId: "matt", now }, db, NO_BINDING)).toThrow(
    'chat: may not continue "matt": that handle speaks for the human',
  );
  expect(() => signIn({ sessionId: "s1", continueId: "herdr", now }, db, NO_BINDING)).toThrow(/herd's system poster/);
  joinRoom({ room: "r", handle: "matt" }, db);
  expect(() => signIn({ sessionId: "s1", continueId: "matt", now }, db, NO_BINDING)).toThrow(/speaks for the human/);
  expect(presenceForSession("s1", db)).toBeNull();
  expect(identityForSession("s1", db)).toBeUndefined();
});

test("a continueId that names nobody mints a fresh id with that display name", () => {
  const db = fresh();
  const r = mustSignIn({ sessionId: "s1", continueId: "newbie", now }, db, NO_BINDING);
  expect(r).toMatchObject({ name: "newbie", baseHandle: "newbie", continued: false });
  expect(r.handle).toMatch(/^newbie\.[a-z0-9]{4}$/);
});

// Review Focus 3 and 5
test("continuing a legacy handle, dotted or not, keeps it as the id", () => {
  const db = fresh();
  db.run("INSERT INTO chat_members (room, handle, joined_at, last_read_id, wake_on) VALUES ('r', 'kai', 1, 0, 'mention'), ('r', 'remy.old', 1, 0, 'mention')");
  expect(mustSignIn({ sessionId: "s1", continueId: "kai", now }, db, NO_BINDING)).toMatchObject({ handle: "kai", name: "kai", continued: true });
  expect(mustSignIn({ sessionId: "s2", continueId: "remy.old", now }, db, NO_BINDING)).toMatchObject({ handle: "remy.old", name: "remy.old", continued: true });
  expect(getIdentity("remy.old", db)).toMatchObject({ name: "remy.old", baseName: "remy.old", sessionId: "s2" });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/state/__tests__/presence-store.test.ts`
Expected: FAIL, `signIn` ignores `continueId`: the reservation test gets a fresh id, the refusal tests do not throw.

- [ ] **Step 3: Add the fixed-identity refusal to identity-store**

In `lib/state/identity-store.ts` add the import:

```ts
import { getSetting } from "../settings/resolve.ts";
```

and, after `isKnownId`:

```ts
/** Parity: lib/daemon/handlers/herd.ts SYSTEM_HANDLE. Fixed like the human's handle: never minted, never continued. */
export const HERD_SYSTEM_ID = "herdr";

/** Why `x` can never be continued by an agent session, or undefined when it can. */
export function fixedIdentityRefusal(x: string): string | undefined {
  if (x === getSetting<string>("chat.humanHandle").value) return "that handle speaks for the human";
  if (x === HERD_SYSTEM_ID) return "that handle is the herd's system poster";
  return undefined;
}
```

In `lib/state/index.ts` add `fixedIdentityRefusal,` and `HERD_SYSTEM_ID,` to the identity export block.

- [ ] **Step 4: Wire continuation into signIn**

In `lib/state/presence-store.ts`, change the chat-names and identity imports to:

```ts
import { AGENT_NAMES, baseOfHandle, pickAgentName } from "../chat-names.ts";
import {
  bindIdentitySession,
  fixedIdentityRefusal,
  getIdentity,
  identityForSession,
  identityName,
  identityNames,
  isKnownId,
  mintIdentity,
  renameIdentity,
  resolveHandle,
  type IdentityRow,
} from "./identity-store.ts";
```

Add, above `signIn`:

```ts
function heldByAnotherSession(handle: string): Error {
  return new Error(`chat: handle reclaimed: "${handle}" is now held by another session; sign in again`);
}

/** The identity `continueId` names, or, when it names no known identity, the display name to mint under (`--as newname` has nothing to continue). */
function continuationTarget(continueId: string, db: Database): IdentityRow | string {
  const id = resolveHandle(continueId, db);
  for (const x of [continueId, id]) {
    const refusal = fixedIdentityRefusal(x);
    if (refusal) throw new Error(`chat: may not continue ${JSON.stringify(x)}: ${refusal}`);
  }
  if (!isKnownId(id, db)) return id;
  return getIdentity(id, db) ?? { id, name: id, baseName: baseOfHandle(id), mintedAt: 0, sessionId: null };
}
```

In `signIn`'s transaction, replace the three lines from `let identity = ...` through `const baseHandle = ...` with:

```ts
    const target = args.continueId === undefined ? undefined : continuationTarget(args.continueId, db);
    const continued = typeof target === "object";
    if (continued && !claimIdentitySeat(target.id, sessionStaleCutoff, scoped, db)) throw heldByAnotherSession(target.id);
    let identity: IdentityRow | undefined = continued
      ? target
      : (identityForSession(sessionId, db) ?? (ownPriorRow ? legacyIdentity(ownPriorRow) : undefined));
    if (!continued && identity && !claimIdentitySeat(identity.id, sessionStaleCutoff, scoped, db)) identity = undefined;
    const requestedBase = typeof target === "string" ? target : args.baseHandle;
    const baseHandle = continued ? target.baseName : (requestedBase ?? identity?.baseName ?? drawPoolName(db));
```

and change the return line to:

```ts
    return { handle, baseHandle, name, reclaimed: displaced !== undefined, continued };
```

Replace the throw in `assertSessionOwnsHandle`:

```ts
  if (row.session_id !== sessionId) throw heldByAnotherSession(handle);
```

- [ ] **Step 5: Run them to verify they pass**

Run: `bun test lib/state/__tests__/presence-store.test.ts lib/state/__tests__/identity-store.test.ts`
Expected: PASS.
Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/state/identity-store.ts lib/state/presence-store.ts lib/state/index.ts lib/state/__tests__/presence-store.test.ts
git commit -m "state: continue a chat identity explicitly on sign-in" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Grow the name pool to 1,000

**Files:**
- Modify: `lib/chat-names.ts:1-39` (doc comment and `AGENT_NAMES`)
- Test: `lib/__tests__/chat-names.test.ts`, `lib/state/__tests__/presence-store.test.ts` (LRU test timeout)

**Interfaces:**
- Consumes: nothing.
- Produces: `AGENT_NAMES` with exactly 1,000 entries, each `/^[a-z]{3,6}$/`, no duplicates; the original 253 keep their order at the head; `pickAgentName` and `baseOfHandle` unchanged.

- [ ] **Step 1: Write the failing test**

In `lib/__tests__/chat-names.test.ts`, replace the `describe("AGENT_NAMES", ...)` block with:

```ts
describe("AGENT_NAMES", () => {
  test("a thousand short, bare, valid chat names, none repeated", () => {
    expect(AGENT_NAMES.length).toBeGreaterThanOrEqual(1000);
    expect(new Set(AGENT_NAMES).size).toBe(AGENT_NAMES.length);
    for (const n of AGENT_NAMES) expect(n).toMatch(/^[a-z]{3,6}$/);
  });

  test("no fixed or reserved handle is in the pool", () => {
    for (const reserved of ["matt", "here", "herdr", "shepherd"]) expect(AGENT_NAMES).not.toContain(reserved);
  });

  test("no name reads as a suffixed display name", () => {
    for (const n of AGENT_NAMES) expect(baseOfHandle(n)).toBe(n);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test lib/__tests__/chat-names.test.ts`
Expected: FAIL, `expect(AGENT_NAMES.length).toBeGreaterThanOrEqual(1000)` receives 253.

- [ ] **Step 3: Replace the pool**

In `lib/chat-names.ts`, replace everything from the top doc comment through the closing `];` of `AGENT_NAMES` with:

```ts
/**
 * The pool `rt chat sign-in` draws an agent's display name from when nothing
 * names it explicitly. Short, common first names, so a human can say "ask
 * fred" and an agent can call itself fred. Every entry is 3 to 6 lowercase
 * letters, so a `-2` display suffix stays legible and no entry reads as one.
 *
 * The draw is least-recently-used over names no live session holds, so a
 * name comes back only after every other name has been drawn once.
 */
export const AGENT_NAMES: readonly string[] = [
  "ada", "abe", "alan", "alex", "alma", "amos", "amy", "andy", "ann", "anya",
  "aria", "arlo", "ava", "axel", "bart", "bea", "beck", "ben", "beth", "bill",
  "blair", "bob", "bram", "bree", "bruno", "bryn", "cal", "cam", "carl", "cass",
  "chad", "chip", "chloe", "clay", "cleo", "clem", "cody", "cole", "cora", "cruz",
  "cyrus", "dale", "dan", "dario", "dave", "dawn", "dean", "dee", "del", "desi",
  "dex", "dina", "dirk", "don", "dot", "doug", "drew", "duke", "earl", "edie",
  "eli", "ella", "elmo", "elsa", "emma", "enzo", "erin", "esme", "ethan", "eva",
  "eve", "ezra", "fay", "felix", "fern", "fin", "fiona", "flo", "fox", "fred",
  "gabe", "gail", "gary", "gene", "gil", "gina", "glen", "greg", "greta", "gus",
  "gwen", "hal", "hana", "hank", "hart", "hattie", "hazel", "heidi", "holly", "hope",
  "hugo", "ida", "ike", "ines", "iris", "isla", "ivy", "jack", "jane", "jasper",
  "jax", "jay", "jed", "jen", "jess", "jill", "jim", "jodi", "joe", "jon",
  "josh", "joy", "jude", "jules", "june", "kai", "kara", "kat", "kay", "kent",
  "kim", "kit", "kurt", "kyle", "lana", "lara", "lars", "lee", "len", "leo",
  "levi", "lex", "lil", "liz", "lola", "lorna", "lou", "lucy", "luke", "lyle",
  "mae", "mark", "mary", "max", "maya", "meg", "mel", "mia", "mike", "milo",
  "moe", "mona", "nadia", "nat", "ned", "nell", "nia", "nick", "noah", "noel",
  "nora", "odin", "olga", "oli", "omar", "opal", "oscar", "otis", "otto", "owen",
  "pam", "pat", "paul", "pearl", "penny", "pete", "phil", "pia", "pip", "quin",
  "rafa", "ray", "reg", "remy", "rene", "rex", "rhea", "rico", "rita", "rob",
  "ron", "rosa", "ross", "roy", "ruby", "russ", "ruth", "ryan", "sage", "sal",
  "sam", "sara", "sean", "seth", "shay", "sid", "sky", "sofia", "stan", "sue",
  "tad", "tamsin", "tara", "tess", "theo", "thora", "tim", "tina", "toby", "todd",
  "tom", "toni", "tyra", "ulla", "uma", "val", "vera", "vic", "viola", "wade",
  "walt", "wanda", "wes", "will", "wren", "xavi", "yuki", "yusuf", "zara", "zed",
  "zelda", "zia", "zoe", "aaron", "abby", "abel", "abram", "ace", "adam", "addie",
  "adele", "adrian", "agnes", "ahmed", "aida", "aiden", "aimee", "aisha", "ajay", "akira",
  "alba", "albert", "alden", "aldo", "alec", "alexa", "alfie", "alfred", "ali", "alice",
  "alina", "alisa", "alison", "allen", "ally", "alvin", "amara", "amber", "amelia", "amir",
  "ana", "andre", "andrea", "angel", "angela", "angie", "anita", "anna", "anne", "annie",
  "anson", "anton", "april", "archie", "ariel", "arjun", "arnav", "arnie", "arthur", "asa",
  "ash", "asher", "ashley", "astrid", "aubrey", "audrey", "august", "aura", "austin", "avery",
  "ayla", "bailey", "barb", "barry", "basil", "baxter", "becca", "bella", "belle", "benny",
  "bernie", "bert", "beryl", "bess", "betsy", "betty", "bianca", "billy", "blake", "bonnie",
  "boyd", "brad", "brady", "brenda", "brent", "brett", "brian", "brock", "brody", "brooke",
  "bruce", "bryce", "burt", "byron", "caleb", "callie", "calvin", "camila", "carla", "carlos",
  "carly", "carmen", "carol", "carrie", "carter", "casey", "cathy", "cecil", "cedric", "celia",
  "chan", "chang", "chase", "cher", "chet", "chris", "chuck", "ciara", "cindy", "claire",
  "clara", "clare", "clark", "claude", "cliff", "clint", "clive", "clyde", "colin", "conor",
  "connie", "corey", "craig", "curt", "cybil", "cyril", "daisy", "dakota", "damon", "dana",
  "daniel", "danny", "daria", "darla", "darren", "daryl", "david", "davis", "dawson", "debby",
  "della", "delia", "denis", "denny", "derek", "devin", "dewey", "diana", "diane", "diego",
  "dixie", "dolly", "donna", "dora", "doris", "drake", "duane", "dudley", "duncan", "dustin",
  "dwight", "dylan", "eamon", "eddie", "edgar", "edith", "edna", "edwin", "effie", "eileen",
  "elaine", "elena", "eliza", "ellen", "ellie", "elliot", "eloise", "elroy", "elvis", "emil",
  "emily", "emmet", "enid", "enoch", "eric", "erica", "ernie", "esther", "ettie", "eunice",
  "evan", "evie", "ewan", "faith", "farah", "faye", "fergus", "finn", "fletch", "flora",
  "floyd", "flynn", "frank", "franny", "freda", "freddy", "frida", "gavin", "gemma", "george",
  "gerald", "gia", "gideon", "gigi", "gilda", "ginny", "giles", "gino", "gladys", "glenda",
  "gloria", "goldie", "gordon", "grace", "grady", "grant", "greer", "gregor", "guy", "hailey",
  "hamza", "hanna", "hannah", "harley", "harold", "harper", "harry", "harvey", "hassan", "hayden",
  "hector", "helen", "helga", "henry", "hilda", "hilary", "homer", "honor", "howard", "hudson",
  "hugh", "hunter", "ian", "igor", "ilsa", "imani", "imogen", "ingrid", "irene", "irma",
  "irving", "isaac", "isaiah", "ismael", "ivan", "izzy", "jackie", "jacob", "jade", "jai",
  "jaime", "jake", "jalen", "james", "jamie", "janet", "janice", "jared", "jason", "javier",
  "jean", "jeff", "jenna", "jerry", "jesse", "jewel", "jin", "joan", "joanne", "jodie",
  "joel", "joey", "john", "johnny", "jolene", "jonah", "jordan", "jose", "joseph", "josie",
  "joyce", "juan", "judith", "judy", "julia", "julian", "julie", "junior", "justin", "kaia",
  "kaleb", "kane", "karen", "karl", "karin", "kate", "katie", "kaya", "keanu", "keira",
  "keith", "kelly", "kelsey", "ken", "kendra", "kenji", "kenny", "kerry", "kevin", "khalid",
  "kian", "kiera", "kira", "kirk", "kitty", "klaus", "kofi", "kris", "kristy", "kya",
  "lacey", "laila", "lance", "landon", "lane", "laura", "lauren", "laurie", "lawson", "layla",
  "leah", "leila", "lena", "leon", "leona", "leroy", "lester", "lewis", "liam", "lila",
  "lily", "linda", "lindy", "lionel", "lisa", "livia", "lloyd", "logan", "lois", "lonnie",
  "lorena", "louie", "louis", "luca", "lucas", "lucia", "luis", "luna", "lydia", "lynn",
  "mabel", "mack", "macy", "madge", "maeve", "maggie", "malia", "malik", "mandy", "manny",
  "marco", "marcus", "margo", "maria", "marie", "marina", "mario", "marisa", "marla", "marlon",
  "martha", "marty", "marvin", "mason", "matteo", "maude", "maura", "mavis", "maxine", "mckay",
  "megan", "melody", "mercy", "mervin", "micah", "miles", "millie", "milton", "mimi", "mina",
  "mindy", "minnie", "miriam", "misty", "mitch", "molly", "monty", "morgan", "morris", "moses",
  "muriel", "myles", "myra", "nancy", "naomi", "nash", "nate", "neil", "nellie", "nelson",
  "nestor", "nigel", "nikki", "nina", "nolan", "norma", "norman", "nova", "olive", "oliver",
  "olivia", "ollie", "orion", "orla", "orson", "ozzie", "paige", "paloma", "pansy", "parker",
  "patty", "paula", "pedro", "peggy", "percy", "perry", "peter", "petra", "phoebe", "piper",
  "polly", "porter", "posey", "priya", "quincy", "quinn", "rachel", "raj", "ralph", "ramon",
  "randy", "raquel", "raven", "reba", "reed", "reese", "regan", "reid", "remi", "rena",
  "reuben", "rhoda", "rhys", "ricky", "riley", "rio", "robin", "rocco", "rocky", "rodney",
  "roger", "rohan", "roland", "rolf", "roman", "romy", "ronan", "ronny", "rory", "rose",
  "rosie", "rowan", "roxy", "rudy", "rufus", "rupert", "ruthie", "ryder", "sabine", "sadie",
  "sally", "salma", "sammy", "sandy", "santi", "sasha", "saul", "scott", "selma", "serena",
  "shane", "shari", "shawn", "sheila", "shelby", "sheri", "sienna", "silas", "simon", "sione",
  "skye", "sonia", "sonny", "sophie", "spike", "stacy", "stella", "steve", "stuart", "sunny",
  "susan", "suzy", "sven", "sybil", "sylvia", "tabby", "talia", "tammy", "tania", "tanner",
  "tasha", "tate", "teddy", "terry", "thea", "thelma", "tilly", "timmy", "tobias", "tomas",
  "tony", "tracy", "travis", "trent", "trevor", "troy", "trudy", "tucker", "tyler", "ursula",
  "vance", "vaughn", "vern", "vicky", "victor", "vince", "vinny", "violet", "vivian", "wally",
  "walter", "warren", "wendy", "wiley", "willa", "willie", "wilma", "wolf", "wyatt", "xander",
  "xena", "yara", "yasmin", "yvette", "yvonne", "zach", "zack", "zane", "zion", "zoey",
  "zola", "abdul", "adina", "afton", "agatha", "alaina", "alani", "alder", "aldous", "aleta",
  "alia", "alvaro", "amani", "amina", "amira", "amya", "anders", "anika", "anneke", "ansel",
  "arden", "ari", "arlen", "arne", "aron", "arturo", "ashton", "aspen", "athena", "aubree",
  "auden", "avi", "axton", "aya", "azra", "basia", "beau", "benji", "bettie", "birdie",
  "bjorn", "blythe", "bodhi", "bonita", "booker", "boris", "brandi", "brandt", "briar", "britt",
  "bronte", "cara", "carina", "carys", "casper", "chaim", "chana", "chaya", "chiara", "cian",
  "clancy", "cleve", "clovis", "colby", "colm", "cooper", "cosmo", "dahlia", "dalia", "damian",
  "dante", "darby", "darcy", "darius", "dasha", "davey", "dayna", "delphi", "demi", "deon",
  "dilys", "dinah", "dion", "donal", "donny", "dovie", "dulce", "dusty", "easton", "eden",
  "edmund", "efrain", "eiko", "elias", "elisa", "elise", "ellis", "elodie", "eloy", "elton",
  "emery", "emrys", "enya", "erik", "ernst", "eshan", "ester", "ethel", "etta", "evelyn",
  "ezio", "fabian", "fallon", "farid", "fatima", "fawn", "felipe", "fenn", "fidel", "filip",
];
```

- [ ] **Step 4: Give the full-pool LRU test room**

In `lib/state/__tests__/presence-store.test.ts`, the test "the draw is least-recently-used: every name goes once before any comes back" now signs in 1,001 times. Change its closing `});` to `}, 30_000);`.

- [ ] **Step 5: Run them to verify they pass**

Run: `bun test lib/__tests__/chat-names.test.ts lib/state/__tests__/presence-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/chat-names.ts lib/__tests__/chat-names.test.ts lib/state/__tests__/presence-store.test.ts
git commit -m "chat: grow the agent name pool to 1,000" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: reserveAgentHandle mints the reservation

**Files:**
- Modify: `lib/state/presence-store.ts` (`reserveAgentHandle`)
- Test: `lib/state/__tests__/presence-store.test.ts`

**Interfaces:**
- Consumes: `mintIdentity` (Task 1), continuation (Task 5).
- Produces: `reserveAgentHandle(db?, now?): string` returns an id with an unbound `chat_identities` row (`sessionId: null`, `name === baseName`, a pool name); the agent's sign-in passes it as `continueId`.

- [ ] **Step 1: Write the failing tests**

Add `reserveAgentHandle` to the presence-store import in `lib/state/__tests__/presence-store.test.ts`, then append:

```ts
test("reserveAgentHandle mints an unbound identity under a drawn pool name and returns its id", () => {
  const db = fresh();
  const id = reserveAgentHandle(db, now);
  const row = getIdentity(id, db)!;
  expect(AGENT_NAMES).toContain(row.baseName);
  expect(row).toMatchObject({ name: row.baseName, sessionId: null, mintedAt: now });
  expect(id).toMatch(new RegExp(`^${row.baseName}\\.[a-z0-9]{4}$`));
  expect(getKvValue<Record<string, number>>("chat", "names", {}, db)[row.baseName]).toBe(now);
  expect(getIdentity(reserveAgentHandle(db, now), db)!.baseName).not.toBe(row.baseName);
});

test("an agent signing in with its reservation takes the reserved id and name", () => {
  const db = fresh();
  const id = reserveAgentHandle(db, now);
  const r = mustSignIn({ sessionId: "s1", continueId: id, now: now + MIN }, db, NO_BINDING);
  expect(r).toMatchObject({ handle: id, name: getIdentity(id, db)!.name, continued: true });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/state/__tests__/presence-store.test.ts`
Expected: FAIL, `getIdentity(id, db)` is undefined because `reserveAgentHandle` returns a bare name with no identity row.

- [ ] **Step 3: Implement**

Replace `reserveAgentHandle` in `lib/state/presence-store.ts`:

```ts
/**
 * Mints the identity for an agent that has not signed in yet (`rt agent
 * start`) under a pool name drawn against the same held set and LRU ledger
 * `signIn` uses, and records the draw at once, so a second reservation or a
 * racing sign-in does not also land on the name. Returns the id; the agent's
 * sign-in continues it.
 */
export function reserveAgentHandle(db: Database = getStateDb(), now: number = Date.now()): string {
  const run = db.transaction((): string => {
    const name = drawPoolName(db);
    recordPoolNameUse(name, now, db);
    return mintIdentity({ base: name, name, sessionId: null, now }, db).id;
  });
  // BEGIN IMMEDIATE: read-then-write must lock up front or SQLITE_BUSY_SNAPSHOT
  // bypasses busy_timeout (same reason as signIn's).
  return run.immediate();
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test lib/state/__tests__/presence-store.test.ts`
Expected: PASS (including "C9: reserveAgentHandle's read-then-write transaction also uses .immediate()").

- [ ] **Step 5: Commit**

```bash
git add lib/state/presence-store.ts lib/state/__tests__/presence-store.test.ts
git commit -m "state: reserve agent handles as unbound identities" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Remove the pane pin

**Files:**
- Modify: `lib/state/presence-store.ts` (delete `PANE_HANDLES_NS`, `PANE_HANDLE_CAP`, `paneHandleFor`, `rememberPaneHandle`; trim the kv import)
- Modify: `lib/state/index.ts` (drop two exports)
- Modify: `lib/daemon/handlers/chat.ts:33-34, 1150-1155, 1161` (delete call sites only)
- Modify: `commands/chat.ts:56, 279-280, 284-294` (delete call sites only)
- Test: `lib/state/__tests__/presence-store.test.ts`, `commands/__tests__/chat.test.ts`

**Interfaces:**
- Consumes: Task 3's `signIn`.
- Produces: no `paneHandleFor`/`rememberPaneHandle` anywhere; `chat_pane_handles` kv rows are left in place and never read.

- [ ] **Step 1: Write the failing tests**

In `lib/state/__tests__/presence-store.test.ts`, delete the three pane-pin tests ("rememberPaneHandle round-trips...", "the pane-handle ledger caps...", "re-pinning an old pane survives..."), remove `paneHandleFor` and `rememberPaneHandle` from the presence-store import, and change `import { expect, spyOn, test } from "bun:test";` to `import { expect, test } from "bun:test";`. Append:

```ts
test("a new session in the same pane draws a fresh name under a new id", () => {
  const db = fresh();
  const first = mustSignIn({ sessionId: "s1", cwd: "/w", pane: "wAR:p3", now }, db, NO_BINDING);
  signOut("s1", now, db);
  const next = mustSignIn({ sessionId: "s2", cwd: "/w", pane: "wAR:p3", now: now + MIN }, db, NO_BINDING);
  expect(next.handle).not.toBe(first.handle);
  expect(next.baseHandle).not.toBe(first.baseHandle);
});

test("the pane-pin API is gone from the state barrel", async () => {
  const barrel = await import("../index.ts");
  expect("paneHandleFor" in barrel).toBe(false);
  expect("rememberPaneHandle" in barrel).toBe(false);
});
```

In `commands/__tests__/chat.test.ts`, delete the two tests "a herdr pane redraws its earlier pool handle even after a fresh session signs in" and "resolveSignInBaseHandle: a pane pin beats the pool draw but loses to chat.handle and --as", and change line 31 to:

```ts
import { getStateDb, closeStateDb, type RegistryDeps } from "../../lib/state/index.ts";
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test lib/state/__tests__/presence-store.test.ts`
Expected: FAIL, "the pane-pin API is gone from the state barrel" finds `paneHandleFor` exported.

- [ ] **Step 3: Delete the pin**

In `lib/state/presence-store.ts`, delete the block from `const PANE_HANDLES_NS = "chat_pane_handles";` through the end of `rememberPaneHandle`, and change the kv import to:

```ts
import { getKvValue, setKvValue } from "./kv-blob.ts";
```

In `lib/state/index.ts`, delete the `paneHandleFor,` and `rememberPaneHandle,` lines from the presence export block.

In `lib/daemon/handlers/chat.ts`, delete `paneHandleFor,` and `rememberPaneHandle,` from the state import (lines 33-34), delete this block (lines 1150-1155):

```ts
      // Consulted only after --as / chat.handle (both already folded into
      // baseHandle client-side) and the registry's user-chosen name, so every
      // explicit choice still wins: a pane that once drew a pool name redraws it.
      if (resolvedBase === undefined && pane) {
        const pinned = paneHandleFor(pane, db);
        if (pinned && isValidChatName(pinned)) resolvedBase = pinned;
      }
```

and delete this line (1161):

```ts
      if (pane) rememberPaneHandle(pane, data.baseHandle, db);
```

In `commands/chat.ts`, change line 56 to:

```ts
import { isValidChatName, pruneMessages, getStateDb } from "../lib/state/index.ts";
```

delete these two lines from `resolveSignInBaseHandle`:

```ts
  const pinned = readPaneHandlePin();
  if (pinned) return pinned;
```

and delete the whole `readPaneHandlePin` function with its doc comment.

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test lib/state/__tests__/presence-store.test.ts`
Expected: PASS.
Run: `bun run typecheck`
Expected: exit 0.
Run: `git grep -n "paneHandleFor\|rememberPaneHandle\|readPaneHandlePin" -- lib commands`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add lib/state/presence-store.ts lib/state/index.ts lib/state/__tests__/presence-store.test.ts lib/daemon/handlers/chat.ts commands/chat.ts commands/__tests__/chat.test.ts
git commit -m "chat: drop the pane handle pin" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Your own messages are never unread

**Files:**
- Modify: `lib/state/chat-store.ts` (`SELECT_UNREAD_SQL`, `readUnread`, `peekUnread`)
- Test: `lib/state/__tests__/chat-store.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `peekUnread` and `readUnread` (cursor-bound read) never return messages whose `handle` is the reader; `readUnread` still advances the cursor to the highest id it returned. The `sinceMs` window and `listRooms`' counts are unchanged.

- [ ] **Step 1: Write the failing tests**

In `lib/state/__tests__/chat-store.test.ts`, add `peekUnread,` to the `../chat-store.ts` import, then append:

```ts
test("peekUnread never shows the reader its own messages", () => {
  const db = freshDb();
  joinRoom({ room: "r", handle: "a" }, db);
  joinRoom({ room: "r", handle: "b" }, db);
  postMessage({ room: "r", handle: "b", body: "which branch?" }, db);
  postMessage({ room: "r", handle: "a", body: "picker" }, db);
  expect(peekUnread({ handle: "a", limit: 20 }, db).map((r) => r.messages.map((m) => m.body))).toEqual([["which branch?"]]);
});

test("readUnread skips the reader's own messages and advances past what it showed", () => {
  const db = freshDb();
  joinRoom({ room: "r", handle: "a" }, db);
  joinRoom({ room: "r", handle: "b" }, db);
  postMessage({ room: "r", handle: "b", body: "q1" }, db);
  postMessage({ room: "r", handle: "a", body: "mine" }, db);
  postMessage({ room: "r", handle: "b", body: "q2" }, db);
  expect(readUnread({ handle: "a", limit: 20 }, db)[0]!.messages.map((m) => m.body)).toEqual(["q1", "q2"]);
  expect(readUnread({ handle: "a", limit: 20 }, db)).toEqual([]);
});

test("a room whose only backlog is the reader's own posts has nothing unread", () => {
  const db = freshDb();
  joinRoom({ room: "r", handle: "a" }, db);
  postMessage({ room: "r", handle: "a", body: "notes to self" }, db);
  expect(peekUnread({ handle: "a", limit: 20 }, db)).toEqual([]);
  expect(readUnread({ handle: "a", limit: 20 }, db)).toEqual([]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/state/__tests__/chat-store.test.ts`
Expected: FAIL, the peeks and reads include "picker", "mine" and "notes to self".

- [ ] **Step 3: Implement**

In `lib/state/chat-store.ts` replace `SELECT_UNREAD_SQL`:

```ts
const SELECT_UNREAD_SQL = `SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE room = ? AND id > ? AND handle <> ? ORDER BY id ASC LIMIT ?;`;
```

In `readUnread`, change the cursor-bound query to:

```ts
          : db.query(SELECT_UNREAD_SQL).all(member.room, cursor, handle, limit)
```

In `peekUnread`, change its query to:

```ts
    const rows = db.query(SELECT_UNREAD_SQL).all(member.room, cursor, handle, limit) as MessageRow[];
```

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test lib/state/__tests__/chat-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/state/chat-store.ts lib/state/__tests__/chat-store.test.ts
git commit -m "chat: never show a reader its own messages as unread" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Names on messages and members; mentions stored as ids

**Files:**
- Modify: `lib/state/chat-store.ts` (import, `ChatMember`, `rowToMember`, `ChatMessage`, `rowToMessage`, new `toMessages`, `listMembers`, `postMessage`, `readUnread`, `peekUnread`, `listMessages`, `pendingMessages`)
- Test: `lib/state/__tests__/chat-store.test.ts`

**Interfaces:**
- Consumes: `identityNames`, `resolveHandle` (Tasks 1 and 2); `signIn` (Task 3) in tests.
- Produces: `ChatMessage.name: string`, `ChatMessage.mentionNames: string[]` (parallel to `mentions`); `ChatMember.name: string`; `postMessage` stores every mention (parsed from the body or passed explicitly) as `resolveHandle(mention)`, deduplicated, so `recipients` are ids.

- [ ] **Step 1: Write the failing tests**

In `lib/state/__tests__/chat-store.test.ts` add these imports:

```ts
import { mintIdentity } from "../identity-store.ts";
import { signIn, type RegistryDeps } from "../presence-store.ts";
```

and below `freshDb`:

```ts
const NO_BINDING: RegistryDeps = { resolve: () => null, alive: () => false, resolveAll: () => new Map() };
```

Append:

```ts
test("messages carry the author's display name and mention names parallel to mentions", () => {
  const db = freshDb();
  const remy = mintIdentity({ base: "remy", name: "remy", sessionId: "s1", now: 1 }, db);
  joinRoom({ room: "r", handle: remy.id }, db);
  joinRoom({ room: "r", handle: "kai" }, db);
  postMessage({ room: "r", handle: remy.id, body: "@kai over to you, @here too" }, db);
  const [m] = listMessages({ room: "r", limit: 5 }, db);
  expect(m).toMatchObject({ handle: remy.id, name: "remy", mentions: ["kai", "here"], mentionNames: ["kai", "here"] });
  const [unread] = readUnread({ handle: "kai", limit: 5 }, db);
  expect(unread!.messages[0]).toMatchObject({ name: "remy" });
});

test("a body mention of a live display name is stored as that session's id and wakes it, not an older identity with the name", () => {
  const db = freshDb();
  const old = mintIdentity({ base: "remy", name: "remy", sessionId: "s-old", now: 1 }, db);
  const live = signIn({ sessionId: "s-new", baseHandle: "remy", now: 2 }, db, NO_BINDING)!;
  expect(live.name).toBe("remy");
  for (const handle of [old.id, live.handle, "kai"]) joinRoom({ room: "r", handle }, db);
  const posted = postMessage({ room: "r", handle: "kai", body: "@remy ping" }, db)!;
  expect(posted.recipients).toEqual([live.handle]);
  const [m] = listMessages({ room: "r", limit: 5 }, db);
  expect(m).toMatchObject({ mentions: [live.handle], mentionNames: ["remy"] });
});

test("an explicit mention by name and by id collapse to one stored id", () => {
  const db = freshDb();
  const remy = mintIdentity({ base: "remy", name: "remy", sessionId: "s1", now: 1 }, db);
  joinRoom({ room: "r", handle: remy.id }, db);
  joinRoom({ room: "r", handle: "kai" }, db);
  postMessage({ room: "r", handle: "kai", body: "ping", mentions: ["remy", remy.id] }, db);
  expect(listMessages({ room: "r", limit: 5 }, db)[0]!.mentions).toEqual([remy.id]);
});

test("members carry display names; a legacy handle is its own name", () => {
  const db = freshDb();
  const remy = mintIdentity({ base: "remy", name: "remy-2", sessionId: "s1", now: 1 }, db);
  joinRoom({ room: "r", handle: remy.id }, db);
  joinRoom({ room: "r", handle: "kai" }, db);
  expect(listMembers("r", db).map((m) => [m.handle, m.name]).sort()).toEqual([[remy.id, "remy-2"], ["kai", "kai"]].sort());
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/state/__tests__/chat-store.test.ts`
Expected: FAIL, `name` and `mentionNames` are undefined; the live-name test's recipients are `[]` because `remy` was stored raw.

- [ ] **Step 3: Implement**

In `lib/state/chat-store.ts` add the import:

```ts
import { identityNames, resolveHandle } from "./identity-store.ts";
```

Add `name: string;` to `ChatMember` after `handle: string;`, and replace `rowToMember`:

```ts
function rowToMember(row: MemberRow, name: string): ChatMember {
  const member: ChatMember = {
    room: row.room,
    handle: row.handle,
    name,
    joinedAt: row.joined_at,
    lastReadId: row.last_read_id,
    wakeOn: row.wake_on,
  };
  if (row.cwd !== null) member.cwd = row.cwd;
  if (row.pane !== null) member.pane = row.pane;
  return member;
}
```

In `ChatMessage`, add after `handle: string;`:

```ts
  /** The author's display name. */
  name: string;
```

and after `mentions: string[];`:

```ts
  /** Display names parallel to `mentions`. */
  mentionNames: string[];
```

Replace `rowToMessage` with:

```ts
function rowToMessage(row: MessageRow, mentions: string[], names: Map<string, string>): ChatMessage {
  const message: ChatMessage = {
    id: row.id,
    room: row.room,
    handle: row.handle,
    name: names.get(row.handle)!,
    body: row.body,
    mentions,
    mentionNames: mentions.map((m) => names.get(m)!),
    postedAt: row.posted_at,
  };
  if (row.reply_to !== null) message.replyTo = row.reply_to;
  if (row.quiet) message.quiet = true;
  return message;
}

/** One name lookup for every author and mention in `rows`. */
function toMessages(rows: MessageRow[], db: Database): ChatMessage[] {
  const parsed = rows.map((row) => ({ row, mentions: row.mentions ? (JSON.parse(row.mentions) as string[]) : [] }));
  const names = identityNames(parsed.flatMap(({ row, mentions }) => [row.handle, ...mentions]), db);
  return parsed.map(({ row, mentions }) => rowToMessage(row, mentions, names));
}
```

Replace `listMembers`:

```ts
export function listMembers(room: string, db: Database = getStateDb()): ChatMember[] {
  const rows = db.query(SELECT_ROOM_MEMBERS_SQL).all(room) as MemberRow[];
  const names = identityNames(rows.map((row) => row.handle), db);
  return rows.map((row) => rowToMember(row, names.get(row.handle)!));
}
```

Replace `postMessage`:

```ts
export function postMessage(
  args: { room: string; handle: string; body: string; mentions?: string[]; quiet?: boolean },
  db: Database = getStateDb(),
): { id: number; recipients: string[] } | undefined {
  const { room, handle, body, quiet } = args;

  const run = db.transaction((): { id: number; recipients: string[] } => {
    const now = Date.now();
    const mentions = [...new Set(mergeMentions(body, args.mentions).map((m) => resolveHandle(m, db)))];
    db.query(REVIVE_ROOM_SQL).run(room);
    const result = db.query(INSERT_MESSAGE_SQL).run(room, handle, body, JSON.stringify(mentions), null, now, quiet ? 1 : 0);
    const recipients = recipientsFor(room, handle, mentions, db);
    return { id: Number(result.lastInsertRowid), recipients };
  });

  return runCriticalWrite("postMessage", () => run(), { room, handle });
}
```

Switch the four message readers to `toMessages`:

- `readUnread`: `results.push({ room: member.room, messages: toMessages(rows, db) });`
- `peekUnread`: `results.push({ room: member.room, messages: toMessages(rows, db) });`
- `listMessages`: `return toMessages(rows.reverse(), db);`
- `pendingMessages`: `return toMessages(rows, db);`

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test lib/state/__tests__/chat-store.test.ts lib/state/__tests__/dm-store.test.ts lib/state/__tests__/chat-prune.test.ts`
Expected: PASS.
Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/state/chat-store.ts lib/state/__tests__/chat-store.test.ts
git commit -m "chat: display names on messages and members, mentions as ids" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: DMs key on ids, and the incident at the store level

`lib/state/dm-store.ts` needs no code change: `dmRoomFor` hashes whatever two strings it is given, and those are now ids. These tests pin that and reproduce the spec's incident (Testing, first bullet) with the store alone. Expected to PASS on first run; a failure here means an earlier task is wrong, so fix it there.

**Files:**
- Test: `lib/state/__tests__/dm-store.test.ts`, `lib/state/__tests__/chat-identity-incident.test.ts` (new)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new.

- [ ] **Step 1: Write the dm-store test**

In `lib/state/__tests__/dm-store.test.ts` add `import { mintIdentity } from "../identity-store.ts";` and append:

```ts
test("two identities sharing a display name get separate DM rooms with the same peer", () => {
  const db = fresh();
  const minted = mintIdentity({ base: "remy", name: "remy", sessionId: "s1", now: 1 }, db);
  const legacy = dmRoomFor("kai", "remy", "matt", db);
  const mintedDm = dmRoomFor("kai", minted.id, "matt", db);
  expect(mintedDm.room).not.toBe(legacy.room);
  expect(listDms("kai", db).map((d) => d.room).sort()).toEqual([legacy.room, mintedDm.room].sort());
  expect(listDms(minted.id, db).map((d) => d.room)).toEqual([mintedDm.room]);
  expect(listMembers(mintedDm.room, db).map((m) => m.name).sort()).toEqual(["kai", "matt", "remy"]);
});
```

- [ ] **Step 2: Write the incident test**

Create `lib/state/__tests__/chat-identity-incident.test.ts`:

```ts
/**
 * The 2026-09-27 incident at the store level (spec "Testing", first bullet):
 * a brand-new session drew a recycled pool name and inherited the old
 * holder's DMs, unread backlog and history.
 */
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { tmpdir } from "os";
import { join } from "path";
import { AGENT_NAMES } from "../../chat-names.ts";
import { joinRoom, listMessages, listRooms, peekUnread, postMessage } from "../chat-store.ts";
import { openStateDb } from "../db.ts";
import { dmParticipants, dmRoomFor, listDms } from "../dm-store.ts";
import { resolveHandle } from "../identity-store.ts";
import { setKvValue } from "../kv-blob.ts";
import { prunePresence, signIn, signOut, type RegistryDeps } from "../presence-store.ts";

const NO_BINDING: RegistryDeps = { resolve: () => null, alive: () => false, resolveAll: () => new Map() };
const HOUR = 3_600_000;
const t0 = 1_700_000_000_000;

let n = 0;
function fresh(): Database {
  return openStateDb(join(tmpdir(), `incident-test-${process.pid}-${n++}.db`));
}

function forceNextDraw(name: string, db: Database, at: number): void {
  setKvValue("chat", "names", Object.fromEntries(AGENT_NAMES.map((pool) => [pool, pool === name ? 0 : at])), db);
}

function pair(x: string, y: string): { a: string; b: string } {
  return x < y ? { a: x, b: y } : { a: y, b: x };
}

test("a recycled pool name starts with an empty footprint, and old replies still reach the old holder", () => {
  const db = fresh();
  forceNextDraw("remy", db, t0);
  const a = signIn({ sessionId: "sess-a", now: t0 }, db, NO_BINDING)!;
  expect(a.name).toBe("remy");
  joinRoom({ room: "rt", handle: a.handle }, db);
  joinRoom({ room: "rt", handle: "kai" }, db);
  const dm = dmRoomFor(a.handle, "kai", "matt", db).room;
  postMessage({ room: dm, handle: a.handle, body: "kai, the picker branch is yours" }, db);
  postMessage({ room: dm, handle: "kai", body: "on it" }, db);
  postMessage({ room: "rt", handle: a.handle, body: "signing off" }, db);
  signOut("sess-a", t0 + HOUR, db);
  expect(prunePresence(t0 + 26 * HOUR, db, NO_BINDING)).toBe(1);

  forceNextDraw("remy", db, t0 + 26 * HOUR);
  const b = signIn({ sessionId: "sess-b", now: t0 + 26 * HOUR }, db, NO_BINDING)!;
  expect(b.name).toBe("remy");
  expect(b.handle).not.toBe(a.handle);
  expect(listRooms(b.handle, db)).toEqual([]);
  joinRoom({ room: "rt", handle: b.handle }, db);
  expect(listRooms(b.handle, db).map((r) => r.room)).toEqual(["rt"]);
  expect(peekUnread({ handle: b.handle, limit: 50 }, db)).toEqual([]);

  expect(dmParticipants(dm, db)).toEqual(pair(a.handle, "kai"));
  expect(listDms("kai", db).map((d) => d.room)).toEqual([dm]);
  expect(listMessages({ room: dm, limit: 10 }, db).map((m) => [m.handle, m.name])).toEqual([
    [a.handle, "remy"],
    ["kai", "kai"],
  ]);

  const toNewRemy = dmRoomFor("kai", resolveHandle("remy", db), "matt", db);
  expect(toNewRemy.created).toBe(true);
  expect(dmParticipants(toNewRemy.room, db)).toEqual(pair(b.handle, "kai"));
  expect(dmRoomFor("kai", a.handle, "matt", db)).toEqual({ room: dm, created: false });
});

test("a new session drawing a name a legacy handle once held gets its own id and none of the legacy footprint", () => {
  const db = fresh();
  joinRoom({ room: "rt", handle: "remy" }, db);
  const legacyDm = dmRoomFor("remy", "kai", "matt", db).room;
  postMessage({ room: legacyDm, handle: "kai", body: "unread for the old remy" }, db);

  forceNextDraw("remy", db, t0);
  const b = signIn({ sessionId: "sess-b", now: t0 }, db, NO_BINDING)!;
  expect(b.name).toBe("remy");
  expect(b.handle).not.toBe("remy");
  expect(b.handle).toMatch(/^remy\.[a-z0-9]{4,6}$/);
  expect(listRooms(b.handle, db)).toEqual([]);
  expect(peekUnread({ handle: b.handle, limit: 50 }, db)).toEqual([]);
  expect(listDms(b.handle, db)).toEqual([]);
  expect(resolveHandle("remy", db)).toBe(b.handle);
});
```

- [ ] **Step 3: Run them**

Run: `bun test lib/state/__tests__/dm-store.test.ts lib/state/__tests__/chat-identity-incident.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/state/__tests__/dm-store.test.ts lib/state/__tests__/chat-identity-incident.test.ts
git commit -m "chat: store-level test for the recycled-name incident" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Lane gate and hand-off

**Files:** none changed.

- [ ] **Step 1: Run the lane's suites**

Run: `bun test lib/state lib/__tests__/chat-names.test.ts > "${TMPDIR:-/tmp}/lane-1a-state.log" 2>&1; tail -5 "${TMPDIR:-/tmp}/lane-1a-state.log"`
Expected: `0 fail`.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 3: Scan the lane's added lines for forbidden dashes**

Run: `git diff chat-identity | grep '^+' | grep -c "$(printf '\342\200\224')"; git diff chat-identity | grep '^+' | grep -c "$(printf '\342\200\223')"`
Expected: `0` and `0` (the em dash and the en dash, each spelled as octal bytes so this plan never contains one).

- [ ] **Step 4: Record the expected red outside the lane for 1b**

Run: `bun test lib/daemon lib/mcp commands > "${TMPDIR:-/tmp}/lane-1a-outside.log" 2>&1; grep -E "^\(fail\)" "${TMPDIR:-/tmp}/lane-1a-outside.log" | sort > "${TMPDIR:-/tmp}/lane-1a-outside-fails.txt"; wc -l < "${TMPDIR:-/tmp}/lane-1a-outside-fails.txt"`
Expected: a nonzero count, every failure in a chat, pane, agent or herd suite asserting a handle equals a display name or a bare pool name. Any failure elsewhere is this lane's bug: stop and fix it before handing off. Post the file's contents to lane 1b with the "Notes for lane 1b" section above.

- [ ] **Step 5: Hand off**

No commit. Report to the shepherd: the branch name, the head commit, the two gate results, the outside-fail list path, and the CONTRACT ISSUE 1 ruling request.
