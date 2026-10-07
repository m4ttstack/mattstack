import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { NativeSessionRef } from "../../../packages/rt-client/src/agent-integrations.ts";
import { openStateDb, openStateDbGuarded, SCHEMA_VERSION } from "../../state/db.ts";
import { getAgent, insertAgent, type AgentRecord } from "../../state/agents-store.ts";
import { sessionFilePath, writeChatSession } from "../../chat-session.ts";
import {
  claimReservation, createSessionStore, failReservation, listAttachedBindings, listEveryAttachedBinding, markBindingReady,
  noteReservationError, pruneReservations, readBindingReadiness, readBindingSelection, readReservation, recordLaunched,
} from "../session-store.ts";
import { isDetachedClaudeBinding } from "../claude/sessions.ts";
import { __test__, migrateLegacySessions, resolveLegacySession } from "../legacy.ts";

let dir = "";
let origHome: string | undefined;

beforeEach(() => {
  origHome = process.env.HOME;
  dir = mkdtempSync(join(tmpdir(), "rt-session-store-"));
  process.env.HOME = join(dir, "home");
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(dir, { recursive: true, force: true });
});

function freshDb(): Database {
  return openStateDb(join(dir, "state.db"));
}

const ref = (over: Partial<NativeSessionRef> = {}): NativeSessionRef =>
  ({ harness: "claude", profile: "default", kind: "id", value: "sess-1", ...over });

function bound(db: Database, identity: string, native: NativeSessionRef, pane = "w1:p1") {
  const store = createSessionStore(db);
  const result = store.bind(store.reserve({ identity }), native, { mode: "herdr", pane });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe("session store", () => {
  test("native tuple prevents collisions", () => {
    const db = freshDb();
    const store = createSessionStore(db);
    const original = bound(db, "remy.ab12", ref({ profile: "personal" }));
    const otherProfile = bound(db, "kai.cd34", ref({ profile: "work" }));
    const otherHarness = bound(db, "ivy.ef56", ref({ harness: "codex", profile: "personal" }));

    expect(otherProfile.key).not.toBe(original.key);
    expect(otherHarness.key).not.toBe(original.key);
    expect(store.find(ref({ profile: "personal" }))?.identity).toBe("remy.ab12");
    expect(store.find(ref({ profile: "work" }))?.identity).toBe("kai.cd34");
    expect(store.find(ref({ harness: "codex", profile: "personal" }))?.identity).toBe("ivy.ef56");
    expect(store.find(ref({ profile: "personal", kind: "path" }))).toBeNull();
  });

  test("session keys are opaque, never the native reference", () => {
    const db = freshDb();
    const path = "/Users/someone/.codex/sessions/rollout-1.jsonl";
    const binding = bound(db, "remy.ab12", ref({ harness: "codex", kind: "path", value: path }));
    expect(binding.key).not.toContain("rollout-1");
    expect(binding.key).not.toContain("/");
    expect(createSessionStore(db).get(binding.key)).toEqual(binding);
  });

  test("resume keeps identity", () => {
    const db = freshDb();
    const store = createSessionStore(db);
    const original = bound(db, "remy.ab12", ref(), "w1:p1");
    const resumed = bound(db, "remy.ab12", ref(), "w2:p7");

    expect(resumed.identity).toBe(original.identity);
    expect(resumed.key).toBe(original.key);
    expect(resumed.attachment).toEqual({ generation: original.attachment.generation + 1, mode: "herdr", pane: "w2:p7" });
    expect(store.get(original.key)).toEqual(resumed);
  });

  test("a native session never moves to a different identity", () => {
    const db = freshDb();
    const store = createSessionStore(db);
    const original = bound(db, "remy.ab12", ref());
    const intruder = store.reserve({ identity: "kai.cd34" });
    const result = store.bind(intruder, ref(), { mode: "herdr", pane: "w9:p9" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("refused");
    expect(store.get(original.key)).toEqual(original);
  });

  test("binding the same reservation again is idempotent and does not advance the generation", () => {
    const db = freshDb();
    const store = createSessionStore(db);
    const reservation = store.reserve({ identity: "remy.ab12", agentId: "ag-1", attemptId: "att-1" });
    const first = store.bind(reservation, ref(), { mode: "headless" });
    const again = store.bind(reservation, ref(), { mode: "headless" });
    const elsewhere = store.bind(reservation, ref({ value: "sess-2" }), { mode: "headless" });

    expect(first.ok && again.ok).toBe(true);
    if (first.ok && again.ok) {
      expect(again.data).toEqual(first.data);
      expect(first.data.agentId).toBe("ag-1");
      expect(first.data.attemptId).toBe("att-1");
    }
    expect(elsewhere.ok).toBe(false);
    if (!elsewhere.ok) expect(elsewhere.error.code).toBe("refused");
  });

  test("an unknown reservation cannot bind", () => {
    const result = createSessionStore(freshDb()).bind("rsv-missing", ref(), { mode: "headless" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid");
  });

  test("stale generation cannot replace attachment", () => {
    const db = freshDb();
    const store = createSessionStore(db);
    const original = bound(db, "remy.ab12", ref(), "w1:p1");

    const replaced = store.replaceAttachment(original.key, original.attachment.generation, { mode: "herdr", pane: "w1:p2" });
    expect(replaced.ok).toBe(true);
    if (replaced.ok) expect(replaced.data.attachment).toEqual({ generation: 2, mode: "herdr", pane: "w1:p2" });

    const stale = store.replaceAttachment(original.key, original.attachment.generation, { mode: "herdr", pane: "w1:p3" });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("stale-binding");
    expect(store.get(original.key)?.attachment).toEqual({ generation: 2, mode: "herdr", pane: "w1:p2" });

    const reopened = createSessionStore(openStateDb(join(dir, "state.db")));
    expect(reopened.get(original.key)?.attachment.generation).toBe(2);
  });
});

function agent(over: Partial<AgentRecord>): AgentRecord {
  return {
    id: `ag-${crypto.randomUUID().slice(0, 8)}`, repo: "remote:example.com%2Fa%2Fb", cwd: "/tmp/x",
    provider: "claude", surface: "herdr", sessionId: crypto.randomUUID(), createdAt: Date.now(), ...over,
  };
}

describe("explicit attachment state", () => {
  test("same-identity rebind of an attached binding never looks detached; only an explicit detach does", () => {
    const db = freshDb();
    const store = createSessionStore(db);
    const first = bound(db, "remy.ab12", ref());
    const rebound = store.bind(store.reserve({ identity: "remy.ab12" }), ref(), { mode: "herdr" });
    if (!rebound.ok) throw new Error(rebound.error.message);
    expect(rebound.data.attachment).toEqual({ generation: 2, mode: "herdr" });
    expect(isDetachedClaudeBinding(rebound.data)).toBe(false);

    const detached = store.detach(first.key, 2);
    if (!detached.ok) throw new Error(detached.error.message);
    expect(isDetachedClaudeBinding(detached.data)).toBe(true);
    expect(isDetachedClaudeBinding(store.get(first.key)!)).toBe(true);
    expect(store.detach(first.key, 2)).toMatchObject({ ok: false, error: { code: "stale-binding" } });

    const back = store.replaceAttachment(first.key, 3, { mode: "herdr", pane: "w2:p1" });
    if (!back.ok) throw new Error(back.error.message);
    expect(isDetachedClaudeBinding(back.data)).toBe(false);
  });

  test("a harness's attached bindings are those its records say are attached: a headless one, with no pane, socket or process, is among them (live-05 D7)", () => {
    const db = freshDb();
    const store = createSessionStore(db);
    // Exactly what `rt agent start --provider codex --surface headless` binds: the mode and nothing else.
    const headless = store.bind(store.reserve({ identity: "m5head.2ocd" }), ref({ harness: "codex", value: "01a114d8" }), { mode: "headless" });
    if (!headless.ok) throw new Error(headless.error.message);
    expect(headless.data.attachment).toEqual({ generation: 1, mode: "headless" });
    const paned = bound(db, "m5worker.1405", ref({ harness: "codex", value: "01a114b9" }));
    bound(db, "remy.ab12", ref());

    const attached = () => listAttachedBindings(db, "codex").map((b) => b.native.value).sort();
    expect(attached()).toEqual(["01a114b9", "01a114d8"]);
    expect(listEveryAttachedBinding(db).map((b) => b.native.value).sort()).toEqual(["01a114b9", "01a114d8", "sess-1"]);

    if (!store.detach(headless.data.key, 1).ok) throw new Error("detach failed");
    expect(attached()).toEqual(["01a114b9"]);
    if (!store.replaceAttachment(headless.data.key, 2, { mode: "headless" }).ok) throw new Error("resume failed");
    expect(attached()).toEqual(["01a114b9", "01a114d8"]);
    if (!store.detach(paned.key, 1).ok) throw new Error("detach failed");
    expect(attached()).toEqual(["01a114d8"]);
  });
});

describe("reservation progress", () => {
  const request = { cwd: "/w", mode: "herdr" as const, selection: { harness: "claude", options: { model: "haiku" } }, required: [] };

  test("a reservation is claimed once, records what its launch made, and binds with the launch's selection", () => {
    const db = freshDb();
    const store = createSessionStore(db);
    const id = store.reserve({ identity: "remy.ab12", agentId: "a1" });
    expect(readReservation(db, id)).toMatchObject({ state: "reserved", identity: "remy.ab12", agentId: "a1" });
    expect(claimReservation(db, id, "proc-A", request)).toMatchObject({ ok: true, data: { state: "launching", claimedBy: "proc-A", request } });
    expect(claimReservation(db, id, "proc-B", request)).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    expect(recordLaunched(db, id, { native: ref(), attachment: { mode: "herdr", pane: "w1:p1" } })).toBe(true);
    expect(readReservation(db, id)).toMatchObject({ state: "launched", launched: { native: ref(), attachment: { pane: "w1:p1" } } });

    const binding = store.bind(id, ref(), { mode: "herdr", pane: "w1:p1" });
    if (!binding.ok) throw new Error(binding.error.message);
    expect(readReservation(db, id)).toMatchObject({ state: "bound", boundKey: binding.data.key });
    expect(readReservation(db, id)?.launched).toBeUndefined();
    expect(readBindingSelection(db, binding.data.key)).toEqual(request.selection);
    expect(claimReservation(db, id, "proc-A", request)).toMatchObject({ ok: false, error: { code: "ambiguous" } });
  });

  test("a launch that made nothing frees its reservation; one with an unknown outcome keeps its claim", () => {
    const db = freshDb();
    const store = createSessionStore(db);
    const failed = store.reserve({ identity: "remy.ab12" });
    claimReservation(db, failed, "proc-A", request);
    failReservation(db, failed, "tab already open");
    expect(readReservation(db, failed)).toMatchObject({ state: "failed", error: "tab already open" });
    expect(claimReservation(db, failed, "proc-B", request).ok).toBe(true);

    const unknown = store.reserve({ identity: "remy.ab12" });
    claimReservation(db, unknown, "proc-A", request);
    noteReservationError(db, unknown, "the init turn has not finished");
    expect(readReservation(db, unknown)).toMatchObject({ state: "launching", error: "the init turn has not finished" });
  });

  test("readiness belongs to one generation", () => {
    const db = freshDb();
    const store = createSessionStore(db);
    const b = bound(db, "remy.ab12", ref());
    expect(readBindingReadiness(db, b.key)).toEqual({ generation: null, required: [] });
    expect(markBindingReady(db, b.key, 1, ["launch"]).ok).toBe(true);
    expect(readBindingReadiness(db, b.key)).toEqual({ generation: 1, required: ["launch"] });
    store.replaceAttachment(b.key, 1, { mode: "herdr", pane: "w9:p9" });
    expect(markBindingReady(db, b.key, 1, ["launch"])).toMatchObject({ ok: false, error: { code: "stale-binding" } });
    expect(readBindingReadiness(db, b.key)?.generation).toBe(1);
  });

  test("pruning drops settled reservations and keeps unresolved launches", () => {
    const db = freshDb();
    const store = createSessionStore(db);
    const settled = store.reserve({ identity: "remy.ab12" });
    if (!store.bind(settled, ref(), { mode: "herdr" }).ok) throw new Error("bind failed");
    const idle = store.reserve({ identity: "remy.ab12" });
    const unresolved = store.reserve({ identity: "remy.ab12" });
    claimReservation(db, unresolved, "proc-A", request);
    const later = Date.now() + 1_000;
    expect(pruneReservations(db, later, later)).toBe(2);
    expect(readReservation(db, settled)).toBeNull();
    expect(readReservation(db, idle)).toBeNull();
    expect(readReservation(db, unresolved)?.state).toBe("launching");
  });
});

/** Pre-v16 state: agents rows and chat session files exactly as older builds wrote them. */
function legacyFixture(db: Database) {
  const oldClaude = agent({ handle: "remy.ab12", account: "work", paneId: "w1:p2", sessionId: "c1a0de00-0000-4000-8000-000000000001" });
  const explicitCodex = agent({ provider: "codex", handle: "kai.cd34", paneId: "w1:p3", sessionId: "019a0000-0000-7000-8000-00000000c0de" });
  const ambiguous = agent({ handle: "ivy.ef56", sessionId: "a0000000-0000-4000-8000-00000000000a" });
  const headless = agent({ surface: "headless", sessionId: "h0000000-0000-4000-8000-00000000000b" });
  for (const row of [oldClaude, explicitCodex, ambiguous, headless]) insertAgent(row, db);
  const signedIn = { baseHandle: "x", signedInAt: 1000 };
  writeChatSession({ sessionId: oldClaude.sessionId, handle: "remy.ab12", ...signedIn });
  writeChatSession({ sessionId: ambiguous.sessionId, handle: "otto.0001", ...signedIn });
  writeChatSession({ sessionId: "u0000000-0000-4000-8000-00000000000c", handle: "nell.9f9f", ...signedIn });
  return { oldClaude, explicitCodex, ambiguous, headless, unknownRaw: "u0000000-0000-4000-8000-00000000000c" };
}

describe("legacy migration", () => {
  test("migrates a proven old Claude agent with its identity and profile", () => {
    const db = freshDb();
    const { oldClaude } = legacyFixture(db);
    const result = resolveLegacySession(oldClaude.sessionId, undefined, db);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      identity: "remy.ab12", agentId: oldClaude.id,
      native: { harness: "claude", profile: "work", kind: "id", value: oldClaude.sessionId },
      attachment: { generation: 1, mode: "herdr", pane: "w1:p2" },
    });
    expect(createSessionStore(db).find(result.data.native)?.key).toBe(result.data.key);
  });

  test("migration preserves explicit Codex", () => {
    const db = freshDb();
    const { explicitCodex } = legacyFixture(db);
    for (const harness of [undefined, "codex", "claude"]) {
      const result = resolveLegacySession(explicitCodex.sessionId, harness, db);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ambiguous");
    }
    expect(createSessionStore(db).find(ref({ harness: "codex", value: explicitCodex.sessionId }))).toBeNull();
    expect(db.query("SELECT harness, identity, key, reason FROM agent_session_aliases WHERE source = 'agents' AND source_id = ?;").get(explicitCodex.id))
      .toEqual({ harness: "codex", identity: "kai.cd34", key: null, reason: "unverified-native-id" });
  });

  test("a legacy Codex row binds only to a verified binding of its exact native session", () => {
    const db = freshDb();
    const captured = bound(db, "kai.cd34", ref({ harness: "codex", value: "019a0000-0000-7000-8000-00000000cafe" }));
    insertAgent(agent({ provider: "codex", handle: "kai.cd34", sessionId: captured.native.value }), db);

    const result = resolveLegacySession(captured.native.value, "codex", db);
    expect(result.ok && result.data).toEqual(captured);
  });

  test("a verified Codex binding made after migration resolves the unproven row it agrees with", () => {
    const db = freshDb();
    const { explicitCodex } = legacyFixture(db);
    migrateLegacySessions(db);
    const later = bound(db, "kai.cd34", ref({ harness: "codex", value: explicitCodex.sessionId }));
    const result = resolveLegacySession(explicitCodex.sessionId, undefined, db);
    expect(result.ok && result.data).toEqual(later);
  });

  test("an ambiguous raw ID stays unbound", () => {
    const db = freshDb();
    const { ambiguous } = legacyFixture(db);
    for (const harness of [undefined, "claude"]) {
      const result = resolveLegacySession(ambiguous.sessionId, harness, db);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ambiguous");
    }
    expect(createSessionStore(db).find(ref({ value: ambiguous.sessionId }))).toBeNull();

    bound(db, "ivy.ef56", ref({ value: ambiguous.sessionId }));
    const stillConflicted = resolveLegacySession(ambiguous.sessionId, "claude", db);
    expect(!stillConflicted.ok && stillConflicted.error.code).toBe("ambiguous");
  });

  test("equal raw IDs bound in two profiles stay ambiguous until a harness narrows them", () => {
    const db = freshDb();
    bound(db, "remy.ab12", ref({ value: "shared", profile: "work" }));
    bound(db, "kai.cd34", ref({ value: "shared", harness: "codex" }));
    bound(db, "ivy.ef56", ref({ value: "shared", profile: "personal" }));

    const any = resolveLegacySession("shared", undefined, db);
    expect(!any.ok && any.error.code).toBe("ambiguous");
    const codex = resolveLegacySession("shared", "codex", db);
    expect(codex.ok && codex.data.identity).toBe("kai.cd34");
    const claude = resolveLegacySession("shared", "claude", db);
    expect(!claude.ok && claude.error.code).toBe("ambiguous");
  });

  test("unknown provenance stays unbound even when a caller names a harness", () => {
    const db = freshDb();
    const { unknownRaw, headless } = legacyFixture(db);
    for (const raw of [unknownRaw, headless.sessionId]) {
      for (const harness of [undefined, "claude"]) {
        const result = resolveLegacySession(raw, harness, db);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("ambiguous");
      }
    }
    const nothing = resolveLegacySession("never-recorded", undefined, db);
    expect(!nothing.ok && nothing.error.code).toBe("ambiguous");
  });

  test("a later verified binding that agrees with an unknown sign-in resolves", () => {
    const db = freshDb();
    const { unknownRaw } = legacyFixture(db);
    migrateLegacySessions(db);
    bound(db, "nell.9f9f", ref({ value: unknownRaw }));
    const result = resolveLegacySession(unknownRaw, undefined, db);
    expect(result.ok && result.data.identity).toBe("nell.9f9f");
  });

  test("a row that cannot bind is recorded unbound with its reason, and every other record still resolves", () => {
    const db = freshDb();
    const { oldClaude } = legacyFixture(db);
    const broken = agent({ handle: "zed.0bad", account: "" });
    insertAgent(broken, db);

    expect(() => migrateLegacySessions(db)).not.toThrow();
    const refused = resolveLegacySession(broken.sessionId, undefined, db);
    expect(refused).toMatchObject({ ok: false, error: { code: "ambiguous", message: expect.stringContaining("could not be bound") } });
    expect(db.query("SELECT identity, key, reason FROM agent_session_aliases WHERE source = 'agents' AND source_id = ?;").get(broken.id))
      .toEqual({ identity: "zed.0bad", key: null, reason: "invalid-record" });
    expect(resolveLegacySession(oldClaude.sessionId, undefined, db).ok).toBe(true);
  });

  test("an alias records the profile its row ran under: the account, else the ambient one, and Codex's canonical home", () => {
    const savedCodexHome = process.env.CODEX_HOME;
    delete process.env.CODEX_HOME;
    try {
      const db = freshDb();
      const { oldClaude, explicitCodex, ambiguous } = legacyFixture(db);
      migrateLegacySessions(db);
      const profileOf = (id: string) => (db.query("SELECT profile FROM agent_session_aliases WHERE source = 'agents' AND source_id = ?;").get(id) as { profile: string | null }).profile;
      expect(profileOf(oldClaude.id)).toBe("work");
      expect(profileOf(explicitCodex.id)).toBe("default");
      expect(profileOf(ambiguous.id)).toBe("default");
      expect(db.query("SELECT DISTINCT profile FROM agent_session_aliases WHERE source = 'chat-session';").all()).toEqual([{ profile: null }]);
    } finally {
      if (savedCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = savedCodexHome;
    }
  });

  test("an unproven Codex row never resolves to the same thread id bound under another Codex profile", () => {
    const savedCodexHome = process.env.CODEX_HOME;
    delete process.env.CODEX_HOME;
    try {
      const db = freshDb();
      const { explicitCodex } = legacyFixture(db);
      migrateLegacySessions(db);
      bound(db, "kai.cd34", ref({ harness: "codex", profile: "/elsewhere/codex-home", value: explicitCodex.sessionId }));
      const result = resolveLegacySession(explicitCodex.sessionId, undefined, db);
      expect(result).toMatchObject({ ok: false, error: { code: "ambiguous" } });
    } finally {
      if (savedCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = savedCodexHome;
    }
  });

  test("a resolve skips the legacy scan while nothing changed, and still sees a new session file or agent row", () => {
    const db = freshDb();
    legacyFixture(db);
    __test__.reset();
    resolveLegacySession("never-recorded", undefined, db);
    expect(__test__.scans()).toBe(1);
    resolveLegacySession("never-recorded", undefined, db);
    resolveLegacySession("never-recorded", "claude", db);
    expect(__test__.scans()).toBe(1);

    writeChatSession({ sessionId: "n0000000-0000-4000-8000-00000000000d", handle: "nova.1234", baseHandle: "x", signedInAt: 1 });
    const fromFile = resolveLegacySession("n0000000-0000-4000-8000-00000000000d", undefined, db);
    expect(__test__.scans()).toBe(2);
    expect(fromFile).toMatchObject({ ok: false, error: { message: expect.stringContaining("does not say which harness") } });

    const late = agent({ handle: "otis.5678" });
    insertAgent(late, db);
    expect(resolveLegacySession(late.sessionId, undefined, db)).toMatchObject({ ok: true, data: { identity: "otis.5678" } });
    expect(__test__.scans()).toBe(3);
    resolveLegacySession("never-recorded", undefined, db);
    expect(__test__.scans()).toBe(3);
  });

  test("migration preserves original agent and chat fields and is idempotent", () => {
    const db = freshDb();
    const fixture = legacyFixture(db);
    const before = [fixture.oldClaude, fixture.explicitCodex, fixture.ambiguous, fixture.headless].map((r) => getAgent(r.id, db));
    const chatBefore = readFileSync(sessionFilePath(fixture.oldClaude.sessionId), "utf8");

    migrateLegacySessions(db);
    const first = resolveLegacySession(fixture.oldClaude.sessionId, undefined, db);
    migrateLegacySessions(db);
    const second = resolveLegacySession(fixture.oldClaude.sessionId, undefined, db);

    expect([fixture.oldClaude, fixture.explicitCodex, fixture.ambiguous, fixture.headless].map((r) => getAgent(r.id, db))).toEqual(before);
    expect(readFileSync(sessionFilePath(fixture.oldClaude.sessionId), "utf8")).toBe(chatBefore);
    expect(first.ok && second.ok && second.data).toEqual(first.ok && first.data);
  });
});

describe("state version guard", () => {
  test("an older CLI refuses a db carrying session bindings", () => {
    const path = join(dir, "state.db");
    const db = openStateDb(path);
    bound(db, "remy.ab12", ref());
    db.close();

    expect(SCHEMA_VERSION).toBe(16);
    expect(() => openStateDbGuarded(path, 15)).toThrow(/newer than this rt build \(v16 > v15\)/);
    expect(() => openStateDbGuarded(path).close()).not.toThrow();
  });
});
