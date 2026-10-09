import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallerContext, NativeSessionRef, Outcome, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { ciLeaseFileName, claimCiLease, readCiLease, type CiLease, type ReleaseResult } from "../../../packages/rt-client/src/index.ts";
import { resolveLegacySession } from "../../agent-integrations/legacy.ts";
import { writeChatSession } from "../../chat-session.ts";
import { createSessionStore } from "../../agent-integrations/session-store.ts";
import { openStateDb } from "../../state/db.ts";
import { ciLeaseOwner, ciToolDefs } from "../ci-tools.ts";
import type { ToolContext } from "../shared.ts";

const MR = "https://gitlab.example.com/grp/proj/-/merge_requests/42";
let dir = "";
let db: Database;
let origHome: string | undefined;
let now = 1_000_000;

beforeEach(() => {
  origHome = process.env.HOME;
  dir = mkdtempSync(join(tmpdir(), "ci-harness-"));
  process.env.HOME = join(dir, "home");
  db = openStateDb(join(dir, "state.db"));
  now = 1_000_000;
});

afterEach(() => {
  db.close();
  process.env.HOME = origHome;
  rmSync(dir, { recursive: true, force: true });
});

function tools(caller: (context?: ToolContext) => Promise<Outcome<CallerContext> | null> = async (c) => (c ? c.caller() : null)) {
  return ciToolDefs({
    leaseOpts: () => ({ dir, now: () => now }),
    label: () => undefined,
    caller,
    legacy: (raw) => resolveLegacySession(raw, "claude", db),
  });
}

function tool(name: string, defs = tools()) {
  const t = defs.find((x) => x.name === name);
  if (!t) throw new Error(name);
  return t;
}

const as = (ctx: CallerContext): ToolContext => ({ caller: async () => ({ ok: true, data: ctx }) });
const refusedAs = (code: "stale-binding" | "ambiguous", message: string): ToolContext => ({ caller: async () => ({ ok: false, error: { code, message } }) });

function bind(identity: string, native: NativeSessionRef, attemptId?: string): SessionBinding {
  const store = createSessionStore(db);
  const r = store.bind(store.reserve({ identity, ...(attemptId && { attemptId }) }), native, { mode: "herdr", pane: `w1:${identity}` });
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

const claude = (value: string): NativeSessionRef => ({ harness: "claude", profile: "default", kind: "id", value });
const codex = (value: string): NativeSessionRef => ({ harness: "codex", profile: "default", kind: "id", value });
const managed = (binding: SessionBinding, attemptId: string): CallerContext => ({ binding: { ...binding, attemptId } });

async function call(name: string, ctx: ToolContext, input: Record<string, unknown> = {}, defs = tools()) {
  return tool(name, defs).handler({ mrUrl: MR, ...input }, {}, undefined, ctx);
}

async function release(ctx: ToolContext) {
  const r = await call("ci_lease_release", ctx);
  return { ok: r.ok && (r.body as ReleaseResult).released === true, result: r };
}

function onDisk(): CiLease | null {
  const r = readCiLease(MR, { dir, now: () => now });
  return r.lease ?? r.stale;
}

describe("ciLeaseOwner", () => {
  test("names the binding, qualified by the attempt when managed", () => {
    const b = bind("remy.ab12", claude("sess-1"));
    expect(ciLeaseOwner({ binding: b })).toBe(`binding:${b.key}`);
    expect(ciLeaseOwner(managed(b, "att-1"))).toBe(`binding:${b.key}:attempt:att-1`);
  });

  test("a binding launched for an attempt is qualified by it", () => {
    const b = bind("remy.ab12", claude("sess-1"), "att-1");
    expect(ciLeaseOwner({ binding: b })).toBe(`binding:${b.key}:attempt:att-1`);
    expect(ciLeaseOwner({ binding: b })).toBe(ciLeaseOwner(managed(b, "att-1")));
  });

  test("the same attempt resumed keeps its owner", () => {
    const store = createSessionStore(db);
    const before = bind("remy.ab12", claude("sess-1"), "att-1");
    const ownerBeforeResume = ciLeaseOwner(managed(before, "att-1"));
    const detached = store.detach(before.key, before.attachment.generation);
    if (!detached.ok) throw new Error(detached.error.message);
    const resumed = bind("remy.ab12", claude("sess-1"), "att-1");
    expect(resumed.attachment.generation).toBeGreaterThan(before.attachment.generation);
    const ownerAfterResume = ciLeaseOwner(managed(resumed, "att-1"));
    expect(ownerAfterResume).toBe(ownerBeforeResume);
  });

  test("a continued Claude session keeps its owner", () => {
    const store = createSessionStore(db);
    const before = bind("remy.ab12", claude("sess-1"));
    const continued = store.continueNative(before.key, before.attachment.generation, claude("sess-2"));
    if (!continued.ok) throw new Error(continued.error.message);
    expect(ciLeaseOwner({ binding: continued.data })).toBe(ciLeaseOwner({ binding: before }));
  });
});

describe("CI leases follow the caller's binding", () => {
  test("two harnesses cannot release each other's lease", async () => {
    const a = as(managed(bind("remy.ab12", claude("sess-a"), "att-a"), "att-a"));
    const b = as(managed(bind("kai.cd34", codex("thread-b"), "att-b"), "att-b"));
    expect(await call("ci_lease_claim", a)).toMatchObject({ ok: true, body: { claimed: true } });
    const releaseByForeign = await release(b);
    expect(releaseByForeign.ok).toBe(false);
    expect(releaseByForeign.result).toMatchObject({ ok: true, body: { released: false, reason: "not-owner" } });
    expect(await call("ci_lease_heartbeat", b)).toMatchObject({ ok: true, body: { ok: false, reason: "lost" } });
    expect(await call("ci_lease_claim", b)).toMatchObject({ ok: true, body: { claimed: false } });
    expect(await call("ci_lease_read", b)).toMatchObject({ ok: true, body: { mine: false } });
    expect(await call("ci_lease_read", a)).toMatchObject({ ok: true, body: { mine: true } });
    expect((await release(a)).ok).toBe(true);
  });

  test("the session label is the bound Codex thread's chat handle, not the server environment's", async () => {
    writeChatSession({ sessionId: "thread-b", handle: "kai.cd34", baseHandle: "kai", signedInAt: 1 });
    writeChatSession({ sessionId: "env-session", handle: "host.zz99", baseHandle: "host", signedInAt: 1 });
    const defs = ciToolDefs({
      leaseOpts: () => ({ dir, now: () => now }),
      caller: async (c) => (c ? c.caller() : null),
      legacy: (raw) => resolveLegacySession(raw, "claude", db),
    });
    const b = as(managed(bind("kai.cd34", codex("thread-b"), "att-b"), "att-b"));
    const r = await tool("ci_lease_claim", defs).handler({ mrUrl: MR }, { CLAUDE_CODE_SESSION_ID: "env-session" }, undefined, b);
    expect(r).toMatchObject({ ok: true, body: { claimed: true, lease: { sessionLabel: "kai.cd34" } } });
  });

  test("the Codex worker acquires, refreshes and releases its own lease", async () => {
    const b = as(managed(bind("kai.cd34", codex("thread-b"), "att-b"), "att-b"));
    const claimed = await call("ci_lease_claim", b, { branch: "feat" });
    expect(claimed).toMatchObject({ ok: true, body: { claimed: true, lease: { branch: "feat" } } });
    expect((claimed.body as { lease: CiLease }).lease.owner).toStartWith("binding:");
    now += 30_000;
    expect(await call("ci_lease_heartbeat", b)).toMatchObject({ ok: true, body: { ok: true } });
    expect((await release(b)).ok).toBe(true);
    expect(onDisk()).toBeNull();
  });

  test("replacement cannot impersonate predecessor", async () => {
    const store = createSessionStore(db);
    const first = bind("remy.ab12", claude("sess-1"), "att-1");
    const predecessor = managed(first, "att-1");
    const ownerBeforeResume = ciLeaseOwner(predecessor);
    expect(await call("ci_lease_claim", as(predecessor))).toMatchObject({ ok: true, body: { claimed: true } });

    const detached = store.detach(first.key, first.attachment.generation);
    if (!detached.ok) throw new Error(detached.error.message);
    const resumedBinding = bind("remy.ab12", claude("sess-1"), "att-1");
    const ownerAfterResume = ciLeaseOwner(managed(resumedBinding, "att-1"));
    expect(ownerAfterResume).toBe(ownerBeforeResume);
    expect(await call("ci_lease_heartbeat", as(managed(resumedBinding, "att-1")))).toMatchObject({ ok: true, body: { ok: true } });

    const sameSessionNewAttempt = as(managed(resumedBinding, "att-2"));
    const freshSession = as(managed(bind("remy.ef56", codex("thread-2"), "att-3"), "att-3"));
    for (const replacement of [sameSessionNewAttempt, freshSession]) {
      expect(await call("ci_lease_claim", replacement)).toMatchObject({ ok: true, body: { claimed: false } });
      expect(await call("ci_lease_heartbeat", replacement)).toMatchObject({ ok: true, body: { ok: false, reason: "lost" } });
      expect((await release(replacement)).ok).toBe(false);
    }
    expect(onDisk()?.owner).toBe(ownerBeforeResume);
  });

  test("a replacement takes over only once the predecessor's lease expires", async () => {
    const first = bind("remy.ab12", claude("sess-1"), "att-1");
    const predecessorOwner = ciLeaseOwner(managed(first, "att-1"));
    await call("ci_lease_claim", as(managed(first, "att-1")), { ttlSeconds: 60 });
    const replacement = as(managed(bind("remy.ef56", codex("thread-2"), "att-2"), "att-2"));
    now += 61_000;
    expect(await call("ci_lease_claim", replacement)).toMatchObject({ ok: true, body: { claimed: true, previousOwner: predecessorOwner } });
  });

  test("a predecessor whose binding was replaced gets a refusal that names why", async () => {
    const r = await call("ci_lease_heartbeat", refusedAs("stale-binding", "attachment generation 1 was replaced; the current one is 2"));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("cannot be attributed to a session");
    expect(r.error).toContain("was replaced");
    expect(r.error).not.toContain("token");
  });
});

describe("legacy session leases", () => {
  function legacyLease(sessionId: string) {
    claimCiLease({ mrUrl: MR, owner: `session:${sessionId}`, holder: "watch-ci", branch: "feat" }, { dir, now: () => now });
  }

  test("a lease under the caller's own Claude session is the caller's, and moves to its binding owner", async () => {
    const binding = bind("remy.ab12", claude("sess-1"));
    legacyLease("sess-1");
    expect(await call("ci_lease_read", as({ binding }))).toMatchObject({ ok: true, body: { mine: true } });
    now += 10_000;
    expect(await call("ci_lease_heartbeat", as({ binding }))).toMatchObject({ ok: true, body: { ok: true, lease: { owner: `binding:${binding.key}`, branch: "feat" } } });
    expect((await release(as({ binding }))).ok).toBe(true);
  });

  test("a re-claim of the caller's own legacy lease is not a takeover", async () => {
    const binding = bind("remy.ab12", claude("sess-1"));
    legacyLease("sess-1");
    const r = await call("ci_lease_claim", as({ binding }));
    expect(r).toMatchObject({ ok: true, body: { claimed: true, lease: { owner: `binding:${binding.key}` } } });
    expect((r.body as { previousOwner?: string }).previousOwner).toBeUndefined();
  });

  test("a lease under another session, or one no record proves, stays foreign", async () => {
    bind("kai.cd34", claude("sess-other"));
    const mine = bind("remy.ab12", claude("sess-1"));
    for (const raw of ["sess-other", "sess-unknown"]) {
      rmSync(join(dir, ciLeaseFileName(MR)), { force: true });
      legacyLease(raw);
      expect(await call("ci_lease_read", as({ binding: mine }))).toMatchObject({ body: { mine: false } });
      expect(await call("ci_lease_claim", as({ binding: mine }))).toMatchObject({ body: { claimed: false } });
      expect((await release(as({ binding: mine }))).ok).toBe(false);
    }
  });

  test("a Codex thread with the same raw id is not that Claude session", async () => {
    const thread = bind("kai.cd34", codex("sess-1"));
    legacyLease("sess-1");
    expect(await call("ci_lease_read", as({ binding: thread }))).toMatchObject({ body: { mine: false } });
    expect((await release(as({ binding: thread }))).ok).toBe(false);
  });
});

describe("with the switch off", () => {
  test("the owner stays the environment's Claude session", async () => {
    const defs = tools(async () => null);
    const r = await tool("ci_lease_claim", defs).handler({ mrUrl: MR }, { CLAUDE_CODE_SESSION_ID: "aaa" }, undefined, as({ binding: bind("x.y", claude("zzz")) }));
    expect(r).toMatchObject({ ok: true, body: { claimed: true, lease: { owner: "session:aaa" } } });
  });
});
