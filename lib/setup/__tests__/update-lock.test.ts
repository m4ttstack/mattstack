import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createUpdateLock, UPDATE_LOCK_MAX_AGE_MS, updateLockPath } from "../update-lock.ts";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-update-lock-"));
  path = join(dir, "nested", "setup-update.lock");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const everyoneAlive = () => true;
const nobodyAlive = () => false;

describe("updateLockPath", () => {
  test("sits beside setup-state.json", () => {
    expect(updateLockPath("/fake-home")).toBe("/fake-home/.mattstack/rt/setup-update.lock");
  });
});

describe("createUpdateLock", () => {
  test("the first taker holds it and writes its pid; a second taker is refused while the holder lives", () => {
    const first = createUpdateLock(path, { pid: 111, alive: everyoneAlive });
    const second = createUpdateLock(path, { pid: 222, alive: everyoneAlive });

    expect(first.acquire()).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("111");
    expect(second.acquire()).toBe(false);
    expect(readFileSync(path, "utf8")).toBe("111");
  });

  test("release frees it for the next taker", () => {
    const first = createUpdateLock(path, { pid: 111, alive: everyoneAlive });
    const second = createUpdateLock(path, { pid: 222, alive: everyoneAlive });

    expect(first.acquire()).toBe(true);
    first.release();
    expect(existsSync(path)).toBe(false);
    expect(second.acquire()).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("222");
  });

  test("a refused taker's release leaves the holder's lock in place", () => {
    const first = createUpdateLock(path, { pid: 111, alive: everyoneAlive });
    const second = createUpdateLock(path, { pid: 222, alive: everyoneAlive });

    expect(first.acquire()).toBe(true);
    expect(second.acquire()).toBe(false);
    second.release();
    expect(readFileSync(path, "utf8")).toBe("111");
  });

  test("a lock left by a dead pid is taken over", () => {
    createUpdateLock(path, { pid: 111, alive: everyoneAlive }).acquire();
    const next = createUpdateLock(path, { pid: 222, alive: nobodyAlive });

    expect(next.acquire()).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("222");
  });

  test("a lock with no readable pid is taken over", () => {
    createUpdateLock(path, { pid: 111, alive: everyoneAlive }).acquire();
    writeFileSync(path, "not a pid");
    const next = createUpdateLock(path, { pid: 222, alive: everyoneAlive });

    expect(next.acquire()).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("222");
  });

  test("a lock older than the age cap is taken over even when its pid is alive", () => {
    createUpdateLock(path, { pid: 111, alive: everyoneAlive }).acquire();
    const now = Date.now();
    const old = new Date(now - UPDATE_LOCK_MAX_AGE_MS - 1000);
    utimesSync(path, old, old);
    const next = createUpdateLock(path, { pid: 222, alive: everyoneAlive, now: () => now });

    expect(next.acquire()).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("222");
  });

  test("a fresh lock held by a live pid is not taken over by the age cap", () => {
    createUpdateLock(path, { pid: 111, alive: everyoneAlive }).acquire();
    const next = createUpdateLock(path, { pid: 222, alive: everyoneAlive, now: () => Date.now() });

    expect(next.acquire()).toBe(false);
  });
});
