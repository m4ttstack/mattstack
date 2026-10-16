import { describe, expect, test } from "bun:test";
import { explainError } from "../../explain-error.ts";
import { parseProvisionError, worktreeToolDefs, type WorktreeToolDeps } from "../worktree-tools.ts";

const ID = "remote:gitlab.com%2Facme%2Facme-dev";
function fake(opts: { reply?: { ok: boolean; data?: unknown; error?: string }; resolveRepo?: WorktreeToolDeps["resolveRepo"] } = {}) {
  const calls: Array<{ name: string; payload: any; opts: any }> = [];
  const command = (async (name: string, payload: unknown, o: unknown) => { calls.push({ name, payload, opts: o }); return opts.reply ?? { ok: true, data: { done: name } }; }) as any;
  const resolveRepo = opts.resolveRepo ?? (async () => ({ identity: ID }));
  return { calls, tool: (n: string) => worktreeToolDefs({ command, resolveRepo }).find((t) => t.name === n)! };
}
const ENV = {} as NodeJS.ProcessEnv;

describe("worktree tools", () => {
  test("worktree_dispose's description claims no check the handler does not make", () => {
    const { tool } = fake();
    expect(tool("worktree_dispose").description).not.toContain("this session sits in");
  });
  test("provision needs a ticket or a branch", async () => {
    const { tool, calls } = fake();
    const r = await tool("worktree_provision").handler({ repoName: ID }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("ticket");
    expect(calls).toEqual([]);
  });
  test("provision passes ticket, title, disposal and owner and waits minutes", async () => {
    const { tool, calls } = fake();
    const r = await tool("worktree_provision").handler({ repoName: ID, ticket: "T-9", ticketTitle: "Do it", disposal: "job", owner: "shepherd" }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);
    expect(calls[0]).toMatchObject({ name: "worktree:provision", payload: { repoName: ID, ticket: "T-9", ticketTitle: "Do it", disposal: "job", owner: "shepherd" } });
    expect(calls[0]!.opts.timeoutMs).toBeGreaterThanOrEqual(120_000);
  });
  test("provision refuses an unknown disposal", async () => {
    const { tool } = fake();
    const r = await tool("worktree_provision").handler({ repoName: ID, branch: "b", disposal: "later" }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
  });
  test("dispose and stop_holders name the tree", async () => {
    const { tool, calls } = fake();
    await tool("worktree_dispose").handler({ repoName: ID, tree: "acme-dev-3" }, {} as NodeJS.ProcessEnv);
    await tool("worktree_stop_holders").handler({ repoName: ID, tree: "acme-dev-3" }, {} as NodeJS.ProcessEnv);
    expect(calls.map((c) => c.name)).toEqual(["worktree:dispose", "worktree:stop-holders"]);
    expect(calls[0]!.payload).toEqual({ repoName: ID, tree: "acme-dev-3" });
    expect(calls[1]!.payload).toEqual({ repoName: ID, tree: "acme-dev-3" });
  });

  describe("provision refusal codes", () => {
    const CREATE_FAILED = "create-failed:pnpm-install\nERR 1\nERR 2\n1 on-deck tree held by retry backoff until 2026-10-16T00:00:00.000Z";
    const OUTDATED = 'daemon at version 2.1.0 does not know "worktree:provision-check"; restart or upgrade rt (rt daemon restart)';
    const TABLE: Array<[string, string]> = [
      ["busy", "busy"],
      ["repo-unknown", "repo-unknown"],
      ["branch-unresolved", "branch-unresolved"],
      ["branch-duplicated", "branch-duplicated"],
      ["branch-attached:frodo", "branch-attached"],
      ["checkout-failed:boom", "checkout-failed"],
      [CREATE_FAILED, "create-failed"],
      ["claim-write-failed", "claim-write-failed"],
      ["handoff-write-failed", "handoff-write-failed"],
      ["unsafe git ref (starts with '-' or empty): -x", "unsafe-ref"],
      ["rt daemon unreachable at /tmp/rt.sock: ENOENT", "daemon-unreachable"],
      [OUTDATED, "daemon-outdated"],
      ["something new", "error"],
    ];
    test.each(TABLE)("parseProvisionError(%j) is %s", (raw, code) => {
      const p = parseProvisionError(raw);
      expect(p.kind).toBe("refused");
      expect(p.code).toBe(code);
      expect(p.error).toBe(explainError(raw));
    });
    test("parseProvisionError carries the extra fields", () => {
      expect(parseProvisionError("branch-attached:frodo").tree).toBe("frodo");
      expect(parseProvisionError("checkout-failed:boom").detail).toBe("boom");
      const cf = parseProvisionError(CREATE_FAILED);
      expect(cf.step).toBe("pnpm-install");
      expect(cf.detail).toBe("ERR 1\nERR 2\n1 on-deck tree held by retry backoff until 2026-10-16T00:00:00.000Z");
      expect(parseProvisionError("create-failed:pnpm-install").detail).toBeUndefined();
      for (const raw of ["unsafe git ref (starts with '-' or empty): -x", "rt daemon unreachable at /tmp/rt.sock: ENOENT", OUTDATED, "something new"]) {
        expect(parseProvisionError(raw).detail).toBe(raw);
      }
      expect(parseProvisionError("busy").detail).toBeUndefined();
    });
    test("a default refusal keeps today's text", async () => {
      const raw = "create-failed:pnpm-install\nERR 1";
      const { tool } = fake({ reply: { ok: false, error: raw } });
      const r = await tool("worktree_provision").handler({ repoName: ID, branch: "b" }, ENV);
      expect(r.ok).toBe(false);
      expect(r.error).toBe(explainError(raw));
    });
    test("codes: true turns the refusal into JSON", async () => {
      const raw = "create-failed:pnpm-install\nERR 1";
      const { tool } = fake({ reply: { ok: false, error: raw } });
      const r = await tool("worktree_provision").handler({ repoName: ID, branch: "b", codes: true }, ENV);
      expect(r.ok).toBe(false);
      expect(JSON.parse(r.error!)).toEqual(parseProvisionError(raw));
    });
    test("a default success is the data plus kind provisioned", async () => {
      const data = { tree: "acme-dev-3", path: "/p" };
      const { tool } = fake({ reply: { ok: true, data } });
      const r = await tool("worktree_provision").handler({ repoName: ID, branch: "b" }, ENV);
      expect(r.ok).toBe(true);
      expect(r.body).toEqual({ kind: "provisioned", ...data });
    });
    const MSG = 'repoName "x" did not match a registered repo; pass its serialized identity';
    test("an unknown repo keeps its message on a default call", async () => {
      const { tool, calls } = fake({ resolveRepo: async () => ({ error: MSG, unknown: true }) });
      const r = await tool("worktree_provision").handler({ repoName: "x", branch: "b" }, ENV);
      expect(r.ok).toBe(false);
      expect(r.error).toBe(MSG);
      expect(calls).toEqual([]);
    });
    test("an unknown repo is repo-unknown JSON when opted in", async () => {
      const { tool, calls } = fake({ resolveRepo: async () => ({ error: MSG, unknown: true }) });
      const r = await tool("worktree_provision").handler({ repoName: "x", branch: "b", codes: true }, ENV);
      expect(r.ok).toBe(false);
      expect(JSON.parse(r.error!)).toEqual({ kind: "refused", code: "repo-unknown", error: MSG });
      expect(calls).toEqual([]);
    });
    test("a repo failure that is not unknown stays plain text when opted in", async () => {
      const { tool } = fake({ resolveRepo: async () => ({ error: MSG, unknown: false }) });
      const r = await tool("worktree_provision").handler({ repoName: "x", branch: "b", codes: true }, ENV);
      expect(r.error).toBe(MSG);
    });
    test("codes must be a boolean", async () => {
      const { tool } = fake();
      const r = await tool("worktree_provision").handler({ repoName: ID, branch: "b", codes: "yes" }, ENV);
      expect(r.ok).toBe(false);
      expect(r.error).toContain("codes");
    });
  });
});
