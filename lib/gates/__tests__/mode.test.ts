import { describe, expect, test } from "bun:test";
import type { GateOption, GateQuestion } from "../../../packages/rt-client/src/commands.ts";
import { validateGateAnswers } from "../../../packages/rt-client/src/gate-answers.ts";
import type { DecisionRow } from "../record.ts";
import {
  autoAnswerDecision,
  digestSince,
  effectiveMode,
  modeDigest,
  recommendedValues,
} from "../mode.ts";

const q = (id: string, options: GateOption[], multi = false): GateQuestion => ({ id, label: id, multi, options });
const tier = q("tier", [
  { value: "direct-tdd", label: "direct-tdd (Recommended)" },
  { value: "superpowers", label: "Superpowers" },
]);
const next = (rec: string) => q("next", [{ value: rec, label: `${rec} (Recommended)` }, { value: "hold", label: "hold" }]);
const base = { mode: "quiet" as const, pipeline: "feature", reach: "worktree" as const };
const row = (contract: string, scope: string, selection: unknown, decided_by: string, decided_at: number): DecisionRow => ({
  contract,
  scope,
  selection: JSON.stringify(selection),
  decided_by,
  decided_at,
});

describe("autoAnswerDecision", () => {
  test("chatty never answers", () => {
    expect(autoAnswerDecision({ ...base, mode: "chatty", questions: [tier] }).kind).toBe("ask");
  });
  test("quiet answers a worktree gate", () => {
    expect(autoAnswerDecision({ ...base, questions: [tier, next("proceed")] })).toEqual({
      kind: "answer",
      answers: { tier: "direct-tdd", next: "proceed" },
    });
  });
  test("lowercase suffix counts", () => {
    expect(recommendedValues(q("a", [{ value: "post", label: "Post reply (recommended)" }]))).toEqual(["post"]);
  });
  test("recommended flag counts", () => {
    expect(recommendedValues(q("a", [{ value: "x", label: "x", recommended: true }]))).toEqual(["x"]);
  });
  test("quiet asks on teammates reach", () => {
    expect(autoAnswerDecision({ ...base, reach: "teammates", questions: [tier] }).kind).toBe("ask");
  });
  test("public never answers in yolo", () => {
    expect(autoAnswerDecision({ ...base, mode: "yolo", reach: "public", questions: [tier] }).kind).toBe("ask");
  });
  test("undeclared reach asks", () => {
    expect(autoAnswerDecision({ ...base, reach: null, questions: [tier] }).kind).toBe("ask");
  });
  test("one question without a recommendation asks", () => {
    expect(autoAnswerDecision({ ...base, questions: [tier, q("b", ["x", "y"])] }).kind).toBe("ask");
  });
  test("hand-back recommendation asks", () => {
    for (const v of ["handback", "abandon", "iterate", "go-back", "hold"]) {
      expect(autoAnswerDecision({ ...base, questions: [q("a", [{ value: v, label: "x", recommended: true }])] }).kind).toBe("ask");
    }
  });
  test("a stop verb behind the suffix or in another case asks", () => {
    expect(autoAnswerDecision({ ...base, questions: [q("a", ["hold (Recommended)", "proceed"])] }).kind).toBe("ask");
    expect(autoAnswerDecision({ ...base, questions: [q("a", ["abandon (Recommended)", "proceed"])] }).kind).toBe("ask");
    expect(autoAnswerDecision({ ...base, questions: [q("a", [{ value: "Hold", label: "x", recommended: true }])] }).kind).toBe("ask");
  });
  test("a suffixed string next answers with the raw value", () => {
    expect(autoAnswerDecision({ ...base, questions: [q("next", ["proceed (Recommended)", "hold"])] })).toEqual({
      kind: "answer",
      answers: { next: "proceed (Recommended)" },
    });
  });
  test("two recommendations on a single-select ask", () => {
    const two = q("a", [{ value: "x", label: "x", recommended: true }, { value: "y", label: "y", recommended: true }]);
    expect(autoAnswerDecision({ ...base, questions: [two] }).kind).toBe("ask");
  });
  test("a stop verb before a colon asks", () => {
    expect(autoAnswerDecision({ ...base, questions: [q("a", [{ value: "iterate: more", label: "x", recommended: true }])] }).kind).toBe("ask");
  });
  test("a gate with no next question answers", () => {
    const r = autoAnswerDecision({ ...base, questions: [tier] });
    expect(r.kind).toBe("answer");
    if (r.kind === "answer") expect("next" in r.answers).toBe(false);
  });
  test("a next question, when present, must recommend proceed or done", () => {
    expect(autoAnswerDecision({ ...base, questions: [tier, next("iterate")] }).kind).toBe("ask");
    expect(autoAnswerDecision({ ...base, questions: [tier, next("done")] }).kind).toBe("answer");
  });
  test("string options are read", () => {
    expect(autoAnswerDecision({ ...base, questions: [q("next", ["proceed", "hold"])] }).kind).toBe("ask");
    expect(recommendedValues(q("n", ["proceed", "hold"]))).toEqual([]);
    expect(recommendedValues(q("n", ["proceed (Recommended)", "hold"]))).toEqual(["proceed (Recommended)"]);
  });
  test("multi-select answers the recommended set", () => {
    const m = q("m", [{ value: "a", label: "a", recommended: true }, { value: "b", label: "b" }, { value: "c", label: "c", recommended: true }], true);
    expect(autoAnswerDecision({ ...base, questions: [m] })).toEqual({ kind: "answer", answers: { m: ["a", "c"] } });
  });
  test("write-in-only question asks", () => {
    const w: GateQuestion = { ...q("w", []), writeIn: true };
    expect(autoAnswerDecision({ ...base, questions: [w] }).kind).toBe("ask");
  });
  test("needsOperator asks", () => {
    const r = autoAnswerDecision({ ...base, needsOperator: "credentials missing", questions: [tier] });
    expect(r.kind === "ask" && r.reason).toContain("credentials missing");
  });
  test("boards context asks", () => {
    expect(autoAnswerDecision({ ...base, context: "see boards@1 row", questions: [tier] }).kind).toBe("ask");
  });
  test("review pipeline asks", () => {
    expect(autoAnswerDecision({ ...base, pipeline: "review", questions: [tier] }).kind).toBe("ask");
  });
  test("receive-review and standalone self-review pipelines ask", () => {
    for (const pipeline of ["receive-review", "self-review"]) {
      expect(autoAnswerDecision({ ...base, mode: "yolo", pipeline, questions: [tier] }).kind, pipeline).toBe("ask");
    }
  });
  test("a run whose pipeline cannot be read asks", () => {
    expect(autoAnswerDecision({ ...base, mode: "yolo", pipeline: null, questions: [tier] }).kind).toBe("ask");
  });
  test("a suffixed string answer validates against the daemon's answer check", () => {
    const questions = [q("next", ["proceed (Recommended)", "hold"])];
    const r = autoAnswerDecision({ ...base, questions });
    expect(r.kind).toBe("answer");
    if (r.kind !== "answer") return;
    expect(validateGateAnswers(questions, r.answers)).toBeNull();
  });
});

describe("effectiveMode", () => {
  test("run field beats setting", () => expect(effectiveMode("normal", "quiet")).toBe("normal"));
  test("unknown run field is chatty", () => expect(effectiveMode("quite", "quiet")).toBe("chatty"));
  test("no run field uses setting", () => expect(effectiveMode(undefined, "quiet")).toBe("quiet"));
  test("bad setting is chatty", () => expect(effectiveMode(undefined, 7)).toBe("chatty"));
});

describe("modeDigest", () => {
  const ds = [
    row("gate@1", "plan", { tier: "direct-tdd" }, "mode:quiet", 20),
    row("gate@1", "post", { next: "proceed", m: ["a", "b"] }, "mode:quiet", 30),
    row("gate@1", "pane", { x: "y" }, "pane", 25),
    row("execution-strategy@1", "exec", { s: 1 }, "mode:quiet", 40),
  ];
  test("lists mode decisions after sinceAt", () => {
    expect(modeDigest(ds, 10)).toBe(
      "Decided without you since your last answer:\n- plan: tier=direct-tdd\n- post: next=proceed, m=a|b",
    );
  });
  test("none after sinceAt is null", () => expect(modeDigest(ds, 30)).toBeNull());
});

describe("digestSince", () => {
  test("ignores mode and non-gate decisions", () => {
    const ds = [
      row("gate@1", "a", {}, "pane", 10),
      row("gate@1", "b", {}, "mode:quiet", 50),
      row("execution-strategy@1", "c", {}, "stage-plan", 60),
    ];
    expect(digestSince(ds)).toBe(10);
    expect(digestSince([])).toBe(0);
  });
});
