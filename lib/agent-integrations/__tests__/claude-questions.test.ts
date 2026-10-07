import { describe, expect, test } from "bun:test";
import pino from "pino";
import { createGatesStore, type GateRow, type GatesStore } from "../../daemon/gates-store.ts";
import { claudeIntegration } from "../claude/integration.ts";
import { createClaudeQuestions, nudgedQuestion, type ClaudeQuestionDeps } from "../claude/questions.ts";
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

describe("Claude question wiring", () => {
  test("the integration loads its question adapter and advertises a form only where a pane can be dismissed", async () => {
    expect(typeof claudeIntegration.loadQuestions).toBe("function");
    const adapter = await claudeIntegration.loadQuestions!();
    const row = formGate(store(), { presentation: "wait" });
    const target = nudgedQuestion(row)!;
    expect(await adapter.complete(target.binding, target.question, row)).toEqual({ ok: true, data: "gone" });
    expect((await claudeIntegration.capabilities("herdr")).supported).toContain("questions-form");
    expect((await claudeIntegration.capabilities("headless")).supported).not.toContain("questions-form");
  });
});
