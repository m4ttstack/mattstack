import { Database } from "bun:sqlite";
import { tmpdir } from "os";
import { join } from "path";
import { expect, test } from "bun:test";
import { CHAT_RETENTION_MS } from "../chat-store.ts";
import { openStateDb, SCHEMA_VERSION } from "../db.ts";
import {
  dropStatus,
  getRequest,
  insertRequest,
  listRequests,
  moveRequest,
  pendingStatuses,
  pruneSupport,
  queueStatus,
  recordStop,
  requestForConversation,
  requestForGate,
  SUPPORT_TERMINAL_STATES,
  stoppedSince,
  type SupportRequest,
} from "../support-store.ts";

let n = 0;
function dbPath() {
  return join(tmpdir(), `support-store-test-${process.pid}-${n++}-${Date.now()}.db`);
}
function fresh() {
  return openStateDb(dbPath());
}

const request = (over: Partial<SupportRequest> = {}): Omit<SupportRequest, "updatedAt"> => ({
  id: "r1",
  direction: "in",
  peer: "ada",
  org: "acme",
  text: "the board will not load",
  parts: [{ key: "versions", label: "Versions", value: "rt 1.2.3" }],
  slackUserId: "U0TEST",
  state: "received",
  reason: null,
  persona: null,
  dmLink: null,
  conversationId: null,
  gateId: null,
  statusAt: 0,
  sentAt: 900,
  receivedAt: 1000,
  ...over,
});

test("a request reads back as it was stored", () => {
  const db = fresh();
  expect(insertRequest(request(), db)).toBe(true);
  expect(getRequest("in", "ada", "r1", db)).toEqual({ ...request(), updatedAt: 1000 });
  expect(getRequest("out", "ada", "r1", db)).toBeNull();
});

test("a repeat insert is false and changes nothing", () => {
  const db = fresh();
  insertRequest(request(), db);
  expect(insertRequest(request({ text: "other", state: "failed", receivedAt: 5000 }), db)).toBe(false);
  expect(getRequest("in", "ada", "r1", db)).toMatchObject({ text: "the board will not load", state: "received", receivedAt: 1000 });
});

test("a row that is not a repeat but cannot be stored throws, rather than reading as a repeat", () => {
  const db = fresh();
  expect(() => insertRequest(request({ text: null as unknown as string }), db)).toThrow();
});

test("two peers may use the same id", () => {
  const db = fresh();
  expect(insertRequest(request(), db)).toBe(true);
  expect(insertRequest(request({ peer: "bo" }), db)).toBe(true);
  expect(insertRequest(request({ direction: "out" }), db)).toBe(true);
  expect(listRequests("in", undefined, db).map((r) => r.peer)).toEqual(["ada", "bo"]);
});

test("requests list in arrival order, by state when asked", () => {
  const db = fresh();
  insertRequest(request({ id: "late", receivedAt: 3000 }), db);
  insertRequest(request({ id: "early", receivedAt: 2000 }), db);
  insertRequest(request({ id: "early-2", receivedAt: 2000 }), db);
  insertRequest(request({ id: "done", receivedAt: 1000, state: "opened" }), db);
  expect(listRequests("in", ["received"], db).map((r) => r.id)).toEqual(["early", "early-2", "late"]);
  expect(listRequests("in", undefined, db).map((r) => r.id)).toEqual(["done", "early", "early-2", "late"]);
  expect(listRequests("in", [], db)).toEqual([]);
});

test("moveRequest moves only from a named state", () => {
  const db = fresh();
  insertRequest(request(), db);
  const key = { direction: "in", peer: "ada", id: "r1" } as const;
  expect(moveRequest(key, ["received"], { state: "opening" }, 2000, db)).toBe(true);
  expect(moveRequest(key, ["received"], { state: "opening" }, 3000, db)).toBe(false);
  expect(getRequest("in", "ada", "r1", db)).toMatchObject({ state: "opening", updatedAt: 2000 });
  expect(moveRequest({ ...key, peer: "bo" }, ["opening"], { state: "failed" }, 4000, db)).toBe(false);
  expect(moveRequest(key, [], { state: "failed" }, 4000, db)).toBe(false);
});

test("moveRequest changes only the fields it is given", () => {
  const db = fresh();
  insertRequest(request({ gateId: "g1" }), db);
  const key = { direction: "in", peer: "ada", id: "r1" } as const;
  moveRequest(key, ["received"], { conversationId: 7, statusAt: 55 }, 2000, db);
  expect(getRequest("in", "ada", "r1", db)).toMatchObject({ state: "received", conversationId: 7, gateId: "g1", statusAt: 55 });
  moveRequest(key, ["received"], { state: "failed", reason: "no folder", gateId: null }, 2000, db);
  expect(getRequest("in", "ada", "r1", db)).toMatchObject({ state: "failed", reason: "no folder", gateId: null, conversationId: 7 });
});

test("a request is found by its conversation or its gate, on the host's side only", () => {
  const db = fresh();
  insertRequest(request({ conversationId: 7, gateId: "g1" }), db);
  insertRequest(request({ direction: "out", id: "mine", conversationId: 8, gateId: "g2" }), db);
  expect(requestForConversation(7, db)?.id).toBe("r1");
  expect(requestForGate("g1", db)?.id).toBe("r1");
  expect(requestForConversation(8, db)).toBeNull();
  expect(requestForGate("g2", db)).toBeNull();
});

test("a queued status and its state move commit together", () => {
  const db = fresh();
  insertRequest(request(), db);
  const key = { direction: "in", peer: "ada", id: "r1" } as const;
  expect(() =>
    db.transaction(() => {
      moveRequest(key, ["received"], { state: "opening" }, 2000, db);
      queueStatus({ id: "r1:received", to: "ada", body: "{}" }, 2000, db);
      throw new Error("boom");
    })(),
  ).toThrow("boom");
  expect(getRequest("in", "ada", "r1", db)?.state).toBe("received");
  expect(pendingStatuses(db)).toEqual([]);
});

test("statuses wait in order until dropped, one per id and person", () => {
  const db = fresh();
  queueStatus({ id: "r1:received", to: "ada", body: "a" }, 2000, db);
  queueStatus({ id: "r1:opened", to: "ada", body: "b" }, 2000, db);
  queueStatus({ id: "r1:received", to: "ada", body: "again" }, 3000, db);
  queueStatus({ id: "r1:received", to: "bo", body: "c" }, 1000, db);
  expect(pendingStatuses(db)).toEqual([
    { id: "r1:received", to: "ada", body: "a", createdAt: 2000 },
    { id: "r1:opened", to: "ada", body: "b", createdAt: 2000 },
    { id: "r1:received", to: "bo", body: "c", createdAt: 1000 },
  ]);
  dropStatus("r1:received", "ada", db);
  expect(pendingStatuses(db).map((s) => `${s.to} ${s.id}`)).toEqual(["ada r1:opened", "bo r1:received"]);
});

test("stoppedSince is true inside the window and false after", () => {
  const db = fresh();
  recordStop("U0TEST", 1000, db);
  expect(stoppedSince("U0TEST", 1000, db)).toBe(true);
  expect(stoppedSince("U0TEST", 1001, db)).toBe(false);
  expect(stoppedSince("U0OTHER", 0, db)).toBe(false);
  recordStop("U0TEST", 5000, db);
  expect(stoppedSince("U0TEST", 1001, db)).toBe(true);
});

test("prune keeps open and waiting rows", () => {
  const db = fresh();
  const now = CHAT_RETENTION_MS * 2;
  for (const state of ["sent", "received", "opening", "waiting", ...SUPPORT_TERMINAL_STATES] as const)
    insertRequest(request({ id: state, state, receivedAt: 1000 }), db);
  insertRequest(request({ id: "recent", state: "opened", receivedAt: now - CHAT_RETENTION_MS + 1 }), db);
  recordStop("U0OLD", 1000, db);
  queueStatus({ id: "old", to: "ada", body: "{}" }, 1000, db);
  queueStatus({ id: "new", to: "ada", body: "{}" }, now - 1, db);
  recordStop("U0NEW", now - 1, db);
  pruneSupport(now, db);
  expect(listRequests("in", undefined, db).map((r) => r.id).sort()).toEqual(["opening", "received", "recent", "sent", "waiting"]);
  expect(stoppedSince("U0OLD", 0, db)).toBe(false);
  expect(stoppedSince("U0NEW", 0, db)).toBe(true);
  expect(pendingStatuses(db).map((s) => s.id)).toEqual(["new"]);
});

test("a v18 db gains the tables and keeps its rows", () => {
  const path = dbPath();
  const before = openStateDb(path);
  before.query("INSERT INTO slack_items (conversation_id, kind, text, created_at) VALUES (1, 'message', 'kept', 1)").run();
  for (const t of ["support_requests", "support_outbox", "support_stops"]) before.exec(`DROP TABLE ${t};`);
  before.exec("PRAGMA user_version = 18;");
  before.close();

  const after = openStateDb(path) as Database;
  expect(SCHEMA_VERSION).toBe(19);
  expect((after.query("PRAGMA user_version;").get() as { user_version: number }).user_version).toBe(19);
  expect(insertRequest(request(), after)).toBe(true);
  expect(after.query("SELECT text FROM slack_items").get()).toEqual({ text: "kept" });
});
