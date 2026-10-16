import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getEventListeners } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ciLeaseFileName } from "../../../packages/rt-client/src/index.ts";
import { abortableSleep, ciToolDefs } from "../ci-tools.ts";

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
  test("refuses a GitHub-shaped MR", async () => {
    const t = watchTool({
      command: (async (name: string) => (name === "mr:get"
        ? { ok: true, data: { mr: { iid: 42, sha: SHA, webUrl: "https://github.com/acme/proj/pull/42", pipeline: { id: "gitlab:pipeline:10", status: "success", sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: null, jobs: [] } }, fetchedAt: 0 } }
        : { ok: true, data: [] })) as any,
    });
    const r = await t.handler({ repoName: "remote:x", iid: 42, sha: SHA }, A);
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/GitLab only/);
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
  test("a GitHub MR returns unsupported_forge after the mr:get read and nothing else", async () => {
    const { t, calls } = triageTool({ webUrl: GITHUB_URL });
    const r = await t.handler(target, A);
    expect(r).toMatchObject({ ok: true, body: { state: "unsupported_forge", forge: "github" } });
    expect(typeof (r.body as any).next).toBe("string");
    expect(calls.map((c) => c.name)).toEqual(["mr:get"]);
  });
  test("a github: head pipeline id is unsupported_forge too", async () => {
    const { t } = triageTool({ pipeline: { id: "github:run:3", status: "failed", jobs: [] } });
    expect(await t.handler(target, A)).toMatchObject({ body: { state: "unsupported_forge", forge: "github" } });
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
