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
        projectMrs: (async () => ({ ok: true, data: { mrs: { a: { pr: { iid: 42, sha: SHA, webUrl: MR, pipeline }, fetchedAt: 0 } }, syncedAt: 1 } })) as any,
        command: (async () => ({ ok: true, data: [] })) as any,
        now: () => 0,
        sleep: async () => {},
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
      projectMrs: (async () => ({
        ok: true,
        data: {
          mrs: { a: { pr: { iid: 42, sha: SHA, webUrl: "https://github.com/acme/proj/pull/42", pipeline: { id: "gitlab:pipeline:10", status: "success", sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: null, jobs: [] } }, fetchedAt: 0 } },
          syncedAt: 1,
        },
      })) as any,
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
        projectMrs: (async () => ({ ok: true, data: { mrs: { a: { pr: { iid: 42, sha: SHA, webUrl: MR, pipeline: { id: "gitlab:pipeline:10", status: "success", sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: null, jobs: [] } }, fetchedAt: 0 } }, syncedAt: 1 } })) as any,
        command: (async () => ({ ok: true, data: [] })) as any,
        now: () => 0,
        sleep: async () => {},
      },
    }).find((x) => x.name === "ci_watch")!;
    const r = await t.handler({ repoName: "remote:x", iid: 42, sha: SHA }, A);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lease lock busy/);
  });
  test("a cached pipeline missing sha, ref and mergeRequestEventType reads as a branch pipeline with no match, and never throws", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    const bare = { id: "gitlab:pipeline:10", status: "running", webUrl: null, createdAt: null, jobs: [] };
    const r = await watchTool({}, bare).handler({ repoName: "remote:x", iid: 42, sha: SHA, maxWaitSeconds: 0 }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "waiting", pipeline: { sha: null, ref: null, mergeRequestEventType: null } } });
    expect((r as any).body.next).toContain("no pipeline for the pushed sha yet");
  });
  test("daemon error surfaces", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    const r = await watchTool({ projectMrs: (async () => ({ ok: false, error: "daemon down" })) as any }).handler({ repoName: "remote:x", iid: 42, sha: SHA }, A);
    expect(r.ok).toBe(false);
  });
  test("input bounds", async () => {
    const t = watchTool();
    expect((await t.handler({ repoName: "remote:x", iid: 42, sha: "xyz" }, A)).ok).toBe(false);
    expect((await t.handler({ repoName: "remote:x", iid: 42, sha: SHA, maxWaitSeconds: 1801 }, A)).ok).toBe(false);
    expect((await t.handler({ repoName: "remote:x", iid: 42, sha: SHA, intervalSeconds: 5 }, A)).ok).toBe(false);
    expect((await t.handler({ repoName: "remote:x", iid: 42, sha: SHA, intervalSeconds: 121 }, A)).ok).toBe(false);
    expect((await t.handler({ repoName: "remote:x", iid: 42, sha: SHA }, {})).ok).toBe(false);
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
