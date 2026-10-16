import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GateRow } from "../../../packages/rt-client/src/commands.ts";
import { fitOpen } from "../../gates/ctx.ts";
import type { DecisionRow } from "../../gates/record.ts";
import { buildReviewSource } from "../../gates/review-source.ts";
import { answerGate, askGate, gateToolDefs, openRun, type GateToolDeps } from "../gate-tools.ts";
import { checkReadRootPath } from "../temp-root-guard.ts";

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
  waitRes?: { ok: boolean; data?: unknown; error?: string };
  failWrite?: (line: string) => string | undefined;
}

function fake(o: FakeOpts = {}) {
  const log: string[] = [];
  const asks: Record<string, unknown>[] = [];
  const answers: Record<string, unknown>[] = [];
  const waits: Record<string, unknown>[] = [];
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
    wait: (async (p: Record<string, unknown>) => {
      log.push("wait");
      waits.push(p);
      return o.waitRes ?? { ok: true, data: { status: "answered", row: row() } };
    }) as unknown as GateToolDeps["wait"],
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
  return { deps, log, asks, answers, waits };
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

  test("an empty or whitespace scope is refused before any call", async () => {
    for (const scope of ["", "  "]) {
      const f = fake();
      const res = await answerGate({ ...ANSWER, ...RUN, scope }, ENV, f.deps);
      expect(res.error).toBe('"scope" must be a non-empty string');
      expect(f.log).toEqual([]);
    }
  });

  test("a missing id is refused naming it", async () => {
    const res = await answerGate({ answers: {} }, ENV, fake().deps);
    expect(res.error).toContain("id");
  });
});

const FIX = join(import.meta.dir, "../../../plugins/mattstack/attachments/review");
const RR = join(FIX, "receive-review/tests/fixtures");
const RV = join(FIX, "review/tests/fixtures");
type Src = { context?: Record<string, any>; questions: Record<string, any>[] };
const loadJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const plan = (): Src => loadJson(join(RR, "plan-source.json"));
const PLAN_GATE_LINE = "Responding to renee's review · round 1 · 2 threads, 1 blocking · 1 valid, 1 pushback · fresh-context adjudicated";
const bigAdjudication = (): Src => {
  const s = plan();
  s.context!.adjudication = "x".repeat(9 * 1024);
  return s;
};

describe("gate_open", () => {
  let tmp = "";
  beforeAll(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "gate-open-")));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  function rooted(o: FakeOpts = {}) {
    const f = fake(o);
    f.deps.readRoots = () => ({ roots: [tmp] });
    f.deps.tempRoots = () => [tmp];
    f.deps.readFile = (p) => readFileSync(p, "utf8");
    f.deps.writeFile = (p, s) => writeFileSync(p, s);
    return f;
  }
  const copy = (src: string, name: string) => {
    const p = join(tmp, name);
    copyFileSync(src, p);
    return p;
  };
  const write = (name: string, text: string) => {
    const p = join(tmp, name);
    writeFileSync(p, text);
    return p;
  };
  const gateOpen = (deps: GateToolDeps) => gateToolDefs(deps).find((d) => d.name === "gate_open")!;
  const open = (input: Record<string, unknown>, f = rooted(), env = ENV) => gateOpen(f.deps).handler(input, env);
  const sourceLine = (scope: string, gate: string | null, src: unknown) =>
    `field set extra.gate-source.${scope} ${JSON.stringify({ gate, source: src })} --stage s`;
  const reviewInput = () => ({ findingsPath: copy(join(RV, "findings-v2.json"), "findings-v2.json"), extras: loadJson(join(RV, "extras.json")) });

  test("gateToolDefs holds gate_open with a none shell form", () => {
    const def = gateOpen(rooted().deps);
    expect(def.shellForms).toEqual({ none: "replaces sh gate-ctx.sh / review-source.sh once wave 3 rewrites the skills" });
  });

  test("a plan source opens its fit verbatim with the prose form view", async () => {
    const f = rooted();
    const fit = fitOpen(plan());
    const res = await open({ kind: "respond-plan", source: plan() }, f);
    expect(res.ok).toBe(true);
    expect(f.log).toEqual(["ask"]);
    expect(f.asks[0]).toEqual({ questions: fit.questions, context: fit.context, kind: "respond-plan", sessionId: "sess-1", paneId: "pane-1" });
    expect(body(res)).toMatchObject({ id: "g1", mode: "structured", fits: true, trimmed: [], contextDropped: false, formContext: PLAN_GATE_LINE });
    const chunks = body(res).formChunks as { text: string }[][];
    expect(chunks[0]![0]!.text).toStartWith("queue/enqueue.ts:88\n[BLOCKING] renee:");
  });

  test("a sourcePath reads the same source", async () => {
    const f = rooted();
    await open({ kind: "respond-plan", sourcePath: copy(join(RR, "plan-source.json"), "plan-source.json") }, f);
    expect(f.asks[0]!.context).toBe(fitOpen(plan()).context!);
  });

  test("a review findingsPath builds the source with the review-source port first", async () => {
    const f = rooted();
    const review = reviewInput();
    const expected = fitOpen(buildReviewSource(loadJson(review.findingsPath), review.extras));
    const res = await open({ kind: "review-post", review }, f);
    expect(res.ok).toBe(true);
    expect(f.asks[0]).toMatchObject({ questions: expected.questions, context: expected.context, kind: "review-post" });
  });

  test("a findingsPath outside the read roots is refused with the guard's message and nothing opens", async () => {
    const f = rooted({});
    const outside = join(RV, "findings-v2.json");
    const guard = checkReadRootPath(outside, [tmp]);
    if (guard.ok) throw new Error("fixture dir is inside the temp root");
    const res = await open({ kind: "review-post", review: { findingsPath: outside, extras: {} }, ...RUN }, f);
    expect(res.ok).toBe(false);
    expect(res.error).toContain(guard.error);
    expect(f.log).toEqual([]);
  });

  test("review input without extras is refused before anything opens", async () => {
    const f = rooted();
    const res = await open({ kind: "review-post", review: { findingsPath: reviewInput().findingsPath }, ...RUN }, f);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("extras");
    expect(f.log).toEqual([]);
  });

  test("a mode-000 findingsPath fails the guard's realpath and is refused as missing before anything opens", async () => {
    const f = rooted();
    const p = copy(join(RV, "findings-v2.json"), "unreadable.json");
    chmodSync(p, 0o000);
    const res = await open({ kind: "review-post", review: { findingsPath: p, extras: loadJson(join(RV, "extras.json")) }, ...RUN }, f);
    expect(res.error).toBe(`review.findingsPath: file does not exist: ${p}`);
    expect(f.log).toEqual([]);
  });

  test("a .json symlink to a .txt file is refused", async () => {
    const f = rooted();
    const link = join(tmp, "linked.json");
    symlinkSync(write("notes.txt", JSON.stringify(plan())), link);
    const res = await open({ kind: "respond-plan", sourcePath: link }, f);
    expect(res.error).toContain("must name a .json file");
    expect(f.log).toEqual([]);
  });

  test("a .md sourcePath is refused", async () => {
    const res = await open({ kind: "respond-plan", sourcePath: write("plan.md", JSON.stringify(plan())) });
    expect(res.error).toContain("must name a .json file");
  });

  test("a findingsPath whose read fails is refused before anything opens", async () => {
    const f = rooted();
    f.deps.readFile = () => { throw new Error("EIO"); };
    const res = await open({ kind: "review-post", review: reviewInput(), ...RUN }, f);
    expect(res.error).toContain("review.findingsPath: cannot read");
    expect(res.error).toContain("EIO");
    expect(f.log).toEqual([]);
  });

  test("non-object review inputs refuse with the port's not-a-JSON-object line", async () => {
    const extras = loadJson(join(RV, "extras.json"));
    const nullFile = await open({ kind: "review-post", review: { findingsPath: write("null.json", "null"), extras } });
    expect(nullFile.error).toContain("findings file: not a JSON object");
    const badExtras = await open({ kind: "review-post", review: { findings: loadJson(join(RV, "findings-v2.json")), extras: "x" } });
    expect(badExtras.error).toContain("extras: not a JSON object");
  });

  test("a refused source lists every problem line and never asks", async () => {
    const f = rooted();
    const s = plan();
    s.questions[1]!.context.verdict.call = "maybe";
    s.questions[0]!.context.severity = "loud";
    const res = await open({ kind: "respond-plan", source: s, ...RUN }, f);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("thread-1: severity: blocking|non-blocking|question|none");
    expect(res.error).toContain("thread-2: verdict.call: valid|valid-low-value|pushback|needs-clarification|no-ask");
    expect(f.log).toEqual([]);
  });

  test("zero or two of source, sourcePath and review are refused", async () => {
    const f = rooted();
    const none = await open({ kind: "respond-plan" }, f);
    const two = await open({ kind: "respond-plan", source: plan(), sourcePath: join(tmp, "plan-source.json") }, f);
    for (const res of [none, two]) expect(res.error).toBe('pass exactly one of "source", "sourcePath" or "review"');
    expect(f.log).toEqual([]);
  });

  test("runDb without stage is refused and nothing opens", async () => {
    const f = rooted();
    const res = await open({ kind: "respond-plan", source: plan(), runDb: DB }, f);
    expect(res.error).toContain('"stage"');
    expect(f.log).toEqual([]);
  });

  test("with a run, the untrimmed source is stored under the scope after the open", async () => {
    const f = rooted();
    const res = await open({ kind: "respond-plan", source: plan(), ...RUN }, f);
    expect(res.ok).toBe(true);
    expect(f.log).toEqual(["snapshot", "field set gate respond-plan --stage s", "ask", sourceLine("respond-plan", "g1", plan())]);
    expect(body(res).runErrors).toBeUndefined();
  });

  test("review-post under scope post writes gate = post and stores the built source", async () => {
    const f = rooted();
    const review = reviewInput();
    const built = buildReviewSource(loadJson(review.findingsPath), review.extras);
    await open({ kind: "review-post", scope: "post", review, ...RUN }, f);
    expect(f.log[1]).toBe("field set gate post --stage s");
    expect(f.log.at(-1)).toBe(sourceLine("post", "g1", built));
  });

  test("an open that does not fit also saves the dropped fact", async () => {
    const f = rooted();
    const res = await open({ kind: "respond-plan", source: bigAdjudication(), ...RUN }, f);
    expect(body(res)).toMatchObject({ mode: "prose", fits: false, contextDropped: true });
    expect(f.log.slice(3)).toEqual(["field set extra.context-dropped.respond-plan g1 --stage s", sourceLine("respond-plan", "g1", bigAdjudication())]);
  });

  test("a daemon contextOmitted reports contextDropped", async () => {
    const res = await open({ kind: "respond-plan", source: plan() }, rooted({ askData: { contextOmitted: true } }));
    expect(body(res)).toMatchObject({ fits: true, contextDropped: true });
  });

  test("a failed gate-source write returns the open gate with runErrors", async () => {
    const f = rooted({ failWrite: (l) => (l.includes("extra.gate-source") ? "disk full" : undefined) });
    const res = await open({ kind: "respond-plan", source: plan(), ...RUN }, f);
    expect(res.ok).toBe(true);
    expect(body(res)).toMatchObject({ id: "g1", runErrors: ["disk full"] });
  });

  describe("handBack", () => {
    test("builds and fits only: no ask, the fit as the open", async () => {
      const f = rooted();
      const fit = fitOpen(plan());
      const res = await open({ kind: "respond-plan", source: plan(), handBack: true }, f);
      expect(res.ok).toBe(true);
      expect(f.log).toEqual([]);
      expect(body(res)).toMatchObject({
        open: { context: fit.context, questions: fit.questions },
        mode: "structured", fits: true, trimmed: [], contextDropped: false, droppedContexts: [], formContext: PLAN_GATE_LINE,
      });
      expect((body(res).formChunks as { text: string }[][])[0]![0]!.text).toStartWith("queue/enqueue.ts:88\n[BLOCKING] renee:");
    });

    test("over budget drops whole question contexts, largest first", async () => {
      const s = plan();
      s.questions[0]!.context.claim.summary = "y".repeat(9 * 1024);
      const res = await open({ kind: "respond-plan", source: s, handBack: true });
      const o = body(res).open as { context?: string; questions: { id: string; context?: string }[] };
      expect(body(res)).toMatchObject({ fits: false, contextDropped: true, droppedContexts: ["thread-1"] });
      expect(o.context).toBe(fitOpen(s).context!);
      expect(o.questions[0]!.context).toBeUndefined();
      expect(o.questions[1]!.context).toBe(fitOpen(s).questions[1]!.context as string);
    });

    test("a gate context alone over budget drops every question context, then the gate context, and still returns the open", async () => {
      const res = await open({ kind: "respond-plan", source: bigAdjudication(), handBack: true });
      expect(res.ok).toBe(true);
      const o = body(res).open as { context?: string; questions: { id: string; context?: string }[] };
      expect((body(res).droppedContexts as string[]).toSorted()).toEqual(["thread-1", "thread-2"]);
      expect(o.context).toBeUndefined();
      expect(o.questions.map((q) => q.id)).toEqual(["thread-1", "thread-2", "code-changes"]);
      expect(o.questions.every((q) => q.context === undefined)).toBe(true);
      expect(body(res).contextDropped).toBe(true);
    });

    test("outPath in a temp root holds gate-ctx.sh's output shape", async () => {
      const out = join(tmp, "open.json");
      const res = await open({ kind: "respond-plan", source: plan(), handBack: true, outPath: out });
      expect(body(res).outPath).toBe(out);
      const file = readFileSync(out, "utf8");
      expect(Object.keys(JSON.parse(file))).toEqual(["mode", "trimmed", "context", "questions", "bytes", "fits"]);
      expect(JSON.parse(file)).toEqual(JSON.parse(JSON.stringify(fitOpen(plan()))));
    });

    test("an outPath outside the temp roots is refused and nothing is written", async () => {
      const f = rooted();
      const res = await open({ kind: "respond-plan", source: plan(), handBack: true, outPath: join(RR, "open.json"), ...RUN }, f);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("temp root");
      expect(f.log).toEqual([]);
    });

    test("truncates option text like gate_ask and reports labelsTruncated", async () => {
      const s = plan();
      s.questions[0]!.options[0].label = "x".repeat(260);
      const out = join(tmp, "truncated.json");
      const res = await open({ kind: "respond-plan", source: s, handBack: true, outPath: out });
      expect(body(res).labelsTruncated).toEqual([{ question: "thread-1", value: "reply:T1", field: "label" }]);
      const label = (body(res).open as { questions: { options: { label: string }[] }[] }).questions[0]!.options[0]!.label;
      expect(Buffer.byteLength(label, "utf8")).toBeLessThanOrEqual(200);
      expect(JSON.parse(readFileSync(out, "utf8")).questions[0].options[0].label).toBe(label);
    });

    test("an open with nothing to cut carries no labelsTruncated", async () => {
      const res = await open({ kind: "respond-plan", source: plan(), handBack: true });
      expect(body(res).labelsTruncated).toBeUndefined();
    });

    test("outPath without handBack is refused", async () => {
      const res = await open({ kind: "respond-plan", source: plan(), outPath: join(tmp, "x.json") });
      expect(res.ok).toBe(false);
      expect(res.error).toContain("handBack");
    });

    test("with a run, the source is stored with gate null and nothing else is written", async () => {
      const f = rooted();
      await open({ kind: "respond-plan", source: plan(), handBack: true, ...RUN }, f);
      expect(f.log).toEqual(["snapshot", sourceLine("respond-plan", null, plan())]);
    });
  });
});

describe("askGate scope", () => {
  test("an empty-string scope is refused before any call", async () => {
    const f = fake();
    const res = await askGate({ ...ASK, ...RUN, scope: "" }, ENV, f.deps);
    expect(res.error).toBe('"scope" must be a non-empty string');
    expect(f.log).toEqual([]);
  });

  test("a non-string scope is refused even with a handed run", async () => {
    const f = fake();
    const opened = await openRun(RUN, ENV, f.deps);
    if (!opened || "error" in opened) throw new Error("openRun failed");
    const res = await askGate({ ...ASK, ...RUN, scope: 7 }, ENV, f.deps, { run: opened.run });
    expect(res.error).toBe('"scope" must be a non-empty string');
    expect(f.log).toEqual(["snapshot"]);
  });
});

const decided = (scope: string, decided_at: number): DecisionRow => ({ contract: "gate@1", scope, selection: "{}", decided_by: "board", decided_at });
const recordLine = (scope: string, selection: unknown, by: string) =>
  `decision record --contract gate@1 --scope ${scope} --selection ${JSON.stringify(selection)} --decided-by ${by}`;
const tool = (name: string, deps: GateToolDeps) => gateToolDefs(deps).find((d) => d.name === name)!;
const ARMED: Field = { key: "waiting-gate", value: "g1", at: 1 };
const CLEAR = "field set waiting-gate - --stage s";

describe("gate_reconcile", () => {
  const reconcile = (input: Record<string, unknown>, f: ReturnType<typeof fake>) => tool("gate_reconcile", f.deps).handler(input, ENV);
  const byBoard = row({ answer: { answers: { q1: "yes" }, by: "board", answeredAt: 2000 } });
  const answered = (r: GateRow = byBoard) => ({ ok: true, data: { status: "answered", row: r } });
  const closed = { ok: true, data: { status: "closed", row: row({ status: "closed", answer: null, closedAt: 3000, closedReason: "superseded", supersededBy: "g2" }) } };
  const timedOut = { ok: true, data: { status: "timeout" } };

  test("has a none shell form", () => {
    expect(tool("gate_reconcile", fake().deps).shellForms).toEqual({
      none: "replaces rt gate wait <id> --timeout 2s and the run bookkeeping a skill did by hand after a wait, doorbell or held gate",
    });
  });

  test("answered: re-reads with this session, records the answers map as the row's by and clears waiting-gate", async () => {
    const f = fake({ waitRes: answered(), fields: [ARMED] });
    const res = await reconcile({ id: "g1", ...RUN }, f);
    expect(f.waits[0]).toEqual({ id: "g1", waitMs: 2000, sessionId: "sess-1" });
    expect(f.log).toEqual(["snapshot", "wait", recordLine("question", { q1: "yes" }, "board"), CLEAR]);
    expect(body(res)).toMatchObject({ status: "answered", row: byBoard, recorded: true, decidedBy: "board", answers: { q1: "yes" } });
  });

  test("answered and already reconciled records nothing", async () => {
    const f = fake({ waitRes: answered(), fields: [ARMED], decisions: [decided("question", 1000)] });
    const res = await reconcile({ id: "g1", ...RUN }, f);
    expect(f.log).toEqual(["snapshot", "wait", CLEAR]);
    expect(body(res)).toMatchObject({ status: "answered", recorded: false, alreadyReconciled: true });
  });

  test("record: false records nothing but clears waiting-gate", async () => {
    const f = fake({ waitRes: answered(), fields: [ARMED] });
    const res = await reconcile({ id: "g1", ...RUN, record: false }, f);
    expect(f.log).toEqual(["snapshot", "wait", CLEAR]);
    expect(body(res)).toMatchObject({ status: "answered", recorded: false, skipped: "record: false" });
  });

  test("an explicit scope records under it", async () => {
    const f = fake({ waitRes: answered() });
    await reconcile({ id: "g1", ...RUN, scope: "custom" }, f);
    expect(f.log.at(-1)).toBe(recordLine("custom", { q1: "yes" }, "board"));
  });

  test("closed: clears waiting-gate, never an answer, records nothing", async () => {
    const f = fake({ waitRes: closed, fields: [ARMED] });
    const res = await reconcile({ id: "g1", ...RUN }, f);
    expect(f.log).toEqual(["snapshot", "wait", CLEAR]);
    expect(body(res)).toEqual({ status: "closed", id: "g1", closedReason: "superseded", supersededBy: "g2" });
  });

  test("closed leaves a waiting-gate naming another gate alone", async () => {
    const f = fake({ waitRes: closed, fields: [{ key: "waiting-gate", value: "g0", at: 1 }] });
    await reconcile({ id: "g1", ...RUN }, f);
    expect(f.log).toEqual(["snapshot", "wait"]);
  });

  test("the re-read omits sessionId when the session has none", async () => {
    const f = fake({ waitRes: timedOut });
    await tool("gate_reconcile", f.deps).handler({ id: "g1" }, { RT_RUNS_ROOT: "/runs" } as NodeJS.ProcessEnv);
    expect(f.waits[0]).toEqual({ id: "g1", waitMs: 2000 });
    expect("sessionId" in f.waits[0]!).toBe(false);
  });

  test("timeout: status open, waiting-gate left armed, no run writes", async () => {
    const f = fake({ waitRes: timedOut, fields: [ARMED] });
    const res = await reconcile({ id: "g1", ...RUN }, f);
    expect(f.log).toEqual(["snapshot", "wait"]);
    expect(body(res)).toEqual({ status: "open", id: "g1" });
  });

  test("without a run, the same statuses come back with no run calls", async () => {
    const a = fake({ waitRes: answered() });
    expect(body(await reconcile({ id: "g1" }, a))).toMatchObject({ status: "answered", recorded: false, decidedBy: "board" });
    const c = fake({ waitRes: closed });
    expect(body(await reconcile({ id: "g1" }, c))).toEqual({ status: "closed", id: "g1", closedReason: "superseded", supersededBy: "g2" });
    const t = fake({ waitRes: timedOut });
    expect(body(await reconcile({ id: "g1" }, t))).toEqual({ status: "open", id: "g1" });
    for (const f of [a, c, t]) expect(f.log).toEqual(["wait"]);
  });

  test("a failed record after the re-read returns the answer with runErrors", async () => {
    const f = fake({ waitRes: answered(), failWrite: (l) => (l.startsWith("decision") ? "disk full" : undefined) });
    const res = await reconcile({ id: "g1", ...RUN }, f);
    expect(res.ok).toBe(true);
    expect(body(res)).toMatchObject({ status: "answered", recorded: false, runErrors: ["disk full"] });
  });

  test("an unknown gate and a missing id are refused", async () => {
    const f = fake({ waitRes: { ok: false, error: "not-found" } });
    expect((await reconcile({ id: "g9" }, f)).error).toBe("no gate g9");
    const bare = fake();
    expect((await reconcile({}, bare)).error).toContain('"id"');
    expect(bare.log).toEqual([]);
  });

  test("runDb without stage is refused before the re-read", async () => {
    const f = fake();
    const res = await reconcile({ id: "g1", runDb: DB }, f);
    expect(res.error).toContain('"stage"');
    expect(f.log).toEqual([]);
  });
});

describe("the answered scope default", () => {
  const postRow = row({ kind: "review-post", answer: { answers: { outcome: "comment" }, by: "pane", answeredAt: 2000 } });
  const answeredPost = { ok: true, data: { status: "answered", row: postRow } };
  const storedFor = (gate: string): Field => ({ key: "extra.gate-source.post", value: JSON.stringify({ gate, source: { questions: [] } }), at: 1100 });

  test("a late review-post reconcile with no scope finds post's decision through its gate source and writes nothing", async () => {
    const f = fake({ waitRes: answeredPost, fields: [storedFor("g1"), ARMED], decisions: [decided("post", 1500)] });
    const res = await tool("gate_reconcile", f.deps).handler({ id: "g1", ...RUN }, ENV);
    expect(body(res)).toMatchObject({ status: "answered", recorded: false, alreadyReconciled: true });
    expect(f.log).toEqual(["snapshot", "wait", CLEAR]);
  });

  test("a late review-post answer with no scope finds post's decision and writes nothing", async () => {
    const f = fake({ answerRes: { ok: true, data: { row: postRow, conflict: true } }, fields: [storedFor("g1")], decisions: [decided("post", 1500)] });
    const res = await answerGate({ id: "g1", answers: { outcome: "comment" }, ...RUN }, ENV, f.deps);
    expect(body(res)).toMatchObject({ recorded: false, alreadyReconciled: true });
    expect(f.log).toEqual(["snapshot", "answer"]);
  });

  test("an on-time review-post reconcile records under post", async () => {
    const f = fake({ waitRes: answeredPost, fields: [storedFor("g1")] });
    await tool("gate_reconcile", f.deps).handler({ id: "g1", ...RUN }, ENV);
    expect(f.log.at(-1)).toBe(recordLine("post", { outcome: "comment" }, "pane"));
  });

  test("with no gate source naming this gate, the scope stays the row's kind", async () => {
    const f = fake({ waitRes: answeredPost, fields: [storedFor("g0"), { key: "extra.gate-source.bad", value: "not json", at: 1 }], decisions: [decided("post", 1500)] });
    const res = await tool("gate_reconcile", f.deps).handler({ id: "g1", ...RUN }, ENV);
    expect(body(res)).toMatchObject({ recorded: true });
    expect(f.log.at(-1)).toBe(recordLine("review-post", { outcome: "comment" }, "pane"));
    const a = fake({ answerRes: { ok: true, data: { row: postRow } }, fields: [storedFor("g0")] });
    await answerGate({ id: "g1", answers: { outcome: "comment" }, ...RUN }, ENV, a.deps);
    expect(a.log.at(-1)).toBe(recordLine("review-post", { outcome: "comment" }, "pane"));
  });

  test("an explicit scope still wins over the gate source", async () => {
    const f = fake({ waitRes: answeredPost, fields: [storedFor("g1")] });
    await tool("gate_reconcile", f.deps).handler({ id: "g1", ...RUN, scope: "custom" }, ENV);
    expect(f.log.at(-1)).toBe(recordLine("custom", { outcome: "comment" }, "pane"));
  });
});

describe("a stale gate on the signal paths", () => {
  const sourceFor = (gate: string, at: number): Field => ({ key: "extra.gate-source.question", value: JSON.stringify({ gate, source: { questions: [] } }), at });
  const g2 = row({ id: "g2", openedAt: 1500 });
  const reconcile = (id: string, r: GateRow, fields: Field[]) => {
    const f = fake({ waitRes: { ok: true, data: { status: "answered", row: r } }, fields });
    return { f, res: tool("gate_reconcile", f.deps).handler({ id, ...RUN }, ENV) };
  };

  test("an older gate reconciled after the scope re-asked is skipped with no decision write", async () => {
    const { f, res } = reconcile("g1", row(), [sourceFor("g2", 1500), { key: "waiting-gate", value: "g2", at: 1500 }]);
    expect(body(await res)).toMatchObject({ status: "answered", recorded: false, skipped: "stale gate; question's latest gate is g2" });
    expect(f.log).toEqual(["snapshot", "wait"]);
  });

  test("a stale gate still clears waiting-gate when it names this gate", async () => {
    const { f, res } = reconcile("g1", row(), [sourceFor("g2", 1500), ARMED]);
    expect(body(await res)).toMatchObject({ recorded: false, skipped: "stale gate; question's latest gate is g2" });
    expect(f.log).toEqual(["snapshot", "wait", CLEAR]);
  });

  test("the newer gate's own reconcile then records normally", async () => {
    const { f, res } = reconcile("g2", g2, [sourceFor("g2", 1500)]);
    expect(body(await res)).toMatchObject({ recorded: true });
    expect(f.log.at(-1)).toBe(recordLine("question", { q1: "yes" }, "pane"));
  });

  test("gate_answer skips a stale gate the same way", async () => {
    const f = fake({ fields: [sourceFor("g2", 1500)] });
    const res = await answerGate({ id: "g1", answers: { q1: "yes" }, ...RUN }, ENV, f.deps);
    expect(body(res)).toMatchObject({ recorded: false, skipped: "stale gate; question's latest gate is g2" });
    expect(f.log).toEqual(["snapshot", "answer"]);
  });

  test("no gate source, one naming this gate, or one stored before it opened records as before", async () => {
    for (const fields of [[], [sourceFor("g1", 1100)], [sourceFor("g0", 900)]]) {
      const { f, res } = reconcile("g1", row(), fields);
      expect(body(await res)).toMatchObject({ recorded: true });
      expect(f.log.at(-1)).toBe(recordLine("question", { q1: "yes" }, "pane"));
      const a = fake({ fields });
      expect(body(await answerGate({ id: "g1", answers: { q1: "yes" }, ...RUN }, ENV, a.deps))).toMatchObject({ recorded: true });
    }
  });
});

describe("gate_record", () => {
  const record = (input: Record<string, unknown>, f: ReturnType<typeof fake>) => tool("gate_record", f.deps).handler(input, ENV);
  const REC = { ...RUN, scope: "respond-plan", shape: "respond-plan", gateId: "g1" };
  const sourceField = (scope: string, gate: string | null, src: unknown, at = 1100): Field =>
    ({ key: `extra.gate-source.${scope}`, value: JSON.stringify({ gate, source: src }), at });
  const planRow = (answers: Record<string, unknown>) => row({
    kind: "respond-plan",
    questions: fitOpen(plan()).questions as unknown as GateRow["questions"],
    answer: { answers: answers as NonNullable<GateRow["answer"]>["answers"], by: "pane", answeredAt: 2000 },
  });
  const PLAN_ANSWERS = { "thread-1": "fix:T1", "thread-2": "reply:T2", "code-changes": "approve" };
  const answeredPlan = { ok: true, data: { status: "answered", row: planRow(PLAN_ANSWERS) } };

  test("has a none shell form", () => {
    expect(tool("gate_record", fake().deps).shellForms).toEqual({
      none: "replaces the jq selection builders and rt run decision calls the review skills ran by hand",
    });
  });

  test("respond-plan by gateId reads the row at waitMs 0 and takes its cards from the stored source", async () => {
    const f = fake({ waitRes: answeredPlan, fields: [sourceField("respond-plan", "g1", plan())] });
    const res = await record(REC, f);
    expect(f.waits[0]).toEqual({ id: "g1", waitMs: 0 });
    const selection = { threads: { T1: "fix", T2: "reply" }, "code-changes": "approve" };
    expect(f.log).toEqual(["snapshot", "wait", recordLine("respond-plan", selection, "pane")]);
    expect(body(res)).toMatchObject({ recorded: true, selection, decidedBy: "pane" });
    const rows = body(res).rows as { threadId: string; verdict: string; gate1: string; reply: string }[];
    expect(rows.map((r) => [r.threadId, r.verdict, r.gate1])).toEqual([["T1", "valid", "fix"], ["T2", "pushback", "reply"]]);
    expect(rows[1]!.reply).toStartWith("the wait is a fixed 30s delay");
  });

  test("the run's context-dropped mark for this gate makes every textless reply an override", async () => {
    const f = fake({ waitRes: answeredPlan, fields: [sourceField("respond-plan", "g1", plan()), { key: "extra.context-dropped.respond-plan", value: "g1", at: 1050 }] });
    const res = await record(REC, f);
    expect(body(res).selection).toEqual({ threads: { T1: "fix", T2: "reply" }, overrides: ["T2"], "code-changes": "approve" });
    expect((body(res).rows as { gate1: string }[])[1]!.gate1).toBe("override");
  });

  test("a passed source wins over the stored one", async () => {
    const f = fake({ waitRes: answeredPlan });
    const res = await record({ ...REC, source: plan() }, f);
    expect((body(res).rows as { verdict: string }[]).map((r) => r.verdict)).toEqual(["valid", "pushback"]);
  });

  test("respond-post with held upserts over a decision already on the scope", async () => {
    const post = loadJson(join(RR, "post-source.json"));
    const postRow = row({ kind: "respond-post", answer: { answers: { "thread-1": ["post:T1", "resolve:T1"], next: "proceed" }, by: "console", answeredAt: 2000 } });
    const f = fake({
      waitRes: { ok: true, data: { status: "answered", row: postRow } },
      fields: [sourceField("respond-post", "g1", post)],
      decisions: [decided("respond-post", 2500)],
    });
    const res = await record({ ...RUN, scope: "respond-post", shape: "respond-post", gateId: "g1", held: ["T1"] }, f);
    const selection = { threads: { T1: { post: true, resolve: true }, T2: { post: false, resolve: false } }, held: ["T1"] };
    expect(f.log).toEqual(["snapshot", "wait", recordLine("respond-post", selection, "console")]);
    expect(body(res)).toMatchObject({ recorded: true, selection });
    expect(body(res).alreadyReconciled).toBeUndefined();
  });

  test("a stale gate is skipped with no write", async () => {
    const postRow = row({ kind: "respond-post", answer: { answers: { "thread-1": ["post:T1"], next: "proceed" }, by: "pane", answeredAt: 2000 } });
    const f = fake({
      waitRes: { ok: true, data: { status: "answered", row: postRow } },
      fields: [sourceField("respond-post", "g2", loadJson(join(RR, "post-source.json"))), ARMED],
    });
    const res = await record({ ...RUN, scope: "respond-post", shape: "respond-post", gateId: "g1" }, f);
    expect(f.log).toEqual(["snapshot", "wait"]);
    expect(body(res)).toMatchObject({ recorded: false, skipped: "stale gate; respond-post's latest gate is g2" });
  });

  test("a gate opened after the stored source's gate records normally, from its own row's cards", async () => {
    const f = fake({ waitRes: answeredPlan, fields: [sourceField("respond-plan", "g0", plan(), 500)] });
    const res = await record(REC, f);
    expect(body(res).skipped).toBeUndefined();
    const selection = { threads: { T1: "fix", T2: "reply" }, overrides: ["T2"], "code-changes": "approve" };
    expect(f.log.at(-1)).toBe(recordLine("respond-plan", selection, "pane"));
    expect(body(res)).toMatchObject({ recorded: true, selection });
    const rows = body(res).rows as { file: string; verdict: string; reply: string }[];
    expect(rows.map((r) => [r.file, r.verdict, r.reply])).toEqual([["queue/enqueue.ts:88", "unknown", "none"], ["queue/README.md:12", "unknown", "none"]]);
  });

  test("a passed sourcePath is read through the read-root guard and gives the cards", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "gate-record-")));
    try {
      const path = join(dir, "plan-source.json");
      copyFileSync(join(RR, "plan-source.json"), path);
      const f = fake({ waitRes: answeredPlan, fields: [sourceField("respond-plan", "g0", plan(), 500)] });
      f.deps.readRoots = () => ({ roots: [dir] });
      f.deps.readFile = (p) => readFileSync(p, "utf8");
      const res = await record({ ...REC, sourcePath: path }, f);
      expect((body(res).rows as { verdict: string }[]).map((r) => r.verdict)).toEqual(["valid", "pushback"]);
      expect(body(res).selection).toEqual({ threads: { T1: "fix", T2: "reply" }, "code-changes": "approve" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a source naming another gate, stored after this gate opened, makes it stale", async () => {
    const f = fake({ waitRes: answeredPlan, fields: [sourceField("respond-plan", "g2", plan(), 1500)] });
    const res = await record(REC, f);
    expect(f.log).toEqual(["snapshot", "wait"]);
    expect(body(res)).toMatchObject({ recorded: false, skipped: "stale gate; respond-plan's latest gate is g2" });
  });

  test("a hand-back source (gate null) never makes a gate stale", async () => {
    const f = fake({ waitRes: answeredPlan, fields: [sourceField("respond-plan", null, plan())] });
    const res = await record(REC, f);
    expect(body(res).recorded).toBe(true);
  });

  test("a hand-back source stored before this gate opened gives the cards", async () => {
    const f = fake({ waitRes: answeredPlan, fields: [sourceField("respond-plan", null, plan(), 900)] });
    const res = await record(REC, f);
    expect((body(res).rows as { verdict: string }[]).map((r) => r.verdict)).toEqual(["valid", "pushback"]);
  });

  test("a hand-back source stored after this gate opened belongs to a later re-ask and gives no cards", async () => {
    const f = fake({ waitRes: answeredPlan, fields: [sourceField("respond-plan", null, plan(), 1100)] });
    const res = await record(REC, f);
    expect(body(res).recorded).toBe(true);
    expect((body(res).rows as { verdict: string }[]).map((r) => r.verdict)).toEqual(["unknown", "unknown"]);
  });

  test("an answered gate clears waiting-gate when it names the gate", async () => {
    const f = fake({ waitRes: answeredPlan, fields: [ARMED] });
    await record(REC, f);
    expect(f.log.at(-1)).toBe(CLEAR);
  });

  test("a still-open gateId is refused with no write", async () => {
    const f = fake({ waitRes: { ok: true, data: { status: "timeout" } } });
    const res = await record(REC, f);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("gate g1 is still open; record it once it is answered");
    expect(f.log).toEqual(["snapshot", "wait"]);
  });

  test("a closed or unknown gateId is refused", async () => {
    const closedRow = row({ status: "closed", answer: null, closedReason: "abandoned" });
    const c = await record(REC, fake({ waitRes: { ok: true, data: { status: "closed", row: closedRow } } }));
    expect(c.error).toBe("gate g1 is closed (abandoned) and has no answer to record");
    const n = await record(REC, fake({ waitRes: { ok: false, error: "not-found" } }));
    expect(n.error).toBe("no gate g1");
  });

  test("post with next hold decides nothing", async () => {
    const holdRow = row({ answer: { answers: { "findings-1": ["F1"], outcome: "comment", next: "hold" }, by: "pane", answeredAt: 2000 } });
    const f = fake({ waitRes: { ok: true, data: { status: "answered", row: holdRow } } });
    const res = await record({ ...RUN, scope: "post", shape: "post", gateId: "g1" }, f);
    expect(f.log).toEqual(["snapshot", "wait"]);
    expect(body(res)).toMatchObject({ recorded: false, skipped: "next is hold: post decides nothing", next: "hold" });
  });

  test("the answers shape records a hold next as is", async () => {
    const holdRow = row({ answer: { answers: { q1: "yes", next: "hold" }, by: "pane", answeredAt: 2000 } });
    const f = fake({ waitRes: { ok: true, data: { status: "answered", row: holdRow } } });
    await record({ ...RUN, scope: "question", gateId: "g1" }, f);
    expect(f.log.at(-1)).toBe(recordLine("question", { q1: "yes", next: "hold" }, "pane"));
  });

  test("handed answers record as the named decider without reading the registry", async () => {
    const f = fake();
    const res = await record({ ...RUN, scope: "question", answers: { q1: { value: "yes", note: "" } }, decidedBy: "board" }, f);
    expect(f.log).toEqual(["snapshot", recordLine("question", { q1: "yes" }, "board")]);
    expect(body(res)).toMatchObject({ recorded: true, decidedBy: "board", answers: { q1: "yes" } });
  });

  test("a handed respond-plan takes its cards from a hand-back source", async () => {
    const f = fake({ fields: [sourceField("respond-plan", null, plan())] });
    const res = await record({ ...RUN, scope: "respond-plan", shape: "respond-plan", answers: PLAN_ANSWERS, decidedBy: "board" }, f);
    expect((body(res).rows as { verdict: string }[]).map((r) => r.verdict)).toEqual(["valid", "pushback"]);
    expect(f.log.at(-1)).toStartWith("decision record --contract gate@1 --scope respond-plan");
  });

  test("a failed record returns the result with runErrors", async () => {
    const f = fake({ failWrite: (l) => (l.startsWith("decision") ? "disk full" : undefined) });
    const res = await record({ ...RUN, scope: "question", answers: { q1: "yes" }, decidedBy: "board" }, f);
    expect(res.ok).toBe(true);
    expect(body(res)).toMatchObject({ recorded: false, runErrors: ["disk full"] });
  });

  test("bad inputs are refused before any call", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ...RUN, scope: "question", answers: { q1: "yes" } }, '"decidedBy" is required with "answers"'],
      [{ ...RUN, scope: "question", answers: { q1: "yes" }, decidedBy: "" }, '"decidedBy" is required with "answers"'],
      [{ ...RUN, scope: "question" }, 'pass exactly one of "gateId" or "answers"'],
      [{ ...RUN, scope: "question", gateId: "g1", answers: { q1: "yes" }, decidedBy: "board" }, 'pass exactly one of "gateId" or "answers"'],
      [{ ...RUN, scope: "question", gateId: "g1", decidedBy: "board" }, '"decidedBy" is only for handed "answers"'],
      [{ stage: "s", scope: "question", gateId: "g1" }, '"runDb" is required'],
      [{ runDb: DB, scope: "question", gateId: "g1" }, '"stage" is required'],
      [{ ...RUN, gateId: "g1" }, '"scope" is required'],
      [{ ...RUN, scope: " ", gateId: "g1" }, '"scope" must be a non-empty string'],
      [{ ...RUN, scope: "q", gateId: "g1", shape: "plan" }, '"shape" must be one of answers, respond-plan, respond-post, post'],
      [{ ...RUN, scope: "q", gateId: "g1", held: "T1" }, '"held" must be an array of strings'],
      [{ ...RUN, scope: "q", gateId: "g1", contextDropped: "yes" }, '"contextDropped" must be a boolean or an array of question ids'],
      [{ ...RUN, scope: "q", gateId: "g1", source: plan(), sourcePath: "/x.json" }, 'pass exactly one of "source", "sourcePath" or "review"'],
    ];
    for (const [input, error] of cases) {
      const f = fake();
      const res = await record(input, f);
      expect(res.error).toBe(error);
      expect(f.log).toEqual([]);
    }
  });
});
