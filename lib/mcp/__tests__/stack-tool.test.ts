import { describe, expect, test } from "bun:test";
import { stackToolDefs } from "../stack-tool.ts";
import type { TreeCheck } from "../tree-guard.ts";

const stacks = JSON.stringify({ stacks: [{ stackName: "cart", root: "main", nodes: [{ branch: "a", parent: "main" }, { branch: "b", parent: "a" }, { branch: "c", parent: "b" }] }] });
const tool = (branch: string | null, gitq: string | null, guard: TreeCheck = { ok: true, path: "/t", repoName: "r" }) =>
  stackToolDefs({ checkTree: () => guard, currentBranch: async () => branch, gitqStacks: async () => gitq })[0]!;

describe("branch_stack", () => {
  test("a stack member reports its parent, root and children", async () => {
    const res = await tool("b", stacks).handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
    expect(res.body).toEqual({ branch: "b", member: true, stack: "cart", parent: "a", root: "main", children: ["c"], stackStore: "read", tree: "/t" });
  });
  test("a branch in no stack is not a member", async () => {
    expect((await tool("solo", stacks).handler({ tree: "/t" }, {} as NodeJS.ProcessEnv)).body).toEqual({ branch: "solo", member: false, stackStore: "read", tree: "/t" });
  });
  test("an unanswerable stack store says so instead of guessing", async () => {
    expect((await tool("b", null).handler({ tree: "/t" }, {} as NodeJS.ProcessEnv)).body).toEqual({ branch: "b", member: false, stackStore: "unavailable", tree: "/t" });
  });
  test("a subdirectory reads the branch of the root it resolved to, and names that root", async () => {
    const res = await tool("b", stacks, { ok: true, path: "/t", repoName: "r", resolvedFrom: "/t/src" }).handler({ tree: "/t/src" }, {} as NodeJS.ProcessEnv);
    expect(res.body).toMatchObject({ branch: "b", member: true, tree: "/t" });
  });
  test("refuses an unregistered tree and a detached HEAD", async () => {
    expect((await tool("b", stacks, { ok: false, error: "nope" }).handler({ tree: "/x" }, {} as NodeJS.ProcessEnv)).error).toBe("nope");
    expect((await tool(null, stacks).handler({ tree: "/t" }, {} as NodeJS.ProcessEnv)).error).toBe("the tree is on a detached HEAD");
  });
});
