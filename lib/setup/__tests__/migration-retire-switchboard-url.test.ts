import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { machineSettingsPath, userSettingsPath } from "../../rt-paths.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import type { ApplyContext } from "../apply.ts";
import { MIGRATIONS } from "../migrations/index.ts";
import { retireSwitchboardUrlMigration } from "../migrations/retire-switchboard-url.ts";
import { fakeProbes } from "./fakes.ts";

const ctxWith = (p: ApplyContext["p"]): ApplyContext => ({ p }) as Partial<ApplyContext> as ApplyContext;

describe("2026-10-02-retire-switchboard-url", () => {
  const origHome = process.env.HOME;
  let home: string;
  let boardConfig: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-mig-sb-")));
    process.env.HOME = home;
    boardConfig = join(home, ".mattstack", "board", "config.json");
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  function seedMachine(): void {
    mkdirSync(dirname(machineSettingsPath()), { recursive: true });
    writeFileSync(machineSettingsPath(), `{\n  "board.switchboardUrl": "https://old.example.app",\n  "mattstack.appPath": "/Applications/mattstack.app"\n}\n`);
  }

  test("is registered after the board-peer migration, so ids stay in date order", () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(ids).toContain("2026-10-01-board-peer-trigger");
    expect(ids).toContain("2026-10-02-retire-switchboard-url");
    expect(ids.indexOf("2026-10-01-board-peer-trigger")).toBeLessThan(ids.indexOf("2026-10-02-retire-switchboard-url"));
  });

  test("deletes all three stored copies and keeps forgeHost and the rest of config.json", async () => {
    seedMachine();
    setSetting("rt.integrations", { forgeHost: "gitlab.example.com", switchboardUrl: "https://old.example.app" }, "user");
    const p = fakeProbes({ home, files: { [boardConfig]: JSON.stringify({ title: "Board", switchboard: { url: "https://old.example.app" } }) } });

    expect(await retireSwitchboardUrlMigration.run(ctxWith(p))).toEqual({ state: "done", detail: "Removed the old switchboard address" });

    const machine = readFileSync(machineSettingsPath(), "utf8");
    expect(machine).not.toContain("board.switchboardUrl");
    expect(machine).toContain("mattstack.appPath");
    expect(getSetting<Record<string, unknown>>("rt.integrations").value).toEqual({ forgeHost: "gitlab.example.com" });
    expect(JSON.parse(p.readFile(boardConfig)!)).toEqual({ title: "Board" });
  });

  test("a latch holding only the switchboard URL is removed outright", async () => {
    setSetting("rt.integrations", { switchboardUrl: "https://old.example.app" }, "user");

    await retireSwitchboardUrlMigration.run(ctxWith(fakeProbes({ home })));

    expect(readFileSync(userSettingsPath(), "utf8")).not.toContain("rt.integrations");
  });

  test("a switchboard block with other fields keeps them and loses only url", async () => {
    const p = fakeProbes({ home, files: { [boardConfig]: JSON.stringify({ switchboard: { url: "https://old.example.app", note: "keep" } }) } });

    await retireSwitchboardUrlMigration.run(ctxWith(p));

    expect(JSON.parse(p.readFile(boardConfig)!)).toEqual({ switchboard: { note: "keep" } });
  });

  test("BOARD_APP_ROOT's config.json is cleaned too", async () => {
    const pinned = "/srv/board/config.json";
    const p = fakeProbes({ home, env: { BOARD_APP_ROOT: "/srv/board" }, files: { [pinned]: JSON.stringify({ switchboard: { url: "https://old.example.app" } }) } });

    expect((await retireSwitchboardUrlMigration.run(ctxWith(p))).state).toBe("done");
    expect(JSON.parse(p.readFile(pinned)!)).toEqual({});
  });

  test("an unparseable config.json is left alone and does not fail the migration", async () => {
    const p = fakeProbes({ home, files: { [boardConfig]: "{ not json" } });

    expect(await retireSwitchboardUrlMigration.run(ctxWith(p))).toEqual({ state: "skipped", detail: "No old switchboard address on this Mac" });
    expect(p.readFile(boardConfig)).toBe("{ not json");
  });

  test("is idempotent: a second run finds nothing", async () => {
    seedMachine();
    setSetting("rt.integrations", { forgeHost: "gitlab.example.com", switchboardUrl: "https://old.example.app" }, "user");
    const p = fakeProbes({ home, files: { [boardConfig]: JSON.stringify({ switchboard: { url: "https://old.example.app" } }) } });

    await retireSwitchboardUrlMigration.run(ctxWith(p));
    expect(await retireSwitchboardUrlMigration.run(ctxWith(p))).toEqual({ state: "skipped", detail: "No old switchboard address on this Mac" });
    expect(getSetting<Record<string, unknown>>("rt.integrations").value).toEqual({ forgeHost: "gitlab.example.com" });
  });

  test("a clean Mac is skipped", async () => {
    expect(await retireSwitchboardUrlMigration.run(ctxWith(fakeProbes({ home })))).toEqual({ state: "skipped", detail: "No old switchboard address on this Mac" });
  });
});
