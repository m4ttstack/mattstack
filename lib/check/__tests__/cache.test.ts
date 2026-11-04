import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CHECK_CACHE_TTL_MS, cacheKey, readCached, realCacheDeps, writeCached, type CacheDeps } from "../cache.ts";
import type { CheckResult } from "../run.ts";
import { setWarningLog } from "../../ui/warn.ts";

type Green = Extract<CheckResult, { configured: true }>;

const green = (over: Partial<Green> = {}): Green => ({
  configured: true,
  verdict: "green",
  summary: {} as Green["summary"],
  sha: "abc",
  base: "main",
  dirty: false,
  command: "bun run check",
  outputTail: "",
  fromCache: false,
  ...over,
});

function memDeps(start = 1_000): CacheDeps & { files: Map<string, string>; clock: { t: number } } {
  const files = new Map<string, string>();
  const clock = { t: start };
  return {
    files,
    clock,
    now: () => clock.t,
    read: (p) => files.get(p) ?? null,
    write: (p, b) => void files.set(p, b),
  };
}

afterEach(() => setWarningLog(null));

const key = cacheKey("/t", "abc", "bun run check");

test("a green clean result is written and read back as fromCache", () => {
  const deps = memDeps();
  writeCached(key, green(), deps);
  const hit = readCached(key, deps);
  expect(hit?.fromCache).toBe(true);
  expect(hit?.sha).toBe("abc");
});

test("a red result is never written", () => {
  const deps = memDeps();
  writeCached(key, green({ verdict: "red" as Green["verdict"] }), deps);
  expect(deps.files.size).toBe(0);
  expect(readCached(key, deps)).toBeNull();
});

test("a dirty green result is never written", () => {
  const deps = memDeps();
  writeCached(key, green({ dirty: true }), deps);
  expect(deps.files.size).toBe(0);
});

test("an entry past one hour is not returned", () => {
  const deps = memDeps();
  writeCached(key, green(), deps);
  deps.clock.t += CHECK_CACHE_TTL_MS;
  expect(readCached(key, deps)).toBeNull();
});

test("a corrupt cache file reads as empty and is overwritten on the next write", () => {
  const deps = memDeps();
  deps.write("x", "{nope");
  for (const p of [...deps.files.keys()]) deps.files.delete(p);
  const probe: CacheDeps = { ...deps, read: () => "{nope" };
  expect(readCached(key, probe)).toBeNull();
  const writes: string[] = [];
  writeCached(key, green(), { ...probe, write: (_p, b) => void writes.push(b) });
  expect(Object.keys(JSON.parse(writes[0]!))).toEqual([key]);
});

test("an entry with the wrong stored shape reads as null", () => {
  const deps: CacheDeps = { ...memDeps(), read: () => JSON.stringify({ [key]: { at: 1_000 } }) };
  expect(readCached(key, deps)).toBeNull();
});

test("expired entries are dropped on write", () => {
  const deps = memDeps();
  writeCached(cacheKey("/t", "old", "c"), green(), deps);
  deps.clock.t += CHECK_CACHE_TTL_MS + 1;
  writeCached(key, green(), deps);
  const stored = JSON.parse([...deps.files.values()][0]!);
  expect(Object.keys(stored)).toEqual([key]);
});

test("the key separates tree, sha and command", () => {
  const keys = new Set([
    cacheKey("/a", "s", "c"),
    cacheKey("/b", "s", "c"),
    cacheKey("/a", "t", "c"),
    cacheKey("/a", "s", "d"),
  ]);
  expect(keys.size).toBe(4);
});

test("a failed real write warns and does not throw", () => {
  const dir = mkdtempSync(join(tmpdir(), "check-cache-"));
  const blocker = join(dir, "file");
  writeFileSync(blocker, "");
  const seen: string[] = [];
  setWarningLog((_m, message) => void seen.push(message), { quiet: true });
  expect(() => realCacheDeps.write(join(blocker, "sub", "c.json"), "{}")).not.toThrow();
  expect(seen.length).toBe(1);
});

test("the real read returns null for a missing file", () => {
  expect(realCacheDeps.read(join(tmpdir(), "no-such-check-cache.json"))).toBeNull();
});
