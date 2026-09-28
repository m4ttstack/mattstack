import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { parseDepsLock } from "../bundle-layout.ts";
import { stripFrontmatter } from "../skills/sources.ts";

const lock = parseDepsLock(
  readFileSync(join(import.meta.dir, "..", "..", "rt-tray", "deps.lock"), "utf8"),
);

describe("live deps.lock buildable set", () => {
  test("the apps-monorepo rows, gitq included, are built from this checkout instead of pinned to a repo", () => {
    const wantTree: Record<string, { skills?: boolean }> = {
      deck: { skills: true },
      board: { skills: true },
      gitq: { skills: true },
      console: {},
      chat: {},
      boxscore: {},
    };
    for (const [name, w] of Object.entries(wantTree)) {
      const row = lock.tools.find((t) => t.name === name);
      expect(row, name).toBeDefined();
      expect(row!.source, name).toBe("tree");
      expect(row!.repo, name).toBeUndefined();
      expect(row!.subdir, name).toBeUndefined();
      expect(row!.skills, name).toBe(w.skills);
    }
  });

  test("no row carries a repo field, now that gitq folded into the tree rows above", () => {
    expect(lock.tools.filter((t) => t.repo)).toEqual([]);
  });

  test("third-party pins carry no repo", () => {
    for (const name of ["jq", "node", "bun", "cloudflared", "sparkle"]) {
      expect(lock.tools.find((t) => t.name === name)?.repo, name).toBeUndefined();
    }
  });

  test("portless is pinned and the helper row is first-party (absent)", () => {
    const portless = lock.tools.find((t) => t.name === "portless");
    expect(portless?.status).toBe("bundled");
    expect(portless?.url).toMatch(/^https:\/\/registry\.npmjs\.org\/portless\/-\/portless-\d+\.\d+\.\d+\.tgz$/);
    expect(portless?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(portless?.bundlePath).toBe("Contents/Helpers/portless-dist");
    expect(portless?.exec).toEqual(["Contents/Helpers/node/bin/node", "Contents/Helpers/portless-dist/dist/cli.js"]);
    expect(lock.tools.find((t) => t.name === "mattstack-proxy-install")).toBeUndefined();
  });
});

const APPS = join(import.meta.dir, "..", "..", "apps");

function dottedDirs(root: string): string[] {
  const hits: string[] = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const path = join(root, e.name);
    if (e.name.includes(".")) hits.push(path);
    hits.push(...dottedDirs(path));
  }
  return hits;
}

// build.sh lands <name>-skills at Contents/Helpers/skills/<name>/ and
// check-bundle.sh fails the release on a skill dir with no SKILL.md or any
// dotted dir; linkBundledSkills links each skill under its frontmatter name.
describe("live deps.lock skills rows", () => {
  const rows = lock.tools.filter((t) => t.skills);

  test("deck, board and gitq ship skills", () => {
    expect(rows.map((r) => r.name).sort()).toEqual(["board", "deck", "gitq"]);
  });

  for (const row of rows) {
    test(`${row.name}: every skill dir is bundle-safe and named ${row.name}:<dir>`, () => {
      const root = join(APPS, row.name, "skills");
      expect(existsSync(root), root).toBe(true);
      const dirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
      expect(dirs.length, root).toBeGreaterThan(0);
      for (const dir of dirs) {
        const skillMd = join(root, dir, "SKILL.md");
        expect(existsSync(skillMd), skillMd).toBe(true);
        expect(stripFrontmatter(readFileSync(skillMd, "utf8")).frontmatter.name, skillMd).toBe(`${row.name}:${dir}`);
      }
      expect(dottedDirs(root)).toEqual([]);
    });
  }
});
