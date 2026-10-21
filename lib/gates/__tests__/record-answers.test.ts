import { describe, expect, test } from "bun:test";
import {
  type DecisionRow,
  actOnWriteIn,
  answerValue,
  decisionForGate,
  nextOf,
  normalizeAnswers,
  skipReason,
  splitVerb,
  writeInsOf,
} from "../record.ts";

describe("normalizeAnswers", () => {
  test("collapses an object with no note or text to the bare value", () => {
    expect(normalizeAnswers({ q: { value: "a" } })).toEqual({ q: "a" });
    expect(normalizeAnswers({ q: { value: "a", note: "" } })).toEqual({ q: "a" });
  });
  test("keeps a non-empty note, dropping empty keys", () => {
    expect(normalizeAnswers({ q: { value: ["a"], note: "n" } })).toEqual({ q: { value: ["a"], note: "n" } });
    expect(normalizeAnswers({ q: { value: "a", note: "n", text: "" } })).toEqual({ q: { value: "a", note: "n" } });
  });
  test("keeps texts and does not collapse a texts-only wrapper", () => {
    expect(normalizeAnswers({ q: { value: ["a", "b"], texts: { a: "E" } } })).toEqual({ q: { value: ["a", "b"], texts: { a: "E" } } });
  });
  test("leaves write-ins and bare values alone", () => {
    expect(normalizeAnswers({ q: { writeIn: "w" }, r: "x", s: ["y"] })).toEqual({ q: { writeIn: "w" }, r: "x", s: ["y"] });
  });
});

describe("answerValue and splitVerb", () => {
  test("answerValue unwraps objects and is undefined for a write-in", () => {
    expect(answerValue("a")).toBe("a");
    expect(answerValue({ value: ["a"], note: "n" })).toEqual(["a"]);
    expect(answerValue({ writeIn: "w" })).toBeUndefined();
  });
  test("splitVerb splits at the first colon", () => {
    expect(splitVerb("reply:a:b")).toEqual({ verb: "reply", id: "a:b" });
    expect(splitVerb("skip")).toEqual({ verb: "skip", id: "" });
  });
});

describe("write-ins", () => {
  test("writeInsOf and nextOf", () => {
    expect(writeInsOf({ tier: { writeIn: "x" }, next: "hold" })).toEqual([{ question: "tier", text: "x" }]);
    expect(nextOf({ next: { value: "hold", note: "n" } })).toBe("hold");
    expect(nextOf({ tier: "a" })).toBeNull();
  });
  test("actOnWriteIn follows next", () => {
    expect(actOnWriteIn({ tier: { writeIn: "x" }, next: "proceed" })).toBe(true);
    expect(actOnWriteIn({ tier: { writeIn: "x" } })).toBe(true);
    expect(actOnWriteIn({ tier: { writeIn: "x" }, next: "hold" })).toBe(false);
    expect(actOnWriteIn({ tier: { writeIn: "x" }, next: "iterate here" })).toBe(true);
    expect(actOnWriteIn({ tier: "a" })).toBe(false);
  });
});

describe("decisionForGate", () => {
  const row = (scope: string, decided_at: number, contract = "gate@1"): DecisionRow => ({
    contract, scope, selection: "s", decided_by: "me", decided_at,
  });
  test("ignores a row 1 ms before since, other scopes and other contracts", () => {
    expect(decisionForGate([row("a", 99)], "a", 100)).toBeNull();
    expect(decisionForGate([row("b", 200)], "a", 100)).toBeNull();
    expect(decisionForGate([row("a", 200, "other@1")], "a", 100)).toBeNull();
  });
  test("accepts decided_at equal to since", () => {
    expect(decisionForGate([row("a", 99), row("a", 100)], "a", 100)?.decided_at).toBe(100);
  });
});

describe("skipReason", () => {
  test("answers never skips", () => {
    expect(skipReason("answers", { next: "hold" })).toBeNull();
  });
  test("other shapes skip on a non-proceed next", () => {
    expect(skipReason("post", { next: "iterate" })).toBe("next is iterate: post decides nothing");
    expect(skipReason("respond-plan", { next: "proceed" })).toBeNull();
    expect(skipReason("respond-post", {})).toBeNull();
  });
});
