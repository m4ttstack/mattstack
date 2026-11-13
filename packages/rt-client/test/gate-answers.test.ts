import { describe, expect, test } from "bun:test";
import { RUN_CONTROL_NEXT, isRunControl, isWriteIn, unwrapGateAnswerValue, validateGateAnswers } from "../src/gate-answers.ts";
import type { GateQuestion } from "../src/commands.ts";

const single: GateQuestion = { id: "verdict", label: "v", multi: false, options: ["yes", { value: "no", label: "No" }] };
const multi: GateQuestion = { id: "tiers", label: "t", multi: true, options: ["a", "b"] };
const freeform: GateQuestion = { id: "note", label: "n", multi: false, options: [] };

describe("unwrapGateAnswerValue", () => {
  test("bare values pass through", () => expect(unwrapGateAnswerValue("yes")).toBe("yes"));
  test("note form unwraps", () => expect(unwrapGateAnswerValue({ value: "yes", note: "x" })).toBe("yes"));
  test("arrays pass through", () => expect(unwrapGateAnswerValue(["a"])).toEqual(["a"]));
  test("text form unwraps", () => expect(unwrapGateAnswerValue({ value: ["a"], text: "x" })).toEqual(["a"]));
});

describe("validateGateAnswers", () => {
  test("valid single + multi + freeform", () => {
    expect(validateGateAnswers([single, multi, freeform], { verdict: "no", tiers: ["a"], note: "anything" })).toBeNull();
  });
  test("unknown question id", () => {
    expect(validateGateAnswers([single], { verdict: "yes", extra: "x" })).toBe("unknown question id: extra");
  });
  test("multi expects array", () => {
    expect(validateGateAnswers([multi], { tiers: "a" })).toBe("question tiers expects an array (multi)");
  });
  test("single rejects array", () => {
    expect(validateGateAnswers([single], { verdict: ["yes"] })).toBe("question verdict expects a single value");
  });
  test("non-string element", () => {
    expect(validateGateAnswers([multi], { tiers: [1] })).toBe("question tiers value must be a string");
  });
  test("membership by value, labels never match", () => {
    expect(validateGateAnswers([single], { verdict: "No" })).toBe('answer for "verdict" is not one of its options: "No"');
  });
  test("empty options = free-form", () => {
    expect(validateGateAnswers([freeform], { note: "whatever" })).toBeNull();
  });
  test("missing answers named", () => {
    expect(validateGateAnswers([single, multi], { verdict: "yes" })).toBe("missing answer(s) for: tiers");
  });
  test("explicit empty multi array is valid", () => {
    expect(validateGateAnswers([multi], { tiers: [] })).toBeNull();
  });
  test("note-form values validate by inner value", () => {
    expect(validateGateAnswers([single], { verdict: { value: "yes", note: "hold on" } })).toBeNull();
  });
  test("text-form values validate by inner value", () => {
    expect(validateGateAnswers([multi], { tiers: { value: ["a"], text: "edited reply" } })).toBeNull();
  });
  test("texts map keyed by chosen ids validates", () => {
    expect(validateGateAnswers([multi], { tiers: { value: ["a", "b"], texts: { a: "Edited" } } })).toBeNull();
  });
  test("texts key outside value is refused", () => {
    expect(validateGateAnswers([multi], { tiers: { value: ["a"], texts: { b: "x" } } })).toBe("question tiers texts key must be one of its values: b");
  });
  test("blank texts entry is refused", () => {
    expect(validateGateAnswers([multi], { tiers: { value: ["a"], texts: { a: "  " } } })).toBe("question tiers texts must be non-empty strings");
  });
  test("texts on a single value is refused", () => {
    expect(validateGateAnswers([single], { verdict: { value: "yes", texts: { yes: "x" } } })).toBe("question verdict texts needs an array value");
  });
  test("texts must be an object", () => {
    expect(validateGateAnswers([multi], { tiers: { value: ["a"], texts: ["a"] } })).toBe("question tiers texts must be an object");
  });
  test("text rides beside a note", () => {
    expect(validateGateAnswers([single], { verdict: { value: "yes", note: "n", text: "t" } })).toBeNull();
  });
  test("non-string text", () => {
    expect(validateGateAnswers([single], { verdict: { value: "yes", text: 5 } })).toBe("question verdict text must be a string");
  });
  test("whitespace-only text is empty", () => {
    expect(validateGateAnswers([single], { verdict: { value: "yes", text: "  \n" } })).toBe("question verdict text must not be empty");
  });
  test("wrapper field errors win over value errors", () => {
    expect(validateGateAnswers([single], { verdict: { value: "bogus", text: " " } })).toBe("question verdict text must not be empty");
  });
  test("note is checked before text", () => {
    expect(validateGateAnswers([single], { verdict: { value: "yes", note: 5, text: 5 } })).toBe("question verdict note must be a string");
  });
});

const open: GateQuestion = { id: "approach", label: "a", multi: false, options: ["x", "y"], writeIn: true };
const openMulti: GateQuestion = { id: "picks", label: "p", multi: true, options: ["a", "b"], writeIn: true };

describe("write-ins", () => {
  test("isWriteIn spots the shape and nothing else", () => {
    expect(isWriteIn({ writeIn: "do z" })).toBe(true);
    expect(isWriteIn({ value: "x" })).toBe(false);
    expect(isWriteIn("x")).toBe(false);
    expect(isWriteIn(["x"])).toBe(false);
  });
  test("unwrapGateAnswerValue gives undefined for a write-in", () => {
    expect(unwrapGateAnswerValue({ writeIn: "do z" })).toBeUndefined();
  });
  test("accepted on a writeIn single-select and multi", () => {
    expect(validateGateAnswers([open, openMulti], { approach: { writeIn: "do z" }, picks: { writeIn: "neither" } })).toBeNull();
  });
  test("refused on a question without the attribute", () => {
    expect(validateGateAnswers([single], { verdict: { writeIn: "maybe" } })).toBe("question verdict does not accept a write-in");
  });
  test("refused beside value, note or text", () => {
    const alone = "question approach writeIn replaces value, note and text; send it alone";
    expect(validateGateAnswers([open], { approach: { writeIn: "z", value: "x" } })).toBe(alone);
    expect(validateGateAnswers([open], { approach: { writeIn: "z", note: "n" } })).toBe(alone);
    expect(validateGateAnswers([open], { approach: { writeIn: "z", text: "t" } })).toBe(alone);
  });
  test("refused when empty, whitespace or not a string", () => {
    const empty = "question approach writeIn must be a non-empty string";
    expect(validateGateAnswers([open], { approach: { writeIn: "" } })).toBe(empty);
    expect(validateGateAnswers([open], { approach: { writeIn: "   " } })).toBe(empty);
    expect(validateGateAnswers([open], { approach: { writeIn: 3 } })).toBe(empty);
  });
  test("a writeIn question still takes an ordinary pick", () => {
    expect(validateGateAnswers([open], { approach: "x" })).toBeNull();
    expect(validateGateAnswers([open], { approach: "nope" })).toBe('answer for "approach" is not one of its options: "nope"');
  });
});

describe("reserved run-control answers", () => {
  const tier: GateQuestion = { id: "tier", label: "t", multi: false, options: ["light", "full"] };
  const ownNext: GateQuestion = { id: "next", label: "n", multi: false, options: ["ship", "wait"] };

  test("next: hold skips the missing-answers check on a gate with no next question", () => {
    expect(validateGateAnswers([single, multi], { next: "hold" })).toBeNull();
  });
  test("a wrapped hold with a note is accepted", () => {
    expect(validateGateAnswers([single], { next: { value: "hold", note: "lunch" } })).toBeNull();
  });
  test("go-back with a stage is accepted", () => {
    expect(validateGateAnswers([single], { next: "go-back", to: "plan" })).toBeNull();
  });
  test("to alone is refused", () => {
    expect(validateGateAnswers([single], { to: "plan" })).toBe("to is allowed only with next: go-back");
  });
  test("to beside hold is refused", () => {
    expect(validateGateAnswers([single], { next: "hold", to: "plan" })).toBe("to is allowed only with next: go-back");
  });
  test("an unknown next value is refused", () => {
    expect(validateGateAnswers([single], { next: "abandon" })).toBe("next must be hold or go-back");
  });
  test("what is answered beside a run control is still checked", () => {
    expect(validateGateAnswers([tier], { next: "hold", tier: "heavy" })).toBe('answer for "tier" is not one of its options: "heavy"');
    expect(validateGateAnswers([tier], { next: "hold", tier: "light" })).toBeNull();
    expect(validateGateAnswers([tier], { next: "hold", extra: "x" })).toBe("unknown question id: extra");
  });
  test("a gate that asks its own next question keeps option membership", () => {
    expect(validateGateAnswers([ownNext], { next: "hold" })).toBe('answer for "next" is not one of its options: "hold"');
    expect(validateGateAnswers([ownNext], { next: "ship" })).toBeNull();
    expect(validateGateAnswers([ownNext, tier], { next: "ship" })).toBe("missing answer(s) for: tier");
  });
  test("RUN_CONTROL_NEXT names the two reserved values", () => {
    expect([...RUN_CONTROL_NEXT]).toEqual(["hold", "go-back"]);
  });
  test("isRunControl is true only for a reserved next on a gate without its own next question", () => {
    expect(isRunControl([single], { next: "hold" })).toBe(true);
    expect(isRunControl([single], { next: { value: "go-back", note: "x" }, to: "plan" })).toBe(true);
    expect(isRunControl([single], { next: "abandon" })).toBe(false);
    expect(isRunControl([single], { verdict: "yes" })).toBe(false);
    expect(isRunControl([ownNext], { next: "hold" })).toBe(false);
  });
});
