import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  machineIdFor,
  openUsageDb,
  openUsageDbReadonly,
  USAGE_SCHEMA_VERSION,
} from "../store.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-store-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("opening creates every table", () => {
  const db = openUsageDb(join(dir, "usage.db"));
  const names = (
    db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  ).map((r) => r.name);
  for (const t of [
    "usage_messages",
    "usage_runs",
    "usage_stages",
    "usage_sessions",
    "usage_files",
    "usage_meta",
  ]) {
    expect(names).toContain(t);
  }
  expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(
    USAGE_SCHEMA_VERSION,
  );
  db.close();
});

test("reopening keeps rows", () => {
  const path = join(dir, "usage.db");
  const db = openUsageDb(path);
  db.query("INSERT INTO usage_meta (key, value) VALUES ('k', 'v')").run();
  db.close();
  const again = openUsageDb(path);
  expect(again.query("SELECT value FROM usage_meta WHERE key = 'k'").get()).toEqual({ value: "v" });
  again.close();
});

test("a null stable id falls back to one stored id", async () => {
  const db = openUsageDb(join(dir, "usage.db"));
  const a = await machineIdFor(db, async () => null);
  const b = await machineIdFor(db, async () => null);
  expect(a.length).toBeGreaterThan(0);
  expect(b).toBe(a);
  db.close();
});

test("a stable id is used as is", async () => {
  const db = openUsageDb(join(dir, "usage.db"));
  expect(await machineIdFor(db, async () => "abc")).toBe("abc");
  db.close();
});

test("readonly open of a missing file returns null", () => {
  expect(openUsageDbReadonly(join(dir, "missing.db"))).toBeNull();
});
