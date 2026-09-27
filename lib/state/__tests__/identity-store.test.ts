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
