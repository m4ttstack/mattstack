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
      const { tool, calls } = fake({ resolveRepo: async () => ({ error: MSG, unknown: async () => true }) });
      const r = await tool("worktree_provision").handler({ repoName: "x", branch: "b" }, ENV);
      expect(r.ok).toBe(false);
      expect(r.error).toBe(MSG);
      expect(calls).toEqual([]);
    });
    test("a default call with a failing resolve never classifies the repo", async () => {
      let classified = 0;
      const { tool } = fake({ resolveRepo: async () => ({ error: MSG, unknown: async () => { classified++; return true; } }) });
      const r = await tool("worktree_provision").handler({ repoName: "x", branch: "b", stage: "s" }, ENV);
      expect(r.error).toBe(MSG);
      expect(classified).toBe(0);
    });
    test("an unknown repo is repo-unknown JSON when opted in", async () => {
      const { tool, calls } = fake({ resolveRepo: async () => ({ error: MSG, unknown: async () => true }) });
      const r = await tool("worktree_provision").handler({ repoName: "x", branch: "b", codes: true }, ENV);
      expect(r.ok).toBe(false);
      expect(JSON.parse(r.error!)).toEqual({ kind: "refused", code: "repo-unknown", error: MSG });
      expect(calls).toEqual([]);
    });
    test("a repo failure that is not unknown stays plain text when opted in", async () => {
      const { tool } = fake({ resolveRepo: async () => ({ error: MSG, unknown: async () => false }) });
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
  describe("precheck and reuse", () => {
    const OUTDATED = 'daemon at version 2.1.0 does not know "worktree:provision-check"; restart or upgrade rt (rt daemon restart)';
    const ref = (o: Record<string, unknown> = {}) => ({ tree: "frodo", path: "/trees/frodo", branch: "acme-1-fix", treeKind: "ephemeral", state: "claimed", owner: "o", disposal: "job", ...o });
    const checkData = (o: Record<string, unknown> = {}) => ({ branch: "acme-1-fix", base: "acme-1-fix", localBranch: false, attached: [], sameTicket: [], sameSlug: [], ...o });
    function routed(replies: Record<string, { ok: boolean; data?: unknown; error?: string }>) {
      const calls: Array<{ name: string; payload: any; opts: any }> = [];
      const command = (async (name: string, payload: unknown, o: unknown) => { calls.push({ name, payload, opts: o }); return replies[name] ?? { ok: false, error: "no reply for " + name }; }) as any;
      const tool = worktreeToolDefs({ command, resolveRepo: async () => ({ identity: ID }) }).find((t) => t.name === "worktree_provision")!;
      return { calls, tool };
    }
    const PROVISIONED = { ok: true, data: { tree: "new", path: "/trees/new" } };

    test("precheck returns the check data and makes only the check call", async () => {
      const data = checkData({ attached: [ref()] });
      const { tool, calls } = routed({ "worktree:provision-check": { ok: true, data } });
      const r = await tool.handler({ repoName: ID, ticket: "ACME-1", ticketTitle: "Fix", precheck: true }, ENV);
      expect(r.ok).toBe(true);
      expect(r.body).toEqual({ kind: "precheck", ...data });
      expect(calls.map((c) => c.name)).toEqual(["worktree:provision-check"]);
      expect(calls[0]!.payload).toEqual({ repoName: ID, ticket: "ACME-1", ticketTitle: "Fix" });
      expect(calls[0]!.opts.timeoutMs).toBe(30_000);
    });
    test("precheck still needs a ticket or a branch", async () => {
      const { tool, calls } = routed({});
      const r = await tool.handler({ repoName: ID, precheck: true }, ENV);
      expect(r.ok).toBe(false);
      expect(calls).toEqual([]);
    });
    test("a failed check is a daemon-outdated refusal and never provisions", async () => {
      const { tool, calls } = routed({ "worktree:provision-check": { ok: false, error: OUTDATED } });
      for (const extra of [{ precheck: true }, { reuse: true }]) {
        const r = await tool.handler({ repoName: ID, ticket: "ACME-1", ...extra }, ENV);
        expect(r.ok).toBe(false);
        expect(JSON.parse(r.error!).code).toBe("daemon-outdated");
      }
      expect(calls.map((c) => c.name)).toEqual(["worktree:provision-check", "worktree:provision-check"]);
    });
    test("reuse of one claimed ephemeral tree returns it with no provision call", async () => {
      const { tool, calls } = routed({ "worktree:provision-check": { ok: true, data: checkData({ attached: [ref()] }) } });
      const r = await tool.handler({ repoName: ID, ticket: "ACME-1", reuse: true }, ENV);
      expect(r.ok).toBe(true);
      expect(r.body).toEqual({ kind: "reused", tree: "frodo", path: "/trees/frodo", branch: "acme-1-fix", treeKind: "ephemeral", state: "claimed", owner: "o", disposal: "job" });
      expect(calls.map((c) => c.name)).toEqual(["worktree:provision-check"]);
    });
    test("reuse of one unmanaged tree is reused", async () => {
      const { tool, calls } = routed({ "worktree:provision-check": { ok: true, data: checkData({ attached: [ref({ treeKind: "unmanaged", state: undefined, owner: undefined, disposal: undefined })] }) } });
      const r = await tool.handler({ repoName: ID, branch: "acme-1-fix", reuse: true }, ENV);
      expect(r.ok).toBe(true);
      expect((r.body as any).kind).toBe("reused");
      expect(calls.map((c) => c.name)).toEqual(["worktree:provision-check"]);
    });
    test.each([
      [{ treeKind: "main", state: undefined }, "main-checkout"],
      [{ state: "disposable" }, "disposable"],
      [{ state: "creating" }, "creating"],
      [{ treeKind: "golden", state: undefined }, "golden"],
    ])("reuse of an unreusable tree %j refuses branch-attached (%s)", async (over, reason) => {
      const { tool, calls } = routed({ "worktree:provision-check": { ok: true, data: checkData({ attached: [ref(over)] }) } });
      const r = await tool.handler({ repoName: ID, ticket: "ACME-1", reuse: true }, ENV);
      expect(r.ok).toBe(false);
      expect(JSON.parse(r.error!)).toEqual({ kind: "refused", code: "branch-attached", tree: "frodo", reason, error: explainError("branch-attached:frodo") });
      expect(calls.map((c) => c.name)).toEqual(["worktree:provision-check"]);
    });
    test("reuse with two trees on the branch refuses branch-duplicated", async () => {
      const { tool, calls } = routed({ "worktree:provision-check": { ok: true, data: checkData({ attached: [ref(), ref({ tree: "sam", path: "/trees/sam" })] }) } });
      const r = await tool.handler({ repoName: ID, ticket: "ACME-1", reuse: true }, ENV);
      expect(r.ok).toBe(false);
      expect(JSON.parse(r.error!)).toEqual({ kind: "refused", code: "branch-duplicated", trees: ["frodo", "sam"], error: explainError("branch-duplicated") });
      expect(calls.map((c) => c.name)).toEqual(["worktree:provision-check"]);
    });
    test("reuse in ticket mode with a surviving local branch provisions on that branch", async () => {
      const { tool, calls } = routed({ "worktree:provision-check": { ok: true, data: checkData({ localBranch: true }) }, "worktree:provision": PROVISIONED });
      const r = await tool.handler({ repoName: ID, ticket: "ACME-1", ticketTitle: "Fix", owner: "o", disposal: "job", reuse: true }, ENV);
      expect(r.ok).toBe(true);
      expect(calls[1]).toMatchObject({ name: "worktree:provision", payload: { repoName: ID, branch: "acme-1-fix", owner: "o", disposal: "job" } });
      expect(calls[1]!.payload.ticket).toBeUndefined();
      expect(calls[1]!.payload.ticketTitle).toBeUndefined();
    });
    test("reuse with no local branch provisions the ordinary payload", async () => {
      const { tool, calls } = routed({ "worktree:provision-check": { ok: true, data: checkData() }, "worktree:provision": PROVISIONED });
      const r = await tool.handler({ repoName: ID, ticket: "ACME-1", ticketTitle: "Fix", reuse: true }, ENV);
      expect(r.ok).toBe(true);
      expect(r.body).toEqual({ kind: "provisioned", tree: "new", path: "/trees/new" });
      expect(calls[1]!.payload).toEqual({ repoName: ID, ticket: "ACME-1", ticketTitle: "Fix" });
    });
    test("reuse in branch mode never swaps in base even with a local branch", async () => {
      const { tool, calls } = routed({ "worktree:provision-check": { ok: true, data: checkData({ localBranch: true }) }, "worktree:provision": PROVISIONED });
      await tool.handler({ repoName: ID, ticket: "ACME-1", branch: "acme-1-fix", reuse: true }, ENV);
      expect(calls[1]!.payload).toEqual({ repoName: ID, ticket: "ACME-1", branch: "acme-1-fix" });
    });
    test("a provision refusal after reuse is JSON", async () => {
      const { tool } = routed({ "worktree:provision-check": { ok: true, data: checkData() }, "worktree:provision": { ok: false, error: "busy" } });
      const r = await tool.handler({ repoName: ID, ticket: "ACME-1", reuse: true }, ENV);
      expect(JSON.parse(r.error!).code).toBe("busy");
    });
    test("precheck with reuse is an input error before any call", async () => {
      const { tool, calls } = routed({});
      const r = await tool.handler({ repoName: ID, ticket: "ACME-1", precheck: true, reuse: true }, ENV);
      expect(r.ok).toBe(false);
      expect(r.error).toBe("precheck and reuse are separate calls");
      expect(calls).toEqual([]);
    });
    test("precheck and reuse must be booleans", async () => {
      const { tool } = routed({});
      expect((await tool.handler({ repoName: ID, ticket: "t", precheck: "yes" }, ENV)).error).toContain("precheck");
      expect((await tool.handler({ repoName: ID, ticket: "t", reuse: 1 }, ENV)).error).toContain("reuse");
    });
  });
  describe("run recording and the retry budget", () => {
    const RUN_DB = "/runs/x/state.db";
    const DATA = { tree: "new", path: "/trees/new", branch: "acme-1-fix" };
    const PROVISIONED = { ok: true, data: DATA };
    const ref = { tree: "frodo", path: "/trees/frodo", branch: "acme-1-fix", treeKind: "ephemeral", state: "claimed" };
    const checkData = (o: Record<string, unknown> = {}) => ({ branch: "acme-1-fix", base: "acme-1-fix", localBranch: false, attached: [], sameTicket: [], sameSlug: [], ...o });
    function rig(replies: Record<string, { ok: boolean; data?: unknown; error?: string }>, opts: { fieldSet?: (input: any) => { ok: boolean; body?: unknown; error?: string }; budget?: ((input: any) => { ok: boolean; body?: unknown; error?: string }) | null; noFieldSet?: boolean } = {}) {
      const calls: Array<{ name: string; payload: any }> = [];
      const fieldWrites: any[] = [];
      const budgetCalls: any[] = [];
      const envs: unknown[] = [];
      const command = (async (name: string, payload: unknown) => { calls.push({ name, payload: payload as any }); return replies[name] ?? { ok: false, error: "no reply for " + name }; }) as any;
      const defs: any[] = [];
      if (!opts.noFieldSet) defs.push({ name: "run_field_set", handler: async (input: any, env: unknown) => { fieldWrites.push(input); envs.push(env); return (opts.fieldSet ?? (() => ({ ok: true, body: {} })))(input); } });
      if (opts.budget !== null) defs.push({ name: "run_budget", handler: async (input: any) => { budgetCalls.push(input); return (opts.budget ?? (() => ({ ok: true, body: { key: "provision", spent: 1, limit: 2, remaining: 1, exhausted: false } })))(input); } });
      const tool = worktreeToolDefs({ command, resolveRepo: async () => ({ identity: ID }), runTools: () => defs }).find((t) => t.name === "worktree_provision")!;
      return { calls, fieldWrites, budgetCalls, envs, tool };
    }
    test("a provisioned tree is recorded as branch then worktree", async () => {
      const { tool, fieldWrites, envs } = rig({ "worktree:provision": PROVISIONED });
      const env = { X: "1" } as NodeJS.ProcessEnv;
      const r = await tool.handler({ repoName: ID, branch: "acme-1-fix", runDb: RUN_DB }, env);
      expect(r.ok).toBe(true);
      expect(r.body).toEqual({ kind: "provisioned", ...DATA, recorded: true });
      expect(fieldWrites).toEqual([
        { runDb: RUN_DB, key: "branch", value: "acme-1-fix", stage: "provision" },
        { runDb: RUN_DB, key: "worktree", value: "/trees/new", stage: "provision" },
      ]);
      expect(envs).toEqual([env, env]);
    });
    test("a reused tree is recorded under the given stage", async () => {
      const { tool, fieldWrites } = rig({ "worktree:provision-check": { ok: true, data: checkData({ attached: [ref] }) } });
      const r = await tool.handler({ repoName: ID, ticket: "ACME-1", reuse: true, runDb: RUN_DB, stage: "checkout" }, ENV);
      expect((r.body as any).kind).toBe("reused");
      expect((r.body as any).recorded).toBe(true);
      expect(fieldWrites).toEqual([
        { runDb: RUN_DB, key: "branch", value: "acme-1-fix", stage: "checkout" },
        { runDb: RUN_DB, key: "worktree", value: "/trees/frodo", stage: "checkout" },
      ]);
    });
    test("a failed branch write stops the recording and keeps the tree", async () => {
      const { tool, fieldWrites } = rig({ "worktree:provision": PROVISIONED }, { fieldSet: () => ({ ok: false, error: "stage provision has no row in this run" }) });
      const r = await tool.handler({ repoName: ID, branch: "acme-1-fix", runDb: RUN_DB }, ENV);
      expect(r.ok).toBe(true);
      expect(r.body).toEqual({ kind: "provisioned", ...DATA, recordError: "stage provision has no row in this run" });
      expect(fieldWrites.map((w) => w.key)).toEqual(["branch"]);
    });
    test("a missing run_field_set tool is a recordError", async () => {
      const { tool } = rig({ "worktree:provision": PROVISIONED }, { noFieldSet: true });
      const r = await tool.handler({ repoName: ID, branch: "acme-1-fix", runDb: RUN_DB }, ENV);
      expect(r.ok).toBe(true);
      expect((r.body as any).recordError).toBe("run_field_set is not available");
    });
    test("precheck and a refusal record nothing", async () => {
      const a = rig({ "worktree:provision-check": { ok: true, data: checkData({ attached: [ref] }) } });
      await a.tool.handler({ repoName: ID, ticket: "ACME-1", precheck: true, runDb: RUN_DB }, ENV);
      expect(a.fieldWrites).toEqual([]);
      const b = rig({ "worktree:provision": { ok: false, error: "busy" } });
      const r = await b.tool.handler({ repoName: ID, branch: "b", runDb: RUN_DB }, ENV);
      expect(JSON.parse(r.error!).code).toBe("busy");
      expect(b.fieldWrites).toEqual([]);
    });
    test.each([["relative/state.db"], ["/runs/x/other.db"], [""]])("runDb %j is an input error before any call", async (runDb) => {
      const { tool, calls } = rig({ "worktree:provision": PROVISIONED });
      const r = await tool.handler({ repoName: ID, branch: "b", runDb }, ENV);
      expect(r.ok).toBe(false);
      expect(r.error).toBe('"runDb" must be the absolute path of a run\'s state.db');
      expect(calls).toEqual([]);
    });
    test("runDb and stage must be strings", async () => {
      const { tool, calls } = rig({ "worktree:provision": PROVISIONED });
      expect((await tool.handler({ repoName: ID, branch: "b", runDb: 5 }, ENV)).error).toContain("runDb");
      expect((await tool.handler({ repoName: ID, branch: "b", runDb: RUN_DB, stage: 5 }, ENV)).error).toContain("stage");
      expect(calls).toEqual([]);
    });
    test("a refusal with a budget charges run_budget and returns its body", async () => {
      const { tool, budgetCalls } = rig({ "worktree:provision": { ok: false, error: "busy" } });
      const r = await tool.handler({ repoName: ID, branch: "b", runDb: RUN_DB, budget: { key: "provision", limit: 2 } }, ENV);
      expect(JSON.parse(r.error!).budget).toEqual({ key: "provision", spent: 1, limit: 2, remaining: 1, exhausted: false });
      expect(budgetCalls).toEqual([{ runDb: RUN_DB, key: "provision", limit: 2, stage: "provision" }]);
    });
    test.each([[""], ["   "]])("stage %j is an input error before any call", async (stage) => {
      const { tool, calls } = rig({ "worktree:provision": PROVISIONED });
      const r = await tool.handler({ repoName: ID, branch: "b", runDb: RUN_DB, stage }, ENV);
      expect(r.ok).toBe(false);
      expect(r.error).toBe('"stage" must be a non-empty string');
      expect(calls).toEqual([]);
    });
    test("a reuse refusal charges the budget under the given stage", async () => {
      const { tool, budgetCalls } = rig({ "worktree:provision-check": { ok: true, data: checkData({ attached: [{ ...ref, state: "disposable" }] }) } });
      const r = await tool.handler({ repoName: ID, ticket: "ACME-1", reuse: true, runDb: RUN_DB, stage: "checkout", budget: { key: "k", limit: 3 } }, ENV);
      expect(JSON.parse(r.error!).code).toBe("branch-attached");
      expect(budgetCalls).toEqual([{ runDb: RUN_DB, key: "k", limit: 3, stage: "checkout" }]);
    });
    test("a repo-unknown refusal charges the budget", async () => {
      const calls: any[] = [];
      const tool = worktreeToolDefs({ command: (async () => ({ ok: true })) as any, resolveRepo: async () => ({ error: "nope", unknown: async () => true }), runTools: () => [{ name: "run_budget", handler: async (i: any) => { calls.push(i); return { ok: true, body: { key: "k" } }; } } as any] }).find((t) => t.name === "worktree_provision")!;
      const r = await tool.handler({ repoName: "x", branch: "b", runDb: RUN_DB, budget: { key: "k", limit: 2 } }, ENV);
      expect(JSON.parse(r.error!)).toEqual({ kind: "refused", code: "repo-unknown", error: "nope", budget: { key: "k" } });
      expect(calls).toHaveLength(1);
    });
    test("a success with a budget does not charge", async () => {
      const { tool, budgetCalls } = rig({ "worktree:provision": PROVISIONED });
      await tool.handler({ repoName: ID, branch: "b", runDb: RUN_DB, budget: { key: "provision", limit: 2 } }, ENV);
      expect(budgetCalls).toEqual([]);
    });
    test("no run_budget tool gives a budget error", async () => {
      const { tool } = rig({ "worktree:provision": { ok: false, error: "busy" } }, { budget: null });
      const r = await tool.handler({ repoName: ID, branch: "b", runDb: RUN_DB, budget: { key: "provision", limit: 2 } }, ENV);
      expect(JSON.parse(r.error!).budget).toEqual({ error: "run_budget is not available on this rt" });
    });
    test("a run_budget refusal comes back as budget.error", async () => {
      const { tool } = rig({ "worktree:provision": { ok: false, error: "busy" } }, { budget: () => ({ ok: false, error: "stage provision has no row in this run" }) });
      const r = await tool.handler({ repoName: ID, branch: "b", runDb: RUN_DB, budget: { key: "provision", limit: 2 } }, ENV);
      expect(JSON.parse(r.error!).budget).toEqual({ error: "stage provision has no row in this run" });
    });
    test.each([
      [{ budget: { key: "k", limit: 2 } }, '"budget" needs "runDb"'],
      [{ runDb: "/runs/x/state.db", budget: { key: "", limit: 2 } }, "budget"],
      [{ runDb: "/runs/x/state.db", budget: { key: "k", limit: 0 } }, "budget"],
      [{ runDb: "/runs/x/state.db", budget: { key: "k", limit: 1.5 } }, "budget"],
      [{ runDb: "/runs/x/state.db", budget: "k" }, "budget"],
      [{ runDb: "/runs/x/state.db", budget: [] }, "budget"],
    ])("budget input %j is an input error with no calls", async (extra, msg) => {
      const { tool, calls, budgetCalls } = rig({ "worktree:provision": { ok: false, error: "busy" } });
      const r = await tool.handler({ repoName: ID, branch: "b", ...extra }, ENV);
      expect(r.ok).toBe(false);
      expect(r.error).toContain(msg);
      expect(calls).toEqual([]);
      expect(budgetCalls).toEqual([]);
    });
    test("the description names the five opting-in options and that stage alone does not opt in", () => {
      const d = rig({}).tool.description;
      expect(d).toContain("Using any of codes, precheck, reuse, runDb or budget makes every refusal JSON text with a code");
      expect(d).not.toContain("Using any one");
    });
    test("the description names the outcomes, codes and options", () => {
      const d = rig({}).tool.description;
      for (const word of ["provisioned", "precheck", "reused", "codes", "reuse", "runDb", "stage", "budget", "run_budget", "branch-attached", "busy", "create-failed", "repo-unknown"]) expect(d).toContain(word);
    });
  });
});
