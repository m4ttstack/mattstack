/**
 * The --json envelopes of the settings verbs are frozen byte for byte. The
 * fixtures were captured before these verbs moved onto lib/ui/out.ts. Run
 * with RT_UPDATE_SETTINGS_JSON_FIXTURES=1 only to add a case, never to make
 * a diff go away.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { settingsCheck, settingsExplain, settingsGet, settingsList, settingsMigrate } from "../settings-keys.ts";
import { sourcePathCommand } from "../settings.ts";
import { settingsSchemaDiff } from "../settings-schema.ts";
import { machineSettingsPath, userSettingsPath } from "../../lib/rt-paths.ts";
import { buildLock } from "../../lib/settings/schema-lock.ts";
import { closeStateDb } from "../../lib/state/index.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "settings-json");
const UPDATE = process.env.RT_UPDATE_SETTINGS_JSON_FIXTURES === "1";
const noPrompt = { interactive: false, confirm: async () => { throw new Error("must not prompt"); } };

describe("settings --json is frozen", () => {
  const origHome = process.env.HOME;
  let home: string;
  let cap: ReturnType<typeof captureOut>;
  let warn: ReturnType<typeof spyOn<typeof console, "warn">>;

  function write(file: string, obj: unknown): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(obj, null, 2));
  }

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-json-")));
    process.env.HOME = home;
    closeStateDb();
    process.exitCode = 0;
    // rt.worktrees is repoOnly, so a global value would read as an invalid rung; the seeds stay on
    // plain keys. The machine value is a deliberate type error, so `check` has a failing finding.
    write(userSettingsPath(), { "rt.logLevel": "debug" });
    write(machineSettingsPath(), { "rt.repoRoots": "nope" });
    // The fixtures are captured before conversion, when these verbs still print through console.*.
    cap = captureOut({ console: true });
    warn = spyOn(console, "warn").mockImplementation(() => {});
    out.__test__.setHuman(() => false);
  });

  afterEach(() => {
    warn.mockRestore();
    cap.restore();
    process.env.HOME = origHome;
    process.exitCode = 0;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  /** Paths and clocks differ per run; everything else is the contract. */
  function normalize(text: string): string {
    return text
      .replaceAll(machineSettingsPath(), "<MACHINE_STORE>")
      .replaceAll(home, "<HOME>")
      .replace(/"at":"[^"]+"/g, '"at":"<AT>"');
  }

  function frozen(name: string, text: string = cap.stdout()): void {
    const file = join(FIXTURES, `${name}.txt`);
    const got = normalize(text);
    if (UPDATE) {
      mkdirSync(FIXTURES, { recursive: true });
      writeFileSync(file, got);
    }
    expect(existsSync(file)).toBe(true);
    expect(got).toBe(readFileSync(file, "utf8"));
    expect(cap.stderr()).toBe("");
    for (const call of warn.mock.calls) expect(String(call[0])).toMatch(/^rt: ignoring "rt\.repoRoots"/);
  }

  test("get", async () => {
    await settingsGet(["rt.logLevel", "--json"]);
    frozen("get");
  });

  test("list", async () => {
    await settingsList(["--json"]);
    const raw = cap.stdout();
    const parsed = JSON.parse(raw) as { settings: { key: string }[] };
    expect(raw).toBe(`${JSON.stringify(parsed)}\n`);
    const seeded = { ...parsed, settings: parsed.settings.filter((s) => ["rt.logLevel", "rt.repoRoots"].includes(s.key)) };
    frozen("list", `${JSON.stringify(seeded)}\n`);
  });

  test("explain", async () => {
    await settingsExplain(["rt.logLevel", "--json"]);
    frozen("explain");
  });

  test("check", async () => {
    await settingsCheck(["--json"]);
    frozen("check");
    expect(process.exitCode).toBe(1);
  });

  test("migrate dry run", async () => {
    await settingsMigrate(["--json"], noPrompt);
    frozen("migrate");
  });

  test("migrate --write", async () => {
    await settingsMigrate(["--write", "--json"], noPrompt);
    frozen("migrate-write");
  });

  test("migrate --prune --yes", async () => {
    await settingsMigrate(["--prune", "--yes", "--json"], noPrompt);
    frozen("migrate-prune");
  });

  test("source-path", async () => {
    await sourcePathCommand(["--json"]);
    frozen("source-path");
  });

  test("schema diff", async () => {
    const lock = join(home, "lock.json");
    writeFileSync(lock, JSON.stringify(buildLock()));
    await settingsSchemaDiff(["--against", lock, "--json"], { shippedLock: null });
    frozen("schema-diff");
  });
});
