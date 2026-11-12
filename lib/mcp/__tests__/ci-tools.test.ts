import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getEventListeners } from "node:events";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardDoctorOwner, ciLeaseFileName, claimCiLease, readCiLease, releaseCiLease } from "../../../packages/rt-client/src/index.ts";
import { __resetMemoryFacts } from "../../ci/github-forge.ts";
import { LeaseKeepalive } from "../../ci/lease-keepalive.ts";
import { watchStatePath, writeWatchState } from "../../ci/watch-state.ts";
import { closeStateDb } from "../../state/index.ts";
import { abortableSleep, ciToolDefs } from "../ci-tools.ts";
import { MR_URL_SHAPE, resolveMrTarget } from "../mr-target.ts";
import { PR_URL_NOTE } from "../shared.ts";

const MR = "https://gitlab.example.com/grp/proj/-/merge_requests/42";
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ci-tools-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function tool(name: string) {
  const t = ciToolDefs({ leaseOpts: () => ({ dir }), label: () => "alice" }).find((x) => x.name === name);
  if (!t) throw new Error(name);
  return t;
}
const A = { CLAUDE_CODE_SESSION_ID: "aaa" };
const B = { CLAUDE_CODE_SESSION_ID: "bbb" };

describe("lease tools", () => {
  test("claim writes the caller's own session lease", async () => {
    const r = await tool("ci_lease_claim").handler({ mrUrl: MR, branch: "feat" }, A);
    expect(r).toMatchObject({ ok: true, body: { claimed: true, lease: { owner: "session:aaa", holder: "watch-ci", sessionLabel: "alice", branch: "feat" } } });
  });
  test("a second session is refused as a normal result", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    expect(await tool("ci_lease_claim").handler({ mrUrl: MR }, B)).toMatchObject({ ok: true, body: { claimed: false, holder: { owner: "session:aaa" } } });
  });
  test("heartbeat and release act only on the caller's lease", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    expect(await tool("ci_lease_heartbeat").handler({ mrUrl: MR }, B)).toMatchObject({ ok: true, body: { ok: false, reason: "lost" } });
    expect(await tool("ci_lease_release").handler({ mrUrl: MR }, B)).toMatchObject({ ok: true, body: { released: false } });
    expect(await tool("ci_lease_release").handler({ mrUrl: MR }, A)).toMatchObject({ ok: true, body: { released: true } });
  });
  test("read reports the lease and whether it is the caller's", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    expect(await tool("ci_lease_read").handler({ mrUrl: MR }, A)).toMatchObject({ ok: true, body: { lease: { owner: "session:aaa" }, mine: true } });
    expect(await tool("ci_lease_read").handler({ mrUrl: MR }, B)).toMatchObject({ ok: true, body: { mine: false } });
  });
  test("no session id is refused", async () => {
    expect(await tool("ci_lease_claim").handler({ mrUrl: MR }, {})).toMatchObject({ ok: false });
  });
  test("owner is never taken from input", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR, owner: "session:bbb" } as any, A);
    expect(await tool("ci_lease_read").handler({ mrUrl: MR }, A)).toMatchObject({ body: { mine: true } });
  });
  test("ttlSeconds outside 60 to 900 is refused", async () => {
    expect(await tool("ci_lease_claim").handler({ mrUrl: MR, ttlSeconds: 3600 }, A)).toMatchObject({ ok: false });
    expect(await tool("ci_lease_claim").handler({ mrUrl: MR, ttlSeconds: 30 }, A)).toMatchObject({ ok: false });
  });
  test("holder must be watch-ci or doctor", async () => {
    expect(await tool("ci_lease_claim").handler({ mrUrl: MR, holder: "x" }, A)).toMatchObject({ ok: false });
  });
  test("a URL with no MR segment is refused", async () => {
    expect(await tool("ci_lease_claim").handler({ mrUrl: "https://gitlab.example.com/grp/proj" }, A)).toMatchObject({ ok: false });
  });
  test("a busy lock comes back as a tool error, not a throw", async () => {
    const name = ciLeaseFileName(MR).replace(/\.json$/, ".lock");
    writeFileSync(join(dir, name), JSON.stringify({ token: "someone-else", at: Date.now() }));
    const t = ciToolDefs({ leaseOpts: () => ({ dir, lockWaitMs: 10, lockStaleMs: 60_000 }), label: () => "alice" }).find((x) => x.name === "ci_lease_claim");
    if (!t) throw new Error("ci_lease_claim");
    const r = await t.handler({ mrUrl: MR }, A);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lease lock busy/);
  });
  test("an fs failure comes back as a tool error, not a throw", async () => {
    const notADir = join(dir, "not-a-dir");
    writeFileSync(notADir, "x");
    const t = ciToolDefs({ leaseOpts: () => ({ dir: notADir }), label: () => "alice" }).find((x) => x.name === "ci_lease_claim");
    if (!t) throw new Error("ci_lease_claim");
    const r = await t.handler({ mrUrl: MR }, A);
    expect(r.ok).toBe(false);
  });
  test("ttlSeconds at the boundary is accepted", async () => {
    expect(await tool("ci_lease_claim").handler({ mrUrl: MR, ttlSeconds: 60 }, A)).toMatchObject({ ok: true, body: { claimed: true } });
    expect(await tool("ci_lease_claim").handler({ mrUrl: MR, ttlSeconds: 900 }, A)).toMatchObject({ ok: true, body: { claimed: true } });
  });
  test("a fractional ttlSeconds is refused", async () => {
    expect(await tool("ci_lease_claim").handler({ mrUrl: MR, ttlSeconds: 120.5 }, A)).toMatchObject({ ok: false });
  });
  test("heartbeat with no lease returns reason none", async () => {
    expect(await tool("ci_lease_heartbeat").handler({ mrUrl: MR }, A)).toMatchObject({ ok: true, body: { ok: false, reason: "none" } });
  });
  test("a suffixed URL claims the same lease as the bare MR URL", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    expect(await tool("ci_lease_read").handler({ mrUrl: `${MR}/diffs?x=1` }, A)).toMatchObject({ ok: true, body: { mine: true } });
  });
  test("a URL that is not https is refused before it can slug to a lease file", async () => {
    for (const mrUrl of ["gitlab.example.com/grp/proj/-/merge_requests/42", "http://gitlab.example.com/grp/proj/-/merge_requests/42", "/grp/proj/-/merge_requests/42"]) {
      for (const name of ["ci_lease_claim", "ci_lease_heartbeat", "ci_lease_release", "ci_lease_read"]) {
        const r = await tool(name).handler({ mrUrl }, A);
        expect(r.ok).toBe(false);
        expect(r.error).toContain("https");
      }
    }
  });
  test("claim's branch input says why to pass it", () => {
    const schema = tool("ci_lease_claim").inputSchema as { properties: { branch: { description?: string } } };
    expect(schema.properties.branch.description).toContain("stack preflight");
  });
  test("a whitespace-only branch is treated as absent", async () => {
    const r = await tool("ci_lease_claim").handler({ mrUrl: MR, branch: "   " }, A);
    expect(r).toMatchObject({ ok: true, body: { claimed: true } });
    expect((r as any).body.lease.branch).toBeUndefined();
  });
});

describe("ci_watch", () => {
  const SHA = "a".repeat(40);
  function watchTool(over: Record<string, unknown> = {}, pipeline: Record<string, unknown> = { id: "gitlab:pipeline:10", status: "success", sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: null, jobs: [] }) {
    const t = ciToolDefs({
      leaseOpts: () => ({ dir }),
      label: () => undefined,
      watch: {
        resolve: async () => ({ ok: true, identity: "remote:x", iid: 42 }),
        command: (async (name: string) => (name === "mr:get"
          ? { ok: true, data: { mr: { iid: 42, sha: SHA, webUrl: MR, pipeline }, fetchedAt: 0 } }
          : { ok: true, data: [] })) as any,
        now: () => 0,
        sleep: async () => {},
        budgetMinutes: () => 75,
        ...over,
      },
    }).find((x) => x.name === "ci_watch")!;
    return t;
  }

  test("watches under the caller's lease and heartbeats it", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    const before = ((await tool("ci_lease_read").handler({ mrUrl: MR }, A)) as any).body.lease.heartbeatAt;
    await Bun.sleep(5);
    const r = await watchTool().handler({ repoName: "remote:x", iid: 42, sha: SHA }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "success", lease: { owner: "session:aaa" } } });
    expect((r as any).body.lease.heartbeatAt).toBeGreaterThan(before);
  });
  test("without the lease it returns lease_lost", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, B);
    expect(await watchTool().handler({ repoName: "remote:x", iid: 42, sha: SHA }, A)).toMatchObject({ ok: true, body: { state: "lease_lost" } });
  });
  test("with no lease held at all, lease_lost carries a claim hint rather than the stand-down one", async () => {
    const r = await watchTool().handler({ repoName: "remote:x", iid: 42, sha: SHA }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "lease_lost", holder: null } });
    expect((r as any).body.next).toContain("call ci_lease_claim first");
  });
  test("underBoardLease continues under a fresh board doctor lease and never writes it", async () => {
    const { claimCiLease, boardDoctorOwner, readCiLease } = await import("../../../packages/rt-client/src/index.ts");
    const claimed = claimCiLease({ mrUrl: MR, owner: boardDoctorOwner(MR), holder: "doctor" }, { dir });
    const before = claimed.claimed ? claimed.lease.heartbeatAt : -1;
    await Bun.sleep(5);
    const r = await watchTool().handler({ repoName: "remote:x", iid: 42, sha: SHA, underBoardLease: true }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "success" } });
    expect(readCiLease(MR, { dir }).lease?.heartbeatAt).toBe(before);
  });
  test("underBoardLease returns lease_lost when another owner holds the MR", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, B);
    const r = await watchTool().handler({ repoName: "remote:x", iid: 42, sha: SHA, underBoardLease: true }, A);
    expect(r).toMatchObject({ body: { state: "lease_lost", holder: { owner: "session:bbb" } } });
    expect((r as any).body.next).toContain("stand down");
  });
  test("underBoardLease returns lease_lost with a stand-down hint, never a claim hint, when no lease exists", async () => {
    const r = await watchTool().handler({ repoName: "remote:x", iid: 42, sha: SHA, underBoardLease: true }, A);
    expect(r).toMatchObject({ body: { state: "lease_lost", holder: null } });
    expect((r as any).body.next).toContain("stand down");
    expect((r as any).body.next).not.toContain("ci_lease_claim");
  });
  test("underBoardLease refuses a stale board doctor lease", async () => {
    const { claimCiLease, boardDoctorOwner } = await import("../../../packages/rt-client/src/index.ts");
    claimCiLease({ mrUrl: MR, owner: boardDoctorOwner(MR), holder: "doctor", ttlSeconds: 60 }, { dir, now: () => 0 });
    const r = await watchTool().handler({ repoName: "remote:x", iid: 42, sha: SHA, underBoardLease: true }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "lease_lost", holder: null } });
    expect((r as any).body.next).toContain("stand down");
    expect((r as any).body.next).not.toContain("ci_lease_claim");
  });
  test("a busy lease lock inside the watch's heartbeat is a tool error, not an unhandled rejection", async () => {
    const { claimCiLease } = await import("../../../packages/rt-client/src/index.ts");
    claimCiLease({ mrUrl: MR, owner: "session:aaa", holder: "watch-ci" }, { dir });
    const name = ciLeaseFileName(MR).replace(/\.json$/, ".lock");
    writeFileSync(join(dir, name), JSON.stringify({ token: "someone-else", at: Date.now() }));
    const t = ciToolDefs({
      leaseOpts: () => ({ dir, lockWaitMs: 10, lockStaleMs: 60_000 }),
      label: () => undefined,
      watch: {
        resolve: async () => ({ ok: true, identity: "remote:x", iid: 42 }),
        command: (async (name: string) => (name === "mr:get"
          ? { ok: true, data: { mr: { iid: 42, sha: SHA, webUrl: MR, pipeline: { id: "gitlab:pipeline:10", status: "success", sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: null, jobs: [] } }, fetchedAt: 0 } }
          : { ok: true, data: [] })) as any,
        now: () => 0,
        sleep: async () => {},
      },
    }).find((x) => x.name === "ci_watch")!;
    const r = await t.handler({ repoName: "remote:x", iid: 42, sha: SHA }, A);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lease lock busy/);
  });
  test("a pipeline missing sha, ref and mergeRequestEventType reads as a branch pipeline with no match, and never throws", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    const bare = { id: "gitlab:pipeline:10", status: "running", webUrl: null, createdAt: null, jobs: [] };
    const r = await watchTool({}, bare).handler({ repoName: "remote:x", iid: 42, sha: SHA, maxWaitSeconds: 0 }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "waiting", pipeline: { sha: null, ref: null, mergeRequestEventType: null } } });
    expect((r as any).body.next).toContain("no pipeline for the pushed sha yet");
  });
  test("maxWaitSeconds caps at 1500, under Claude Code's 1800 s MCP idle timeout", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    expect(await watchTool().handler({ repoName: "remote:x", iid: 42, sha: SHA, maxWaitSeconds: 1500 }, A)).toMatchObject({ ok: true, body: { state: "success" } });
  });
  test("reports progress on every poll so a long watch never reads as idle", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    let clock = 0;
    let ticks = 0;
    const running = { id: "gitlab:pipeline:10", status: "running", sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: null, jobs: [] };
    const r = await watchTool({ now: () => clock, sleep: async (ms: number) => { clock += ms; } }, running)
      .handler({ repoName: "remote:x", iid: 42, sha: SHA, maxWaitSeconds: 90, intervalSeconds: 30 }, A, undefined, () => { ticks++; });
    expect(r).toMatchObject({ ok: true, body: { state: "running" } });
    expect((r as any).body.polls).toBeGreaterThan(1);
    expect(ticks).toBeGreaterThanOrEqual((r as any).body.polls);
  });
  test("daemon error surfaces", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    const r = await watchTool({ command: (async () => ({ ok: false, error: "daemon down" })) as any }).handler({ repoName: "remote:x", iid: 42, sha: SHA }, A);
    expect(r.ok).toBe(false);
  });
  test("reads the MR with mr:get", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    const calls: Array<{ name: string; payload: unknown }> = [];
    const pipeline = { id: "gitlab:pipeline:10", status: "success", sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: null, jobs: [] };
    const r = await watchTool({
      command: (async (name: string, payload: unknown) => {
        calls.push({ name, payload });
        return name === "mr:get" ? { ok: true, data: { mr: { iid: 42, sha: SHA, webUrl: MR, pipeline }, fetchedAt: 0 } } : { ok: true, data: [] };
      }) as any,
    }).handler({ repoName: "remote:x", iid: 42, sha: SHA }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "success" } });
    const gets = calls.filter((c) => c.name === "mr:get");
    expect(gets).toHaveLength(1);
    expect(gets[0]!.payload).toEqual({ repoName: "remote:x", iid: 42 });
  });
  test("an MR GitLab refuses returns GitLab's text", async () => {
    const r = await watchTool({ command: (async () => ({ ok: false, error: "GitLab returned 403 Forbidden: no access" })) as any })
      .handler({ repoName: "remote:x", iid: 42, sha: SHA }, A);
    expect(r.error).toContain("GitLab returned 403 Forbidden");
    expect(r.error).not.toContain("cache");
  });
  test("input bounds", async () => {
    const t = watchTool();
    expect((await t.handler({ repoName: "remote:x", iid: 42, sha: "xyz" }, A)).ok).toBe(false);
    expect((await t.handler({ repoName: "remote:x", iid: 42, sha: SHA, maxWaitSeconds: 1501 }, A)).ok).toBe(false);
    expect((await t.handler({ repoName: "remote:x", iid: 42, sha: SHA, intervalSeconds: 5 }, A)).ok).toBe(false);
    expect((await t.handler({ repoName: "remote:x", iid: 42, sha: SHA, intervalSeconds: 121 }, A)).ok).toBe(false);
    expect((await t.handler({ repoName: "remote:x", iid: 42, sha: SHA }, {})).ok).toBe(false);
  });
  test("the budget comes from the setting and is measured from the pipeline's createdAt", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    const old = { id: "gitlab:pipeline:10", status: "running", sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: new Date(-50 * 60_000).toISOString(), jobs: [] };
    const r = await watchTool({ budgetMinutes: () => 45 }, old).handler({ repoName: "remote:x", iid: 42, sha: SHA }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "running", budget: { minutes: 45, elapsedMinutes: 50, spent: true } } });
  });
  test("a budgetMinutes input overrides the setting", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    const old = { id: "gitlab:pipeline:10", status: "running", sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: new Date(-50 * 60_000).toISOString(), jobs: [] };
    const r = await watchTool({ budgetMinutes: () => 45 }, old).handler({ repoName: "remote:x", iid: 42, sha: SHA, budgetMinutes: 90, maxWaitSeconds: 0 }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "running", budget: { minutes: 90, spent: false } } });
  });
  test("budgetMinutes and extendMinutes input bounds", async () => {
    const t = watchTool();
    for (const v of [0, -5, 1.5, 10081]) {
      expect((await t.handler({ repoName: "remote:x", iid: 42, sha: SHA, budgetMinutes: v }, A)).ok).toBe(false);
    }
    for (const v of [0, 1.5, 1441]) {
      expect((await t.handler({ repoName: "remote:x", iid: 42, sha: SHA, extendMinutes: v }, A)).ok).toBe(false);
    }
  });
  test("freshWindow opens a window of the configured budget past the pipeline's age, whatever budgetMinutes says", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    const old = { id: "gitlab:pipeline:10", status: "running", sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: new Date(-200 * 60_000).toISOString(), jobs: [] };
    const r = await watchTool({ budgetMinutes: () => 60 }, old).handler({ repoName: "remote:x", iid: 42, sha: SHA, freshWindow: true, maxWaitSeconds: 0 }, A);
    expect(r).toMatchObject({ ok: true, body: { budget: { minutes: 260, elapsedMinutes: 200, spent: false } } });
  });
  test("freshWindow and extendMinutes together are refused", async () => {
    const r = await watchTool().handler({ repoName: "remote:x", iid: 42, sha: SHA, freshWindow: true, extendMinutes: 5 }, A);
    expect(r.ok).toBe(false);
  });
  test("extendMinutes opens a fresh window past the pipeline's age", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    const old = { id: "gitlab:pipeline:10", status: "running", sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: new Date(-200 * 60_000).toISOString(), jobs: [] };
    const r = await watchTool({}, old).handler({ repoName: "remote:x", iid: 42, sha: SHA, extendMinutes: 75, maxWaitSeconds: 0 }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "running", budget: { minutes: 275, elapsedMinutes: 200, spent: false } } });
  });
  test("intervalSeconds of 20 is accepted on GitLab", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    expect(await watchTool().handler({ repoName: "remote:x", iid: 42, sha: SHA, intervalSeconds: 20 }, A)).toMatchObject({ ok: true, body: { state: "success" } });
  });
  test("intervalSeconds at the 120 ceiling is accepted", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    expect(await watchTool().handler({ repoName: "remote:x", iid: 42, sha: SHA, intervalSeconds: 120 }, A)).toMatchObject({ ok: true, body: { state: "success" } });
  });
  test("the abort signal ends the call", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    const ac = new AbortController();
    const running = { id: "gitlab:pipeline:10", status: "running", sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: null, jobs: [] };
    const r = await watchTool({ sleep: async () => { ac.abort(); } }, running).handler({ repoName: "remote:x", iid: 42, sha: SHA }, A, ac.signal);
    expect(r).toMatchObject({ ok: true, body: { state: "aborted" } });
  });
});

describe("ci_watch attend", () => {
  const SHA = "a".repeat(40);
  const NEXT = "d".repeat(40);
  const MIN = 60_000;
  const pipeline = (over: Record<string, unknown> = {}) => ({ id: "gitlab:pipeline:10", status: "success", sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: null, jobs: [], ...over });
  const target = { repoName: "remote:x", iid: 42 };

  function attendDefs(world: { sha: string | null; webUrl?: string; pipeline: Record<string, unknown> | null; failed?: unknown[] }, over: Record<string, unknown> = {}, leaseOpts: Record<string, unknown> = {}) {
    const keepalive = new LeaseKeepalive({ setInterval: () => ({}), clearInterval: () => {}, leaseOpts: () => ({ dir }) });
    const defs = ciToolDefs({
      leaseOpts: () => ({ dir, ...leaseOpts }),
      label: () => undefined,
      watch: {
        resolve: async () => ({ ok: true, identity: "remote:x", iid: 42 }),
        command: (async (name: string) => {
          if (name === "mr:get") return { ok: true, data: { mr: { iid: 42, sha: world.sha, webUrl: world.webUrl ?? MR, sourceBranch: "feat", pipeline: world.pipeline }, fetchedAt: 0 } };
          if (name === "mr:pipeline-failed-jobs") return { ok: true, data: world.failed ?? [] };
          if (name === "mr:fetch-job-trace") return { ok: true, data: "boom" };
          return { ok: true, data: [] };
        }) as any,
        now: () => 0,
        sleep: async () => {},
        budgetMinutes: () => 75,
        keepalive,
        stateOpts: () => ({ dir }),
        ...over,
      },
    });
    const get = (name: string) => defs.find((x) => x.name === name)!;
    return { watch: get("ci_watch"), release: get("ci_lease_release"), keepalive };
  }
  const state = () => JSON.parse(readFileSync(watchStatePath(MR, { dir }), "utf8"));

  test("the first attend call claims the lease with the source branch, persists held, and counts no re-claim", async () => {
    const { watch, keepalive } = attendDefs({ sha: SHA, pipeline: pipeline() });
    const r = await watch.handler({ ...target, sha: SHA, attend: true }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "success", lease: { owner: "session:aaa" } } });
    expect(readCiLease(MR, { dir }).lease).toMatchObject({ owner: "session:aaa", holder: "watch-ci", branch: "feat" });
    expect(state()).toMatchObject({ sha: SHA, held: true, heldBy: "session:aaa", reclaims: 0, pipelineId: 10, pipelineStatus: "success", lastResult: "success" });
    expect(keepalive.size()).toBe(1);
  });
  test("holder doctor claims as doctor", async () => {
    const { watch } = attendDefs({ sha: SHA, pipeline: pipeline() });
    await watch.handler({ ...target, sha: SHA, attend: true, holder: "doctor" }, A);
    expect(readCiLease(MR, { dir }).lease).toMatchObject({ owner: "session:aaa", holder: "doctor" });
  });
  test("a vanished lease is re-claimed twice, then the watch ends lease_unavailable", async () => {
    let clock = 0;
    const { watch } = attendDefs({ sha: SHA, pipeline: pipeline({ status: "running" }) }, {
      now: () => clock,
      sleep: async (ms: number) => { clock += ms; releaseCiLease(MR, "session:aaa", { dir }); },
    });
    const r = await watch.handler({ ...target, sha: SHA, attend: true, maxWaitSeconds: 300 }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "lease_unavailable", polls: 4, lease: null } });
    expect(typeof (r as any).body.error).toBe("string");
    expect(state()).toMatchObject({ held: true, reclaims: 2, lastResult: null });
  });
  test("a lease held through heartbeats counts its first vanishing as a re-claim", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    let clock = 0;
    const { watch } = attendDefs({ sha: SHA, pipeline: pipeline({ status: "running" }) }, {
      now: () => clock,
      sleep: async (ms: number) => { clock += ms; releaseCiLease(MR, "session:aaa", { dir }); },
    });
    const r = await watch.handler({ ...target, sha: SHA, attend: true, maxWaitSeconds: 300 }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "lease_unavailable", polls: 4 } });
    expect(state()).toMatchObject({ held: true, reclaims: 2 });
  });
  const busyLock = () => writeFileSync(join(dir, ciLeaseFileName(MR).replace(/\.json$/, ".lock")), JSON.stringify({ token: "someone-else", at: Date.now() }));
  test("a heartbeat behind a busy lock keeps polling while this session's lease is still fresh", async () => {
    claimCiLease({ mrUrl: MR, owner: "session:aaa", holder: "watch-ci" }, { dir });
    busyLock();
    const { watch } = attendDefs({ sha: SHA, pipeline: pipeline() }, {}, { lockWaitMs: 10, lockStaleMs: 60_000 });
    const r = await watch.handler({ ...target, sha: SHA, attend: true }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "success", lease: { owner: "session:aaa" } } });
    expect(state()).toMatchObject({ held: true, lastResult: "success" });
  });
  test("a heartbeat behind a busy lock with no fresh lease of this session's ends lease_unavailable and drops the keepalive", async () => {
    claimCiLease({ mrUrl: MR, owner: "session:aaa", holder: "watch-ci", ttlSeconds: 60 }, { dir, now: () => 0 });
    busyLock();
    const { watch, keepalive } = attendDefs({ sha: SHA, pipeline: pipeline() }, {}, { lockWaitMs: 10, lockStaleMs: 60_000 });
    keepalive.touch(MR, "session:aaa");
    const r = await watch.handler({ ...target, sha: SHA, attend: true }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "lease_unavailable" } });
    expect((r as any).body.error).toMatch(/lease lock busy/);
    expect(keepalive.size()).toBe(0);
  });
  test("a session taking over a stale foreign lease inherits the window and starts its own re-claim count", async () => {
    const world = { sha: SHA, pipeline: pipeline({ status: "running", createdAt: new Date(-200 * MIN).toISOString() }) };
    const a = attendDefs(world);
    expect(await a.watch.handler({ ...target, sha: SHA, attend: true, extendMinutes: 30, maxWaitSeconds: 0 }, A)).toMatchObject({ body: { budget: { minutes: 230 } } });
    writeWatchState({ ...state(), reclaims: 2 }, { dir });
    const b = attendDefs(world);
    expect(await b.watch.handler({ ...target, sha: SHA, attend: true, maxWaitSeconds: 0 }, B)).toMatchObject({ ok: true, body: { state: "stood_down", holder: { owner: "session:aaa" } } });
    expect(state()).toMatchObject({ reclaims: 2 });
    claimCiLease({ mrUrl: MR, owner: "session:aaa", holder: "watch-ci", ttlSeconds: 60 }, { dir, now: () => 0 });
    const r = await b.watch.handler({ ...target, sha: SHA, attend: true, maxWaitSeconds: 0 }, B);
    expect(r).toMatchObject({ ok: true, body: { state: "running", lease: { owner: "session:bbb" }, budget: { minutes: 230, spent: false } } });
    expect(state()).toMatchObject({ held: true, reclaims: 0, budgetMinutes: 230, pipelineId: 10 });
    expect(readCiLease(MR, { dir }).lease).toMatchObject({ owner: "session:bbb" });
  });
  test("a new session after another's release gets a free first claim and keeps the window", async () => {
    const world = { sha: SHA, pipeline: pipeline({ status: "running", createdAt: new Date(-200 * MIN).toISOString() }) };
    const a = attendDefs(world);
    await a.watch.handler({ ...target, sha: SHA, attend: true, extendMinutes: 30, maxWaitSeconds: 0 }, A);
    writeWatchState({ ...state(), reclaims: 2 }, { dir });
    await a.release.handler({ mrUrl: MR }, A);
    const b = attendDefs(world);
    const r = await b.watch.handler({ ...target, sha: SHA, attend: true, maxWaitSeconds: 0 }, B);
    expect(r).toMatchObject({ ok: true, body: { state: "running", lease: { owner: "session:bbb" }, budget: { minutes: 230 } } });
    expect(state()).toMatchObject({ held: true, heldBy: "session:bbb", reclaims: 0, budgetMinutes: 230 });
  });
  test("a fresh foreign lease is stood_down with its holder, and nothing is written", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, B);
    const { watch, keepalive } = attendDefs({ sha: SHA, pipeline: pipeline() });
    const r = await watch.handler({ ...target, sha: SHA, attend: true }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "stood_down", holder: { owner: "session:bbb" }, lease: null } });
    expect(readCiLease(MR, { dir }).lease).toMatchObject({ owner: "session:bbb" });
    expect(existsSync(watchStatePath(MR, { dir }))).toBe(false);
    expect(keepalive.size()).toBe(0);
  });
  test("underBoardLease with attend and no board lease is stood_down and claims nothing", async () => {
    const { watch, keepalive } = attendDefs({ sha: SHA, pipeline: pipeline() });
    const r = await watch.handler({ ...target, sha: SHA, attend: true, underBoardLease: true }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "stood_down", holder: null } });
    expect(readCiLease(MR, { dir })).toEqual({ lease: null, stale: null });
    expect(existsSync(watchStatePath(MR, { dir }))).toBe(false);
    expect(keepalive.size()).toBe(0);
  });
  test("underBoardLease with attend under a fresh board doctor lease writes the state and never touches the lease or keepalive", async () => {
    const claimed = claimCiLease({ mrUrl: MR, owner: boardDoctorOwner(MR), holder: "doctor" }, { dir });
    const { watch, keepalive } = attendDefs({ sha: SHA, pipeline: pipeline() });
    const r = await watch.handler({ ...target, sha: SHA, attend: true, underBoardLease: true }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "success" } });
    expect(readCiLease(MR, { dir }).lease?.heartbeatAt).toBe(claimed.claimed ? claimed.lease.heartbeatAt : -1);
    expect(state()).toMatchObject({ held: false, lastResult: "success" });
    expect(keepalive.size()).toBe(0);
  });
  test("a second call with no budgetMinutes reuses the persisted extension", async () => {
    const world = { sha: SHA, pipeline: pipeline({ status: "running", createdAt: new Date(-200 * MIN).toISOString() }) };
    const { watch } = attendDefs(world);
    const r1 = await watch.handler({ ...target, sha: SHA, attend: true, extendMinutes: 30, maxWaitSeconds: 0 }, A);
    expect(r1).toMatchObject({ ok: true, body: { state: "running", budget: { minutes: 230, spent: false } } });
    const r2 = await watch.handler({ ...target, sha: SHA, attend: true, maxWaitSeconds: 0 }, A);
    expect(r2).toMatchObject({ ok: true, body: { state: "running", budget: { minutes: 230, spent: false } } });
  });
  test("a pipeline that last failed and runs again with no failed job reopens the window", async () => {
    const job = { id: "gitlab:job:7", name: "unit", stage: "test", status: "failed", allowFailure: false, webUrl: null };
    const world = { sha: SHA, pipeline: pipeline({ status: "running", createdAt: new Date(-200 * MIN).toISOString() }), failed: [job] as unknown[] };
    const { watch } = attendDefs(world);
    expect(await watch.handler({ ...target, sha: SHA, attend: true }, A)).toMatchObject({ body: { state: "failed" } });
    world.failed = [];
    const r = await watch.handler({ ...target, sha: SHA, attend: true, maxWaitSeconds: 0 }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "running", budget: { minutes: 275, spent: false } } });
  });
  test("the no_pipeline clock persists across calls", async () => {
    let clock = 0;
    const { watch } = attendDefs({ sha: SHA, pipeline: null }, { now: () => clock });
    expect(await watch.handler({ ...target, sha: SHA, attend: true, maxWaitSeconds: 0 }, A)).toMatchObject({ body: { state: "waiting" } });
    expect(state()).toMatchObject({ waitingSince: 0 });
    clock = 10 * MIN;
    expect(await watch.handler({ ...target, sha: SHA, attend: true, maxWaitSeconds: 0 }, A)).toMatchObject({ body: { state: "no_pipeline", pushed: true, remoteSha: SHA } });
  });
  test("a new sha carries the old commit's pipeline id as its priorPipelineId", async () => {
    const world: { sha: string; pipeline: Record<string, unknown> } = { sha: SHA, pipeline: pipeline() };
    const { watch } = attendDefs(world);
    await watch.handler({ ...target, sha: SHA, attend: true }, A);
    world.sha = NEXT;
    world.pipeline = pipeline({ id: "gitlab:pipeline:12", sha: "m".repeat(40), mergeRequestEventType: "merge_train" });
    const r = await watch.handler({ ...target, sha: NEXT, attend: true }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "success", pipeline: { id: "gitlab:pipeline:12" } } });
    expect(state()).toMatchObject({ sha: NEXT, priorPipelineId: 10, pipelineId: 12 });
  });
  test("holder without attend is an error", async () => {
    const { watch } = attendDefs({ sha: SHA, pipeline: pipeline() });
    const r = await watch.handler({ ...target, sha: SHA, holder: "doctor" }, A);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("attend");
  });
  test("an unknown holder is an error", async () => {
    const { watch } = attendDefs({ sha: SHA, pipeline: pipeline() });
    expect((await watch.handler({ ...target, sha: SHA, attend: true, holder: "x" }, A)).ok).toBe(false);
  });
  test("ci_lease_release drops this session's keepalive entry", async () => {
    const { watch, release, keepalive } = attendDefs({ sha: SHA, pipeline: pipeline() });
    await watch.handler({ ...target, sha: SHA, attend: true }, A);
    expect(keepalive.size()).toBe(1);
    expect(await release.handler({ mrUrl: MR }, A)).toMatchObject({ ok: true, body: { released: true } });
    expect(keepalive.size()).toBe(0);
  });
  test("a call without attend writes no state file and touches no keepalive", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    const { watch, keepalive } = attendDefs({ sha: SHA, pipeline: pipeline() });
    expect(await watch.handler({ ...target, sha: SHA }, A)).toMatchObject({ ok: true, body: { state: "success" } });
    expect(existsSync(watchStatePath(MR, { dir }))).toBe(false);
    expect(keepalive.size()).toBe(0);
  });
});

describe("ci_watch on GitHub", () => {
  const SHA = "c".repeat(40);
  const PR = "https://github.com/acme/proj/pull/42";
  const MIN = 60_000;
  const target = { repoName: "remote:x", iid: 42 };
  const ANCHOR_AT = new Date(-5 * MIN).toISOString();
  type Call = { name: string; payload: Record<string, any> };
  type World = { sha: string; status: string; jobs: Array<Record<string, unknown>>; required: string[]; runs: Array<{ id: number; createdAt: string }> };
  const check = (name: string, status: string, over: Record<string, unknown> = {}) => ({
    id: `github:check:${name.length * 11}`, name, stage: "checks", status, allowFailure: false, duration: null, webUrl: null, runId: "901", ...over,
  });
  const world = (over: Partial<World> = {}): World => ({
    sha: SHA, status: "running", jobs: [check("checks", "running")], required: ["checks"],
    runs: [{ id: 901, createdAt: new Date(-2 * MIN).toISOString() }, { id: 900, createdAt: ANCHOR_AT }], ...over,
  });

  beforeEach(() => { __resetMemoryFacts(); });

  function ghDefs(w: World, over: Record<string, unknown> = {}) {
    const calls: Call[] = [];
    const resolveArgs: unknown[][] = [];
    const keepalive = new LeaseKeepalive({ setInterval: () => ({}), clearInterval: () => {}, leaseOpts: () => ({ dir }) });
    const defs = ciToolDefs({
      leaseOpts: () => ({ dir }),
      label: () => undefined,
      watch: {
        resolve: (async (...args: unknown[]) => { resolveArgs.push(args); return { ok: true, identity: "remote:x", iid: 42 }; }) as any,
        command: (async (name: string, payload: Record<string, any>) => {
          calls.push({ name, payload });
          if (name === "mr:get") {
            const pipeline = { id: "github:run:901", status: w.status, sha: w.sha, ref: "feat", mergeRequestEventType: null, webUrl: `${PR}/checks`, createdAt: null, jobs: w.jobs, runIds: ["900", "901"] };
            return { ok: true, data: { mr: { iid: 42, sha: w.sha, webUrl: PR, sourceBranch: "feat", targetBranch: "main", pipeline }, fetchedAt: 0 } };
          }
          if (name === "forge:get") {
            const body = payload.path.startsWith(":repo/rules/branches/")
              ? [{ type: "required_status_checks", parameters: { required_status_checks: w.required.map((context) => ({ context })) } }]
              : null;
            return { ok: true, data: { status: body ? 200 : 404, body, truncated: false, nextPage: null, totalPages: null } };
          }
          if (name === "pipeline:list") {
            return { ok: true, data: { pipelines: w.runs.map((r) => ({ id: r.id, status: "running", ref: "feat", sha: w.sha, source: "pull_request", webUrl: null, createdAt: r.createdAt })) } };
          }
          if (name === "mr:fetch-job-trace") return { ok: true, data: "boom\nreal failure" };
          return { ok: true, data: [] };
        }) as any,
        now: () => 0,
        sleep: async () => {},
        budgetMinutes: () => 75,
        keepalive,
        stateOpts: () => ({ dir }),
        ...over,
      },
    });
    return { watch: defs.find((x) => x.name === "ci_watch")!, calls, resolveArgs };
  }
  const claim = () => tool("ci_lease_claim").handler({ mrUrl: PR }, A);
  const perCommit = (calls: Call[]) => calls.filter((c) => c.name === "forge:get" || c.name === "pipeline:list");

  test("a PR going running then success settles on success under the anchor run's id", async () => {
    await claim();
    let clock = 0;
    const w = world();
    const { watch } = ghDefs(w, {
      now: () => clock,
      sleep: async (ms: number) => { clock += ms; w.status = "success"; w.jobs = [check("checks", "success")]; },
    });
    const r = await watch.handler({ ...target, sha: SHA }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "success", pipeline: { id: "github:run:900", createdAt: ANCHOR_AT }, polls: 2 } });
  });
  test("an optional failed check beside a successful required one is success with no blocking failure", async () => {
    await claim();
    const { watch } = ghDefs(world({ status: "success", jobs: [check("checks", "success"), check("lint", "failed", { allowFailure: true })] }));
    const r = await watch.handler({ ...target, sha: SHA }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "success", blockingFailures: 0, failedJobs: [{ name: "lint", allowFailure: true }] } });
  });
  test("a required failed check is failed with its trace tail", async () => {
    await claim();
    const { watch, calls } = ghDefs(world({ status: "failed", jobs: [check("checks", "failed", { id: "github:check:77" })] }));
    const r = await watch.handler({ ...target, sha: SHA }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "failed", blockingFailures: 1, failedJobs: [{ jobId: 77, name: "checks", stage: "checks", allowFailure: false }] } });
    expect((r as any).body.failedJobs[0].traceTail).toContain("boom");
    expect(calls.filter((c) => c.name === "mr:fetch-job-trace").map((c) => c.payload)).toEqual([{ repoName: "remote:x", iid: 42, jobId: 77 }]);
    expect(calls.some((c) => c.name === "mr:pipeline-failed-jobs")).toBe(false);
  });
  test("with attend, a run still going past the budget from the anchor is timeout", async () => {
    const { watch } = ghDefs(world({ runs: [{ id: 900, createdAt: new Date(-80 * MIN).toISOString() }] }));
    const r = await watch.handler({ ...target, sha: SHA, attend: true }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "timeout", budget: { minutes: 75, elapsedMinutes: 80, spent: true } } });
  });
  test("the first poll goes through the head: an unreported required check and an optional red one are never failed", async () => {
    await claim();
    const { watch } = ghDefs(world({ status: "failed", jobs: [check("lint", "failed")] }));
    const r = await watch.handler({ ...target, sha: SHA, maxWaitSeconds: 0 }, A);
    expect(r.ok).toBe(true);
    expect(["running", "waiting"]).toContain((r as any).body.state);
    expect((r as any).body.blockingFailures).toBe(0);
  });
  test("with attend, the per-commit reads persist in the watch state and the next call reads neither again", async () => {
    const w = world({ status: "success", jobs: [check("checks", "success")] });
    const { watch, calls } = ghDefs(w);
    expect(await watch.handler({ ...target, sha: SHA, attend: true }, A)).toMatchObject({ ok: true, body: { state: "success" } });
    expect(perCommit(calls).length).toBeGreaterThan(0);
    __resetMemoryFacts();
    const before = calls.length;
    expect(await watch.handler({ ...target, sha: SHA, attend: true }, A)).toMatchObject({ ok: true, body: { state: "success", pipeline: { id: "github:run:900" } } });
    expect(perCommit(calls.slice(before))).toEqual([]);
    const st = JSON.parse(readFileSync(watchStatePath(PR, { dir }), "utf8"));
    expect(st.github).toMatchObject({ required: ["checks"], anchor: { runId: 900, createdAt: Date.parse(ANCHOR_AT) } });
  });
  test("without attend, a second call for the same commit reads neither per-commit fact again, even after a short sha", async () => {
    await claim();
    const { watch, calls } = ghDefs(world({ status: "success", jobs: [check("checks", "success")] }));
    await watch.handler({ ...target, sha: SHA.slice(0, 8) }, A);
    const before = calls.length;
    expect(await watch.handler({ ...target, sha: SHA }, A)).toMatchObject({ ok: true, body: { state: "success", pipeline: { id: "github:run:900" } } });
    expect(perCommit(calls.slice(before))).toEqual([]);
  });
  test("intervalSeconds defaults to 60 on GitHub", async () => {
    await claim();
    let clock = 0;
    const sleeps: number[] = [];
    const w = world();
    const { watch } = ghDefs(w, {
      now: () => clock,
      sleep: async (ms: number) => { sleeps.push(ms); clock += ms; w.status = "success"; w.jobs = [check("checks", "success")]; },
    });
    expect(await watch.handler({ ...target, sha: SHA }, A)).toMatchObject({ ok: true, body: { state: "success" } });
    expect(sleeps).toEqual([60_000]);
  });
  test("intervalSeconds below 30 on GitHub is an error naming 30 to 120", async () => {
    await claim();
    const { watch } = ghDefs(world());
    for (const input of [{ ...target, sha: SHA, intervalSeconds: 20 }, { mrUrl: PR, sha: SHA, intervalSeconds: 20 }]) {
      const r = await watch.handler(input, A);
      expect(r.ok).toBe(false);
      expect(r.error).toContain("30 to 120");
    }
  });
  test("a PR URL resolves with github: true", async () => {
    await claim();
    const { watch, resolveArgs } = ghDefs(world({ status: "success", jobs: [check("checks", "success")] }));
    expect(await watch.handler({ mrUrl: PR, sha: SHA }, A)).toMatchObject({ ok: true, body: { state: "success" } });
    expect(resolveArgs).toHaveLength(1);
    expect(resolveArgs[0]![1]).toEqual({ github: true });
  });

  describe("resolving a PR URL", () => {
    const origHome = process.env.HOME;
    let home: string;
    beforeEach(() => {
      home = realpathSync(mkdtempSync(join(tmpdir(), "rt-ci-watch-gh-")));
      process.env.HOME = home;
      closeStateDb();
    });
    afterEach(() => {
      process.env.HOME = origHome;
      closeStateDb();
      rmSync(home, { recursive: true, force: true });
    });
    test("a PR URL for an unregistered repo is the resolver's registration error, not MR_URL_SHAPE", async () => {
      const { watch } = ghDefs(world(), { resolve: resolveMrTarget });
      const r = await watch.handler({ mrUrl: PR, sha: SHA }, A);
      expect(r.ok).toBe(false);
      expect(r.error).not.toBe(MR_URL_SHAPE);
      expect(r.error).toContain("not registered with rt");
    });
  });
});

describe("ci_triage", () => {
  const GITHUB_URL = "https://github.com/acme/proj/pull/42";
  const settings: Record<string, unknown> = {
    "ci.triage.realPatterns": ["SETTINGS_BOOM"],
    "ci.triage.infraPatterns": [],
    "ci.triage.noisyJobs": [],
    "ci.triage.baseDepth": 3,
    "ci.triage.skipBase": false,
  };
  const body = (b: unknown) => ({ ok: true, data: { status: 200, body: b, truncated: false, nextPage: null, totalPages: null } });

  function triageTool(mr: Record<string, unknown> | null = {}) {
    const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const command = (async (name: string, payload: Record<string, unknown>) => {
      calls.push({ name, payload });
      if (name === "mr:get") {
        return { ok: true, data: { mr: { iid: 42, targetBranch: "main", webUrl: MR, pipeline: { id: "gitlab:pipeline:10", status: "failed", jobs: [] }, ...mr }, fetchedAt: 0 } };
      }
      if (name === "mr:fetch-job-trace") return { ok: true, data: "SETTINGS_BOOM in unit\nINLINE_BOOM in unit\n" };
      const path = payload.path as string;
      if (path === "/projects/:id/pipelines/10") return body({ id: 10, status: "failed", web_url: null, sha: "abc", ref: "feat", project_id: 1 });
      if (path === "/projects/:id/pipelines/10/jobs") return body([{ id: 5, name: "unit", stage: "test", status: "failed", allow_failure: false, retried: false }]);
      if (path === "/projects/:id/pipelines/10/bridges") return body([]);
      return { ok: false, error: `unrouted ${name} ${path}` };
    }) as any;
    const t = ciToolDefs({
      triage: { command, resolve: async () => ({ ok: true, identity: "remote:x", iid: 42 }), readSetting: (k) => settings[k] },
    }).find((x) => x.name === "ci_triage")!;
    return { t, calls };
  }
  const target = { repoName: "remote:x", iid: 42, noBase: true };

  test("declares no shell form and names why", () => {
    expect(triageTool().t.shellForms).toEqual({ none: expect.stringContaining("wave 3") });
  });
  describe("on GitHub", () => {
    const SHA = "D".repeat(40);
    const ghCheck = (id: number, name: string, status: string, runId: string | null) => ({
      id: `github:check:${id}`, name, stage: "checks", status, allowFailure: false, duration: null, webUrl: null, runId,
    });
    beforeEach(() => { __resetMemoryFacts(); });

    function ghTriageTool(over: { settings?: Record<string, unknown>; traces?: Record<number, string> } = {}) {
      const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
      const resolveArgs: unknown[][] = [];
      const traces: Record<number, string> = { 71: "Tests: 3 failed\n", 44: "lint broke\n", ...over.traces };
      const command = (async (name: string, payload: Record<string, unknown>) => {
        calls.push({ name, payload });
        if (name === "mr:get") {
          const pipeline = {
            id: "github:run:901", status: "failed", sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: `${GITHUB_URL}/checks`, createdAt: null,
            jobs: [ghCheck(71, "unit", "failed", "901"), ghCheck(44, "lint", "failed", "902")],
          };
          return { ok: true, data: { mr: { iid: 42, sha: SHA, webUrl: GITHUB_URL, sourceBranch: "feat", targetBranch: "main", pipeline }, fetchedAt: 0 } };
        }
        if (name === "forge:get") {
          const path = payload.path as string;
          if (path === ":repo") return body({ default_branch: "main" });
          if (path.startsWith(":repo/rules/branches/")) return body([{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "unit" }] } }]);
          if (path.startsWith(":repo/branches/")) return { ok: true, data: { status: 404, body: null, truncated: false, nextPage: null, totalPages: null } };
        }
        if (name === "pipeline:list") {
          const rows = payload.sha
            ? [{ id: 901, status: "failed", ref: "feat", sha: SHA, source: "pull_request", webUrl: null, createdAt: "2026-11-11T10:00:05Z" },
               { id: 900, status: "failed", ref: "feat", sha: SHA, source: "pull_request", webUrl: null, createdAt: "2026-11-11T10:00:00Z" }]
            : [{ id: 700, status: "failed", ref: "main", sha: "b".repeat(40), source: "push", webUrl: null, createdAt: "2026-11-10T10:00:00Z" }];
          return { ok: true, data: { pipelines: rows } };
        }
        if (name === "mr:pipeline-failed-jobs" && payload.pipelineId === 700) return { ok: true, data: [ghCheck(500, "unit", "failed", "700")] };
        if (name === "mr:fetch-job-trace") return { ok: true, data: traces[payload.jobId as number] ?? "" };
        return { ok: false, error: `unrouted ${name} ${String(payload.path ?? "")}` };
      }) as any;
      const merged = { ...settings, ...over.settings };
      const t = ciToolDefs({
        triage: {
          command,
          resolve: (async (...args: unknown[]) => { resolveArgs.push(args); return { ok: true, identity: "remote:x", iid: 42 }; }) as any,
          readSetting: (k) => merged[k],
        },
      }).find((x) => x.name === "ci_triage")!;
      return { t, calls, resolveArgs };
    }

    test("a required failure that also failed on a base commit is REAL and INHERITED", async () => {
      const { t, calls, resolveArgs } = ghTriageTool();
      const r = await t.handler({ mrUrl: GITHUB_URL }, A);
      expect(resolveArgs[0]![1]).toEqual({ github: true });
      expect(r).toMatchObject({ ok: true, body: { state: "triaged", pipeline: { id: 900, status: "failed", webUrl: `${GITHUB_URL}/checks`, sha: SHA, ref: "feat" } } });
      const b = r.body as any;
      expect(b.blocking).toHaveLength(1);
      expect(b.blocking[0]).toMatchObject({ name: "unit", jobId: 71, pipelineId: 901, verdict: "REAL", ownership: "INHERITED", inheritedOn: ["main"] });
      expect(b.base).toEqual({ refs: ["main"], scanned: 1, off: false });
      expect(calls.filter((c) => c.name === "pipeline:list" && !c.payload.sha).map((c) => c.payload)).toEqual([{ repoName: "remote:x", ref: "main", limit: 100 }]);
    });

    test("an optional failed check lands in nonBlocking", async () => {
      const { t } = ghTriageTool();
      const b = (await t.handler({ mrUrl: GITHUB_URL }, A)).body as any;
      expect(b.nonBlocking).toHaveLength(1);
      expect(b.nonBlocking[0]).toMatchObject({ name: "lint", jobId: 44, pipelineId: 902, blocking: false });
    });

    test("a team infra pattern read through the settings turns a matching log INFRA", async () => {
      const { t } = ghTriageTool({ settings: { "ci.triage.infraPatterns": ["flaky-runner"] }, traces: { 71: "step died on flaky-runner 3\n" } });
      const b = (await t.handler({ mrUrl: GITHUB_URL, noBase: true }, A)).body as any;
      expect(b.blocking[0]).toMatchObject({ name: "unit", verdict: "INFRA", infraHits: ["step died on flaky-runner 3"] });
      expect(b.summary.allInfraBlocking).toBe(true);
    });

    test("pipelineId equal to the head's anchor id triages the head", async () => {
      const { t, calls } = ghTriageTool();
      const r = await t.handler({ mrUrl: GITHUB_URL, pipelineId: 900, noBase: true }, A);
      expect(r).toMatchObject({ ok: true, body: { state: "triaged", pipeline: { id: 900 } } });
      expect((r.body as any).blocking.map((j: any) => j.jobId)).toEqual([71]);
      expect(calls.some((c) => c.name === "mr:pipeline-failed-jobs")).toBe(false);
      expect(calls.some((c) => c.name === "forge:get" && String(c.payload.path).includes("actions/runs"))).toBe(false);
    });
  });
  test("a store-set baseDepth out of range is a tool error naming the key, before any read", async () => {
    settings["ci.triage.baseDepth"] = 0;
    try {
      const { t, calls } = triageTool();
      const r = await t.handler(target, A);
      expect(r).toMatchObject({ ok: false, error: expect.stringContaining("ci.triage.baseDepth") });
      expect(calls).toEqual([]);
    } finally {
      settings["ci.triage.baseDepth"] = 3;
    }
  });
  test("with no pipelineId it triages the head pipeline", async () => {
    const { t, calls } = triageTool();
    const r = await t.handler(target, A);
    expect(r).toMatchObject({ ok: true, body: { state: "triaged", pipeline: { id: 10 } } });
    expect((r.body as any).next).toContain("mr_job_trace");
    expect((r.body as any).next).toContain("mr_retry");
    expect(calls.some((c) => c.payload.path === "/projects/:id/pipelines/10")).toBe(true);
  });
  test("an explicit pipelineId beats the head pipeline", async () => {
    const { t, calls } = triageTool();
    await t.handler({ ...target, pipelineId: 77 }, A);
    expect(calls.some((c) => c.payload.path === "/projects/:id/pipelines/77")).toBe(true);
  });
  test("the MR has no pipeline and none is passed is a tool error", async () => {
    const { t } = triageTool({ pipeline: null });
    const r = await t.handler(target, A);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("the MR has no pipeline; pass pipelineId");
  });
  test("settings patterns and inline config patterns both reach the engine", async () => {
    const { t } = triageTool();
    const r = await t.handler({ ...target, config: { "real-patterns": ["INLINE_BOOM"], description: "ignored" } }, A);
    const job = (r.body as any).blocking[0];
    expect(job.realHits).toEqual(["SETTINGS_BOOM in unit", "INLINE_BOOM in unit"]);
    expect(job.verdict).toBe("REAL");
  });
  test("a bad inline config is a tool error", async () => {
    const { t } = triageTool();
    const r = await t.handler({ ...target, config: { "base-depth": 99 } }, A);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("base-depth");
  });
  test("a config that is not an object is a tool error", async () => {
    const { t } = triageTool();
    expect((await t.handler({ ...target, config: "x" }, A)).ok).toBe(false);
    expect((await t.handler({ ...target, config: [] }, A)).ok).toBe(false);
  });
  test("a pipeline GitLab does not know is a tool error", async () => {
    const { t } = triageTool();
    const r = await t.handler({ ...target, pipelineId: 404 }, A);
    expect(r.ok).toBe(false);
  });
});

describe("ci tool descriptions", () => {
  test("ci_watch and ci_triage take a GitHub PR URL and no longer say GitLab only", () => {
    const defs = ciToolDefs({ leaseOpts: () => ({}), label: () => "alice" });
    for (const name of ["ci_watch", "ci_triage"]) {
      const d = defs.find((t) => t.name === name)!.description;
      expect(d, name).not.toContain("GitLab only");
      expect(d, name).not.toContain("unsupported_forge");
      expect(d, name).toContain(PR_URL_NOTE);
    }
  });
});

describe("abortableSleep", () => {
  test("resolves early on abort, not at the full timeout, and leaves no abort listener afterward", async () => {
    const ac = new AbortController();
    const start = Date.now();
    const p = abortableSleep(10_000, ac.signal);
    ac.abort();
    await p;
    expect(Date.now() - start).toBeLessThan(200);
    expect(getEventListeners(ac.signal, "abort")).toHaveLength(0);
  });
  test("resolves immediately for an already-aborted signal, with no listener added", async () => {
    const ac = new AbortController();
    ac.abort();
    const start = Date.now();
    await abortableSleep(10_000, ac.signal);
    expect(Date.now() - start).toBeLessThan(50);
    expect(getEventListeners(ac.signal, "abort")).toHaveLength(0);
  });
  test("leaves no abort listener after resolving normally, with no abort at all", async () => {
    const ac = new AbortController();
    await abortableSleep(5, ac.signal);
    expect(getEventListeners(ac.signal, "abort")).toHaveLength(0);
  });
});
