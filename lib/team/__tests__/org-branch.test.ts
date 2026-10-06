import { describe, expect, test } from "bun:test";

import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { orgBranch } from "../org-branch.ts";

const DIR = "/home/x/.mattstack/teams/acme";

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
});
