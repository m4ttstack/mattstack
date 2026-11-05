import { describe, expect, test } from "bun:test";
import type { BranchSyncResult } from "../../lib/mcp/git-tools.ts";
import { fetchAuthEnv } from "../../lib/worktree/fetch-auth.ts";
import { branchSyncWithAuth, type BranchSyncAuthDeps } from "../worktree-branch-sync.ts";

const AUTH = "fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled";
const result = (over: Partial<BranchSyncResult>): BranchSyncResult =>
  ({ kind: "synced", branch: "feat", oldHead: "a", newHead: "b", pushed: true, refusal: null, ...over });
const auth = { args: ["-c", "credential.https://gitlab.com.helper=", "-c", "credential.https://gitlab.com.helper=!rt"], env: { RT_GIT_TOKEN: "t" }, remote: "https://gitlab.com/a/b.git" };

function deps(first: BranchSyncResult, over: Partial<BranchSyncAuthDeps> = {}) {
  const calls = { syncs: 0, pushes: 0 };
  const d: BranchSyncAuthDeps = {
    sync: async () => { calls.syncs++; return calls.syncs === 1 ? first : result({}); },
    auth: async () => auth,
    push: async () => { calls.pushes++; return { exitCode: 0, stdout: "", stderr: "" }; },
    ...over,
  };
  return { d, calls };
}

describe("branchSyncWithAuth", () => {
  test("a result with no auth failure passes through", async () => {
    const { d, calls } = deps(result({ kind: "conflict", pushed: false }));
    expect((await branchSyncWithAuth("/t", d)).kind).toBe("conflict");
    expect(calls).toEqual({ syncs: 1, pushes: 0 });
  });

  test("a fetch that failed on auth reruns with the token, nothing having moved", async () => {
    const { d, calls } = deps(result({ kind: "error", oldHead: "a", newHead: "a", pushed: false, refusal: `git fetch origin failed: ${AUTH}` }));
    expect((await branchSyncWithAuth("/t", d)).kind).toBe("synced");
    expect(calls.syncs).toBe(2);
  });

  test("a push that failed on auth retries only the push", async () => {
    const { d, calls } = deps(result({ kind: "push-refused", pushed: false, refusal: `Could not push feat ${AUTH}` }));
    expect(await branchSyncWithAuth("/t", d)).toMatchObject({ kind: "synced", pushed: true, refusal: null });
    expect(calls).toEqual({ syncs: 1, pushes: 1 });
  });

  test("a push that still fails keeps push-refused and says so", async () => {
    const { d } = deps(result({ kind: "push-refused", pushed: false, refusal: `Could not push feat ${AUTH}` }), {
      push: async () => ({ exitCode: 128, stdout: "", stderr: "fatal: Authentication failed" }),
    });
    const r = await branchSyncWithAuth("/t", d);
    expect(r.kind).toBe("push-refused");
    expect(r.refusal).toContain("with rt's token: fatal: Authentication failed");
  });

  test("no token to offer leaves the failure as it was", async () => {
    const first = result({ kind: "error", oldHead: "a", newHead: "a", pushed: false, refusal: AUTH });
    const { d, calls } = deps(first, { auth: async () => null });
    expect(await branchSyncWithAuth("/t", d)).toEqual(first);
    expect(calls.syncs).toBe(1);
  });
});

test("fetchAuthEnv turns the -c pairs into git config env vars", () => {
  expect(fetchAuthEnv(auth)).toEqual({
    RT_GIT_TOKEN: "t",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "credential.https://gitlab.com.helper",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: "credential.https://gitlab.com.helper",
    GIT_CONFIG_VALUE_1: "!rt",
  });
});
