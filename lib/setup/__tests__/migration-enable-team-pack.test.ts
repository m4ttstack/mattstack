import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ApplyContext } from "../apply.ts";
import { enableTeamPackMigration } from "../migrations/enable-team-pack.ts";
import { MIGRATIONS } from "../migrations/index.ts";
import { fakeProbes, ok } from "./fakes.ts";

describe("2026-10-17-enable-team-pack", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-mig-team-pack-")));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  /** A Mac on team acme in org acme, whose claude lists `installed` and records every argv. */
  function harness(installed: { id: string; enabled: boolean }[], opts: { enableFails?: boolean } = {}) {
    const execCalls: { argv: string[]; dir?: string }[] = [];
    const marketplacePath = join(home, ".mattstack", "orgs", "acme", ".claude-plugin", "marketplace.json");
    const p = fakeProbes({
      home,
      env: { PATH: "/usr/local/bin" },
      files: { "/usr/local/bin/claude": "bin", [marketplacePath]: JSON.stringify({ name: "acme-market", plugins: [{ name: "acme" }, { name: "widgets" }] }) },
      exec: async (argv, execOpts) => {
        execCalls.push({ argv, dir: execOpts?.env?.CLAUDE_CONFIG_DIR });
        if (argv[2] === "enable" && opts.enableFails) return { code: 1, stdout: "", stderr: "settings.json is not writable" };
        return argv[2] === "list" ? ok(JSON.stringify(installed.map((e) => ({ ...e, version: "1.0.0" })))) : ok("");
      },
    });
    const ctx = { p, log: () => {}, team: { slug: "acme", name: "Acme", mode: "none" }, activeTeam: () => "acme" } as Partial<ApplyContext> as ApplyContext;
    return { ctx, execCalls };
  }

  const enables = (execCalls: { argv: string[]; dir?: string }[]) => execCalls.filter((c) => c.argv[2] === "enable");

  test("is registered with its dated id and title", () => {
    expect(MIGRATIONS).toContain(enableTeamPackMigration);
    expect(enableTeamPackMigration.id).toBe("2026-10-17-enable-team-pack");
    expect(enableTeamPackMigration.title).toBe("Turn on your team's plugin");
  });

  test("turns on the active team's pack where it is installed and off, in that config folder", async () => {
    const { ctx, execCalls } = harness([{ id: "acme@acme-market", enabled: false }]);

    expect((await enableTeamPackMigration.run(ctx)).state).toBe("done");
    expect(enables(execCalls)).toEqual([{ argv: ["/usr/local/bin/claude", "plugin", "enable", "acme@acme-market"], dir: join(home, ".claude") }]);
  });

  test("an already enabled pack is skipped", async () => {
    const { ctx, execCalls } = harness([{ id: "acme@acme-market", enabled: true }]);

    expect((await enableTeamPackMigration.run(ctx)).state).toBe("skipped");
    expect(enables(execCalls)).toEqual([]);
  });

  test("a pack that is not installed is skipped, not installed", async () => {
    const { ctx, execCalls } = harness([]);

    expect((await enableTeamPackMigration.run(ctx)).state).toBe("skipped");
    expect(execCalls.filter((c) => c.argv[2] !== "list")).toEqual([]);
  });

  test("a previous team's disabled pack is left alone", async () => {
    const { ctx, execCalls } = harness([
      { id: "acme@acme-market", enabled: true },
      { id: "widgets@acme-market", enabled: false },
    ]);

    expect((await enableTeamPackMigration.run(ctx)).state).toBe("skipped");
    expect(execCalls.some((c) => c.argv.includes("widgets@acme-market"))).toBe(false);
  });

  test("a Mac on no team is skipped without running claude", async () => {
    const { ctx, execCalls } = harness([{ id: "acme@acme-market", enabled: false }]);
    ctx.activeTeam = () => null;

    expect((await enableTeamPackMigration.run(ctx)).state).toBe("skipped");
    expect(execCalls).toEqual([]);
  });

  test("an enable claude refuses is failed, so the migration runs again next time", async () => {
    const { ctx } = harness([{ id: "acme@acme-market", enabled: false }], { enableFails: true });

    const outcome = await enableTeamPackMigration.run(ctx);
    expect(outcome.state).toBe("failed");
    expect("detail" in outcome && outcome.detail).toContain("settings.json is not writable");
  });
});
