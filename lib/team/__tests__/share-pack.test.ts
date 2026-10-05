import { rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { startSnapshot, teamSnapshotSpec } from "../../daemon/home-snapshot.ts";
import { openStateDb } from "../../state/db.ts";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import type { Probes } from "../../setup/probes.ts";
import { addTeam } from "../add.ts";
import { publishTeam } from "../publish.ts";
import { renderPlain } from "../../ui/out-plain.ts";
import { commitPendingPackShares, packShareBlocks, sharePack } from "../share-pack.ts";
import { readTeamLocal, teamLocalPath, updateTeamLocal } from "../team-local.ts";
import { cleanupOrgWorlds, orgWorld } from "./org-world.ts";

afterEach(cleanupOrgWorlds);

const seams = { writeOrgSetting: () => {}, engineDescription: () => "Use when running a unit of work." };

describe("sharePack", () => {
  test("commits the new pack folder and its marketplace entry together and pushes them in one push", async () => {
    const w = orgWorld();
    addTeam(w.p, { org: "acme", team: "gadgets", owners: ["dev2"] }, seams);
    const shared = await sharePack(w.p, "acme", "gadgets", ["mattstack/teams/gadgets", ".claude-plugin/marketplace.json"], async () => null);
    expect(shared).toEqual({ pushed: true, remote: w.remote });
    expect(w.pushes).toHaveLength(1);
    expect(w.atOrigin("log", "--format=%s", "main").trim().split("\n")).toEqual(["skills: new gadgets pack", "seed"]);
    const files = w.atOrigin("show", "--name-only", "--format=", "main").trim().split("\n");
    expect(files).toContain(".claude-plugin/marketplace.json");
    expect(files).toContain("mattstack/teams/gadgets/packs/gadgets/pack/skills.jsonc");
    expect(files).toContain("mattstack/teams/gadgets/packs/gadgets/.claude-plugin/plugin.json");
    expect(JSON.parse(w.atOrigin("show", "main:.claude-plugin/marketplace.json")).plugins).toEqual([expect.objectContaining({ name: "gadgets", source: "./mattstack/teams/gadgets/packs/gadgets" })]);
  });

  test("a failed push keeps the pack on this Mac and names the publish command", async () => {
    const w = orgWorld();
    w.git("remote", "set-url", "origin", join(w.home, "missing.git"));
    addTeam(w.p, { org: "acme", team: "gadgets", owners: ["dev2"] }, seams);
    const shared = await sharePack(w.p, "acme", "gadgets", ["mattstack/teams/gadgets", ".claude-plugin/marketplace.json"], async () => null);
    expect(shared).toMatchObject({ pushed: false, next: "rt team publish --team acme" });
    if (shared.pushed) return;
    expect(shared.reason.length).toBeGreaterThan(0);
    expect(w.p.exists(join(w.root, "mattstack/teams/gadgets/packs/gadgets/pack/skills.jsonc"))).toBe(true);
    expect(w.atOrigin("log", "--format=%s", "main").trim()).toBe("seed");
  });

  test("a failed commit is remembered, and the publish that follows commits only the remembered paths", async () => {
    const w = orgWorld();
    addTeam(w.p, { org: "acme", team: "gadgets", owners: ["dev2"] }, seams);
    const paths = ["mattstack/teams/gadgets/packs/gadgets", ".claude-plugin/marketplace.json"];
    writeFileSync(join(w.root, ".git", "index.lock"), "");
    const shared = await sharePack(w.p, "acme", "gadgets", paths, async () => null);
    expect(shared).toMatchObject({ pushed: false, next: "rt team publish --team acme" });
    expect(readTeamLocal(w.p, "acme").pendingPackShares).toEqual([{ pack: "gadgets", paths }]);
    rmSync(join(w.root, ".git", "index.lock"));

    expect(await commitPendingPackShares(w.p, "acme")).toEqual(["gadgets"]);
    await publishTeam(w.p, "acme", null, { token: null, tokenRemote: w.remote });

    const files = w.atOrigin("show", "--name-only", "--format=", "main").trim().split("\n");
    expect(files).toContain("mattstack/teams/gadgets/packs/gadgets/pack/skills.jsonc");
    expect(files).toContain(".claude-plugin/marketplace.json");
    expect(files).not.toContain("mattstack/teams/gadgets/settings.team.jsonc");
    expect(readTeamLocal(w.p, "acme").pendingPackShares).toBeUndefined();
  });

  test("a remembered pack whose folder is gone is dropped, not committed", async () => {
    const w = orgWorld();
    updateTeamLocal(w.p, "acme", { pendingPackShares: [{ pack: "gadgets", paths: ["mattstack/teams/gadgets/packs/gadgets", ".claude-plugin/marketplace.json"] }] });
    expect(await commitPendingPackShares(w.p, "acme")).toEqual([]);
    expect(readTeamLocal(w.p, "acme").pendingPackShares).toBeUndefined();
    expect(w.git("log", "--format=%s").trim()).toBe("seed");
  });

  test("while a share is pending the team snapshot holds the marketplace entry back, and the publish sends both", async () => {
    const w = orgWorld();
    addTeam(w.p, { org: "acme", team: "gadgets", owners: ["dev2"] }, seams);
    writeFileSync(join(w.root, ".git", "index.lock"), "");
    await sharePack(w.p, "acme", "gadgets", ["mattstack/teams/gadgets/packs/gadgets", ".claude-plugin/marketplace.json"], async () => null);
    rmSync(join(w.root, ".git", "index.lock"));
    writeFileSync(join(w.root, "mattstack/teams/widgets/settings.team.jsonc"), "{ \"board.title\": \"edited\" }\n");

    const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
    const spec = teamSnapshotSpec("acme", w.root, { ownedRoots: ["mattstack", ".sops.yaml", ".claude-plugin"], pullIntervalSec: 600, originUrl: w.remote, probes: w.p, readToken: async () => null });
    const handle = startSnapshot(spec, {
      log: quiet,
      broadcast: () => {},
      db: openStateDb(join(w.home, "state.db"), "cli"),
      readSettings: () => ({ enabled: true, debounceSec: 5, pushDelaySec: 1, janitorThresholdHours: 1, janitorIntervalMin: 15 }),
      readOwners: () => ({ zones: {} }),
    });
    try {
      await handle.ready;
      const round = await handle.runNow("manual");
      expect(round.committed).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } finally {
      handle.stop();
    }

    const snapshotFiles = w.atOrigin("show", "--name-only", "--format=", "main").trim().split("\n");
    expect(snapshotFiles).toContain("mattstack/teams/widgets/settings.team.jsonc");
    expect(snapshotFiles).not.toContain(".claude-plugin/marketplace.json");
    expect(JSON.parse(w.atOrigin("show", "main:.claude-plugin/marketplace.json")).plugins).toEqual([]);

    expect(await commitPendingPackShares(w.p, "acme")).toEqual(["gadgets"]);
    await publishTeam(w.p, "acme", null, { token: null, tokenRemote: w.remote });
    expect(w.atOrigin("show", "main:mattstack/teams/gadgets/packs/gadgets/pack/skills.jsonc").length).toBeGreaterThan(0);
    expect(JSON.parse(w.atOrigin("show", "main:.claude-plugin/marketplace.json")).plugins).toEqual([expect.objectContaining({ name: "gadgets" })]);
  }, 15_000);

  test("a share the moved org repo rejected tells a person to pull first, then publish", () => {
    const text = renderPlain(packShareBlocks("gadgets", { pushed: false, reason: "The org repo has changes this Mac does not have yet", next: "rt team pull --team acme", thenRun: "rt team publish --team acme" }));
    expect(text).toContain("The gadgets pack is not shared with your org yet");
    expect(text).toMatch(/Run rt team pull --team acme, then share it with rt team publish --team acme/);
  });

  test("a member's Mac never commits or pushes", async () => {
    const calls: string[][] = [];
    const p: Probes = fakeProbes({
      home: "/home/x",
      dirs: { "/home/x/.mattstack/teams/acme": [] },
      files: {
        "/home/x/.mattstack/teams/acme/mattstack/org/settings.org.jsonc": JSON.stringify({ "mattstack.org": { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } } }),
        [teamLocalPath("/home/x", "acme")]: JSON.stringify({ forgeUsername: "dev3" }),
      },
      exec: (argv) => { calls.push(argv); return { code: 0, stdout: "", stderr: "" }; },
    });
    await expect(sharePack(p, "acme", "widgets", ["mattstack/teams/widgets/packs/widgets"], async () => null)).rejects.toMatchObject({ code: "team-pull-only" });
    expect(calls).toEqual([]);
  });
});
