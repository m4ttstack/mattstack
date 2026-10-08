import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import pino from "pino";
import type { ModBlock } from "../../../packages/rt-client/src/agent-integrations.ts";
import { createGatesStore, type GateRow, type GatesStore } from "../../daemon/gates-store.ts";
import { openStateDb } from "../../state/db.ts";
import { claudeIntegration } from "../claude/integration.ts";
import { createModLinks, TESTED_CLAUDE_CODE } from "../claude/mod-links.ts";
import {
  claudeModSeam, createClaudeQuestions, nudgedQuestion, type ClaudeModSeam, type ClaudeQuestionDeps,
} from "../claude/questions.ts";
import type { CompletionPath } from "../question-store.ts";
import { createSessionStore } from "../session-store.ts";
import type { LivePane } from "../../daemon/pane-resolve-live.ts";

const log = pino({ level: "silent" });

type PaneReading = LivePane["agentStatus"] | null | "throw";

function fakes(opts: { reading?: PaneReading; notified?: boolean; dead?: boolean; escapeOk?: boolean } = {}) {
  const calls: string[] = [];
  const escapes: Array<{ gateId: string; paneRef: string }> = [];
  const deps: ClaudeQuestionDeps = {
    notify: async (row) => {
      calls.push(`notify:${row.id}`);
      return { ok: opts.notified ?? true, dead: opts.dead ?? false };
    },
    paneStatus: async (row) => {
      calls.push("probe");
      const reading = opts.reading === undefined ? "blocked" : opts.reading;
      if (reading === "throw") throw new Error("herdr exploded");
      return reading === null ? null : { paneRef: `w1:p-${row.nudge?.session}`, status: reading };
    },
    escape: async (row, paneRef) => {
      calls.push(`escape:${paneRef}`);
      escapes.push({ gateId: row.id, paneRef });
      return opts.escapeOk === false ? { ok: false, error: "pane_not_found: gone" } : { ok: true, paneRef };
    },
    log,
  };
  return { deps, calls, escapes };
}

function store(): GatesStore {
  return createGatesStore({ dbPath: ":memory:", log });
}

function formGate(s: GatesStore, opts: { by?: string; session?: string; presentation?: "form" | "wait" } = {}): GateRow {
  const row = s.open({
    subject: "mr:https://gitlab.example.com/x/1", kind: "review-post",
    questions: [{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }],
    nudge: { session: "sess-1" }, pane: "w1:p-sess-1",
    origin: { presentation: opts.presentation ?? "form", paneId: "w1:p-sess-1" },
  }).row;
  s.answer(row.id, { q: "a" }, opts.by ?? "console", opts.session ? { session: opts.session } : {});
  return s.get(row.id)!;
}

async function complete(deps: ClaudeQuestionDeps, row: GateRow, target = nudgedQuestion(row)!) {
  return createClaudeQuestions(deps).complete(target.binding, target.question, row);
}

describe("Claude question completion", () => {
  test("dismiss only matching blocked form after submitted notification", async () => {
    for (const reading of ["idle", "working"] as const) {
      const f = fakes({ reading });
      const s = store();
      const row = formGate(s);
      expect(await complete(f.deps, row), reading).toEqual({ ok: true, data: "completed" });
      expect(f.calls, reading).toEqual(["probe", `notify:${row.id}`]);
      expect(f.escapes, reading).toHaveLength(0);
    }

    const failed = fakes({ notified: false });
    const failedRow = formGate(store());
    expect(await complete(failed.deps, failedRow)).toEqual({ ok: true, data: "pending" });
    expect(failed.calls).toEqual(["probe", `notify:${failedRow.id}`]);
    expect(failed.escapes).toHaveLength(0);

    const self = fakes();
    const selfRow = formGate(store(), { by: "pane", session: "sess-1" });
    expect(await complete(self.deps, selfRow)).toEqual({ ok: true, data: "completed" });
    expect(self.calls).toEqual([]);

    const staleRow = formGate(store());
    const target = nudgedQuestion(staleRow)!;
    const stale = [
      { ...target, question: { ...target.question, generation: target.binding.attachment.generation + 1 } },
      { ...target, binding: { ...target.binding, native: { ...target.binding.native, value: "sess-2" } } },
      { ...target, question: { ...target.question, gateId: "gate-other" } },
      { ...target, question: { ...target.question, sessionKey: "another-key" } },
      { ...target, binding: { ...target.binding, native: { ...target.binding.native, harness: "codex" } } },
    ];
    for (const candidate of stale) {
      const f = fakes();
      const out = await complete(f.deps, staleRow, candidate);
      expect(out.ok, JSON.stringify(candidate)).toBe(false);
      if (!out.ok) expect(out.error.code).toBe("stale-binding");
      expect(f.calls, JSON.stringify(candidate)).toEqual([]);
    }

    const current = fakes();
    const row = formGate(store());
    expect(await complete(current.deps, row)).toEqual({ ok: true, data: "completed" });
    expect(current.calls).toEqual(["probe", `notify:${row.id}`, "escape:w1:p-sess-1"]);
    expect(current.escapes).toEqual([{ gateId: row.id, paneRef: "w1:p-sess-1" }]);
  });

  test("no Escape after the answer is consumed", async () => {
    const f = fakes();
    const s = store();
    const answered = formGate(s);
    s.markConsumed(answered.id);
    const row = s.get(answered.id)!;
    expect(await complete(f.deps, row)).toEqual({ ok: true, data: "completed" });
    expect(f.escapes).toHaveLength(0);
    expect(f.calls).not.toContain("probe");
  });

  test("a session that no longer resolves reads gone, with no Escape", async () => {
    const f = fakes({ notified: false, dead: true });
    expect(await complete(f.deps, formGate(store()))).toEqual({ ok: true, data: "gone" });
    expect(f.escapes).toHaveLength(0);
  });

  test("a wait gate, an unreadable pane, or a probe that throws gets the notification only", async () => {
    const wait = fakes();
    const waitRow = formGate(store(), { presentation: "wait" });
    await complete(wait.deps, waitRow);
    expect(wait.calls).toEqual([`notify:${waitRow.id}`]);
    for (const reading of [null, "throw"] as const) {
      const f = fakes({ reading });
      expect(await complete(f.deps, formGate(store()))).toEqual({ ok: true, data: "completed" });
      expect(f.escapes, String(reading)).toHaveLength(0);
    }
  });

  test("without both a pane probe and an Escape sender the pane is never read", async () => {
    for (const missing of ["paneStatus", "escape"] as const) {
      const f = fakes();
      const deps = { ...f.deps, [missing]: undefined };
      await complete(deps, formGate(store()));
      expect(f.calls, missing).toEqual([expect.stringMatching(/^notify:/)]);
    }
  });

  test("a failed Escape still reads completed: the notification was submitted", async () => {
    const f = fakes({ escapeOk: false });
    expect(await complete(f.deps, formGate(store()))).toEqual({ ok: true, data: "completed" });
    expect(f.escapes).toHaveLength(1);
  });

  test("a closed gate the nudged pane had answered is notified, never probed", async () => {
    const f = fakes();
    const s = store();
    const answered = formGate(s, { by: "pane", session: "sess-1" });
    expect(s.closeAnswered(answered.id, "abandoned")).toEqual({ ok: true });
    const row = s.get(answered.id)!;
    await complete(f.deps, row);
    expect(f.calls).toEqual([`notify:${row.id}`]);
  });

  test("a gate is completed against the session it nudges; without a nudge there is nothing to complete", () => {
    const s = store();
    const row = formGate(s);
    const target = nudgedQuestion(row)!;
    expect(target.binding.native).toMatchObject({ harness: "claude", kind: "id", value: "sess-1" });
    expect(target.question).toMatchObject({ gateId: row.id, sessionKey: target.binding.key, generation: target.binding.attachment.generation, presentation: "form" });
    expect(target.question.nativeQuestions).toBeUndefined();
    const bare = s.open({ subject: "run:r1", kind: "clarify", questions: [{ id: "q", label: "Pick", multi: false, options: ["a"] }] }).row;
    expect(nudgedQuestion(bare)).toBeNull();
  });
});

describe("Claude question completion through the mod", () => {
  type Recorded = { gateId: string; path: CompletionPath; state: string };

  /** A gate-form block that is live for `live` sessions and acks with `ack`; `moves` maps a /clear's old id to its new one. */
  function modded(opts: { live?: string[]; ack?: boolean | "throw"; moves?: Record<string, string> } & Parameters<typeof fakes>[0] = {}) {
    const f = fakes(opts);
    const recorded: Recorded[] = [];
    const mod: ClaudeModSeam = {
      current: (session) => opts.moves?.[session] ?? session,
      owns: (binding) => (opts.live ?? ["sess-1"]).includes(binding.native.value),
      async complete(session, gateId) {
        f.calls.push(`mod:${session}:${gateId}`);
        if (opts.ack === "throw") throw new Error("inbox write failed");
        return opts.ack ?? true;
      },
    };
    const deps: ClaudeQuestionDeps = {
      ...f.deps,
      mod,
      record: (row, path, state) => { recorded.push({ gateId: row.id, path, state }); },
    };
    return { ...f, deps, recorded };
  }

  test("a session with gate-form live gets no doorbell and no Escape", async () => {
    const m = modded();
    const row = formGate(store());
    expect(await complete(m.deps, row)).toEqual({ ok: true, data: "completed" });
    expect(m.calls).toEqual([`mod:sess-1:${row.id}`]);
    expect(m.escapes).toHaveLength(0);
    expect(m.recorded).toEqual([{ gateId: row.id, path: "mod-result", state: "completed" }]);
  });

  test("without the block, doorbell and Escape behave exactly as M5a", async () => {
    const m = modded({ live: [] });
    const row = formGate(store());
    expect(await complete(m.deps, row)).toEqual({ ok: true, data: "completed" });
    expect(m.calls).toEqual(["probe", `notify:${row.id}`, "escape:w1:p-sess-1"]);
    expect(m.recorded).toEqual([]);

    const self = modded({ live: [] });
    const selfRow = formGate(store(), { by: "pane", session: "sess-1" });
    expect(await complete(self.deps, selfRow)).toEqual({ ok: true, data: "completed" });
    expect(self.calls).toEqual([]);
  });

  test("an unacked mod completion falls back to the doorbell once and records doorbell", async () => {
    for (const ack of [false, "throw"] as const) {
      const m = modded({ ack });
      const row = formGate(store());
      expect(await complete(m.deps, row), String(ack)).toEqual({ ok: true, data: "completed" });
      expect(m.calls, String(ack)).toEqual([`mod:sess-1:${row.id}`, "probe", `notify:${row.id}`, "escape:w1:p-sess-1"]);
      expect(m.recorded, String(ack)).toEqual([{ gateId: row.id, path: "doorbell", state: "completed" }]);
    }

    const dead = modded({ ack: false, notified: false, dead: true });
    const deadRow = formGate(store());
    expect(await complete(dead.deps, deadRow)).toEqual({ ok: true, data: "gone" });
    expect(dead.recorded).toEqual([{ gateId: deadRow.id, path: "doorbell", state: "gone" }]);
  });

  test("a gate the pane answered itself is neither pushed nor recorded", async () => {
    const m = modded();
    const row = formGate(store(), { by: "pane", session: "sess-1" });
    expect(await complete(m.deps, row)).toEqual({ ok: true, data: "completed" });
    expect(m.calls).toEqual([]);
    expect(m.recorded).toEqual([]);
  });

  test("a gate asked before /clear completes on the continued session", async () => {
    const m = modded({ live: ["sess-2"], moves: { "sess-1": "sess-2" } });
    const row = formGate(store());
    expect(await complete(m.deps, row)).toEqual({ ok: true, data: "completed" });
    expect(m.calls).toEqual([`mod:sess-2:${row.id}`]);

    const notified: Array<string | undefined> = [];
    const fallback = modded({ live: [], moves: { "sess-1": "sess-2" } });
    const deps: ClaudeQuestionDeps = {
      ...fallback.deps,
      notify: async (r) => { notified.push(r.nudge?.session); return { ok: true, dead: false }; },
    };
    expect(await complete(deps, formGate(store()))).toEqual({ ok: true, data: "completed" });
    expect(notified).toEqual(["sess-2"]);
    expect(fallback.escapes).toEqual([{ gateId: expect.any(String), paneRef: "w1:p-sess-2" }]);

    const answeredThere = modded({ live: ["sess-2"], moves: { "sess-1": "sess-2" } });
    expect(await complete(answeredThere.deps, formGate(store(), { by: "pane", session: "sess-2" }))).toEqual({ ok: true, data: "completed" });
    expect(answeredThere.calls).toEqual([]);
  });

  test("the daemon's seam follows a /clear continuation and asks the continued session's mod", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rt-claude-questions-"));
    try {
      const links = createModLinks({
        now: () => 1_000_000, integrationsEnabled: () => true,
        store: createSessionStore(openStateDb(join(dir, "state.db"))),
      });
      const reg = (sessionId: string, blocks: ModBlock[], previous?: { sessionId: string; linkId: string }) => {
        const out = links.register({
          sessionId, cwd: "/repo", root: "/repo", claudeCode: TESTED_CLAUDE_CODE.max, plugin: "0.1.0", blocks,
          ...(previous && { previousSessionId: previous.sessionId, previousLinkId: previous.linkId }),
        });
        if (!out.ok) throw new Error(out.error.message);
        return out.data.linkId;
      };
      const pushed: Array<{ session: string; kind: string; data: unknown }> = [];
      const seam = claudeModSeam(links, async (session, kind, data) => {
        pushed.push({ session, kind, data });
        return { ok: true, data: { acked: true } };
      });

      const first = reg("sess-1", ["gate-form"]);
      expect(seam.current("sess-1")).toBe("sess-1");
      reg("sess-2", ["gate-form"], { sessionId: "sess-1", linkId: first });
      expect(seam.current("sess-1")).toBe("sess-2");
      expect(seam.current("sess-9")).toBe("sess-9");

      const m = fakes();
      const row = formGate(store());
      const deps: ClaudeQuestionDeps = { ...m.deps, mod: seam, record: () => {} };
      expect(await complete(deps, row)).toEqual({ ok: true, data: "completed" });
      expect(pushed).toEqual([{ session: "sess-2", kind: "gate-complete", data: { id: row.id } }]);
      expect(m.calls).toEqual([]);

      expect(claudeModSeam(null).owns(nudgedQuestion(row)!.binding)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Claude question wiring", () => {
  test("the integration loads its question adapter and advertises a form only where a pane can be dismissed", async () => {
    expect(typeof claudeIntegration.loadQuestions).toBe("function");
    const adapter = await claudeIntegration.loadQuestions!();
    // A stale binding is refused before any transport is reached, so this never reads the Claude registry under HOME.
    const row = formGate(store(), { presentation: "wait" });
    const target = nudgedQuestion(row)!;
    const stale = { ...target.question, generation: target.question.generation + 1 };
    expect(await adapter.complete(target.binding, stale, row)).toMatchObject({ ok: false, error: { code: "stale-binding" } });
    expect((await claudeIntegration.capabilities("herdr")).supported).toContain("questions-form");
    expect((await claudeIntegration.capabilities("headless")).supported).not.toContain("questions-form");
  });
});
