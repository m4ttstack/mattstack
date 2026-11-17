import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createRealProbes } from "../../setup/probes.ts";
import { renderHuskPacks, renderTally } from "../render-packs.ts";
import { renderWorld, writeFile } from "./render-world.ts";

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
  return { ...w, p };
}

describe("renderHuskPacks", () => {
  test("renders only husk packs", async () => {
    const w = world();
    const results = await renderHuskPacks(w.p, { mattstackDir: w.mattstackDir });
    expect(results).toEqual([{ pack: "widgets", ok: true, detail: "rendered acme 0.1.0 for mattstack 1.0.0" }]);
    expect(existsSync(join(w.root, "acme", "acme", "0.1.0", "1.0.0", "skills", "work", "SKILL.md"))).toBe(true);
    expect(readdirSync(join(w.root, "acme"))).toEqual(["acme"]);
  });

  test("an unchanged pack costs one hash and no render", async () => {
    const w = world();
    await renderHuskPacks(w.p, { mattstackDir: w.mattstackDir });
    expect(await renderHuskPacks(w.p, { mattstackDir: w.mattstackDir })).toEqual([{ pack: "widgets", ok: true, detail: "acme 0.1.0 is up to date" }]);
  });

  test("a failure is reported, never thrown", async () => {
    const w = world();
    writeFile(join(w.packDir, "pack", "skills.jsonc"), JSON.stringify({ husks: true, bindings: { "mattstack:stage-plan": { rules: "acme:nope" } } }));
    const results = await renderHuskPacks(w.p, { mattstackDir: w.mattstackDir });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ pack: "widgets", ok: false });
    expect(results[0]!.detail).toContain("cannot be filled");
  });

  test("an org the Mac has no clone of renders nothing", async () => {
    const w = world();
    expect(await renderHuskPacks(w.p, { org: "other", mattstackDir: w.mattstackDir })).toEqual([]);
  });

  test("a missing mattstack is reported for each husk pack", async () => {
    const w = world();
    expect(await renderHuskPacks(w.p, { mattstackDir: join(w.home, "nowhere") })).toEqual([{ pack: "widgets", ok: false, detail: "mattstack isn't installed on this Mac" }]);
  });

  test("an org clone that cannot be read is reported, never thrown", async () => {
    const w = world();
    writeFile(join(w.orgDir, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "org", org: "acme", layout: 999 }));
    const results = await renderHuskPacks(w.p, { mattstackDir: w.mattstackDir });
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
