import { describe, expect, test } from "bun:test";

import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { dataBranchOf, knownDataBranch, orgBranch } from "../org-branch.ts";
import { ORG_MARKER_REL, POINTER_REL } from "../org-marker.ts";

const DIR = "/home/x/.mattstack/orgs/acme";

describe("orgBranch", () => {
  test("is the branch the org clone has checked out", async () => {
    const p = fakeProbes({ exec: (argv) => (argv.includes("symbolic-ref") ? { code: 0, stdout: "org-trial\n", stderr: "" } : { code: 1, stdout: "", stderr: "" }) });
    expect(await orgBranch(p, DIR)).toBe("org-trial");
    expect(p.calls.exec).toEqual([["git", "symbolic-ref", "-q", "--short", "HEAD"]]);
  });

  test("refuses a clone with no branch checked out, naming the switch back", async () => {
    const p = fakeProbes({ exec: () => ({ code: 1, stdout: "", stderr: "" }) });
    await expect(orgBranch(p, DIR)).rejects.toMatchObject({
      code: "org-detached",
      message: "Your copy of the org has no branch checked out",
      next: `git -C ${DIR} switch main`,
    });
  });

  const detached = (files: Record<string, string>) => fakeProbes({ home: "/home/x", files, exec: () => ({ code: 1, stdout: "", stderr: "" }) });
  const marker = '{"role":"org","org":"acme","layout":4,"dataBranch":"mattstack"}';

  test("a detached copy's fix names the data branch the team record holds", async () => {
    const p = detached({ "/home/x/.mattstack/rt/teams/acme.json": JSON.stringify({ dataBranch: "orgdata" }), [`${DIR}/${POINTER_REL}`]: marker });
    await expect(orgBranch(p, DIR)).rejects.toMatchObject({ next: `git -C ${DIR} switch orgdata` });
  });

  test("a detached copy's fix names the data branch the root pointer names", async () => {
    await expect(orgBranch(detached({ [`${DIR}/${POINTER_REL}`]: marker }), DIR)).rejects.toMatchObject({ next: `git -C ${DIR} switch mattstack` });
  });

  test("a detached copy's fix names the data branch the old folder pointer names", async () => {
    await expect(orgBranch(detached({ [`${DIR}/${ORG_MARKER_REL}`]: marker }), DIR)).rejects.toMatchObject({ next: `git -C ${DIR} switch mattstack` });
  });
});

describe("knownDataBranch", () => {
  const record = (rec: object) => ({ "/home/x/.mattstack/rt/teams/acme.json": JSON.stringify(rec) });
  const marker = (branch: string) => `{"role":"org","org":"acme","layout":4,"dataBranch":"${branch}"}`;

  test("reads the team record first, then the copy's own marker", () => {
    expect(knownDataBranch(fakeProbes({ home: "/home/x", files: { ...record({ dataBranch: "orgdata" }), [`${DIR}/${ORG_MARKER_REL}`]: marker("mattstack") } }), DIR)).toBe("orgdata");
    expect(knownDataBranch(fakeProbes({ home: "/home/x", files: { [`${DIR}/${ORG_MARKER_REL}`]: marker("mattstack") } }), DIR)).toBe("mattstack");
  });

  test("a marker naming this Mac's own trial branch is not the data branch", () => {
    expect(knownDataBranch(fakeProbes({ home: "/home/x", files: { ...record({ trialBranch: "try" }), [`${DIR}/${ORG_MARKER_REL}`]: marker("try") } }), DIR)).toBeNull();
  });

  test("null for an org whose data has no branch of its own", () => {
    expect(knownDataBranch(fakeProbes({ home: "/home/x", files: { [`${DIR}/${ORG_MARKER_REL}`]: '{"role":"org","org":"acme","layout":3}' } }), DIR)).toBeNull();
  });
});

test("dataBranchOf prefers the marker, else the checked-out branch", async () => {
  const p = { readFile: () => '{"role":"org","org":"acme","dataBranch":"mattstack"}', exec: async () => ({ code: 0, stdout: "main\n", stderr: "" }) };
  expect(await dataBranchOf(p as never, "/x")).toBe("mattstack");
  const q = { readFile: () => '{"role":"org","org":"acme"}', exec: async () => ({ code: 0, stdout: "trial\n", stderr: "" }) };
  expect(await dataBranchOf(q as never, "/x")).toBe("trial");
});

test("dataBranchOf ignores an invalid marker and uses the checked-out branch", async () => {
  const p = { readFile: () => '{"role":"org","org":"acme","dataBranch":"team//data"}', exec: async () => ({ code: 0, stdout: "trial\n", stderr: "" }) };
  expect(await dataBranchOf(p as never, "/x")).toBe("trial");
});
