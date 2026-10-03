import { describe, expect, test } from "bun:test";
import { chooseZone, parseRemote, readZones, readZonesFrom, type InitFs, type ZoneInfo, addMarketplacePlugin, zoneTeamConfigReads, packDescription, PIPELINE_STAGES, renderPackFiles, initPack, type InitDeps, type RunResult } from "../init.ts";
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
const ORG_ROOT = (org: string) => `${HOME}/.mattstack/teams/${org}`;
const orgFiles = (org: string, orgSettings: Record<string, unknown>, teams: Record<string, Record<string, unknown>>, extra: Record<string, string> = {}) => ({
  [`${ORG_ROOT(org)}/mattstack/mattstack.jsonc`]: `{ "role": "org", "org": "${org}" }`,
  [`${ORG_ROOT(org)}/mattstack/org/settings.org.jsonc`]: `// org\n${JSON.stringify(orgSettings)}`,
  [`${ORG_ROOT(org)}/.claude-plugin/marketplace.json`]: `{ "name": "${org}-market", "owner": { "name": "x" }, "plugins": [] }`,
  ...Object.fromEntries(Object.entries(teams).map(([team, settings]) => [`${ORG_ROOT(org)}/mattstack/teams/${team}/settings.team.jsonc`, `// team\n${JSON.stringify(settings)}`])),
  ...extra,
});

describe("readZones", () => {
  test("one zone per team folder, named <org>/<team>", () => {
    const fs = memFs(orgFiles("acme", {}, { widgets: {}, gadgets: {} }));
    const zones = readZonesFrom(fs, `${HOME}/.mattstack/teams`);
    expect(zones.map((z) => z.slug)).toEqual(["acme/gadgets", "acme/widgets"]);
    expect(zones[1]).toEqual({
      slug: "acme/widgets", org: "acme", team: "widgets", orgDir: ORG_ROOT("acme"), dir: `${ORG_ROOT("acme")}/mattstack/teams/widgets`,
      host: null, projects: [], marketplace: "acme-market", hasPack: false,
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

  test("the host falls back to the forge in mattstack.integrations, team then org", () => {
    const fs = memFs(orgFiles("acme", { "mattstack.integrations": { forge: { host: "github.com", provider: "github" } } }, { widgets: {} }));
    expect(readZones(fs, HOME)[0]!.host).toBe("github.com");
  });

  test("a team folder with a pack/skills.jsonc under packs/<team> has a pack; a plugin.json alone does not", () => {
    const fs = memFs(orgFiles("acme", {}, { widgets: {}, gadgets: {} }, {
      [`${ORG_ROOT("acme")}/mattstack/teams/widgets/packs/widgets/pack/skills.jsonc`]: `{}`,
      [`${ORG_ROOT("acme")}/mattstack/teams/gadgets/packs/gadgets/.claude-plugin/plugin.json`]: `{ "name": "gadgets", "version": "0.1.0" }`,
    }));
    const byTeam = Object.fromEntries(readZones(fs, HOME).map((z) => [z.team, z.hasPack]));
    expect(byTeam).toEqual({ widgets: true, gadgets: false });
  });

  test("a base pack under packs/<team> does not occupy the team's pack slot", () => {
    const fs = memFs(orgFiles("acme", {}, { widgets: {} }, {
      [`${ORG_ROOT("acme")}/mattstack/teams/widgets/packs/widgets/pack/skills.jsonc`]: `{ "base": true }`,
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

  test("an old-layout clone and a user zone are skipped", () => {
    const fs = memFs({
      [`${HOME}/.mattstack/teams/old/mattstack/mattstack.jsonc`]: `{ "role": "team", "namespace": "old", "org": "x" }`,
      [`${HOME}/.mattstack/teams/old/mattstack/settings.team.jsonc`]: `{}`,
      [`${HOME}/.mattstack/teams/me/mattstack/mattstack.jsonc`]: `{ "role": "user" }`,
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
    ({ slug: `acme/${team}`, org: "acme", team, orgDir: "/z", dir: `/z/mattstack/teams/${team}`, host, projects, marketplace: "acme", hasPack });
  test("a zone already declaring the repo wins, pack or not", () => {
    const r = chooseZone([z("a", "gitlab.com"), z("b", "gitlab.com", ["acme/api"], true)], repo, null);
    expect(r).toEqual({ kind: "found", zone: z("b", "gitlab.com", ["acme/api"], true) });
  });
  test("a zone on the host that already has a pack is skipped", () => {
    const r = chooseZone([z("claim", "gitlab.com", ["acme/other"], true), z("fresh", "gitlab.com")], repo, null);
    expect(r).toEqual({ kind: "found", zone: z("fresh", "gitlab.com") });
  });
  test("only packed zones on the host means missing", () => {
    expect(chooseZone([z("claim", "gitlab.com", ["acme/other"], true)], repo, null)).toEqual({ kind: "missing" });
  });
  test("two packless host matches is ambiguous", () => {
    const r = chooseZone([z("a", "gitlab.com"), z("b", "gitlab.com")], repo, null);
    expect(r.kind).toBe("ambiguous");
  });
  test("--zone picks among candidates by team name", () => {
    const r = chooseZone([z("a", "gitlab.com"), z("b", "gitlab.com")], repo, "b");
    expect(r).toEqual({ kind: "found", zone: z("b", "gitlab.com") });
  });
  test("--zone naming a zone on another host is a mismatch", () => {
    const r = chooseZone([z("gh", "github.com")], repo, "gh");
    expect(r).toEqual({ kind: "mismatch", zone: z("gh", "github.com") });
  });
  test("--zone naming a packed zone that does not declare the repo is has-pack", () => {
    const packed = z("claim", "gitlab.com", ["acme/other"], true);
    expect(chooseZone([packed], repo, "claim")).toEqual({ kind: "has-pack", zone: packed });
  });
  test("a zone with no host yet is a candidate", () => {
    const r = chooseZone([z("fresh", null)], repo, null);
    expect(r).toEqual({ kind: "found", zone: z("fresh", null) });
  });
  test("no candidates is missing", () => {
    expect(chooseZone([z("gh", "github.com")], repo, null)).toEqual({ kind: "missing" });
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
    expect(manifest.version).toBe(1);
    expect(manifest.skills).toEqual({ enabled: ["mattstack:work", "mattstack:model-tiering"] });
    expect(manifest.pipelines.feature).toEqual(PIPELINE_STAGES.map((s) => `mattstack:${s}`));
    expect(manifest.bindings).toEqual({
      "mattstack:work": { tiering: "mattstack:model-tiering" },
      "mattstack:stage-watch-ci": { forge: "mattstack:ci-forge-gitlab" },
    });
  });
  test("PACK.md names the two authoring skills, calls the description a placeholder, no dashes", () => {
    expect(files["PACK.md"]).toContain("mattstack:extending-a-pack");
    expect(files["PACK.md"]).toContain("mattstack:creating-a-pack");
    expect(files["PACK.md"]).toContain("placeholder");
    for (const text of Object.values(files)) expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("addMarketplacePlugin", () => {
  const SRC = "./mattstack/teams/acme/packs/acme";
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

type Calls = { claude: string[][]; registered: string[]; materialized: string[]; compiled: string[]; checked: string[]; claims: [string, string[]][] };

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "" });
const REPO = "/work/api";
const TEAM_DIR = (team: string) => `${ORG_ROOT("acme")}/mattstack/teams/${team}`;
const ACME_PACK = `${TEAM_DIR("acme")}/packs/acme`;
const GITLAB = { "board.gitlabHost": "gitlab.com" };

function world(overrides: Partial<InitDeps> & { files?: Record<string, string>; marketplaces?: string[] } = {}) {
  const calls: Calls = { claude: [], registered: [], materialized: [], compiled: [], checked: [], claims: [] };
  const files: Record<string, string> = {
    ...orgFiles("acme", GITLAB, { acme: {} }),
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
    ...overrides,
  };
  return { deps, calls, fs };
}

describe("initPack", () => {
  test("happy path writes the pack named after the team, claims the repo, installs, and reports", async () => {
    const { deps, calls, fs } = world();
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.pack).toEqual({ name: "acme", dir: ACME_PACK, zone: "acme/acme", marketplace: "acme-market" });
    expect(fs.exists(`${ACME_PACK}/pack/stubs.jsonc`)).toBe(true);
    expect(calls.claims).toEqual([["acme/acme", ["acme/api"]]]);
    expect(JSON.parse(fs.readFile(`${ORG_ROOT("acme")}/.claude-plugin/marketplace.json`)!).plugins[0]).toMatchObject({ name: "acme", source: "./mattstack/teams/acme/packs/acme" });
    expect(calls.registered).toEqual([REPO]);
    expect(calls.materialized).toEqual(["gitlab.com/acme/api"]);
    expect(calls.compiled).toEqual([ACME_PACK]);
    expect(calls.checked).toEqual([ACME_PACK]);
    expect(calls.claude).toContainEqual(["plugin", "marketplace", "add", ORG_ROOT("acme")]);
    expect(calls.claude).toContainEqual(["plugin", "install", "acme@acme-market"]);
    expect(out.repo).toEqual({ slug: "gitlab.com-acme-api", manifest: `${HOME}/.mattstack/repos/gitlab.com-acme-api/packs/acme/skills.jsonc` });
    expect(out.tryNext).toBe("/acme:work <ticket>");
    expect(out.restartNeeded).toBe(true);
  });

  test("a new claim is the team's resolved list plus the new repo, never the new repo alone", async () => {
    const { deps, calls } = world({ files: orgFiles("acme", { ...GITLAB, "board.projects": ["acme/widgets"] }, { acme: {} }) });
    const out = await initPack({ repoDir: REPO, zone: "acme" }, deps);
    expect(out.ok).toBe(true);
    expect(calls.claims).toEqual([["acme/acme", ["acme/widgets", "acme/api"]]]);
  });

  test("a repo the team already claims writes no claim", async () => {
    const { deps, calls } = world({ files: orgFiles("acme", { ...GITLAB, "board.projects": ["acme/api"] }, { acme: {} }) });
    await initPack({ repoDir: REPO, zone: null }, deps);
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
    };
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out.ok).toBe(true);
    const written = fs.readFile(`${ORG_ROOT("acme")}/.claude-plugin/marketplace.json`);
    expect(written).not.toBeNull();
    expect(JSON.parse(written!).plugins).toContainEqual({ name: "acme", source: "./mattstack/teams/acme/packs/acme", description: packDescription("acme") });
  });

  test("a marketplace already listed is not re-added", async () => {
    const { deps, calls } = world({ marketplaces: ["acme-market"] });
    await initPack({ repoDir: REPO, zone: null }, deps);
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
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
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
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: false, code: "install-failed" });
    if (out.ok || out.refused) return;
    expect(out.detail).toContain("no such plugin");
  });

  const PACKED = { [`${TEAM_DIR("acme")}/packs/acme/.claude-plugin/plugin.json`]: `{ "name": "acme", "version": "0.3.0" }`, [`${TEAM_DIR("acme")}/packs/acme/pack/skills.jsonc`]: `{}` };

  test("refuses before writing: pack-exists when the claiming team already has a pack", async () => {
    const { deps, fs } = world({ files: orgFiles("acme", { ...GITLAB, "board.projects": ["acme/api"] }, { acme: {} }, PACKED) });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "pack-exists" });
    if (out.ok || !out.refused) return;
    expect(out.detail).toBe("This team already has a pack, and rt never changes an existing pack. To add to it, use the mattstack:extending-a-pack skill");
    expect(fs.exists(`${ACME_PACK}/pack/stubs.jsonc`)).toBe(false);
  });

  test("a packed team on the host that does not claim the repo is skipped, so the outcome is zone-missing", async () => {
    const { deps, calls } = world({ files: orgFiles("acme", { ...GITLAB, "board.projects": ["acme/other"] }, { acme: {} }, PACKED) });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-missing" });
    expect(calls.registered).toEqual([]);
  });

  test("--zone naming a packed team refuses zone-has-pack", async () => {
    const { deps } = world({ files: orgFiles("acme", { ...GITLAB, "board.projects": ["acme/other"] }, { acme: {} }, PACKED) });
    const out = await initPack({ repoDir: REPO, zone: "acme" }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-has-pack" });
    if (out.ok || !out.refused) return;
    expect(out.detail).toBe("The acme team already has a pack, and a team holds only one");
    expect(out.next).toBe("rt team create <name> --remote <url>");
  });

  test.each([
    ["no-remote", { gitRemote: async () => ({ kind: "no-remote" as const }) }],
    ["not-a-repo", { gitRemote: async () => ({ kind: "not-a-repo" as const }) }],
    ["mattstack-missing", { engineDescription: () => null }],
    ["claude-missing", { claude: null }],
  ])("refuses with %s", async (code, over) => {
    const { deps, calls } = world(over as Partial<InitDeps>);
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code });
    expect(calls.registered).toEqual([]);
  });

  test("a credential-bearing remote with no path refuses no-remote without leaking the credential", async () => {
    const { deps } = world({ gitRemote: async () => ({ kind: "ok", url: "https://user:secret@gitlab.com" }) });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "no-remote" });
    if (out.ok || !out.refused) return;
    expect(out.detail).not.toContain("secret");
  });

  test("zone-missing without a TTY names rt team create", async () => {
    const { deps } = world({ gitRemote: async () => ({ kind: "ok", url: "git@gitlab.example.com:acme/api.git" }) });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-missing" });
    if (out.ok || !out.refused) return;
    expect(out.next).toBe("rt team create <name> --remote <url>");
    expect(out.detail).toBe("No team on gitlab.example.com is free for a new pack");
  });

  test("zone-ambiguous names the teams by their own names", async () => {
    const { deps } = world({ files: orgFiles("acme", GITLAB, { acme: {}, gadgets: {} }) });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-ambiguous" });
    if (out.ok || !out.refused) return;
    expect(out.detail).toBe("More than one team could hold this pack: acme, gadgets");
  });

  test("zone-missing with a TTY prompts and creates the team, then claims the repo for it", async () => {
    const created: string[] = [];
    const { deps, fs, calls } = world({
      gitRemote: async () => ({ kind: "ok", url: "git@gitlab.example.com:acme/api.git" }),
      isTTY: true,
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
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(created).toEqual(["Beta https://gitlab.example.com/acme/mattstack-team-beta.git"]);
    expect(out.ok).toBe(true);
    expect(calls.claims).toEqual([["beta/beta", ["acme/api"]]]);
  });

  test("zone-missing with a TTY: createZone reports a team but writes no folder, so the re-resolve miss names that team, not null", async () => {
    const { deps } = world({
      gitRemote: async () => ({ kind: "ok", url: "git@gitlab.example.com:acme/api.git" }),
      isTTY: true,
      promptZone: async () => ({ name: "Beta", remote: "https://gitlab.example.com/acme/mattstack-team-beta.git" }),
      createZone: async () => ({ slug: "beta", team: "beta", dir: ORG_ROOT("beta") }),
    });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
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
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: false, code: "write-failed" });
    if (out.ok || out.refused) return;
    expect(out.detail).toContain("disk full");
    expect(out.wrote).toEqual([`${ACME_PACK}/.claude-plugin/plugin.json`]);
    expect(out.remedy).toEqual({ commands: ["rt skills init"], folder: ACME_PACK });
  });

  test("a compile failure after writing reports every written path", async () => {
    const { deps } = world({ compile: async () => ({ ok: false, errors: ["boom"] }) });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: false, code: "compile-failed" });
    if (out.ok || out.refused) return;
    expect(out.detail).toContain("boom");
    expect(out.wrote).toContain(`${ACME_PACK}/pack/stubs.jsonc`);
  });

  test("materialize that leaves no manifest is materialize-failed", async () => {
    const { deps } = world({ materialize: async () => ({ ok: false, detail: "no team declares" }) });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: false, code: "materialize-failed", remedy: { commands: [`rt skills materialize --dir ${REPO}`] } });
  });

  test("a throw from registerRepo after writing is materialize-failed, keeping wrote", async () => {
    const { deps } = world({
      registerRepo: async () => { throw new Error("daemon down"); },
    });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: false, code: "materialize-failed" });
    if (out.ok || out.refused) return;
    expect(out.detail).toContain("daemon down");
    expect(out.wrote).toContain(`${ACME_PACK}/pack/stubs.jsonc`);
  });

  test("zone-missing with a TTY prompts, but the created team lands on a different host, so it refuses zone-mismatch naming the created team", async () => {
    const { deps, fs } = world({
      gitRemote: async () => ({ kind: "ok", url: "git@gitlab.example.com:acme/api.git" }),
      isTTY: true,
      promptZone: async () => ({ name: "Beta", remote: "https://github.com/acme/mattstack-team-beta.git" }),
      createZone: async () => {
        for (const [p, t] of Object.entries(orgFiles("beta", { "board.gitlabHost": "github.com" }, { beta: {} }))) {
          fs.mkdirp(p.slice(0, p.lastIndexOf("/")));
          fs.writeFile(p, t);
        }
        return { slug: "beta", team: "beta", dir: ORG_ROOT("beta") };
      },
    });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-mismatch" });
    if (out.ok || !out.refused) return;
    expect(out.detail).toBe("The beta team is on github.com, but this repo is on gitlab.example.com");
  });
});
