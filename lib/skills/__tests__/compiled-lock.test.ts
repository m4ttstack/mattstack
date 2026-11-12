import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CompiledLock, LOCK_REL, lockWrite, mergeLock, readLock, serializeLock } from "../compiled-lock";

const lock = (p: Partial<CompiledLock> = {}): CompiledLock => ({ targets: {}, bases: {}, mattstackSha: {}, mattstackDirty: {}, ...p });

describe("compiled lock", () => {
  test("mergeLock keeps targets a partial compile did not touch", () => {
    const current = lock({ targets: { "skills/work": { acme: "0.32.55" }, "skills/review": { acme: "0.4.11" } } });
    const next = mergeLock(current, lock({ targets: { "skills/work": { acme: "0.32.56" } } }));
    expect(next.targets["skills/work"]).toEqual({ acme: "0.32.56" });
    expect(next.targets["skills/review"]).toEqual({ acme: "0.4.11" });
  });

  test("mergeLock merges bases per key and keeps them when none were emitted", () => {
    const current = lock({ bases: { "acme-base": "0.2.3" } });
    expect(mergeLock(current, lock()).bases).toEqual({ "acme-base": "0.2.3" });
    expect(mergeLock(current, lock({ bases: { "acme-base": "0.2.4" } })).bases).toEqual({ "acme-base": "0.2.4" });
  });

  test("mergeLock drops a recompiled target's old sha", () => {
    const current = lock({ targets: { "skills/work": { acme: "1" } }, mattstackSha: { "skills/work": "abc" }, mattstackDirty: { "skills/work": 1 } });
    const next = mergeLock(current, lock({ targets: { "skills/work": { acme: "2" } } }));
    expect(next.mattstackSha).toEqual({});
    expect(next.mattstackDirty).toEqual({});
  });

  test("serializeLock is stable across key order", () => {
    const a = lock({ bases: { b: "1", a: "2" } });
    const b = lock({ bases: { a: "2", b: "1" } });
    expect(serializeLock(a)).toBe(serializeLock(b));
    expect(serializeLock(a).endsWith("\n")).toBe(true);
  });

  test("readLock treats a missing or damaged file as empty", () => {
    expect(readLock("/x", () => null)).toEqual(lock());
    expect(readLock("/x", () => "{nope")).toEqual(lock());
  });

  test("lockWrite reports stale without writing when write is false", () => {
    const dir = mkdtempSync(join(tmpdir(), "lock-"));
    try {
      const r = lockWrite(dir, lock({ bases: { "acme-base": "1" } }), () => null, false);
      expect(r).toEqual({ written: [], removed: [], stale: true });
      expect(existsSync(join(dir, LOCK_REL))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
