# Lane 1b: rt daemon, CLI, MCP, herd, agent

> **Shepherd rulings (supersede the CONTRACT ISSUE notes below):** (1) Refusals: `signIn` throws with 1a's wording (`fixedIdentityRefusal`, the reclaimed message); handlers surface the error text unchanged. (2) `--as` on a live name: the handler catches the reclaimed refusal and signs in with `baseHandle: identityName(id)`, minting `remy-2`, exactly as 1a's lane notes describe. (3) `herd:resume` signs the prior shepherd session out, then continues its id. (4) Body `@x` mentions resolve in 1a's `postMessage`; handlers resolve explicit `mentions[]`, `to`, `from`, `handle` inputs. (5) `continue` resolves through `resolveHandle`; a known id (legacy included) with no live session is continued, else mint under that display name. (6) **MCP `chat_sign_in` `as` never continues**: it passes `baseHandle`, not `continue`, and keeps every current refusal (held names, names with memberships, the human). Rework Task 10 accordingly, with a test that `as: "<an offline identity's name>"` mints a fresh id and does not inherit its rooms.

Part of `docs/superpowers/plans/2026-09-27-chat-identity.md` (the master plan owns the header, global constraints, review focus and the frozen contract). Spec: `docs/superpowers/specs/2026-09-27-chat-identity-design.md`.

**This lane's tests pass only once it is rebased on lane 1a.** Every test here calls lane 1a's store API (`resolveHandle`, `identityName`, `identityNames`, `mintIdentity`, `signIn` with `continueId`, `name` on `PresenceRow`, `ChatMessage` and `ChatMember`). If lane 1a is not in this branch yet, do each task's code and test edits, skip its run steps, commit, and run every skipped step in Task 12 after the rebase. `bun test` does not typecheck, so the unit and e2e runs work once 1a is in; `bun run typecheck` additionally needs lane 2's `packages/rt-client/src/commands.ts` (the new wire fields and the `continue` payload), which lands in master Task I2.

## CONTRACT ISSUE notes (nothing renamed; planned against the contract as frozen)

1. **How `signIn` refuses.** The contract types `signIn` as `... | undefined`, with `undefined` meaning "database busy". A refused continuation (the human's id, or an id live in another session, Review Focus 5) has no return shape. This lane assumes `signIn` throws an `Error` carrying today's wording; the `chat:sign-in` handler catches it and returns `{ ok: false, error }` (Task 1). The master plan now says 1a may also export `fixedIdentityRefusal`; if it returns the refusal text instead of `signIn` throwing, call it in the handler right before `signIn` and return its text as the error, keeping the same tests.
2. **Who implements `--as` on a live name.** The contract has `signIn` refuse a `continueId` that is live elsewhere, while the spec says `--as remy` with remy live yields a new id named `remy-2`. This lane implements that fallback in the `chat:sign-in` handler: it resolves `continue`, and if the target is held by another live session it passes `baseHandle` (the target's base name) instead of `continueId`, so `signIn`'s display-suffix rule produces `remy-2`. `signIn`'s refusal stays the backstop for a race. The handler's liveness test (`heldByAnotherSession`, Task 1) mirrors presence-store's reclaim predicate; lane 1a must keep the same rule for "live".
3. **The `herd:resume` takeover.** `signIn` has no takeover flag. `herd:resume` signs the prior shepherd session out (`chat:sign-out`) before continuing the stored shepherd id, so that id is no longer live (Task 8). This needs lane 1a's `signIn` to (a) continue an id whose presence row is signed out, replacing that row, and (b) rebind a session that already holds a different id to the continued one.
4. **Body `@mention` resolution.** The spec resolves each `@x` in a body at post time, but `mergeMentions` and `postMessage` are lane 1a's (`lib/state/chat-store.ts`). This lane resolves payload `mentions[]`, and its own desk-notify merge, through `resolveHandle`. It relies on 1a's `postMessage` resolving parsed body mentions before storing them and computing recipients. If 1a does not, a legacy `remy` member is still woken by an `@remy` meant for the new remy (the Task 2 body-mention test catches it).
5. **A `continueId` with no identities row.** `--as recipient` on a name nobody holds resolves (spec step 4) to `recipient` itself. This lane assumes `signIn` continues it as a legacy id (handle = name = `recipient`). The e2e suites and the converted unit tests depend on it.

## Spec note for Matt (resolved by ruling 6)

The MCP `chat_sign_in` tool's `as` keeps every current refusal and never continues; Task 10 spawns `rt chat sign-in --name <as>`, a fresh identity with that display name.

## What needs no change

- `lib/daemon/herd-lifecycle.ts`, `lib/daemon/herd-watchdog.ts`, `lib/daemon/herd-watchdog-adapters.ts`: they post as `SYSTEM_HANDLE`, mention the stored shepherd id, count unread for the stored job id, and write `job.name` (the display name) into bodies. Task 8 Step 9 confirms it with a grep.
- `lib/state/agents-store.ts`: the `handle` column stores whatever `reserveAgentHandle` (lane 1a) returns.
- Frame text pinned by e2e: only `e2e/tests/chat-inbox-delivery.test.ts` (reply steer, welcome) and `e2e/tests/chat-presence-roster.test.ts` (`x`/`x-2`). `e2e/pty/` has no chat assertions (`rg -ln chat e2e/pty` is empty). Both e2e files are Task 11.

## File map

| File | Change | Task |
|---|---|---|
| `lib/daemon/handlers/chat.ts` | sign-in continuation, pane pin removed, input resolution, response names, frames and receipts by name | 1, 2, 3, 4 |
| `lib/daemon/inbox.ts` | `DeliveryItem.name`, `replySteer`, `senderHints`; `REPLY_STEER` removed | 3 |
| `lib/daemon/handlers/pane.ts` | `presence.name` | 6 |
| `lib/daemon/handlers/agent.ts` | `name` on every agent record response | 7 |
| `lib/daemon/handlers/herd.ts` | shepherd and worker identities, `shepherdName`, `handleName` | 8 |
| `lib/daemon/command-router.ts` | herd identity deps wiring | 8 |
| `lib/chat-session.ts` | `name` field, `sessionName` | 9 |
| `commands/chat.ts` | `--as` sends `continue`, pane pin gone, names printed | 1, 9 |
| `commands/pane.ts`, `commands/agent.ts`, `commands/herd.ts` | names printed | 6, 7, 8 |
| `lib/mcp/shared.ts`, `lib/mcp/chat-tools.ts`, `lib/mcp/whoami-tool.ts`, `lib/mcp/tools.ts` | name beside id, `as` continues | 10 |
| tests under `lib/daemon/__tests__/`, `lib/mcp/__tests__/`, `lib/__tests__/`, `commands/__tests__/` | per task | 1 to 10 |
| `lib/daemon/__tests__/chat-identity-incident.test.ts` | new: the incident | 5 |
| `e2e/tests/chat-inbox-delivery.test.ts`, `e2e/tests/chat-presence-roster.test.ts` | frames and suffix by name | 11 |

---

### Task 0: Rebase readiness

**Files:** none.

- [ ] **Step 1: Check whether lane 1a is in this branch**

Run: `test -f lib/state/identity-store.ts && rg -n "export function resolveHandle|export function mintIdentity|continueId" lib/state/identity-store.ts lib/state/presence-store.ts`
Expected: three or more hits when 1a is in. No file means code-only mode: do every task's edits and commits, skip their run steps, and run them all in Task 12.

- [ ] **Step 2: When 1a is in, record the baseline**

Run: `bun test lib/daemon/__tests__/chat-handlers.test.ts lib/daemon/__tests__/chat-delivery.test.ts > "$TMPDIR/lane1b-baseline.log" 2>&1; rg -c "\(fail\)" "$TMPDIR/lane1b-baseline.log"`
Expected: failures, starting with a link error on `paneHandleFor` (1a deleted it; `lib/daemon/handlers/chat.ts` and `commands/chat.ts` still import it). Task 1 clears that.

---

### Task 1: Sign-in continues identities; the pane pin is gone

**Files:**
- Modify: `lib/daemon/handlers/chat.ts` (imports; `chat:sign-in` handler, the base-handle chain at the old lines 1133-1161 and the `rememberPaneHandle` call)
- Modify: `commands/chat.ts` (drop `readPaneHandlePin` and the `paneHandleFor` import)
- Test: `lib/daemon/__tests__/chat-handlers.test.ts`, `lib/daemon/__tests__/chat-delivery.test.ts`, `commands/__tests__/chat.test.ts`

**Interfaces:**
- Consumes (lane 1a): `signIn(args: { sessionId; baseHandle?; continueId?; cwd?; repo?; branch?; pane?; statusText?; now? }, db?, deps?): { handle; baseHandle; name; reclaimed; continued } | undefined` (throws on a refused continuation, CONTRACT ISSUE 1); `resolveHandle(x, db?): string`; `identityName(id, db?): string`; `reserveAgentHandle(db?, now?): string`.
- Produces: `chat:sign-in` accepts payload `continue?: string` and answers `{ handle, baseHandle, name, reclaimed, continued, sessionId, room }`. Payload `continue` means "`--as`": continue the identity it names; when `signIn` refuses it as live in another session ("handle reclaimed"), sign in again with `baseHandle: identityName(id)`, a new id with the next display suffix. An agent reservation (`getAgent(sessionId).handle`) is continued unconditionally.

- [ ] **Step 1: Convert the existing handler tests to legacy-id sign-ins**

These suites sign in with `baseHandle` and then act on the raw string (`handle: "b"`, `lastReadId(db, room, "b")`). Under lane 1a a `baseHandle` mints `b.xxxx`, and so does a `continue` naming nothing known (ruling 5 mints under that display name). So they switch to `continue`, and `freshHandlers` first adopts a `continue` name nothing knows as a legacy id, which the continuation then keeps as `b`. The invalid-base test keeps `baseHandle`.

Run:
```bash
perl -pi -e 's/baseHandle: "/continue: "/ if /chat:sign-in/ && !/remote:host/' lib/daemon/__tests__/chat-handlers.test.ts lib/daemon/__tests__/chat-delivery.test.ts
```

Then, in both files, add `isValidChatName` to the `../../state/index.ts` import (and `import type { Database } from "bun:sqlite";` in `chat-delivery.test.ts`), and add this helper above `freshHandlers`:

```ts
// A `continue` naming no identity row (by id or name) is adopted as a legacy
// id first, so each handle equals its name and the raw-handle db probes below
// keep working. Tests that need a minted id pass `baseHandle` or nothing.
function adoptingLegacy<H extends ReturnType<typeof createChatHandlers>>(h: H, db: Database): H {
  const signIn = h["chat:sign-in"];
  h["chat:sign-in"] = (async (p: { continue?: string }) => {
    const want = p?.continue;
    if (typeof want === "string" && isValidChatName(want) && !db.query("SELECT 1 FROM chat_identities WHERE id = ?1 OR name = ?1").get(want)) {
      db.run("INSERT INTO chat_identities (id, name, base_name, minted_at, session_id) VALUES (?1, ?1, ?1, 0, NULL)", [want]);
    }
    return signIn(p as never);
  }) as H["chat:sign-in"];
  return h;
}
```

and make `freshHandlers` return `Object.assign(adoptingLegacy(createChatHandlers({ ... }), db), { db })` (same `createChatHandlers` arguments as today).

- [ ] **Step 2: Replace the pane-pin and suffix tests with identity tests**

In `lib/daemon/__tests__/chat-handlers.test.ts`, delete the four tests `"sign-in assigns and a second same-base session gets the suffix"`, `"sign-in without a baseHandle draws a first name from the pool"`, `"a herdr pane redraws its earlier pool handle on the next session; a different pane draws fresh"` and `"an explicit baseHandle still wins over a pane's pinned handle"`, and put these in their place. Add `identityName, reserveAgentHandle` to the `../../state/index.ts` import.

```ts
test("sign-in mints a fresh id per session; a second session asking for the same base gets the display suffix", async () => {
  const h = freshHandlers();
  const first = await h["chat:sign-in"]({ sessionId: "s1", baseHandle: "x" });
  if (!first.ok) throw new Error(first.error);
  expect(first.data).toMatchObject({ name: "x", baseHandle: "x", continued: false });
  expect(first.data.handle).toMatch(/^x\.[a-z0-9]{4,6}$/);
  const second = await h["chat:sign-in"]({ sessionId: "s2", baseHandle: "x" });
  if (!second.ok) throw new Error(second.error);
  expect(second.data.name).toBe("x-2");
  expect(second.data.handle).not.toBe(first.data.handle);
});

test("sign-in without a baseHandle draws a pool name as the display name behind a new id", async () => {
  const h = freshHandlers();
  const res = await h["chat:sign-in"]({ sessionId: "s1" });
  if (!res.ok) throw new Error(res.error);
  expect(AGENT_NAMES).toContain(res.data.name);
  expect(res.data.baseHandle).toBe(res.data.name);
  expect(res.data.handle.startsWith(`${res.data.name}.`)).toBe(true);
});

test("the same session signing in again keeps its id", async () => {
  const h = freshHandlers();
  const first = await h["chat:sign-in"]({ sessionId: "s1" });
  if (!first.ok) throw new Error(first.error);
  const again = await h["chat:sign-in"]({ sessionId: "s1" });
  if (!again.ok) throw new Error(again.error);
  expect(again.data.handle).toBe(first.data.handle);
});

test("a new session in a pane that signed in before gets a new id, never the old one", async () => {
  const h = freshHandlers();
  const first = await h["chat:sign-in"]({ sessionId: "s1", pane: "wAR:p3" });
  if (!first.ok) throw new Error(first.error);
  await h["chat:sign-out"]({ sessionId: "s1" });
  const again = await h["chat:sign-in"]({ sessionId: "s2", pane: "wAR:p3" });
  if (!again.ok) throw new Error(again.error);
  expect(again.data.handle).not.toBe(first.data.handle);
  expect(again.data.continued).toBe(false);
});

test("continue on a name nobody holds live continues that identity: same id, its rooms come along", async () => {
  const h = freshHandlers();
  const a = await h["chat:sign-in"]({ sessionId: "s1", baseHandle: "remy" });
  if (!a.ok) throw new Error(a.error);
  await h["chat:join"]({ room: "build", handle: a.data.handle });
  await h["chat:sign-out"]({ sessionId: "s1" });
  const b = await h["chat:sign-in"]({ sessionId: "s2", continue: "remy" });
  if (!b.ok) throw new Error(b.error);
  expect(b.data).toMatchObject({ handle: a.data.handle, name: "remy", continued: true });
  const rooms = await h["chat:rooms"]({ handle: b.data.handle });
  if (!rooms.ok) throw new Error(rooms.error);
  expect(rooms.data.rooms.map((r) => r.room)).toEqual(["build"]);
});

test("continue by id works the same as continue by name", async () => {
  const h = freshHandlers();
  const a = await h["chat:sign-in"]({ sessionId: "s1", baseHandle: "remy" });
  if (!a.ok) throw new Error(a.error);
  await h["chat:sign-out"]({ sessionId: "s1" });
  const b = await h["chat:sign-in"]({ sessionId: "s2", continue: a.data.handle });
  if (!b.ok) throw new Error(b.error);
  expect(b.data).toMatchObject({ handle: a.data.handle, continued: true });
});

test("continue on a name another live session holds mints a new id with the next display suffix", async () => {
  const h = freshHandlers();
  const a = await h["chat:sign-in"]({ sessionId: "s1", baseHandle: "remy" });
  if (!a.ok) throw new Error(a.error);
  const b = await h["chat:sign-in"]({ sessionId: "s2", continue: "remy" });
  if (!b.ok) throw new Error(b.error);
  expect(b.data.handle).not.toBe(a.data.handle);
  expect(b.data).toMatchObject({ name: "remy-2", continued: false });
});

test("continue naming the human's handle is refused", async () => {
  setSetting("chat.humanHandle", "matt", "user");
  const h = freshHandlers();
  const res = await h["chat:sign-in"]({ sessionId: "s1", continue: "matt" });
  expect(res.ok).toBe(false);
});

test("continue with an invalid name is refused with a reason", async () => {
  const h = freshHandlers();
  const res = await h["chat:sign-in"]({ sessionId: "s1", continue: "Bad Name" });
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("unreachable");
  expect(res.error).toContain("handle");
});

test("baseHandle naming an offline identity mints a fresh id and inherits none of its rooms (the MCP as path)", async () => {
  const h = freshHandlers();
  const a = await h["chat:sign-in"]({ sessionId: "s1", baseHandle: "remy" });
  if (!a.ok) throw new Error(a.error);
  await h["chat:join"]({ room: "build", handle: a.data.handle });
  await h["chat:sign-out"]({ sessionId: "s1" });
  const b = await h["chat:sign-in"]({ sessionId: "s2", baseHandle: "remy" });
  if (!b.ok) throw new Error(b.error);
  expect(b.data).toMatchObject({ name: "remy", continued: false });
  expect(b.data.handle).not.toBe(a.data.handle);
  const rooms = await h["chat:rooms"]({ handle: b.data.handle });
  if (!rooms.ok) throw new Error(rooms.error);
  expect(rooms.data.rooms).toEqual([]);
});
```

- [ ] **Step 3: Update the registry-name and reservation tests**

In the same file, replace the bodies' final assertions of these four existing tests (setup lines unchanged unless shown):

```ts
// "chat:sign-in draws baseHandle from the registry's USER-chosen name when none is given explicitly"
  expect(res.data).toMatchObject({ name: "kai", baseHandle: "kai", continued: false });
  expect(res.data.handle.startsWith("kai.")).toBe(true);

// "chat:sign-in skips a DERIVED registry name (chat-c6 style) and draws from the pool instead"
  expect(res.data.name).not.toBe("chat-c6");
```

Replace `"chat:sign-in adopts the handle rt agent start reserved for this session"` entirely:

```ts
test("chat:sign-in continues the identity rt agent start reserved for this session", async () => {
  const inboxDeps: InboxDeps = {
    resolve: (sessionId) => (sessionId === "s1" ? { pid: process.pid, socketPath: fakeSocketPath(), status: "idle", name: "chat-c6", nameSource: "derived" } : null),
    deliver: async () => ({ ok: true }),
  };
  const db = openStateDb(join(tmpdir(), `chat-h-reg-${process.pid}-${n++}.db`));
  const reserved = reserveAgentHandle(db);
  insertAgent({ id: "ag-1", repo: "r", cwd: "/tmp/x", provider: "claude", surface: "herdr", sessionId: "s1", createdAt: 1, handle: reserved }, db);
  const h = createChatHandlers({ db, emitEvent: () => 0, inboxDeps });
  const res = await h["chat:sign-in"]({ sessionId: "s1" });
  if (!res.ok) throw new Error(res.error);
  expect(res.data).toMatchObject({ handle: reserved, continued: true });
  expect(res.data.name).toBe(identityName(reserved, db));
});
```

In `"chat:sign-in prefers a user-chosen session name over the handle rt agent start reserved"`, change the `insertAgent` handle to `reserveAgentHandle(db)` and the assertion to:

```ts
  expect(res.data).toMatchObject({ name: "kai", continued: false });
```

- [ ] **Step 4: Drop the CLI pane-pin tests**

In `commands/__tests__/chat.test.ts`: remove `rememberPaneHandle` from the `../../lib/state/index.ts` import; delete the test `"a herdr pane redraws its earlier pool handle even after a fresh session signs in"`; in `"resolveSignInBaseHandle: a pane pin beats the pool draw but loses to chat.handle and --as"` delete the two `rememberPaneHandle`/pin lines and the first `expect` (Task 9 replaces the whole test).

- [ ] **Step 5: Run to verify the new tests fail**

Run: `bun test lib/daemon/__tests__/chat-handlers.test.ts -t "sign-in|continue|agent start|same session|pane that signed|MCP as path"`
Expected: FAIL. With 1a present and the old handler, the module fails to link on `paneHandleFor`; without the link error, `continue` is ignored (`continued` undefined, no `remy-2`).

- [ ] **Step 6: Implement continuation in the handler**

In `lib/daemon/handlers/chat.ts`, change the `../../state/index.ts` import: remove `paneHandleFor` and `rememberPaneHandle`; add `identityName`, `identityNames`, `resolveHandle`. Liveness stays lane 1a's call: the handler never re-derives it, it catches `signIn`'s reclaimed refusal (ruling 2).

In `"chat:sign-in"`, directly after the existing `explicitRoom` validation line, add:

```ts
      const requested = payload.continue;
      if (requested !== undefined && !isValidChatName(requested)) return { ok: false, error: `invalid handle "${requested}"` };
```

Replace everything from the comment `// No explicit baseHandle: prefer a name someone CHOSE` down to and including `if (pane) rememberPaneHandle(pane, data.baseHandle, db);` with:

```ts
      let continueId: string | undefined;
      let resolvedBase = baseHandle;
      if (requested !== undefined) continueId = resolveHandle(requested, db);
      // No explicit request: prefer a name someone CHOSE for this session
      // (registry nameSource "user": --name at launch, /rename). Claude Code's
      // auto-derived names (nameSource "derived") are skipped for a pool draw.
      if (continueId === undefined && resolvedBase === undefined) {
        const binding = inboxDeps.resolve(sessionId);
        if (binding?.name && binding.nameSource === "user" && isValidChatName(binding.name)) resolvedBase = binding.name;
      }
      // The identity `rt agent start` (or herd:spawn) reserved rides on the
      // agent record, never on the session name (that becomes the pane title).
      if (continueId === undefined && resolvedBase === undefined) {
        const reserved = getAgent(sessionId, db)?.handle;
        if (reserved && isValidChatName(reserved)) continueId = reserved;
      }

      const signInWith = (request: { baseHandle?: string; continueId?: string }) =>
        signIn({ sessionId, ...request, cwd: signInCwd, repo: signInRepo, branch: signInBranch, pane, statusText }, db, registryDeps);
      let data: ReturnType<typeof signIn>;
      try {
        try {
          data = signInWith({ baseHandle: resolvedBase, continueId });
        } catch (err) {
          // `--as` on an identity live in another session: a new id under its name, suffixed (remy-2).
          if (requested === undefined || continueId === undefined || !(err instanceof Error) || !err.message.includes("handle reclaimed")) throw err;
          data = signInWith({ baseHandle: identityName(continueId, db) });
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      // R057: signIn retries a busy write, but still reports undefined once
      // its retry budget is exhausted.
      if (!data) return { ok: false, error: "chat: sign-in failed, database busy" };
```

The final `return { ok: true, data: { ...data, sessionId, room: derivedRoom } };` stays; `data` now carries `name` and `continued`.

- [ ] **Step 7: Drop the CLI pane pin**

In `commands/chat.ts`: change the import to `import { isValidChatName, pruneMessages, getStateDb } from "../lib/state/index.ts";`, delete the whole `readPaneHandlePin` function, and in `resolveSignInBaseHandle` delete the two lines `const pinned = readPaneHandlePin();` and `if (pinned) return pinned;`.

- [ ] **Step 8: Run the tests**

Run: `bun test lib/daemon/__tests__/chat-handlers.test.ts -t "sign-in|continue|agent start|same session|pane that signed"`
Expected: PASS.

Run: `bun test commands/__tests__/chat.test.ts -t "sign-in"`
Expected: PASS (the module links again).

- [ ] **Step 9: Commit**

```bash
git add lib/daemon/handlers/chat.ts commands/chat.ts lib/daemon/__tests__/chat-handlers.test.ts lib/daemon/__tests__/chat-delivery.test.ts commands/__tests__/chat.test.ts
git commit -m "chat: sign-in continues identities, pane pin removed" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Every typed name resolves to an id

**Files:**
- Modify: `lib/daemon/handlers/chat.ts` (`chat:join`, `chat:leave`, `chat:post`, `chat:ack`, `chat:claim`, `chat:release`, `chat:read`, `chat:rooms`, `chat:mark`, `chat:dm`, `chat:dm-open`, `postAndNotify`)
- Test: `lib/daemon/__tests__/chat-handlers.test.ts`

**Interfaces:**
- Consumes: `resolveHandle(x: string, db?: Database): string` (lane 1a), in the spec's order: minted id, live display name, most recent minted identity by name, else `x` as a legacy id. Legacy handles come last, so `@kai` reaches the live kai, not an old `kai` member.
- Produces: every payload `handle`, `from`, `to` and `mentions[]` accepts an id or a name. Validation still runs on the raw input (`isValidChatName`); resolution runs after it. `here` is never resolved.

- [ ] **Step 1: Write the failing tests**

Append to `lib/daemon/__tests__/chat-handlers.test.ts`:

```ts
test("every handle-bearing input accepts a live display name and acts on its id", async () => {
  const h = freshHandlers();
  const remy = await h["chat:sign-in"]({ sessionId: "s1", baseHandle: "remy" });
  const kai = await h["chat:sign-in"]({ sessionId: "s2", baseHandle: "kai" });
  if (!remy.ok || !kai.ok) throw new Error("sign-in failed");
  await h["chat:join"]({ room: "build", handle: "remy" });
  await h["chat:join"]({ room: "build", handle: "kai" });
  const who = await h["chat:who"]({ room: "build" });
  if (!who.ok) throw new Error(who.error);
  expect(who.data.members.map((m) => m.handle).sort()).toEqual([kai.data.handle, remy.data.handle].sort());

  const posted = await h["chat:post"]({ room: "build", handle: "kai", body: "look", mentions: ["remy"] });
  if (!posted.ok) throw new Error(posted.error);
  expect(posted.data.recipients).toEqual([remy.data.handle]);

  const dm = await h["chat:dm"]({ from: "kai", to: "remy", body: "psst", sessionId: "s2" });
  if (!dm.ok) throw new Error(dm.error);
  expect(dm.data.recipients).toEqual([remy.data.handle]);

  const rooms = await h["chat:rooms"]({ handle: "remy" });
  if (!rooms.ok) throw new Error(rooms.error);
  expect(rooms.data.rooms.map((r) => r.room)).toContain("build");
});

test("a body @mention of a live name wakes that session's id", async () => {
  const h = freshHandlers();
  const remy = await h["chat:sign-in"]({ sessionId: "s1", baseHandle: "remy" });
  const kai = await h["chat:sign-in"]({ sessionId: "s2", baseHandle: "kai" });
  if (!remy.ok || !kai.ok) throw new Error("sign-in failed");
  await h["chat:join"]({ room: "build", handle: remy.data.handle });
  await h["chat:join"]({ room: "build", handle: kai.data.handle });
  await h["chat:join"]({ room: "build", handle: "remy.old" });
  const posted = await h["chat:post"]({ room: "build", handle: kai.data.handle, body: "@remy look" });
  if (!posted.ok) throw new Error(posted.error);
  expect(posted.data.recipients).toEqual([remy.data.handle]);
});

test("a live name beats a legacy handle of the same spelling", async () => {
  const h = freshHandlers();
  await h["chat:join"]({ room: "build", handle: "kai" });
  const kai = await h["chat:sign-in"]({ sessionId: "s1", baseHandle: "kai" });
  if (!kai.ok) throw new Error(kai.error);
  expect(kai.data.name).toBe("kai");
  await h["chat:join"]({ room: "build", handle: kai.data.handle });
  await h["chat:join"]({ room: "build", handle: "eli" });
  const posted = await h["chat:post"]({ room: "build", handle: "eli", body: "ping", mentions: ["kai"] });
  if (!posted.ok) throw new Error(posted.error);
  expect(posted.data.recipients).toEqual([kai.data.handle]);
});

test("a legacy handle containing a dot resolves to itself (step 4), never as a name", async () => {
  const h = freshHandlers();
  await h["chat:join"]({ room: "build", handle: "old.pal" });
  await h["chat:join"]({ room: "build", handle: "kai" });
  const posted = await h["chat:post"]({ room: "build", handle: "kai", body: "hi", mentions: ["old.pal"] });
  if (!posted.ok) throw new Error(posted.error);
  expect(posted.data.recipients).toEqual(["old.pal"]);
});

test("an unknown name stays itself, today's behaviour for a handle nobody holds", async () => {
  const h = freshHandlers();
  const joined = await h["chat:join"]({ room: "build", handle: "nobody" });
  if (!joined.ok) throw new Error(joined.error);
  expect(joined.data.handle).toBe("nobody");
});

test("the human's @here is never resolved as a name", async () => {
  const h = freshHandlers();
  await h["chat:join"]({ room: "build", handle: "a" });
  await h["chat:join"]({ room: "build", handle: "b" });
  const posted = await h["chat:post"]({ room: "build", handle: "a", body: "all hands", mentions: ["here"] });
  if (!posted.ok) throw new Error(posted.error);
  expect(posted.data.recipients).toEqual(["b"]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/daemon/__tests__/chat-handlers.test.ts -t "live display name|body @mention|beats a legacy handle|legacy handle containing a dot|unknown name stays|never resolved as a name"`
Expected: the first three FAIL (join as `"remy"` creates a legacy member `remy`, so `who` lists `remy`, not the minted id; `mentions: ["kai"]` wakes the legacy `kai`); the other three PASS today and pin behaviour that must not regress.

- [ ] **Step 3: Resolve inputs in every verb**

In `createChatHandlers`, after `const deliveryChains = ...`, add:

```ts
  const resolveMention = (m: string): string => (m === "here" ? m : resolveHandle(m, db));
```

`"chat:join"`: replace the destructure and validation head with:

```ts
      const payload = rawPayload as Commands["chat:join"]["payload"];
      const { room, wakeOn, cwd, pane } = payload;
      if (!isValidChatName(payload.handle)) return { ok: false, error: `invalid handle "${payload.handle}"` };
      if (!isValidChatName(room)) return { ok: false, error: `invalid room "${room}"` };
      const handle = resolveHandle(payload.handle, db);
```

`"chat:leave"`:

```ts
      leaveRoom(payload.room, resolveHandle(payload.handle, db), db);
```

`"chat:post"`: replace the head down to (not including) the `roomArchivedAt` check with:

```ts
      const payload = rawPayload as Commands["chat:post"]["payload"];
      const { room, body, quiet } = payload;
      if (!isValidChatName(room)) return { ok: false, error: `invalid room "${room}"` };
      if (!isValidChatName(payload.handle)) return { ok: false, error: `invalid handle "${payload.handle}"` };
      if (!isValidBody(body)) return { ok: false, error: `body must be a non-empty string under ${MAX_BODY_BYTES} bytes` };
      if (payload.mentions !== undefined && !Array.isArray(payload.mentions)) return { ok: false, error: "mentions must be an array of handles" };
      // Rejected rather than coerced: a truthy non-boolean (the string
      // "false", say) would silently suppress every wake this post owes.
      if (quiet !== undefined && typeof quiet !== "boolean") return { ok: false, error: "quiet must be a boolean" };
      const invalidMention = payload.mentions?.find((m) => !isValidChatName(m));
      if (invalidMention !== undefined) return { ok: false, error: `invalid handle "${invalidMention}"` };
      const handle = resolveHandle(payload.handle, db);
      const mentions = payload.mentions?.map(resolveMention);
```

The rest of `"chat:post"` is unchanged; it already reads `handle` and `mentions`.

`"chat:ack"`, `"chat:claim"`, `"chat:release"`: in each, change `const { id, handle } = payload;` to `const { id } = payload;`, change the validation line to test `payload.handle`, and add after the id check:

```ts
      const handle = resolveHandle(payload.handle, db);
```

(for example, in `"chat:ack"`:)

```ts
      const { id } = payload;
      if (!isValidChatName(payload.handle)) return { ok: false, error: `invalid handle "${payload.handle}"` };
      if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "id must be a positive message id" };
      const handle = resolveHandle(payload.handle, db);
```

`"chat:read"`:

```ts
      const { room, limit, sinceMs } = payload;
      const handle = resolveHandle(payload.handle, db);
```

`"chat:rooms"`: pass `resolveHandle(payload.handle, db)` to `listRooms` (Task 4 rewrites this handler; this step only changes the argument).

`"chat:mark"`:

```ts
      markRead(resolveHandle(handle, db), room, upto, db);
```

`"chat:dm"` and `"chat:dm-open"`: keep the two `isValidChatName` checks on the raw `from`/`to`, then add before `assertSessionOwnsHandle`:

```ts
      const fromId = resolveHandle(from, db);
      const toId = resolveHandle(to, db);
```

and use `fromId`/`toId` for `assertSessionOwnsHandle(fromId, ...)`, `dmRoomFor(fromId, toId, humanHandle, db)`, and (in `"chat:dm"`) `postAndNotify(db, emitEvent, { room, handle: fromId, body, mentions: [toId] }, ...)`.

In `postAndNotify`, change the desk-notify merge to resolve every parsed mention:

```ts
  const allMentions = mergeMentions(body, mentions).map((m) => (m === "here" ? m : resolveHandle(m, db)));
```

- [ ] **Step 4: Run the tests**

Run: `bun test lib/daemon/__tests__/chat-handlers.test.ts lib/daemon/__tests__/chat-delivery.test.ts`
Expected: PASS except the frame-text tests in `chat-delivery.test.ts` that compare against `STEER` (Task 3) and the exact `toEqual` claim/release assertions (Task 4). If the body-mention test fails, CONTRACT ISSUE 4 applies: raise it with the lane 1a owner, do not patch `lib/state`.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/handlers/chat.ts lib/daemon/__tests__/chat-handlers.test.ts
git commit -m "chat: resolve typed names to ids on every verb input" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Frames show names; the reply hint names the sender's id

**Files:**
- Modify: `lib/daemon/inbox.ts` (`renderDeliveries`, `deliveryLabel`, `REPLY_STEER` replaced)
- Modify: `lib/daemon/handlers/chat.ts` (`deliverPost`, `renderWelcome`, the welcome composition in `chat:sign-in`)
- Test: `lib/daemon/__tests__/inbox.test.ts`, `lib/daemon/__tests__/chat-delivery.test.ts`, `lib/daemon/__tests__/chat-handlers.test.ts`

**Interfaces:**
- Consumes: store `ChatMessage.name` (lane 1a) from `pendingMessages` and `peekUnread`.
- Produces (in `lib/daemon/inbox.ts`):
  ```ts
  export interface DeliveryItem { room: string; dm: boolean; handle: string; name: string; body: string; id: number }
  export function renderDeliveries(items: DeliveryItem[]): string;
  export function deliveryLabel(items: Array<Pick<DeliveryItem, "room" | "dm" | "name">>): string;
  export function senderHints(senders: Array<{ handle: string; name: string }>): string[];
  export function replySteer(senders: Array<{ handle: string; name: string }>): string;
  ```
  and `renderWelcome(name: string, rooms: string[], catchup: Array<{ room: string; lines: string[] }>, senders?: Array<{ handle: string; name: string }>): string` in `lib/daemon/handlers/chat.ts`.
- Exact hint wording (agent-facing, the one place an id is shown; the master contract asks for one hint per distinct sender). One sender: `reply via rt chat post <room> "..." or rt chat dm remy.k3f9 "..." (never SendMessage; this arrived through rt chat)`. Several: that line with `<id>` in place of the id, then one line per distinct sender in first-seen order, `  reply to remy: rt chat dm remy.k3f9 "..."`.

- [ ] **Step 1: Write the failing inbox tests**

In `lib/daemon/__tests__/inbox.test.ts`, change the import to:

```ts
import { DEFAULT_TIMEOUT_MS, deliverToInbox, deliveryLabel, probeInboxReachability, renderDeliveries, replySteer, senderHints, wrapCrossSession } from "../inbox.ts";
```

Replace the `renderDeliveries` and `deliveryLabel` tests with:

```ts
test("renderDeliveries shows each sender's name, never the id, next to the id rt chat ack takes", () => {
  expect(renderDeliveries([
    { room: "general", dm: false, handle: "max.k3f9", name: "max", body: "hello", id: 12 },
    { room: "dm-1", dm: true, handle: "eli", name: "eli", body: "hi", id: 13 },
  ])).toBe("[#general] max #12: hello\n[dm] eli #13: hi");
});

test("deliveryLabel names the sender by name for one message and counts a batch", () => {
  expect(deliveryLabel([{ room: "general", dm: false, name: "max" }])).toBe("max (#general)");
  expect(deliveryLabel([{ room: "dm-1", dm: true, name: "eli" }])).toBe("eli (dm)");
  expect(deliveryLabel([
    { room: "general", dm: false, name: "max" },
    { room: "general", dm: false, name: "eli" },
    { room: "general", dm: false, name: "kai" },
  ])).toBe("rt chat (3 messages)");
});

test("replySteer names the one sender's id as the dm target", () => {
  expect(replySteer([{ handle: "remy.k3f9", name: "remy" }, { handle: "remy.k3f9", name: "remy" }])).toBe(
    'reply via rt chat post <room> "..." or rt chat dm remy.k3f9 "..." (never SendMessage; this arrived through rt chat)',
  );
});

test("replySteer gives one hint per distinct sender when a bundle has several", () => {
  expect(replySteer([
    { handle: "remy.k3f9", name: "remy" },
    { handle: "kai", name: "kai" },
    { handle: "remy.k3f9", name: "remy" },
  ])).toBe(
    'reply via rt chat post <room> "..." or rt chat dm <id> "..." (never SendMessage; this arrived through rt chat)\n' +
      '  reply to remy: rt chat dm remy.k3f9 "..."\n' +
      '  reply to kai: rt chat dm kai "..."',
  );
});

test("senderHints lists distinct senders in first-seen order", () => {
  expect(senderHints([{ handle: "a.0001", name: "a" }, { handle: "b", name: "b" }, { handle: "a.0001", name: "a" }])).toEqual([
    '  reply to a: rt chat dm a.0001 "..."',
    '  reply to b: rt chat dm b "..."',
  ]);
});
```

- [ ] **Step 2: Update the delivery and welcome tests**

In `lib/daemon/__tests__/chat-delivery.test.ts`, replace the `STEER` block with:

```ts
// Kept as a literal (not built with replySteer) so an accidental change to
// the shipped hint fails these assertions instead of vanishing into a
// tautology. Every frame this literal is compared against is from the
// legacy id "a".
const STEER =
  'reply via rt chat post <room> "..." or rt chat dm a "..." (never SendMessage; this arrived through rt chat)';
```

Append to the same file:

```ts
test("a delivery from a minted identity shows its name in the label and lines, and its id only in the reply hint", async () => {
  const calls: Array<[string, string]> = [];
  const sock = fakeSocketPath();
  const inboxDeps: InboxDeps = {
    resolve: (sessionId) => (sessionId === "sess-b" ? { pid: process.pid, socketPath: sock, status: "idle" } : null),
    deliver: async (socketPath, content) => { calls.push([socketPath, content]); return { ok: true }; },
  };
  const h = freshHandlers(inboxDeps);
  const a = await h["chat:sign-in"]({ sessionId: "sess-a", baseHandle: "ada" });
  if (!a.ok) throw new Error(a.error);
  await h["chat:sign-in"]({ sessionId: "sess-b", continue: "b" });
  await settleWelcome(calls);
  await h["chat:join"]({ room: "general", handle: a.data.handle });
  await h["chat:join"]({ room: "general", handle: "b" });
  const posted = await h["chat:post"]({ room: "general", handle: a.data.handle, body: "@b hi" });
  if (!posted.ok) throw new Error(posted.error);
  await Bun.sleep(0);
  expect(calls).toEqual([[
    sock,
    `<cross-session-message from-name="ada (#general)">\n[#general] ada #${posted.data.id}: @b hi\n` +
      `reply via rt chat post <room> "..." or rt chat dm ${a.data.handle} "..." (never SendMessage; this arrived through rt chat)\n</cross-session-message>`,
  ]]);
});
```

In `lib/daemon/__tests__/chat-handlers.test.ts`, replace the `renderWelcome` test with:

```ts
test("renderWelcome carries the name, room list, the automatic-delivery sentence, the two-line reply contract, the read/skill pointers, catch-up capped at 10 lines per room, and the catch-up senders' ids", () => {
  const manyLines = Array.from({ length: 12 }, (_, i) => `agent: msg ${i}`);
  const text = renderWelcome("kai", ["build", "general"], [
    { room: "build", lines: manyLines },
    { room: "general", lines: [] },
  ], [{ handle: "agent.k3f9", name: "agent" }]);
  expect(text).toContain("You're signed in to rt chat as kai.");
  expect(text).toContain("#build");
  expect(text).toContain("#general");
  expect(text).toContain("Messages will arrive in your context automatically; you never need to poll or arm anything.");
  expect(text).toContain('Reply in a room with: rt chat post <room> "..."');
  expect(text).toContain('Reply privately with: rt chat dm <id> "..." (every delivery names the sender\'s id)');
  expect(text).toContain("rt chat read shows a room's history.");
  expect(text).toContain("rt:chat skill");
  expect(text.split("\n").filter((l) => l.includes("msg "))).toHaveLength(10);
  expect(text).toContain('Reply to a catch-up sender with:\n  reply to agent: rt chat dm agent.k3f9 "..."');
});

test("renderWelcome with nothing to catch up has no sender hints", () => {
  expect(renderWelcome("kai", [], [])).not.toContain("Reply to a catch-up sender");
});
```

In `"chat:sign-in viaPane resolves the pane's Claude session via herdr, signs it in under that session id, and sends a welcome frame"`, replace `expect(calls[0]![1]).toContain(res.data.handle);` with:

```ts
  expect(calls[0]![1]).toContain(`You're signed in to rt chat as ${res.data.name}.`);
  expect(calls[0]![1]).not.toContain(res.data.handle);
```

- [ ] **Step 3: Run to verify they fail**

Run: `bun test lib/daemon/__tests__/inbox.test.ts lib/daemon/__tests__/chat-delivery.test.ts lib/daemon/__tests__/chat-handlers.test.ts -t "renderDeliveries|deliveryLabel|replySteer|senderHints|minted identity shows|renderWelcome|viaPane resolves"`
Expected: FAIL (`replySteer` is not exported; frames still say `rt chat dm <handle>`; the welcome prints the id).

- [ ] **Step 4: Implement the frame helpers**

In `lib/daemon/inbox.ts`, replace `renderDeliveries`, `REPLY_STEER` and `deliveryLabel` with:

```ts
export interface DeliveryItem { room: string; dm: boolean; handle: string; name: string; body: string; id: number }

/**
 * The `#<id>` is what `rt chat ack <messageId>` takes. It rides next to the
 * sender rather than at the end of the line because a batch collapses to one
 * truncated row in the terminal: an id at the end of a long body would be cut
 * off exactly when a bundle makes it necessary to tell the messages apart.
 */
export function renderDeliveries(items: DeliveryItem[]): string {
  return items
    .map((item) => `${item.dm ? "[dm]" : `[#${item.room}]`} ${item.name} #${item.id}: ${item.body}`)
    .join("\n");
}

function distinctSenders(senders: Array<{ handle: string; name: string }>): Array<{ handle: string; name: string }> {
  return [...new Map(senders.map((s) => [s.handle, s])).values()];
}

/** One reply line per distinct sender: the lines above show names, and a name can change hands before the reply is sent. */
export function senderHints(senders: Array<{ handle: string; name: string }>): string[] {
  return distinctSenders(senders).map((s) => `  reply to ${s.name}: rt chat dm ${s.handle} "..."`);
}

/**
 * Appended inside every wrapped message delivery. The host frames envelope
 * content as "Another Claude session sent a message" and steers replies
 * toward its own session-messaging tool, so the actual reply channel must
 * be restated at the moment the reflex fires, once per delivery. It is the
 * only agent-facing text that shows an id: a reply must reach the exact
 * sender even after its display name has passed to someone else.
 */
export function replySteer(senders: Array<{ handle: string; name: string }>): string {
  const distinct = distinctSenders(senders);
  const tail = "(never SendMessage; this arrived through rt chat)";
  if (distinct.length === 1) return `reply via rt chat post <room> "..." or rt chat dm ${distinct[0]!.handle} "..." ${tail}`;
  return [`reply via rt chat post <room> "..." or rt chat dm <id> "..." ${tail}`, ...senderHints(distinct)].join("\n");
}

/** The collapsed row's label: the sender for a single message, a count for a batched catch-up. */
export function deliveryLabel(items: Array<Pick<DeliveryItem, "room" | "dm" | "name">>): string {
  if (items.length === 1) {
    const item = items[0]!;
    return `${item.name} (${item.dm ? "dm" : `#${item.room}`})`;
  }
  return `rt chat (${items.length} messages)`;
}
```

- [ ] **Step 5: Wire the handler**

In `lib/daemon/handlers/chat.ts`, change the inbox import to:

```ts
import { deliverToInbox, deliveryLabel, renderDeliveries, replySteer, senderHints, wrapCrossSession } from "../inbox.ts";
```

In `deliverPost`, replace the two `items`/`content` lines with:

```ts
  const items = others.map((m) => ({ room: msg.room, dm: msg.dm, handle: m.handle, name: m.name, body: m.body, id: m.id }));
  const content = wrapCrossSession(deliveryLabel(items), `${renderDeliveries(items)}\n${replySteer(items)}`);
```

Replace `renderWelcome` (keep its doc comment, changing "handle" to "name" in its first sentence) with:

```ts
export function renderWelcome(
  name: string,
  rooms: string[],
  catchup: Array<{ room: string; lines: string[] }>,
  senders: Array<{ handle: string; name: string }> = [],
): string {
  const lines: string[] = [
    "[rt chat] This frame is for THIS session, from the rt daemon (not another agent).",
    `You're signed in to rt chat as ${name}.`,
    rooms.length ? `Rooms: ${rooms.map((r) => `#${r}`).join(", ")}` : "Rooms: none yet.",
    "Messages will arrive in your context automatically; you never need to poll or arm anything.",
    'Reply in a room with: rt chat post <room> "..."',
    'Reply privately with: rt chat dm <id> "..." (every delivery names the sender\'s id)',
    "Chat replies go through rt chat only, never SendMessage, even though deliveries arrive framed as coming from another session.",
    "rt chat read shows a room's history.",
    "See the rt:chat skill for the full etiquette.",
  ];
  for (const entry of catchup) {
    const capped = entry.lines.slice(0, WELCOME_CATCHUP_LIMIT);
    if (capped.length === 0) continue;
    lines.push(`#${entry.room} catch-up:`);
    for (const line of capped) lines.push(`  ${line}`);
  }
  if (senders.length > 0) lines.push("Reply to a catch-up sender with:", ...senderHints(senders));
  return lines.join("\n");
}
```

In `"chat:sign-in"`, replace the `catchup` and `welcomeContent` lines with:

```ts
      const catchup = peeked.map((r) => ({ room: r.room, lines: r.messages.map((m) => `${m.name}: ${m.body}`) }));
      const senders = peeked.flatMap((r) => r.messages.map((m) => ({ handle: m.handle, name: m.name })));
      const catchupCursors = peeked.map((r) => ({ room: r.room, upToId: r.messages[r.messages.length - 1]!.id }));
      const welcomeContent = wrapCrossSession("rt chat", renderWelcome(data.name, rooms, catchup, senders));
```

- [ ] **Step 6: Run the tests**

Run: `bun test lib/daemon/__tests__/inbox.test.ts lib/daemon/__tests__/chat-delivery.test.ts lib/daemon/__tests__/chat-handlers.test.ts`
Expected: PASS except the three exact `toEqual` claim/release assertions in `chat-delivery.test.ts` (Task 4).

- [ ] **Step 7: Commit**

```bash
git add lib/daemon/inbox.ts lib/daemon/handlers/chat.ts lib/daemon/__tests__/inbox.test.ts lib/daemon/__tests__/chat-delivery.test.ts lib/daemon/__tests__/chat-handlers.test.ts
git commit -m "chat: frames show names, reply hint names the sender id" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Every response carries names; receipts, desk alerts and invites read by name

**Files:**
- Modify: `lib/daemon/handlers/chat.ts` (`chat:join`, `chat:post`, `chat:dm`, `chat:ack`, `chat:claim`, `chat:release`, `chat:rooms`, `chat:invite`, `deliverReceipt`, `deliverAck`, `deliverClaim`, `postAndNotify`)
- Test: `lib/daemon/__tests__/chat-handlers.test.ts`, `lib/daemon/__tests__/chat-delivery.test.ts`

**Interfaces:**
- Consumes: `identityName(id, db?)`, `identityNames(ids, db?)` (lane 1a); `listMembers` returns `ChatMember.name` and `listBuddies` returns `PresenceRow.name` (lane 1a), so `chat:who` and `chat:buddies` need no handler change.
- Produces (frozen wire): `chat:join` data `name`; `chat:post`/`chat:dm` data `recipientNames` (parallel to `recipients`); `chat:ack` `authorName`; `chat:claim` `authorName`/`holderName`/`previousHolderName`; `chat:release` `holderName`; `chat:rooms` DM `participants.aName`/`bName`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/daemon/__tests__/chat-handlers.test.ts`:

```ts
test("responses carry display names next to every id", async () => {
  const h = freshHandlers();
  const remy = await h["chat:sign-in"]({ sessionId: "s1", baseHandle: "remy" });
  const kai = await h["chat:sign-in"]({ sessionId: "s2", baseHandle: "kai" });
  const eli = await h["chat:sign-in"]({ sessionId: "s3", baseHandle: "eli" });
  if (!remy.ok || !kai.ok || !eli.ok) throw new Error("sign-in failed");

  const joined = await h["chat:join"]({ room: "build", handle: remy.data.handle });
  if (!joined.ok) throw new Error(joined.error);
  expect(joined.data).toMatchObject({ handle: remy.data.handle, name: "remy" });
  await h["chat:join"]({ room: "build", handle: kai.data.handle });
  await h["chat:join"]({ room: "build", handle: eli.data.handle });

  const posted = await h["chat:post"]({ room: "build", handle: kai.data.handle, body: "who takes this?", mentions: [remy.data.handle] });
  if (!posted.ok) throw new Error(posted.error);
  expect(posted.data).toMatchObject({ recipients: [remy.data.handle], recipientNames: ["remy"] });

  const acked = await h["chat:ack"]({ id: posted.data.id, handle: remy.data.handle });
  if (!acked.ok) throw new Error(acked.error);
  expect(acked.data).toMatchObject({ author: kai.data.handle, authorName: "kai" });

  const claimed = await h["chat:claim"]({ id: posted.data.id, handle: remy.data.handle });
  if (!claimed.ok) throw new Error(claimed.error);
  expect(claimed.data).toMatchObject({ outcome: "claimed", author: kai.data.handle, authorName: "kai" });
  const held = await h["chat:claim"]({ id: posted.data.id, handle: remy.data.handle });
  if (!held.ok) throw new Error(held.error);
  expect(held.data).toMatchObject({ outcome: "held", authorName: "kai" });
  const lost = await h["chat:claim"]({ id: posted.data.id, handle: eli.data.handle });
  if (!lost.ok) throw new Error(lost.error);
  expect(lost.data).toMatchObject({ outcome: "lost", holder: remy.data.handle, holderName: "remy" });

  const released = await h["chat:release"]({ id: posted.data.id, handle: remy.data.handle });
  expect(released).toEqual({ ok: true, data: { holder: remy.data.handle, holderName: "remy" } });

  const dm = await h["chat:dm"]({ from: kai.data.handle, to: remy.data.handle, body: "hi", sessionId: "s2" });
  if (!dm.ok) throw new Error(dm.error);
  expect(dm.data).toMatchObject({ recipients: [remy.data.handle], recipientNames: ["remy"] });

  const rooms = await h["chat:rooms"]({ handle: kai.data.handle });
  if (!rooms.ok) throw new Error(rooms.error);
  const dmRow = rooms.data.rooms.find((r) => r.room === dm.data.room)!;
  const p = dmRow.participants!;
  expect(new Map([[p.a, p.aName], [p.b, p.bName]])).toEqual(new Map([[kai.data.handle, "kai"], [remy.data.handle, "remy"]]));

  const who = await h["chat:who"]({ room: "build" });
  if (!who.ok) throw new Error(who.error);
  expect(who.data.members.map((m) => m.name).sort()).toEqual(["eli", "kai", "remy"]);
});

test("the desk alert for a DM to the human is titled and worded with the sender's name", async () => {
  setSetting("chat.humanHandle", "matt", "user");
  drainNotifications();
  const h = freshHandlers();
  const remy = await h["chat:sign-in"]({ sessionId: "s1", baseHandle: "remy" });
  if (!remy.ok) throw new Error(remy.error);
  await h["chat:dm"]({ from: remy.data.handle, to: "matt", body: "ping", sessionId: "s1" });
  const [notice] = peekNotifications();
  expect(notice).toMatchObject({ title: "DM from remy", message: "remy: ping" });
});

test("chat:invite attributes the note to the inviter's name, never its id", async () => {
  const { h, seen } = inviteHarness((method, params) => {
    if (method === "agent.get") return agent("idle");
    if (method === "agent.prompt") return { type: "agent_prompted", agent: { ...agent("working").agent, text: params.text } };
    return new HerdrFakeError("invalid_request", method);
  });
  const remy = await h["chat:sign-in"]({ sessionId: "s-inv", baseHandle: "remy" });
  if (!remy.ok) throw new Error(remy.error);
  await h["chat:invite"]({ paneId: "w1:p1", room: "build", from: remy.data.handle, note: "you own vite" });
  const prompt = seen.find((s) => s.method === "agent.prompt")!;
  expect(prompt.params.text).toBe("/chat:join build note from remy: you own vite");
});
```

Append to `lib/daemon/__tests__/chat-delivery.test.ts`:

```ts
test("an ack receipt is labelled and worded with the acker's name, never its id", async () => {
  const calls: Array<[string, string]> = [];
  const sockA = fakeSocketPath();
  const inboxDeps: InboxDeps = {
    resolve: (sessionId) => (sessionId === "sess-a" ? { pid: process.pid, socketPath: sockA, status: "idle" } : null),
    deliver: async (socketPath, content) => { calls.push([socketPath, content]); return { ok: true }; },
  };
  const h = freshHandlers(inboxDeps);
  await h["chat:sign-in"]({ sessionId: "sess-a", continue: "a" });
  const bea = await h["chat:sign-in"]({ sessionId: "sess-b", baseHandle: "bea" });
  if (!bea.ok) throw new Error(bea.error);
  await settleWelcome(calls);
  await h["chat:join"]({ room: "general", handle: "a" });
  await h["chat:join"]({ room: "general", handle: bea.data.handle });
  const posted = await h["chat:post"]({ room: "general", handle: "a", body: "status?" });
  if (!posted.ok) throw new Error(posted.error);
  await h["chat:ack"]({ id: posted.data.id, handle: bea.data.handle });
  await waitFor(() => calls.length > 0);
  expect(calls[0]![1]).toBe(`<cross-session-message from-name="bea (ack)">\nbea acknowledged your message #${posted.data.id}: "status?"\n</cross-session-message>`);
});
```

In the same file, update the three exact assertions (legacy ids, so each name equals its id):

```ts
  expect(res).toEqual({ ok: true, data: { outcome: "claimed", author: "a", authorName: "a", room: "general" } });
  expect(took).toEqual({ ok: true, data: { outcome: "claimed", author: "a", authorName: "a", room: "general", previousHolder: "b", previousHolderName: "b" } });
  expect(await h["chat:release"]({ id, handle: "b" })).toEqual({ ok: true, data: { holder: "b", holderName: "b" } });
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/daemon/__tests__/chat-handlers.test.ts lib/daemon/__tests__/chat-delivery.test.ts -t "display names next to every id|desk alert for a DM|inviter's name|ack receipt is labelled|claim|release"`
Expected: FAIL (no `name`, `recipientNames`, `authorName`, `holderName`; receipts and invite show the id).

- [ ] **Step 3: Add names to the responses**

In `createChatHandlers`, after `resolveMention`, add:

```ts
  const namesOf = (ids: string[]): string[] => {
    const names = identityNames(ids, db);
    return ids.map((id) => names.get(id) ?? id);
  };
```

`"chat:join"`:

```ts
        const data = joinRoom({ room, handle, wakeOn, cwd, pane }, db);
        return { ok: true, data: { ...data, name: identityName(data.handle, db) } };
```

`"chat:post"` final line:

```ts
      return { ok: true, data: { ...posted, recipientNames: namesOf(posted.recipients), others } };
```

`"chat:dm"` final line:

```ts
      return { ok: true, data: { room, id: posted.id, recipients: posted.recipients, recipientNames: namesOf(posted.recipients) } };
```

`"chat:ack"` final line:

```ts
      return { ok: true, data: { author: res.author, authorName: identityName(res.author, db), room: res.room, already: res.already } };
```

`"chat:claim"`, from the `lost` branch to the end:

```ts
      if (res.outcome === "lost") {
        return { ok: true, data: { outcome: "lost", holder: res.holder, holderName: identityName(res.holder, db), claimedAt: res.claimedAt, expiresAt: res.expiresAt } };
      }
      if (res.outcome === "held") return { ok: true, data: { outcome: "held", author: res.author, authorName: identityName(res.author, db), room: res.room } };
      const { author, room, body, previousHolder } = res;
      const authorName = identityName(author, db);
      queueMicrotask(() => {
        deliverClaim(db, inboxDeps, log, { author, claimer: handle, messageId: id, body, previousHolder }).catch((err) => {
          log.warn({ err, id, handle }, "chat: claim delivery failed");
        });
      });
      return {
        ok: true,
        data: previousHolder
          ? { outcome: "claimed", author, authorName, room, previousHolder, previousHolderName: identityName(previousHolder, db) }
          : { outcome: "claimed", author, authorName, room },
      };
```

`"chat:release"` final line:

```ts
      return { ok: true, data: { holder: res.holder, holderName: identityName(res.holder, db) } };
```

`"chat:rooms"` whole body:

```ts
      const payload = rawPayload as Commands["chat:rooms"]["payload"];
      const listed = listRooms(resolveHandle(payload.handle, db), db, { includeArchived: payload.includeArchived === true })
        .map((room) => ({ room, dm: dmParticipants(room.room, db) }));
      const names = identityNames(listed.flatMap(({ dm }) => (dm ? [dm.a, dm.b] : [])), db);
      const rooms = listed.map(({ room, dm }) => {
        const defaultWake = roomDefaultWake(room.room, db);
        const withDefault = defaultWake ? { ...room, defaultWake } : room;
        if (!dm) return withDefault;
        return { ...withDefault, kind: "dm" as const, participants: { ...dm, aName: names.get(dm.a) ?? dm.a, bName: names.get(dm.b) ?? dm.b } };
      });
      return { ok: true, data: { rooms } };
```

`"chat:invite"`: change the `injectIntoPane` text argument to `inviteText(room, identityName(from, db), note)`.

- [ ] **Step 4: Name the receipts and the desk alert**

Replace `deliverReceipt`, `deliverAck` and `deliverClaim` with:

```ts
async function deliverReceipt(
  db: Database,
  deps: InboxDeps,
  log: Logger,
  args: { to: string; from: string; kind: "ack" | "claim"; text: string; messageId: number },
): Promise<void> {
  const { to, from, kind, text, messageId } = args;
  const presence = presenceForHandle(to, db);
  if (!presence || presence.signedOutAt !== undefined) return;
  const binding = deps.resolve(presence.sessionId);
  if (!binding || !inboxAlive(binding)) return;
  const result = await deps.deliver(binding.socketPath, wrapCrossSession(`${identityName(from, db)} (${kind})`, text));
  if (!result.ok) log.warn({ to, from, id: messageId, err: result.error }, `chat: ${kind} receipt push failed`);
}

function deliverAck(
  db: Database,
  deps: InboxDeps,
  log: Logger,
  args: { author: string; acker: string; messageId: number; body: string },
): Promise<void> {
  const { author, acker, messageId, body } = args;
  const text = `${identityName(acker, db)} acknowledged your message #${messageId}: "${previewBody(body)}"`;
  return deliverReceipt(db, deps, log, { to: author, from: acker, kind: "ack", text, messageId });
}

async function deliverClaim(
  db: Database,
  deps: InboxDeps,
  log: Logger,
  args: { author: string; claimer: string; messageId: number; body: string; previousHolder?: string },
): Promise<void> {
  const { author, claimer, messageId, body, previousHolder } = args;
  const preview = previewBody(body);
  const claimerName = identityName(claimer, db);
  const takeover = previousHolder ? ` (took over from ${identityName(previousHolder, db)})` : "";
  await deliverReceipt(db, deps, log, {
    to: author,
    from: claimer,
    kind: "claim",
    text: `${claimerName} claimed your message #${messageId}${takeover}: "${preview}"`,
    messageId,
  });
  if (!previousHolder) return;
  await deliverReceipt(db, deps, log, {
    to: previousHolder,
    from: claimer,
    kind: "claim",
    text: `${claimerName} took over #${messageId} from you: "${preview}"`,
    messageId,
  });
}
```

Keep the existing doc comments above `deliverReceipt` and `deliverClaim`.

In `postAndNotify`, inside the `try` of the desk block, replace the `title` line and the `notifyEnabled` message argument:

```ts
      const authorName = identityName(handle, db);
      const title = dm ? `DM from ${authorName}` : `#${room}`;
```

and pass `` `${authorName}: ${body}` `` as the third `notifyEnabled` argument.

- [ ] **Step 5: Run the tests**

Run: `bun test lib/daemon/__tests__/chat-handlers.test.ts lib/daemon/__tests__/chat-delivery.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/daemon/handlers/chat.ts lib/daemon/__tests__/chat-handlers.test.ts lib/daemon/__tests__/chat-delivery.test.ts
git commit -m "chat: name fields on every response, receipts and alerts by name" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The incident, at the daemon

**Files:**
- Create: `lib/daemon/__tests__/chat-identity-incident.test.ts`

**Interfaces:**
- Consumes: `createChatHandlers` (Tasks 1 to 4), `setKvValue` and `dmParticipants` from `lib/state/index.ts`, `AGENT_NAMES` from `lib/chat-names.ts` (the `chat`/`names` kv ledger is the LRU draw's input, frozen contract).

- [ ] **Step 1: Write the test**

```ts
/**
 * 2026-09-27: a new pane drew "remy", last held weeks earlier, and its
 * welcome handed it the old remy's DM with kai. The spec's first test,
 * against the real handlers and store: session B draws remy after A is
 * pruned and inherits nothing; kai's DM to "remy" reaches B; a reply sent
 * with A's reply-hint id still reaches A.
 */
import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AGENT_NAMES } from "../../chat-names.ts";
import { dmParticipants, openStateDb, setKvValue } from "../../state/index.ts";
import { setSetting } from "../../settings/write.ts";
import { createChatHandlers, type InboxDeps } from "../handlers/chat.ts";

const DAY_MS = 24 * 60 * 60_000;

/** inboxAlive checks process.kill(pid,0) and existsSync(socketPath) for real; `deliver` itself is faked. */
function fakeSocketPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "chat-incident-sock-"));
  const p = join(dir, "s.sock");
  writeFileSync(p, "");
  return p;
}

/** Stamps every pool name as drawn just now except `name`, so the least-recently-used draw lands on it. */
function forceNextDraw(db: ReturnType<typeof openStateDb>, name: string): void {
  const now = Date.now();
  setKvValue("chat", "names", Object.fromEntries(AGENT_NAMES.map((n) => [n, n === name ? 0 : now])), db);
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await Bun.sleep(5);
  }
}

beforeEach(() => {
  setSetting("chat.humanHandle", "matt", "user");
});

test("a recycled pool name never inherits the previous holder's rooms, DMs or catch-up, and replies bind to the id", async () => {
  expect(AGENT_NAMES).toContain("remy");
  const db = openStateDb(join(tmpdir(), `chat-incident-${process.pid}-${Date.now()}.db`));
  const sockets = new Map([["sess-a", fakeSocketPath()], ["sess-b", fakeSocketPath()], ["sess-kai", fakeSocketPath()]]);
  const frames = new Map<string, string[]>();
  const framesOf = (session: string): string[] => frames.get(session) ?? [];
  const inboxDeps: InboxDeps = {
    resolve: (sessionId) => {
      const socketPath = sockets.get(sessionId);
      return socketPath ? { pid: process.pid, socketPath, status: "idle" } : null;
    },
    deliver: async (socketPath, content) => {
      const session = [...sockets].find(([, path]) => path === socketPath)![0];
      frames.set(session, [...framesOf(session), content]);
      return { ok: true };
    },
  };
  const h = createChatHandlers({ db, emitEvent: () => 0, inboxDeps, retryDelayMs: 0 });

  forceNextDraw(db, "remy");
  const a = await h["chat:sign-in"]({ sessionId: "sess-a" });
  if (!a.ok) throw new Error(a.error);
  expect(a.data.name).toBe("remy");
  const kai = await h["chat:sign-in"]({ sessionId: "sess-kai", continue: "kai" });
  if (!kai.ok) throw new Error(kai.error);

  const aToKai = await h["chat:dm"]({ from: a.data.handle, to: "kai", body: "remy to kai", sessionId: "sess-a" });
  if (!aToKai.ok) throw new Error(aToKai.error);
  const aKaiRoom = aToKai.data.room;
  await h["chat:dm"]({ from: "kai", to: a.data.handle, body: "kai to remy", sessionId: "sess-kai" });
  await h["chat:join"]({ room: "rt", handle: a.data.handle });
  await h["chat:post"]({ room: "rt", handle: a.data.handle, body: "remy was here" });
  await waitFor(() => framesOf("sess-kai").some((f) => f.includes("remy to kai")));
  const kaiFrame = framesOf("sess-kai").find((f) => f.includes("remy to kai"))!;
  const hint = /rt chat dm (\S+) "\.\.\."/.exec(kaiFrame)?.[1];
  expect(hint).toBe(a.data.handle);
  expect(kaiFrame).toContain("[dm] remy #");

  await h["chat:sign-out"]({ sessionId: "sess-a" });
  db.run("UPDATE chat_presence SET signed_out_at = ? WHERE session_id = 'sess-a'", [Date.now() - 2 * DAY_MS]);

  forceNextDraw(db, "remy");
  const b = await h["chat:sign-in"]({ sessionId: "sess-b" });
  if (!b.ok) throw new Error(b.error);
  expect(b.data.name).toBe("remy");
  expect(b.data.handle).not.toBe(a.data.handle);
  expect(b.data.continued).toBe(false);

  const bRooms = await h["chat:rooms"]({ handle: b.data.handle });
  if (!bRooms.ok) throw new Error(bRooms.error);
  expect(bRooms.data.rooms).toEqual([]);
  await waitFor(() => framesOf("sess-b").length > 0);
  const welcome = framesOf("sess-b").join("\n");
  expect(welcome).toContain("You're signed in to rt chat as remy.");
  expect(welcome).not.toContain("catch-up:");
  expect(welcome).not.toContain("Reply to a catch-up sender");
  expect(welcome).not.toContain("remy to kai");
  expect(welcome).not.toContain("kai to remy");

  const pair = dmParticipants(aKaiRoom, db)!;
  expect([pair.a, pair.b].sort()).toEqual([a.data.handle, kai.data.handle].sort());

  const toNewRemy = await h["chat:dm"]({ from: "kai", to: "remy", body: "hello new remy", sessionId: "sess-kai" });
  if (!toNewRemy.ok) throw new Error(toNewRemy.error);
  expect(toNewRemy.data.room).not.toBe(aKaiRoom);
  expect(toNewRemy.data.recipients).toEqual([b.data.handle]);
  await waitFor(() => framesOf("sess-b").some((f) => f.includes("hello new remy")));
  expect(framesOf("sess-a").some((f) => f.includes("hello new remy"))).toBe(false);

  const toOldRemy = await h["chat:dm"]({ from: "kai", to: hint!, body: "for the old remy", sessionId: "sess-kai" });
  if (!toOldRemy.ok) throw new Error(toOldRemy.error);
  expect(toOldRemy.data.room).toBe(aKaiRoom);
  expect(toOldRemy.data.recipients).toEqual([a.data.handle]);
  await Bun.sleep(20);
  expect(framesOf("sess-b").some((f) => f.includes("for the old remy"))).toBe(false);
});
```

- [ ] **Step 2: Run it**

Run: `bun test lib/daemon/__tests__/chat-identity-incident.test.ts`
Expected: PASS once Tasks 1 to 4 and lane 1a are in. On `main` before this change (handle-keyed), the same scenario fails at `expect(b.data.handle).not.toBe(a.data.handle)`; if it passes before Tasks 1 to 4 are in, the test is not exercising the recycle and must be fixed before moving on.

- [ ] **Step 3: Commit**

```bash
git add lib/daemon/__tests__/chat-identity-incident.test.ts
git commit -m "chat: pin the recycled-name incident at the daemon" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Pane rows carry the presence name

**Files:**
- Modify: `lib/daemon/handlers/pane.ts:124-126` (`paneRow`)
- Modify: `commands/pane.ts:52-58` (`renderPane`)
- Test: `lib/daemon/__tests__/pane-handlers.test.ts`, `commands/__tests__/pane.test.ts`

**Interfaces:**
- Consumes: store `PresenceRow.name` (lane 1a) through `listBuddies`.
- Produces: `ChatPane.presence.name` (frozen wire).

- [ ] **Step 1: Convert and extend the handler tests**

The existing sign-ins keep `baseHandle` (each now mints an id); the three assertions that compare `presence.handle` to a literal compare the name instead. In `lib/daemon/__tests__/pane-handlers.test.ts`: `toMatchObject({ handle: "meg", rooms: ["build"], status: "live" })` becomes `toMatchObject({ name: "meg", rooms: ["build"], status: "live" })`, `.presence?.handle).toBe("fred")` becomes `.presence?.name).toBe("fred")`, and `bgRow.presence?.handle).toBe("worker")` becomes `bgRow.presence?.name).toBe("worker")`.

Append to `lib/daemon/__tests__/pane-handlers.test.ts`:

```ts
test("pane:list presence carries the display name beside the id", async () => {
  const { chat, pane } = harness(
    (method) => (method === "session.snapshot" ? SNAPSHOT : new HerdrFakeError("invalid_request", method)),
    { registryDeps: fakeRegistryDeps({ "sess-signed": "busy" }) },
  );
  const signed = await chat["chat:sign-in"]({ sessionId: "sess-signed", baseHandle: "meg", cwd: "/tmp/acme", pane: "w1:p1" });
  if (!signed.ok) throw new Error(signed.error);
  expect(signed.data.handle).not.toBe("meg");
  const res = await pane["pane:list"]({});
  if (!res.ok) throw new Error(res.error);
  expect(res.data.panes.find((p) => p.paneId === "w1:p1")!.presence).toMatchObject({ handle: signed.data.handle, name: "meg" });
});
```

Append to `commands/__tests__/pane.test.ts`:

```ts
test("pane list prints the presence name, never the id, and hides a title equal to the name", async () => {
  const minted = { ...PANE, title: "meg", presence: { handle: "meg.k3f9", name: "meg", status: "live", rooms: ["build"] } };
  replies = { "pane:list": { ok: true, data: { panes: [minted] } } };
  const plain = await run(paneList, []);
  expect(plain.stdout).toContain("meg (live)");
  expect(plain.stdout).not.toContain("meg.k3f9");
  expect(plain.stdout).not.toContain("· meg");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/daemon/__tests__/pane-handlers.test.ts commands/__tests__/pane.test.ts -t "display name beside the id|presence name"`
Expected: FAIL (`presence` has no `name`; the CLI prints `meg.k3f9`).

- [ ] **Step 3: Implement**

`lib/daemon/handlers/pane.ts`, in `paneRow`:

```ts
    presence: presence
      ? { handle: presence.handle, name: presence.name, status: presence.status, rooms: listRooms(presence.handle, ctx.db).map((r) => r.room) }
      : undefined,
```

`commands/pane.ts`, the head of `renderPane`:

```ts
function renderPane(p: ChatPane, idWidth: number): string {
  const name = p.presence ? (p.presence.name ?? p.presence.handle) : undefined;
  const who = p.presence ? `${name} (${p.presence.status})` : "not signed in";
  const where = [p.repo, p.branch].filter(Boolean).join(" · ");
  const title = p.title && p.title !== name ? ` · ${p.title}` : "";
```

(the `rooms` line and the return are unchanged).

- [ ] **Step 4: Run the tests**

Run: `bun test lib/daemon/__tests__/pane-handlers.test.ts commands/__tests__/pane.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/handlers/pane.ts commands/pane.ts lib/daemon/__tests__/pane-handlers.test.ts commands/__tests__/pane.test.ts
git commit -m "pane: presence rows carry and print the display name" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Agent records carry the reserved identity's name

**Files:**
- Modify: `lib/daemon/handlers/agent.ts` (import; `agent:start`, `agent:resume`, `agent:get`, `agent:list` responses)
- Modify: `commands/agent.ts:190-205` (`renderRecord`, `__test__`)
- Test: `lib/daemon/__tests__/agent-handlers.test.ts`, `commands/__tests__/agent.test.ts`

**Interfaces:**
- Consumes: `reserveAgentHandle(db?, now?): string` now returns a minted id (lane 1a); `identityName(id, db?)`.
- Produces: every `AgentRecord` response carries `name` when it has a `handle` (frozen wire `AgentRecord.name?`). `chat:sign-in` already continues `getAgent(sessionId).handle` (Task 1).

- [ ] **Step 1: Write the failing tests**

In `lib/daemon/__tests__/agent-handlers.test.ts`, in `"agent:start herdr reserves a handle not held by live presence, ..."`, replace the three handle assertions with:

```ts
  expect(res.data.handle).toBeTruthy();
  expect(AGENT_NAMES).toContain(res.data.name!);
  expect(res.data.name).not.toBe(held);
  expect(res.data.handle!.startsWith(`${res.data.name}.`)).toBe(true);
```

In `"agent:start with handle records it, reserves no pool handle, and keeps inbound accept without --name"`, add after `expect(res.data.handle).toBe("job-a");`:

```ts
  expect(res.data.name).toBe("job-a");
```

In `"agent:start headless never reserves a handle or passes --name/inline --settings"`, add after `expect(res.data.handle).toBeUndefined();`:

```ts
  expect(res.data.name).toBeUndefined();
```

Append:

```ts
test("agent:get and agent:list carry the reserved identity's display name beside its id", async () => {
  const h = fresh({ runner: okRunner([]) });
  const res = await h["agent:start"]({ repo: REPO, cwd: "/tmp/x", prompt: "hi", surface: "herdr" });
  if (!res.ok) throw new Error(res.error);
  const got = await h["agent:get"]({ id: res.data.id });
  if (!got.ok) throw new Error(got.error);
  expect(got.data).toMatchObject({ handle: res.data.handle, name: res.data.name });
  const listed = await h["agent:list"]({});
  if (!listed.ok) throw new Error(listed.error);
  expect(listed.data.agents.find((a) => a.id === res.data.id)).toMatchObject({ handle: res.data.handle, name: res.data.name });
});
```

In `commands/__tests__/agent.test.ts` append (add `import type { AgentRecord } from "../../packages/rt-client/src/index.ts";`):

```ts
test("renderRecord shows the chat name, never the id", () => {
  const rec = { id: "ag-1", repo: "gh:m4ttstack/rt", cwd: "/tmp", provider: "claude", surface: "herdr", sessionId: "s1", createdAt: 1, handle: "remy.k3f9", name: "remy" } as AgentRecord;
  const line = __test__.renderRecord(rec);
  expect(line).toContain("chat remy");
  expect(line).not.toContain("remy.k3f9");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/daemon/__tests__/agent-handlers.test.ts commands/__tests__/agent.test.ts -t "reserves a handle|with handle records it|headless never reserves|display name beside its id|renderRecord"`
Expected: FAIL (`name` is undefined; `renderRecord` is not on `__test__`).

- [ ] **Step 3: Implement**

`lib/daemon/handlers/agent.ts`: add `identityName` to the `../../state/index.ts` import, and above `createAgentHandlers`:

```ts
function withName(rec: AgentRecord, db: Database): AgentRecord & { name?: string } {
  return rec.handle === undefined ? rec : { ...rec, name: identityName(rec.handle, db) };
}
```

In `"agent:start"`, change the successful `return res;` after `updateAgentPane` to:

```ts
        return res.ok ? { ok: true, data: withName(res.data, db) } : res;
```

In `"agent:resume"`: `return { ok: true, data: withName(getAgent(rec.id, db) ?? attempt, db) };`

In `"agent:get"`: `return rec ? { ok: true, data: withName(rec, db) } : { ok: false, error: `no agent record for "${payload.id}"` };`

In `"agent:list"`: `return { ok: true, data: { agents: listAgents({ ...(payload.repo !== undefined && { repo: payload.repo }) }, db).map((r) => withName(r, db)) } };`

`commands/agent.ts`, in `renderRecord`, replace the handle bit:

```ts
    r.handle && `chat ${r.name ?? r.handle}`,
```

and extend the seam: `export const __test__ = { parseStartArgs, parseResumeArgs, withCallerAccount, renderRecord };`

- [ ] **Step 4: Run the tests**

Run: `bun test lib/daemon/__tests__/agent-handlers.test.ts commands/__tests__/agent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/handlers/agent.ts commands/agent.ts lib/daemon/__tests__/agent-handlers.test.ts commands/__tests__/agent.test.ts
git commit -m "agent: records carry the reserved identity's display name" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Herd shepherds and workers get identities of their own

**Files:**
- Modify: `lib/daemon/handlers/herd.ts` (`HerdDeps`, `recordChatSession`, `baseHandleOf` removed, `statusData`, `herd:start`, `herd:resume`, `herd:list`, `herd:spawn`)
- Modify: `lib/daemon/command-router.ts:205-215` (herd deps wiring)
- Modify: `commands/herd.ts` (`renderStatus`, new `renderResumed`, `resume`)
- Test: `lib/daemon/__tests__/herd-handlers.test.ts`, `lib/__tests__/herd-cli.test.ts`

**Interfaces:**
- Consumes: `mintIdentity({ base, name, sessionId: null }, db?): IdentityRow`, `identityNames(ids, db?)` (lane 1a); `chat:sign-in` with `continue` and `chat:sign-out` (Task 1).
- Produces: `HerdDeps` loses `presenceHandleForSession` and gains
  ```ts
  presenceIdentityForSession: (session: string) => { handle: string; baseHandle: string; name: string } | null;
  mintWorkerId: (job: string) => string;
  identityNames: (ids: Iterable<string>) => Map<string, string>;
  ```
  and its `chat` pick adds `"chat:sign-out"`. `herd:status` and `herd:list` answer `HerdInfo.shepherdName`; status jobs carry `HerdJobInfo.handleName`. `SYSTEM_HANDLE` (`herdr`) is untouched.

- [ ] **Step 1: Update the test harness**

In `lib/daemon/__tests__/herd-handlers.test.ts`, replace the fake `"chat:sign-in"` in `harness` and add `"chat:sign-out"`:

```ts
    "chat:sign-in": async (p: any) => {
      chatCalls.push({ verb: "sign-in", payload: p });
      order.push("chat:sign-in");
      const handle = p.continue ?? p.baseHandle ?? "shepherd";
      const name = handle.replace(/\.[a-z0-9]+$/, "");
      return { ok: true as const, data: { handle, baseHandle: name, name, continued: p.continue !== undefined, reclaimed: false, sessionId: p.sessionId, room: p.room ?? null } };
    },
    "chat:sign-out": async (p: any) => { chatCalls.push({ verb: "sign-out", payload: p }); return { ok: true as const, data: { sessionId: p.sessionId } }; },
```

In the `deps` object, replace `presenceHandleForSession: () => null,` with:

```ts
    presenceIdentityForSession: () => null,
    mintWorkerId: (job: string) => `${job}.w001`,
    identityNames: (ids: Iterable<string>) => new Map([...ids].map((id) => [id, id.replace(/\.[a-z0-9]+$/, "")])),
```

Replace every `presenceHandleForSession` override:

```ts
// "a session that already holds a handle is not re-signed-in; the herd uses that handle"
harness({ presenceIdentityForSession: (s) => (s === "sess-shep" ? { handle: "kai", baseHandle: "kai", name: "kai" } : null) })

// "a sign-in that hands back a renamed handle is what the join, the row, and the response carry"
harness({ chat, presenceIdentityForSession: () => ({ handle: "shepherd", baseHandle: "shepherd", name: "shepherd" }) })
```

and in that last test's fake chat, make `"chat:sign-in"` return `{ handle: "job-a-2", baseHandle: "job-a", name: "job-a-2", continued: false, reclaimed: false, sessionId: p.sessionId, room: null }`.

- [ ] **Step 2: Write the failing herd tests**

Replace `"resume signs the new session in under the stored handle's base and joins the room"` and `"resume on a session that already holds a handle joins as that handle without signing in"` with:

```ts
  test("resume signs the prior shepherd session out, then continues the stored shepherd id", async () => {
    const { h, store, chatCalls, herd, room } = await started();
    store.setShepherd(herd, { session: "sess-shep", handle: "shepherd.k3f9" });
    chatCalls.length = 0;
    const res = await h["herd:resume"]({ herd, session: "sess-shep-2" });
    if (!res.ok) throw new Error(res.error);
    const identity = chatCalls.filter((c) => c.verb !== "rooms");
    expect(identity.map((c) => c.verb)).toEqual(["sign-out", "sign-in", "join"]);
    expect(identity[0]!.payload).toEqual({ sessionId: "sess-shep" });
    expect(identity[1]!.payload).toMatchObject({ sessionId: "sess-shep-2", continue: "shepherd.k3f9", noRoom: true });
    expect(identity[1]!.payload.baseHandle).toBeUndefined();
    expect(identity[2]!.payload).toMatchObject({ room, handle: "shepherd.k3f9" });
    expect(res.data.handle).toBe("shepherd.k3f9");
    expect(store.get(herd)!.shepherdHandle).toBe("shepherd.k3f9");
    expect(readChatSession("sess-shep-2")).toMatchObject({ handle: "shepherd.k3f9", name: "shepherd" });
  });

  test("resume continues the shepherd id even when the new session already holds its own", async () => {
    const { h, store, chatCalls, herd } = await started({ presenceIdentityForSession: (s) => (s === "sess-shep-2" ? { handle: "kai.k3f9", baseHandle: "kai", name: "kai" } : null) });
    chatCalls.length = 0;
    const res = await h["herd:resume"]({ herd, session: "sess-shep-2" });
    if (!res.ok) throw new Error(res.error);
    expect(chatCalls.find((c) => c.verb === "sign-in")!.payload).toMatchObject({ sessionId: "sess-shep-2", continue: "shepherd" });
    expect(res.data.handle).toBe("shepherd");
    expect(store.get(herd)!.shepherdHandle).toBe("shepherd");
  });

  test("resume from the shepherd's own session signs nothing out", async () => {
    const { h, chatCalls, herd } = await started();
    chatCalls.length = 0;
    const res = await h["herd:resume"]({ herd, session: "sess-shep" });
    if (!res.ok) throw new Error(res.error);
    expect(chatCalls.filter((c) => c.verb === "sign-out")).toEqual([]);
    expect(chatCalls.find((c) => c.verb === "sign-in")!.payload).toMatchObject({ sessionId: "sess-shep", continue: "shepherd" });
  });

  test("status and list carry the shepherd's and each job's display name next to the ids", async () => {
    const { h, store, herd } = await started();
    store.setShepherd(herd, { session: "sess-shep", handle: "shepherd.k3f9" });
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a.w001", status: "active", pane: "w9:p1" });
    const status = await h["herd:status"]({ herd });
    if (!status.ok) throw new Error(status.error);
    expect(status.data.herd).toMatchObject({ shepherdHandle: "shepherd.k3f9", shepherdName: "shepherd" });
    expect(status.data.jobs[0]).toMatchObject({ handle: "job-a.w001", handleName: "job-a" });
    const list = await h["herd:list"]({});
    if (!list.ok) throw new Error(list.error);
    expect(list.data.herds.find((r) => r.id === herd)).toMatchObject({ shepherdHandle: "shepherd.k3f9", shepherdName: "shepherd" });
  });
```

In the `herd:spawn` describe, update `"provisions, starts the agent ..."`: `handle: "job-a"` in the `agentCalls[0]` expectation becomes `handle: "job-a.w001"`; replace the sign-in, join and job-row expectations with:

```ts
    expect(signIn.payload).toMatchObject({ sessionId: "sess-w1", continue: "job-a.w001", pane: "w9:p1", noRoom: true });
    expect(signIn.payload.baseHandle).toBeUndefined();
    expect(chatCalls.filter((c) => c.verb === "join")[1]!.payload).toMatchObject({ room, handle: "job-a.w001", pane: "w9:p1" });
    expect(store.getJob(herd, "job-a")).toMatchObject({ worktree: "/w/job-a", branch: "job-a", tree: "job-a", pane: "w9:p1", agentSession: "sess-w1", agentId: "ag-1", handle: "job-a.w001", status: "spawning", disposable: false });
```

Update the three session-file tests:

```ts
    // "a spawned worker gets a chat session file, ..."
    expect(readChatSession("sess-w1")).toMatchObject({ sessionId: "sess-w1", handle: "job-a.w001", baseHandle: "job-a", name: "job-a" });

    // "an existing file naming the same handle is kept, room and all" (setup line)
    writeChatSession({ sessionId: "sess-w1", handle: "job-a.w001", baseHandle: "job-a", name: "job-a", signedInAt: 1, room: "r" });
    // (its assertion)
    expect(readChatSession("sess-w1")).toMatchObject({ handle: "job-a.w001", room: "r", signedInAt: 1 });

    // "a stale file naming another handle is rewritten to the signed-in handle, keeping its room"
    expect(readChatSession("sess-w1")).toMatchObject({ handle: "job-a.w001", baseHandle: "job-a", name: "job-a", room: "r" });
```

Append to the `herd:spawn` describe:

```ts
  test("every spawn of a job mints a fresh worker id, so a respawn never inherits the last worker's DMs", async () => {
    let n = 0;
    const hx = harness({ mintWorkerId: (job) => `${job}.w00${++n}` });
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    const first = await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", brief: "b", dir: "/t" });
    if (!first.ok) throw new Error(first.error);
    const second = await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", dir: "/t" });
    if (!second.ok) throw new Error(second.error);
    expect(hx.agentCalls.map((c) => c.handle)).toEqual(["job-a.w001", "job-a.w002"]);
    expect(hx.store.getJob(s.data.herd, "job-a")!.handle).toBe("job-a.w002");
  });
```

In `lib/__tests__/herd-cli.test.ts`, add `shepherdName: "shep"` to the `statusData` herd fixture and `handleName: "job-a"` to the `job` fixture, change the import line to also take `renderResumed`, and append to `describe("renderStatus")`:

```ts
  test("the dead-pane remedy DMs the worker by name, never by id", () => {
    const data = statusData({ jobs: [job({ lastGate: "gt-9", lastGateStatus: "answered", lastGateDelivery: "dead-pane", handle: "job-a.w001", handleName: "job-a" })] });
    const out = renderStatus(data);
    expect(out).toContain("worker not woken: rt chat dm job-a");
    expect(out).not.toContain("job-a.w001");
  });

  test("renderResumed names the shepherd by name", () => {
    const status = statusData({ herd: { ...statusData({}).herd, shepherdHandle: "shep.k3f9", shepherdName: "shep" } });
    const line = renderResumed("hd-1", { subscription: "sub-1", gates: [], unread: 2, status, handle: "shep.k3f9" });
    expect(line).toBe("resumed hd-1 as shep: subscription sub-1, 0 open gate(s), 2 unread");
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `bun test lib/daemon/__tests__/herd-handlers.test.ts lib/__tests__/herd-cli.test.ts`
Expected: FAIL (resume still signs in with `baseHandle`; no `shepherdName`/`handleName`; spawn passes `handle: "job-a"`; `renderResumed` is not exported).

- [ ] **Step 4: Implement the herd handler**

In `lib/daemon/handlers/herd.ts`, in `HerdDeps`, change the `chat` pick and replace the `presenceHandleForSession` member:

```ts
  chat: Pick<ReturnType<typeof createChatHandlers>, "chat:sign-in" | "chat:sign-out" | "chat:join" | "chat:post" | "chat:archive" | "chat:rooms">;
  /** The chat identity a session already holds, or null; wired from `presenceForSession` in lib/state/presence-store.ts. */
  presenceIdentityForSession: (session: string) => { handle: string; baseHandle: string; name: string } | null;
  /** Mints a worker identity whose display name is the job name, bound to no session yet; wired from `mintIdentity` in lib/state/identity-store.ts. */
  mintWorkerId: (job: string) => string;
  /** Display names for ids, every missing id mapping to itself; wired from `identityNames` in lib/state/identity-store.ts. */
  identityNames: (ids: Iterable<string>) => Map<string, string>;
```

Replace `recordChatSession` (keep its doc comment):

```ts
function recordChatSession(log: Logger, sessionId: string, identity: { handle: string; baseHandle: string; name: string }): void {
  try {
    const existing = readChatSession(sessionId);
    if (existing?.handle === identity.handle && existing.name === identity.name) return;
    writeChatSession({ ...existing, sessionId, ...identity, signedInAt: Date.now() });
  } catch (err) {
    log.warn({ err, sessionId }, "herd: could not write the chat session file; chat_* tools will not resolve this session");
  }
}
```

Delete `baseHandleOf` and its comment.

In `statusData`, read the jobs once and name them. Replace `const jobs = store.jobs(herdId).map((j: HerdJobRow) => {` with:

```ts
    const jobRows = store.jobs(herdId);
    const names = deps.identityNames([herd.shepherdHandle, ...jobRows.map((j) => j.handle)]);
    const jobs = jobRows.map((j: HerdJobRow) => {
```

add `handleName: names.get(j.handle) ?? j.handle,` directly after `...j,` in that object, and change the return's first line to:

```ts
      herd: { ...herd, shepherdName: names.get(herd.shepherdHandle) ?? herd.shepherdHandle }, jobs, unread,
```

`"herd:start"`, replace the block from `let handle = deps.presenceHandleForSession(session);` through `recordChatSession(...)` with:

```ts
      let identity = deps.presenceIdentityForSession(session);
      if (!identity) {
        const signIn = await deps.chat["chat:sign-in"]({ sessionId: session, baseHandle: SHEPHERD_HANDLE, noRoom: true });
        if (!signIn.ok) return signIn;
        identity = { handle: signIn.data.handle, baseHandle: signIn.data.baseHandle, name: signIn.data.name };
      }
      const handle = identity.handle;
      recordChatSession(log, session, identity);
```

`"herd:resume"`, replace the block from the comment `// Presence binds a handle to a session` through `recordChatSession(...)` with:

```ts
      // signIn refuses to continue an id live in another session; resume is
      // the one takeover, so the replaced shepherd session gives it up first.
      if (herd.shepherdSession !== session) {
        const out = await deps.chat["chat:sign-out"]({ sessionId: herd.shepherdSession });
        if (!out.ok) log.warn({ herd: herdId, error: out.error }, "herd resume: could not sign the prior shepherd session out");
      }
      const signIn = await deps.chat["chat:sign-in"]({ sessionId: session, continue: herd.shepherdHandle, noRoom: true });
      if (!signIn.ok) return signIn;
      if (!signIn.data.continued) log.warn({ herd: herdId, expected: herd.shepherdHandle, got: signIn.data.handle }, "herd resume: the shepherd id is live elsewhere; resumed under a new one");
      const handle = signIn.data.handle;
      recordChatSession(log, session, { handle, baseHandle: signIn.data.baseHandle, name: signIn.data.name });
```

`"herd:list"`:

```ts
      const all = (raw as { all?: unknown } | undefined)?.all === true;
      const rows = all ? store.list() : store.list({ status: "active" });
      const names = deps.identityNames(rows.map((h) => h.shepherdHandle));
      return { ok: true, data: { herds: rows.map((h) => ({ ...h, shepherdName: names.get(h.shepherdHandle) ?? h.shepherdHandle, jobs: store.jobs(h.id).length })) } };
```

`"herd:spawn"`: directly before the first `store.upsertJob(...)` add

```ts
      const workerId = deps.mintWorkerId(name);
```

then, in that method, replace `handle: name` with `handle: workerId` in both `store.upsertJob` calls and in the `agent:start` payload, and replace the sign-in block with:

```ts
      // Chat identity first: the trust wait can spend its whole budget, and a
      // worker with no handle can neither report nor be reached meanwhile.
      const signIn = await deps.chat["chat:sign-in"]({ sessionId: rec.sessionId, continue: workerId, pane: rec.paneId, cwd: worktree, noRoom: true });
      if (!signIn.ok) log.warn({ herd: herdId, job: name, error: signIn.error }, "herd: worker chat sign-in failed; reports will not deliver until it signs in");
      const handle = signIn.ok ? signIn.data.handle : workerId;
      if (signIn.ok) recordChatSession(log, rec.sessionId, { handle, baseHandle: signIn.data.baseHandle, name: signIn.data.name });
      const joined = await deps.chat["chat:join"]({ room: herd.room, handle, pane: rec.paneId, cwd: worktree });
      if (!joined.ok) log.warn({ herd: herdId, job: name, error: joined.error }, "herd: worker room join failed");
      if (handle !== workerId) store.upsertJob({ herd: herdId, name, worktree, branch, tree, handle, status: "spawning" });
```

- [ ] **Step 5: Wire the router**

In `lib/daemon/command-router.ts`, add `import { identityNames, mintIdentity } from "../state/identity-store.ts";` beside the `presenceForSession` import, and replace the `presenceHandleForSession` line in `createHerdHandlers({...})` with:

```ts
    presenceIdentityForSession: (session) => {
      const row = presenceForSession(session, opts.stateDb);
      return row ? { handle: row.handle, baseHandle: row.baseHandle, name: row.name } : null;
    },
    mintWorkerId: (job) => mintIdentity({ base: job, name: job, sessionId: null }, opts.stateDb).id,
    identityNames: (ids) => identityNames(ids, opts.stateDb),
```

- [ ] **Step 6: Print names in the herd CLI**

In `commands/herd.ts`, in `renderStatus`, change the `notWoken` line's DM target:

```ts
    const notWoken = terminal && j.lastGateDelivery === "dead-pane" ? `  gate ${j.lastGate} ${j.lastGateStatus}, worker not woken: rt chat dm ${j.handleName ?? j.handle}` : "";
```

Add above `resume`:

```ts
export function renderResumed(herd: string, data: Commands["herd:resume"]["data"]): string {
  const name = data.status.herd.shepherdName ?? data.handle;
  return `resumed ${herd} as ${name}: subscription ${data.subscription}, ${data.gates.length} open gate(s), ${data.unread} unread`;
}
```

(import `type Commands` from `../packages/rt-client/src/index.ts` if the file does not already), and in `resume` replace the `console.log(\`resumed ...\`)` line with `console.log(renderResumed(herd, data));`.

- [ ] **Step 7: Run the tests**

Run: `bun test lib/daemon/__tests__/herd-handlers.test.ts lib/__tests__/herd-cli.test.ts lib/daemon/__tests__/router-no-db-key.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the neighbouring herd suites**

Run: `bun test lib/daemon/__tests__/herd-lifecycle.test.ts lib/daemon/__tests__/herd-watchdog.test.ts lib/daemon/__tests__/herd-watchdog-adapters.test.ts lib/daemon/__tests__/herd-store.test.ts`
Expected: PASS with no edits.

- [ ] **Step 9: Confirm lifecycle and watchdog need nothing**

Run: `rg -n "shepherdHandle|job\.handle|SYSTEM_HANDLE" lib/daemon/herd-lifecycle.ts lib/daemon/herd-watchdog.ts lib/daemon/herd-watchdog-adapters.ts`
Expected: only `mentions: [shepherd]`, `unreadDmMentionsFor(job.handle)`, `unreadDmMentionsFor(herd.shepherdHandle)` and the `SYSTEM_HANDLE` import; every body string uses `job.name`. No change.

- [ ] **Step 10: Commit**

```bash
git add lib/daemon/handlers/herd.ts lib/daemon/command-router.ts commands/herd.ts lib/daemon/__tests__/herd-handlers.test.ts lib/__tests__/herd-cli.test.ts
git commit -m "herd: mint shepherd and worker identities, resume continues the shepherd id" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The CLI signs in by continuation and prints names

**Files:**
- Modify: `lib/chat-session.ts` (`ChatSession.name`, `sessionName`)
- Modify: `commands/chat.ts` (sign-in request, `--pane` sign-in, session file writes, every printed handle)
- Test: `lib/__tests__/chat-session.test.ts`, `commands/__tests__/chat.test.ts`

**Interfaces:**
- Consumes: `chat:sign-in` payload `continue` and data `name` (Task 1); response name fields (Task 4); rt-client `name`/`aName`/`bName`/`recipientNames`/`authorName`/`holderName`/`previousHolderName` (lane 2 types; the CLI falls back to the id when a field is missing).
- Produces: `ChatSession` gains `name?: string` (older files lack it); `sessionName(s: Pick<ChatSession, "handle" | "name">): string`. `rt chat sign-in --json`, with or without `--pane`, prints `{ ok, handle, name, room, continued }` (frozen contract). `__test__.resolveSignInRequest(args): { baseHandle?: string; continue?: string }` replaces `resolveSignInBaseHandle`. New sign-in flag `--name <x>`: a fresh identity with display name `x`, never a continuation (sends `baseHandle`); it is how the MCP `chat_sign_in` `as` reaches the daemon (Task 10, ruling 6).

- [ ] **Step 1: Write the failing session-file test**

Append inside `describe("chat-session")` in `lib/__tests__/chat-session.test.ts` (add `sessionName` to the import):

```ts
  test("writeChatSession round-trips name, and sessionName falls back to the handle for an older file", () => {
    writeChatSession({ sessionId: "s1", handle: "remy.k3f9", baseHandle: "remy", name: "remy", signedInAt: 1 });
    const read = readChatSession("s1")!;
    expect(read.name).toBe("remy");
    expect(sessionName(read)).toBe("remy");
    expect(sessionName({ handle: "kai" })).toBe("kai");
  });
```

- [ ] **Step 2: Write the failing CLI tests**

In `commands/__tests__/chat.test.ts`, replace what remains of `"resolveSignInBaseHandle: ..."` with:

```ts
  test("resolveSignInRequest: --as continues, --name and chat.handle ask for a fresh identity with that name, neither draws", () => {
    expect(__test__.resolveSignInRequest(["--as", "kai"])).toEqual({ continue: "kai" });
    expect(__test__.resolveSignInRequest(["--name", "bob"])).toEqual({ baseHandle: "bob" });
    expect(__test__.resolveSignInRequest([])).toEqual({});
    setSetting("chat.handle", "picked", "user");
    expect(__test__.resolveSignInRequest([])).toEqual({ baseHandle: "picked" });
    expect(__test__.resolveSignInRequest(["--as", "kai"])).toEqual({ continue: "kai" });
  });
```

Replace `"sign-in without --as draws a first name from the pool and keeps it on a repeat sign-in"` with:

```ts
  test("sign-in without --as draws a pool name and keeps the same identity on a repeat sign-in", async () => {
    const first = await runChat(["sign-in", "--no-room", "--session", "s7"]);
    const name = /signed in as (\S+)/.exec(first)?.[1] ?? "";
    expect(AGENT_NAMES).toContain(name);
    const id = JSON.parse(readFileSync(sessionFilePath("s7"), "utf8")).handle;
    const again = await runChat(["sign-in", "--no-room", "--session", "s7"]);
    expect(again).toMatch(new RegExp(`signed in as ${name}\\b`));
    expect(JSON.parse(readFileSync(sessionFilePath("s7"), "utf8")).handle).toBe(id);
  });
```

Append inside the existing describe block whose title ends in "sign-in / sign-out (presence)":

```ts
  test("a new session in the same herdr pane signs in as a new identity", async () => {
    process.env.HERDR_PANE_ID = "wAR:p3";
    await runChat(["sign-in", "--no-room", "--session", "sp1"]);
    const first = JSON.parse(readFileSync(sessionFilePath("sp1"), "utf8"));
    await runChat(["sign-out", "--session", "sp1"]);
    await runChat(["sign-in", "--no-room", "--session", "sp2"]);
    const second = JSON.parse(readFileSync(sessionFilePath("sp2"), "utf8"));
    expect(second.handle).not.toBe(first.handle);
  });

  test("sign-in --as sends continue, never baseHandle, and the session file carries the name", async () => {
    const out = JSON.parse(await runChat(["sign-in", "--as", "remy", "--no-room", "--session", "s11", "--json"]));
    expect(out).toMatchObject({ ok: true, name: "remy", room: null, continued: false });
    const sent = seen.find((s) => s.cmd === "chat:sign-in")!.payload as Record<string, unknown>;
    expect(sent.continue).toBe("remy");
    expect(sent.baseHandle).toBeUndefined();
    expect(JSON.parse(readFileSync(sessionFilePath("s11"), "utf8"))).toMatchObject({ handle: out.handle, name: "remy" });
  });

  test("sign-in --name sends baseHandle, never continue", async () => {
    const out = JSON.parse(await runChat(["sign-in", "--name", "bob", "--no-room", "--session", "s13", "--json"]));
    expect(out).toMatchObject({ ok: true, name: "bob", continued: false });
    const sent = seen.find((s) => s.cmd === "chat:sign-in")!.payload as Record<string, unknown>;
    expect(sent.baseHandle).toBe("bob");
    expect(sent.continue).toBeUndefined();
  });

  test("every line the CLI prints about a minted identity shows its name, never its id", async () => {
    const out = await runChat(["sign-in", "--no-room", "--session", "s12"]);
    const session = JSON.parse(readFileSync(sessionFilePath("s12"), "utf8"));
    expect(session.handle).not.toBe(session.name);
    expect(out).toContain(`signed in as ${session.name}`);
    process.env.CLAUDE_CODE_SESSION_ID = "s12";
    const joined = await runChat(["join", "r"]);
    expect(joined).toContain(`as ${session.name}`);
    await runChat(["post", "r", "hello there"]);
    const who = await runChat(["who", "r"]);
    const read = await runChat(["read", "r", "--last", "1"]);
    const buddies = await runChat(["buddies"]);
    const left = await runChat(["leave", "r"]);
    expect(who).toContain(session.name);
    expect(read).toContain(`${session.name}: hello there`);
    for (const text of [out, joined, who, read, buddies, left]) expect(text).not.toContain(session.handle);
  });
```

Update the exact `--json` assertions:

```ts
    // "claim --json carries the outcome discriminator for every branch"
    expect(JSON.parse(await runChat(["claim", String(id), "--as", "b", "--json"]))).toEqual({ ok: true, id, outcome: "claimed", author: "asker", authorName: "asker", room: "r" });

    // "sign-in --pane --json reports the handle and room from the response, ..."
    expect(JSON.parse(out)).toEqual({ ok: true, handle: "kai", name: "kai", room: "build", continued: false });
    // (and add name to its session-file toMatchObject)
      name: "kai",
```

- [ ] **Step 3: Run to verify they fail**

Run: `bun test lib/__tests__/chat-session.test.ts commands/__tests__/chat.test.ts`
Expected: FAIL (`sessionName` and `resolveSignInRequest` do not exist; the CLI sends `baseHandle` for `--as` and prints ids).

- [ ] **Step 4: Implement the session file field**

In `lib/chat-session.ts`, add to `ChatSession` after `baseHandle`:

```ts
  /** Absent in files written before identities existed; read it through sessionName. */
  name?: string;
```

and below `deleteChatSession`:

```ts
/** The display name a session file stands for; an older file without `name` is a legacy id, whose name is itself. */
export function sessionName(s: Pick<ChatSession, "handle" | "name">): string {
  return typeof s.name === "string" && s.name ? s.name : s.handle;
}
```

- [ ] **Step 5: Implement the CLI**

In `commands/chat.ts`, add `sessionName` to the `../lib/chat-session.ts` import.

Replace `resolveSignInBaseHandle` and its doc comment with:

```ts
/**
 * Sign-in's request. `--as` continues the identity it names: the daemon
 * resolves a name or an id, and gives a new id with a suffixed name when
 * that identity is live in another session. `chat.handle` asks for a fresh
 * identity with that display name. Neither means a pool draw. A repeat
 * sign-in from the same session keeps its id daemon-side, by session id.
 * `--name` asks for a fresh identity with that display name and never
 * continues one (the MCP chat_sign_in `as` spawns it).
 */
function resolveSignInRequest(args: string[]): { baseHandle?: string; continue?: string } {
  const explicit = flagValue(args, "--as");
  if (explicit) {
    requireValidName("handle", explicit);
    return { continue: explicit };
  }
  const named = flagValue(args, "--name");
  if (named) {
    requireValidName("handle", named);
    return { baseHandle: named };
  }
  const fromSetting = readChatHandleSetting();
  return fromSetting ? { baseHandle: fromSetting } : {};
}
```

Add `"--name"` to `FLAGS_WITH_VALUES`, and in `lib/command-tree-def.ts` add a flag row after the chat node's `--as` row: `{ name: "Name", flag: "--name", type: "text", placeholder: "remy", hint: "For sign-in: a fresh identity with this display name; never continues one (use --as for that)" }`.

Replace `resolvePaneBaseHandle` (keep its doc comment, changing "baseHandle chain" to "request") with:

```ts
function resolvePaneRequest(args: string[]): { continue?: string } {
  const explicit = flagValue(args, "--as");
  if (!explicit) return {};
  requireValidName("handle", explicit);
  return { continue: explicit };
}
```

Add after `resolveHandle`:

```ts
/** What to print for this caller: the session's name when signed in, else the unsigned handle itself. */
function resolveSelfName(args: string[]): string {
  const session = readChatSession(currentSessionId(args));
  return session ? sessionName(session) : resolveBaseHandle(args);
}
```

In `resolveHandle`, change the refusal to ``fail(`signed in as ${sessionName(session)}: sign out to change identity (rt chat sign-out)`);``. The existing test regex `/signed in as x.*sign out/` still matches.

Rendering helpers:

```ts
function renderJoin(room: string, name: string, data: { memberCount: number; unread: number }): string {
  const parts = [pluralize(data.memberCount, "member")];
  if (data.memberCount === 1) parts.push("you are alone here");
  else if (data.unread > 0) parts.push(`${data.unread} unread`);
  return `✓ joined #${room} as ${name} · ${parts.join(", ")}`;
}

function roomHeading(r: RoomSummary): string {
  if (r.kind === "dm" && r.participants) return `${r.participants.aName ?? r.participants.a} ↔ ${r.participants.bName ?? r.participants.b}`;
  return `#${r.room}`;
}

function renderMessage(m: ChatMessage, full: boolean): string {
  const time = new Date(m.postedAt).toISOString().slice(11, 16);
  return `  [${time}] ${m.name ?? m.handle}: ${full ? m.body : truncate(m.body, 200)}`;
}
```

In `renderWhoSection` use `` `  ${m.name ?? m.handle}  ${status}${cwd}${pane}` ``. In `renderBuddies`, add `const nameOf = (b: PresenceRow): string => b.name ?? b.handle;` at the top and use `nameOf(b)` in the width (`regular.map((b) => nameOf(b).length)`), the offline entries and the `${bullet} ${nameOf(b)}` cell.

Verb output lines:

```ts
// runJoin
  console.log(renderJoin(room, data.name ?? data.handle, data));
// runLeave
  console.log(`✓ left #${room} (${resolveSelfName(args)})`);
// runPost
  else if (data.recipients.length > 0) console.log(`delivered to ${(data.recipientNames ?? data.recipients).join(", ")}`);
// runAck
  const author = data.authorName ?? data.author;
  if (data.already) console.log(`already acked #${id} (${author} was not woken again)`);
  else console.log(`acked #${id} → ${author}`);
// runClaim
    console.log(`#${id} already claimed by ${data.holderName ?? data.holder} ${humanDuration(now - data.claimedAt)} ago (claimable again in ${humanDuration(data.expiresAt - now)})`);
  ...
  const takeover = data.previousHolder ? ` (took over from ${data.previousHolderName ?? data.previousHolder})` : "";
  console.log(`claimed #${id} → ${data.authorName ?? data.author}${takeover}`);
// runRelease
  console.log(`released #${id} (was held by ${data.holderName ?? data.holder})`);
// runDm
  console.log(`dm → ${data.recipientNames?.[0] ?? to} #${data.id}`);
```

`runSignIn`: replace the base resolution and the sign-in/write/print lines:

```ts
  const request = resolveSignInRequest(args);
  if (request.baseHandle !== undefined) requireValidName("handle", request.baseHandle);
  ...
  const signInRes = await chatSignIn({ sessionId, ...request, cwd, repo, branch, pane, statusText });
  const { handle, baseHandle, name, continued } = unwrap(signInRes, "sign-in");
  const displayName = name ?? handle;

  writeChatSession({ sessionId, handle, baseHandle, name: displayName, signedInAt: Date.now(), room: roomName ?? undefined });
  ...
  if (args.includes("--json")) {
    console.log(JSON.stringify({ ok: true, handle, name: displayName, room: roomName, continued: continued === true }));
    return;
  }
  console.log(renderSignIn(displayName, { repo, branch, pane }, root !== null, noRoomFlag, joinedRoom));
```

`runSignInViaPane`:

```ts
  const request = resolvePaneRequest(args);
  ...
  const signInRes = await chatSignIn({ ...request, pane: paneId, viaPane: true, statusText, room: explicitRoom, noRoom: noRoomFlag });
  const { handle, baseHandle, name, continued, sessionId, room } = unwrap(signInRes, "sign-in");
  const displayName = name ?? handle;

  writeChatSession({ sessionId, handle, baseHandle, name: displayName, signedInAt: Date.now(), room: room ?? undefined });

  if (args.includes("--json")) {
    console.log(JSON.stringify({ ok: true, handle, name: displayName, room, continued: continued === true }));
    return;
  }
  console.log(`signed in as ${displayName} · pane ${paneId} · ${room ? `joined #${room}` : "no room joined"}`);
```

`runSignOut` and `runSignOutViaPane`: replace `${session.handle}` with `${sessionName(session)}` in both `✓ signed out (...)` lines.

In the `__test__` export, replace `resolveSignInBaseHandle` with `resolveSignInRequest`.

- [ ] **Step 6: Run the tests**

Run: `bun test lib/__tests__/chat-session.test.ts commands/__tests__/chat.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/chat-session.ts commands/chat.ts lib/command-tree-def.ts lib/__tests__/chat-session.test.ts commands/__tests__/chat.test.ts
git commit -m "chat cli: --as continues, --name mints, session file and output carry names" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: MCP tools act on the id and show the name

**Files:**
- Modify: `lib/mcp/shared.ts` (`requireChatHandle`)
- Modify: `lib/mcp/chat-tools.ts` (`chat_sign_in`, the two membership error strings)
- Modify: `lib/mcp/whoami-tool.ts`
- Modify: `lib/mcp/tools.ts` (`chat_post`, `chat_dm` descriptions)
- Modify: `lib/mcp/__tests__/tools-payload-hash.test.ts` (`PAYLOAD_SHA256`)
- Test: `lib/mcp/__tests__/chat-tools.test.ts`, `lib/mcp/__tests__/whoami-tool.test.ts`, `lib/mcp/__tests__/tools.test.ts`

**Interfaces:**
- Consumes: `sessionName` (Task 9); `rt chat sign-in --json` prints `name` (Task 9).
- Produces: `requireChatHandle(env, read?): { handle: string; name: string } | { error: string }`; `chat_sign_in` answers `{ handle, name, room, continued }` (frozen contract); `whoami`'s `chat` is `{ handle, name, baseHandle, room }`. `chat_sign_in`'s `as` never continues (ruling 6): it keeps every current refusal and spawns `rt chat sign-in --name <as>` (Task 9), so the daemon mints a fresh id with that display name.

- [ ] **Step 1: Write the failing tests**

In `lib/mcp/__tests__/chat-tools.test.ts`: change the import to `import { requireChatHandle, SIGN_IN_HINT } from "../shared.ts";`. In `"spawns the CLI with a fixed argv ..."` change `"--as", "ann"` in the expected `rest` to `"--name", "ann"` and the expected body to `{ handle: "ann", name: "ann", room: "rt", continued: false }`. Keep every existing `as` refusal test unchanged (held names, suffixed family, room memberships, archived DM, buddies failing closed, the own-seat exemptions). Add:

```ts
  test("as never continues: an offline identity's unused name spawns a fresh sign-in by --name, never --as", async () => {
    const f = fake();
    const r = await f.tool("chat_sign_in").handler({ as: "bob" }, ENV);
    expect(r.ok).toBe(true);
    expect(f.calls.map((c) => c.fn)).toEqual(["buddies", "rooms", "spawnRt"]);
    const rest = f.calls.find((c) => c.fn === "spawnRt")!.a.rest as string[];
    expect(rest).toEqual(["--session", "s1", "--name", "bob"]);
    expect(rest).not.toContain("--as");
  });

  test("the sign-in result carries the name and continued flag the CLI printed", async () => {
    const f = fake({ spawn: { ok: true, body: { ok: true, handle: "ann.k3f9", name: "ann", room: null, continued: true } } });
    const r = await f.tool("chat_sign_in").handler({ as: "ann" }, ENV);
    expect(r).toEqual({ ok: true, body: { handle: "ann.k3f9", name: "ann", room: null, continued: true } });
  });
```

Append a top-level describe:

```ts
describe("requireChatHandle", () => {
  test("returns the id to act as and the name to show", () => {
    expect(requireChatHandle(ENV, () => ({ sessionId: "s1", handle: "ann.k3f9", baseHandle: "ann", name: "ann", signedInAt: 1 }))).toEqual({ handle: "ann.k3f9", name: "ann" });
    expect(requireChatHandle(ENV, () => ({ sessionId: "s1", handle: "ann", baseHandle: "ann", signedInAt: 1 }))).toEqual({ handle: "ann", name: "ann" });
  });

  test("the not-a-member refusal names the session by name", async () => {
    const f = fake({ who: { members: [] } });
    const r = await f.tool("chat_read").handler({ room: "build", last: 5 }, ENV);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("ann is not a member of #build; join it first");
  });
});
```

In `lib/mcp/__tests__/whoami-tool.test.ts`: in the first test change the expected `chat` to `{ handle: "arwen", name: "arwen", baseHandle: "arwen", room: "rt" }`; in `"a session file missing optional fields reports them as null"` expect `{ handle: "arwen", name: "arwen", baseHandle: null, room: null }`; append:

```ts
  test("a minted identity reports its name and its id", async () => {
    const { t } = tool({ s1: { sessionId: "s1", handle: "arwen.k3f9", baseHandle: "arwen", name: "arwen", signedInAt: 1, room: "rt" } });
    const r = await t.handler({}, { CLAUDE_CODE_SESSION_ID: "s1" } as NodeJS.ProcessEnv);
    expect((r.body as { chat: unknown }).chat).toEqual({ handle: "arwen.k3f9", name: "arwen", baseHandle: "arwen", room: "rt" });
  });
```

In `lib/mcp/__tests__/tools.test.ts` append:

```ts
  test("chat_post and chat_dm say a name or an id works, and that the reply hint's id reaches the exact sender", () => {
    const post = mcpTools().find((t) => t.name === "chat_post")!;
    const dm = mcpTools().find((t) => t.name === "chat_dm")!;
    expect(post.description).toContain("names or ids");
    expect(dm.description).toContain("a name or an id");
    expect(dm.description).toContain("reply hint");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/mcp/__tests__/chat-tools.test.ts lib/mcp/__tests__/whoami-tool.test.ts lib/mcp/__tests__/tools.test.ts`
Expected: FAIL (no `name` anywhere; `as` still spawns with `--as`; descriptions unchanged).

- [ ] **Step 3: Implement**

`lib/mcp/shared.ts`: import `sessionName` beside `readChatSession`, and:

```ts
/** No derived-handle fallback: a tool call with no session file is a hard error, unlike the CLI's resolveHandle. */
export function requireChatHandle(
  env: NodeJS.ProcessEnv,
  read: (id: string | undefined) => ChatSession | null = readChatSession,
): { handle: string; name: string } | { error: string } {
  const session = read(env.CLAUDE_CODE_SESSION_ID);
  if (!session) return { error: SIGN_IN_HINT };
  return { handle: session.handle, name: sessionName(session) };
}
```

`lib/mcp/chat-tools.ts`:
- the two membership refusals: `` err(`${id.name} is not a member of #${room}; join it first`) `` and `` err(`${id.name} is not a member of #${room}; only a member may archive or reopen it`) ``.
- `chat_sign_in` description:

```ts
      description: "Sign this session in to rt chat (presence, an identity, and the repo room derived from cwd unless room or noRoom says otherwise). cwd is the checkout this session works in; the server's own directory is fixed at session start. as picks the display name for a fresh identity and never continues an existing one: it may not be the human's handle, a name another session holds or held, or a name with room memberships. After a /clear this tool refuses; run `rt chat sign-in` in Bash instead.",
```

- in its handler, keep the whole `if (typeof input.as === "string") { ... }` refusal block as it is, and change the spawn argument from `rest.push("--as", input.as)` to `rest.push("--name", input.as)`.

- and replace the result lines at the end of the handler:

```ts
        const { handle, name, room, continued } = body as { handle: string; name?: unknown; room?: unknown; continued?: unknown };
        return ok({ handle, name: typeof name === "string" && name ? name : handle, room: room ?? null, continued: continued === true });
```

`lib/mcp/whoami-tool.ts`: import `sessionName` with `readChatSession`; the `chat` line becomes

```ts
        const chat = session ? { handle: session.handle, name: sessionName(session), baseHandle: session.baseHandle ?? null, room: session.room ?? null } : null;
```

and the description's chat clause becomes: "the chat identity every chat_* tool acts as, as its name (what others see and type) and its handle (the id the tools send; null, with a sign-in hint, when this session has no chat session file)".

`lib/mcp/tools.ts` descriptions:

```ts
      description: "Post a message to an rt chat room as the signed-in identity. mentions are names or ids; a name reaches whoever holds it now. Requires a signed-in chat session; call chat_sign_in first.",
```

```ts
      description: "Send a direct message to another rt chat identity. to is a name or an id: a name reaches whoever holds it now, and the id from a delivery's reply hint reaches that exact sender even after the name has changed hands. Requires a signed-in chat session; call chat_sign_in first.",
```

- [ ] **Step 4: Refresh the payload hash**

Run: `bun test lib/mcp/__tests__/tools-payload-hash.test.ts`
Expected: FAIL with the refresh steps and the new hash. Set `PAYLOAD_SHA256` in `lib/mcp/__tests__/tools-payload-hash.test.ts` to the printed hash and tell lane 5 (it regenerates `attachments/mcp-tools/reference.md` from `rt mcp tools --json` after the merge).

- [ ] **Step 5: Run the tests**

Run: `bun test lib/mcp/__tests__/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/mcp/shared.ts lib/mcp/chat-tools.ts lib/mcp/whoami-tool.ts lib/mcp/tools.ts lib/mcp/__tests__/chat-tools.test.ts lib/mcp/__tests__/whoami-tool.test.ts lib/mcp/__tests__/tools.test.ts lib/mcp/__tests__/tools-payload-hash.test.ts
git commit -m "mcp: chat tools act on the id and show the name; as mints, never continues" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: e2e frames and suffixes by name

**Files:**
- Modify: `e2e/tests/chat-inbox-delivery.test.ts`
- Modify: `e2e/tests/chat-presence-roster.test.ts`

**Interfaces:**
- Consumes: the compiled `dist/rt` (rebuilt by `e2e/setup.ts` when stale) under an isolated HOME (`createTestHome`), never the real `~/.mattstack`.

- [ ] **Step 1: Update `chat-inbox-delivery`**

Change `interface SignInResult { ok: true; handle: string; room: string | null }` to include `name: string`. Add helpers after `signInPane`:

```ts
async function signInDrawn(homeDir: string, sessionId: string, room: string): Promise<SignInResult> {
  const res = await finished(runRt(["chat", "sign-in", "--session", sessionId, "--room", room, "--json"], homeDir));
  if (res.exitCode !== 0) throw new Error(`sign-in(${sessionId}) failed: ${res.stderr || res.stdout}`);
  return JSON.parse(res.stdout) as SignInResult;
}

/** An unsigned post under a chosen handle: how the human posts, since continuing the human's id is refused. */
async function postAs(homeDir: string, room: string, body: string, as: string): Promise<{ ok: true; id: number; recipients: string[] }> {
  const res = await finished(runRt(["chat", "post", room, body, "--as", as, "--json"], homeDir));
  if (res.exitCode !== 0) throw new Error(`post --as ${as} failed: ${res.stderr || res.stdout}`);
  return JSON.parse(res.stdout);
}
```

Every `--as x` sign-in here names an identity nothing knows yet, so the daemon mints `x.<suffix>` with display name `x` (ruling 5). Assertions that compare a signed-in handle to a literal compare `name` instead, and recipient lists and reply hints use the handle each sign-in returned:

```ts
    // first test
    expect(signedIn.name).toBe("recipient");            // was signedIn.handle
    const poster = await signIn(home, "sess-poster", "poster", "testroom");
    expect(posted.recipients).toContain(signedIn.handle); // was "recipient"
        `reply via rt chat post <room> "..." or rt chat dm ${poster.handle} "..." (never SendMessage; this arrived through rt chat)\n</cross-session-message>`,
    // DM test
    expect(a.name).toBe("a");                            // was a.handle
    expect(b.name).toBe("b");                            // was b.handle
    const c = await signIn(home, "sess-c", "c", "testroom");
        `reply via rt chat post <room> "..." or rt chat dm ${c.handle} "..." (never SendMessage; this arrived through rt chat)\n</cross-session-message>`,
```

In `"rooms default to wake-on mention: ..."`, bind the two sign-ins (`const bIn = await signInPane(home, "w1:pb", "b", "testroom");`, `const aIn = await signIn(home, "sess-a", "a", "testroom");`), delete `await signIn(home, "sess-m", "matt", "testroom");`, replace the human post with `const fromHuman = await postAs(home, "testroom", "one of you: write the TLDR", "matt");`, change `expect(fromHuman.recipients).toEqual(["a", "b"]);` to `expect([...fromHuman.recipients].sort()).toEqual([aIn.handle, bIn.handle].sort());`, and change the expected frame's last line to:

```ts
        'reply via rt chat post <room> "..." or rt chat dm <id> "..." (never SendMessage; this arrived through rt chat)\n' +
        `  reply to a: rt chat dm ${aIn.handle} "..."\n  reply to matt: rt chat dm matt "..."\n</cross-session-message>`,
```

Any other literal-handle assertion on an `--as` sign-in in this file gets the same treatment (`name` for the literal, the returned `handle` where an id is compared).

Append:

```ts
  test("a pool-drawn sender shows its name in the frame and its id only in the reply hint", async () => {
    const sessionId = "77777777-7777-7777-7777-777777777777";
    const { sock: herdrSock, stop: stopHerdr } = fakeHerdrForPanes([{ paneId: "w1:p7", sessionId }]);
    stops.push(stopHerdr);
    const inbox = startFakeInbox();
    stops.push(inbox.stop);
    registerFakeInbox(home, sessionId, inbox.socketPath);
    await startDaemonForHome(home, { HERDR_SOCKET_PATH: herdrSock });

    await signInPane(home, "w1:p7", "recipient", "testroom");
    await waitForFrame(inbox.frames, (f) => frameContent(f).includes("You're signed in to rt chat as recipient"));
    const poster = await signInDrawn(home, "sess-drawn", "testroom");
    expect(poster.handle).not.toBe(poster.name);
    expect(poster.handle.startsWith(`${poster.name}.`)).toBe(true);

    const posted = await post(home, "testroom", "@recipient hi from a drawn name", "sess-drawn");
    const frame = await waitForFrame(inbox.frames, (f) => frameContent(f).includes("hi from a drawn name"));
    expect(frameContent(frame)).toBe(
      `<cross-session-message from-name="${poster.name} (#testroom)">\n[#testroom] ${poster.name} #${posted.id}: @recipient hi from a drawn name\n` +
        `reply via rt chat post <room> "..." or rt chat dm ${poster.handle} "..." (never SendMessage; this arrived through rt chat)\n</cross-session-message>`,
    );
  }, 30_000);
```

- [ ] **Step 2: Update `chat-presence-roster`**

Add `name: string;` to its `SignInResult`, and replace the first test:

```ts
  test("a second session asking for a live name gets a new identity with the next display suffix", async () => {
    await startDaemonForHome(home);
    const a = await signIn(home, "sess-a1", "x");
    expect(a.name).toBe("x");
    const b = await signIn(home, "sess-b1", "x");
    expect(b.name).toBe("x-2");
    expect(b.handle).not.toBe(a.handle);
  }, 30_000);
```

In the `user_version` replay test, the `--as` sign-ins mint too: `expect(seeded.handle).toBe("before-migration")` becomes `expect(seeded.name).toBe("before-migration")`, `readPresenceRow(home, "before-migration")` becomes `readPresenceRow(home, seeded.handle)`, and `expect(after.handle).toBe("after-migration")` becomes `expect(after.name).toBe("after-migration")`.

- [ ] **Step 3: Run the e2e files**

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/chat-inbox-delivery.test.ts e2e/tests/chat-presence-roster.test.ts e2e/tests/herd.test.ts e2e/tests/mcp-serve.test.ts > "$TMPDIR/lane1b-e2e.log" 2>&1; tail -5 "$TMPDIR/lane1b-e2e.log"`
Expected: `0 fail`. `herd.test.ts` and `mcp-serve.test.ts` need no edits; they run because they drive the herd and MCP surfaces this lane changed.

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/chat-inbox-delivery.test.ts e2e/tests/chat-presence-roster.test.ts
git commit -m "e2e: chat frames and suffixes by name" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Rebase on lane 1a and run every suite

**Files:** none new.

- [ ] **Step 1: Rebase when 1a is green**

Run: `git fetch origin && git rebase <lane-1a-branch>` (the branch name is in `#rt` or the shepherd's lane table). Resolve conflicts in favour of the frozen contract; never edit `lib/state` here.

- [ ] **Step 2: Run each task's skipped steps**

For every task done in code-only mode, run its "verify they fail" and "run the tests" commands in order and fix what fails in this lane's files.

- [ ] **Step 3: Unit suite**

Run: `bun run test > "$TMPDIR/lane1b-unit.log" 2>&1; rg -n "\(fail\)| fail$" "$TMPDIR/lane1b-unit.log" | tail -20`
Expected: `0 fail`. A failure that also fails on a clean `main` is a known rotating flake (verify by running that file on `main`), not this lane's.

- [ ] **Step 4: e2e and pty**

Run: `bun run test:e2e > "$TMPDIR/lane1b-e2e-all.log" 2>&1; tail -3 "$TMPDIR/lane1b-e2e-all.log"`
Expected: `0 fail`.

Run: `bun run test:pty > "$TMPDIR/lane1b-pty.log" 2>&1; tail -3 "$TMPDIR/lane1b-pty.log"`
Expected: `0 fail` (no pty test touches chat; this confirms it).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck > "$TMPDIR/lane1b-tsc.log" 2>&1; rg -n "error TS" "$TMPDIR/lane1b-tsc.log" | rg -v "packages/rt-client" | head -40`
Expected before lane 2 is merged: only errors naming the new wire fields (`name`, `continue`, `continued`, `recipientNames`, `authorName`, `holderName`, `previousHolderName`, `aName`, `bName`, `shepherdName`, `handleName`) on rt-client types. After master Task I2 merges lane 2: none. Lane 2 does not edit files outside `packages/rt-client` and `apps/chat`: every `error TS` left in `lib/`, `commands/` or `e2e/` after that merge (lane 2's Task 1 Step 5 report lists them, for example `lib/__tests__/herd-cli.test.ts`) is this lane's to fix at I2, by adding the missing name field to the literal (equal to its id for a legacy handle).

- [ ] **Step 6: Report**

Post in `#rt` with `chat_post`: which suites passed, the typecheck residue (if any) and the new `PAYLOAD_SHA256` for lane 5.
