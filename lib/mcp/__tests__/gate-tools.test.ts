import { describe, expect, test } from "bun:test";
import type { GateRow } from "../../../packages/rt-client/src/commands.ts";
import type { DecisionRow } from "../../gates/record.ts";
import { answerGate, askGate, openRun, type GateToolDeps } from "../gate-tools.ts";

const DB = "/runs/r/1/state.db";
const ENV = { RT_RUNS_ROOT: "/runs", CLAUDE_CODE_SESSION_ID: "sess-1", HERDR_PANE_ID: "pane-1" } as NodeJS.ProcessEnv;
const HERDR = { ...ENV, HERDR_ENV: "1" } as NodeJS.ProcessEnv;

type Field = { key: string; value: string; at: number };
type AskData = { id: string; presentation: "form" | "wait"; subject: string; supersededId: string | null; contextOmitted?: true };

interface FakeOpts {
  spawnedBy?: string | null;
  fields?: Field[];
  decisions?: DecisionRow[];
  askData?: Partial<AskData>;
  answerRes?: { ok: boolean; data?: unknown; error?: string; [k: string]: unknown };
  failWrite?: (line: string) => string | undefined;
}

function fake(o: FakeOpts = {}) {
  const log: string[] = [];
  const asks: Record<string, unknown>[] = [];
  const answers: Record<string, unknown>[] = [];
  const deps: GateToolDeps = {
    ask: (async (p: Record<string, unknown>) => {
      log.push("ask");
      asks.push(p);
      return { ok: true, data: { id: "g1", presentation: "form", subject: "mr:x", supersededId: null, ...o.askData } };
    }) as unknown as GateToolDeps["ask"],
    answer: (async (p: Record<string, unknown>) => {
      log.push("answer");
      answers.push(p);
      return o.answerRes ?? { ok: true, data: { row: row() } };
    }) as unknown as GateToolDeps["answer"],
    wait: (async () => { throw new Error("unexpected wait"); }) as unknown as GateToolDeps["wait"],
    runDeps: {
      write: async (verb, args) => {
        const line = [verb, ...args].join(" ");
        log.push(line);
        const failed = o.failWrite?.(line);
        if (failed) return { out: JSON.stringify({ ok: false, error: failed }), code: 1 };
        if (verb === "snapshot") {
          return {
            out: JSON.stringify({
              ok: true,
              run: { id: "1", spawned_by: o.spawnedBy ?? null },
              stages: [],
              fields: (o.fields ?? []).map((f) => ({ run_id: "1", produced_by: "s", ...f })),
              decisions: (o.decisions ?? []).map((d) => ({ run_id: "1", ...d })),
            }),
            code: 0,
          };
        }
        return { out: '{"ok":true}', code: 0 };
      },
      list: (async () => ({ ok: true, data: { runs: [] } })) as unknown as GateToolDeps["runDeps"]["list"],
      realpath: (p) => p,
      isPackRoot: () => true,
    },
    readRoots: () => ({ roots: [] }),
    tempRoots: () => [],
    readFile: () => { throw new Error("unexpected read"); },
    writeFile: () => { throw new Error("unexpected write"); },
  };
  return { deps, log, asks, answers };
}

function row(over: Partial<GateRow> = {}): GateRow {
  return {
    id: "g1", subject: "mr:x", kind: "question", questions: [], meta: null, status: "answered",
    answer: { answers: { q1: { value: "yes", note: "" } }, by: "pane", answeredAt: 2000 },
    openedAt: 1000, parkedAt: null, closedAt: null, closedReason: null, supersededBy: null,
    agent: null, pane: null, nudge: null, delivery: null, released: false, consumedAt: null, owner: null, escalatedAt: null,
    ...over,
  };
}

const q = (id: string, options: unknown[] = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]) => ({ id, label: `Q ${id}`, multi: false, options });
const ASK = { questions: [q("q1")], context: "ctx", kind: "respond-plan" };
const RUN = { runDb: DB, stage: "s" };
const body = (r: { body: unknown }) => r.body as Record<string, unknown>;

describe("askGate without a run", () => {
  test("sends gate:ask today's payload and makes no run call", async () => {
    const f = fake();
    const input = { questions: [q("q1")], context: "ctx", kind: "k", subject: "mr:s" };
    const res = await askGate(input, ENV, f.deps);
    expect(res.ok).toBe(true);
    expect(f.log).toEqual(["ask"]);
    expect(f.asks[0]).toEqual({ questions: [q("q1")], context: "ctx", kind: "k", subject: "mr:s", sessionId: "sess-1", paneId: "pane-1" });
    expect(body(res)).toMatchObject({ id: "g1", presentation: "form", paneAction: "form", formContext: "ctx" });
    expect(body(res).labelsTruncated).toBeUndefined();
    expect(body(res).runErrors).toBeUndefined();
  });

  test("never reads RT_GATE_SUBJECT and omits absent fields", async () => {
    const f = fake();
    await askGate({ questions: [q("q1")] }, { RT_GATE_SUBJECT: "agent:x" } as NodeJS.ProcessEnv, f.deps);
    expect(f.asks[0]).toEqual({ questions: [q("q1")] });
  });

  test("paneAction is wait on a wait gate in herdr, form outside it", async () => {
    const inHerdr = await askGate(ASK, HERDR, fake({ askData: { presentation: "wait" } }).deps);
    expect(body(inHerdr).paneAction).toBe("wait");
    const attended = await askGate(ASK, ENV, fake({ askData: { presentation: "wait" } }).deps);
    expect(body(attended).paneAction).toBe("form");
  });

  test("a 260-byte label is truncated before ask sees it and labelsTruncated names it", async () => {
    const f = fake();
    const long = "x".repeat(260);
    const res = await askGate({ questions: [q("q1", [{ value: "v", label: long }, "no"])] }, ENV, f.deps);
    const sent = (f.asks[0]!.questions as { options: unknown[] }[])[0]!.options;
    const label = (sent[0] as { label: string }).label;
    expect(Buffer.byteLength(label, "utf8")).toBeLessThanOrEqual(200);
    expect(label).not.toBe(long);
    expect(sent[1]).toBe("no");
    expect(body(res).labelsTruncated).toEqual([{ question: "q1", value: "v", field: "label" }]);
  });

  test("formChunks holds 5 questions in 2 chunks", async () => {
    const res = await askGate({ questions: ["a", "b", "c", "d", "e"].map((id) => q(id)) }, ENV, fake().deps);
    const chunks = body(res).formChunks as { id: string; text: string; options: unknown[] }[][];
    expect(chunks.map((c) => c.map((x) => x.id))).toEqual([["a", "b", "c", "d"], ["e"]]);
    expect(chunks[0]![0]).toMatchObject({ text: "Q a", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] });
  });

  test("a daemon refusal comes back as the error, with no result fields", async () => {
    const f = fake();
    f.deps.ask = (async () => ({ ok: false, error: "questions: bad" })) as unknown as GateToolDeps["ask"];
    const res = await askGate(ASK, ENV, f.deps);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("questions: bad");
  });
});

describe("askGate with a run", () => {
  test("reads the run, writes gate = scope, then asks", async () => {
    const f = fake();
    const res = await askGate({ ...ASK, ...RUN }, ENV, f.deps);
    expect(res.ok).toBe(true);
    expect(f.log).toEqual(["snapshot", "field set gate respond-plan --stage s", "ask"]);
    expect(f.asks[0]).toEqual({ questions: [q("q1")], context: "ctx", kind: "respond-plan", sessionId: "sess-1", paneId: "pane-1" });
  });

  test("scope wins over kind, and kind defaults to question", async () => {
    const scoped = fake();
    await askGate({ ...ASK, kind: "review-post", scope: "post", ...RUN }, ENV, scoped.deps);
    expect(scoped.log[1]).toBe("field set gate post --stage s");
    const bare = fake();
    await askGate({ questions: [q("q1")], ...RUN }, ENV, bare.deps);
    expect(bare.log[1]).toBe("field set gate question --stage s");
  });

  test("a wait in herdr arms waiting-gate after the ask", async () => {
    const f = fake({ askData: { presentation: "wait" } });
    const res = await askGate({ ...ASK, ...RUN }, HERDR, f.deps);
    expect(f.log).toEqual(["snapshot", "field set gate respond-plan --stage s", "ask", "field set waiting-gate g1 --stage s"]);
    expect(body(res).paneAction).toBe("wait");
  });

  test("contextOmitted saves the dropped fact under the scope after waiting-gate", async () => {
    const f = fake({ askData: { presentation: "wait", contextOmitted: true } });
    await askGate({ ...ASK, ...RUN }, HERDR, f.deps);
    expect(f.log.slice(3)).toEqual(["field set waiting-gate g1 --stage s", "field set extra.context-dropped.respond-plan g1 --stage s"]);
  });

  test("a caller-reported contextDropped saves the fact on a form gate", async () => {
    const f = fake();
    await askGate({ ...ASK, ...RUN }, ENV, f.deps, { contextDropped: true });
    expect(f.log.slice(3)).toEqual(["field set extra.context-dropped.respond-plan g1 --stage s"]);
  });

  test("a form gate arms nothing", async () => {
    const f = fake();
    await askGate({ ...ASK, ...RUN }, HERDR, f.deps);
    expect(f.log).toEqual(["snapshot", "field set gate respond-plan --stage s", "ask"]);
  });

  test("a spawned run outside herdr waits", async () => {
    const f = fake({ spawnedBy: "herd:x", askData: { presentation: "wait" } });
    const res = await askGate({ ...ASK, ...RUN }, ENV, f.deps);
    expect(body(res).paneAction).toBe("wait");
    expect(f.log.at(-1)).toBe("field set waiting-gate g1 --stage s");
  });

  test("runDb without stage is refused before any call", async () => {
    const f = fake();
    const res = await askGate({ ...ASK, runDb: DB }, ENV, f.deps);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('"stage"');
    expect(f.log).toEqual([]);
  });

  test("a runDb outside the runs root is refused and nothing opens", async () => {
    const f = fake();
    const res = await askGate({ ...ASK, runDb: "/elsewhere/state.db", stage: "s" }, ENV, f.deps);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("runs root");
    expect(f.log).toEqual([]);
  });

  test("a failed gate write refuses before anything opens", async () => {
    const f = fake({ failWrite: (l) => (l.startsWith("field set gate ") ? "disk full" : undefined) });
    const res = await askGate({ ...ASK, ...RUN }, ENV, f.deps);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("disk full");
    expect(f.log).not.toContain("ask");
  });

  test("a run write that fails after the open returns the gate with runErrors", async () => {
    const f = fake({ askData: { presentation: "wait" }, failWrite: (l) => (l.startsWith("field set waiting-gate") ? "disk full" : undefined) });
    const res = await askGate({ ...ASK, ...RUN }, HERDR, f.deps);
    expect(res.ok).toBe(true);
    expect(body(res)).toMatchObject({ id: "g1", paneAction: "wait", runErrors: ["disk full"] });
  });

  test("a handed run handle is used as is, with no second snapshot read", async () => {
    const f = fake();
    const opened = await openRun(RUN, ENV, f.deps);
    if (!opened || "error" in opened) throw new Error("openRun failed");
    await askGate({ ...ASK, ...RUN }, ENV, f.deps, { run: opened.run });
    expect(f.log).toEqual(["snapshot", "field set gate respond-plan --stage s", "ask"]);
  });

  test("a handed null run makes no run call even with runDb", async () => {
    const f = fake();
    await askGate({ ...ASK, ...RUN }, ENV, f.deps, { run: null });
    expect(f.log).toEqual(["ask"]);
  });
});

describe("openRun", () => {
  test("is null without runDb", async () => {
    expect(await openRun({}, ENV, fake().deps)).toBeNull();
  });

  test("carries the snapshot's spawned_by, fields and decisions", async () => {
    const decisions: DecisionRow[] = [{ contract: "gate@1", scope: "question", selection: "{}", decided_by: "pane", decided_at: 5 }];
    const opened = await openRun(RUN, ENV, fake({ spawnedBy: "herd:x", fields: [{ key: "waiting-gate", value: "g1", at: 3 }], decisions }).deps);
    if (!opened || "error" in opened) throw new Error("openRun failed");
    expect(opened.run.snapshot.run.spawned_by).toBe("herd:x");
    expect(opened.run.snapshot.fields).toEqual([{ key: "waiting-gate", value: "g1", at: 3 }]);
    expect(opened.run.snapshot.decisions).toEqual(decisions);
  });
});

describe("answerGate", () => {
  const ANSWER = { id: "g1", answers: { q1: "yes" } };
  const decisionLine = (scope: string, selection: unknown, by: string) =>
    `decision record --contract gate@1 --scope ${scope} --selection ${JSON.stringify(selection)} --decided-by ${by}`;

  test("without a run sends today's payload and adds the answer fields", async () => {
    const f = fake();
    const res = await answerGate({ ...ANSWER, override: true }, ENV, f.deps);
    expect(f.log).toEqual(["answer"]);
    expect(f.answers[0]).toEqual({ id: "g1", answers: { q1: "yes" }, by: "pane", session: "sess-1", override: true });
    expect(body(res)).toMatchObject({ row: row(), recorded: false, decidedBy: "pane", answers: { q1: "yes" }, writeIn: [], next: null, actOnWriteIn: false });
  });

  test("with a run records the normalized answers as the row's decider", async () => {
    const f = fake();
    const res = await answerGate({ ...ANSWER, ...RUN }, ENV, f.deps);
    expect(f.log).toEqual(["snapshot", "answer", decisionLine("question", { q1: "yes" }, "pane")]);
    expect(body(res)).toMatchObject({ recorded: true, decidedBy: "pane", answers: { q1: "yes" } });
  });

  test("clears waiting-gate only when it names this gate", async () => {
    const armed = fake({ fields: [{ key: "waiting-gate", value: "g1", at: 1 }] });
    await answerGate({ ...ANSWER, ...RUN }, ENV, armed.deps);
    expect(armed.log.at(-1)).toBe("field set waiting-gate - --stage s");
    const other = fake({ fields: [{ key: "waiting-gate", value: "g0", at: 1 }] });
    await answerGate({ ...ANSWER, ...RUN }, ENV, other.deps);
    expect(other.log.at(-1)).toStartWith("decision record");
  });

  test("an explicit scope records under it", async () => {
    const f = fake();
    await answerGate({ ...ANSWER, ...RUN, scope: "custom" }, ENV, f.deps);
    expect(f.log.at(-1)).toBe(decisionLine("custom", { q1: "yes" }, "pane"));
  });

  test("a lost CAS records the winner's answers and by", async () => {
    const winner = row({ answer: { answers: { q1: "no" }, by: "console", answeredAt: 2000 } });
    const f = fake({ answerRes: { ok: true, data: { row: winner, conflict: true } } });
    const res = await answerGate({ ...ANSWER, ...RUN }, ENV, f.deps);
    expect(f.log.at(-1)).toBe(decisionLine("question", { q1: "no" }, "console"));
    expect(body(res)).toMatchObject({ conflict: true, recorded: true, decidedBy: "console", answers: { q1: "no" } });
  });

  test("a decision since the gate opened means already reconciled, with no write", async () => {
    const decided: DecisionRow = { contract: "gate@1", scope: "question", selection: "{}", decided_by: "board", decided_at: 1000 };
    const f = fake({ decisions: [decided], fields: [{ key: "waiting-gate", value: "g1", at: 1 }] });
    const res = await answerGate({ ...ANSWER, ...RUN }, ENV, f.deps);
    expect(body(res)).toMatchObject({ recorded: false, alreadyReconciled: true });
    expect(f.log.some((l) => l.startsWith("decision"))).toBe(false);
    expect(f.log.at(-1)).toBe("field set waiting-gate - --stage s");
  });

  test("a decision from before the gate opened does not count", async () => {
    const old: DecisionRow = { contract: "gate@1", scope: "question", selection: "{}", decided_by: "board", decided_at: 999 };
    const f = fake({ decisions: [old] });
    const res = await answerGate({ ...ANSWER, ...RUN }, ENV, f.deps);
    expect(body(res).recorded).toBe(true);
    expect(body(res).alreadyReconciled).toBeUndefined();
  });

  test("record: false writes no decision but still clears waiting-gate", async () => {
    const f = fake({ fields: [{ key: "waiting-gate", value: "g1", at: 1 }] });
    const res = await answerGate({ ...ANSWER, ...RUN, record: false }, ENV, f.deps);
    expect(f.log).toEqual(["snapshot", "answer", "field set waiting-gate - --stage s"]);
    expect(body(res).recorded).toBe(false);
  });

  test("a run write that fails after the daemon answered still returns the answer", async () => {
    const f = fake({ failWrite: (l) => (l.startsWith("decision") ? "run DB not found: /runs/r/1/state.db" : undefined) });
    const res = await answerGate({ ...ANSWER, ...RUN }, ENV, f.deps);
    expect(res.ok).toBe(true);
    expect(body(res)).toMatchObject({ row: row(), recorded: false, runErrors: ["run DB not found: /runs/r/1/state.db"] });
  });

  test("a write-in reports itself and actOnWriteIn", async () => {
    const f = fake({ answerRes: { ok: true, data: { row: row({ answer: { answers: { q1: { writeIn: "do X" } }, by: "pane", answeredAt: 2000 } }) } } });
    const res = await answerGate(ANSWER, ENV, f.deps);
    expect(body(res)).toMatchObject({ writeIn: [{ question: "q1", text: "do X" }], next: null, actOnWriteIn: true });
  });

  test("runDb without stage is refused before the answer", async () => {
    const f = fake();
    const res = await answerGate({ ...ANSWER, runDb: DB }, ENV, f.deps);
    expect(res.ok).toBe(false);
    expect(f.log).toEqual([]);
  });

  test("the owned-by, gate-closed and not-found refusals keep today's text", async () => {
    const refuse = async (answerRes: FakeOpts["answerRes"]) => (await answerGate(ANSWER, ENV, fake({ answerRes }).deps)).error;
    expect(await refuse({ ok: false, error: "owned-by", owner: "alice" })).toBe("gate g1 is owned by alice; pass override: true to answer anyway");
    expect(await refuse({ ok: false, error: "owned-by" })).toBe("gate g1 is owned by unknown; pass override: true to answer anyway");
    expect(await refuse({ ok: false, error: "gate-closed", reason: "expired", supersededBy: "g2" })).toBe("gate g1 is closed (expired); superseded by g2");
    expect(await refuse({ ok: false, error: "gate-closed" })).toBe("gate g1 is closed (closed)");
    expect(await refuse({ ok: false, error: "not-found" })).toBe("no gate g1");
  });

  test("a missing id is refused naming it", async () => {
    const res = await answerGate({ answers: {} }, ENV, fake().deps);
    expect(res.error).toContain("id");
  });
});
