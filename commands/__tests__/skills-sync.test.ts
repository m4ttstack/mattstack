import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { PackInfo } from "../../lib/skills/packs.ts";
import { deriveEngine } from "../skills-sync.ts";

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
