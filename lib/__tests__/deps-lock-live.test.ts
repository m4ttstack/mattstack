import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseDepsLock } from "../bundle-layout.ts";

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
