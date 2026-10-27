import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { approvedBranches, currentBranchSync } from "../approved-branch.ts";
import { ORG_MARKER_REL } from "../org-marker.ts";
import { teamLocalPath } from "../team-local.ts";

const HOME = "/h";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function cloneDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rt-approved-branch-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".git"));
  return dir;
}

function pWith(dir: string, marker: Record<string, unknown> | null, local: Record<string, unknown> = {}) {
  return fakeProbes({
    home: HOME,
    files: {
      ...(marker ? { [join(dir, ORG_MARKER_REL)]: JSON.stringify({ role: "org", org: "acme", layout: 4, ...marker }) } : {}),
      [teamLocalPath(HOME, "acme")]: JSON.stringify(local),
    },
  });
}

describe("approvedBranches", () => {
  test("the data branch and a recorded trial are approved", () => {
    const dir = cloneDir();
    expect(approvedBranches(pWith(dir, { dataBranch: "mattstack" }, { trialBranch: "mattstack-layout-5" }), "acme", dir)).toEqual(["mattstack", "mattstack-layout-5"]);
  });
  test("a pre-layout-4 clone approves main", () => {
    const dir = cloneDir();
    expect(approvedBranches(pWith(dir, { layout: 3 }), "acme", dir)).toEqual(["main"]);
  });
  test("a clone with no readable marker approves main", () => {
    const dir = cloneDir();
    expect(approvedBranches(pWith(dir, null), "acme", dir)).toEqual(["main"]);
  });
  test("a trial branch equal to the recorded data branch is listed once", () => {
    const dir = cloneDir();
    expect(approvedBranches(pWith(dir, { dataBranch: "mattstack" }, { trialBranch: "mattstack", dataBranch: "mattstack" }), "acme", dir)).toEqual(["mattstack"]);
  });
  test("a script-made trial whose marker names itself is not read as the data branch", () => {
    const dir = cloneDir();
    expect(approvedBranches(pWith(dir, { dataBranch: "mattstack-trial" }, { trialBranch: "mattstack-trial" }), "acme", dir)).toEqual(["main", "mattstack-trial"]);
    expect(approvedBranches(pWith(dir, { dataBranch: "mattstack-trial" }, { trialBranch: "mattstack-trial", dataBranch: "mattstack" }), "acme", dir)).toEqual(["mattstack", "mattstack-trial"]);
  });
  test("a trial branch on a pre-layout-4 clone sits beside main", () => {
    const dir = cloneDir();
    expect(approvedBranches(pWith(dir, { layout: 3 }, { trialBranch: "try" }), "acme", dir)).toEqual(["main", "try"]);
  });
});

describe("currentBranchSync", () => {
  test("reads HEAD and is null when detached", () => {
    const dir = cloneDir();
    writeFileSync(join(dir, ".git/HEAD"), "ref: refs/heads/mattstack\n");
    expect(currentBranchSync(dir)).toBe("mattstack");
    writeFileSync(join(dir, ".git/HEAD"), "0123abcd\n");
    expect(currentBranchSync(dir)).toBeNull();
  });
  test("keeps slashes in a branch name", () => {
    const dir = cloneDir();
    writeFileSync(join(dir, ".git/HEAD"), "ref: refs/heads/trial/one\n");
    expect(currentBranchSync(dir)).toBe("trial/one");
  });
  test("is null with no .git/HEAD", () => {
    expect(currentBranchSync(cloneDir())).toBeNull();
  });
});
