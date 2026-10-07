import { describe, expect, test } from "bun:test";
import { buildGateAskPayload, gateAskOutput } from "../gate.ts";

const Q = '[{"id":"q1","label":"go?","multi":false,"options":["yes","no"]}]';
const noEnv = {} as NodeJS.ProcessEnv;

describe("buildGateAskPayload", () => {
  test("questions parse; env supplies session and pane", () => {
    const env = { CLAUDE_CODE_SESSION_ID: "sess-1", HERDR_PANE_ID: "w1:p1" } as NodeJS.ProcessEnv;
    expect(buildGateAskPayload(["--questions", Q], env)).toEqual({
      questions: [{ id: "q1", label: "go?", multi: false, options: ["yes", "no"] }],
      sessionId: "sess-1",
      paneId: "w1:p1",
    });
  });
  test("explicit --subject passes through", () => {
    expect(buildGateAskPayload(["--questions", Q, "--subject", "mr:x"], noEnv).subject).toBe("mr:x");
  });
  test("RT_GATE_SUBJECT is deliberately NOT read (the daemon ladder decides)", () => {
    const env = { RT_GATE_SUBJECT: "agent:ag-1" } as NodeJS.ProcessEnv;
    expect(buildGateAskPayload(["--questions", Q], env).subject).toBeUndefined();
  });
  test("no subject leaves the field absent (daemon ladder decides)", () => {
    expect(buildGateAskPayload(["--questions", Q], noEnv).subject).toBeUndefined();
  });
  test("context and kind pass through", () => {
    const p = buildGateAskPayload(["--questions", Q, "--context", "why", "--kind", "plan"], noEnv);
    expect(p.context).toBe("why");
    expect(p.kind).toBe("plan");
  });
  test("option descriptions and per-question context ride --questions through untouched", () => {
    const q = JSON.stringify([{
      id: "q1", label: "go?", multi: false, context: "why this one",
      options: [{ value: "yes", label: "yes", description: "ship it", recommended: true }, "no"],
    }]);
    expect(buildGateAskPayload(["--questions", q], noEnv).questions).toEqual([{
      id: "q1", label: "go?", multi: false, context: "why this one",
      options: [{ value: "yes", label: "yes", description: "ship it", recommended: true }, "no"],
    }]);
  });
  test("empty env vars are treated as unset", () => {
    const env = { CLAUDE_CODE_SESSION_ID: "", HERDR_PANE_ID: "" } as NodeJS.ProcessEnv;
    const p = buildGateAskPayload(["--questions", Q], env);
    expect(p.sessionId).toBeUndefined();
    expect(p.paneId).toBeUndefined();
  });
});

// RT-177: the 8192-byte drop was silent, so a caller shipped a bare form and
// only the human at the other end found out.
describe("gateAskOutput", () => {
  const data = { id: "g1", presentation: "form" as const, subject: "mr:x", supersededId: null };

  test("a normal ask prints no contextOmitted key", () => {
    expect(gateAskOutput(data)).toEqual({
      ok: true, id: "g1", presentation: "form", subject: "mr:x", supersededId: null,
    });
  });

  test("an omitted context is printed on stdout, where agents parse", () => {
    expect(gateAskOutput({ ...data, contextOmitted: true })).toEqual({
      ok: true, id: "g1", presentation: "form", subject: "mr:x", supersededId: null, contextOmitted: true,
    });
  });
});

describe("a bound Codex worker asks under its binding", () => {
  const identity = { agentId: "ag-1", subject: "herd:h1/job-a", sessionId: "thread-1", pane: "w7:p1", harness: "codex" };

  test("its session and pane come from the binding, never the app server's inherited pane", () => {
    // HERDR_PANE_ID here is whatever pane the user started the app server in.
    const env = { CODEX_THREAD_ID: "thread-1", HERDR_PANE_ID: "w1:p1" } as NodeJS.ProcessEnv;
    const payload = buildGateAskPayload(["--questions", Q], env, () => ({ ok: true, data: identity }));
    expect(payload).toMatchObject({ sessionId: "thread-1", paneId: "w7:p1" });
    expect(payload.subject).toBeUndefined();
  });

  test("a binding with no pane sends none, whatever the environment says", () => {
    const env = { CODEX_THREAD_ID: "thread-1", HERDR_PANE_ID: "w1:p1" } as NodeJS.ProcessEnv;
    const { pane: _pane, ...headless } = identity;
    const payload = buildGateAskPayload(["--questions", Q], env, () => ({ ok: true, data: headless }));
    expect(payload.sessionId).toBe("thread-1");
    expect("paneId" in payload).toBe(false);
  });

  test("no bound identity keeps today's environment session", () => {
    const env = { CLAUDE_CODE_SESSION_ID: "sess-1" } as NodeJS.ProcessEnv;
    expect(buildGateAskPayload(["--questions", Q], env, () => ({ ok: true, data: null })).sessionId).toBe("sess-1");
    expect(buildGateAskPayload(["--questions", Q], env).sessionId).toBe("sess-1");
  });

  test("a bound worker names its harness, so its nudge never rings a Claude inbox; a Claude session's payload is unchanged", () => {
    const env = { CODEX_THREAD_ID: "thread-1", HERDR_PANE_ID: "w1:p1" } as NodeJS.ProcessEnv;
    const payload = buildGateAskPayload(["--questions", Q], env, () => ({ ok: true, data: { ...identity, harness: "codex" } }));
    expect(payload).toMatchObject({ sessionId: "thread-1", paneId: "w7:p1", harness: "codex" });
    const claude = buildGateAskPayload(["--questions", Q], { CLAUDE_CODE_SESSION_ID: "sess-1", HERDR_PANE_ID: "w1:p1" } as NodeJS.ProcessEnv);
    expect(claude).toEqual({ questions: JSON.parse(Q), sessionId: "sess-1", paneId: "w1:p1" });
  });
});
