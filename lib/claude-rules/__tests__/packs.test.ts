import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createRealProbes, type Probes } from "../../setup/probes.ts";
import { claudeRulesDir } from "../paths.ts";
import { memberPackSources, readPackRules, writePackEntry, type PackRulesSource } from "../packs.ts";
import { cloneDirOf, makeOrg, writeInClone } from "./org-fixture.ts";

let home: string;
let p: Probes;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "claude-rules-packs-")));
  p = { ...createRealProbes(), home, env: { HOME: home } };
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("memberPackSources", () => {
  test("lists every base pack and the active team, not another team in the clone", () => {
    makeOrg(home);
    const clone = cloneDirOf(home);
    expect(memberPackSources(p)).toEqual([
      { entry: "acme-base", cloneDir: clone, ref: "mattstack", repoPath: "mattstack/org/packs/base/rules" },
      { entry: "acme-widgets", cloneDir: clone, ref: "mattstack", repoPath: "mattstack/teams/widgets/plugin/rules" },
    ]);
  });

  test("no org on this Mac lists nothing", () => {
    expect(memberPackSources(p)).toEqual([]);
  });
});

describe("readPackRules", () => {
  test("returns committed .md files and skips anything else", async () => {
    makeOrg(home);
    const src = memberPackSources(p).find((s) => s.entry === "acme-widgets")!;
    const files = await readPackRules(p, src);
    expect(files).toEqual(new Map([["widgets.md", "# Widgets rule\n"]]));
  });

  test("a rules folder only in the working tree is not read", async () => {
    makeOrg(home);
    writeInClone(home, "mattstack/org/packs/fresh/rules/draft.md", "# Unpublished\n");
    const src: PackRulesSource = { entry: "acme-fresh", cloneDir: cloneDirOf(home), ref: "mattstack", repoPath: "mattstack/org/packs/fresh/rules" };
    expect(await readPackRules(p, src)).toBeNull();
  });

  test("a working-tree edit to a published rule reads as published", async () => {
    makeOrg(home);
    writeInClone(home, "mattstack/teams/widgets/plugin/rules/widgets.md", "# Edited, not published\n");
    const src = memberPackSources(p).find((s) => s.entry === "acme-widgets")!;
    expect((await readPackRules(p, src))?.get("widgets.md")).toBe("# Widgets rule\n");
  });
});

describe("writePackEntry", () => {
  test("writes, then reports ok for the same files", () => {
    const dir = claudeRulesDir(home);
    const files = new Map([["a.md", "A"], ["b.md", "B"]]);
    expect(writePackEntry(p, dir, "acme-widgets", files)).toBe("written");
    expect(readFileSync(join(dir, "acme-widgets", "a.md"), "utf8")).toBe("A");
    expect(writePackEntry(p, dir, "acme-widgets", files)).toBe("ok");
  });

  test("a changed file rewrites and a dropped file is gone", () => {
    const dir = claudeRulesDir(home);
    writePackEntry(p, dir, "acme-widgets", new Map([["a.md", "A"], ["b.md", "B"]]));
    expect(writePackEntry(p, dir, "acme-widgets", new Map([["a.md", "A2"]]))).toBe("written");
    expect(readdirSync(join(dir, "acme-widgets"))).toEqual(["a.md"]);
    expect(readFileSync(join(dir, "acme-widgets", "a.md"), "utf8")).toBe("A2");
  });

  test("leaves no temp folder inside the rules folder", () => {
    const dir = claudeRulesDir(home);
    writePackEntry(p, dir, "acme-widgets", new Map([["a.md", "A"]]));
    writePackEntry(p, dir, "acme-widgets", new Map([["a.md", "B"]]));
    expect(readdirSync(dir)).toEqual(["acme-widgets"]);
    expect(existsSync(join(dir, "acme-widgets", "a.md"))).toBe(true);
  });
});
