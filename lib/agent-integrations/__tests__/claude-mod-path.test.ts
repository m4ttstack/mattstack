import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CallerContext, NativeSessionRef, Outcome, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { createModLinks, LINK_EXPIRY_MS, TESTED_CLAUDE_CODE, type ModLinks } from "../claude/mod-links.ts";
import { modContext, modPath } from "../claude/mod-path.ts";
import { reportClaudeLifecycle, type ClaudeRegistry } from "../claude/sessions.ts";
import { resolveCallerContextNow, type CallerEvidence, type ResolveDeps } from "../context.ts";
import { createSessionStore } from "../session-store.ts";
import { openStateDb } from "../../state/db.ts";
import { presenceForSession, signIn, type RegistryDeps } from "../../state/presence-store.ts";
import { createModSessionHandlers } from "../../daemon/handlers/mod-session.ts";

let dir = "";
let origHome: string | undefined;

beforeEach(() => {
  origHome = process.env.HOME;
  dir = mkdtempSync(join(tmpdir(), "rt-claude-mod-path-"));
  process.env.HOME = join(dir, "home");
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(dir, { recursive: true, force: true });
});

const SESSION = "6e225e74-4cb7-4aea-8807-6aa9011d4112";
const claudeRef = (value: string, profile = "default"): NativeSessionRef => ({ harness: "claude", profile, kind: "id", value });
const noRegistry: RegistryDeps = { resolve: () => null, alive: () => true, resolveAll: () => new Map() };

function data<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.error.code}: ${outcome.error.message}`);
  return outcome.data;
}

function bind(db: Database, native: NativeSessionRef, attachment: { pane?: string; pid?: number }, identity = "kai"): SessionBinding {
  const store = createSessionStore(db);
  return data(store.bind(store.reserve({ identity }), native, { mode: "herdr", ...attachment }));
}

function world(enabled = true) {
  const db = openStateDb(join(dir, "state.db"));
  const clock = { now: 10_000 };
  const switchOn = { value: enabled };
  const links = createModLinks({ now: () => clock.now, integrationsEnabled: () => switchOn.value, store: createSessionStore(db) });
  const logged: Array<{ message: string; context: Record<string, unknown> }> = [];
  const log = (message: string, context: Record<string, unknown>) => void logged.push({ message, context });
  const handlers = createModSessionHandlers({
    links, lifecycle: { db, enabled: () => switchOn.value, now: () => clock.now, log, deleteSessionFile: () => {} },
  });
  return { db, clock, switchOn, links, logged, log, handlers };
}

function link(links: ModLinks, sessionId = SESSION, over: { pane?: string; blocks?: string[] } = {}): string {
  return data(links.register({
    sessionId, cwd: "/w/acme", root: "/w/acme", pane: over.pane ?? "w1:p1",
    claudeCode: TESTED_CLAUDE_CODE.max, plugin: "0.1.0", blocks: (over.blocks ?? ["delivery", "presence"]) as never,
  })).linkId;
}

type Reply = { ok: boolean; data?: unknown; error?: string; failure?: { code: string; message: string } };
const call = (fn: (payload: never) => Promise<unknown>, payload: unknown) => fn(payload as never) as Promise<Reply>;
const context = (pane = "w1:p1") => ({ cwd: "/w/acme", root: "/w/acme", pane });

function signedIn(db: Database, sessionId: string, pane: string, at: number): void {
  signIn({ sessionId, pane, now: at }, db, noRegistry);
  db.run("UPDATE chat_presence SET last_seen_at = ? WHERE session_id = ?", [at, sessionId]);
}

describe("lifecycle", () => {
  test("lifecycle comes from the link when live and from the shell path otherwise", async () => {
    const w = world();
    const binding = bind(w.db, claudeRef(SESSION), { pane: "w1:p1", pid: 501 });
    signedIn(w.db, SESSION, "w1:p1", 5);
    const linkId = link(w.links);

    // No process ancestry at all: the live link is the evidence.
    w.clock.now = 20_000;
    const compacted = await call(w.handlers["session:report"], { linkId, event: "compact", context: context() });
    expect(compacted).toEqual({ ok: true, data: { outcome: "applied" } });
    expect(presenceForSession(SESSION, w.db)?.lastSeenAt).toBe(20_000);
    expect(createSessionStore(w.db).get(binding.key)?.attachment.generation).toBe(binding.attachment.generation);

    const resumed = await call(w.handlers["session:report"], { linkId, event: "resume", context: context() });
    expect(resumed).toEqual({ ok: true, data: { outcome: "applied" } });

    // The link lapses: its reports are refused and change nothing.
    w.clock.now += LINK_EXPIRY_MS + 1_000;
    const lapsed = await call(w.handlers["session:report"], { linkId, event: "compact", context: context() });
    expect(lapsed.ok).toBe(false);
    expect(lapsed.failure?.code).toBe("unknown-link");
    expect(presenceForSession(SESSION, w.db)?.lastSeenAt).toBe(20_000);

    // The shell hook's path still runs, verified by process ancestry.
    const registry: ClaudeRegistry = { roots: () => [], read: () => new Map(), sessionForPid: (pid) => (pid === 501 ? SESSION : null) };
    const shell = await reportClaudeLifecycle(SESSION, "compact", { env: { HERDR_PANE_ID: "w1:p1" }, ancestry: [900, 501] }, {
      db: w.db, registry, processAlive: () => true, enabled: () => true, now: () => w.clock.now,
    });
    expect(shell).toBe("applied");
    expect(presenceForSession(SESSION, w.db)?.lastSeenAt).toBe(w.clock.now);
  });

  test("a report acts only on the link's own session and never moves or ends a binding", async () => {
    const w = world();
    const mine = bind(w.db, claudeRef(SESSION), { pane: "w1:p1" });
    const other = bind(w.db, claudeRef("other-session"), { pane: "w2:p1" }, "sam");
    signedIn(w.db, "other-session", "w2:p1", 5);
    const linkId = link(w.links);

    const reply = await call(w.handlers["session:report"], { linkId, event: "resume", context: context("w2:p1") });
    expect(reply).toEqual({ ok: true, data: { outcome: "applied" } });
    const store = createSessionStore(w.db);
    expect(store.get(mine.key)?.attachment).toEqual(mine.attachment);
    expect(store.get(other.key)?.attachment).toEqual(other.attachment);
    expect(presenceForSession("other-session", w.db)?.lastSeenAt).toBe(5);
  });

  test("a report for a session no single attached Claude binding names changes nothing", async () => {
    const w = world();
    const linkId = link(w.links);
    expect(await call(w.handlers["session:report"], { linkId, event: "compact", context: context() }))
      .toEqual({ ok: true, data: { outcome: "unbound" } });

    const binding = bind(w.db, claudeRef(SESSION), { pane: "w1:p1" });
    data(createSessionStore(w.db).detach(binding.key, binding.attachment.generation));
    expect(await call(w.handlers["session:report"], { linkId, event: "resume", context: context() }))
      .toEqual({ ok: true, data: { outcome: "unbound" } });
    expect(createSessionStore(w.db).get(binding.key)?.attachment.generation).toBe(binding.attachment.generation + 1);
  });

  test("session:report validates its payload and refuses an unknown link", async () => {
    const w = world();
    const linkId = link(w.links);
    for (const bad of [
      undefined, {}, { linkId: "", event: "resume", context: context() }, { linkId, event: "end", context: context() },
      { linkId, event: "resume" }, { linkId, event: "resume", context: { root: "/w" } }, { linkId, event: "resume", context: { cwd: "/w", root: "/w", pane: 4 } },
    ]) {
      const reply = await call(w.handlers["session:report"], bad);
      expect(reply.ok).toBe(false);
      expect(reply.failure?.code).toBe("invalid");
    }
    const unknown = await call(w.handlers["session:report"], { linkId: "ml-nope", event: "compact", context: context() });
    expect(unknown).toMatchObject({ ok: false, error: "unknown link", failure: { code: "unknown-link" } });
  });
});

describe("the context record is a hint", () => {
  test("the mod's context record is a hint: a mismatch with the binding is ignored and logged", async () => {
    const w = world();
    const binding = bind(w.db, claudeRef(SESSION), { pane: "w1:p1", pid: 501 });
    signedIn(w.db, SESSION, "w1:p1", 5);
    const linkId = link(w.links, SESSION, { pane: "w9:p9" });

    const reply = await call(w.handlers["session:report"], { linkId, event: "resume", context: context("w8:p8") });
    expect(reply).toEqual({ ok: true, data: { outcome: "applied" } });
    const after = createSessionStore(w.db).get(binding.key)!;
    expect(after.attachment).toEqual(binding.attachment);
    expect(presenceForSession(SESSION, w.db)?.pane).toBe("w1:p1");
    expect(w.logged.map((l) => l.context)).toContainEqual(expect.objectContaining({ session: SESSION, bindingPane: "w1:p1", reportedPane: "w8:p8" }));

    // The resolver weighs the same record and resolves exactly what it would without it.
    w.logged.length = 0;
    const evidence: CallerEvidence = { native: { harness: "claude", kind: "id", value: SESSION } };
    const deps: ResolveDeps = { db: w.db, enabled: () => true, log: w.log, modContext: (id) => modContext(id, w.links) };
    expect(resolveCallerContextNow(evidence, deps)).toEqual(resolveCallerContextNow(evidence, { db: w.db }));
    expect(w.logged.map((l) => l.context)).toContainEqual(expect.objectContaining({ session: SESSION, bindingPane: "w1:p1", linkPane: "w9:p9" }));
  });

  test("a live link's pane chooses among the bindings the resolver would accept, and never adds one", () => {
    const w = world();
    bind(w.db, claudeRef(SESSION, "alex@acme.test"), { pane: "w1:p1" }, "alex");
    const sams = bind(w.db, claudeRef(SESSION, "sam@example.com"), { pane: "w2:p1" }, "sam");
    const evidence: CallerEvidence = { native: { harness: "claude", kind: "id", value: SESSION } };
    const deps = (): ResolveDeps => ({ db: w.db, enabled: () => true, log: w.log, modContext: (id) => modContext(id, w.links) });

    const without = resolveCallerContextNow(evidence, deps());
    expect(without.ok ? null : without.error.code).toBe("ambiguous");

    const linkId = link(w.links, SESSION, { pane: "w2:p1" });
    expect(data(resolveCallerContextNow(evidence, deps())).binding.key).toBe(sams.key);

    // A pane no binding holds picks nothing: the link never adds a binding.
    w.links.end(linkId);
    link(w.links, SESSION, { pane: "w7:p1" });
    const elsewhere = resolveCallerContextNow(evidence, deps());
    expect(elsewhere.ok ? null : elsewhere.error.code).toBe("ambiguous");

    // A session the resolver has no binding for stays unresolved, link or not.
    link(w.links, "unbound-session", { pane: "w2:p1" });
    const unbound = resolveCallerContextNow({ native: { harness: "claude", kind: "id", value: "unbound-session" } }, deps());
    expect(unbound.ok).toBe(false);
  });
});

describe("modPath", () => {
  test("a cleared block falls back on the next call", async () => {
    const w = world();
    const binding = bind(w.db, claudeRef(SESSION), { pane: "w1:p1" });
    link(w.links, SESSION, { blocks: ["delivery", "presence"] });
    expect(modPath(binding, "delivery", w.links)).toBe(true);
    expect(modPath(binding, "gate-form", w.links)).toBe(false);

    // The mod cleared delivery after an error and registered again with what is left.
    link(w.links, SESSION, { blocks: ["presence"] });
    expect(modPath(binding, "delivery", w.links)).toBe(false);
    expect(modPath(binding, "presence", w.links)).toBe(true);

    // No heartbeat for 30 s: every block falls back.
    w.clock.now += LINK_EXPIRY_MS;
    expect(modPath(binding, "presence", w.links)).toBe(false);
  });

  test("only an attached Claude id binding with a live link takes the mod path", () => {
    const w = world();
    const claude = bind(w.db, claudeRef(SESSION), { pane: "w1:p1" });
    link(w.links);
    const codex = { ...claude, native: { ...claude.native, harness: "codex" } } as SessionBinding;
    expect(modPath(codex, "delivery", w.links)).toBe(false);
    expect(modPath(claude, "delivery", null)).toBe(false);
    expect(modPath(claude, "delivery")).toBe(false);
    const detached = data(createSessionStore(w.db).detach(claude.key, claude.attachment.generation));
    expect(modPath(detached, "delivery", w.links)).toBe(false);
  });

  test("with the switch off no block counts", () => {
    const w = world();
    const binding = bind(w.db, claudeRef(SESSION), { pane: "w1:p1" });
    link(w.links);
    w.switchOn.value = false;
    expect(modPath(binding, "delivery", w.links)).toBe(false);
  });
});

describe("switch off", () => {
  test("switch off: resolveCallerContext output is byte-identical to before", async () => {
    const w = world();
    bind(w.db, claudeRef(SESSION, "alex@acme.test"), { pane: "w1:p1" }, "alex");
    bind(w.db, claudeRef(SESSION, "sam@example.com"), { pane: "w2:p1" }, "sam");
    bind(w.db, claudeRef("single-session"), { pane: "w3:p1" }, "kai");
    // A record that would choose and one that would mismatch, offered while the switch is off.
    const hint = (id: string) => ({ linkId: "ml-1", sessionId: id, cwd: "/w", root: "/w", pane: id === SESSION ? "w2:p1" : "w9:p9" });
    const cases: CallerEvidence[] = [
      { native: { harness: "claude", kind: "id", value: SESSION } },
      { native: { harness: "claude", kind: "id", value: "single-session" } },
      { native: { harness: "claude", profile: "sam@example.com", kind: "id", value: SESSION } },
      { native: { harness: "claude", kind: "id", value: "nobody" } },
      { raw: "single-session" },
    ];
    for (const evidence of cases) {
      const before: Outcome<CallerContext> = resolveCallerContextNow(evidence, { db: w.db });
      const after = resolveCallerContextNow(evidence, { db: w.db, enabled: () => false, log: w.log, modContext: hint });
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    }
    expect(w.logged).toEqual([]);
  });
});
