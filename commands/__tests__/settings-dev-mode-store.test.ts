/**
 * commands/settings.ts — dev-mode config storage (state.db, ns='dev-mode',
 * k='config'). This row has an out-of-tree reader (see
 * rt-tray/Sources-daemon-shim/main.swift and lib/state/db.ts's note on the
 * kv table) — round-trip and migrate-on-read behavior here must stay
 * compatible with what that Swift reader expects.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setWarningLog, __test__ as warningTest } from "../../lib/ui/warn.ts";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { restoreHome } from "../../lib/__tests__/home-env.ts";
import { rtDir } from "../../lib/rt-paths.ts";
import { closeStateDb, getStateDb, hasKvValue, setKvValue } from "../../lib/state/index.ts";
import { devModeConfigPath, enableDevMode, readDevModeConfig } from "../settings.ts";

describe("dev-mode config (state.db)", () => {
  let savedHome: string | undefined;
  let fixtureHome: string;

  beforeEach(() => {
    savedHome = process.env.HOME;
    fixtureHome = mkdtempSync(join(tmpdir(), "rt-devmode-cfg-"));
    closeStateDb();
    process.env.HOME = fixtureHome;
  });

  // State, wrapper and preload now share the fixture's call-time HOME.
  afterEach(() => {
    closeStateDb();
    restoreHome(savedHome);
    rmSync(fixtureHome, { recursive: true, force: true });
  });

  test("empty reads as {}", () => {
    expect(readDevModeConfig()).toEqual({});
  });

  test("round-trip via enableDevMode", () => {
    enableDevMode("/tmp/source-repo");
    expect(readDevModeConfig()).toMatchObject({ sourcePath: "/tmp/source-repo" });
    expect(typeof readDevModeConfig().bunPath).toBe("string");
  });

  test("a malformed stored value ({}) reads as {}", () => {
    setKvValue("dev-mode", "config", {});
    expect(readDevModeConfig()).toEqual({});
  });

  test("a malformed stored value (null) reads as {}", () => {
    setKvValue("dev-mode", "config", null);
    expect(readDevModeConfig()).toEqual({});
  });

  test("a non-string sourcePath/bunPath is dropped, not thrown", () => {
    setKvValue("dev-mode", "config", { sourcePath: 42, bunPath: ["x"] });
    expect(readDevModeConfig()).toEqual({});
  });

  test("a pre-existing dev-mode.json is imported on first read", () => {
    const path = devModeConfigPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ sourcePath: "/legacy/source", bunPath: "/legacy/bun" }));
    expect(existsSync(path)).toBe(true);

    expect(readDevModeConfig()).toEqual({ sourcePath: "/legacy/source", bunPath: "/legacy/bun" });
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.migrated`)).toBe(true);

    // A second read sees the store, not a re-import.
    expect(readDevModeConfig()).toEqual({ sourcePath: "/legacy/source", bunPath: "/legacy/bun" });
  });

  test("a corrupt dev-mode.json warns and is left in place; readDevModeConfig reads as {}", () => {
    const path = devModeConfigPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not valid json");
    warningTest.reset();
    const warnings: Array<{ module: string; message: string }> = [];
    setWarningLog((module, message) => warnings.push({ module, message }));

    try {
      expect(readDevModeConfig()).toEqual({});
      expect(existsSync(path)).toBe(true);
      expect(existsSync(`${path}.migrated`)).toBe(false);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.module).toBe("state");
      expect(warnings[0]?.message).toContain(`legacy state file ${path} is not valid JSON, left in place:`);
    } finally {
      warningTest.reset();
    }
  });

  test("enableDevMode renames (never deletes) a legacy dev-mode.json it supersedes", () => {
    const path = devModeConfigPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ sourcePath: "/legacy/source", bunPath: "/legacy/bun" }));

    enableDevMode("/fresh/source");
    expect(readDevModeConfig()).toMatchObject({ sourcePath: "/fresh/source" });
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.migrated`)).toBe(true);
  });

  test("real contended write: a held write lock during readDevModeConfig's import must NOT rename dev-mode.json — the next read must still see it and retry", () => {
    // Materialize AND KEEP OPEN state.db's singleton first (never
    // closeStateDb() here): readDevModeConfig's own getStateDb() call must
    // reuse this already-migrated connection during the lock window below,
    // or its own open+migrate BEGIN IMMEDIATE would contend with the lock
    // too and throw past MIGRATION_BUSY_TIMEOUT_MS instead of the plain
    // write hitting persistOrWarn's swallow — a different failure than the
    // one this test targets.
    getStateDb();
    const dbPath = join(rtDir(), "state.db");

    const path = devModeConfigPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ sourcePath: "/legacy/source", bunPath: "/legacy/bun" }));

    // A second, real connection holds the write lock past readDevModeConfig's
    // (cli-flavor, 5000ms) busy_timeout — a genuine SQLITE_BUSY, not a mock.
    const blocker = new Database(dbPath);
    blocker.exec("PRAGMA busy_timeout = 0;");
    blocker.exec("BEGIN IMMEDIATE;");

    let config: ReturnType<typeof readDevModeConfig>;
    try {
      config = readDevModeConfig();
    } finally {
      blocker.exec("ROLLBACK;");
      blocker.close();
    }

    // This caller still gets the correctly-parsed config (apply() did run)...
    expect(config).toEqual({ sourcePath: "/legacy/source", bunPath: "/legacy/bun" });
    // ...but the write never landed, so nothing may be destroyed: the file
    // must survive, and the store must still be empty.
    expect(existsSync(path)).toBe(true);
    expect(existsSync(`${path}.migrated`)).toBe(false);
    expect(hasKvValue("dev-mode", "config")).toBe(false);

    // The next read (lock released) succeeds for real and renames.
    expect(readDevModeConfig()).toEqual({ sourcePath: "/legacy/source", bunPath: "/legacy/bun" });
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.migrated`)).toBe(true);
  }, 20_000);
});
