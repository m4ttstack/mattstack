import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { dirname, join } from "path";
import { installedProvenance, realGit, realOrgCloneFor, type OrgClone } from "../installed-provenance.ts";
import { bumpAcme, homeWithOrgClone, installedSkill, moveToTrial, PACK_REL, put, seedOrgClone, tmp } from "./installed-fixtures.ts";

const readFile = (p: string): string | null => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};

const cloneAt = (clone: OrgClone | null) => (market: string, plugin: string): OrgClone | null =>
  market === "acme-plugins" && plugin === "acme" ? clone : null;

function orgClone(): { dir: string; sync11: string } {
  const dir = join(tmp("rt-installed-org-"), "acme");
  return { dir, ...seedOrgClone(dir) };
}

const depsFor = (dir: string | null) => ({ readFile, git: realGit, orgCloneFor: cloneAt(dir === null ? null : { dir, ref: "mattstack", packRel: PACK_REL }) });

describe("installedProvenance", () => {
  test("names the sync commit that reached the installed version, pack first", () => {
    const { dir, sync11 } = orgClone();
    expect(installedProvenance(installedSkill("0.4.11"), depsFor(dir)).tokens).toEqual([`acme=${sync11}`, "mattstack=0.32.56"]);
  });

  test("a version the data branch returned to names the newest run, the revert", () => {
    const { dir } = orgClone();
    const revert = bumpAcme(dir, "0.4.11");
    expect(installedProvenance(installedSkill("0.4.11"), depsFor(dir)).tokens).toContain(`acme=${revert}`);
  });

  test("the mattstack plugin records one mattstack token, the lock's when it has one", () => {
    const fromCheckout = installedSkill("0.32.56", { mattstack: "0.32.56", sha: "abc1234" }, undefined, "mattstack", "mattstack");
    expect(installedProvenance(fromCheckout, depsFor(null)).tokens).toEqual(["mattstack=abc1234"]);
    const unlocked = installedSkill("0.32.56", {}, undefined, "mattstack", "mattstack");
    rmSync(join(dirname(dirname(unlocked)), "pack", "compiled.lock.json"));
    expect(installedProvenance(unlocked, depsFor(null)).tokens).toEqual(["mattstack=0.32.56"]);
  });

  test("drops a token whose value is not a plain version or sha", () => {
    const skillDir = installedSkill("0.4.11");
    const packRoot = dirname(dirname(skillDir));
    put(join(packRoot, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme", version: "0.4.11,evil=1" }));
    put(join(packRoot, "pack", "compiled.lock.json"), JSON.stringify({
      targets: { "skills/work": { mattstack: "0.32.56" } },
      mattstackSha: { "skills/work": { not: "a sha" } },
    }));
    expect(installedProvenance(skillDir, depsFor(null)).tokens).toEqual(["mattstack=0.32.56"]);
  });

  test("reads the data branch while the clone is on a trial branch", () => {
    const { dir, sync11 } = orgClone();
    moveToTrial(dir, sync11);
    expect(installedProvenance(installedSkill("0.4.11"), depsFor(dir)).tokens).toContain(`acme=${sync11}`);
  });

  test("falls back to the version with no org clone", () => {
    expect(installedProvenance(installedSkill("0.4.11"), depsFor(null)).tokens).toContain("acme=0.4.11");
  });

  test("falls back to the version when the data branch never carried it", () => {
    const { dir } = orgClone();
    expect(installedProvenance(installedSkill("0.4.99"), depsFor(dir)).tokens).toContain("acme=0.4.99");
  });

  test("takes mattstack and its dirty bit from the lock", () => {
    const dev = installedProvenance(installedSkill("0.4.11", { mattstack: "0.32.56", sha: "abc1234", dirty: 1 }), depsFor(null));
    expect(dev.tokens).toContain("mattstack=abc1234");
    expect(dev.dirty).toBe(1);
    const plain = installedProvenance(installedSkill("0.4.11", { mattstack: "0.32.56" }), depsFor(null));
    expect(plain.tokens).toContain("mattstack=0.32.56");
    expect(plain.dirty).toBe(0);
  });
});

describe("realOrgCloneFor", () => {
  test("realOrgCloneFor matches the marketplace name", () => {
    const { home, clone } = homeWithOrgClone();
    const orgCloneFor = realOrgCloneFor(home);
    expect(orgCloneFor("acme-plugins", "acme")).toEqual({ dir: clone, ref: "mattstack", packRel: PACK_REL });
    expect(orgCloneFor("acme", "acme")).toBeNull();
  });

  test("a Mac with no org clones has none to offer", () => {
    expect(realOrgCloneFor(tmp("rt-installed-empty-home-"))("acme-plugins", "acme")).toBeNull();
  });
});
