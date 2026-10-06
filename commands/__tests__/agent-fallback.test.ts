import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runAgentFallback, HEADLESS_NEEDS_DAEMON, BG_NEEDS_DAEMON } from "../agent-fallback.ts";
import { openStateDb, insertAgent, newAgentId } from "../../lib/state/index.ts";
import type { HerdrRunner } from "../../lib/agent-herdr.ts";
import type { CapabilityReport, Mode } from "../../packages/rt-client/src/agent-integrations.ts";
import { claudeIntegration } from "../../lib/agent-integrations/claude/integration.ts";
import { codexIntegration } from "../../lib/agent-integrations/codex/integration.ts";
import type { HarnessIntegration } from "../../lib/agent-integrations/contracts.ts";
import { createRegistry } from "../../lib/agent-integrations/registry.ts";
import { createSessionStore, listBindingsByAgent } from "../../lib/agent-integrations/session-store.ts";

let n = 0;
const REPO = "remote:example.com%2Fa%2Fb";
const tmp = () => join(tmpdir(), `agent-fb-${process.pid}-${n++}.db`);

/** No pane behind this launch, so the folder-trust driver has nothing to read:
    answer it honestly rather than letting it reach for a real herdr socket. */
const noPane = (async () => ({ ok: false, code: "unreachable", message: "no server" })) as never;

const okRunner = (calls: string[][]): HerdrRunner => async (args) => {
  calls.push(args);
  if (args[0] === "workspace" && args[1] === "list") return { stdout: JSON.stringify({ result: { workspaces: [] } }), exitCode: 0 };
  if (args[0] === "workspace" && args[1] === "create")
    return { stdout: JSON.stringify({ result: { root_pane: { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1" } } }), exitCode: 0 };
  return { stdout: "{}", exitCode: 0 };
};

test("herdr start records and journals herdr argv", async () => {
  const db = openStateDb(tmp());
  const calls: string[][] = [];
  const res = await runAgentFallback("agent:start",
    { repo: REPO, cwd: "/tmp/x", prompt: "hi", surface: "herdr" }, { db, herdrRunner: okRunner(calls), herdr: noPane });
  expect(res.ok).toBe(true);
  expect(calls.some((c) => c[0] === "pane" && c[1] === "run")).toBe(true);
  if (!res.ok) throw new Error("unreachable");
  const got = await runAgentFallback("agent:get", { id: (res.data as { id: string }).id }, { db });
  expect(got.ok).toBe(true);
});

test("refuses headless start before spawning", async () => {
  const db = openStateDb(tmp());
  const spy = { called: false };
  const res = await runAgentFallback("agent:start",
    { repo: REPO, cwd: "/tmp/x", prompt: "hi", surface: "headless" },
    { db, spawnHeadless: () => { spy.called = true; return { exited: Promise.resolve(0), stdout: async () => "", sessionId: () => Promise.resolve(undefined) }; } });
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("unreachable");
  expect(res.error).toBe(HEADLESS_NEEDS_DAEMON);
  expect(spy.called).toBe(false);
});

test("refuses resume of a headless record (surface from record)", async () => {
  const db = openStateDb(tmp());
  const rec = { id: newAgentId(), repo: REPO, cwd: "/tmp/x", provider: "claude" as const, surface: "headless" as const, sessionId: crypto.randomUUID(), createdAt: Date.now() };
  insertAgent(rec, db);
  const res = await runAgentFallback("agent:resume", { id: rec.id }, { db });
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("unreachable");
  expect(res.error).toBe(HEADLESS_NEEDS_DAEMON);
});

test("refuses bg start before spawning: bg needs the daemon-owned server this fallback never has", async () => {
  const db = openStateDb(tmp());
  const spy = { called: false };
  const res = await runAgentFallback("agent:start",
    { repo: REPO, cwd: "/tmp/x", prompt: "hi", bg: true },
    { db, herdrRunner: () => { spy.called = true; return Promise.resolve({ stdout: "{}", exitCode: 0 }); } });
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("unreachable");
  expect(res.error).toBe(BG_NEEDS_DAEMON);
  expect(spy.called).toBe(false);
});

// The fallback is a short-lived CLI process: codex's session-id capture is a
// detached poll with a ten-minute budget, so scheduling it here would hang the
// process (or be killed mid-flight) and capture nothing either way.
test("a codex herdr start schedules no session-id poll: the CLI would exit before it resolved", async () => {
  const db = openStateDb(tmp());
  const calls: string[][] = [];
  const res = await runAgentFallback("agent:start",
    { repo: REPO, cwd: "/tmp/x", prompt: "hi", surface: "herdr", provider: "codex" },
    { db, herdrRunner: okRunner(calls), herdr: noPane });
  expect(res.ok).toBe(true);
  // Give a mis-scheduled poll a chance to make its first call before asserting.
  await new Promise((r) => setTimeout(r, 50));
  expect(calls.some((c) => c[0] === "agent" && c[1] === "get")).toBe(false);
});

test("list returns records", async () => {
  const db = openStateDb(tmp());
  const calls: string[][] = [];
  await runAgentFallback("agent:start", { repo: REPO, cwd: "/tmp/x", prompt: "hi", surface: "herdr" }, { db, herdrRunner: okRunner(calls), herdr: noPane });
  const res = await runAgentFallback("agent:list", { repo: REPO }, { db });
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error("unreachable");
  expect((res.data as { agents: unknown[] }).agents.length).toBe(1);
});

describe("the fallback under agent.integrations.enabled", () => {
  const origHome = process.env.HOME;
  const origPath = process.env.PATH;
  let home: string;
  let shimLog: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-agent-fb-")));
    process.env.HOME = home;
    const shims = join(home, "shims");
    mkdirSync(shims);
    shimLog = join(home, "shim.log");
    for (const bin of ["claude", "codex", "cswap", "herdr"]) {
      writeFileSync(join(shims, bin), `#!/bin/sh\necho "${bin} $*" >> '${shimLog}'\nexit 1\n`);
      chmodSync(join(shims, bin), 0o755);
    }
    process.env.PATH = `${shims}:${origPath}`;
  });

  afterEach(() => {
    expect(existsSync(shimLog)).toBe(false);
    process.env.HOME = origHome;
    process.env.PATH = origPath;
    rmSync(home, { recursive: true, force: true });
  });

  const ready = async (mode: Mode): Promise<CapabilityReport> => ({ mode, supported: ["launch", "resume", "observe"], readiness: { ready: true } });
  const integrations = createRegistry([{ ...claudeIntegration, capabilities: ready } as HarnessIntegration, codexIntegration]);
  const rows = (db: Database, table: string) => (db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  const paneRun = (calls: string[][]) => calls.find((c) => c[0] === "pane" && c[1] === "run")![3]!;

  test("switch off keeps the fallback's launch exactly as it was", async () => {
    const launch = async (integrationsEnabled?: () => boolean) => {
      const db = openStateDb(tmp());
      const calls: string[][] = [];
      const res = await runAgentFallback<{ id: string; sessionId: string }>("agent:start", { repo: REPO, cwd: "/tmp/x", prompt: "hi", surface: "herdr" },
        { db, herdrRunner: okRunner(calls), herdr: noPane, integrations, ...(integrationsEnabled && { integrationsEnabled }) });
      if (!res.ok) throw new Error(res.error);
      expect(rows(db, "agent_session_reservations") + rows(db, "agent_session_bindings")).toBe(0);
      return calls.map((c) => c.join(" ").replaceAll(res.data!.id, "<ID>").replaceAll(res.data!.sessionId, "<SID>"));
    };
    expect(await launch(() => false)).toEqual(await launch());
  });

  test("switch on: a herdr start binds through the shared launcher as an ordinary caller", async () => {
    const db = openStateDb(tmp());
    const calls: string[][] = [];
    const res = await runAgentFallback<{ id: string; sessionId: string }>("agent:start", { repo: REPO, cwd: "/tmp/x", prompt: "hi", surface: "herdr" },
      { db, herdrRunner: okRunner(calls), herdr: noPane, integrations, integrationsEnabled: () => true });
    if (!res.ok) throw new Error(res.error);
    expect(paneRun(calls)).toStartWith("cd '/tmp/x' && env -u CODEX_THREAD_ID ");
    const [binding] = listBindingsByAgent(db, res.data!.id);
    expect(binding).toMatchObject({ native: { harness: "claude", value: res.data!.sessionId }, attachment: { pane: "w1:p1" } });
    expect(binding!.attemptId).toBeUndefined();
    const reservation = db.query("SELECT state, claimed_by, request FROM agent_session_reservations").get() as { state: string; claimed_by: string; request: string };
    expect(reservation.state).toBe("bound");
    expect(reservation.claimed_by).toMatch(/^pid-/);
    expect(JSON.parse(reservation.request).required).toEqual([]);
  });

  test("switch on: headless is still refused before anything is launched or recorded", async () => {
    const db = openStateDb(tmp());
    const res = await runAgentFallback("agent:start", { repo: REPO, cwd: "/tmp/x", prompt: "hi", surface: "headless" }, { db, integrations, integrationsEnabled: () => true });
    expect(res).toEqual({ ok: false, error: HEADLESS_NEEDS_DAEMON });
    expect(rows(db, "agent_session_reservations")).toBe(0);
  });

  test("switch on: the fallback never resumes a herd worker's bound session", async () => {
    const db = openStateDb(tmp());
    const rec = { id: newAgentId(), repo: REPO, cwd: "/tmp/x", provider: "claude" as const, surface: "herdr" as const, sessionId: crypto.randomUUID(), createdAt: Date.now() };
    insertAgent(rec, db);
    const store = createSessionStore(db);
    const bound = store.bind(store.reserve({ identity: "worker-1", agentId: rec.id, attemptId: "att-1" }), { harness: "claude", profile: "default", kind: "id", value: rec.sessionId }, { mode: "herdr", pane: "w1:p1" });
    if (!bound.ok) throw new Error(bound.error.message);
    const calls: string[][] = [];
    const res = await runAgentFallback("agent:resume", { id: rec.id, prompt: "again" }, { db, herdrRunner: okRunner(calls), herdr: noPane, integrations, integrationsEnabled: () => true });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toMatch(/herd job.*rt daemon/);
    expect(calls).toEqual([]);
    expect(store.get(bound.data.key)!.attachment.generation).toBe(1);
  });
});
