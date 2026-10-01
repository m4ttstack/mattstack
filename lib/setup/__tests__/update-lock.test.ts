import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
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

  test("the lock appears with its pid already in it and leaves no scratch file behind", () => {
    createUpdateLock(path, { pid: 111, alive: everyoneAlive }).acquire();

    expect(readdirSync(dirname(path))).toEqual(["setup-update.lock"]);
    expect(readFileSync(path, "utf8")).toBe("111");
  });

  test("a run evicted by the age cap does not remove its successor's lock when it releases", () => {
    const evicted = createUpdateLock(path, { pid: 111, alive: everyoneAlive });
    evicted.acquire();
    const now = Date.now();
    const old = new Date(now - UPDATE_LOCK_MAX_AGE_MS - 1000);
    utimesSync(path, old, old);
    const successor = createUpdateLock(path, { pid: 222, alive: everyoneAlive, now: () => now });
    expect(successor.acquire()).toBe(true);

    evicted.release();

    expect(readFileSync(path, "utf8")).toBe("222");
    expect(createUpdateLock(path, { pid: 333, alive: everyoneAlive, now: () => now }).acquire()).toBe(false);
  });

  test("the default liveness check tells this process from one that has exited", async () => {
    const child = Bun.spawn(["true"], { stdout: "ignore", stderr: "ignore" });
    await child.exited;

    createUpdateLock(path, { pid: process.pid }).acquire();
    expect(createUpdateLock(path, { pid: process.pid + 1 }).acquire()).toBe(false);

    writeFileSync(path, String(child.pid));
    expect(createUpdateLock(path, { pid: process.pid + 1 }).acquire()).toBe(true);
  });

  test("a lock path that cannot be read as a file throws instead of being taken over", () => {
    createUpdateLock(join(path, "inner"), { pid: 111, alive: everyoneAlive }).acquire();

    expect(() => createUpdateLock(path, { pid: 222, alive: everyoneAlive }).acquire()).toThrow();
    expect(existsSync(join(path, "inner"))).toBe(true);
  });
});
