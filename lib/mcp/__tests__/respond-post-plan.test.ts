import { describe, expect, test } from "bun:test";
import type { GateAnswer, GateRow } from "../../../packages/rt-client/src/index.ts";
import { gateSourceField, planRespondPost, type RunSnapshot, type SnapshotField } from "../mr-composite-tools.ts";

type Q = { id: string; label: string; multi: boolean; context?: Record<string, unknown>; options: unknown[] };
type Source = { context: Record<string, unknown>; questions: Q[] };

const T1_DIRECTION = "enqueue() now drops non-retryable jobs; added the missing check and a test.";
const T2_VERBATIM = "the wait is a fixed 30s delay (queue/retry.ts:14), so the README keeps delay; backoff would describe behavior the code does not have.";
const T1_FIXED = "Fixed -- queue/enqueue.ts:88 / enqueue() now drops non-retryable jobs; added the check and a test.";
const T2_OVERRIDE = "the wait is a fixed 30s delay (queue/retry.ts:14), so the README keeps delay.";

function planThread(n: number, id: string, reply: { kind: string; text?: string }): Q {
  return {
    id: `thread-${n}`, label: `queue/file-${n}.ts:${n}`, multi: false,
    context: {
      "gate-ctx": "thread@1", author: "renee", severity: "blocking",
      claim: { summary: `ask ${id}` }, verdict: { call: "valid", note: "confirmed" }, reply,
    },
    options: [
      { value: `reply:${id}`, label: "reply", description: "reply only; no code change" },
      { value: `fix:${id}`, label: "fix", recommended: true, description: "the change" },
      { value: `skip:${id}`, label: "skip", description: "no reply, no code change" },
    ],
  };
}

function planSource(threads: Q[]): Source {
  return {
    context: { "gate-ctx": "plan@1", reviewer: "renee", round: 1, threads: { total: threads.length, blocking: 1 }, adjudication: "1 valid · fresh-context adjudicated" },
    questions: [...threads, { id: "code-changes", label: "Approve the proposed code changes?", multi: false, options: ["approve", "revise", "skip"] }],
  };
}

function postThread(n: number, id: string, verb: "fix" | "reply", text: string): Q {
  return {
    id: `thread-${n}`, label: `queue/file-${n}.ts:${n}`, multi: true,
    context: { "gate-ctx": "reply@1", thread: id, file: `queue/file-${n}.ts:${n}`, verb, ...(verb === "fix" && { sha: "ab12cd3" }), text },
    options: [
      { value: `post:${id}`, label: "post", recommended: true, description: "post this reply to the thread" },
      { value: `resolve:${id}`, label: "resolve", recommended: verb === "fix", description: "resolve the thread" },
    ],
  };
}

function postSource(threads: Q[]): Source {
  return {
    context: { "gate-ctx": "post@1", reviewer: "renee", round: 1, replies: threads.length, fixes: [{ sha: "ab12cd3" }] },
    questions: [...threads, { id: "next", label: "Next", multi: false, options: [{ value: "proceed", label: "proceed", recommended: true }, "iterate", "hold"] }],
  };
}

const PLAN = planSource([planThread(1, "T1", { kind: "direction", text: T1_DIRECTION }), planThread(2, "T2", { kind: "verbatim", text: T2_VERBATIM })]);
const POST_T1 = postSource([postThread(1, "T1", "fix", T1_FIXED)]);
const POST_T1_T2 = postSource([postThread(1, "T1", "fix", T1_FIXED), postThread(2, "T2", "reply", T2_OVERRIDE)]);

const MR = "https://gitlab.com/acme/app/-/merge_requests/7";
const PLAN_OPENED = 1_000;
const PLAN_DECIDED = 2_000;
const POST_OPENED = 3_000;
const POST_DECIDED = 4_000;

const field = (key: string, value: string, at: number): SnapshotField => ({ run_id: "r1", key, value, produced_by: "respond", at });
const sourceField = (scope: string, gate: string | null, source: Source, at: number) => field(`extra.gate-source.${scope}`, JSON.stringify({ gate, source }), at);
const decision = (scope: string, selection: unknown, decidedAt: number, by = "matt") => ({
  run_id: "r1", contract: "gate@1", scope, selection: JSON.stringify(selection), decided_by: by, decided_at: decidedAt,
});

function row(id: string, source: Source, answers: Record<string, unknown>, openedAt: number, over: Partial<GateRow> = {}): GateRow {
  return {
    id, subject: `run:r1/${id}`, kind: "respond", meta: null, context: JSON.stringify(source.context), origin: null,
    questions: source.questions.map((q) => ({
      id: q.id, label: q.label, multi: q.multi,
      options: q.options.map((o) => (typeof o === "string" ? { value: o, label: o } : { value: (o as { value: string }).value, label: (o as { label: string }).label })),
      ...(q.context && { context: JSON.stringify(q.context) }),
    })),
    status: "answered", answer: { answers: answers as GateAnswer["answers"], by: "matt", answeredAt: openedAt + 500 },
    openedAt, parkedAt: null, closedAt: null, closedReason: null, supersededBy: null, agent: null, pane: null, nudge: null,
    delivery: null, released: false, consumedAt: null, owner: null, escalatedAt: null, ...over,
  };
}

type Scenario = {
  snapshot: RunSnapshot;
  gates: { plan: GateRow | null; post: GateRow | null };
};

function happy(): Scenario {
  return {
    snapshot: {
      ok: true,
      run: { id: "r1", started_at: 100 },
      stages: [],
      fields: [
        field("mr", MR, 50),
        field("branch", "fix-queue", 50),
        sourceField("respond-plan", "g-plan", PLAN, PLAN_OPENED),
        sourceField("respond-post", "g-post", POST_T1, POST_OPENED),
      ],
      decisions: [
        decision("respond-plan", { threads: { T1: "fix", T2: "reply" }, "code-changes": "approve" }, PLAN_DECIDED),
        decision("respond-post", { threads: { T1: { post: true, resolve: true } } }, POST_DECIDED),
      ],
    },
    gates: {
      plan: row("g-plan", PLAN, { "thread-1": "fix:T1", "thread-2": "reply:T2", "code-changes": "approve" }, PLAN_OPENED),
      post: row("g-post", POST_T1, { "thread-1": ["post:T1", "resolve:T1"], next: "proceed" }, POST_OPENED),
    },
  };
}

function setField(s: Scenario, f: SnapshotField) {
  s.snapshot.fields = [...s.snapshot.fields.filter((x) => x.key !== f.key), f];
}
function dropField(s: Scenario, key: string) {
  s.snapshot.fields = s.snapshot.fields.filter((x) => x.key !== key);
}
function setDecision(s: Scenario, scope: string, selection: unknown, decidedAt: number) {
  s.snapshot.decisions = [...s.snapshot.decisions.filter((d) => d.scope !== scope), decision(scope, selection, decidedAt)];
}
function dropDecision(s: Scenario, scope: string) {
  s.snapshot.decisions = s.snapshot.decisions.filter((d) => d.scope !== scope);
}

const plan = (s: Scenario) => planRespondPost(s.snapshot, s.gates);
function refusal(s: Scenario): string {
  const r = plan(s);
  if (r.ok) throw new Error(`expected a refusal, got ${JSON.stringify(r.plan)}`);
  return r.error;
}
function accepted(s: Scenario) {
  const r = plan(s);
  if (!r.ok) throw new Error(`expected a plan, got: ${r.error}`);
  return r.plan;
}

describe("gateSourceField", () => {
  test("reads the gate id, the source and the field's at", () => {
    const f = gateSourceField(happy().snapshot.fields, "respond-plan");
    expect(f).toEqual({ gate: "g-plan", source: PLAN, at: PLAN_OPENED });
  });

  test("a hand-back field reads gate null", () => {
    expect(gateSourceField([sourceField("respond-post", null, POST_T1, 7)], "respond-post")?.gate).toBeNull();
  });

  test("an absent or unreadable field is null", () => {
    expect(gateSourceField([], "respond-plan")).toBeNull();
    expect(gateSourceField([field("extra.gate-source.respond-plan", "{not json", 1)], "respond-plan")).toBeNull();
    expect(gateSourceField([field("extra.gate-source.respond-plan", JSON.stringify({ gate: 3, source: {} }), 1)], "respond-plan")).toBeNull();
  });
});

describe("planRespondPost happy path", () => {
  test("the T1 fix with its card text, then the T2 reply row with its verbatim card text", () => {
    const p = accepted(happy());
    expect(p.mrUrl).toBe(MR);
    expect(p.branch).toBe("fix-queue");
    expect(p.startedAt).toBe(100);
    expect(p.planDecidedAt).toBe(PLAN_DECIDED);
    expect(p.actions).toEqual([
      { threadId: "T1", verb: "fix", post: true, resolve: true, body: T1_FIXED },
      { threadId: "T2", verb: "reply", post: true, resolve: false, body: T2_VERBATIM },
    ]);
    expect(p.postDecision).toEqual({ selection: { threads: { T1: { post: true, resolve: true } } }, decidedBy: "matt" });
    expect(p.heldResume).toBeNull();
  });

  test("branch is null with no branch field", () => {
    const s = happy();
    dropField(s, "branch");
    expect(accepted(s).branch).toBeNull();
  });
});

describe("edited text", () => {
  test("the respond-post entry's text wins over the card text", () => {
    const s = happy();
    s.gates.post = row("g-post", POST_T1, { "thread-1": { value: ["post:T1", "resolve:T1"], text: "Edited T1" }, next: "proceed" }, POST_OPENED);
    setDecision(s, "respond-post", { threads: { T1: { post: true, resolve: true, text: "Edited T1" } } }, POST_DECIDED);
    expect(accepted(s).actions[0]).toEqual({ threadId: "T1", verb: "fix", post: true, resolve: true, body: "Edited T1" });
  });

  test("the respond-plan texts entry wins over the plan card", () => {
    const s = happy();
    s.gates.plan = row("g-plan", PLAN, { "thread-1": "fix:T1", "thread-2": { value: "reply:T2", text: "Edited T2" }, "code-changes": "approve" }, PLAN_OPENED);
    setDecision(s, "respond-plan", { threads: { T1: "fix", T2: "reply" }, texts: { T2: "Edited T2" }, "code-changes": "approve" }, PLAN_DECIDED);
    expect(accepted(s).actions[1]).toEqual({ threadId: "T2", verb: "reply", post: true, resolve: false, body: "Edited T2" });
  });
});

describe("freshness", () => {
  test("a plan decision older than its gate row's openedAt refuses", () => {
    const s = happy();
    setDecision(s, "respond-plan", { threads: { T1: "fix", T2: "reply" }, "code-changes": "approve" }, PLAN_OPENED - 1);
    expect(refusal(s)).toContain("respond-plan has no decision recorded since its gate opened");
  });

  test("with gate null the threshold is the field's at", () => {
    const s = happy();
    setField(s, sourceField("respond-plan", null, PLAN, PLAN_OPENED));
    s.gates.plan = null;
    setDecision(s, "respond-plan", { threads: { T1: "fix", T2: "reply" }, "code-changes": "approve" }, PLAN_OPENED - 1);
    expect(refusal(s)).toContain("respond-plan has no decision recorded since its gate opened");

    setDecision(s, "respond-plan", { threads: { T1: "fix", T2: "reply" }, "code-changes": "approve" }, PLAN_OPENED);
    s.gates.plan = null;
    expect(accepted(s).actions.map((a) => a.threadId)).toEqual(["T1", "T2"]);
  });

  test("a missing plan decision refuses, naming gate_record", () => {
    const s = happy();
    dropDecision(s, "respond-plan");
    expect(refusal(s)).toBe("respond-plan has no decision recorded since its gate opened; if the gate is answered, record it with gate_record, then call again");
  });

  test("a stale respond-post decision refuses", () => {
    const s = happy();
    setDecision(s, "respond-post", { threads: { T1: { post: true, resolve: true } } }, POST_OPENED - 1);
    expect(refusal(s)).toContain("respond-post has no decision recorded since its gate opened");
  });
});

describe("nothing offered", () => {
  test("no respond-post field: reply rows only, postDecision null", () => {
    const s = happy();
    dropField(s, "extra.gate-source.respond-post");
    dropDecision(s, "respond-post");
    s.gates.post = null;
    const p = accepted(s);
    expect(p.actions).toEqual([{ threadId: "T2", verb: "reply", post: true, resolve: false, body: T2_VERBATIM }]);
    expect(p.postDecision).toBeNull();
    expect(p.heldResume).toBeNull();
  });

  test("a respond-post field written before the plan decision offered nothing this round", () => {
    const s = happy();
    setField(s, sourceField("respond-post", "g-old", POST_T1, PLAN_DECIDED - 1));
    setDecision(s, "respond-post", { threads: { T1: { post: true, resolve: true } } }, PLAN_DECIDED - 1);
    s.gates.post = null;
    const p = accepted(s);
    expect(p.actions.map((a) => a.threadId)).toEqual(["T2"]);
    expect(p.postDecision).toBeNull();
  });

  test("a respond-post field newer than the plan decision with no respond-post decision refuses", () => {
    const s = happy();
    dropDecision(s, "respond-post");
    expect(refusal(s)).toContain("respond-post has no decision recorded since its gate opened");
  });

  test("a respond-post decision newer than the plan decision with no source this round refuses", () => {
    const s = happy();
    dropField(s, "extra.gate-source.respond-post");
    s.gates.post = null;
    expect(refusal(s)).toMatch(/respond-post has a decision recorded after the respond-plan decision but no extra\.gate-source\.respond-post field/);
  });
});

describe("registry cross-check", () => {
  test("a post row that is not answered refuses", () => {
    const s = happy();
    s.gates.post = { ...s.gates.post!, status: "open", answer: null };
    expect(refusal(s)).toMatch(/respond-post gate g-post is open, not answered/);
  });

  test("next hold refuses", () => {
    const s = happy();
    s.gates.post = row("g-post", POST_T1, { "thread-1": ["post:T1", "resolve:T1"], next: "hold" }, POST_OPENED);
    expect(refusal(s)).toMatch(/next answer is hold, not proceed/);
  });

  test("an answer of post only against a decision that resolves refuses", () => {
    const s = happy();
    s.gates.post = row("g-post", POST_T1, { "thread-1": ["post:T1"], next: "proceed" }, POST_OPENED);
    expect(refusal(s)).toMatch(/T1.*resolve/);
  });

  test("an answer text that differs from the decision text refuses", () => {
    const s = happy();
    s.gates.post = row("g-post", POST_T1, { "thread-1": { value: ["post:T1"], text: "X" }, next: "proceed" }, POST_OPENED);
    setDecision(s, "respond-post", { threads: { T1: { post: true, resolve: false, text: "Y" } } }, POST_DECIDED);
    expect(refusal(s)).toMatch(/T1.*text/);
  });

  test("a plan answer of reply:T2 against a decision of skip refuses", () => {
    const s = happy();
    setDecision(s, "respond-plan", { threads: { T1: "fix", T2: "skip" }, "code-changes": "approve" }, PLAN_DECIDED);
    expect(refusal(s)).toMatch(/T2.*reply.*skip|T2.*skip.*reply/);
  });

  test("a plan answer text with no texts entry in the decision refuses", () => {
    const s = happy();
    s.gates.plan = row("g-plan", PLAN, { "thread-1": "fix:T1", "thread-2": { value: "reply:T2", text: "Edited T2" }, "code-changes": "approve" }, PLAN_OPENED);
    expect(refusal(s)).toMatch(/T2.*text/);
  });

  test("a gate row whose id is not the source's gate refuses", () => {
    const s = happy();
    s.gates.post = { ...s.gates.post!, id: "g-other" };
    expect(refusal(s)).toMatch(/the respond-post gate g-post was not read from the registry/);
  });

  test("T1 and T10 picks never cross", () => {
    const planSrc = planSource([planThread(1, "T1", { kind: "direction", text: T1_DIRECTION }), planThread(2, "T10", { kind: "direction", text: "draft for T10" })]);
    const postSrc = postSource([postThread(1, "T1", "fix", T1_FIXED), postThread(2, "T10", "reply", "redrafted T10")]);
    const s = happy();
    setField(s, sourceField("respond-plan", "g-plan", planSrc, PLAN_OPENED));
    setField(s, sourceField("respond-post", "g-post", postSrc, POST_OPENED));
    setDecision(s, "respond-plan", { threads: { T1: "fix", T10: "reply" }, overrides: ["T10"], "code-changes": "approve" }, PLAN_DECIDED);
    setDecision(s, "respond-post", { threads: { T1: { post: false, resolve: false }, T10: { post: true, resolve: false } } }, POST_DECIDED);
    s.gates.plan = row("g-plan", planSrc, { "thread-1": "fix:T1", "thread-2": "reply:T10", "code-changes": "approve" }, PLAN_OPENED);
    s.gates.post = row("g-post", postSrc, { "thread-1": [], "thread-2": ["post:T10"], next: "proceed" }, POST_OPENED);
    expect(accepted(s).actions).toEqual([
      { threadId: "T1", verb: "fix", post: false, resolve: false, body: null },
      { threadId: "T10", verb: "override", post: true, resolve: false, body: "redrafted T10" },
    ]);
  });
});

describe("missing entries and unseen words", () => {
  test("an offered thread with no selection entry refuses as a mismatch", () => {
    const s = happy();
    setField(s, sourceField("respond-post", "g-post", POST_T1_T2, POST_OPENED));
    setDecision(s, "respond-plan", { threads: { T1: "fix", T2: "reply" }, overrides: ["T2"], "code-changes": "approve" }, PLAN_DECIDED);
    s.gates.post = row("g-post", POST_T1_T2, { "thread-1": ["post:T1", "resolve:T1"], "thread-2": [], next: "proceed" }, POST_OPENED);
    expect(refusal(s)).toMatch(/no entry for offered thread T2/);
  });

  test("an offered thread with no selection entry refuses on the hand-back path too", () => {
    const s = happy();
    setField(s, sourceField("respond-post", null, POST_T1_T2, POST_OPENED));
    s.gates.post = null;
    setDecision(s, "respond-plan", { threads: { T1: "fix", T2: "reply" }, overrides: ["T2"], "code-changes": "approve" }, PLAN_DECIDED);
    expect(refusal(s)).toMatch(/no entry for offered thread T2/);
  });

  test("a direction card with no texts entry and no override refuses naming the thread", () => {
    const s = happy();
    dropField(s, "extra.gate-source.respond-post");
    dropDecision(s, "respond-post");
    s.gates.post = null;
    setDecision(s, "respond-plan", { threads: { T1: "reply", T2: "reply" }, "code-changes": "skip" }, PLAN_DECIDED);
    s.gates.plan = row("g-plan", PLAN, { "thread-1": "reply:T1", "thread-2": "reply:T2", "code-changes": "skip" }, PLAN_OPENED);
    expect(refusal(s)).toMatch(/T1 is a reply row with no edited text and its card shows no verbatim reply/);
  });

  test("a reply row whose answer carries a note and no text refuses as an unmade override", () => {
    const s = happy();
    s.gates.plan = row("g-plan", PLAN, { "thread-1": "fix:T1", "thread-2": { value: "reply:T2", note: "soften this" }, "code-changes": "approve" }, PLAN_OPENED);
    expect(refusal(s)).toMatch(/T2 is a reply row whose answer carries a note/);

    const handBack = happy();
    setField(handBack, sourceField("respond-plan", null, PLAN, PLAN_OPENED));
    handBack.gates.plan = null;
    setDecision(handBack, "respond-plan", { threads: { T1: "fix", T2: "reply" }, notes: { T2: "soften this" }, "code-changes": "approve" }, PLAN_DECIDED);
    expect(refusal(handBack)).toMatch(/T2 is a reply row whose answer carries a note/);
  });

  test("a card text absent from the registry row's question context refuses naming the thread", () => {
    const s = happy();
    const plan = s.gates.plan!;
    s.gates.plan = { ...plan, questions: plan.questions.map((q) => (q.id === "thread-2" ? { ...q, context: undefined } : q)) };
    expect(refusal(s)).toMatch(/T2's card text is not in the respond-plan gate's question context/);
  });

  const withPlanProse = (s: Scenario, prose: string) => {
    const plan = s.gates.plan!;
    s.gates.plan = { ...plan, questions: plan.questions.map((q) => (q.id === "thread-2" ? { ...q, context: prose } : q)) };
  };
  const withPostProse = (s: Scenario, prose: string) => {
    const post = s.gates.post!;
    s.gates.post = { ...post, questions: post.questions.map((q) => (q.id === "thread-1" ? { ...q, context: prose } : q)) };
  };

  test("a prose thread card carrying the card text on its Will post as reply line passes", () => {
    const s = happy();
    withPlanProse(s, `[BLOCKING] renee: ask T2\nVerdict: valid -- confirmed\nWill post as reply: ${T2_VERBATIM}`);
    expect(accepted(s).actions[1]?.body).toBe(T2_VERBATIM);
  });

  test("a prose thread card carrying the card text only outside its Will post as reply line refuses", () => {
    const s = happy();
    withPlanProse(s, `[BLOCKING] renee: ${T2_VERBATIM}\nVerdict: valid -- ${T2_VERBATIM}\nWill post as reply: something else`);
    expect(refusal(s)).toMatch(/T2's card text is not in the respond-plan gate's question context/);
  });

  test("a prose reply card carrying the card text after its FIX marker passes", () => {
    const s = happy();
    withPostProse(s, `queue/file-1.ts:1 FIX · ab12cd3: ${T1_FIXED}`);
    expect(accepted(s).actions[0]?.body).toBe(T1_FIXED);
  });

  test("a prose reply card carrying the card text only before its marker refuses", () => {
    const s = happy();
    withPostProse(s, `queue/file-1.ts:1 FIX · ab12cd3: You wrote: ${T1_FIXED}`);
    expect(refusal(s)).toMatch(/T1's card text is not in the respond-post gate's question context/);
    withPostProse(s, `${T1_FIXED}\nqueue/file-1.ts:1 REPLY: other`);
    expect(refusal(s)).toMatch(/T1's card text is not in the respond-post gate's question context/);
  });

  test("a respond-post card text absent from the registry row's question context refuses", () => {
    const s = happy();
    const post = s.gates.post!;
    s.gates.post = { ...post, questions: post.questions.map((q) => (q.id === "thread-1" ? { ...q, context: undefined } : q)) };
    expect(refusal(s)).toMatch(/T1's card text is not in the respond-post gate's question context/);
  });

  test("a post pick with no body anywhere refuses", () => {
    const s = happy();
    const empty = postSource([{ ...postThread(1, "T1", "fix", T1_FIXED), context: { "gate-ctx": "reply@1", thread: "T1", verb: "fix" } }]);
    setField(s, sourceField("respond-post", null, empty, POST_OPENED));
    s.gates.post = null;
    expect(refusal(s)).toMatch(/T1 is picked to post but has no reply text/);
  });
});

describe("code-changes", () => {
  const REVISE = /respond-plan was answered revise, so nothing from it acts; re-adjudicate and open a new respond-plan gate/;

  test("a revise plan refuses on the gated path", () => {
    const s = happy();
    dropField(s, "extra.gate-source.respond-post");
    dropDecision(s, "respond-post");
    s.gates.post = null;
    setDecision(s, "respond-plan", { threads: { T1: "fix", T2: "reply" }, "code-changes": "revise" }, PLAN_DECIDED);
    s.gates.plan = row("g-plan", PLAN, { "thread-1": "fix:T1", "thread-2": "reply:T2", "code-changes": "revise" }, PLAN_OPENED);
    expect(refusal(s)).toMatch(REVISE);
  });

  test("a revise plan refuses on the hand-back path", () => {
    const s = happy();
    setField(s, sourceField("respond-plan", null, PLAN, PLAN_OPENED));
    s.gates.plan = null;
    setDecision(s, "respond-plan", { threads: { T1: "fix", T2: "reply" }, "code-changes": "revise" }, PLAN_DECIDED);
    expect(refusal(s)).toMatch(REVISE);
  });

  test("an offered fix row under code-changes skip refuses", () => {
    const s = happy();
    setDecision(s, "respond-plan", { threads: { T1: "fix", T2: "reply" }, "code-changes": "skip" }, PLAN_DECIDED);
    s.gates.plan = row("g-plan", PLAN, { "thread-1": "fix:T1", "thread-2": "reply:T2", "code-changes": "skip" }, PLAN_OPENED);
    expect(refusal(s)).toMatch(/offered thread T1 is a fix row but respond-plan's code-changes is skip, not approve/);
  });

  test("an offered fix row with no code-changes refuses", () => {
    const s = happy();
    setField(s, sourceField("respond-plan", null, PLAN, PLAN_OPENED));
    s.gates.plan = null;
    setDecision(s, "respond-plan", { threads: { T1: "fix", T2: "reply" } }, PLAN_DECIDED);
    expect(refusal(s)).toMatch(/offered thread T1 is a fix row but respond-plan's code-changes is missing, not approve/);
  });
});

describe("retired respond-post shape", () => {
  for (const selection of [{ replies: ["T1"], disposition: "resolve-addressed" }, { "replies-1": ["T1"] }, { disposition: "leave-open", threads: {} }, {}]) {
    test(`refuses ${JSON.stringify(selection)}`, () => {
      const s = happy();
      setDecision(s, "respond-post", selection, POST_DECIDED);
      expect(refusal(s)).toContain("retired");
    });
  }
});

describe("run-level refusals", () => {
  test("no respond-plan gate source names gate_open {runDb}", () => {
    const s = happy();
    dropField(s, "extra.gate-source.respond-plan");
    expect(refusal(s)).toContain("gate_open {runDb}");
  });

  test("no mr field refuses", () => {
    const s = happy();
    dropField(s, "mr");
    expect(refusal(s)).toContain("mr field");
  });

  test("an http mr field refuses, since target resolution takes https only", () => {
    const s = happy();
    const http = "http://gitlab.com/acme/app/-/merge_requests/7";
    setField(s, field("mr", http, 50));
    expect(refusal(s)).toBe(`the run's mr field is not an MR URL: ${http}`);
  });

  test("a GitHub PR refuses with the gh reply and resolve move", () => {
    const s = happy();
    setField(s, field("mr", "https://github.com/acme/app/pull/3", 50));
    const e = refusal(s);
    expect(e).toStartWith("GitLab only: respond_post_execute does not speak GitHub; ");
    expect(e).toMatch(/gh/);
    expect(e).toMatch(/reply/);
    expect(e).toMatch(/resolve/);
  });

  test("a failed snapshot refuses", () => {
    expect(planRespondPost({ ok: false, error: "no run db" } as unknown as RunSnapshot, { plan: null, post: null }).ok).toBe(false);
  });
});

describe("held resume", () => {
  test("a post decision carrying held hands back heldResume", () => {
    const s = happy();
    setDecision(s, "respond-post", { threads: { T1: { post: true, resolve: true } }, held: ["T1"] }, POST_DECIDED);
    expect(accepted(s).heldResume).toEqual(["T1"]);
  });

  test("held naming a thread that is neither offered nor a reply row refuses", () => {
    const s = happy();
    setDecision(s, "respond-post", { threads: { T1: { post: true, resolve: true } }, held: ["T9"] }, POST_DECIDED);
    expect(refusal(s)).toMatch(/holds T9, which is neither offered nor a reply row/);
  });
});
