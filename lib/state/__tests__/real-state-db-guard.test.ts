/**
 * A test run never opens the account's live state.db. Every case names a
 * scratch dir as the account home, so a guard that regresses reaches that
 * dir and never the real database.
 */
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { __test__ as isolation } from "../../../packages/rt-client/src/test-isolation.ts";
import { DAEMON_SOCK_PATH } from "../../daemon-config.ts";
import { daemonQuery } from "../../daemon-client.ts";
import * as pipeline from "../backup-pipeline.ts";
import { restoreFromBackup } from "../backup-restore.ts";
import { backupDestDir, BACKUP_SOURCES, snapshotSource } from "../backup-sources.ts";
import { closeStateDb, getStateDb, openStateDb, openStateDbGuarded } from "../index.ts";

const origHome = process.env.HOME;
let account: string;
let realDb: string;

beforeEach(() => {
  closeStateDb();
  account = realpathSync(mkdtempSync(join(tmpdir(), "rt-real-db-guard-")));
  realDb = join(account, ".mattstack", "rt", "state.db");
  isolation.setAccountHome(account);
});

afterEach(() => {
  closeStateDb();
  isolation.setAccountHome(undefined);
  process.env.HOME = origHome;
  rmSync(account, { recursive: true, force: true });
});

function seedDb(path: string): Buffer {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.run("CREATE TABLE marker (v TEXT)");
  db.close();
  return readFileSync(path);
}

test("openStateDb refuses the live db and creates nothing", () => {
  expect(() => openStateDb(realDb)).toThrow(/refusing to open/);
  expect(existsSync(dirname(realDb))).toBe(false);
});

test("openStateDbGuarded refuses before its version probe opens the file", () => {
  const before = seedDb(realDb);
  expect(() => openStateDbGuarded(realDb)).toThrow(/refusing to open/);
  expect(readFileSync(realDb).equals(before)).toBe(true);
});

test("getStateDb refuses when HOME names the account", () => {
  process.env.HOME = account;
  expect(() => getStateDb()).toThrow(/refusing to open/);
  expect(existsSync(realDb)).toBe(false);
});

test("a scratch db under ~/.mattstack/rt, as in a pool worktree, still opens", () => {
  const scratch = join(account, ".mattstack", "rt", "worktrees", "gh-acme-widgets", "slot", "state.db");
  openStateDb(scratch).close();
  expect(existsSync(scratch)).toBe(true);
});

test("a backup snapshot refuses the live db", async () => {
  seedDb(realDb);
  process.env.HOME = account;
  const source = BACKUP_SOURCES.find((s) => s.sourcePath === "rt/state.db")!;
  await expect(snapshotSource(source, account)).rejects.toThrow(/refusing to open/);
});

test("restoring from a backup leaves the live db alone", async () => {
  const before = seedDb(realDb);
  process.env.HOME = account;
  const appDir = join(backupDestDir(), "rt");
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, "rt-state-20260101-000000.zst.age"), "ciphertext");
  const decrypt = spyOn(pipeline, "restorePipeline").mockImplementation(async (_from: string, to: string) => {
    seedDb(to);
  });
  try {
    const result = await restoreFromBackup({ only: "rt", identityPath: "/unused", force: true });
    expect(result.restored).toEqual([]);
    expect(result.errors.join("\n")).toMatch(/refusing to open/);
    expect(readFileSync(realDb).equals(before)).toBe(true);
  } finally {
    decrypt.mockRestore();
  }
});

test("the CLI's daemon client refuses the live socket", async () => {
  isolation.setAccountHome(dirname(dirname(dirname(DAEMON_SOCK_PATH))));
  await expect(daemonQuery("chat:post")).rejects.toThrow(/refusing "chat:post"/);
});

test("outside a test run the guard is a no-op: the same path opens", () => {
  const script = join(account, "open.ts");
  const root = join(import.meta.dir, "..", "..", "..");
  writeFileSync(
    script,
    `import { openStateDb } from ${JSON.stringify(join(root, "lib", "state", "index.ts"))};\n` +
      `import { __test__ } from ${JSON.stringify(join(root, "packages", "rt-client", "src", "test-isolation.ts"))};\n` +
      `__test__.setAccountHome(${JSON.stringify(account)});\n` +
      `openStateDb(${JSON.stringify(realDb)}).close();\n`,
  );
  const child = spawnSync(process.execPath, [script], { cwd: account, env: { PATH: process.env.PATH, HOME: account }, encoding: "utf8" });
  expect(child.stderr).not.toMatch(/refusing/);
  expect(child.status).toBe(0);
  expect(existsSync(realDb)).toBe(true);
});
