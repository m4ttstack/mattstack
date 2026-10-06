import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { materializeRepo, type MaterializeFs } from "../materialize.ts";
import { readManifestProvenance } from "../manifest-merge.ts";

const realFs: MaterializeFs = {
  exists: existsSync,
  readFile: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
  writeFile: (p, t) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, t); },
  mkdirp: (p) => mkdirSync(p, { recursive: true }),
  readDir: (p) => (existsSync(p) ? readdirSync(p) : []),
  rename: renameSync,
};

const REMOTE = "git@gitlab.example.com:acme/widgets.git";
const SLUG = "gitlab.example.com-acme-widgets";

function write(p: string, text: string): void { realFs.writeFile(p, text); }

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeWorld() {
  const home = mkdtempSync(join(tmpdir(), "rt-materialize-"));
  homes.push(home);
  const root = join(home, ".mattstack");
  const engine = join(home, "engine");
  write(join(engine, "pack", "skills.jsonc"), JSON.stringify({ bindings: { "mattstack:stage-gates": { domain: "mattstack:generic-gates" } }, pipelines: { feature: ["stage-plan", "stage-gates"] } }));
  return { home, root, engine };
}

type TeamSpec = { projects?: string[]; packs: Record<string, object> };

function org(root: string, name: string, opts: { projects: string[]; teams: Record<string, TeamSpec>; base?: Record<string, object> }): void {
  const dir = join(root, "teams", name);
  write(join(dir, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "org", org: name }));
  write(join(dir, "mattstack", "org", "settings.org.jsonc"), JSON.stringify({ "board.gitlabHost": "https://gitlab.example.com", "board.projects": opts.projects }));
  for (const [team, spec] of Object.entries(opts.teams)) {
    const teamDir = teamFolder(root, name, team);
    write(join(teamDir, "settings.team.jsonc"), JSON.stringify(spec.projects ? { "board.projects": spec.projects } : {}));
    for (const [pack, fragment] of Object.entries(spec.packs)) {
      write(join(teamDir, "packs", pack, "pack", "skills.jsonc"), JSON.stringify(fragment));
    }
  }
  for (const [base, fragment] of Object.entries(opts.base ?? {})) {
    write(join(dir, "mattstack", "org", "packs", base, "pack", "skills.jsonc"), JSON.stringify(fragment));
  }
}

const teamFolder = (root: string, orgName: string, team: string) => join(root, "teams", orgName, "mattstack", "teams", team);

function body(path: string): { bindings: Record<string, Record<string, string>>; pipelines: Record<string, string[]>; skills: { enabled: string[] } } {
  return JSON.parse(readFileSync(path, "utf8").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n"));
}

describe("materializeRepo", () => {
  test("no remote -> no-remote", () => {
    const { root, engine } = makeWorld();
    expect(materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, null)).toEqual({ kind: "no-remote" });
  });

  test("no team claims the repo -> undeclared", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/other"], teams: { widgets: { packs: { widgets: {} } } } });
    expect(materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE)).toEqual({ kind: "undeclared", repo: "gitlab.example.com/acme/widgets" });
  });

  test("two teams on one repo each get their own pack file with their own stage-gates fill", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: {
      widgets: { packs: { widgets: { bindings: { "mattstack:stage-gates": { domain: "widgets:gates" } } } } },
      gadgets: { packs: { gadgets: { bindings: { "mattstack:stage-gates": { domain: "gadgets:gates" } } } } },
    } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    expect(out.kind).toBe("written");
    if (out.kind !== "written") return;
    expect(out.slug).toBe(SLUG);
    expect(out.packs.map((p) => [p.pack, p.ok])).toEqual([["gadgets", true], ["widgets", true]]);
    expect(body(join(root, "repos", SLUG, "packs", "widgets", "skills.jsonc")).bindings["mattstack:stage-gates"]!.domain).toBe("widgets:gates");
    expect(body(join(root, "repos", SLUG, "packs", "gadgets", "skills.jsonc")).bindings["mattstack:stage-gates"]!.domain).toBe("gadgets:gates");
  });

  test("layers: defaults, then base, then pack, then overrides, with provenance per layer", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", {
      projects: ["acme/widgets"],
      teams: { widgets: { packs: { widgets: { extends: "acme-base", bindings: { "mattstack:stage-gates": { domain: "widgets:gates" } } } } } },
      base: { "acme-base": { base: true, bindings: { "mattstack:stage-gates": { domain: "acme-base:gates" }, "mattstack:watch-ci": { forge: "mattstack:gitlab-forge" }, "mattstack:stage-ship": { policy: "acme-base:squash" } } } },
    });
    write(join(root, "user", "skills", "overrides.jsonc"), JSON.stringify({ bindings: { "mattstack:watch-ci": { forge: "me:forge" } } }));
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    const pack = out.packs[0]!;
    if (!pack.ok) throw new Error(pack.detail);
    expect(pack.layers).toEqual(["default", "base:acme-base", "pack", "override"]);
    const text = readFileSync(pack.path, "utf8");
    expect(readManifestProvenance(text)).toMatchObject({
      "pipeline feature": "default",
      "mattstack:stage-gates domain": "pack",
      "mattstack:stage-ship policy": "base:acme-base",
      "mattstack:watch-ci forge": "override",
    });
  });

  test("a missing base is a per-pack error and other packs on the repo still write", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { packs: { widgets: {} } }, gadgets: { packs: { gadgets: { extends: "acme-base" } } } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    const gadgets = out.packs.find((p) => p.pack === "gadgets")!;
    expect(gadgets.ok).toBe(false);
    if (!gadgets.ok) expect(gadgets.detail).toBe(`gadgets extends acme-base, but the org has no base pack called acme-base`);
    expect(existsSync(join(root, "repos", SLUG, "packs", "widgets", "skills.jsonc"))).toBe(true);
    expect(existsSync(join(root, "repos", SLUG, "packs", "gadgets", "skills.jsonc"))).toBe(false);
  });

  test("a type-invalid fragment fails only its own pack", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: {
      widgets: { packs: { widgets: { bindings: { "mattstack:stage-gates": { domain: "widgets:gates" } } } } },
      gadgets: { packs: { gadgets: { bindings: { "mattstack:stage-gates": null } } } },
    } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    const gadgets = out.packs.find((p) => p.pack === "gadgets")!;
    expect(gadgets.ok).toBe(false);
    if (!gadgets.ok) expect(gadgets.detail).toContain(join(teamFolder(root, "acme", "gadgets"), "packs", "gadgets", "pack", "skills.jsonc"));
    expect(out.packs.find((p) => p.pack === "widgets")!.ok).toBe(true);
    expect(body(join(root, "repos", SLUG, "packs", "widgets", "skills.jsonc")).bindings["mattstack:stage-gates"]!.domain).toBe("widgets:gates");
  });

  test("two packs in one team folder that claims the repo are both refused", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { acme: { packs: { widgets: {}, gadgets: {} } } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.every((p) => !p.ok)).toBe(true);
    if (!out.packs[0]!.ok) expect(out.packs[0]!.detail).toContain('team "acme" holds 2 packs (gadgets, widgets) that all claim gitlab.example.com/acme/widgets');
  });

  test("a team that sets no projects holds the base pack without claiming anything", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: {
      "acme-base-team": { projects: [], packs: { "acme-base": {} } },
      widgets: { packs: { widgets: {} } },
    } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.map((p) => p.pack)).toEqual(["widgets"]);
  });

  test("an invalid pack fragment is a per-pack error naming the file", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { packs: {} } } });
    write(join(teamFolder(root, "acme", "widgets"), "packs", "widgets", "pack", "skills.jsonc"), "{ nope");
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs[0]).toMatchObject({ ok: false });
    if (!out.packs[0]!.ok) expect(out.packs[0]!.detail).toContain("widgets/pack/skills.jsonc");
  });

  test("a base pack beside a claiming pack in one zone claims nothing and gets no file", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { packs: { widgets: {}, "acme-base": { base: true } } } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.map((p) => [p.pack, p.ok])).toEqual([["widgets", true]]);
    expect(readdirSync(join(root, "repos", SLUG, "packs"))).toEqual(["widgets"]);
  });

  test("a base pack is not counted when two claiming packs share a team folder", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { acme: { packs: { widgets: {}, gadgets: {}, "acme-base": { base: true } } } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.map((p) => [p.pack, p.ok])).toEqual([["gadgets", false], ["widgets", false]]);
    if (!out.packs[0]!.ok) expect(out.packs[0]!.detail).toContain('team "acme" holds 2 packs (gadgets, widgets) that all claim');
  });

  test("one base pack name in two declaring teams is not refused", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: {
      widgets: { packs: { widgets: {}, "acme-base": { base: true } } },
      gadgets: { packs: { gadgets: {}, "acme-base": { base: true } } },
    } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.map((p) => [p.pack, p.ok])).toEqual([["gadgets", true], ["widgets", true]]);
  });

  test("a declaring team folder holding only base packs writes nothing", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { acme: { packs: { "acme-base": { base: true } } } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    expect(out).toMatchObject({ kind: "written", packs: [] });
    expect(existsSync(join(root, "repos", SLUG, "packs"))).toBe(false);
  });

  test("a claiming pack extending the base beside it in its own team folder merges the org base layer, not the copy beside it", () => {
    const { root, engine } = makeWorld();
    const zoneCopy = { base: true, bindings: { "mattstack:stage-ship": { policy: "acme-base:unpublished" } } };
    org(root, "acme", {
      projects: ["acme/widgets"],
      teams: { acme: { packs: { widgets: { extends: "acme-base" }, "acme-base": zoneCopy } } },
      base: { "acme-base": { base: true, bindings: { "mattstack:stage-ship": { policy: "acme-base:squash" } } } },
    });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.map((p) => p.pack)).toEqual(["widgets"]);
    const widgets = out.packs[0]!;
    if (!widgets.ok) throw new Error(widgets.detail);
    expect(widgets.layers).toEqual(["default", "base:acme-base", "pack"]);
    expect(body(widgets.path).bindings["mattstack:stage-ship"]!.policy).toBe("acme-base:squash");
  });

  test("one pack name in two declaring teams is refused in both", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { alpha: { packs: { widgets: {} } }, beta: { packs: { widgets: {} } } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.map((p) => [p.pack, p.zone, p.ok])).toEqual([["widgets", "acme/alpha", false], ["widgets", "acme/beta", false]]);
    for (const p of out.packs) {
      if (!p.ok) expect(p.detail).toContain('pack "widgets" is in 2 zones (acme/alpha, acme/beta) that all claim gitlab.example.com/acme/widgets');
    }
    expect(existsSync(join(root, "repos", SLUG, "packs", "widgets", "skills.jsonc"))).toBe(false);
  });

  test("a declaring team folder with no packs writes nothing", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { acme: { packs: {} } } });
    write(join(root, "repos", SLUG, "skills.jsonc"), "{}");
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    expect(out).toEqual({ kind: "written", repo: "gitlab.example.com/acme/widgets", slug: SLUG, packs: [], migrated: null, pruned: [], pruneWarnings: [] });
    expect(existsSync(join(root, "repos", SLUG, "packs"))).toBe(false);
    expect(readFileSync(join(root, "repos", SLUG, "skills.jsonc"), "utf8")).toBe("{}");
  });

  test("the old merged file is renamed .migrated, never deleted", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { packs: { widgets: {} } } } });
    write(join(root, "repos", SLUG, "skills.jsonc"), "{}");
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.migrated).toBe(join(root, "repos", SLUG, "skills.jsonc.migrated"));
    expect(existsSync(join(root, "repos", SLUG, "skills.jsonc"))).toBe(false);
    expect(readFileSync(join(root, "repos", SLUG, "skills.jsonc.migrated"), "utf8")).toBe("{}");
  });

  test("the old merged file stays in place when every pack failed", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { packs: { widgets: { extends: "acme-base" } } } } });
    write(join(root, "repos", SLUG, "skills.jsonc"), "{}");
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.every((p) => !p.ok)).toBe(true);
    expect(out.migrated).toBeNull();
    expect(readFileSync(join(root, "repos", SLUG, "skills.jsonc"), "utf8")).toBe("{}");
    expect(existsSync(join(root, "repos", SLUG, "skills.jsonc.migrated"))).toBe(false);
  });

  test("the file is rewritten in place on a second run (no stray tmp file)", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { packs: { widgets: {} } } } });
    const deps = { fs: realFs, mattstackRoot: root, enginePackDir: engine };
    materializeRepo(deps, REMOTE);
    materializeRepo(deps, REMOTE);
    expect(readdirSync(join(root, "repos", SLUG, "packs", "widgets"))).toEqual(["skills.jsonc"]);
  });

  test("an invalid overrides file fails every pack with the override path", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { packs: { widgets: {} } }, gadgets: { packs: { gadgets: {} } } } });
    write(join(root, "user", "skills", "overrides.jsonc"), "{ nope");
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.map((p) => p.pack)).toEqual(["gadgets", "widgets"]);
    for (const p of out.packs) {
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.detail).toContain(join(root, "user", "skills", "overrides.jsonc"));
    }
    expect(existsSync(join(root, "repos", SLUG, "packs", "widgets", "skills.jsonc"))).toBe(false);
  });
});

describe("materializeRepo org base pack", () => {
  const baseDir = (root: string, name: string) => join(root, "teams", "acme", "mattstack", "org", "packs", name);

  test("a team pack that extends the org base layers default, base, pack", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", {
      projects: ["acme/widgets"],
      teams: { widgets: { packs: { widgets: { extends: "acme-base", bindings: { "mattstack:stage-gates": { domain: "widgets:gates" } } } } } },
      base: { "acme-base": { base: true, bindings: { "mattstack:stage-watch-ci": { forge: "acme-base:ci-forge" } } } },
    });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs).toEqual([{ pack: "widgets", zone: "acme/widgets", ok: true, path: join(root, "repos", SLUG, "packs", "widgets", "skills.jsonc"), layers: ["default", "base:acme-base", "pack"] }]);
    const merged = body(join(root, "repos", SLUG, "packs", "widgets", "skills.jsonc"));
    expect(merged.bindings["mattstack:stage-watch-ci"]).toEqual({ forge: "acme-base:ci-forge" });
    expect(merged.bindings["mattstack:stage-gates"]).toEqual({ domain: "widgets:gates" });
  });

  test("two teams on the shared repo each get a bindings file, and the base gets none", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", {
      projects: ["acme/widgets"],
      teams: { widgets: { packs: { widgets: { extends: "acme-base" } } }, gadgets: { packs: { gadgets: { extends: "acme-base" } } } },
      base: { "acme-base": { base: true } },
    });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.map((p) => [p.pack, p.zone, p.ok])).toEqual([["gadgets", "acme/gadgets", true], ["widgets", "acme/widgets", true]]);
    expect(existsSync(join(root, "repos", SLUG, "packs", "acme-base"))).toBe(false);
  });

  test("a missing base says the org has no base pack of that name", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { packs: { widgets: { extends: "acme-base" } } } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs[0]).toMatchObject({ ok: false, detail: `widgets extends acme-base, but the org has no base pack called acme-base` });
  });

  test("the plugin@marketplace form is refused", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { packs: { widgets: { extends: "acme-base@acme" } } } }, base: { "shared-base": { base: true } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs[0]).toMatchObject({ ok: false, detail: 'widgets extends "acme-base@acme", which is not a base pack name; name the folder under the org\'s packs, for example "extends": "shared-base"' });
  });

  test("a name that would climb out of the packs folder is refused before any path is built", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { packs: { widgets: { extends: "../teams" } } } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs[0]).toMatchObject({ ok: false, detail: 'widgets extends "../teams", which is not a base pack name; name the folder under the org\'s packs, for example "extends": "<base folder name>"' });
  });

  test("a folder that is not marked base is refused, and so is a base that extends", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", {
      projects: ["acme/widgets"],
      teams: { widgets: { packs: { widgets: { extends: "plain" } } }, gadgets: { packs: { gadgets: { extends: "deep" } } } },
      base: { plain: {}, deep: { base: true, extends: "deeper" } },
    });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    const byPack = Object.fromEntries(out.packs.map((p) => [p.pack, p.ok ? "" : p.detail]));
    expect(byPack.widgets).toBe("widgets extends plain, but the org's plain pack is not marked as a base pack");
    expect(byPack.gadgets).toBe("gadgets extends deep, which extends deeper; a base pack cannot extend another");
  });
});

describe("materializeRepo stale bindings files", () => {
  const packFile = (root: string, pack: string) => join(root, "repos", SLUG, "packs", pack, "skills.jsonc");

  const gadgetsFolder = (root: string) => teamFolder(root, "acme", "gadgets");

  function twoZones() {
    const world = makeWorld();
    org(world.root, "acme", { projects: ["acme/widgets"], teams: { widgets: { packs: { widgets: {} } }, gadgets: { packs: { gadgets: {} } } } });
    const deps = { fs: realFs, mattstackRoot: world.root, enginePackDir: world.engine };
    materializeRepo(deps, REMOTE);
    return { ...world, deps };
  }

  test("a pack removed from its team folder has its file set aside on the next run, replacing an older .stale", () => {
    const { root, deps } = twoZones();
    const gadgets = packFile(root, "gadgets");
    const before = readFileSync(gadgets, "utf8");
    write(`${gadgets}.stale`, "older");
    rmSync(join(gadgetsFolder(root), "packs", "gadgets"), { recursive: true });

    const out = materializeRepo(deps, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.pruned).toEqual([`${gadgets}.stale`]);
    expect(existsSync(gadgets)).toBe(false);
    expect(readFileSync(`${gadgets}.stale`, "utf8")).toBe(before);
    expect(existsSync(packFile(root, "widgets"))).toBe(true);
  });

  test("a file whose team folder is absent on this machine is left alone while another team still declares the repo", () => {
    const { root, deps } = twoZones();
    const gadgets = packFile(root, "gadgets");
    const before = readFileSync(gadgets, "utf8");
    rmSync(gadgetsFolder(root), { recursive: true });

    const out = materializeRepo(deps, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.map((p) => p.pack)).toEqual(["widgets"]);
    expect(out.pruned).toEqual([]);
    expect(readFileSync(gadgets, "utf8")).toBe(before);
  });

  test("a file whose team folder is no longer named like a team is left alone", () => {
    const { root, deps } = twoZones();
    renameSync(gadgetsFolder(root), teamFolder(root, "acme", "Gadgets2"));
    const out = materializeRepo(deps, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.pruned).toEqual([]);
    expect(existsSync(packFile(root, "gadgets"))).toBe(true);
  });

  test("a file whose team folder has no settings file (a partial pull) is left alone", () => {
    const { root, deps } = twoZones();
    rmSync(join(gadgetsFolder(root), "settings.team.jsonc"));
    const out = materializeRepo(deps, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.pruned).toEqual([]);
    expect(existsSync(packFile(root, "gadgets"))).toBe(true);
  });

  test("a file whose team folder's settings do not parse is left alone", () => {
    const { root, deps } = twoZones();
    write(join(gadgetsFolder(root), "settings.team.jsonc"), "{ nope");
    const out = materializeRepo(deps, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.pruned).toEqual([]);
    expect(existsSync(packFile(root, "gadgets"))).toBe(true);
  });

  test("a file with no zone line (written before zones were recorded) is left alone", () => {
    const { root, deps } = twoZones();
    const legacy = packFile(root, "gizmos");
    write(legacy, "// GENERATED by rt skills materialize\n// repo: gitlab.example.com/acme/widgets\n// pack: gizmos\n{}\n");
    const out = materializeRepo(deps, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.pruned).toEqual([]);
    expect(readFileSync(legacy, "utf8")).toContain("// pack: gizmos");
  });

  test("a pack whose team stopped claiming the repo is set aside while another team still claims it", () => {
    const { root, deps } = twoZones();
    write(join(gadgetsFolder(root), "settings.team.jsonc"), JSON.stringify({ "board.projects": [] }));
    const out = materializeRepo(deps, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.pruned).toEqual([`${packFile(root, "gadgets")}.stale`]);
    expect(existsSync(packFile(root, "widgets"))).toBe(true);
  });

  test("a rename that fails is a warning on the outcome, never a lost repo row", () => {
    const { root, deps } = twoZones();
    rmSync(join(gadgetsFolder(root), "packs", "gadgets"), { recursive: true });
    const gadgets = packFile(root, "gadgets");
    const fs: MaterializeFs = {
      ...realFs,
      rename: (from, to) => {
        if (to.endsWith(".stale")) throw new Error("EACCES: permission denied");
        realFs.rename(from, to);
      },
    };
    const out = materializeRepo({ ...deps, fs }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.map((p) => [p.pack, p.ok])).toEqual([["widgets", true]]);
    expect(out.pruned).toEqual([]);
    expect(out.pruneWarnings).toEqual([`could not set aside ${gadgets}: EACCES: permission denied`]);
    expect(existsSync(gadgets)).toBe(true);
  });

  test("a pack that turns into a base pack has its file set aside", () => {
    const { root, deps } = twoZones();
    write(join(gadgetsFolder(root), "packs", "gadgets", "pack", "skills.jsonc"), JSON.stringify({ base: true }));
    const out = materializeRepo(deps, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.pruned).toEqual([`${packFile(root, "gadgets")}.stale`]);
  });

  test("a pack that fails this run keeps its last good file", () => {
    const { root, deps } = twoZones();
    const gadgets = packFile(root, "gadgets");
    const before = readFileSync(gadgets, "utf8");
    write(join(gadgetsFolder(root), "packs", "gadgets", "pack", "skills.jsonc"), "{ nope");

    const out = materializeRepo(deps, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.find((p) => p.pack === "gadgets")!.ok).toBe(false);
    expect(out.pruned).toEqual([]);
    expect(readFileSync(gadgets, "utf8")).toBe(before);
    expect(existsSync(`${gadgets}.stale`)).toBe(false);
  });

  test("files this run wrote are never set aside", () => {
    const { root, deps } = twoZones();
    const out = materializeRepo(deps, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.pruned).toEqual([]);
    expect(readdirSync(join(root, "repos", SLUG, "packs")).sort()).toEqual(["gadgets", "widgets"]);
    expect(readdirSync(join(root, "repos", SLUG, "packs", "widgets"))).toEqual(["skills.jsonc"]);
  });

  test("a repo no team claims any more has its pack files left alone", () => {
    const { root, deps } = twoZones();
    const before = readFileSync(packFile(root, "widgets"), "utf8");
    write(join(root, "teams", "acme", "mattstack", "org", "settings.org.jsonc"), JSON.stringify({ "board.gitlabHost": "https://gitlab.example.com", "board.projects": [] }));
    const out = materializeRepo(deps, REMOTE);
    expect(out).toEqual({ kind: "undeclared", repo: "gitlab.example.com/acme/widgets" });
    expect(readFileSync(packFile(root, "widgets"), "utf8")).toBe(before);
    expect(existsSync(packFile(root, "gadgets"))).toBe(true);
    expect(existsSync(`${packFile(root, "widgets")}.stale`)).toBe(false);
  });
});

describe("stale bindings files (team-folder zones)", () => {
  const fileFor = (root: string, pack: string) => join(root, "repos", SLUG, "packs", pack, "skills.jsonc");
  const stale = (root: string, pack: string, zone: string) => write(fileFor(root, pack), `// zone: ${zone}\n{}`);

  function run(root: string, engine: string, fs: MaterializeFs = realFs) {
    const out = materializeRepo({ fs, mattstackRoot: root, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(`expected written, got ${out.kind}`);
    return out;
  }

  function snapshot(dir: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (d: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else out[p] = readFileSync(p, "utf8");
      }
    };
    walk(dir);
    return out;
  }

  test("the header records <org>/<team>", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { packs: { widgets: {} } } } });
    run(root, engine);
    expect(readFileSync(fileFor(root, "widgets"), "utf8")).toContain("// zone: acme/widgets");
  });

  test("a file whose team no longer claims this repo is set aside", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { packs: { widgets: {} } }, gadgets: { projects: ["acme/gadgets"], packs: { gadgets: {} } } } });
    stale(root, "gadgets", "acme/gadgets");
    expect(run(root, engine).pruned).toEqual([`${fileFor(root, "gadgets")}.stale`]);
  });

  test("a file whose team no longer has that pack is set aside", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { packs: { widgets: {} } }, gadgets: { packs: {} } } });
    stale(root, "gadgets", "acme/gadgets");
    expect(run(root, engine).pruned).toEqual([`${fileFor(root, "gadgets")}.stale`]);
  });

  test("a missing team folder, a team whose settings do not parse, and a missing org clone set nothing aside", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { packs: { widgets: {} } } } });
    write(join(teamFolder(root, "acme", "broken"), "settings.team.jsonc"), "{ not json");
    stale(root, "gone", "acme/gone");
    stale(root, "broken", "acme/broken");
    stale(root, "elsewhere", "other-org/elsewhere");
    expect(run(root, engine).pruned).toEqual([]);
    for (const pack of ["gone", "broken", "elsewhere"]) expect(existsSync(fileFor(root, pack))).toBe(true);
  });

  test("a file written before the org layout (its header names only the clone) is left alone", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { packs: { widgets: {} } } } });
    stale(root, "legacy", "acme");
    expect(run(root, engine).pruned).toEqual([]);
    expect(existsSync(fileFor(root, "legacy"))).toBe(true);
  });

  test("a folder that is not named like a pack is refused even when its header names a zone to sweep", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { packs: { widgets: {} } }, gadgets: { packs: {} } } });
    stale(root, "Not_A_Pack", "acme/gadgets");
    expect(run(root, engine).pruned).toEqual([]);
    expect(existsSync(fileFor(root, "Not_A_Pack"))).toBe(true);
  });

  test("a sweep renames one generated bindings file to a sibling .stale and touches nothing else", () => {
    const { root, engine } = makeWorld();
    org(root, "acme", { projects: ["acme/widgets"], teams: { widgets: { packs: { widgets: {} } }, gadgets: { packs: {} } } });
    stale(root, "gadgets", "acme/gadgets");
    const teamsBefore = snapshot(join(root, "teams"));
    const engineBefore = snapshot(engine);
    const moves: Array<[string, string]> = [];
    const fs: MaterializeFs = { ...realFs, rename: (from, to) => { moves.push([from, to]); realFs.rename(from, to); } };
    const out = run(root, engine, fs);
    expect(out.pruned).toEqual([`${fileFor(root, "gadgets")}.stale`]);
    expect(moves.filter(([, to]) => to.endsWith(".stale"))).toEqual([[fileFor(root, "gadgets"), `${fileFor(root, "gadgets")}.stale`]]);
    expect(snapshot(join(root, "teams"))).toEqual(teamsBefore);
    expect(snapshot(engine)).toEqual(engineBefore);
    expect(Object.keys(realFs)).not.toContain("remove");
  });
});
