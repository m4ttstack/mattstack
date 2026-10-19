import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JqError } from "../jq.ts";
import { checkSource, ctxErrors } from "../ctx.ts";

const ROOT = join(import.meta.dir, "../../..");
const FIXTURE: Record<string, string> = {
  plan: "plugins/mattstack/attachments/review/receive-review/tests/fixtures/plan-source.json",
  post: "plugins/mattstack/attachments/review/receive-review/tests/fixtures/post-source.json",
  review: "plugins/mattstack/attachments/review/receive-review/tests/fixtures/review-source.json",
};
type Src = Record<string, any>;
const load = (name: string): Src => JSON.parse(readFileSync(join(ROOT, FIXTURE[name]!), "utf8"));
const PLAN = "plan";
const POST = "post";
const REVIEW = "review";

function mutated(fixture: string, f: (s: Src) => void): Src {
  const s = load(fixture);
  f(s);
  return s;
}

const skippedQuestion = (entries: Src[], values: string[]): Src => ({
  id: "skipped-1",
  multi: true,
  context: { "gate-ctx": "skipped@1", skipped: entries },
  options: values.map((value) => ({ value, label: value })),
});
const skipF3 = { id: "r1-f3", round: 1, severity: "minor", title: "unused import in the retry module", changed: true };
const skipF5 = { id: "r1-f5", round: 1, severity: "important", title: "the lease renewal has no test", changed: false };

const rejects: [string, string, (s: Src) => void, string][] = [
  ["missing reviewer", PLAN, (s) => delete s.context.reviewer, "gate: reviewer: required non-empty string"],
  ["severity outside the enum", PLAN, (s) => (s.questions[0].context.severity = "major"), "thread-1: severity: blocking|non-blocking|question|none"],
  ["verbatim reply without text", PLAN, (s) => (s.questions[1].context.reply = { kind: "verbatim" }), "thread-2: reply.text: required unless reply.kind is none"],
  ["retired verdict word", PLAN, (s) => (s.questions[1].context.verdict.call = "invalid"), "thread-2: verdict.call: valid|valid-low-value|pushback|needs-clarification|no-ask"],
  ["question shape at gate level", PLAN, (s) => (s.context["gate-ctx"] = "thread@1"), "gate: gate-ctx must be one of plan@1, post@1, review@1, boards@1"],
  ["unknown version", PLAN, (s) => (s.questions[0].context["gate-ctx"] = "thread@2"), "thread-1: gate-ctx must be one of thread@1, reply@1, findings@1, carryover@1, skipped@1"],
  ["null optional", PLAN, (s) => (s.context.round = null), "gate: round: integer when present"],
  ["points as a string", PLAN, (s) => (s.questions[0].context.claim.points = "one"), "thread-1: claim.points: array of strings when present"],
  ["reply joins no option", POST, (s) => (s.questions[0].context.thread = "TX"), "thread-1: options: exactly post:TX and resolve:TX"],
  ["a third option on a reply", POST, (s) => s.questions[1].options.push("skip:T2"), "thread-2: options: exactly post:T2 and resolve:T2"],
  [
    "a carryover question without exactly post and resolve",
    POST,
    (s) => {
      s.questions[0].context = { "gate-ctx": "carryover@1", thread: "T1", round: 1, call: "fixed", original: "permanent failures re-enqueue forever", reply: "Confirmed, thanks." };
      s.questions[0].options = ["post:T1", "skip:T1"];
    },
    "thread-1: options: exactly post:T1 and resolve:T1",
  ],
  ["post without a replies count", POST, (s) => delete s.context.replies, "gate: replies: required integer"],
  ["sha on a plain reply", POST, (s) => (s.questions[1].context.sha = "x"), "thread-2: sha: only a fix carries sha"],
  ["a reply without text", POST, (s) => delete s.questions[0].context.text, "thread-1: text: required non-empty string"],
  ["verb outside the enum", POST, (s) => (s.questions[1].context.verb = "skip"), "thread-2: verb: reply|fix"],
  ["a reply question that is not multi", POST, (s) => (s.questions[0].multi = false), "thread-1: multi: a per-thread question is multi"],
  ["a reply question with no multi", POST, (s) => delete s.questions[1].multi, "thread-2: multi: a per-thread question is multi"],
  [
    "a thread offered twice",
    POST,
    (s) => {
      s.questions[1].context.thread = "T1";
      s.questions[1].context.verb = "reply";
      s.questions[1].options = ["post:T1", "resolve:T1"];
    },
    "thread-2: thread T1 is offered by more than one question",
  ],
  ["whitespace-only reply text", POST, (s) => (s.questions[0].context.text = "   "), "thread-1: text: required non-empty string"],
  ["the retired replies shape", POST, (s) => (s.questions[0].context = { "gate-ctx": "replies@1", replies: [] }), "thread-1: gate-ctx must be one of thread@1, reply@1, findings@1, carryover@1, skipped@1"],
  ["missing readiness", REVIEW, (s) => delete s.context.readiness, "gate: readiness: yes|no|with-fixes"],
  ["spaced readiness", REVIEW, (s) => (s.context.readiness = "with fixes"), "gate: readiness: yes|no|with-fixes"],
  ["missing summary", REVIEW, (s) => delete s.context.summary, "gate: summary: required non-empty string"],
  ["a count as a string", REVIEW, (s) => (s.context.findings.minor = "3"), "gate: findings.minor: integer when present"],
  ["prior missing still_open", REVIEW, (s) => (s.context.prior = { addressed: 3 }), "gate: prior: {addressed, still_open} integers when present"],
  ["re_review as a string", REVIEW, (s) => (s.context.re_review = "yes"), "gate: re_review: boolean when present"],
  ["round below 1", REVIEW, (s) => (s.context.round = 0), "gate: round: integer of at least 1 when present"],
  ["entry without a body", REVIEW, (s) => delete s.questions[0].context.findings[1].body, "findings-1: findings[1].body: required non-empty string"],
  ["report-cased severity", REVIEW, (s) => (s.questions[0].context.findings[0].severity = "Critical"), "findings-1: findings[0].severity: critical|important|minor"],
  ["disposition outside the enum", REVIEW, (s) => (s.questions[0].context.findings[2].disposition = "open"), "findings-1: findings[2].disposition: new|still-open|addressed-check"],
  ["null evidence", REVIEW, (s) => (s.questions[0].context.findings[0].evidence = null), "findings-1: findings[0].evidence: non-empty string when present"],
  ["an option with no entry", REVIEW, (s) => s.questions[0].options.push({ value: "f7", label: "[Minor] extra" }), "findings-1: option f7: no findings entry carries its value"],
  [
    "an entry with no option",
    REVIEW,
    (s) => s.questions[1].context.findings.push({ ...s.questions[1].context.findings[0], id: "f8" }),
    "findings-2: findings[1].id: matches no option value of this question",
  ],
  [
    "a duplicated entry id",
    REVIEW,
    (s) => {
      s.questions[0].context.findings[3].id = "f1";
      s.questions[0].options[3].value = "f1";
    },
    "findings-1: findings: id f1 appears more than once",
  ],
  ["findings shape at gate level", REVIEW, (s) => (s.context["gate-ctx"] = "findings@1"), "gate: gate-ctx must be one of plan@1, post@1, review@1, boards@1"],
  ["review shape on a question", REVIEW, (s) => (s.questions[0].context["gate-ctx"] = "review@1"), "findings-1: gate-ctx must be one of thread@1, reply@1, findings@1, carryover@1, skipped@1"],
  [
    "a skipped entry with no restore option",
    REVIEW,
    (s) => s.questions.push(skippedQuestion([skipF3, skipF5], ["restore:r1-f5"])),
    "skipped-1: skipped[0].id: matches no option value of this question",
  ],
  [
    "a repeated skipped id",
    REVIEW,
    (s) => s.questions.push(skippedQuestion([skipF3, { ...skipF3 }], ["restore:r1-f3", "restore:r1-f3"])),
    "skipped-1: skipped: id r1-f3 appears more than once",
  ],
];

describe("checkSource rejects what gate-ctx.sh rejects", () => {
  for (const [name, fixture, mutate, line] of rejects) {
    test(name, () => {
      expect(checkSource(mutated(fixture, mutate))).toEqual({ ok: false, problems: [line] });
    });
  }
});

describe("checkSource accepts", () => {
  for (const fixture of [PLAN, POST, REVIEW]) {
    test(`the ${fixture} fixture`, () => expect(checkSource(load(fixture))).toEqual({ ok: true }));
  }
  test("unknown keys pass through", () => {
    const s = mutated(PLAN, (s) => {
      s.questions[0].context.extra = { x: 1 };
      s.context.future = "later";
    });
    expect(checkSource(s)).toEqual({ ok: true });
  });
  test("reply.kind none needs no text", () => {
    expect(checkSource(mutated(PLAN, (s) => (s.questions[0].context.reply = { kind: "none" })))).toEqual({ ok: true });
  });
});

describe("error emission", () => {
  test("a missing threads object fails the checks that need it; null has no keys", () => {
    expect(ctxErrors(mutated(PLAN, (s) => delete s.context.threads))).toEqual([
      "gate: threads: required object",
      "gate: threads.total: required integer",
    ]);
  });
  test("a string threads fails every check that reads it, in order", () => {
    expect(ctxErrors(mutated(PLAN, (s) => (s.context.threads = "x")))).toEqual([
      "gate: threads: required object",
      "gate: threads.total: required integer",
      "gate: threads.blocking: integer when present",
    ]);
  });
  test("a non-object source is not a JSON object", () => {
    expect(checkSource([])).toEqual({ ok: false, problems: ["source is not a JSON object"] });
    expect(checkSource("x")).toEqual({ ok: false, problems: ["source is not a JSON object"] });
  });
  test("a non-object question throws where jq fails", () => {
    expect(() => ctxErrors({ questions: ["q"] })).toThrow(JqError);
    expect(checkSource({ questions: [1] })).toEqual({ ok: false, problems: ["source is not a JSON object"] });
    expect(checkSource({ questions: [null] })).toEqual({ ok: true });
  });
  test("questions must be an array", () => {
    expect(ctxErrors({ questions: {} })).toEqual(["questions: required array"]);
  });
});
