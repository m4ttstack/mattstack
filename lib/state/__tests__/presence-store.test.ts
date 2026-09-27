/**
 * lib/state/presence-store.ts — sign-in, presence, and the one reclaim
 * predicate (RT-48, delivery-v2 hard cutover).
 *
 * joinRoom/listMembers come from chat-store.ts to exercise the room-default
 * wiring those tests cover.
 */
import { expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { openStateDb } from "../db.ts";
import { joinRoom, listMembers } from "../chat-store.ts";
import {
  assertSessionOwnsHandle,
  assertSessionSignedIn,
  buddyStatus,
  listBuddies,
  presenceForHandle,
  presenceForSession,
  presenceThresholds,
  paneHandleFor,
  prunePresence,
  rememberPaneHandle,
  reserveAgentHandle,
  setAway,
  signIn,
  signOut,
  touchLastSeen,
  type RegistryDeps,
  type SignInResult,
} from "../presence-store.ts";
import type { InboxBinding } from "../../claude-registry.ts";
import { AGENT_NAMES } from "../../chat-names.ts";
import { getKvValue } from "../kv-blob.ts";
import { getIdentity, identityForSession, mintIdentity } from "../identity-store.ts";
import { setKvValue } from "../kv-blob.ts";

/** No binding for any session id: the default in every test that doesn't care about the registry (matches the real resolver's behavior for a fake test session id it will never find on disk). */
const NO_BINDING: RegistryDeps = { resolve: () => null, alive: () => false, resolveAll: () => new Map() };

/** Resolves ONLY `sessionId` (default "s1", matching every test's own session id) -- `resolveAll` must carry the same entry, since callers with more than one lookup go through it instead of `resolve` directly. */
function fakeBinding(status: InboxBinding["status"], sessionId = "s1"): RegistryDeps {
  const binding: InboxBinding = { pid: 1, socketPath: "/fake.sock", status };
  return {
    resolve: (id) => (id === sessionId ? binding : null),
    alive: () => true,
    resolveAll: () => new Map([[sessionId, binding]]),
  };
}

/** A registry entry that resolves but whose process is gone (dead pid, or a socket that no longer exists). */
function deadPidBinding(sessionId = "s1"): RegistryDeps {
  const binding: InboxBinding = { pid: 1, socketPath: "/fake.sock", status: "busy" };
  return {
    resolve: (id) => (id === sessionId ? binding : null),
    alive: () => false,
    resolveAll: () => new Map([[sessionId, binding]]),
  };
}

let n = 0;
function fresh() {
  return openStateDb(join(tmpdir(), `presence-test-${process.pid}-${n++}.db`));
}

/** signIn(), asserted non-undefined: every ordinary (non-contention) test
 *  call is expected to succeed, so this narrows the R057 `| undefined`
 *  return without repeating a non-null assertion at every call site. */
function mustSignIn(...args: Parameters<typeof signIn>): SignInResult {
  const result = signIn(...args);
  if (!result) throw new Error("mustSignIn: signIn() unexpectedly returned undefined");
  return result;
}

const now = 1_700_000_000_000;
const MIN = 60_000, HOUR = 3_600_000;

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

test("buddyStatus: offline beats everything (signed out, unresolvable, or a dead pid); otherwise the registry mirror decides live vs idle, regardless of how stale last_seen_at is", () => {
  expect(buddyStatus({ signedOutAt: now }, now)).toBe("offline");
  // No sessionId at all: offline, independent of lastSeenAt.
  expect(buddyStatus({ lastSeenAt: now - 25 * HOUR }, now)).toBe("offline");
  expect(buddyStatus({ lastSeenAt: now, sessionId: "s1" }, now, presenceThresholds(), fakeBinding("busy"))).toBe("live");
  expect(buddyStatus({ lastSeenAt: now, sessionId: "s1" }, now, presenceThresholds(), fakeBinding("idle"))).toBe("idle");
  expect(buddyStatus({ lastSeenAt: now, sessionId: "s1" }, now, presenceThresholds(), fakeBinding("shell"))).toBe("idle");
  // A last_seen_at well past pruneMs never turns this offline on its own:
  // an alive, busy binding still vouches for the session. prunePresence,
  // not buddyStatus, is what retires a truly dead row.
  expect(buddyStatus({ lastSeenAt: now - 25 * HOUR, sessionId: "s1" }, now, presenceThresholds(), fakeBinding("busy"))).toBe("live");
  // No resolvable registry entry at all (a session id the registry has never
  // heard of): offline, per spec ("pid dead, or socket gone" -- unresolvable
  // is the same "nothing to vouch for this session" case).
  expect(buddyStatus({ lastSeenAt: now, sessionId: "s1" }, now, presenceThresholds(), NO_BINDING)).toBe("offline");
  expect(buddyStatus({ lastSeenAt: now }, now, presenceThresholds(), NO_BINDING)).toBe("offline");
  // A registry file resolves, but the pid is dead (or the socket is gone): offline too.
  expect(buddyStatus({ lastSeenAt: now, sessionId: "s1" }, now, presenceThresholds(), deadPidBinding())).toBe("offline");
});

/** Counts `resolveAll()` calls; `resolve`/`alive` are unused once a caller batches through `resolveAll`, so they throw if anything still calls them directly. */
function countingRegistryDeps(): RegistryDeps & { scans: number } {
  const state = {
    scans: 0,
    resolve: (): InboxBinding | null => {
      throw new Error("resolve() called directly -- the caller under test should batch through resolveAll() instead");
    },
    alive: () => true,
    resolveAll: (): Map<string, InboxBinding> => {
      state.scans++;
      return new Map();
    },
  };
  return state;
}

test("listBuddies scans the registry exactly once regardless of buddy count", () => {
  const db = fresh();
  mustSignIn({ sessionId: "s1", baseHandle: "a", now }, db);
  mustSignIn({ sessionId: "s2", baseHandle: "b", now }, db);
  mustSignIn({ sessionId: "s3", baseHandle: "c", now }, db);
  const deps = countingRegistryDeps();
  const buddies = listBuddies(now, db, deps);
  expect(buddies).toHaveLength(3);
  expect(deps.scans).toBe(1);
});

test("listBuddies: a live-binding row with a 25h-old stamp still appears, classified by the registry; a dead-binding stale row reads offline but still appears", () => {
  const db = fresh();
  mustSignIn({ sessionId: "s1", baseHandle: "live-stale", now }, db);
  mustSignIn({ sessionId: "s2", baseHandle: "dead-stale", now }, db);
  db.run("UPDATE chat_presence SET last_seen_at = ? WHERE session_id IN ('s1', 's2')", [now - 25 * HOUR]);

  const deps = fakeBinding("busy", "s1"); // only s1 resolves; s2 has no registry entry
  const buddies = listBuddies(now, db, deps);

  const live = buddies.find((b) => b.name === "live-stale");
  const dead = buddies.find((b) => b.name === "dead-stale");
  expect(live?.status).toBe("live");
  expect(dead?.status).toBe("offline");
});

test("signIn scans the registry exactly once per call, even while probing several suffix candidates", () => {
  const db = fresh();
  // Three existing "x" rows (x, x-2, x-3) so the incoming sign-in's own
  // family scan, plus findOpenSuffix's fallback walk if it reaches that far,
  // both have several rows to check reclaimability for -- all against the
  // one map a single signIn call is allowed to build.
  mustSignIn({ sessionId: "s1", baseHandle: "x", now }, db);
  mustSignIn({ sessionId: "s2", baseHandle: "x", now }, db);
  mustSignIn({ sessionId: "s3", baseHandle: "x", now }, db);
  const deps = countingRegistryDeps();
  const r = mustSignIn({ sessionId: "s4", baseHandle: "x", now }, db, deps);
  expect(r.name).toBe("x-4");
  expect(deps.scans).toBe(1);
});

test("assertSessionOwnsHandle throws only on a mismatched signed handle", () => {
  const db = fresh();
  const { handle } = mustSignIn({ sessionId: "s1", baseHandle: "x", now }, db);
  expect(() => assertSessionOwnsHandle(handle, "s1", db)).not.toThrow();
  expect(() => assertSessionOwnsHandle(handle, "s2", db)).toThrow(/handle reclaimed/);
  expect(() => assertSessionOwnsHandle("unsigned", "s2", db)).not.toThrow();
  expect(() => assertSessionOwnsHandle(handle, undefined, db)).not.toThrow();
});

test("S073: signIn's read-then-write transaction uses .immediate() (BEGIN IMMEDIATE), not a deferred BEGIN", () => {
  // A plain db.transaction()'s deferred BEGIN lets signIn's own reads
  // (prunePresence, SELECT_PRESENCE_BY_SESSION_SQL) open a snapshot before
  // any write; a commit by another connection in that window turns the
  // eventual write into an unretryable SQLITE_BUSY_SNAPSHOT that the
  // flavor's busy_timeout cannot absorb. .immediate() takes the write lock
  // at BEGIN, so contention surfaces as an ordinary, retryable SQLITE_BUSY
  // instead (matching the chat-store.ts/dm-store.ts/notifier-store.ts
  // siblings already converted for the same reason).
  const src = readFileSync(resolve(import.meta.dir, "..", "presence-store.ts"), "utf8");
  const runIndex = src.indexOf("const run = db.transaction(");
  expect(runIndex).toBeGreaterThan(-1);
  expect(src.indexOf("return run.immediate();", runIndex)).toBeGreaterThan(runIndex);
});

test("C9: reserveAgentHandle's read-then-write transaction also uses .immediate(), same reason as signIn's S073 fix", () => {
  const src = readFileSync(resolve(import.meta.dir, "..", "presence-store.ts"), "utf8");
  const fnIndex = src.indexOf("export function reserveAgentHandle(");
  expect(fnIndex).toBeGreaterThan(-1);
  const runIndex = src.indexOf("const run = db.transaction(", fnIndex);
  expect(runIndex).toBeGreaterThan(fnIndex);
  expect(src.indexOf("return run.immediate();", runIndex)).toBeGreaterThan(runIndex);
});

test("assertSessionSignedIn throws when the session's row is gone", () => {
  const db = fresh();
  expect(() => assertSessionSignedIn("ghost", db)).toThrow(/handle reclaimed/);
});

test("assertSessionSignedIn refuses a signed-out session without the reclaimed wording", () => {
  const db = fresh();
  mustSignIn({ sessionId: "s1", baseHandle: "x", now }, db);
  signOut("s1", now, db);
  expect(() => assertSessionSignedIn("s1", db)).toThrow(/not signed in/);
  expect(() => assertSessionSignedIn("s1", db)).not.toThrow(/handle reclaimed/);
});

test("prune: the ghost path — a never-signed-out row goes after 24h of silence", () => {
  const db = fresh();
  mustSignIn({ sessionId: "s1", baseHandle: "x", now }, db); // never signs out
  expect(prunePresence(now + 2 * HOUR, db)).toBe(0);
  expect(prunePresence(now + 25 * HOUR, db)).toBe(1); // last_seen_at leg, signed_out_at NULL
});

test("prune: the signed-out path keeps the offline window", () => {
  const db = fresh();
  mustSignIn({ sessionId: "s1", baseHandle: "x", now }, db);
  signOut("s1", now, db);
  expect(prunePresence(now + 2 * HOUR, db)).toBe(0); // offline (last 24h) still shows it
  expect(prunePresence(now + 25 * HOUR, db)).toBe(1); // signed_out_at leg
});

test("prune: a never-signed-out row past 24h survives when the registry still vouches for its session", () => {
  const db = fresh();
  mustSignIn({ sessionId: "s1", baseHandle: "x", now }, db);
  expect(prunePresence(now + 25 * HOUR, db, fakeBinding("busy"))).toBe(0);
  expect(db.query("SELECT COUNT(*) c FROM chat_presence").get()).toMatchObject({ c: 1 });
});

test("prune: a never-signed-out row past 24h with no live binding is deleted", () => {
  const db = fresh();
  mustSignIn({ sessionId: "s1", baseHandle: "x", now }, db);
  expect(prunePresence(now + 25 * HOUR, db, NO_BINDING)).toBe(1);
  expect(db.query("SELECT COUNT(*) c FROM chat_presence").get()).toMatchObject({ c: 0 });
});

test("prune: a signed-out row within its 24h offline window survives even when last_seen_at is stale (C9: PRUNABLE_SQL must not let a signed-out row's last_seen_at leg bypass its own signed_out_at age bound)", () => {
  const db = fresh();
  mustSignIn({ sessionId: "s1", baseHandle: "x", now }, db); // last_seen_at pinned at `now`, no touches
  signOut("s1", now + 30 * HOUR, db); // signed out well after last_seen_at went stale
  // 1h after signing out: signed_out_at leg is nowhere near its 24h bound,
  // but last_seen_at (still `now`, 31h stale) trips the OTHER leg.
  expect(prunePresence(now + 31 * HOUR, db)).toBe(0);
  expect(db.query("SELECT COUNT(*) c FROM chat_presence").get()).toMatchObject({ c: 1 });
});

// R057: presence writes bypassed both busy wrappers, so a write racing a
// held lock past the daemon's 250ms busy_timeout surfaced as a raw thrown
// error to the caller (a chat:sign-in 500, a pulse hook error) instead of
// the policy table in busy.ts's warn-and-defer / bounded-retry treatment.
// `locker` pins a real BEGIN IMMEDIATE write lock on a second connection to
// the same file so `db`'s own write genuinely blocks out its busy_timeout
// and throws SQLITE_BUSY -- the same conflict shape production hits, not a
// fabricated error code.
function heldWriteLock(path: string): { locker: Database; release: () => void } {
  const locker = new Database(path);
  locker.exec("BEGIN IMMEDIATE;");
  return { locker, release: () => { try { locker.exec("ROLLBACK;"); } catch {} locker.close(); } };
}

test("R057: signIn does not throw when the write races a held lock past busy_timeout", () => {
  const path = join(tmpdir(), `presence-busy-signin-${process.pid}-${n++}.db`);
  const db = openStateDb(path, "daemon");
  const { release } = heldWriteLock(path);
  try {
    expect(() => signIn({ sessionId: "s1", baseHandle: "x", now }, db)).not.toThrow();
  } finally {
    release();
  }
}, 5000);

test("R057: signOut does not throw when the write races a held lock past busy_timeout", () => {
  const path = join(tmpdir(), `presence-busy-signout-${process.pid}-${n++}.db`);
  const db = openStateDb(path, "daemon");
  signIn({ sessionId: "s1", baseHandle: "x", now }, db);
  const { release } = heldWriteLock(path);
  try {
    expect(() => signOut("s1", now, db)).not.toThrow();
  } finally {
    release();
  }
}, 5000);

test("R057: setAway does not throw when the write races a held lock past busy_timeout", () => {
  const path = join(tmpdir(), `presence-busy-setaway-${process.pid}-${n++}.db`);
  const db = openStateDb(path, "daemon");
  signIn({ sessionId: "s1", baseHandle: "x", now }, db);
  const { release } = heldWriteLock(path);
  try {
    expect(() => setAway("s1", "afk", db)).not.toThrow();
  } finally {
    release();
  }
}, 5000);

test("R057: touchLastSeen does not throw when the write races a held lock past busy_timeout", () => {
  const path = join(tmpdir(), `presence-busy-touch-${process.pid}-${n++}.db`);
  const db = openStateDb(path, "daemon");
  signIn({ sessionId: "s1", baseHandle: "x", now }, db);
  const { release } = heldWriteLock(path);
  try {
    expect(() => touchLastSeen("s1", now + 1000, db)).not.toThrow();
  } finally {
    release();
  }
}, 5000);

test("touchLastSeen refreshes only last_seen_at -- the sole remaining route to it now that chat:pulse is gone", () => {
  const db = fresh();
  signIn({ sessionId: "s1", baseHandle: "x", now }, db);
  touchLastSeen("s1", now + HOUR, db);
  expect(presenceForSession("s1", db)?.lastSeenAt).toBe(now + HOUR);
  // A row delivery keeps touching never goes stale enough for prune to
  // consider it, even with no registry binding at all.
  expect(prunePresence(now + HOUR + 23 * HOUR, db, NO_BINDING)).toBe(0);
});

test("a creating join with wake-on stamps the room default and later joins inherit it", () => {
  const db = fresh();
  joinRoom({ room: "war", handle: "a", wakeOn: "all" }, db); // creates → stamps
  joinRoom({ room: "war", handle: "b" }, db); // flagless → inherits
  joinRoom({ room: "war", handle: "c", wakeOn: "mention" }, db); // explicit → wins
  const byHandle = Object.fromEntries(listMembers("war", db).map((m) => [m.handle, m.wakeOn]));
  expect(byHandle).toEqual({ a: "all", b: "all", c: "mention" });
  joinRoom({ room: "calm", handle: "a" }, db); // creating join WITHOUT a flag stamps nothing
  joinRoom({ room: "calm", handle: "b" }, db);
  expect(listMembers("calm", db).map((m) => m.wakeOn)).toEqual(["mention", "mention"]);
});

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

// presenceThresholds smoke test: not in the plan's verbatim block, but the
// module's Produces list requires it and nothing else here exercises the
// env-driven defaults.
test("presenceThresholds returns the documented defaults with no env set", () => {
  const saved = {
    session: process.env.RT_CHAT_SESSION_STALE_MS,
    prune: process.env.RT_CHAT_PRUNE_MS,
  };
  delete process.env.RT_CHAT_SESSION_STALE_MS;
  delete process.env.RT_CHAT_PRUNE_MS;
  try {
    expect(presenceThresholds()).toEqual({ sessionStaleMs: HOUR, pruneMs: 24 * HOUR });
  } finally {
    if (saved.session !== undefined) process.env.RT_CHAT_SESSION_STALE_MS = saved.session;
    if (saved.prune !== undefined) process.env.RT_CHAT_PRUNE_MS = saved.prune;
  }
});

// ─── The pool draw (no baseHandle) ──────────────────────────────────────────

const DAY = 24 * HOUR;

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

test("the draw is least-recently-used: every name goes once before any comes back", () => {
  const db = fresh();
  const drawn: string[] = [];
  // Each sign-in lands two days after the last, so the previous row is
  // pruned and only the ledger keeps the name from coming back.
  for (let i = 0; i <= AGENT_NAMES.length; i++) {
    const t = now + i * 2 * DAY;
    const { baseHandle } = mustSignIn({ sessionId: `s${i}`, now: t }, db);
    signOut(`s${i}`, t, db);
    drawn.push(baseHandle);
  }
  expect(new Set(drawn.slice(0, AGENT_NAMES.length)).size).toBe(AGENT_NAMES.length);
  expect(drawn[AGENT_NAMES.length]).toBe(drawn[0]);
}, 30_000);

test("a repeat sign-in with no base keeps the name the session already holds", () => {
  const db = fresh();
  const first = mustSignIn({ sessionId: "s1", now }, db);
  const again = mustSignIn({ sessionId: "s1", now: now + MIN }, db);
  expect(again.baseHandle).toBe(first.baseHandle);
  expect(again.handle).toBe(first.handle);
});

test("an explicitly named pool name counts as used; a non-pool base is not recorded", () => {
  const db = fresh();
  mustSignIn({ sessionId: "s1", baseHandle: "kai", now }, db);
  mustSignIn({ sessionId: "s2", baseHandle: "mr-board", now }, db);
  const ledger = getKvValue<Record<string, number>>("chat", "names", {}, db);
  expect(ledger.kai).toBe(now);
  expect(ledger["mr-board"]).toBeUndefined();
});

test("rememberPaneHandle round-trips a pane's base handle; an unknown pane resolves undefined", () => {
  const db = fresh();
  expect(paneHandleFor("wAR:p3", db)).toBeUndefined();
  rememberPaneHandle("wAR:p3", "max", db);
  expect(paneHandleFor("wAR:p3", db)).toBe("max");
  rememberPaneHandle("wAR:p3", "kai", db);
  expect(paneHandleFor("wAR:p3", db)).toBe("kai");
  expect(paneHandleFor("wZZ:p9", db)).toBeUndefined();
});

test("the pane-handle ledger caps at the 200 most-recently-written pins, even when every write shares a timestamp", () => {
  const db = fresh();
  const frozen = spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  try {
    for (let i = 1; i <= 250; i++) rememberPaneHandle(`w:p${i}`, `h${i}`, db);
  } finally {
    frozen.mockRestore();
  }
  const count = (db.query("SELECT COUNT(*) AS n FROM kv WHERE ns = 'chat_pane_handles';").get() as { n: number }).n;
  expect(count).toBe(200);
  // The 50 oldest writes are evicted; the newest 200 survive by insertion order.
  expect(paneHandleFor("w:p50", db)).toBeUndefined();
  expect(paneHandleFor("w:p51", db)).toBe("h51");
  expect(paneHandleFor("w:p250", db)).toBe("h250");
});

test("re-pinning an old pane survives the cap as a most-recent write, even sharing a timestamp with fresh pins", () => {
  const db = fresh();
  const frozen = spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  try {
    for (let i = 1; i <= 200; i++) rememberPaneHandle(`w:p${i}`, `h${i}`, db);
    // Re-pin the OLDEST key (the upsert path CodeRabbit flagged): it must count
    // as the newest write, not keep its stale rowid.
    rememberPaneHandle("w:p1", "repinned", db);
    // Push past the cap with fresh pins so eviction actually runs.
    for (let i = 201; i <= 205; i++) rememberPaneHandle(`w:p${i}`, `h${i}`, db);
  } finally {
    frozen.mockRestore();
  }
  const count = (db.query("SELECT COUNT(*) AS n FROM kv WHERE ns = 'chat_pane_handles';").get() as { n: number }).n;
  expect(count).toBe(200);
  expect(paneHandleFor("w:p1", db)).toBe("repinned"); // re-pinned oldest survives
  expect(paneHandleFor("w:p2", db)).toBeUndefined();   // genuinely-old untouched key evicted
  expect(paneHandleFor("w:p205", db)).toBe("h205");    // newest survives
});

// ─── Agent handle reservations ───────────────────────────────────────────────

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

// --- Continuation ------------------------------------------------------------

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

test("a session live as remy continuing remy keeps its own id while a newer offline identity named remy exists", () => {
  const db = fresh();
  const first = mustSignIn({ sessionId: "s1", baseHandle: "remy", now }, db, NO_BINDING);
  mintIdentity({ base: "remy", name: "remy", sessionId: "s-other", now: now + MIN }, db);
  const r = mustSignIn({ sessionId: "s1", continueId: "remy", now: now + 2 * MIN }, db, NO_BINDING);
  expect(r).toMatchObject({ handle: first.handle, continued: true });
});

test("continuing your own current id by id returns it with continued true", () => {
  const db = fresh();
  const first = mustSignIn({ sessionId: "s1", baseHandle: "remy", now }, db, NO_BINDING);
  const r = mustSignIn({ sessionId: "s1", continueId: first.handle, now: now + MIN }, db, NO_BINDING);
  expect(r).toMatchObject({ handle: first.handle, continued: true });
});

test("a session holding identity X continues identity Y and releases X", () => {
  const db = fresh();
  const x = mustSignIn({ sessionId: "s1", baseHandle: "kai", now }, db, NO_BINDING);
  const y = mintIdentity({ base: "remy", name: "remy", sessionId: null, now: now + MIN }, db);
  const r = mustSignIn({ sessionId: "s1", continueId: y.id, now: now + 2 * MIN }, db, NO_BINDING);
  expect(r).toMatchObject({ handle: y.id, continued: true });
  expect(getIdentity(x.handle, db)?.sessionId).toBeNull();
});
