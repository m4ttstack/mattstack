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
