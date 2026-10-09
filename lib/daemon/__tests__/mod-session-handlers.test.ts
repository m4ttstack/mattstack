import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ModBlock, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { runStart } from "../../runs/start.ts";
import { openRunDb, runStatus, stageEnd, stageStart } from "../../runs/write.ts";
import { openStateDb } from "../../state/index.ts";
import { createSessionStore } from "../../agent-integrations/session-store.ts";
import { createModLinks, TESTED_CLAUDE_CODE } from "../../agent-integrations/claude/mod-links.ts";
import { createModSessionHandlers } from "../handlers/mod-session.ts";

function setup(enabled = true) {
  const links = createModLinks({
    now: () => 5_000, integrationsEnabled: () => enabled, store: createSessionStore(openStateDb(":memory:")),
  });
  return { links, handlers: createModSessionHandlers({ links }) };
}

const registration = {
  sessionId: "sess-1", cwd: "/repo", root: "/repo", pane: "w1:p1",
  claudeCode: TESTED_CLAUDE_CODE.max, plugin: "0.1.0", blocks: ["delivery", "presence"],
};

type Reply = { ok: boolean; data?: unknown; error?: string; failure?: { code: string; message: string } };
const call = (fn: (payload: never) => Promise<unknown>, payload: unknown) => fn(payload as never) as Promise<Reply>;

describe("session:* handlers", () => {
  test("session:register validates its payload", async () => {
    const { handlers } = setup();
    for (const bad of [
      undefined, {}, { ...registration, sessionId: "" }, { ...registration, cwd: 3 }, { ...registration, root: undefined },
      { ...registration, claudeCode: "" }, { ...registration, plugin: null }, { ...registration, blocks: "delivery" },
      { ...registration, blocks: [1] }, { ...registration, pane: 4 }, { ...registration, previousSessionId: 7 },
    ]) {
      const reply = await call(handlers["session:register"], bad);
      expect(reply.ok).toBe(false);
      expect(reply.failure?.code).toBe("invalid");
    }
  });

  test("session:register answers the link id and the blocks it counts", async () => {
    const { handlers, links } = setup();
    const reply = await call(handlers["session:register"], registration);
    expect(reply.ok).toBe(true);
    const data = reply.data as { linkId: string; blocks: string[] };
    expect(data.blocks).toEqual(["delivery", "presence"]);
    expect(links.linkOf("sess-1")?.linkId).toBe(data.linkId);
  });

  test("session:register with the switch off is refused", async () => {
    const { handlers } = setup(false);
    const reply = await call(handlers["session:register"], registration);
    expect(reply.ok).toBe(false);
    expect(reply.failure?.code).toBe("refused");
  });

  test("session:heartbeat, session:end and session:ack validate their payloads", async () => {
    const { handlers } = setup();
    for (const verb of ["session:heartbeat", "session:end", "session:ack"] as const) {
      for (const bad of [undefined, {}, { linkId: "" }, { linkId: 3 }]) {
        const reply = await call(handlers[verb], bad);
        expect(reply.ok).toBe(false);
        expect(reply.failure?.code).toBe("invalid");
      }
    }
    for (const bad of [{ linkId: "ml-1" }, { linkId: "ml-1", id: "" }, { linkId: "ml-1", id: 9 }]) {
      const reply = await call(handlers["session:ack"], bad);
      expect(reply.failure?.code).toBe("invalid");
    }
  });

  test("every session verb answers an unknown link with unknown-link", async () => {
    const { handlers } = setup();
    for (const [verb, payload] of [
      ["session:heartbeat", { linkId: "ml-missing" }],
      ["session:end", { linkId: "ml-missing" }],
      ["session:ack", { linkId: "ml-missing", id: "cmd-1" }],
    ] as const) {
      const reply = await call(handlers[verb], payload);
      expect(reply).toEqual({ ok: false, error: "unknown link", failure: { code: "unknown-link", message: expect.any(String) } });
    }
  });

  test("a known link heartbeats, acks and ends", async () => {
    const { handlers, links } = setup();
    const { linkId } = (await call(handlers["session:register"], registration)).data as { linkId: string };
    expect(await call(handlers["session:heartbeat"], { linkId })).toEqual({ ok: true, data: {} });
    expect(await call(handlers["session:ack"], { linkId, id: "cmd-1" })).toEqual({ ok: true, data: {} });
    expect(links.takeAck("cmd-1", "sess-1")).toMatchObject({ linkId, sessionId: "sess-1" });
    expect(await call(handlers["session:end"], { linkId })).toEqual({ ok: true, data: {} });
    expect(links.live("sess-1", "delivery")).toBe(false);
    expect((await call(handlers["session:heartbeat"], { linkId })).failure?.code).toBe("unknown-link");
  });

  test("session:push validates its payload and answers what the push answered", async () => {
    const links = createModLinks({
      now: () => 5_000, integrationsEnabled: () => true, store: createSessionStore(openStateDb(":memory:")),
    });
    const pushed: unknown[][] = [];
    const handlers = createModSessionHandlers({
      links,
      push: async (sessionId, kind, data) => {
        pushed.push([sessionId, kind, data]);
        return kind === "probe.ping" ? { ok: true, data: { acked: true } } : { ok: false, error: { code: "not-ready", message: "no live link" } };
      },
    });
    for (const bad of [undefined, {}, { sessionId: "", kind: "probe.ping" }, { sessionId: "sess-1" }, { sessionId: "sess-1", kind: 3 }]) {
      const reply = await call(handlers["session:push"], bad);
      expect(reply.failure?.code).toBe("invalid");
    }
    expect(pushed).toHaveLength(0);

    expect(await call(handlers["session:push"], { sessionId: "sess-1", kind: "probe.ping", data: { n: 1 } })).toEqual({ ok: true, data: { acked: true } });
    expect(await call(handlers["session:push"], { sessionId: "sess-1", kind: "probe.wait" })).toEqual({
      ok: false, error: "no live link", failure: { code: "not-ready", message: "no live link" },
    });
    expect(pushed).toEqual([["sess-1", "probe.ping", { n: 1 }], ["sess-1", "probe.wait", null]]);
  });

  test("session:push refuses every kind outside probe.* and writes nothing to the inbox", async () => {
    const links = createModLinks({
      now: () => 5_000, integrationsEnabled: () => true, store: createSessionStore(openStateDb(":memory:")),
    });
    const pushed: string[] = [];
    const handlers = createModSessionHandlers({
      links,
      push: async (_sessionId, kind) => {
        pushed.push(kind);
        return { ok: true, data: { acked: true } };
      },
    });
    for (const kind of ["gate.complete", "nudge", "probe", "probes.ping"]) {
      const reply = await call(handlers["session:push"], { sessionId: "sess-1", kind });
      expect(reply.ok).toBe(false);
      expect(reply.failure?.code).toBe("refused");
    }
    expect(pushed).toHaveLength(0);
  });
});

describe("session:end and the session's runs", () => {
  let dir = "";
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rt-mod-session-runs-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const NOW = 50_000;

  function world(opts: { blocks?: ModBlock[]; enabled?: boolean } = {}) {
    const db = openStateDb(join(dir, "state.db"));
    const store = createSessionStore(db);
    const bindClaude = (session: string, identity: string) => {
      const bound = store.bind(store.reserve({ identity }), { harness: "claude", profile: "default", kind: "id", value: session }, { mode: "herdr", pane: "w1:p1" });
      if (!bound.ok) throw new Error(bound.error.message);
      return bound.data;
    };
    const mine = bindClaude("sess-1", "me");
    const theirs = bindClaude("sess-2", "them");
    const links = createModLinks({ now: () => 5_000, integrationsEnabled: () => true, store });
    const registered = links.register({ ...registration, blocks: opts.blocks ?? ["observe"] });
    if (!registered.ok) throw new Error(registered.error.message);
    const runsRoot = join(dir, "runs");
    const handlers = createModSessionHandlers({
      links, endRetryMs: 0,
      lifecycle: { db, enabled: () => opts.enabled ?? true, now: () => NOW, deleteSessionFile: () => {}, runsRoot },
    });
    /** A run with `plan` done and `implement` open. */
    const run = (runId: string, binding: SessionBinding, status = "running") => {
      const started = runStart(runsRoot, { repo: "repo-a", workType: "feature", pipeline: "feature", runId, env: {}, now: 1000, binding });
      if (!started.ok) throw new Error(started.error);
      const r = openRunDb(started.runDb);
      stageStart(r, "plan", {}, 2000);
      stageEnd(r, "plan", "done", { now: 3000 });
      stageStart(r, "implement", {}, 4000);
      if (status !== "running") runStatus(r, status, 4500);
      r.close();
      return started.runDb;
    };
    return { db, handlers, linkId: registered.data.linkId, mine, theirs, run };
  }

  function stages(path: string): { name: string; status: string; ended_at: number | null; reason: string | null }[] {
    const r = new Database(path, { readonly: true });
    try {
      return r.query("SELECT name, status, ended_at, reason FROM stages ORDER BY started_at").all() as never;
    } finally {
      r.close();
    }
  }

  function runRow(path: string): { status: string; ended_at: number | null } {
    const r = new Database(path, { readonly: true });
    try {
      return r.query("SELECT status, ended_at FROM runs").get() as never;
    } finally {
      r.close();
    }
  }

  test("session end abandons only the owned running stage", async () => {
    const w = world();
    const own = w.run("r-own", w.mine);
    const foreign = w.run("r-foreign", w.theirs);
    const ended = w.run("r-ended", w.mine, "done");
    const before = { foreign: stages(foreign), ended: stages(ended) };

    expect(await call(w.handlers["session:end"], { linkId: w.linkId })).toEqual({ ok: true, data: {} });

    expect(stages(own)).toEqual([
      { name: "plan", status: "done", ended_at: 3000, reason: null },
      { name: "implement", status: "abandoned", ended_at: NOW, reason: expect.stringContaining("session") },
    ]);
    // The run itself stays running: only a person decides a run is dead.
    expect(runRow(own)).toEqual({ status: "running", ended_at: null });
    expect(stages(foreign)).toEqual(before.foreign);
    expect(stages(ended)).toEqual(before.ended);
  });

  test("with the switch off, or a link without the observe block, a session end changes no run", async () => {
    for (const opts of [{ enabled: false }, { blocks: ["presence" as const] }]) {
      rmSync(dir, { recursive: true, force: true });
      dir = mkdtempSync(join(tmpdir(), "rt-mod-session-runs-"));
      const w = world(opts);
      const own = w.run("r-own", w.mine);
      const before = stages(own);
      expect((await call(w.handlers["session:end"], { linkId: w.linkId })).ok).toBe(true);
      expect(stages(own)).toEqual(before);
    }
  });
});
