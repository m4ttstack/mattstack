import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanupOrgWorlds, orgWorld } from "../../team/__tests__/org-world.ts";
import { rememberPackShare, sharePack } from "../../team/share-pack.ts";
import { readTeamLocal } from "../../team/team-local.ts";
import { teamPublish } from "../../../commands/team.ts";
import { chooseZone, packIsCompiled, parseRemote, readZones, readZonesFrom, type InitFs, type ZoneInfo, addMarketplacePlugin, zoneTeamConfigReads, packDescription, PIPELINE_STAGES, renderPackFiles, initPack, POLICY_REFUSALS, readOrgSlugs, type InitDeps, type RunResult } from "../init.ts";
import { UserActionableError } from "../../errors.ts";
import { refusalCopy } from "../../engine-floor.ts";
import { stripJsonc } from "../sources.ts";

/** mkdirp'd dirs and dirs that already hold a file are writable; anything else throws ENOENT, mirroring a real fs. */
function memFs(files: Record<string, string>): InitFs & { mkdirped: Set<string> } {
  const store = new Map(Object.entries(files));
  const mkdirped = new Set<string>();
  const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/"));
  const dirExists = (dir: string) => mkdirped.has(dir) || [...store.keys()].some((k) => k.startsWith(dir + "/"));
  return {
    mkdirped,
    exists: (p) => store.has(p) || [...store.keys()].some((k) => k.startsWith(p + "/")),
    readFile: (p) => store.get(p) ?? null,
    writeFile: (p, text) => {
      if (!dirExists(dirOf(p))) throw new Error(`ENOENT: no such file or directory, open '${p}'`);
      store.set(p, text);
    },
    mkdirp: (p) => { mkdirped.add(p); },
    readDir: (p) => {
      const names = new Set<string>();
      for (const k of store.keys()) {
        if (!k.startsWith(p + "/")) continue;
        names.add(k.slice(p.length + 1).split("/")[0]!);
      }
      return [...names];
    },
  };
}

describe("parseRemote", () => {
  test("ssh form, mixed-case host, .git suffix", () => {
    expect(parseRemote("git@GitLab.com:Group/Sub/repo.git")).toEqual({
      host: "gitlab.com",
      path: "Group/Sub/repo",
      slug: "gitlab.com-Group-Sub-repo",
    });
  });
  test("https form with credentials", () => {
    expect(parseRemote("https://user:tok@gitlab.com/acme/api.git")).toEqual({
      host: "gitlab.com",
      path: "acme/api",
      slug: "gitlab.com-acme-api",
    });
  });
  test("no path is not a repo ref", () => {
    expect(parseRemote("gitlab.com")).toBeNull();
  });
});

const HOME = "/h";
const ORG_ROOT = (org: string) => `${HOME}/.mattstack/orgs/${org}`;
const orgFiles = (org: string, orgSettings: Record<string, unknown>, teams: Record<string, Record<string, unknown>>, extra: Record<string, string> = {}) => ({
  [`${ORG_ROOT(org)}/.git/config`]: "",
  [`${ORG_ROOT(org)}/mattstack/mattstack.jsonc`]: `{ "role": "org", "org": "${org}", "layout": 3 }`,
  [`${ORG_ROOT(org)}/mattstack/org/settings.org.jsonc`]: `// org\n${JSON.stringify(orgSettings)}`,
  [`${ORG_ROOT(org)}/.claude-plugin/marketplace.json`]: `{ "name": "${org}-market", "owner": { "name": "x" }, "plugins": [] }`,
  ...Object.fromEntries(Object.entries(teams).map(([team, settings]) => [`${ORG_ROOT(org)}/mattstack/teams/${team}/settings.team.jsonc`, `// team\n${JSON.stringify(settings)}`])),
  ...extra,
});

describe("readZones", () => {
  test("an org folder whose name is not a valid org slug is neither an org nor a zone", () => {
    const fs = memFs({ ...orgFiles("acme", {}, { widgets: {} }), ...orgFiles("Bad_Org", {}, { widgets: {} }), ...orgFiles("..", {}, { gadgets: {} }) });
    expect(readOrgSlugs(fs, HOME)).toEqual(["acme"]);
    expect(readZones(fs, HOME).map((z) => z.slug)).toEqual(["acme/widgets"]);
  });

  test("a clone whose marker is on a layout above ORG_LAYOUT throws the update sentence", () => {
    const fs = memFs({ ...orgFiles("acme", {}, { widgets: {} }), [`${ORG_ROOT("acme")}/.git/config`]: "", [`${ORG_ROOT("acme")}/mattstack/mattstack.jsonc`]: '{ "role": "org", "org": "acme", "layout": 6 }' });
    expect(() => readZonesFrom(fs, `${HOME}/.mattstack/orgs`)).toThrow("Your org uses layout 6 and this app reads up to 5. Update the app.");
  });

  test("a one-team marker throws the waiting sentence rather than skipping the clone", () => {
    const fs = memFs({ ...orgFiles("acme", {}, { widgets: {} }), [`${ORG_ROOT("acme")}/.git/config`]: "", [`${ORG_ROOT("acme")}/mattstack/mattstack.jsonc`]: '{ "role": "team", "namespace": "widgets", "org": "acme" }' });
    expect(() => readZonesFrom(fs, `${HOME}/.mattstack/orgs`)).toThrow("Your org has not moved to its new layout yet. rt finishes the move when it does.");
  });

  test("a picked layout-2 clone with no org store throws the waiting sentence", () => {
    const { [`${ORG_ROOT("acme")}/mattstack/org/settings.org.jsonc`]: _store, ...noStore } = orgFiles("acme", {}, { widgets: {} });
    const fs = memFs(noStore);
    expect(() => readZonesFrom(fs, `${HOME}/.mattstack/orgs`)).toThrow("Your org has not moved to its new layout yet. rt finishes the move when it does.");
  });

  test("a ready clone beside a stale one-team clone still yields its zones", () => {
    const fs = memFs({
      ...orgFiles("acme", {}, { widgets: {} }),
      [`${ORG_ROOT("acme")}/.git/config`]: "",
      ...orgFiles("beta", {}, { gadgets: {} }),
      [`${ORG_ROOT("beta")}/.git/config`]: "",
      [`${ORG_ROOT("beta")}/mattstack/mattstack.jsonc`]: '{ "role": "team", "namespace": "gadgets", "org": "beta" }',
    });
    expect(readZonesFrom(fs, `${HOME}/.mattstack/orgs`).map((z) => z.slug)).toEqual(["acme/widgets"]);
  });

  test("a one-team folder that is not a clone is skipped beside a ready clone", () => {
    const fs = memFs({
      ...orgFiles("acme", {}, { widgets: {} }),
      [`${ORG_ROOT("acme")}/.git/config`]: "",
      ...orgFiles("beta", {}, { gadgets: {} }),
      [`${ORG_ROOT("beta")}/mattstack/mattstack.jsonc`]: '{ "role": "team", "namespace": "gadgets", "org": "beta" }',
    });
    expect(readZonesFrom(fs, `${HOME}/.mattstack/orgs`).map((z) => z.slug)).toEqual(["acme/widgets"]);
  });

  test("a ready clone beside a layout-2 folder that is not a clone yields only the clone's zones", () => {
    const { [`${ORG_ROOT("beta")}/.git/config`]: _notAClone, ...stale } = orgFiles("beta", {}, { gadgets: {} });
    const fs = memFs({ ...orgFiles("acme", {}, { widgets: {} }), ...stale });
    expect(readZonesFrom(fs, `${HOME}/.mattstack/orgs`).map((z) => z.slug)).toEqual(["acme/widgets"]);
  });

  test("a ready clone beside a second layout-2 clone sorting later yields only the picked clone's zones", () => {
    const fs = memFs({ ...orgFiles("acme", {}, { widgets: {} }), ...orgFiles("beta", {}, { gadgets: {} }) });
    expect(readZonesFrom(fs, `${HOME}/.mattstack/orgs`).map((z) => z.slug)).toEqual(["acme/widgets"]);
  });

  test("no clone to pick yields no zones, even beside a layout-2 folder", () => {
    const { [`${ORG_ROOT("acme")}/.git/config`]: _notAClone, ...stale } = orgFiles("acme", {}, { widgets: {} });
    expect(readZonesFrom(memFs(stale), `${HOME}/.mattstack/orgs`)).toEqual([]);
  });

  test("a folder with no marker or a marker of another role is still skipped", () => {
    const fs = memFs({ ...orgFiles("acme", {}, { widgets: {} }), [`${ORG_ROOT("acme")}/mattstack/mattstack.jsonc`]: '{ "role": "pack", "org": "acme" }' });
    expect(readZonesFrom(fs, `${HOME}/.mattstack/orgs`)).toEqual([]);
  });

  test("one zone per team folder, named <org>/<team>", () => {
    const fs = memFs(orgFiles("acme", {}, { widgets: {}, gadgets: {} }));
    const zones = readZonesFrom(fs, `${HOME}/.mattstack/orgs`);
    expect(zones.map((z) => z.slug)).toEqual(["acme/gadgets", "acme/widgets"]);
    expect(zones[1]).toEqual({
      slug: "acme/widgets", org: "acme", team: "widgets", orgDir: ORG_ROOT("acme"), dir: `${ORG_ROOT("acme")}/mattstack/teams/widgets`,
      host: null, projects: [], marketplace: "acme-market", hasPack: false, packCompiled: false,
    });
    expect(readZones(fs, HOME)).toEqual(zones);
  });

  test("in a monorepo every team inherits the org's board.projects, so every team's pack claims the shared repo", () => {
    const fs = memFs(orgFiles("acme", { "board.gitlabHost": "https://GitLab.example.com", "board.projects": ["acme/widgets"] }, { widgets: {}, gadgets: {} }));
    for (const zone of readZones(fs, HOME)) {
      expect(zone.host).toBe("gitlab.example.com");
      expect(zone.projects).toEqual(["acme/widgets"]);
    }
  });

  test("a team that sets board.projects claims only its own repos", () => {
    const fs = memFs(orgFiles("acme", { "board.gitlabHost": "gitlab.example.com", "board.projects": ["acme/widgets"] }, { widgets: {}, gadgets: { "board.projects": ["acme/gadgets"] } }));
    const byTeam = Object.fromEntries(readZones(fs, HOME).map((z) => [z.team, z.projects]));
    expect(byTeam).toEqual({ widgets: ["acme/widgets"], gadgets: ["acme/gadgets"] });
  });

  test("a team whose board.projects is not a list claims the org's list, as the resolver reads it", () => {
    const fs = memFs(orgFiles("acme", { "board.projects": ["acme/widgets"] }, { widgets: { "board.projects": "acme/gadgets" }, gadgets: { "board.projects": ["acme/gadgets"] } }));
    const byTeam = Object.fromEntries(readZones(fs, HOME).map((z) => [z.team, z.projects]));
    expect(byTeam).toEqual({ widgets: ["acme/widgets"], gadgets: ["acme/gadgets"] });
  });

  test("a team's own board.gitlabHost wins over the org's", () => {
    const fs = memFs(orgFiles("acme", { "board.gitlabHost": "gitlab.example.com", "board.projects": ["acme/widgets"] }, { widgets: { "board.gitlabHost": "https://widgets.gitlab.example.com" }, gadgets: {} }));
    const byTeam = Object.fromEntries(readZones(fs, HOME).map((z) => [z.team, z.host]));
    expect(byTeam).toEqual({ widgets: "widgets.gitlab.example.com", gadgets: "gitlab.example.com" });
  });

  test("the host falls back to the forge in mattstack.integrations, team then org", () => {
    const fs = memFs(orgFiles("acme", { "mattstack.integrations": { forge: { host: "github.com", provider: "github" } } }, { widgets: {} }));
    expect(readZones(fs, HOME)[0]!.host).toBe("github.com");
  });

  test("a team folder with a plugin/pack/skills.jsonc has a pack; a plugin.json alone does not", () => {
    const fs = memFs(orgFiles("acme", {}, { widgets: {}, gadgets: {} }, {
      [`${ORG_ROOT("acme")}/mattstack/teams/widgets/plugin/pack/skills.jsonc`]: `{}`,
      [`${ORG_ROOT("acme")}/mattstack/teams/gadgets/plugin/.claude-plugin/plugin.json`]: `{ "name": "gadgets", "version": "0.1.0" }`,
    }));
    const byTeam = Object.fromEntries(readZones(fs, HOME).map((z) => [z.team, z.hasPack]));
    expect(byTeam).toEqual({ widgets: true, gadgets: false });
  });

  test("a team folder still holding packs/<team> and nothing at plugin/ is refused with the conversion remedy", () => {
    const fs = memFs(orgFiles("acme", {}, { widgets: {} }, {
      [`${ORG_ROOT("acme")}/mattstack/teams/widgets/packs/widgets/pack/skills.jsonc`]: `{}`,
    }));
    let thrown: unknown;
    try {
      readZones(fs, HOME);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UserActionableError);
    expect((thrown as UserActionableError).code).toBe("team-pack-unconverted");
    expect((thrown as UserActionableError).next).toBe(`bun scripts/move-team-packs-to-plugin.ts ${ORG_ROOT("acme")} --admin <username> --write`);
    expect((thrown as UserActionableError).thenRun).toBe("rt setup update");
  });

  test("a team folder with neither plugin/ nor packs/<team> is a settings-only team", () => {
    const fs = memFs(orgFiles("acme", {}, { widgets: {} }));
    expect(readZones(fs, HOME).map((z) => z.hasPack)).toEqual([false]);
  });

  test("packCompiled is true only once a verb or stage has compiled", () => {
    const fs = memFs(orgFiles("acme", {}, { widgets: {}, gadgets: {} }, {
      [`${ORG_ROOT("acme")}/mattstack/teams/widgets/plugin/pack/skills.jsonc`]: `{}`,
      [`${ORG_ROOT("acme")}/mattstack/teams/gadgets/plugin/pack/skills.jsonc`]: `{}`,
      [`${ORG_ROOT("acme")}/mattstack/teams/gadgets/plugin/skills/work/SKILL.md`]: `x`,
    }));
    const byTeam = Object.fromEntries(readZones(fs, HOME).map((z) => [z.team, z.packCompiled]));
    expect(byTeam).toEqual({ widgets: false, gadgets: true });
  });

  test("a base pack at plugin/ does not occupy the team's pack slot", () => {
    const fs = memFs(orgFiles("acme", {}, { widgets: {} }, {
      [`${ORG_ROOT("acme")}/mattstack/teams/widgets/plugin/pack/skills.jsonc`]: `{ "base": true }`,
    }));
    expect(readZones(fs, HOME)[0]!.hasPack).toBe(false);
  });

  test("a folder that is not a team name, or whose settings do not parse, is no zone", () => {
    const fs = memFs(orgFiles("acme", {}, { widgets: {} }, {
      [`${ORG_ROOT("acme")}/mattstack/teams/Widgets2/settings.team.jsonc`]: `{}`,
      [`${ORG_ROOT("acme")}/mattstack/teams/broken/settings.team.jsonc`]: `{ not json`,
      [`${ORG_ROOT("acme")}/mattstack/teams/empty/notes.md`]: `x`,
    }));
    expect(readZones(fs, HOME).map((z) => z.team)).toEqual(["widgets"]);
  });

  test("a user zone is skipped", () => {
    const fs = memFs({
      [`${HOME}/.mattstack/orgs/me/mattstack/mattstack.jsonc`]: `{ "role": "user" }`,
    });
    expect(readZones(fs, HOME)).toEqual([]);
  });

  test("zoneTeamConfigReads is true only for a team folder whose settings parse", () => {
    const fs = memFs(orgFiles("acme", {}, { widgets: {} }, { [`${ORG_ROOT("acme")}/mattstack/teams/broken/settings.team.jsonc`]: `{ not json` }));
    expect(zoneTeamConfigReads(fs, `${ORG_ROOT("acme")}/mattstack/teams/widgets`)).toBe(true);
    expect(zoneTeamConfigReads(fs, `${ORG_ROOT("acme")}/mattstack/teams/broken`)).toBe(false);
    expect(zoneTeamConfigReads(fs, `${ORG_ROOT("acme")}/mattstack/teams/absent`)).toBe(false);
  });
});

describe("chooseZone", () => {
  const repo = { host: "gitlab.com", path: "acme/api", slug: "gitlab.com-acme-api" };
  const z = (team: string, host: string | null, projects: string[] = [], hasPack = false): ZoneInfo =>
    ({ slug: `acme/${team}`, org: "acme", team, orgDir: "/z", dir: `/z/mattstack/teams/${team}`, host, projects, marketplace: "acme", hasPack, packCompiled: hasPack });
  const none = { org: null, team: null, active: null };
  test("a zone already declaring the repo wins, pack or not", () => {
    const r = chooseZone([z("a", "gitlab.com"), z("b", "gitlab.com", ["acme/api"], true)], repo, none);
    expect(r).toEqual({ kind: "found", zone: z("b", "gitlab.com", ["acme/api"], true) });
  });
  test("a zone on the host that already has a pack is skipped", () => {
    const r = chooseZone([z("claim", "gitlab.com", ["acme/other"], true), z("fresh", "gitlab.com")], repo, none);
    expect(r).toEqual({ kind: "found", zone: z("fresh", "gitlab.com") });
  });
  test("only packed zones on the host means missing", () => {
    expect(chooseZone([z("claim", "gitlab.com", ["acme/other"], true)], repo, none)).toEqual({ kind: "missing" });
  });
  test("two packless host matches is ambiguous", () => {
    const r = chooseZone([z("a", "gitlab.com"), z("b", "gitlab.com")], repo, none);
    expect(r.kind).toBe("ambiguous");
  });
  test("--team picks among candidates by team name", () => {
    const r = chooseZone([z("a", "gitlab.com"), z("b", "gitlab.com")], repo, { ...none, team: "b" });
    expect(r).toEqual({ kind: "found", zone: z("b", "gitlab.com") });
  });
  test("--team naming a zone on another host is a mismatch", () => {
    const r = chooseZone([z("gh", "github.com")], repo, { ...none, team: "gh" });
    expect(r).toEqual({ kind: "mismatch", zone: z("gh", "github.com") });
  });
  test("a zone with no host yet is a candidate", () => {
    const r = chooseZone([z("fresh", null)], repo, none);
    expect(r).toEqual({ kind: "found", zone: z("fresh", null) });
  });
  test("no candidates is missing", () => {
    expect(chooseZone([z("gh", "github.com")], repo, none)).toEqual({ kind: "missing" });
  });

  describe("with team folders", () => {
    const shared = ["acme/api"];
    const zones = [z("widgets", "gitlab.com", shared), z("gadgets", "gitlab.com", shared)];

    test("the active team wins when two teams claim the shared repo", () => {
      expect(chooseZone(zones, repo, { org: null, team: null, active: "gadgets" })).toEqual({ kind: "found", zone: zones[1]! });
    });
    test("--team names the folder, whatever the active team is", () => {
      expect(chooseZone(zones, repo, { org: null, team: "widgets", active: "gadgets" })).toEqual({ kind: "found", zone: zones[0]! });
    });
    test("an unknown --team is missing", () => {
      expect(chooseZone(zones, repo, { org: null, team: "sprockets", active: "gadgets" })).toEqual({ kind: "missing" });
    });
    test("--zone filters by org before the team is picked", () => {
      expect(chooseZone(zones, repo, { org: "other", team: null, active: "gadgets" })).toEqual({ kind: "missing" });
    });
    test("with no active team and no --team, two claiming teams are ambiguous", () => {
      expect(chooseZone(zones, repo, { org: null, team: null, active: null })).toEqual({ kind: "ambiguous", zones });
    });
    test("a team on another host is a mismatch", () => {
      const other = [z("widgets", "gitlab.example.com", shared)];
      expect(chooseZone(other, repo, { org: null, team: "widgets", active: null })).toEqual({ kind: "mismatch", zone: other[0]! });
    });
    test("an active team that has no folder falls back to the repo's claim", () => {
      expect(chooseZone([z("widgets", "gitlab.com", shared)], repo, { org: null, team: null, active: "gadgets" })).toEqual({ kind: "found", zone: z("widgets", "gitlab.com", shared) });
    });
  });
});

describe("packIsCompiled", () => {
  const fs = (files: Record<string, string>) => memFs(files);
  test("a skeleton with no skills or attachments is not compiled", () => {
    expect(packIsCompiled(fs({ "/p/pack/skills.jsonc": "{}", "/p/.claude-plugin/plugin.json": "{}" }), "/p")).toBe(false);
  });
  test("a compiled public verb is compiled output", () => {
    expect(packIsCompiled(fs({ "/p/skills/work/SKILL.md": "x" }), "/p")).toBe(true);
  });
  test("a compiled stage under attachments is compiled output", () => {
    expect(packIsCompiled(fs({ "/p/attachments/stage-plan/SKILL.md": "x" }), "/p")).toBe(true);
  });
  test("a skills folder with no SKILL.md is not compiled", () => {
    expect(packIsCompiled(fs({ "/p/skills/work/notes.md": "x" }), "/p")).toBe(false);
  });
});

describe("renderPackFiles", () => {
  const files = renderPackFiles({ pack: "acme", workDescription: "Use when running a unit of work." });
  test("writes exactly the five scaffold files", () => {
    expect(Object.keys(files).sort()).toEqual([
      ".claude-plugin/plugin.json",
      "PACK.md",
      "pack/skills.jsonc",
      "pack/stubs.jsonc",
      "pack/surface.jsonc",
    ]);
  });
  test("plugin.json is the pack's plugin at 0.1.0 serving ./skills/", () => {
    expect(JSON.parse(files[".claude-plugin/plugin.json"]!)).toEqual({
      name: "acme",
      version: "0.1.0",
      description: packDescription("acme"),
      skills: "./skills/",
    });
  });
  test("roster is work only, seeded from the engine description", () => {
    expect(JSON.parse(stripJsonc(files["pack/stubs.jsonc"]!))).toEqual({
      verbs: { work: { engine: "work", description: "Use when running a unit of work." } } ,
    });
    expect(JSON.parse(stripJsonc(files["pack/surface.jsonc"]!))).toEqual({ public: ["work"] });
  });
  test("bindings fragment carries enabled skills, the eight-stage pipeline, and only the two generic bindings", () => {
    const manifest = JSON.parse(stripJsonc(files["pack/skills.jsonc"]!));
    expect(manifest.version).toBe(2);
    expect(manifest.skills).toEqual({ enabled: ["mattstack:work", "mattstack:model-tiering"] });
    expect(manifest.pipelines.feature).toEqual(PIPELINE_STAGES.map((s) => `mattstack:${s}`));
    expect(manifest.bindings).toEqual({
      "mattstack:work/sub-agent-tiering": { tiering: "mattstack:model-tiering" },
      "mattstack:stage-watch-ci/forge": { forge: "mattstack:ci-forge-gitlab" },
    });
  });
  test("seeded fragment explains pipelines", () => {
    const seeded = renderPackFiles({ pack: "acme", workDescription: "d" });
    const fragment = seeded["pack/skills.jsonc"]!;
    const stubs = seeded["pack/stubs.jsonc"]!;
    expect(fragment).toContain("add a specialized pipeline with mattstack:extending-a-pack");
    expect(stubs).toContain('"pipeline"');
    expect(stubs).toContain("work-<kind>");
    expect(JSON.parse(stripJsonc(stubs))).toEqual({ verbs: { work: { engine: "work", description: "d" } } });
    const manifest = JSON.parse(stripJsonc(fragment));
    expect(Object.keys(manifest.pipelines)).toEqual(["feature"]);
    expect(manifest.pipelines.feature).toEqual(PIPELINE_STAGES.map((s) => `mattstack:${s}`));
  });
  test("PACK.md names the two authoring skills, calls the description a placeholder, no dashes", () => {
    expect(files["PACK.md"]).toContain("mattstack:extending-a-pack");
    expect(files["PACK.md"]).toContain("mattstack:creating-a-pack");
    expect(files["PACK.md"]).toContain("placeholder");
    for (const text of Object.values(files)) expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("addMarketplacePlugin", () => {
  const SRC = "./mattstack/teams/acme/plugin";
  const before = `{\n  "name": "acme",\n  "owner": { "name": "x" },\n  "plugins": []\n}\n`;
  test("appends the pack entry", () => {
    const out = addMarketplacePlugin(before, "acme", "desc", SRC);
    expect(JSON.parse(out).plugins).toEqual([{ name: "acme", source: SRC, description: "desc" }]);
  });
  test("is a no-op when the pack is already listed", () => {
    const once = addMarketplacePlugin(before, "acme", "desc", SRC);
    expect(addMarketplacePlugin(once, "acme", "desc", SRC)).toBe(once);
  });
  test("keeps an existing plugin entry when adding a new one", () => {
    const withOther = `{\n  "name": "acme",\n  "owner": { "name": "x" },\n  "plugins": [{ "name": "other", "source": "./mattstack/packs/other" }]\n}\n`;
    const plugins = JSON.parse(addMarketplacePlugin(withOther, "acme", "desc", SRC)).plugins;
    expect(plugins).toContainEqual({ name: "other", source: "./mattstack/packs/other" });
    expect(plugins).toContainEqual({ name: "acme", source: SRC, description: "desc" });
  });
});

type Calls = { claude: string[][]; registered: string[]; materialized: string[]; compiled: string[]; checked: string[]; claims: [string, string[]][]; shared: [string, string[]][]; remembered: [string, string[]][] };

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "" });
const REPO = "/work/api";
const TEAM_DIR = (team: string) => `${ORG_ROOT("acme")}/mattstack/teams/${team}`;
const ACME_PACK = `${TEAM_DIR("acme")}/plugin`;
const GITLAB = { "board.gitlabHost": "gitlab.com" };

function world(overrides: Partial<InitDeps> & { files?: Record<string, string>; marketplaces?: string[]; noOrg?: boolean } = {}) {
  const calls: Calls = { claude: [], registered: [], materialized: [], compiled: [], checked: [], claims: [], shared: [], remembered: [] };
  const files: Record<string, string> = {
    ...(overrides.noOrg ? {} : orgFiles("acme", GITLAB, { acme: {} })),
    ...(overrides.files ?? {}),
  };
  const fs = memFs(files);
  const marketplaces = overrides.marketplaces ?? [];
  const deps: InitDeps = {
    fs,
    home: HOME,
    gitRemote: async () => ({ kind: "ok", url: "git@gitlab.com:acme/api.git" }),
    isTTY: false,
    promptZone: async () => { throw new Error("must not prompt"); },
    createZone: async () => { throw new Error("must not create"); },
    activeTeam: () => "acme",
    currentOrg: () => readOrgSlugs(fs, HOME)[0] ?? null,
    mayWrite: () => null,
    declareClaim: (zone, projects) => { calls.claims.push([zone.slug, projects]); },
    engineDescription: (e) => (e === "work" ? "Use when running a unit of work." : null),
    claude: async (args) => {
      calls.claude.push(args);
      if (args[1] === "marketplace" && args[2] === "list") return ok(JSON.stringify(marketplaces.map((name) => ({ name }))));
      if (args[1] === "marketplace" && args[2] === "add") return ok("Marketplace already on disk");
      return ok("");
    },
    registerRepo: async (dir) => { calls.registered.push(dir); return "gitlab.com/acme/api"; },
    materialize: async (name) => {
      calls.materialized.push(name);
      fs.mkdirp(`${HOME}/.mattstack/repos/gitlab.com-acme-api/packs/acme`);
      fs.writeFile(`${HOME}/.mattstack/repos/gitlab.com-acme-api/packs/acme/skills.jsonc`, "// mattstack:work tiering <- acme@acme\n{}");
      return { ok: true, detail: "merged" };
    },
    compile: async (dir) => { calls.compiled.push(dir); return { ok: true, errors: [] }; },
    check: async (dir) => { calls.checked.push(dir); return { drift: false }; },
    sharePack: async (zone, paths) => { calls.shared.push([zone.slug, paths]); return { pushed: true, remote: "https://gitlab.example.com/acme/org.git" }; },
    rememberShare: (zone, paths) => { calls.remembered.push([zone.slug, paths]); },
    ...overrides,
  };
  return { deps, calls, fs };
}

const BASE_DIR = `${ORG_ROOT("acme")}/mattstack/org/packs/acme-base`;
const BASE_FILES = { [`${BASE_DIR}/pack/skills.jsonc`]: '{ "base": true }' };
const MISSING = [
  { kind: "param" as const, name: "repo-name", file: "pack/params.jsonc", askedBy: ["acme-base:watch-ci-rules"] },
  { kind: "section" as const, name: "ci-extra-jobs", file: "pack/sections/ci-extra-jobs.md", askedBy: ["acme-base:watch-ci-rules"] },
];
const stopOnMissing = async () => ({ ok: false, errors: ["missing"], missing: MISSING });

describe("initPack --extends", () => {
  test("init --extends writes extends", async () => {
    const { deps, fs } = world({ files: BASE_FILES });
    const out = await initPack({ repoDir: REPO, zone: null, team: null, extendsBase: "acme-base" }, deps);
    expect(out.ok).toBe(true);
    expect(JSON.parse(stripJsonc(fs.readFile(`${ACME_PACK}/pack/skills.jsonc`)!)).extends).toBe("acme-base");
  });

  test("init --extends leaves the base's forge binding to the base", async () => {
    const { deps, fs } = world({ files: { [`${BASE_DIR}/pack/skills.jsonc`]: '{ "base": true, "bindings": { "mattstack:stage-watch-ci": { "forge": "acme-base:ci-forge" } } }' } });
    expect((await initPack({ repoDir: REPO, zone: null, team: null, extendsBase: "acme-base" }, deps)).ok).toBe(true);
    const fragment = JSON.parse(stripJsonc(fs.readFile(`${ACME_PACK}/pack/skills.jsonc`)!));
    expect(fragment.bindings["mattstack:stage-watch-ci"]).toBeUndefined();
    expect(fragment.pipelines.feature).toEqual(PIPELINE_STAGES.map((s) => `mattstack:${s}`));
  });

  test("init --extends refuses an unknown base", async () => {
    for (const files of [{}, { [`${BASE_DIR}/pack/skills.jsonc`]: '{ "version": 1 }' }]) {
      const { deps, calls, fs } = world({ files });
      const out = await initPack({ repoDir: REPO, zone: null, team: null, extendsBase: "acme-base" }, deps);
      expect(out).toMatchObject({ ok: false, refused: true, code: "base-missing" });
      if (out.ok || !out.refused) throw new Error("expected a refusal");
      expect(out.detail).toBe("There is no base pack called acme-base in the acme org");
      expect(calls.claims).toEqual([]);
      expect(fs.exists(`${ACME_PACK}/pack/stubs.jsonc`)).toBe(false);
    }
  });

  test("init --extends refuses a base name that is not a name", async () => {
    const { deps } = world({ files: BASE_FILES });
    const out = await initPack({ repoDir: REPO, zone: null, team: null, extendsBase: "../acme-base" }, deps);
    expect(out).toMatchObject({
      ok: false,
      refused: true,
      code: "base-missing",
      detail: "There is no base pack called ../acme-base in the acme org. Bases here: acme-base",
      next: "rt skills init --team acme --extends <base>",
    });
  });

  test("init seeds missing values and stops with params-missing", async () => {
    const { deps, calls, fs } = world({ files: BASE_FILES, compile: stopOnMissing });
    const out = await initPack({ repoDir: REPO, zone: null, team: null, extendsBase: "acme-base" }, deps);
    expect(out).toMatchObject({
      ok: false,
      refused: true,
      code: "params-missing",
      wrote: [`${ACME_PACK}/pack/params.jsonc`, `${ACME_PACK}/pack/sections/ci-extra-jobs.md`],
      next: "rt skills init --team acme --extends acme-base",
    });
    if (out.ok || !out.refused) throw new Error("expected a refusal");
    expect(out.detail).toBe(
      "The base pack asks for values only your team can give: repo-name in pack/params.jsonc (asked by acme-base:watch-ci-rules); the ci-extra-jobs section in pack/sections/ci-extra-jobs.md (asked by acme-base:watch-ci-rules)",
    );
    expect(JSON.parse(stripJsonc(fs.readFile(`${ACME_PACK}/pack/params.jsonc`)!))).toEqual({ version: 1, params: { "repo-name": "" } });
    expect(fs.readFile(`${ACME_PACK}/pack/sections/ci-extra-jobs.md`)).toBe("");
    expect(calls.checked).toEqual([]);
    expect(calls.claude).toEqual([]);
    expect(calls.shared).toEqual([]);
  });

  test("seeding keeps existing values and files, and adds each missing key as empty", async () => {
    const params = '// ours\n{ "version": 1, "params": { "other": "kept" } }\n';
    const { deps, fs } = world({
      files: { ...BASE_FILES, [`${ACME_PACK}/pack/params.jsonc`]: params, [`${ACME_PACK}/pack/sections/ci-extra-jobs.md`]: "Run the lint job.\n" },
      compile: stopOnMissing,
    });
    const out = await initPack({ repoDir: REPO, zone: null, team: null, extendsBase: "acme-base" }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "params-missing", wrote: [`${ACME_PACK}/pack/params.jsonc`] });
    const text = fs.readFile(`${ACME_PACK}/pack/params.jsonc`)!;
    expect(text).toContain("// ours");
    expect(JSON.parse(stripJsonc(text)).params).toEqual({ other: "kept", "repo-name": "" });
    expect(fs.readFile(`${ACME_PACK}/pack/sections/ci-extra-jobs.md`)).toBe("Run the lint job.\n");
  });

  test("a second stop with nothing new to seed writes nothing", async () => {
    const { deps } = world({ files: BASE_FILES, compile: stopOnMissing });
    await initPack({ repoDir: REPO, zone: null, team: null, extendsBase: "acme-base" }, deps);
    const again = await initPack({ repoDir: REPO, zone: null, team: null, extendsBase: "acme-base" }, deps);
    expect(again).toMatchObject({ ok: false, refused: true, code: "params-missing", wrote: [] });
    if (again.ok || !again.refused) throw new Error("expected a refusal");
    expect(again.detail).toContain("repo-name in pack/params.jsonc");
    expect(again.detail).toContain("the ci-extra-jobs section in pack/sections/ci-extra-jobs.md");
  });

  test("a missing key named like an Object.prototype property is still seeded", async () => {
    const missing = [{ kind: "param" as const, name: "constructor", file: "pack/params.jsonc", askedBy: ["acme-base:x"] }];
    const { deps, fs } = world({ files: BASE_FILES, compile: async () => ({ ok: false, errors: ["missing"], missing }) });
    const out = await initPack({ repoDir: REPO, zone: null, team: null, extendsBase: "acme-base" }, deps);
    expect(out).toMatchObject({ code: "params-missing", wrote: [`${ACME_PACK}/pack/params.jsonc`] });
    expect(JSON.parse(stripJsonc(fs.readFile(`${ACME_PACK}/pack/params.jsonc`)!)).params).toEqual({ constructor: "" });
  });

  test("init resumes after values are filled", async () => {
    let filled = false;
    const { deps, calls, fs } = world({ files: BASE_FILES, compile: async () => (filled ? { ok: true, errors: [] } : stopOnMissing()) });
    const first = await initPack({ repoDir: REPO, zone: null, team: null, extendsBase: "acme-base" }, deps);
    expect(first).toMatchObject({ refused: true, code: "params-missing" });
    fs.writeFile(`${ACME_PACK}/pack/params.jsonc`, '{ "version": 1, "params": { "repo-name": "widgets" } }');
    fs.writeFile(`${ACME_PACK}/pack/sections/ci-extra-jobs.md`, "Run the lint job.\n");
    filled = true;
    const second = await initPack({ repoDir: REPO, zone: null, team: null, extendsBase: "acme-base" }, deps);
    expect(second.ok).toBe(true);
    expect(fs.readFile(`${ACME_PACK}/pack/params.jsonc`)).toContain("widgets");
    expect(calls.checked).toEqual([ACME_PACK]);
    expect(calls.claude).toContainEqual(["plugin", "install", "acme@acme-market"]);
  });

  test("a written pack whose extends differs from --extends is refused before anything is written", async () => {
    const OTHER_BASE = { [`${ORG_ROOT("acme")}/mattstack/org/packs/gadgets-base/pack/skills.jsonc`]: '{ "base": true }' };
    const cases = [
      { onDisk: renderPackFiles({ pack: "acme", workDescription: "d" })["pack/skills.jsonc"]!, detail: "This team's pack is already written without a base, but this run asked for acme-base", next: "rt skills init --team acme" },
      { onDisk: renderPackFiles({ pack: "acme", workDescription: "d", extendsBase: "gadgets-base" })["pack/skills.jsonc"]!, detail: "This team's pack is already written extending gadgets-base, but this run asked for acme-base", next: "rt skills init --team acme --extends gadgets-base" },
    ];
    for (const { onDisk, detail, next } of cases) {
      const { deps, calls, fs } = world({ files: { ...BASE_FILES, ...OTHER_BASE, [`${ACME_PACK}/pack/skills.jsonc`]: onDisk } });
      const out = await initPack({ repoDir: REPO, zone: null, team: null, extendsBase: "acme-base" }, deps);
      expect(out).toMatchObject({ ok: false, refused: true, code: "extends-conflict", detail, next });
      if (out.ok || !out.refused) throw new Error("expected a refusal");
      expect(POLICY_REFUSALS.has(out.code)).toBe(true);
      expect(fs.readFile(`${ACME_PACK}/pack/skills.jsonc`)).toBe(onDisk);
      expect(fs.exists(`${ACME_PACK}/pack/stubs.jsonc`)).toBe(false);
      expect(calls.claims).toEqual([]);
      expect(calls.remembered).toEqual([]);
      expect(calls.materialized).toEqual([]);
    }
  });

  test("a written pack that extends the base resumes with the same --extends or with none", async () => {
    for (const extendsBase of ["acme-base", null]) {
      const { deps, calls } = world({ files: { ...BASE_FILES, [`${ACME_PACK}/pack/skills.jsonc`]: renderPackFiles({ pack: "acme", workDescription: "d", extendsBase: "acme-base" })["pack/skills.jsonc"]! } });
      const out = await initPack({ repoDir: REPO, zone: null, team: null, extendsBase }, deps);
      expect(out.ok).toBe(true);
      expect(calls.compiled).toEqual([ACME_PACK]);
    }
  });

  test("init --extends refuses a base that itself extends another, before anything is written", async () => {
    const { deps, calls, fs } = world({
      files: {
        [`${BASE_DIR}/pack/skills.jsonc`]: '{ "base": true, "extends": "gadgets-base" }',
        [`${ORG_ROOT("acme")}/mattstack/org/packs/gadgets-base/pack/skills.jsonc`]: '{ "base": true }',
      },
    });
    const out = await initPack({ repoDir: REPO, zone: null, team: null, extendsBase: "acme-base" }, deps);
    expect(out).toMatchObject({
      ok: false,
      refused: true,
      code: "base-chained",
      detail: "The acme-base pack in the acme org extends gadgets-base, and a base pack cannot extend another. Bases here: gadgets-base",
      next: "rt skills init --team acme --extends <base>",
      why: "An org admin has to fix acme-base so it extends nothing",
    });
    expect(fs.exists(`${ACME_PACK}/pack/skills.jsonc`)).toBe(false);
    expect(calls.claims).toEqual([]);
    expect(calls.remembered).toEqual([]);
  });

  test("init --extends on the only base, which extends a missing one, names no command to retry", async () => {
    const { deps } = world({ files: { [`${BASE_DIR}/pack/skills.jsonc`]: '{ "base": true, "extends": "gadgets-base" }' } });
    const out = await initPack({ repoDir: REPO, zone: null, team: null, extendsBase: "acme-base" }, deps);
    expect(out).toMatchObject({ code: "base-chained", detail: "The acme-base pack in the acme org extends gadgets-base, and a base pack cannot extend another" });
    expect(out).not.toHaveProperty("next");
  });

  test("a run given --repo keeps that repo in every retry command, quoted for the shell", async () => {
    const repoFlag = "/work/my api";
    const quoted = "--repo '/work/my api'";
    const stop = world({ files: BASE_FILES, compile: stopOnMissing });
    expect(await initPack({ repoDir: repoFlag, repoFlag, zone: null, team: null, extendsBase: "acme-base" }, stop.deps)).toMatchObject({ code: "params-missing", next: `rt skills init ${quoted} --team acme --extends acme-base` });
    const missing = world({ files: BASE_FILES });
    expect(await initPack({ repoDir: repoFlag, repoFlag, zone: null, team: null, extendsBase: "gadgets-base" }, missing.deps)).toMatchObject({ code: "base-missing", next: `rt skills init ${quoted} --team acme --extends <base>` });
    const chained = world({ files: { [`${BASE_DIR}/pack/skills.jsonc`]: '{ "base": true, "extends": "gadgets-base" }', [`${ORG_ROOT("acme")}/mattstack/org/packs/gadgets-base/pack/skills.jsonc`]: '{ "base": true }' } });
    expect(await initPack({ repoDir: repoFlag, repoFlag, zone: null, team: null, extendsBase: "acme-base" }, chained.deps)).toMatchObject({ code: "base-chained", next: `rt skills init ${quoted} --team acme --extends <base>` });
    const conflict = world({ files: { ...BASE_FILES, [`${ACME_PACK}/pack/skills.jsonc`]: renderPackFiles({ pack: "acme", workDescription: "d" })["pack/skills.jsonc"]! } });
    expect(await initPack({ repoDir: repoFlag, repoFlag, zone: null, team: null, extendsBase: "acme-base" }, conflict.deps)).toMatchObject({ code: "extends-conflict", next: `rt skills init ${quoted} --team acme` });
  });

  test("a Mac with no org refuses --extends before it prompts for or creates one", async () => {
    const { deps, calls, fs } = world({ noOrg: true, isTTY: true });
    const out = await initPack({ repoDir: REPO, zone: null, team: null, extendsBase: "acme-base" }, deps);
    expect(out).toMatchObject({
      ok: false,
      refused: true,
      code: "base-missing",
      detail: "This Mac has no org yet, so there is no base pack called acme-base",
      why: "A base pack lives in the org that made it, so join that org first",
      next: "rt team join",
    });
    expect(fs.readDir(HOME)).toEqual([]);
    expect(calls.claims).toEqual([]);
    expect(calls.remembered).toEqual([]);
  });

  test("a plain --repo path is not quoted", async () => {
    const { deps } = world({ compile: stopOnMissing });
    expect(await initPack({ repoDir: "/work/api", repoFlag: "/work/api", zone: null, team: null }, deps)).toMatchObject({ code: "params-missing", next: "rt skills init --repo /work/api --team acme" });
  });

  test("a stop with no --extends names no base in its next", async () => {
    const { deps } = world({ compile: stopOnMissing });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ code: "params-missing", next: "rt skills init --team acme" });
  });
});

describe("renderPackFiles extends", () => {
  test("extendsBase adds extends to the fragment and nothing else changes", () => {
    const plain = renderPackFiles({ pack: "acme", workDescription: "d" });
    const based = renderPackFiles({ pack: "acme", workDescription: "d", extendsBase: "acme-base" });
    expect(JSON.parse(stripJsonc(based["pack/skills.jsonc"]!)).extends).toBe("acme-base");
    expect(JSON.parse(stripJsonc(plain["pack/skills.jsonc"]!)).extends).toBeUndefined();
    expect({ ...based, "pack/skills.jsonc": "" }).toEqual({ ...plain, "pack/skills.jsonc": "" });
  });

  test("the seed leaves out each pipeline and binding the base sets, so the base's own wins at materialize", () => {
    const base = {
      base: true,
      pipelines: { feature: ["mattstack:stage-plan", "acme-base:stage-audit"] },
      bindings: { "mattstack:stage-watch-ci/forge": { forge: "acme-base:ci-forge" } },
    };
    const fragment = JSON.parse(stripJsonc(renderPackFiles({ pack: "acme", workDescription: "d", extendsBase: "acme-base", baseFragment: base })["pack/skills.jsonc"]!));
    expect(fragment.extends).toBe("acme-base");
    expect(fragment.pipelines).toBeUndefined();
    expect(fragment.bindings).toEqual({ "mattstack:work/sub-agent-tiering": { tiering: "mattstack:model-tiering" } });
  });

  test("a base that sets no feature stages leaves the seed's own", () => {
    const base = { base: true, pipelines: { feature: { bindings: { "mattstack:stage-ship": { policy: "acme-base:squash" } } } } };
    const fragment = JSON.parse(stripJsonc(renderPackFiles({ pack: "acme", workDescription: "d", extendsBase: "acme-base", baseFragment: base })["pack/skills.jsonc"]!));
    expect(fragment.pipelines.feature).toEqual(PIPELINE_STAGES.map((s) => `mattstack:${s}`));
    expect(fragment.bindings["mattstack:stage-watch-ci/forge"]).toEqual({ forge: "mattstack:ci-forge-gitlab" });
  });
});

describe("initPack", () => {
  test("an owner missing a marketplace entry is refused before files or claims", async () => {
    const { deps, calls, fs } = world({ mayWrite: (_zone, relPath) => relPath === ".claude-plugin/marketplace.json" ? { message: "The org's shared files belong to its admins", why: "Ask dev1 (an org admin) to make this change." } : null });
    expect(await initPack({ repoDir: REPO, zone: null, team: null }, deps)).toMatchObject({ ok: false, refused: true, code: "not-yours", detail: "The org's shared files belong to its admins. Ask dev1 (an org admin) to make this change." });
    expect(calls.claims).toEqual([]);
    expect(fs.exists(`${ACME_PACK}/pack/stubs.jsonc`)).toBe(false);
  });

  test("a member is refused before any pack files or claims", async () => {
    const { deps, calls, fs } = world({ mayWrite: () => ({ message: "The acme team's files belong to its owners", why: "Ask dev2 to make this change." }) });
    expect(await initPack({ repoDir: REPO, zone: null, team: null }, deps)).toMatchObject({ refused: true, code: "not-yours" });
    expect(calls.claims).toEqual([]);
    expect(fs.mkdirped.size).toBe(0);
    expect(calls.shared).toEqual([]);
  });

  test("an existing marketplace entry needs only the team's own folder", async () => {
    const asked: string[] = [];
    const { deps } = world({ files: { [`${ORG_ROOT("acme")}/.claude-plugin/marketplace.json`]: '{ "name": "acme-market", "plugins": [{ "name": "acme", "source": "./mattstack/teams/acme/plugin" }] }' }, mayWrite: (_zone, relPath) => { asked.push(relPath); return null; } });
    expect((await initPack({ repoDir: REPO, zone: null, team: null }, deps)).ok).toBe(true);
    expect(asked).toEqual(["mattstack/teams/acme"]);
  });

  test("happy path writes the pack named after the team, claims the repo, installs, and reports", async () => {
    const { deps, calls, fs } = world();
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.pack).toEqual({ name: "acme", dir: ACME_PACK, zone: "acme/acme", marketplace: "acme-market" });
    expect(fs.exists(`${ACME_PACK}/pack/stubs.jsonc`)).toBe(true);
    expect(calls.claims).toEqual([["acme/acme", ["acme/api"]]]);
    expect(JSON.parse(fs.readFile(`${ORG_ROOT("acme")}/.claude-plugin/marketplace.json`)!).plugins[0]).toMatchObject({ name: "acme", source: "./mattstack/teams/acme/plugin" });
    expect(calls.registered).toEqual([REPO]);
    expect(calls.materialized).toEqual(["gitlab.com/acme/api"]);
    expect(calls.compiled).toEqual([ACME_PACK]);
    expect(calls.checked).toEqual([ACME_PACK]);
    expect(calls.claude).toContainEqual(["plugin", "marketplace", "add", ORG_ROOT("acme")]);
    expect(calls.claude).toContainEqual(["plugin", "install", "acme@acme-market"]);
    expect(out.repo).toEqual({ slug: "gitlab.com-acme-api", manifest: `${HOME}/.mattstack/repos/gitlab.com-acme-api/packs/acme/skills.jsonc` });
    expect(out.tryNext).toBe("/acme:work <ticket>");
    expect(out.restartNeeded).toBe(true);
    expect(calls.shared).toEqual([["acme/acme", ["mattstack/teams/acme/plugin", "mattstack/teams/acme/settings.team.jsonc", ".claude-plugin/marketplace.json"]]]);
    expect(out.published).toEqual({ pushed: true, remote: "https://gitlab.example.com/acme/org.git" });
  });

  test("a marketplace entry of the pack's name that points elsewhere is refused before anything is written", async () => {
    const market = '{ "name": "acme-market", "plugins": [{ "name": "acme", "source": "./elsewhere/acme" }] }';
    const { deps, calls, fs } = world({ files: { [`${ORG_ROOT("acme")}/.claude-plugin/marketplace.json`]: market } });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "team-marketplace-conflict", detail: "Your org's marketplace points acme at another pack", why: "Ask an org admin to correct its source, then try again." });
    expect(fs.readFile(`${ORG_ROOT("acme")}/.claude-plugin/marketplace.json`)).toBe(market);
    expect(fs.exists(`${ACME_PACK}/pack/skills.jsonc`)).toBe(false);
    expect(calls.registered).toEqual([]);
    expect(calls.claims).toEqual([]);
  });

  test("an owner whose marketplace entry is already there shares only the team's own files", async () => {
    const { deps, calls } = world({ files: { [`${ORG_ROOT("acme")}/.claude-plugin/marketplace.json`]: '{ "name": "acme-market", "plugins": [{ "name": "acme", "source": "./mattstack/teams/acme/plugin" }] }' } });
    expect((await initPack({ repoDir: REPO, zone: null, team: null }, deps)).ok).toBe(true);
    expect(calls.shared).toEqual([["acme/acme", ["mattstack/teams/acme/plugin", "mattstack/teams/acme/settings.team.jsonc"]]]);
  });

  test("a pack that could not be shared is still created, and says what to run", async () => {
    const { deps, fs } = world({ sharePack: async () => ({ pushed: false, reason: "rt could not push the team repo", next: "rt team publish" }) });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: true, published: { pushed: false, reason: "rt could not push the team repo", next: "rt team publish" } });
    expect(fs.exists(`${ACME_PACK}/pack/stubs.jsonc`)).toBe(true);
  });

  test("a pack that did not compile is never shared", async () => {
    const { deps, calls } = world({ compile: async () => ({ ok: false, errors: ["boom"] }) });
    expect((await initPack({ repoDir: REPO, zone: null, team: null }, deps)).ok).toBe(false);
    expect(calls.shared).toEqual([]);
  });

  test("a new claim is the team's resolved list plus the new repo, never the new repo alone", async () => {
    const { deps, calls } = world({ files: orgFiles("acme", { ...GITLAB, "board.projects": ["acme/widgets"] }, { acme: {} }) });
    const out = await initPack({ repoDir: REPO, zone: null, team: "acme" }, deps);
    expect(out.ok).toBe(true);
    expect(calls.claims).toEqual([["acme/acme", ["acme/widgets", "acme/api"]]]);
  });

  test("a repo the team already claims writes no claim", async () => {
    const { deps, calls } = world({ files: orgFiles("acme", { ...GITLAB, "board.projects": ["acme/api"] }, { acme: {} }) });
    await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(calls.claims).toEqual([]);
  });

  test("marketplace.json absent from disk: init mkdirps .claude-plugin before writing it", async () => {
    const files: Record<string, string> = orgFiles("acme", GITLAB, { acme: {} });
    delete files[`${ORG_ROOT("acme")}/.claude-plugin/marketplace.json`];
    const fs = memFs(files);
    const deps: InitDeps = {
      fs,
      home: HOME,
      gitRemote: async () => ({ kind: "ok", url: "git@gitlab.com:acme/api.git" }),
      isTTY: false,
      promptZone: async () => { throw new Error("must not prompt"); },
      createZone: async () => { throw new Error("must not create"); },
      activeTeam: () => "acme",
      currentOrg: () => "acme",
    mayWrite: () => null,
      declareClaim: () => {},
      engineDescription: (e) => (e === "work" ? "Use when running a unit of work." : null),
      claude: async (args) => (args[1] === "marketplace" && args[2] === "list" ? ok("[]") : ok("")),
      registerRepo: async () => "gitlab.com/acme/api",
      materialize: async () => {
        fs.mkdirp(`${HOME}/.mattstack/repos/gitlab.com-acme-api/packs/acme`);
        fs.writeFile(`${HOME}/.mattstack/repos/gitlab.com-acme-api/packs/acme/skills.jsonc`, "{}");
        return { ok: true, detail: "merged" };
      },
      compile: async () => ({ ok: true, errors: [] }),
      check: async () => ({ drift: false }),
      sharePack: async () => ({ pushed: true, remote: "https://gitlab.example.com/acme/org.git" }),
      rememberShare: () => {},
    };
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out.ok).toBe(true);
    const written = fs.readFile(`${ORG_ROOT("acme")}/.claude-plugin/marketplace.json`);
    expect(written).not.toBeNull();
    expect(JSON.parse(written!).plugins).toContainEqual({ name: "acme", source: "./mattstack/teams/acme/plugin", description: packDescription("acme") });
  });

  test("a marketplace already listed is not re-added", async () => {
    const { deps, calls } = world({ marketplaces: ["acme-market"] });
    await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(calls.claude.some((a) => a[2] === "add")).toBe(false);
  });

  test("a marketplace add that exits non-zero with already wording still installs", async () => {
    const { deps, calls } = world({
      claude: async (args) => {
        calls.claude.push(args);
        if (args[2] === "list") return ok("[]");
        if (args[2] === "add") return { code: 1, stdout: "", stderr: "Marketplace acme-market already added" };
        return ok("");
      },
    });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out.ok).toBe(true);
    expect(calls.claude).toContainEqual(["plugin", "install", "acme@acme-market"]);
  });

  test("install failing with stderr empty still surfaces the CLI's stdout detail", async () => {
    const { deps } = world({
      claude: async (args) => {
        if (args[2] === "list") return ok("[]");
        if (args[2] === "add") return ok("");
        if (args[0] === "plugin" && args[1] === "install") return { code: 1, stdout: "no such plugin", stderr: "" };
        return ok("");
      },
    });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: false, code: "install-failed" });
    if (out.ok || out.refused) return;
    expect(out.detail).toContain("no such plugin");
  });

  test("a compiled pack whose floor is above this rt's engine is not installed", async () => {
    const { deps, calls, fs } = world();
    deps.engine = () => "0.30.28";
    deps.compile = async (dir) => {
      calls.compiled.push(dir);
      fs.mkdirp(`${dir}/pack`);
      fs.writeFile(`${dir}/pack/requires.json`, JSON.stringify({ minEngine: "0.31.0" }));
      return { ok: true, errors: [] };
    };
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "needs-newer-app" });
    if (out.ok || !out.refused) return;
    expect(POLICY_REFUSALS.has(out.code)).toBe(true);
    expect(out.detail).toBe(refusalCopy("0.30.28", "the acme pack", "0.31.0"));
    expect(out.why).toBe("The pack is written, but rt will not install or share it until the app updates.");
    expect(out.next).toBeUndefined();
    expect(calls.claude.some((a) => a[1] === "install")).toBe(false);
    expect(calls.claude.some((a) => a[1] === "marketplace" && a[2] === "add")).toBe(false);
  });

  test("an engine whose floor is above this rt refuses before writing, and a later init with a fitting app goes through", async () => {
    const { deps, calls, fs } = world();
    deps.engine = () => "0.30.28";
    deps.engineFloor = () => "0.31.0";
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "needs-newer-app", detail: refusalCopy("0.30.28", "the acme pack", "0.31.0") });
    expect(fs.exists(`${HOME}/.mattstack/orgs/acme/mattstack/teams/acme/plugin`)).toBe(false);
    expect(calls.claims).toEqual([]);
    expect(calls.compiled).toEqual([]);
    expect(calls.remembered).toEqual([]);

    deps.engine = () => "0.31.0";
    const retry = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(retry.ok).toBe(true);
    expect(calls.claude).toContainEqual(["plugin", "install", "acme@acme-market"]);
  });

  test("a pack whose floor fits is installed", async () => {
    const { deps, calls, fs } = world();
    deps.engine = () => "0.31.0";
    deps.compile = async (dir) => {
      fs.mkdirp(`${dir}/pack`);
      fs.writeFile(`${dir}/pack/requires.json`, JSON.stringify({ minEngine: "0.31.0" }));
      return { ok: true, errors: [] };
    };
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out.ok).toBe(true);
    expect(calls.claude).toContainEqual(["plugin", "install", "acme@acme-market"]);
  });

  test("a pack skeleton that never compiled is carried on: claim, materialize, compile, install", async () => {
    const pack = `${HOME}/.mattstack/orgs/acme/mattstack/teams/acme/plugin`;
    const { deps, calls, fs } = world({
      files: orgFiles("acme", { "board.gitlabHost": "gitlab.com" }, { acme: {} }, {
        [`${pack}/.claude-plugin/plugin.json`]: `{ "name": "acme", "version": "0.1.0" }`,
        [`${pack}/pack/skills.jsonc`]: `{}`,
        [`${pack}/pack/stubs.jsonc`]: `{ "verbs": { "work": { "engine": "work", "description": "kept" } } }`,
        [`${HOME}/.mattstack/orgs/acme/.claude-plugin/marketplace.json`]: `{ "name": "acme-market", "plugins": [{ "name": "acme", "source": "./mattstack/teams/acme/plugin" }] }`,
      }),
    });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out.ok).toBe(true);
    expect(fs.readFile(`${pack}/pack/stubs.jsonc`)).toContain('"kept"');
    expect(calls.claims).toEqual([["acme/acme", ["acme/api"]]]);
    expect(calls.compiled).toEqual([pack]);
    expect(calls.claude).toContainEqual(["plugin", "install", "acme@acme-market"]);
  });

  test("a pack with compiled output is never changed", async () => {
    const pack = `${HOME}/.mattstack/orgs/acme/mattstack/teams/acme/plugin`;
    const { deps, calls } = world({
      files: orgFiles("acme", { "board.gitlabHost": "gitlab.com" }, { acme: {} }, {
        [`${pack}/pack/skills.jsonc`]: `{}`,
        [`${pack}/skills/work/SKILL.md`]: `compiled`,
      }),
    });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "pack-exists" });
    expect(calls.claims).toEqual([]);
  });

  test("with no --team the pack goes to the active team's folder", async () => {
    const { deps } = world({
      files: orgFiles("acme", { "board.gitlabHost": "gitlab.com", "board.projects": ["acme/api"] }, { widgets: {}, gadgets: {} }),
      activeTeam: () => "gadgets",
    });
    deps.materialize = async () => {
      deps.fs.mkdirp(`${HOME}/.mattstack/repos/gitlab.com-acme-api/packs/gadgets`);
      deps.fs.writeFile(`${HOME}/.mattstack/repos/gitlab.com-acme-api/packs/gadgets/skills.jsonc`, "{}");
      return { ok: true, detail: "merged" };
    };
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.pack).toMatchObject({ name: "gadgets", zone: "acme/gadgets" });
  });

  const PACKED = { [`${TEAM_DIR("acme")}/plugin/.claude-plugin/plugin.json`]: `{ "name": "acme", "version": "0.3.0" }`, [`${TEAM_DIR("acme")}/plugin/pack/skills.jsonc`]: `{}`, [`${TEAM_DIR("acme")}/plugin/skills/work/SKILL.md`]: "compiled" };

  test("refuses before writing: pack-exists when the claiming team already has a compiled pack", async () => {
    const { deps, fs } = world({ files: orgFiles("acme", { ...GITLAB, "board.projects": ["acme/api"] }, { acme: {} }, PACKED) });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "pack-exists" });
    if (out.ok || !out.refused) return;
    expect(out.detail).toBe("This team already has a pack, and rt never changes an existing pack. To add to it, use the mattstack:extending-a-pack skill");
    expect(fs.exists(`${ACME_PACK}/pack/stubs.jsonc`)).toBe(false);
  });

  test("a packed team on the host that does not claim the repo is skipped, so the outcome is zone-missing", async () => {
    const { deps, calls } = world({ files: orgFiles("acme", { ...GITLAB, "board.projects": ["acme/other"] }, { acme: {} }, PACKED), activeTeam: () => null });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-missing" });
    expect(calls.registered).toEqual([]);
  });

  test("--team naming a team with a compiled pack refuses pack-exists, whatever it claims", async () => {
    const { deps, calls } = world({ files: orgFiles("acme", { ...GITLAB, "board.projects": ["acme/other"] }, { acme: {} }, PACKED) });
    const out = await initPack({ repoDir: REPO, zone: null, team: "acme" }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "pack-exists" });
    expect(calls.claims).toEqual([]);
  });

  test("a team name that is not a team name is refused before any folder is read", async () => {
    for (const bad of ["../escape", "Widgets", "a/b", ""]) {
      const { deps, calls } = world();
      const out = await initPack({ repoDir: REPO, zone: null, team: bad }, deps);
      expect(out).toMatchObject({ ok: false, refused: true, code: "zone-missing" });
      expect(calls.registered).toEqual([]);
    }
  });

  test("a bad team name is written plainly in the refusal", async () => {
    const { deps } = world();
    const out = await initPack({ repoDir: REPO, zone: null, team: "Widgets" }, deps);
    if (out.ok || !out.refused) throw new Error("expected a refusal");
    expect(out.detail).toBe("Widgets is not a team name. A team name is lowercase letters, digits and hyphens, starting with a letter");
  });

  test("--zone naming no org on this Mac says so, and lists the orgs that are here", async () => {
    const { deps, calls } = world();
    const out = await initPack({ repoDir: REPO, zone: "other", team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-missing", detail: "There is no org called other on this Mac. Orgs here: acme" });
    expect(calls.registered).toEqual([]);
  });

  test("an org clone with no team folders refuses plainly with the add-a-team remedy, even on a TTY", async () => {
    const files = { [`${ORG_ROOT("acme")}/mattstack/mattstack.jsonc`]: `{ "role": "org", "org": "acme", "layout": 3 }` };
    const { deps } = world({ noOrg: true, files, isTTY: true });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-missing", detail: "The acme org has no team folders yet, so there is no team to hold a pack", why: "Only an org admin can add a team", next: "rt team add <team> --owner <username>" });
  });

  for (const zone of [null, "acme"]) test(`a clone whose org store has not landed yet says to pull it${zone ? " under --zone" : ""}`, async () => {
    const { deps, calls } = world({ currentOrg: () => null });
    const out = await initPack({ repoDir: REPO, zone, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-missing", detail: "Your copy of the acme org is not set up yet", next: "rt team pull" });
    expect(calls.registered).toEqual([]);
  });

  test("an uncompiled skeleton nobody claims is free: with no team and no active team it is carried on", async () => {
    const pack = `${TEAM_DIR("acme")}/plugin`;
    const { deps, calls } = world({
      files: orgFiles("acme", GITLAB, { acme: {} }, { [`${pack}/pack/skills.jsonc`]: `{}`, [`${pack}/pack/stubs.jsonc`]: `{ "kept": true }` }),
      activeTeam: () => null,
    });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out.ok).toBe(true);
    expect(calls.claims).toEqual([["acme/acme", ["acme/api"]]]);
  });

  test("a team and an org with no host or forge refuse, naming the setting that fixes it", async () => {
    const { deps, calls, fs } = world({ files: orgFiles("acme", {}, { acme: {} }), gitRemote: async () => ({ kind: "ok", url: "git@gitlab.example.com:acme/api.git" }) });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-no-host", next: `rt settings set board.gitlabHost '"gitlab.example.com"' --scope team --team acme` });
    if (out.ok || !out.refused) return;
    expect(out.detail).toBe("The acme team has no forge host set, so rt cannot tell which host this repo is on");
    expect(calls.claims).toEqual([]);
    expect(calls.registered).toEqual([]);
    expect(fs.exists(`${ACME_PACK}/pack/stubs.jsonc`)).toBe(false);
  });

  test.each([
    ["no-remote", { gitRemote: async () => ({ kind: "no-remote" as const }) }],
    ["not-a-repo", { gitRemote: async () => ({ kind: "not-a-repo" as const }) }],
    ["mattstack-missing", { engineDescription: () => null }],
    ["claude-missing", { claude: null }],
  ])("refuses with %s", async (code, over) => {
    const { deps, calls } = world(over as Partial<InitDeps>);
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code });
    expect(calls.registered).toEqual([]);
  });

  test("a credential-bearing remote with no path refuses no-remote without leaking the credential", async () => {
    const { deps } = world({ gitRemote: async () => ({ kind: "ok", url: "https://user:secret@gitlab.com" }) });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "no-remote" });
    if (out.ok || !out.refused) return;
    expect(out.detail).not.toContain("secret");
  });

  test("zone-missing without a TTY names rt team add", async () => {
    const { deps } = world({ gitRemote: async () => ({ kind: "ok", url: "git@gitlab.example.com:acme/api.git" }), activeTeam: () => null });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-missing" });
    if (out.ok || !out.refused) return;
    expect(out.next).toBe("rt team add <team> --owner <username>");
    expect(out.why).toBe("Only an org admin can add a team");
    expect(out.detail).toBe("No team on gitlab.example.com is free for a new pack");
  });

  test("a Mac with an org never prompts for a new one, even on a TTY", async () => {
    const { deps } = world({ gitRemote: async () => ({ kind: "ok", url: "git@gitlab.example.com:acme/api.git" }), isTTY: true, activeTeam: () => null });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-missing", next: "rt team add <team> --owner <username>" });
  });

  test("an unknown --team names rt team add", async () => {
    const { deps } = world();
    const out = await initPack({ repoDir: REPO, zone: null, team: "sprockets" }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-missing", detail: "There is no team called sprockets", why: "Only an org admin can add a team", next: "rt team add sprockets --owner <username>" });
  });

  test("a Mac with no org yet and no TTY points at rt team create", async () => {
    const { deps } = world({ noOrg: true });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-missing", next: "rt team create <name> --remote <url> --first-team <team>" });
  });

  test("a Mac with no org and a named team points at rt team create with that team first", async () => {
    const { deps } = world({ noOrg: true });
    const out = await initPack({ repoDir: REPO, zone: null, team: "widgets" }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-missing", detail: "This Mac has no org yet, so there is no team to hold a pack", next: "rt team create <name> --remote <url> --first-team widgets" });
  });

  describe("a Mac with two org clones", () => {
    const twoOrgs = (betaSettings: Record<string, unknown> = GITLAB) => ({
      ...orgFiles("acme", GITLAB, { widgets: {} }),
      ...orgFiles("beta", betaSettings, { widgets: {}, gadgets: {} }),
    });
    const fileSnapshot = (fs: InitFs) => {
      const walk = (dir: string): string[] => fs.readDir(dir).flatMap((name) => {
        const path = `${dir}/${name}`;
        return fs.readFile(path) !== null ? [`${path}=${fs.readFile(path)}`] : walk(path);
      });
      return walk(`${HOME}/.mattstack/orgs`).sort();
    };

    test("--zone naming the other org refuses and writes nothing in either org", async () => {
      const { deps, calls, fs } = world({ files: twoOrgs(), noOrg: true, activeTeam: () => null });
      const before = fileSnapshot(fs);
      const out = await initPack({ repoDir: REPO, zone: "beta", team: "widgets" }, deps);
      expect(out).toMatchObject({ ok: false, refused: true, code: "other-org", detail: "The beta org is not the one this Mac uses", why: "rt works with one org per Mac, and this Mac uses acme" });
      expect(fileSnapshot(fs)).toEqual(before);
      expect(fs.mkdirped.size).toBe(0);
      expect(calls.claims).toEqual([]);
      expect(calls.registered).toEqual([]);
      expect(calls.claude).toEqual([]);
    });

    test("a repo only the other org claims never lands there", async () => {
      const { deps, calls, fs } = world({ files: twoOrgs({ ...GITLAB, "board.projects": ["acme/api"] }), noOrg: true, activeTeam: () => null });
      const before = fileSnapshot(fs);
      const out = await initPack({ repoDir: REPO, zone: null, team: "gadgets" }, deps);
      expect(out).toMatchObject({ ok: false, refused: true, code: "zone-missing", detail: "There is no team called gadgets" });
      expect(fileSnapshot(fs)).toEqual(before);
      expect(calls.claims).toEqual([]);
    });

    test("the org this Mac uses still gets its pack", async () => {
      const { deps, calls, fs } = world({ files: twoOrgs(), noOrg: true, activeTeam: () => null });
      deps.materialize = async () => {
        fs.mkdirp(`${HOME}/.mattstack/repos/gitlab.com-acme-api/packs/widgets`);
        fs.writeFile(`${HOME}/.mattstack/repos/gitlab.com-acme-api/packs/widgets/skills.jsonc`, "{}");
        return { ok: true, detail: "merged" };
      };
      const out = await initPack({ repoDir: REPO, zone: "acme", team: "widgets" }, deps);
      expect(out).toMatchObject({ ok: true });
      expect(calls.claims).toEqual([["acme/widgets", ["acme/api"]]]);
      expect(fs.exists(`${ORG_ROOT("acme")}/mattstack/teams/widgets/plugin/pack/stubs.jsonc`)).toBe(true);
      expect(fs.exists(`${ORG_ROOT("beta")}/mattstack/teams/widgets/plugin`)).toBe(false);
    });
  });

  test("zone-ambiguous names the teams by their own names", async () => {
    const { deps } = world({ files: orgFiles("acme", GITLAB, { acme: {}, gadgets: {} }), activeTeam: () => null });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-ambiguous" });
    if (out.ok || !out.refused) return;
    expect(out.detail).toBe("More than one team could hold this pack: acme, gadgets");
    expect(out.next).toBe("rt skills init --team <name>");
  });

  test("zone-missing with a TTY prompts and creates the org, then claims the repo for its first team", async () => {
    const created: string[] = [];
    const { deps, fs, calls } = world({
      gitRemote: async () => ({ kind: "ok", url: "git@gitlab.example.com:acme/api.git" }),
      isTTY: true,
      noOrg: true,
      promptZone: async () => ({ name: "Beta", remote: "https://gitlab.example.com/acme/mattstack-team-beta.git" }),
      createZone: async (name, remote) => {
        created.push(`${name} ${remote}`);
        for (const [p, t] of Object.entries(orgFiles("beta", { "board.gitlabHost": "gitlab.example.com" }, { beta: {} }))) {
          fs.mkdirp(p.slice(0, p.lastIndexOf("/")));
          fs.writeFile(p, t);
        }
        return { slug: "beta", team: "beta", dir: ORG_ROOT("beta") };
      },
      materialize: async () => {
        fs.mkdirp(`${HOME}/.mattstack/repos/gitlab.example.com-acme-api/packs/beta`);
        fs.writeFile(`${HOME}/.mattstack/repos/gitlab.example.com-acme-api/packs/beta/skills.jsonc`, "// beta@beta-market\n{}");
        return { ok: true, detail: "merged" };
      },
    });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(created).toEqual(["Beta https://gitlab.example.com/acme/mattstack-team-beta.git"]);
    expect(out.ok).toBe(true);
    expect(calls.claims).toEqual([["beta/beta", ["acme/api"]]]);
  });

  test("a floor above this rt refuses an interactive no-org init before the org is created", async () => {
    let created = 0;
    const { deps } = world({
      gitRemote: async () => ({ kind: "ok", url: "git@gitlab.example.com:acme/api.git" }),
      isTTY: true,
      noOrg: true,
      createZone: async () => { created += 1; return { slug: "beta", team: "beta", dir: ORG_ROOT("beta") }; },
    });
    deps.engine = () => "0.30.28";
    deps.engineFloor = () => "0.31.0";
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "needs-newer-app" });
    expect(created).toBe(0);
  });

  test("zone-missing with a TTY: createZone reports a team but writes no folder, so the re-resolve miss names that team, not null", async () => {
    const { deps } = world({
      gitRemote: async () => ({ kind: "ok", url: "git@gitlab.example.com:acme/api.git" }),
      isTTY: true,
      noOrg: true,
      promptZone: async () => ({ name: "Beta", remote: "https://gitlab.example.com/acme/mattstack-team-beta.git" }),
      createZone: async () => ({ slug: "beta", team: "beta", dir: ORG_ROOT("beta") }),
    });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-missing" });
    if (out.ok || !out.refused) return;
    expect(out.detail).toBe("There is no team called beta");
  });

  test("a scaffold write that throws mid-phase returns write-failed, carrying wrote and a pack-dir remedy", async () => {
    const { deps } = world();
    let writes = 0;
    const originalWriteFile = deps.fs.writeFile;
    deps.fs.writeFile = (p, text) => {
      writes++;
      if (writes === 2) throw new Error("disk full");
      originalWriteFile(p, text);
    };
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: false, code: "write-failed" });
    if (out.ok || out.refused) return;
    expect(out.detail).toContain("disk full");
    expect(out.wrote).toEqual([`${ACME_PACK}/.claude-plugin/plugin.json`]);
    expect(out.remedy).toEqual({ commands: ["rt skills init"], folder: ACME_PACK });
  });

  test("a compile failure after writing reports every written path", async () => {
    const { deps } = world({ compile: async () => ({ ok: false, errors: ["boom"] }) });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: false, code: "compile-failed" });
    if (out.ok || out.refused) return;
    expect(out.detail).toContain("boom");
    expect(out.wrote).toContain(`${ACME_PACK}/pack/stubs.jsonc`);
  });

  for (const failure of [
    "skills/gadgets/SKILL.md:3:14: frontmatter is not valid YAML: Nested mappings are not allowed in compact mappings",
    "skills/gadgets/SKILL.md:5:7: ${CLAUDE_SKILL_DIR}/../widgets/gone.md does not resolve to a file from the skill's folder",
  ]) {
    test(`a hand-written skill failure stops init before the install and share, naming the file: ${failure.split(": ")[1]}`, async () => {
      const { deps, calls } = world({ check: async () => ({ drift: false, handErrors: [failure] }) });
      const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
      expect(out).toMatchObject({ ok: false, refused: false, code: "hand-skill-failed", detail: failure });
      if (out.ok || out.refused) return;
      expect(out.remedy?.commands[0]).toBe(`rt skills check --pack-dir ${ACME_PACK}`);
      expect(calls.shared).toEqual([]);
      expect(calls.claude.some((a) => a[1] === "install")).toBe(false);
    });
  }

  test("a compiled pointer that leads nowhere stops init before the install and share, with its own code", async () => {
    const dead = "attachments/stage-plan/SKILL.md:12:5: @stage-plan/scripts/ points at attachments/stage-plan/scripts/, which is not a file";
    const { deps, calls } = world({ check: async () => ({ drift: false, pointerErrors: [dead] }) });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: false, code: "pointer-failed", detail: dead });
    if (out.ok || out.refused) return;
    expect(out.remedy?.commands.slice(0, 2)).toEqual([`rt skills compile --pack-dir ${ACME_PACK}`, `rt skills check --pack-dir ${ACME_PACK}`]);
    expect(calls.shared).toEqual([]);
    expect(calls.claude.some((a) => a[1] === "install")).toBe(false);
  });

  test("the share is remembered once the files are written, so a later failure ends with rt team publish", async () => {
    const { deps, calls } = world({ compile: async () => ({ ok: false, errors: ["boom"] }) });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: false, code: "compile-failed" });
    if (out.ok || out.refused) return;
    expect(calls.remembered).toHaveLength(1);
    expect(calls.remembered[0]![1][0]).toBe("mattstack/teams/acme/plugin");
    expect(calls.remembered[0]![1]).toContain(".claude-plugin/marketplace.json");
    expect(out.remedy?.commands.at(-1)).toBe("rt team publish --team acme");
    expect(calls.shared).toEqual([]);
  });

  test("a write failure remembers no share", async () => {
    const { deps, calls } = world();
    const originalWriteFile = deps.fs.writeFile;
    let writes = 0;
    deps.fs.writeFile = (p, text) => {
      writes++;
      if (writes === 2) throw new Error("disk full");
      originalWriteFile(p, text);
    };
    expect(await initPack({ repoDir: REPO, zone: null, team: null }, deps)).toMatchObject({ code: "write-failed" });
    expect(calls.remembered).toEqual([]);
  });

  test("materialize that leaves no manifest is materialize-failed", async () => {
    const { deps } = world({ materialize: async () => ({ ok: false, detail: "no team declares" }) });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: false, code: "materialize-failed", remedy: { commands: [`rt skills materialize --dir ${REPO}`, "rt team publish --team acme"] } });
  });

  test("a step that throws keeps the error's why and next", async () => {
    const { deps } = world({
      registerRepo: async () => {
        throw new UserActionableError("locate-failed", "rt could not add this repo to its list", {}, {
          why: "The rt daemon is not running.",
          next: "rt daemon start",
        });
      },
    });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: false, why: "The rt daemon is not running.", next: "rt daemon start" });
  });

  test("a throw from registerRepo after writing is materialize-failed, keeping wrote", async () => {
    const { deps } = world({
      registerRepo: async () => { throw new Error("daemon down"); },
    });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: false, code: "materialize-failed" });
    if (out.ok || out.refused) return;
    expect(out.detail).toContain("daemon down");
    expect(out.wrote).toContain(`${ACME_PACK}/pack/stubs.jsonc`);
  });

  test("zone-missing with a TTY prompts, but the created team lands on a different host, so it refuses zone-mismatch naming the created team", async () => {
    const { deps, fs } = world({
      gitRemote: async () => ({ kind: "ok", url: "git@gitlab.example.com:acme/api.git" }),
      isTTY: true,
      noOrg: true,
      promptZone: async () => ({ name: "Beta", remote: "https://github.com/acme/mattstack-team-beta.git" }),
      createZone: async () => {
        for (const [p, t] of Object.entries(orgFiles("beta", { "board.gitlabHost": "github.com" }, { beta: {} }))) {
          fs.mkdirp(p.slice(0, p.lastIndexOf("/")));
          fs.writeFile(p, t);
        }
        return { slug: "beta", team: "beta", dir: ORG_ROOT("beta") };
      },
    });
    const out = await initPack({ repoDir: REPO, zone: null, team: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-mismatch" });
    if (out.ok || !out.refused) return;
    expect(out.detail).toBe("The beta team is on github.com, but this repo is on gitlab.example.com");
  });
});

test("refusal titles name no path or config file", async () => {
  const notRepo = await initPack({ repoDir: REPO, zone: null, team: null }, world({ gitRemote: async () => ({ kind: "not-a-repo" }) }).deps);
  expect(notRepo).toMatchObject({ refused: true, detail: "This folder is not a git repo" });
});

describe("initPack against a real org clone", () => {
  afterEach(cleanupOrgWorlds);

  function realCloneDeps(w: ReturnType<typeof orgWorld>, overrides: Partial<InitDeps> = {}): InitDeps {
    const realFs: InitFs = {
      exists: (path) => existsSync(path),
      readFile: (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
      writeFile: (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); },
      mkdirp: (path) => { mkdirSync(path, { recursive: true }); },
      readDir: (path) => (existsSync(path) ? readdirSync(path) : []),
    };
    const manifest = join(w.home, ".mattstack", "repos", "gitlab.com-acme-api", "packs", "widgets", "skills.jsonc");
    return {
      fs: realFs,
      home: w.home,
      gitRemote: async () => ({ kind: "ok", url: "git@gitlab.com:acme/api.git" }),
      isTTY: false,
      promptZone: async () => { throw new Error("must not prompt"); },
      createZone: async () => { throw new Error("must not create"); },
      activeTeam: () => "widgets",
      currentOrg: () => "acme",
      mayWrite: () => null,
      declareClaim: (zone, projects) => realFs.writeFile(join(zone.dir, "settings.team.jsonc"), JSON.stringify({ "board.title": "widgets", "board.projects": projects })),
      engineDescription: () => "Use when running a unit of work.",
      claude: async (args) => (args[2] === "list" ? ok("[]") : ok("")),
      registerRepo: async () => "gitlab.com/acme/api",
      materialize: async () => { realFs.writeFile(manifest, "{}"); return { ok: true, detail: "merged" }; },
      compile: async (packDir) => { realFs.writeFile(join(packDir, "skills", "work", "SKILL.md"), "compiled\n"); return { ok: true, errors: [] }; },
      check: async () => ({ drift: false }),
      sharePack: (zone, paths) => sharePack(w.p, zone.org, zone.team, paths, async () => null),
      rememberShare: (zone, paths) => rememberPackShare(w.p, zone.org, zone.team, paths),
      ...overrides,
    };
  }

  test("a compile failure, then the remedy's last command, rt team publish, puts the pack and its entry on origin", async () => {
    const w = orgWorld("dev1", { settings: { "board.gitlabHost": "gitlab.com" } });
    const out = await initPack({ repoDir: REPO, zone: null, team: "widgets" }, realCloneDeps(w, { compile: async () => ({ ok: false, errors: ["skills/work: bad slot"] }) }));
    expect(out).toMatchObject({ ok: false, refused: false, code: "compile-failed" });
    if (out.ok || out.refused) return;
    expect(w.pushes).toEqual([]);
    const next = out.remedy!.commands.at(-1)!;
    expect(next).toBe("rt team publish --team acme");

    const [, , , ...args] = next.split(" ");
    await teamPublish(args, {}, { probes: w.p, print: () => {}, exit: () => { throw new Error("exit"); }, forgeToken: async () => null });

    const files = w.atOrigin("show", "--name-only", "--format=", "main").trim().split("\n");
    expect(files).toContain("mattstack/teams/widgets/plugin/pack/skills.jsonc");
    expect(files).toContain(".claude-plugin/marketplace.json");
    expect(JSON.parse(w.atOrigin("show", "main:.claude-plugin/marketplace.json")).plugins).toEqual([expect.objectContaining({ name: "widgets" })]);
    expect(readTeamLocal(w.p, "acme").pendingPackShares).toBeUndefined();
  });

  test("a run resumed after params-missing still shares the marketplace entry and the claim the first run wrote", async () => {
    const w = orgWorld("dev1", { settings: { "board.gitlabHost": "gitlab.com" } });
    const missing = [{ kind: "param" as const, name: "linear-team", file: "pack/params.jsonc", askedBy: ["acme-base:work"] }];
    const first = await initPack({ repoDir: REPO, zone: null, team: "widgets" }, realCloneDeps(w, { compile: async () => ({ ok: false, errors: [], missing }) }));
    expect(first).toMatchObject({ ok: false, refused: true, code: "params-missing" });
    expect(w.pushes).toEqual([]);

    const again = await initPack({ repoDir: REPO, zone: null, team: "widgets" }, realCloneDeps(w));
    expect(again).toMatchObject({ ok: true, wrote: [], published: { pushed: true, remote: w.remote } });
    const files = w.atOrigin("show", "--name-only", "--format=", "main").trim().split("\n");
    expect(files).toContain(".claude-plugin/marketplace.json");
    expect(files).toContain("mattstack/teams/widgets/settings.team.jsonc");
    expect(files).toContain("mattstack/teams/widgets/plugin/skills/work/SKILL.md");
    expect(readTeamLocal(w.p, "acme").pendingPackShares).toBeUndefined();
  });

  test("the new pack folder and its marketplace entry reach origin in one push", async () => {
    const w = orgWorld("dev1", { settings: { "board.gitlabHost": "gitlab.com" } });
    const out = await initPack({ repoDir: REPO, zone: null, team: "widgets" }, realCloneDeps(w));
    expect(out).toMatchObject({ ok: true, published: { pushed: true, remote: w.remote } });
    expect(readTeamLocal(w.p, "acme").pendingPackShares).toBeUndefined();
    expect(w.pushes).toHaveLength(1);
    const files = w.atOrigin("show", "--name-only", "--format=", "main").trim().split("\n");
    expect(files).toContain(".claude-plugin/marketplace.json");
    expect(files).toContain("mattstack/teams/widgets/plugin/pack/skills.jsonc");
    expect(files).toContain("mattstack/teams/widgets/plugin/skills/work/SKILL.md");
    expect(files).toContain("mattstack/teams/widgets/settings.team.jsonc");
    expect(JSON.parse(w.atOrigin("show", "main:.claude-plugin/marketplace.json")).plugins).toEqual([expect.objectContaining({ name: "widgets", source: "./mattstack/teams/widgets/plugin" })]);
  });
});
