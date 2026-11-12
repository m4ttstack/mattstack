import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { installedProvenance, realGit, realOrgCloneFor, type OrgClone } from "../installed-provenance.ts";
import { homeWithOrgClone, installedSkill, moveToTrial, PACK_REL, seedOrgClone, tmp } from "./installed-fixtures.ts";

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
  test("names the sync commit that reached the installed version", () => {
    const { dir, sync11 } = orgClone();
    expect(installedProvenance(installedSkill("0.4.11"), depsFor(dir)).tokens).toContain(`acme=${sync11}`);
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
