import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ciLeaseFileName } from "../../../packages/rt-client/src/index.ts";
import { ciToolDefs } from "../ci-tools.ts";

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
});
