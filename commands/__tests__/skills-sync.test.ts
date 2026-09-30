import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { PackInfo } from "../../lib/skills/packs.ts";
import type { MaterializeSkillsResult } from "../../lib/setup/skills-materialize.ts";
import { deriveEngine, manifestTarget, syncMaterializeVerdict } from "../skills-sync.ts";

function pack(name: string): PackInfo {
  return { name, dir: `/fake/${name}`, layout: "flat", surfacePath: `/fake/${name}/surface.jsonc`, marketplace: "local" };
}

describe("deriveEngine", () => {
  test("uses the discovered mattstack pack as the engine", () => {
    const mattstack = pack("mattstack");
    const acme = pack("acme");
    const result = deriveEngine([acme, mattstack], acme);
    expect("engine" in result && result.engine).toBe(mattstack);
  });

  test("the mattstack pack is its own engine", () => {
    const mattstack = pack("mattstack");
    const result = deriveEngine([mattstack], mattstack);
    expect("engine" in result && result.engine).toBe(mattstack);
  });

  test("with no directory-marketplace engine, reads the engine from its installed cache", () => {
    const cache = realpathSync(mkdtempSync(join(tmpdir(), "rt-sync-engine-cache-")));
    mkdirSync(join(cache, ".claude-plugin"), { recursive: true });
    writeFileSync(join(cache, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "mattstack", version: "0.28.9" }));
    writeFileSync(join(cache, "surface.jsonc"), `{ "public": [] }\n`);
    const acme = pack("acme");

    const result = deriveEngine([acme], acme, [
      { id: "superpowers@claude-plugins-official", installPath: "/nowhere" },
      { id: "mattstack@mattstack", installPath: cache },
    ]);

    expect("engine" in result).toBe(true);
    if ("engine" in result) {
      expect(result.engine).toMatchObject({ name: "mattstack", dir: cache, marketplace: "mattstack", installedCache: true });
    }
  });

  test("picks the installed engine the way compile does (last entry wins) and skips a disabled one", () => {
    const cacheAt = (version: string) => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-sync-engine-cache-")));
      mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
      writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "mattstack", version }));
      writeFileSync(join(dir, "surface.jsonc"), `{ "public": [] }\n`);
      return dir;
    };
    const userScope = cacheAt("0.28.8");
    const projectScope = cacheAt("0.28.9");
    const disabled = cacheAt("0.29.0");
    const acme = pack("acme");

    const result = deriveEngine([acme], acme, [
      { id: "mattstack@mattstack", installPath: userScope, enabled: true, scope: "user" },
      { id: "mattstack@mirror", installPath: projectScope, enabled: true, scope: "project" },
      { id: "mattstack@other", installPath: disabled, enabled: false, scope: "local" },
    ]);

    expect("engine" in result && result.engine).toMatchObject({ dir: projectScope, marketplace: "mirror", installedCache: true, scope: "project" });
  });

  test("a directory-marketplace engine wins over the installed cache", () => {
    const mattstack = pack("mattstack");
    const acme = pack("acme");
    const result = deriveEngine([acme, mattstack], acme, [{ id: "mattstack@mattstack", installPath: "/elsewhere" }]);
    expect("engine" in result && result.engine).toBe(mattstack);
  });

  test("refuses naming the pack and the marketplace registration when no mattstack pack is discovered", () => {
    const acme = pack("acme");
    const result = deriveEngine([acme], acme, [{ id: "mattstack@mattstack", installPath: "/gone" }]);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain('"acme"');
      expect(result.error).toContain("mattstack");
      expect(result.error).toContain("extraKnownMarketplaces");
    }
  });
});

describe("manifestTarget", () => {
  test("carries --manifest and --repo to the compile and check calls", () => {
    expect(manifestTarget(["--pack", "acme", "--repo", "gitlab.example.com/acme/widgets", "--manifest", "/tmp/skills.jsonc"]))
      .toEqual({ manifest: "/tmp/skills.jsonc", repo: "gitlab.example.com/acme/widgets" });
  });

  test("omits what was not passed", () => {
    expect(manifestTarget(["--pack", "acme", "--json"])).toEqual({});
  });
});

describe("syncMaterializeVerdict", () => {
  const result = (repos: Extract<MaterializeSkillsResult, { skipped: false }>["repos"]): MaterializeSkillsResult => ({ skipped: false, repos });
  const written = (pack: string) => ({ pack, zone: "acme", ok: true as const, path: `/h/${pack}/skills.jsonc`, layers: ["pack"] });
  const broken = (pack: string, detail: string) => ({ pack, zone: "acme-gadgets", ok: false as const, detail });

  test("a sibling pack's failure is a note, not a failure", () => {
    const r = result([{ name: "repo-a", path: "/r/a", ok: false, detail: "", packs: [written("widgets"), broken("gadgets", "gadgets extends acme-base@acme, which is not installed")] }]);
    const verdict = syncMaterializeVerdict(r, "widgets");
    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toContain("gadgets (repo-a)");
  });

  test("this pack's own failure fails, naming the pack and repo", () => {
    const r = result([{ name: "repo-a", path: "/r/a", ok: false, detail: "", packs: [written("widgets"), broken("gadgets", "gadgets extends acme-base@acme, which is not installed")] }]);
    expect(syncMaterializeVerdict(r, "gadgets")).toEqual({ ok: false, detail: "gadgets (repo-a): gadgets extends acme-base@acme, which is not installed" });
  });

  test("a repo-level error with no packs fails; no-remote and undeclared rows do not", () => {
    const r = result([
      { name: "repo-a", path: "/r/a", ok: false, detail: "EACCES: permission denied" },
      { name: "repo-b", path: "/r/b", ok: false, noManifest: true, detail: "no remote in /r/b" },
    ]);
    expect(syncMaterializeVerdict(r, "widgets")).toEqual({ ok: false, detail: "repo-a: EACCES: permission denied" });
    expect(syncMaterializeVerdict(result([r.repos[1]!]), "widgets").ok).toBe(true);
  });

  test("a skipped run is not a failure", () => {
    expect(syncMaterializeVerdict({ skipped: true, reason: "engine-pack-missing", repos: [] }, "widgets")).toEqual({ ok: true, detail: "skipped: engine-pack-missing" });
  });
});
