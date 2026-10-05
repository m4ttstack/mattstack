import { join } from "path";
import { afterEach, describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import type { Probes } from "../../setup/probes.ts";
import { addTeam } from "../add.ts";
import { sharePack } from "../share-pack.ts";
import { teamLocalPath } from "../team-local.ts";
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
    expect(shared).toMatchObject({ pushed: false, next: "rt team publish" });
    if (shared.pushed) return;
    expect(shared.reason.length).toBeGreaterThan(0);
    expect(w.p.exists(join(w.root, "mattstack/teams/gadgets/packs/gadgets/pack/skills.jsonc"))).toBe(true);
    expect(w.atOrigin("log", "--format=%s", "main").trim()).toBe("seed");
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
