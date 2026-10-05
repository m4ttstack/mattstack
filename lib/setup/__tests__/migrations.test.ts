import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { machineSettingsPath, userSettingsPath } from "../../rt-paths.ts";
import { runUpdateWith, type ApplyContext } from "../apply.ts";
import { MIGRATIONS } from "../migrations/index.ts";
import { readSetupState } from "../state.ts";
import { fakeProbes } from "./fakes.ts";

describe("2026-10-01-unset-board-default-pack", () => {
  const origHome = process.env.HOME;
  let home: string;
  const migration = MIGRATIONS.find((m) => m.id === "2026-10-01-unset-board-default-pack")!;
  const ctx = {} as ApplyContext;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-migration-")));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("removes the user-global value while preserving header comments, unrelated values and other scopes", async () => {
    const repos = '  "repos": {\n    "gitlab.example.com/acme/widgets": {\n      "board.defaultPack": "gadgets"\n    }\n  }';
    mkdirSync(dirname(userSettingsPath()), { recursive: true });
    writeFileSync(userSettingsPath(), `// mine\n{\n  "board.defaultPack": "widgets",\n  "rt.logLevel": "debug",\n${repos}\n}\n`);
    const machine = '// this Mac\n{ "board.defaultPack": "gadgets" }\n';
    mkdirSync(dirname(machineSettingsPath()), { recursive: true });
    writeFileSync(machineSettingsPath(), machine);

    expect(await migration.run(ctx)).toEqual({ state: "done", detail: "Removed the old default pack setting" });

    expect(readFileSync(userSettingsPath(), "utf8")).toBe(`// mine\n{\n  "rt.logLevel": "debug",\n${repos}\n}\n`);
    expect(readFileSync(machineSettingsPath(), "utf8")).toBe(machine);
  });

  test("with no settings file it skips without creating a store", async () => {
    expect(await migration.run(ctx)).toEqual({ state: "skipped", detail: "There was no old default pack setting" });
    expect(existsSync(userSettingsPath())).toBe(false);
  });

  test("with nothing to remove it leaves the file byte-for-byte intact", async () => {
    const text = '// mine\n{ "rt.logLevel": "debug" }\n';
    mkdirSync(dirname(userSettingsPath()), { recursive: true });
    writeFileSync(userSettingsPath(), text);

    expect(await migration.run(ctx)).toEqual({ state: "skipped", detail: "There was no old default pack setting" });
    expect(readFileSync(userSettingsPath(), "utf8")).toBe(text);
  });

  test("a second run skips without changing the cleaned file", async () => {
    mkdirSync(dirname(userSettingsPath()), { recursive: true });
    writeFileSync(userSettingsPath(), '// mine\n{ "board.defaultPack": "widgets", "rt.logLevel": "debug" }\n');

    expect((await migration.run(ctx)).state).toBe("done");
    const cleaned = readFileSync(userSettingsPath(), "utf8");
    expect(await migration.run(ctx)).toEqual({ state: "skipped", detail: "There was no old default pack setting" });
    expect(readFileSync(userSettingsPath(), "utf8")).toBe(cleaned);
  });

  test("a skipped migration is recorded and omitted from the next update", async () => {
    const p = fakeProbes({ home });
    const updateCtx = { p, emit: () => {} } as unknown as ApplyContext;

    const first = await runUpdateWith([], [migration], updateCtx);
    expect(first).toEqual({ ok: true, failedSteps: [], outcomes: [{ id: "migration.2026-10-01-unset-board-default-pack", state: "skipped", detail: "There was no old default pack setting" }] });
    expect(readSetupState(p).migrations).toEqual(["2026-10-01-unset-board-default-pack"]);
    expect(await runUpdateWith([], [migration], updateCtx)).toEqual({ ok: true, failedSteps: [], outcomes: [] });
  });
});
