import { describe, expect, test } from "bun:test";
import { createMRHandlers } from "../handlers/mr.ts";
import { fakeStore } from "./fake-cache-store.ts";

const GH_REPO = "remote:github.com%2Facme%2Fradar";
const ctx = () => ({
  cache: fakeStore({}),
  repoIndex: () => ({ [GH_REPO]: "/tmp/gh" }),
  log: { warn() {}, info() {}, debug() {}, error() {} } as any,
});

function handlers(fetchApprovalRules: (o: unknown) => Promise<unknown>) {
  const calls: unknown[] = [];
  const h = createMRHandlers(ctx(), () => {}, {
    getContext: async () => ({
      forge: "github",
      projectPath: "acme/radar",
      provider: { fetchApprovalRules: async (o: unknown) => { calls.push(o); return fetchApprovalRules(o); } },
    }),
  });
  return { h, calls };
}

describe("mr:owner-rules", () => {
  test("reads one iid's rules through fetchApprovalRules once", async () => {
    const rules = [{ type: "code_owner", approved: false, section: "@acme/web" }];
    const { h, calls } = handlers(async () => [{ iid: 7, rules }, { iid: 8, rules: [] }]);
    expect(await h["mr:owner-rules"]!({ repoName: GH_REPO, iid: 7 })).toEqual({ ok: true, data: { rules } });
    expect(calls).toEqual([{ projectPath: "acme/radar", iids: [7] }]);
  });

  test("carries unknownReason with an empty rules array", async () => {
    const { h } = handlers(async () => [{ iid: 7, rules: [], unknownReason: "no codeowners file" }]);
    expect(await h["mr:owner-rules"]!({ repoName: GH_REPO, iid: 7 })).toEqual({
      ok: true, data: { rules: [], unknownReason: "no codeowners file" },
    });
  });

  test("an iid missing from the answer reads as no rules", async () => {
    const { h } = handlers(async () => []);
    expect(await h["mr:owner-rules"]!({ repoName: GH_REPO, iid: 7 })).toEqual({ ok: true, data: { rules: [] } });
  });

  test("refuses a bad iid and an unknown repo like forge:file-diff", async () => {
    const { h, calls } = handlers(async () => []);
    expect(await h["mr:owner-rules"]!({ repoName: GH_REPO, iid: 0 })).toEqual({ ok: false, error: '"iid" must be a positive integer' });
    expect(await h["mr:owner-rules"]!({ repoName: GH_REPO })).toEqual({ ok: false, error: "missing repoName/iid" });
    const bad = await h["mr:owner-rules"]!({ repoName: "remote:github.com%2Fnope%2Fnope", iid: 7 });
    const ref = await h["forge:file-diff"]!({ repoName: "remote:github.com%2Fnope%2Fnope", iid: 7, path: "a" });
    expect(bad).toEqual(ref as unknown as typeof bad);
    expect(calls).toEqual([]);
  });

  test("a provider throw is an error", async () => {
    const { h } = handlers(async () => { throw new Error("boom"); });
    const r = await h["mr:owner-rules"]!({ repoName: GH_REPO, iid: 7 });
    expect(r.ok).toBe(false);
  });
});
