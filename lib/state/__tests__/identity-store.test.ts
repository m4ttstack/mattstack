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
  resolveHandle,
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

test("resolveHandle: an adopted legacy kai never matches as a minted id, but is the newest holder of the name once offline", () => {
  const db = fresh();
  member(db, "kai");
  const minted = mintIdentity({ base: "kai", name: "kai", sessionId: "s-new", now: 5 }, db);
  bindIdentitySession("kai", "s-legacy", db);
  seat(db, "s-new", minted.id, "kai", 5);
  expect(resolveHandle("kai", db)).toBe(minted.id);
  db.run("DELETE FROM chat_presence WHERE session_id = 's-new'");
  expect(resolveHandle("kai", db)).toBe("kai");
});

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
  const chat = mintIdentity({ base: "chat", name: "chat", sessionId: "s1", now: 5 }, db);
  expect(resolveHandle("chat.c6", db)).toBe("chat.c6");
  expect(resolveHandle("chat", db)).toBe(chat.id);
});

test("resolveHandle returns the human handle, the herd system poster and here as themselves even when a live identity shadows that name", () => {
  const db = fresh();
  for (const name of ["matt", "herdr", "here"]) {
    const shadow = mintIdentity({ base: name, name, sessionId: `s-${name}`, now: 1 }, db);
    seat(db, `s-${name}`, shadow.id, name, 1);
    expect(resolveHandle(name, db)).toBe(name);
  }
});
