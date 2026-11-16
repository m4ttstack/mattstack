import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import pino from "pino";
import { createGatesStore, type GatesStore, type GateQuestion } from "../gates-store.ts";
import { createGateHandlers } from "../handlers/gate.ts";
import { validateGateAnswers } from "../../../packages/rt-client/src/gate-answers.ts";
import type { EventsBus } from "../events-bus.ts";
import type { GateSubjectResult } from "../gate-subject.ts";
import type { GatePush } from "../gate-push.ts";

const log = pino({ level: "silent" });

let dirs: string[] = [];
beforeEach(() => { dirs = []; });
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function twoOptionQuestion(): GateQuestion[] {
  return [{ id: "q1", label: "go?", multi: false, options: ["yes", "no"] }];
}

function fiveOptionQuestion(): GateQuestion[] {
  return [{ id: "q1", label: "pick", multi: false, options: ["a", "b", "c", "d", "e"] }];
}

/** Same shape as gates-handlers.test.ts's harness, plus an injectable
    resolveSubject -- gate:ask's own seam, tested independently of
    resolveGateSubject's own suite (gate-subject.test.ts). */
function harness(opts: {
  resolveSubject?: (args: { subject?: string; sessionId?: string }) => GateSubjectResult;
  runSpawnedBy?: (runId: string) => string | null;
  runWorktree?: (runId: string) => string | null;
  runCurrentStage?: (runId: string) => string | null;
  push?: GatePush;
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rt-gate-ask-handler-"));
  dirs.push(dir);
  const store: GatesStore = createGatesStore({ dbPath: join(dir, "gates.db"), log });
  let nextId = 1;
  const events: Array<{ topic: string; payload: Record<string, unknown> }> = [];
  const bus = { emitAt: (topic: string, payload: Record<string, unknown>) => { events.push({ topic, payload }); return nextId++; } } as unknown as EventsBus;
  const handlers = createGateHandlers(store, bus, () => {}, {
    resolveSubject: opts.resolveSubject,
    runSpawnedBy: opts.runSpawnedBy,
    runWorktree: opts.runWorktree,
    runCurrentStage: opts.runCurrentStage,
    push: opts.push,
  });
  return { handlers, store, events };
}

describe("gate:ask", () => {
  test("(a) explicit subject + paneId + sessionId + 2-option question -> form, nudge present, origin form", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(),
      subject: "mr:https://x/1", sessionId: "sess-1", paneId: "w1:p1",
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.presentation).toBe("form");
    expect(res.data.subject).toBe("mr:https://x/1");
    const row = store.get(res.data.id)!;
    expect(row.nudge).toEqual({ session: "sess-1" });
    expect(row.origin?.presentation).toBe("form");
    expect(row.origin?.paneId).toBe("w1:p1");
  });

  test("(b) 5-option question -> wait, no nudge", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: fiveOptionQuestion(),
      subject: "mr:https://x/1", sessionId: "sess-1", paneId: "w1:p1",
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.presentation).toBe("wait");
    const row = store.get(res.data.id)!;
    expect(row.nudge).toBeNull();
    expect(row.origin?.presentation).toBe("wait");
  });

  test("(c) session resolving to a run -> subject run:<id>, origin carries runId + worktree", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "run:r1", runId: "r1", runWorktree: "/wt/r1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), sessionId: "sess-1", paneId: "w1:p1",
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.subject).toBe("run:r1");
    const row = store.get(res.data.id)!;
    expect(row.origin?.runId).toBe("r1");
    expect(row.origin?.worktree).toBe("/wt/r1");
  });

  test("(d) no resolvable subject -> ok:false with the resolver's error", async () => {
    const { handlers } = harness({
      resolveSubject: () => ({ ok: false, error: "no subject: pass --subject, or run under a recorded run/agent session" }),
    });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), context: "why this decision" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("no subject: pass --subject, or run under a recorded run/agent session");
  });

  test("(e) context of 9000 bytes -> gate opens, row.context stored whole", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const bigContext = "x".repeat(9000);
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:https://x/1", context: bigContext,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.context).toBe(bigContext);
  });

  test("(f) response shape {id, presentation, boardOnly, subject, supersededId}", async () => {
    const { handlers } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), subject: "mr:https://x/1", context: "why this decision" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.keys(res.data).sort()).toEqual(["boardOnly", "id", "presentation", "subject", "supersededId"]);
    expect(res.data.supersededId).toBeNull();
  });

  test("(g) sessionId resolving to an agent record -> subject agent:<id>", async () => {
    const { handlers } = harness({
      resolveSubject: () => ({ ok: true, subject: "agent:ag-9" }),
    });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), sessionId: "sess-1", context: "why this decision" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.subject).toBe("agent:ag-9");
  });

  test("(h) an options-less question with pane + session refuses cleanly (no throw)", async () => {
    const { handlers } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: [{ id: "q1", label: "go?", multi: false }],
      subject: "mr:https://x/1", sessionId: "sess-1", paneId: "w1:p1",
      context: "why this decision",
    });
    expect(res).toEqual({ ok: false, error: "invalid questions" });
  });

  test("(i) a null question refuses cleanly (no throw)", async () => {
    const { handlers } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: [null],
      subject: "mr:https://x/1", sessionId: "sess-1", paneId: "w1:p1",
      context: "why this decision",
    });
    expect(res).toEqual({ ok: false, error: "invalid questions" });
  });

  test("(j) multibyte context past the old 8192-byte cap (4097 'é' chars) is stored whole", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const context = "é".repeat(4097);
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:https://x/1", context,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(store.get(res.data.id)!.context).toBe(context);
  });

  test("(k) multibyte context of 4096 'é' chars (8192 bytes) keeps its context", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const context = "é".repeat(4096);
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:https://x/1", context,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.context).toBe(context);
  });

  test("(l) meta/agent/origin passthrough ride into the row; ceremony-derived presentation and paneId still win", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(),
      subject: "mr:https://x/1", sessionId: "sess-1", paneId: "w1:p1",
      meta: { label: "review gate !7" }, agent: "worker-1",
      origin: { surface: "board", tabId: "t9", worktree: "/tmp/wt" },
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.meta).toEqual({ label: "review gate !7" });
    expect(row.agent).toBe("worker-1");
    expect(row.origin?.surface).toBe("board");
    expect(row.origin?.tabId).toBe("t9");
    expect(row.origin?.worktree).toBe("/tmp/wt");
    expect(row.origin?.presentation).toBe("form");
    expect(row.origin?.paneId).toBe("w1:p1");
  });

  test("(m) a run-derived worktree beats a passthrough worktree", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "run:r1", runId: "r1", runWorktree: "/run/wt" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), sessionId: "sess-1",
      origin: { worktree: "/caller/wt" },
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.origin?.worktree).toBe("/run/wt");
  });

  test("(n) a raw payload smuggling origin.presentation with no paneId still gets the ceremony's computed presentation", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:https://x/1",
      origin: { presentation: "form" } as unknown as { surface?: string },
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.origin?.presentation).toBe("wait");
    expect(row.origin?.paneId).toBeUndefined();
  });

  test("(o) a raw payload smuggling origin.paneId/origin.runId is dropped when no top-level paneId and an explicit non-run subject", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:https://x/1",
      origin: { paneId: "smuggled", runId: "smuggled" } as unknown as { surface?: string },
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.origin?.paneId).toBeUndefined();
    expect(row.origin?.runId).toBeUndefined();
  });

  test("(p) a raw payload with an unknown origin key is rejected by gate:open's validation", async () => {
    const { handlers } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:https://x/1",
      origin: { foo: "x" } as unknown as { surface?: string },
      context: "why this decision",
    });
    expect(res.ok).toBe(false);
  });

  test("(q) explicit non-run subject enriched with a run session's runId/worktree carries both into origin", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:x", runId: "r1", runWorktree: "/w" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:x", sessionId: "sess-1",
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.origin?.runId).toBe("r1");
    expect(row.origin?.worktree).toBe("/w");
  });

  test("(r) explicit run: subject keeps its own runId regardless of the session's runs", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "run:rZ", runId: "rZ" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "run:rZ", sessionId: "sess-1",
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.subject).toBe("run:rZ");
    const row = store.get(res.data.id)!;
    expect(row.origin?.runId).toBe("rZ");
  });

  test("(s) owner derivation reads the runId gate:ask derives from resolved.runId, same as an explicit run: subject", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:x", runId: "r1" }),
      runSpawnedBy: () => "herd:h-9",
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:x", sessionId: "sess-1",
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.owner).toBe("herd:h-9");
  });

  test("(t) explicit non-run subject + sessionId's run worktree + passthrough origin.worktree: the run-derived worktree wins", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:x", runId: "r1", runWorktree: "/run/wt" }),
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:x", sessionId: "sess-1",
      origin: { worktree: "/caller/wt" },
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.origin?.worktree).toBe("/run/wt");
    expect(row.origin?.runId).toBe("r1");
  });
});

// RT-179: only the session-owns-the-run path stamped origin.worktree, so a
// gate opened on any other run: subject was invisible to the hook's
// per-worktree match.
describe("gate:ask review and respond post gates are board-only", () => {
  for (const kind of ["review-post", "respond-plan", "respond-post"]) {
    test(`${kind} with a formable pane still presents wait, with no nudge`, async () => {
      const { handlers, store } = harness({
        resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
      });
      const res = await handlers["gate:ask"]({
        questions: twoOptionQuestion(), kind,
        subject: "mr:https://x/1", sessionId: "sess-1", paneId: "w1:p1",
        context: "why this decision",
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.data.presentation).toBe("wait");
      const row = store.get(res.data.id)!;
      expect(row.nudge ?? null).toBeNull();
      expect(row.origin?.paneId).toBe("w1:p1");
    });
  }

  test("another kind on the same pane still presents a form", async () => {
    const { handlers } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }) });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), kind: "plan",
      subject: "mr:https://x/1", sessionId: "sess-1", paneId: "w1:p1", context: "why",
    });
    expect(res.ok && res.data.presentation).toBe("form");
  });
});

describe("gate:ask stamps origin.worktree whenever the runId is known", () => {
  test("a run subject the session does not own gets its worktree from the runWorktree dep", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "run:r9", runId: "r9" }),
      runWorktree: (runId) => (runId === "r9" ? "/wt/r9" : null),
    });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), subject: "run:r9", context: "why this decision" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.origin?.runId).toBe("r9");
    expect(row.origin?.worktree).toBe("/wt/r9");
  });

  test("the resolver's own worktree wins over the dep lookup", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "run:r1", runId: "r1", runWorktree: "/run/wt" }),
      runWorktree: () => "/stale/wt",
    });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), sessionId: "sess-1", context: "why this decision" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(store.get(res.data.id)!.origin?.worktree).toBe("/run/wt");
  });

  test("a run with no recorded worktree leaves a caller-supplied origin.worktree intact", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "run:r2", runId: "r2" }),
      runWorktree: () => null,
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "run:r2", origin: { worktree: "/caller/wt" },
      context: "why this decision",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(store.get(res.data.id)!.origin?.worktree).toBe("/caller/wt");
  });

  test("no runId at all: no lookup happens and the gate opens without a worktree", async () => {
    let calls = 0;
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:x" }),
      runWorktree: () => { calls++; return "/never"; },
    });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), subject: "mr:x", context: "why this decision" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(calls).toBe(0);
    expect(store.get(res.data.id)!.origin?.worktree).toBeUndefined();
  });
});

// RT-177: an agent opened a human decision gate with no context because it
// feared the size cap, and Matt hit a bare decision form in the board.
describe("gate:ask context enforcement", () => {
  const CTX = "the plan section under decision, quoted verbatim";

  test("a human-owned gate with no context is refused, naming what to pass", async () => {
    const { handlers } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), subject: "mr:x" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("context");
    expect(res.error).toContain("decide from alone");
  });

  test("whitespace-only context counts as none", async () => {
    const { handlers } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), subject: "mr:x", context: "   \n\t " });
    expect(res.ok).toBe(false);
  });

  test("a human-owned gate WITH context opens as before", async () => {
    const { handlers, store } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), subject: "mr:x", context: CTX });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(store.get(res.data.id)!.context).toBe(CTX);
    expect("contextOmitted" in res.data).toBe(false);
  });

  test("a herd-owned run gate is not refused: the shepherd reads the registry, not a bare form", async () => {
    const { handlers } = harness({
      resolveSubject: () => ({ ok: true, subject: "run:r1", runId: "r1" }),
      runSpawnedBy: () => "herd:h-9",
    });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), sessionId: "sess-1" });
    expect(res.ok).toBe(true);
  });

  test("the milestone kind is exempt: its artifact carries the material", async () => {
    const { handlers } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), subject: "mr:x", kind: "milestone" });
    expect(res.ok).toBe(true);
  });

  test("the pane-attention kind is exempt: an internal wait-path gate carries none", async () => {
    const { handlers } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), subject: "mr:x", kind: "pane-attention" });
    expect(res.ok).toBe(true);
  });

  test("an oversized context is stored whole and the response carries no omitted flag", async () => {
    const { handlers, store } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const context = "x".repeat(40_000);
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), subject: "mr:x", context });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect("contextOmitted" in res.data).toBe(false);
    expect(store.get(res.data.id)!.context).toBe(context);
  });
});

// RT-202: a caller whose question busts the form's option cap used to get a
// bare "wait" with no reason, which is how option-folding survived across
// every wrapper skill. The response now says why, once, at the seam.
describe("gate:ask form-cap advisory (RT-202)", () => {
  const CTX = "the plan section under decision, quoted verbatim";

  test("an over-cap question on a formable pane reports which question and why", async () => {
    const { handlers } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({
      questions: fiveOptionQuestion(), subject: "mr:x", context: CTX,
      sessionId: "sess-1", paneId: "w1:p1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.presentation).toBe("wait");
    expect(res.data.formCapExceeded).toEqual([{ question: "q1", options: 5 }]);
    expect(res.data.formCapAdvisory).toContain("4 options");
    expect(res.data.formCapAdvisory).toContain("<id>-1");
    expect(res.data.formCapAdvisory).not.toContain("next question");
  });

  test("with no pane a form was never possible, so no advisory rides the wait", async () => {
    const { handlers } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({ questions: fiveOptionQuestion(), subject: "mr:x", context: CTX });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.presentation).toBe("wait");
    expect(res.data.formCapExceeded).toBeUndefined();
  });

  test("questions inside the cap carry no advisory", async () => {
    const { handlers } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), subject: "mr:x", context: CTX,
      sessionId: "sess-1", paneId: "w1:p1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.presentation).toBe("form");
    expect(res.data.formCapExceeded).toBeUndefined();
    expect(res.data.formCapAdvisory).toBeUndefined();
  });
});

describe("gate:ask structured question context (RT-184)", () => {
  const CTX = "the plan section under decision, quoted verbatim";
  const withContexts = (a: number, b: number): GateQuestion[] => [
    { id: "q1", label: "go?", multi: false, options: ["yes", "no"], context: "x".repeat(a) },
    { id: "q2", label: "how?", multi: false, options: ["fast", "slow"], context: "y".repeat(b) },
  ];

  test("option descriptions and per-question context reach the stored row", async () => {
    const { handlers, store } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({
      subject: "mr:x", context: CTX,
      questions: [{
        id: "q1", label: "go?", multi: false, context: "per-question material",
        options: [{ value: "yes", label: "yes", description: "ship it" }, "no"],
      }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect("contextOmitted" in res.data).toBe(false);
    const row = store.get(res.data.id)!;
    expect(row.context).toBe(CTX);
    expect(row.questions).toEqual([{
      id: "q1", label: "go?", multi: false, context: "per-question material",
      options: [{ value: "yes", label: "Yes", description: "ship it" }, { value: "no", label: "No" }],
    }]);
  });

  test("a 40,000-byte gate context and three 20,000-byte question contexts are stored byte for byte", async () => {
    const { handlers, store } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const gate = "g".repeat(40_000);
    const questions: GateQuestion[] = ["a", "b", "c"].map((id) => ({
      id, label: id, multi: false, options: ["yes", "no"], context: id.repeat(20_000),
    }));
    const res = await handlers["gate:ask"]({ subject: "mr:x", context: gate, questions });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect("contextOmitted" in res.data).toBe(false);
    const row = store.get(res.data.id)!;
    expect(row.context).toBe(gate);
    expect(row.questions.map((q) => q.context)).toEqual(questions.map((q) => q.context));
  });

  test("question contexts alone, with no gate context, are stored whole on an exempt kind", async () => {
    const { handlers, store } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({ subject: "mr:x", kind: "milestone", questions: withContexts(9000, 9000) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.questions[0]!.context).toBe("x".repeat(9000));
    expect(row.questions[1]!.context).toBe("y".repeat(9000));
  });

  test("a human-owned, non-exempt gate with no gate context is refused even when question contexts are large", async () => {
    const { handlers } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({ subject: "mr:x", questions: withContexts(9000, 9000) });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("decide from alone");
    expect(res.error).not.toContain("contextOmitted");
  });

  test("an oversized option description is a hard reject, not a drop: the caller authored it", async () => {
    const { handlers } = harness({ resolveSubject: () => ({ ok: true, subject: "mr:x" }) });
    const res = await handlers["gate:ask"]({
      subject: "mr:x", context: CTX,
      questions: [{ id: "q1", label: "go?", multi: false, options: [{ value: "yes", label: "Yes", description: "d".repeat(1025) }, "no"] }],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("1024 bytes");
  });
});

describe("gate:ask meta.stage", () => {
  test("stamps meta.stage against the resolved run subject, not the payload's", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "run:r7", runId: "r7" }),
      runCurrentStage: (id) => (id === "r7" ? "implement" : null),
    });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), sessionId: "s1", context: "why" });
    expect(res.ok).toBe(true);
    expect(store.get((res as any).data.id)!.meta).toEqual({ stage: "implement" });
  });

  test("a non-run subject gets no meta.stage", async () => {
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "mr:https://x/1" }),
      runCurrentStage: () => "implement",
    });
    const res = await handlers["gate:ask"]({ questions: twoOptionQuestion(), subject: "mr:https://x/1", context: "why" });
    expect(store.get((res as any).data.id)!.meta).toBeNull();
  });
});

describe("gate:ask kit presentation", () => {
  const resolveSubject = () => ({ ok: true as const, subject: "mr:https://x/1" });
  const base = { subject: "mr:https://x/1", sessionId: "sess-1", paneId: "w1:p1", context: "why this decision" };

  test("kitForm with a pane and a session stores kit and a nudge, past the option cap", async () => {
    const { handlers, store } = harness({ resolveSubject });
    const res = await handlers["gate:ask"]({ ...base, questions: fiveOptionQuestion(), kitForm: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.presentation).toBe("kit");
    expect(res.data.boardOnly).toBe(false);
    expect(res.data.formCapExceeded).toBeUndefined();
    expect(res.data.formCapAdvisory).toBeUndefined();
    const row = store.get(res.data.id)!;
    expect(row.origin?.presentation).toBe("kit");
    expect(row.nudge).toEqual({ session: "sess-1" });
  });

  test("kitForm with no session is wait, with no nudge", async () => {
    const { handlers, store } = harness({ resolveSubject });
    const res = await handlers["gate:ask"]({ ...base, sessionId: undefined, questions: twoOptionQuestion(), kitForm: true });
    expect(res.ok && res.data.presentation).toBe("wait");
    if (!res.ok) return;
    expect(store.get(res.data.id)!.nudge).toBeNull();
  });

  test("a board-only kind with kitForm is wait and reports boardOnly", async () => {
    const { handlers, store } = harness({ resolveSubject });
    const res = await handlers["gate:ask"]({ ...base, kind: "review-post", questions: twoOptionQuestion(), kitForm: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.presentation).toBe("wait");
    expect(res.data.boardOnly).toBe(true);
    expect(store.get(res.data.id)!.nudge ?? null).toBeNull();
  });

  test("a normal kind reports boardOnly false", async () => {
    const { handlers } = harness({ resolveSubject });
    const res = await handlers["gate:ask"]({ ...base, questions: twoOptionQuestion() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.presentation).toBe("form");
    expect(res.data.boardOnly).toBe(false);
  });

  test("a caller-supplied kit on gate:open is refused", async () => {
    const { handlers } = harness();
    const res = await handlers["gate:open"]({
      subject: "mr:https://x/1", kind: "plan", questions: twoOptionQuestion(), context: "why",
      pane: "w1:p1", nudge: { session: "sess-1" }, origin: { presentation: "kit", paneId: "w1:p1" },
    });
    expect(res).toEqual({ ok: false, error: 'presentation "kit" is set by gate:ask only' });
  });

  test("a kit smuggled through gate:ask's origin passthrough is dropped", async () => {
    const { handlers, store } = harness({ resolveSubject });
    const res = await handlers["gate:ask"]({
      ...base, questions: twoOptionQuestion(),
      origin: { presentation: "kit" } as never,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(store.get(res.data.id)!.origin?.presentation).toBe("form");
  });
});

describe("gate:ask preAnswer", () => {
  const resolveSubject = () => ({ ok: true as const, subject: "mr:https://x/1" });
  const base = { subject: "mr:https://x/1", sessionId: "sess-1", paneId: "w1:p1", context: "why this decision" };

  function spies() {
    const calls = { onOpened: 0, onAnswered: 0, onClosed: 0 };
    const push: GatePush = {
      onAnswered: async () => { calls.onAnswered++; },
      onOpened: async () => { calls.onOpened++; },
      onClosed: async () => { calls.onClosed++; },
      retryDeadPanes: async () => ({ retried: 0, delivered: 0, gaveUp: 0, reNudged: 0 }),
    };
    return { calls, push };
  }

  const settle = () => new Promise((r) => setTimeout(r, 10));

  test("preAnswer opens an answered gate with no delivery", async () => {
    const { calls, push } = spies();
    const { handlers, store, events } = harness({ resolveSubject, push });
    const res = await handlers["gate:ask"]({
      ...base, questions: twoOptionQuestion(),
      preAnswer: { answers: { q1: "yes" }, by: "mode:quiet" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.preAnswered).toBe(true);
    expect(res.data.row?.status).toBe("answered");
    expect(res.data.row?.answer?.by).toBe("mode:quiet");
    expect(res.data.row?.answer?.answers).toEqual({ q1: "yes" });
    const row = store.get(res.data.id)!;
    expect(row.status).toBe("answered");
    expect(row.nudge ?? null).toBeNull();
    expect(row.pane ?? null).toBeNull();
    await settle();
    expect(calls).toEqual({ onOpened: 0, onAnswered: 0, onClosed: 0 });
    const topics = events.map((e) => e.topic);
    expect(topics).toEqual([`gate/opened/${row.id}`, `gate/answered/${row.id}`]);
    expect(events[1]!.payload.by).toBe("mode:quiet");
  });

  test("a pre-answered gate's opened event carries preAnswered; an asking gate's does not", async () => {
    const { handlers, events } = harness({ resolveSubject });
    const asked = await handlers["gate:ask"]({ ...base, subject: "mr:https://x/2", questions: twoOptionQuestion() });
    expect(asked.ok).toBe(true);
    const res = await handlers["gate:ask"]({
      ...base, questions: twoOptionQuestion(),
      preAnswer: { answers: { q1: "yes" }, by: "mode:quiet" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok || !asked.ok) return;
    const opened = (id: string) => events.find((e) => e.topic === `gate/opened/${id}`)!;
    expect(opened(res.data.id).payload.preAnswered).toBe(true);
    expect(opened(asked.data.id).payload.preAnswered).toBeUndefined();
  });

  test("preAnswer on a herd-owned subject answers without pushing to the shepherd", async () => {
    const { calls, push } = spies();
    const { handlers, store } = harness({
      resolveSubject: () => ({ ok: true, subject: "run:r1", runId: "r1" }),
      runSpawnedBy: () => "herd:h1",
      push,
    });
    const res = await handlers["gate:ask"]({
      questions: twoOptionQuestion(), sessionId: "sess-1", context: "why this decision",
      preAnswer: { answers: { q1: "no" }, by: "mode:yolo" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.data.id)!;
    expect(row.owner).toBe("herd:h1");
    expect(row.status).toBe("answered");
    expect(row.answer?.by).toBe("mode:yolo");
    await settle();
    expect(calls).toEqual({ onOpened: 0, onAnswered: 0, onClosed: 0 });
  });

  test("preAnswer with by \"pane\" is refused", async () => {
    const { handlers, store } = harness({ resolveSubject });
    const res = await handlers["gate:ask"]({
      ...base, questions: twoOptionQuestion(),
      preAnswer: { answers: { q1: "yes" }, by: "pane" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("preAnswer by must start with mode:");
    expect(store.list({}).gates).toHaveLength(0);
  });

  test("preAnswer with an answer that is not an option is refused", async () => {
    const { handlers, store } = harness({ resolveSubject });
    const res = await handlers["gate:ask"]({
      ...base, questions: twoOptionQuestion(),
      preAnswer: { answers: { q1: "maybe" }, by: "mode:quiet" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe(validateGateAnswers(twoOptionQuestion(), { q1: "maybe" }) as string);
    expect(store.list({}).gates).toHaveLength(0);
  });

  test("a malformed preAnswer is refused", async () => {
    const { handlers, store } = harness({ resolveSubject });
    const res = await handlers["gate:ask"]({ ...base, questions: twoOptionQuestion(), preAnswer: "yes" as never });
    expect(res.ok).toBe(false);
    expect(store.list({}).gates).toHaveLength(0);
  });

  test("without preAnswer the response carries no preAnswered flag", async () => {
    const { handlers } = harness({ resolveSubject });
    const res = await handlers["gate:ask"]({ ...base, questions: twoOptionQuestion() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.preAnswered).toBeUndefined();
    expect(res.data.row).toBeUndefined();
  });

  test("a pre-answer that supersedes the asking pane's own gate does not interrupt that pane", async () => {
    const { calls, push } = spies();
    const { handlers, store } = harness({ resolveSubject, push });
    const first = await handlers["gate:ask"]({ ...base, questions: twoOptionQuestion() });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.presentation).toBe("form");
    const res = await handlers["gate:ask"]({
      ...base, questions: twoOptionQuestion(),
      preAnswer: { answers: { q1: "yes" }, by: "mode:quiet" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.supersededId).toBe(first.data.id);
    expect(store.get(first.data.id)!.status).toBe("closed");
    await settle();
    expect(calls.onClosed).toBe(0);
  });

  test("a pre-answer that supersedes another pane's gate still releases that pane", async () => {
    const { calls, push } = spies();
    const { handlers } = harness({ resolveSubject, push });
    const first = await handlers["gate:ask"]({ ...base, sessionId: "sess-9", paneId: "w9:p9", questions: twoOptionQuestion() });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.presentation).toBe("form");
    const res = await handlers["gate:ask"]({
      ...base, questions: twoOptionQuestion(),
      preAnswer: { answers: { q1: "yes" }, by: "mode:quiet" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.supersededId).toBe(first.data.id);
    await settle();
    expect(calls.onClosed).toBe(1);
  });

  test("preAnswer is refused for a board-only kind, with no row created", async () => {
    const { handlers, store } = harness({ resolveSubject });
    const res = await handlers["gate:ask"]({
      ...base, kind: "review-post", questions: twoOptionQuestion(),
      preAnswer: { answers: { q1: "yes" }, by: "mode:yolo" },
    });
    expect(res).toEqual({ ok: false, error: "preAnswer is not allowed for board-only kinds" });
    expect(store.list({}).gates).toHaveLength(0);
  });

  test("preAnswer by must name one of the four gate modes", async () => {
    const { handlers, store } = harness({ resolveSubject });
    for (const by of ["mode:", "mode:bogus", "mode:Quiet"]) {
      const res = await handlers["gate:ask"]({
        ...base, questions: twoOptionQuestion(), preAnswer: { answers: { q1: "yes" }, by },
      });
      expect(res).toEqual({ ok: false, error: "preAnswer by must name a gate mode" });
    }
    expect(store.list({}).gates).toHaveLength(0);
    for (const mode of ["chatty", "normal", "quiet", "yolo"]) {
      const res = await handlers["gate:ask"]({
        ...base, subject: `mr:https://x/${mode}`, questions: twoOptionQuestion(),
        preAnswer: { answers: { q1: "yes" }, by: `mode:${mode}` },
      });
      expect(res.ok).toBe(true);
    }
  });
});
