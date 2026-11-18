import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createRealProbes } from "../../setup/probes.ts";
import { renderHuskPacks, renderTally } from "../render-packs.ts";
import { resolvePluginRootsFromDir } from "../sources.ts";
import { renderWorld, setPackVersion, writeFile } from "./render-world.ts";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function world() {
  const w = renderWorld(made, { husks: true });
  const gadgets = join(w.orgDir, "mattstack", "teams", "gadgets");
  writeFile(join(gadgets, "settings.team.jsonc"), "{}");
  cpSync(w.packDir, join(gadgets, "plugin"), { recursive: true });
  writeFile(join(gadgets, "plugin", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "gadgets", version: "2.0.0" }));
  writeFile(join(gadgets, "plugin", "pack", "skills.jsonc"), "{}");
  const p = { ...createRealProbes(), home: w.home };
  const roots = async () => resolvePluginRootsFromDir(w.mattstackDir);
  return { ...w, p, roots };
}

const registry = (installPath: string) => JSON.stringify({ version: 2, plugins: { "mattstack@mattstack": [{ scope: "user", installPath, version: "1.0.0" }] } });

describe("renderHuskPacks", () => {
  test("pull-time renders of newer versions keep the tree of a version the plugin cache still holds", async () => {
    const w = world();
    for (const v of ["0.0.9", "0.1.0", "0.1.1", "0.1.2", "0.1.3"]) {
      setPackVersion(w.packDir, v);
      await renderHuskPacks(w.p, { org: "acme", roots: w.roots });
    }
    expect(readdirSync(join(w.root, "acme", "acme")).sort()).toEqual(["0.1.0", "0.1.1", "0.1.2", "0.1.3"]);
    expect(existsSync(join(w.root, "acme", "acme", "0.1.0", "1.0.0", "render.json"))).toBe(true);
  });

  test("renders only husk packs", async () => {
    const w = world();
    const results = await renderHuskPacks(w.p, { roots: w.roots });
    expect(results).toEqual([{ pack: "widgets", ok: true, detail: "rendered acme 0.1.0 for mattstack 1.0.0" }]);
    expect(existsSync(join(w.root, "acme", "acme", "0.1.0", "1.0.0", "skills", "work", "SKILL.md"))).toBe(true);
    expect(readdirSync(join(w.root, "acme"))).toEqual(["acme"]);
  });

  test("an unchanged pack costs one hash and no render", async () => {
    const w = world();
    await renderHuskPacks(w.p, { roots: w.roots });
    expect(await renderHuskPacks(w.p, { roots: w.roots })).toEqual([{ pack: "widgets", ok: true, detail: "acme 0.1.0 is up to date" }]);
  });

  test("a failure is reported, never thrown", async () => {
    const w = world();
    writeFile(join(w.packDir, "pack", "skills.jsonc"), JSON.stringify({ husks: true, bindings: { "mattstack:stage-plan": { rules: "acme:nope" } } }));
    const results = await renderHuskPacks(w.p, { roots: w.roots });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ pack: "widgets", ok: false });
    expect(results[0]!.detail).toContain("cannot be filled");
  });

  test("an org the Mac has no clone of renders nothing", async () => {
    const w = world();
    expect(await renderHuskPacks(w.p, { org: "other", roots: w.roots })).toEqual([]);
  });

  test("a missing mattstack is reported for each husk pack", async () => {
    const w = world();
    writeFile(join(w.home, ".claude", "plugins", "installed_plugins.json"), registry(join(w.home, "nowhere")));
    expect(await renderHuskPacks(w.p, { roots: w.roots })).toEqual([{ pack: "widgets", ok: false, detail: "mattstack isn't installed on this Mac" }]);
  });

  test("the plugin list is the caller's, and a listing that fails is reported for each husk pack", async () => {
    const w = world();
    const results = await renderHuskPacks(w.p, { roots: async () => { throw new Error("claude plugin list did not answer within 60 s"); } });
    expect(results).toEqual([{ pack: "widgets", ok: false, detail: "Claude Code's plugin list could not be read: claude plugin list did not answer within 60 s" }]);
  });

  test("the mattstack the registry names is the one rendered with, whatever the listing says", async () => {
    const w = world();
    const stale = join(w.home, "stale", "plugins", "mattstack");
    cpSync(join(w.mattstackDir, "plugins", "mattstack"), stale, { recursive: true });
    writeFile(join(stale, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "mattstack", version: "0.9.0" }));
    const roots = async () => resolvePluginRootsFromDir(join(w.home, "stale"));
    expect(await renderHuskPacks(w.p, { roots })).toEqual([{ pack: "widgets", ok: true, detail: "rendered acme 0.1.0 for mattstack 1.0.0" }]);
  });

  test("an org clone that cannot be read is reported, never thrown", async () => {
    const w = world();
    writeFile(join(w.orgDir, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "org", org: "acme", layout: 999 }));
    const results = await renderHuskPacks(w.p, { roots: w.roots });
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(false);
  });
});

describe("renderTally", () => {
  test("says nothing when no pack opts into husks", () => {
    expect(renderTally([])).toBe("");
  });

  test("counts ready packs and names each failure", () => {
    expect(renderTally([
      { pack: "widgets", ok: true, detail: "rendered" },
      { pack: "gadgets", ok: false, detail: "no mattstack" },
    ])).toBe(". 1 husk pack ready; gadgets did not render: no mattstack");
  });
});
