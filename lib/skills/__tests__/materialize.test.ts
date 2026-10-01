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

function zone(root: string, slug: string, opts: { projects: string[]; packs: Record<string, object> }): void {
  const dir = join(root, "teams", slug);
  write(join(dir, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "team", namespace: slug }));
  write(join(dir, "mattstack", "team.jsonc"), JSON.stringify({ gitlabHost: "https://gitlab.example.com", projects: opts.projects }));
  for (const [name, fragment] of Object.entries(opts.packs)) {
    write(join(dir, "mattstack", "packs", name, "pack", "skills.jsonc"), JSON.stringify(fragment));
  }
}

function installBase(home: string, fragment: object): void {
  write(join(home, ".claude", "plugins", "cache", "acme", "acme-base", "1.0.0", "pack", "skills.jsonc"), JSON.stringify(fragment));
}

function body(path: string): { bindings: Record<string, Record<string, string>>; pipelines: Record<string, string[]>; skills: { enabled: string[] } } {
  return JSON.parse(readFileSync(path, "utf8").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n"));
}

describe("materializeRepo", () => {
  test("no remote -> no-remote", () => {
    const { root, engine, home } = makeWorld();
    expect(materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, null)).toEqual({ kind: "no-remote" });
  });

  test("no zone declares the repo -> undeclared", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme", { projects: ["acme/other"], packs: { widgets: {} } });
    expect(materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE)).toEqual({ kind: "undeclared", repo: "gitlab.example.com/acme/widgets" });
  });

  test("two zones on one repo each get their own pack file with their own stage-gates fill", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme-w", { projects: ["acme/widgets"], packs: { widgets: { bindings: { "mattstack:stage-gates": { domain: "widgets:gates" } } } } });
    zone(root, "acme-g", { projects: ["acme/widgets"], packs: { gadgets: { bindings: { "mattstack:stage-gates": { domain: "gadgets:gates" } } } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    expect(out.kind).toBe("written");
    if (out.kind !== "written") return;
    expect(out.slug).toBe(SLUG);
    expect(out.packs.map((p) => [p.pack, p.ok])).toEqual([["gadgets", true], ["widgets", true]]);
    expect(body(join(root, "repos", SLUG, "packs", "widgets", "skills.jsonc")).bindings["mattstack:stage-gates"]!.domain).toBe("widgets:gates");
    expect(body(join(root, "repos", SLUG, "packs", "gadgets", "skills.jsonc")).bindings["mattstack:stage-gates"]!.domain).toBe("gadgets:gates");
  });

  test("layers: defaults, then base, then pack, then overrides, with provenance per layer", () => {
    const { root, engine, home } = makeWorld();
    installBase(home, { bindings: { "mattstack:stage-gates": { domain: "acme-base:gates" }, "mattstack:watch-ci": { forge: "mattstack:gitlab-forge" }, "mattstack:stage-ship": { policy: "acme-base:squash" } } });
    zone(root, "acme", { projects: ["acme/widgets"], packs: { widgets: { extends: "acme-base@acme", bindings: { "mattstack:stage-gates": { domain: "widgets:gates" } } } } });
    write(join(root, "user", "skills", "overrides.jsonc"), JSON.stringify({ bindings: { "mattstack:watch-ci": { forge: "me:forge" } } }));
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
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
    const { root, engine, home } = makeWorld();
    zone(root, "acme-w", { projects: ["acme/widgets"], packs: { widgets: {} } });
    zone(root, "acme-g", { projects: ["acme/widgets"], packs: { gadgets: { extends: "acme-base@acme" } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    const gadgets = out.packs.find((p) => p.pack === "gadgets")!;
    expect(gadgets.ok).toBe(false);
    if (!gadgets.ok) expect(gadgets.detail).toBe("gadgets extends acme-base@acme, which is not installed; add it to the team's claude.plugins");
    expect(existsSync(join(root, "repos", SLUG, "packs", "widgets", "skills.jsonc"))).toBe(true);
    expect(existsSync(join(root, "repos", SLUG, "packs", "gadgets", "skills.jsonc"))).toBe(false);
  });

  test("a type-invalid fragment fails only its own pack", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme-w", { projects: ["acme/widgets"], packs: { widgets: { bindings: { "mattstack:stage-gates": { domain: "widgets:gates" } } } } });
    zone(root, "acme-g", { projects: ["acme/widgets"], packs: { gadgets: { bindings: { "mattstack:stage-gates": null } } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    const gadgets = out.packs.find((p) => p.pack === "gadgets")!;
    expect(gadgets.ok).toBe(false);
    if (!gadgets.ok) expect(gadgets.detail).toContain(join(root, "teams", "acme-g", "mattstack", "packs", "gadgets", "pack", "skills.jsonc"));
    expect(out.packs.find((p) => p.pack === "widgets")!.ok).toBe(true);
    expect(body(join(root, "repos", SLUG, "packs", "widgets", "skills.jsonc")).bindings["mattstack:stage-gates"]!.domain).toBe("widgets:gates");
  });

  test("a base that itself extends is refused", () => {
    const { root, engine, home } = makeWorld();
    installBase(home, { extends: "deeper@acme" });
    zone(root, "acme", { projects: ["acme/widgets"], packs: { widgets: { extends: "acme-base@acme" } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs[0]).toMatchObject({ ok: false, detail: "widgets extends acme-base@acme, which extends deeper@acme; a base pack cannot extend another" });
  });

  test("two packs in one zone that claims the repo are both refused", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme", { projects: ["acme/widgets"], packs: { widgets: {}, gadgets: {} } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.every((p) => !p.ok)).toBe(true);
    if (!out.packs[0]!.ok) expect(out.packs[0]!.detail).toContain('zone "acme" holds 2 packs (gadgets, widgets) that all claim gitlab.example.com/acme/widgets');
  });

  test("a zone that declares no projects holds the base pack without claiming anything", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme-base-zone", { projects: [], packs: { "acme-base": {} } });
    zone(root, "acme", { projects: ["acme/widgets"], packs: { widgets: {} } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.map((p) => p.pack)).toEqual(["widgets"]);
  });

  test("an invalid pack fragment is a per-pack error naming the file", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme", { projects: ["acme/widgets"], packs: {} });
    write(join(root, "teams", "acme", "mattstack", "packs", "widgets", "pack", "skills.jsonc"), "{ nope");
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs[0]).toMatchObject({ ok: false });
    if (!out.packs[0]!.ok) expect(out.packs[0]!.detail).toContain("widgets/pack/skills.jsonc");
  });

  test("a base pack beside a claiming pack in one zone claims nothing and gets no file", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme", { projects: ["acme/widgets"], packs: { widgets: {}, "acme-base": { base: true } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.map((p) => [p.pack, p.ok])).toEqual([["widgets", true]]);
    expect(readdirSync(join(root, "repos", SLUG, "packs"))).toEqual(["widgets"]);
  });

  test("a base pack is not counted when two claiming packs share a zone", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme", { projects: ["acme/widgets"], packs: { widgets: {}, gadgets: {}, "acme-base": { base: true } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.map((p) => [p.pack, p.ok])).toEqual([["gadgets", false], ["widgets", false]]);
    if (!out.packs[0]!.ok) expect(out.packs[0]!.detail).toContain('zone "acme" holds 2 packs (gadgets, widgets) that all claim');
  });

  test("one base pack name in two declaring zones is not refused", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme-w", { projects: ["acme/widgets"], packs: { widgets: {}, "acme-base": { base: true } } });
    zone(root, "acme-g", { projects: ["acme/widgets"], packs: { gadgets: {}, "acme-base": { base: true } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.map((p) => [p.pack, p.ok])).toEqual([["gadgets", true], ["widgets", true]]);
  });

  test("a declaring zone holding only base packs writes nothing", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme", { projects: ["acme/widgets"], packs: { "acme-base": { base: true } } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    expect(out).toMatchObject({ kind: "written", packs: [] });
    expect(existsSync(join(root, "repos", SLUG, "packs"))).toBe(false);
  });

  test("a claiming pack extending the base beside it in its own zone merges the installed base layer", () => {
    const { root, engine, home } = makeWorld();
    const baseFragment = { base: true, bindings: { "mattstack:stage-ship": { policy: "acme-base:squash" } } };
    installBase(home, baseFragment);
    zone(root, "acme", { projects: ["acme/widgets"], packs: { widgets: { extends: "acme-base@acme" }, "acme-base": baseFragment } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.map((p) => p.pack)).toEqual(["widgets"]);
    const widgets = out.packs[0]!;
    if (!widgets.ok) throw new Error(widgets.detail);
    expect(widgets.layers).toEqual(["default", "base:acme-base", "pack"]);
    expect(body(widgets.path).bindings["mattstack:stage-ship"]!.policy).toBe("acme-base:squash");
  });

  test("one pack name in two declaring zones is refused in both", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme", { projects: ["acme/widgets"], packs: { widgets: {} } });
    zone(root, "beta", { projects: ["acme/widgets"], packs: { widgets: {} } });
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.map((p) => [p.pack, p.zone, p.ok])).toEqual([["widgets", "acme", false], ["widgets", "beta", false]]);
    for (const p of out.packs) {
      if (!p.ok) expect(p.detail).toContain('pack "widgets" is in 2 zones (acme, beta) that all claim gitlab.example.com/acme/widgets');
    }
    expect(existsSync(join(root, "repos", SLUG, "packs", "widgets", "skills.jsonc"))).toBe(false);
  });

  test("a declaring zone with no packs writes nothing", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme", { projects: ["acme/widgets"], packs: {} });
    write(join(root, "repos", SLUG, "skills.jsonc"), "{}");
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    expect(out).toEqual({ kind: "written", repo: "gitlab.example.com/acme/widgets", slug: SLUG, packs: [], migrated: null, pruned: [] });
    expect(existsSync(join(root, "repos", SLUG, "packs"))).toBe(false);
    expect(readFileSync(join(root, "repos", SLUG, "skills.jsonc"), "utf8")).toBe("{}");
  });

  test("the old merged file is renamed .migrated, never deleted", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme", { projects: ["acme/widgets"], packs: { widgets: {} } });
    write(join(root, "repos", SLUG, "skills.jsonc"), "{}");
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.migrated).toBe(join(root, "repos", SLUG, "skills.jsonc.migrated"));
    expect(existsSync(join(root, "repos", SLUG, "skills.jsonc"))).toBe(false);
    expect(readFileSync(join(root, "repos", SLUG, "skills.jsonc.migrated"), "utf8")).toBe("{}");
  });

  test("the old merged file stays in place when every pack failed", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme", { projects: ["acme/widgets"], packs: { widgets: { extends: "acme-base@acme" } } });
    write(join(root, "repos", SLUG, "skills.jsonc"), "{}");
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.every((p) => !p.ok)).toBe(true);
    expect(out.migrated).toBeNull();
    expect(readFileSync(join(root, "repos", SLUG, "skills.jsonc"), "utf8")).toBe("{}");
    expect(existsSync(join(root, "repos", SLUG, "skills.jsonc.migrated"))).toBe(false);
  });

  test("the file is rewritten in place on a second run (no stray tmp file)", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme", { projects: ["acme/widgets"], packs: { widgets: {} } });
    const deps = { fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine };
    materializeRepo(deps, REMOTE);
    materializeRepo(deps, REMOTE);
    expect(readdirSync(join(root, "repos", SLUG, "packs", "widgets"))).toEqual(["skills.jsonc"]);
  });

  test("an invalid overrides file fails every pack with the override path", () => {
    const { root, engine, home } = makeWorld();
    zone(root, "acme-w", { projects: ["acme/widgets"], packs: { widgets: {} } });
    zone(root, "acme-g", { projects: ["acme/widgets"], packs: { gadgets: {} } });
    write(join(root, "user", "skills", "overrides.jsonc"), "{ nope");
    const out = materializeRepo({ fs: realFs, mattstackRoot: root, claudeHome: home, enginePackDir: engine }, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.packs.map((p) => p.pack)).toEqual(["gadgets", "widgets"]);
    for (const p of out.packs) {
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.detail).toContain(join(root, "user", "skills", "overrides.jsonc"));
    }
    expect(existsSync(join(root, "repos", SLUG, "packs", "widgets", "skills.jsonc"))).toBe(false);
  });
});

describe("materializeRepo stale bindings files", () => {
  const packFile = (root: string, pack: string) => join(root, "repos", SLUG, "packs", pack, "skills.jsonc");

  function twoZones() {
    const world = makeWorld();
    zone(world.root, "acme-w", { projects: ["acme/widgets"], packs: { widgets: {} } });
    zone(world.root, "acme-g", { projects: ["acme/widgets"], packs: { gadgets: {} } });
    const deps = { fs: realFs, mattstackRoot: world.root, claudeHome: world.home, enginePackDir: world.engine };
    materializeRepo(deps, REMOTE);
    return { ...world, deps };
  }

  test("a pack removed from its zone has its file set aside on the next run, replacing an older .stale", () => {
    const { root, deps } = twoZones();
    const gadgets = packFile(root, "gadgets");
    const before = readFileSync(gadgets, "utf8");
    write(`${gadgets}.stale`, "older");
    rmSync(join(root, "teams", "acme-g", "mattstack", "packs", "gadgets"), { recursive: true });

    const out = materializeRepo(deps, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.pruned).toEqual([`${gadgets}.stale`]);
    expect(existsSync(gadgets)).toBe(false);
    expect(readFileSync(`${gadgets}.stale`, "utf8")).toBe(before);
    expect(existsSync(packFile(root, "widgets"))).toBe(true);
  });

  test("a pack that turns into a base pack has its file set aside", () => {
    const { root, deps } = twoZones();
    write(join(root, "teams", "acme-g", "mattstack", "packs", "gadgets", "pack", "skills.jsonc"), JSON.stringify({ base: true }));
    const out = materializeRepo(deps, REMOTE);
    if (out.kind !== "written") throw new Error(out.kind);
    expect(out.pruned).toEqual([`${packFile(root, "gadgets")}.stale`]);
  });

  test("a pack that fails this run keeps its last good file", () => {
    const { root, deps } = twoZones();
    const gadgets = packFile(root, "gadgets");
    const before = readFileSync(gadgets, "utf8");
    write(join(root, "teams", "acme-g", "mattstack", "packs", "gadgets", "pack", "skills.jsonc"), "{ nope");

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

  test("a repo no zone declares any more has its pack files left alone", () => {
    const { root, deps } = twoZones();
    const before = readFileSync(packFile(root, "widgets"), "utf8");
    for (const slug of ["acme-w", "acme-g"]) {
      write(join(root, "teams", slug, "mattstack", "team.jsonc"), JSON.stringify({ gitlabHost: "https://gitlab.example.com", projects: [] }));
    }
    const out = materializeRepo(deps, REMOTE);
    expect(out).toEqual({ kind: "undeclared", repo: "gitlab.example.com/acme/widgets" });
    expect(readFileSync(packFile(root, "widgets"), "utf8")).toBe(before);
    expect(existsSync(packFile(root, "gadgets"))).toBe(true);
    expect(existsSync(`${packFile(root, "widgets")}.stale`)).toBe(false);
  });
});
