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
