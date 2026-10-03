import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { getSetting } from "../settings/resolve.ts";
import { setSetting } from "../settings/write.ts";
import { teamLocalPath } from "../team/team-local.ts";
import {
  loadVariations,
  saveVariation,
  variationKey,
  type Variation,
} from "../variations.ts";
import { seedOrg, sharedStorePath } from "../../packages/rt-client/test/org-fixture.ts";
import { readStore } from "../settings/stores.ts";

const IDENTITY = "gitlab.com/acme/test-repo";

/** saveVariation writes to team scope, which refuses without a local team store. */
function seedTeam(): void {
  const path = sharedStorePath("acme");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "// team store\n{}\n");
}

describe("variations", () => {
  describe("variationKey", () => {
    test("joins repo-relative package path and script with colon", () => {
      // packagePath is absolute; variationKey computes relative(repoRoot, packagePath)
      expect(variationKey("/repo", "/repo/pkg/a", "dev")).toBe(
        "pkg/a:dev",
      );
    });

    test("uses '.' for the root package (packagePath === repoRoot)", () => {
      expect(variationKey("/repo", "/repo", "build")).toBe(
        ".:build",
      );
    });
  });

  describe("over the settings resolver", () => {
    const origHome = process.env.HOME;
    let home: string;

    beforeEach(() => {
      home = realpathSync(mkdtempSync(join(tmpdir(), "rt-variations-test-")));
      process.env.HOME = home;
      seedTeam();
    });

    afterEach(() => {
      process.env.HOME = origHome;
      rmSync(home, { recursive: true, force: true });
    });

    describe("loadVariations", () => {
      test("returns empty object when nothing is declared", () => {
        expect(loadVariations(IDENTITY)).toEqual({});
      });

      test("returns empty object when no repo identity is available", () => {
        expect(loadVariations(null)).toEqual({});
      });

      test("an unexpandable ${repoRoot} in a stored value degrades to empty instead of throwing", () => {
        setSetting("rt.variations", { "pkg/a:dev": [{ name: "root", command: "${repoRoot}/dev" }] }, "org", { repoIdentity: IDENTITY });

        expect(() => loadVariations(IDENTITY)).not.toThrow();
        expect(loadVariations(IDENTITY)).toEqual({});
      });
    });

    describe("saveVariation + loadVariations roundtrip", () => {
      test("saves and loads a single variation, reporting ok:true", () => {
        const result = saveVariation(IDENTITY, "/repo", "/repo/pkg/a", "dev", {
          name: "debug",
          command: "DEBUG=1 pnpm run dev",
        });
        expect(result).toEqual({ ok: true });

        const all = loadVariations(IDENTITY);
        expect(all["pkg/a:dev"]).toEqual([
          { name: "debug", command: "DEBUG=1 pnpm run dev" },
        ]);
      });

      test("appends to existing variations for the same key", () => {
        saveVariation(IDENTITY, "/repo", "/repo/pkg/a", "dev", {
          name: "debug",
          command: "DEBUG=1 pnpm run dev",
        });
        saveVariation(IDENTITY, "/repo", "/repo/pkg/a", "dev", {
          name: "inspect",
          command: "pnpm run dev -- --inspect",
        });

        const all = loadVariations(IDENTITY);
        expect(all["pkg/a:dev"]).toHaveLength(2);
        expect(all["pkg/a:dev"]![1]!.name).toBe("inspect");
      });

      test("stores variations for different keys independently", () => {
        saveVariation(IDENTITY, "/repo", "/repo/pkg/a", "dev", {
          name: "debug",
          command: "DEBUG=1 pnpm run dev",
        });
        saveVariation(IDENTITY, "/repo", "/repo/pkg/b", "start", {
          name: "verbose",
          command: "VERBOSE=1 pnpm start",
        });

        const all = loadVariations(IDENTITY);
        expect(Object.keys(all)).toHaveLength(2);
      });

      test("saveVariation reports no-identity and is a no-op when no repo identity is available", () => {
        const result = saveVariation(null, "/repo", "/repo/pkg/a", "dev", {
          name: "debug",
          command: "DEBUG=1 pnpm run dev",
        });
        expect(result).toEqual({ ok: false, reason: "no-identity" });
        expect(loadVariations(null)).toEqual({});
      });

      test("a team folder's variation is never copied into the org store", () => {
        seedOrg({
          org: "acme",
          username: "dev1",
          roster: [{ username: "dev1", teams: ["widgets"] }],
          teams: { widgets: { repos: { [IDENTITY]: { "rt.variations": { "pkg/a:dev": [{ name: "team-only", command: "x" }] } } } } },
        });
        expect(loadVariations(IDENTITY)["pkg/a:dev"]).toEqual([{ name: "team-only", command: "x" }]);

        expect(saveVariation(IDENTITY, "/repo", "/repo/pkg/a", "dev", { name: "debug", command: "DEBUG=1 pnpm run dev" })).toEqual({ ok: true });

        expect(readStore(sharedStorePath("acme")).repos[IDENTITY]!["rt.variations"]).toEqual({
          "pkg/a:dev": [{ name: "debug", command: "DEBUG=1 pnpm run dev" }],
        });
      });

      test("lands in the org store (scope decision: org.repo)", () => {
        saveVariation(IDENTITY, "/repo", "/repo/pkg/a", "dev", {
          name: "debug",
          command: "DEBUG=1 pnpm run dev",
        });

        const explicit: Variation[] = getSetting<Record<string, Variation[]>>(
          "rt.variations",
          { repoIdentity: IDENTITY },
        ).value["pkg/a:dev"]!;
        expect(explicit).toEqual([{ name: "debug", command: "DEBUG=1 pnpm run dev" }]);
      });
    });
  });

  describe("saveVariation write-failed reporting", () => {
    const origHome = process.env.HOME;
    let home: string;

    beforeEach(() => {
      home = realpathSync(mkdtempSync(join(tmpdir(), "rt-variations-nofail-")));
      process.env.HOME = home;
      // deliberately no seedTeam() here — zero local team stores exist.
    });

    afterEach(() => {
      process.env.HOME = origHome;
      rmSync(home, { recursive: true, force: true });
    });

    test("surfaces the org-store refusal instead of silently dropping the save", () => {
      const result = saveVariation(IDENTITY, "/repo", "/repo/pkg/a", "dev", {
        name: "debug",
        command: "DEBUG=1 pnpm run dev",
      });
      expect(result.ok).toBe(false);
      if (!result.ok && result.reason === "write-failed") {
        expect(result.message).toContain("this Mac has no org yet");
      } else {
        throw new Error(`expected a write-failed refusal, got ${JSON.stringify(result)}`);
      }
      expect(loadVariations(IDENTITY)).toEqual({});
    });
  });

  describe("saveVariation on a joined (pull-only) clone", () => {
    const origHome = process.env.HOME;
    let home: string;

    beforeEach(() => {
      home = realpathSync(mkdtempSync(join(tmpdir(), "rt-variations-joined-")));
      process.env.HOME = home;
      seedTeam();
      const recordPath = teamLocalPath(home, "acme");
      mkdirSync(dirname(recordPath), { recursive: true });
      writeFileSync(
        recordPath,
        JSON.stringify({ createdByRt: false, joinedByRt: true, rtMayManageMembership: false }),
      );
    });

    afterEach(() => {
      process.env.HOME = origHome;
      rmSync(home, { recursive: true, force: true });
    });

    // lib/variations.ts:96 already wraps the write in try/catch: this proves
    // the existing degrade path, it does not add new behavior.
    test("degrades to a structured failure, never a crash", () => {
      const result = saveVariation(IDENTITY, "/repo", "/repo/pkg/a", "build", {
        name: "debug",
        command: "DEBUG=1 pnpm run build",
      });
      expect(result.ok).toBe(false);
      if (!result.ok && result.reason === "write-failed") {
        expect(result.message).toContain("pull-only");
      } else {
        throw new Error(`expected a write-failed refusal, got ${JSON.stringify(result)}`);
      }
    });
  });
});
