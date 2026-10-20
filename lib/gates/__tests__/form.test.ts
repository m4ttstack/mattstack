import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { GateQuestion } from "../../../packages/rt-client/src/commands.ts";
import { BOARD_ONLY_FIELDS, proseContext } from "../ctx.ts";
import {
  DESCRIPTION_CAP_BYTES,
  LABEL_CAP_BYTES,
  dropContextsToFit,
  flattenContext,
  formChunks,
  paneActionFor,
  truncateOptionText,
} from "../form.ts";
import { utf8Bytes } from "../jq.ts";

const q = (id: string, over: Partial<GateQuestion> = {}): GateQuestion => ({
  id,
  label: `Q ${id}`,
  multi: false,
  options: ["a", "b"],
  ...over,
});

const THREAD = {
  "gate-ctx": "thread@1",
  author: "ann",
  severity: "blocking",
  claim: { summary: "rename it" },
  verdict: { call: "valid" },
  reply: { kind: "direction", text: "rename to fooBar" },
};

describe("truncateOptionText", () => {
  test("cuts a long label, keeps the value, names the option", () => {
    const label = "x".repeat(260);
    const r = truncateOptionText([q("q1", { options: [{ value: "keep", label }] })]);
    const o = r.questions[0]!.options[0] as { value: string; label: string };
    expect(utf8Bytes(o.label)).toBeLessThanOrEqual(LABEL_CAP_BYTES);
    expect(o.value).toBe("keep");
    expect(r.truncated).toEqual([{ question: "q1", value: "keep", field: "label" }]);
  });

  test("never splits a codepoint", () => {
    const r = truncateOptionText([q("q1", { options: [{ value: "v", label: "é".repeat(101) }] })]);
    const o = r.questions[0]!.options[0] as { label: string };
    expect(utf8Bytes(o.label)).toBeLessThanOrEqual(LABEL_CAP_BYTES);
    expect(o.label).not.toContain("�");
  });

  test("ends a long description with an ellipsis within the cap", () => {
    const r = truncateOptionText([q("q1", { options: [{ value: "v", label: "L", description: "d".repeat(1100) }] })]);
    const o = r.questions[0]!.options[0] as { description: string };
    expect(o.description.endsWith("…")).toBe(true);
    expect(utf8Bytes(o.description)).toBeLessThanOrEqual(DESCRIPTION_CAP_BYTES);
    expect(r.truncated).toEqual([{ question: "q1", value: "v", field: "description" }]);
  });

  test("leaves bare strings and short options alone, and does not mutate the input", () => {
    const input = [q("q1", { options: ["x".repeat(500), { value: "v", label: "short" }] })];
    const before = structuredClone(input);
    const r = truncateOptionText(input);
    expect(r.questions).toEqual(before);
    expect(r.truncated).toEqual([]);
    expect(input).toEqual(before);
  });
});

describe("flattenContext", () => {
  test("flattens a valid structured question context", () => {
    expect(flattenContext(JSON.stringify(THREAD), { level: "question", values: ["a"] })).toBe(proseContext(THREAD));
  });

  test("keeps an invalid structured context and plain text raw", () => {
    const bad = JSON.stringify({ "gate-ctx": "thread@1" });
    expect(flattenContext(bad, { level: "question", values: [] })).toBe(bad);
    expect(flattenContext("just words", { level: "gate" })).toBe("just words");
    expect(flattenContext("[1]", { level: "gate" })).toBe("[1]");
    expect(flattenContext(undefined, { level: "gate" })).toBeUndefined();
  });

  describe("with a board-only field", () => {
    const FINDINGS = {
      "gate-ctx": "findings@1",
      findings: [{ id: "f1", severity: "minor", title: "a typo", body: "the word is misspelt", fix: "spell it right" }],
    };
    beforeEach(() => {
      BOARD_ONLY_FIELDS["findings@1"] = ["fix"];
    });
    afterEach(() => {
      delete BOARD_ONLY_FIELDS["findings@1"];
    });

    test("the prose omits it", () => {
      const prose = flattenContext(JSON.stringify(FINDINGS), { level: "question", values: ["f1"] })!;
      expect(prose).toBe("[MINOR] a typo\nthe word is misspelt");
    });

    test("a context kept raw omits it too", () => {
      const raw = flattenContext(JSON.stringify(FINDINGS), { level: "question", values: [] })!;
      expect(raw).not.toContain("spell it right");
      expect(JSON.parse(raw).findings[0].title).toBe("a typo");
    });

    test("form chunks omit it", () => {
      const first = formChunks([q("q1", { context: JSON.stringify(FINDINGS), options: ["f1"] })])[0]![0]!;
      expect(first.text).not.toContain("spell it right");
    });
  });

  test("a gate-level call refuses a question-level shape", () => {
    const s = JSON.stringify(THREAD);
    expect(flattenContext(s, { level: "gate" })).toBe(s);
  });
});

describe("formChunks", () => {
  test("chunks nine questions as 4, 4, 1 in gate order", () => {
    const qs = Array.from({ length: 9 }, (_, i) => q(`q${i}`));
    const chunks = formChunks(qs);
    expect(chunks.map((c) => c.length)).toEqual([4, 4, 1]);
    expect(chunks.flat().map((x) => x.id)).toEqual(qs.map((x) => x.id));
  });

  test("appends the prose of a valid structured context", () => {
    const first = formChunks([q("q1", { context: JSON.stringify(THREAD) })])[0]![0]!;
    expect(first.text).toBe(`Q q1\n${proseContext(THREAD)}`);
  });

  test("keeps an invalid structured context raw", () => {
    const bad = JSON.stringify({ "gate-ctx": "thread@1" });
    const first = formChunks([q("q1", { context: bad })])[0]![0]!;
    expect(first.text).toBe(`Q q1\n${bad}`);
  });

  test("prefers a supplied prose over the question context", () => {
    const first = formChunks([q("q1", { context: "raw" })], { q1: "given prose" })[0]![0]!;
    expect(first.text).toBe("Q q1\ngiven prose");
  });

  test("text is the bare label without a context, and options are normalized", () => {
    const first = formChunks([q("q1", { options: [{ value: "x", label: "fix", recommended: true } as never] })])[0]![0]!;
    expect(first.text).toBe("Q q1");
    expect(first.options).toEqual([{ value: "x", label: "Fix (Recommended)" }]);
  });
});

describe("paneActionFor", () => {
  test("covers each attendance case", () => {
    expect(paneActionFor("form", { herdr: true, spawned: true })).toBe("form");
    expect(paneActionFor("wait", { herdr: true, spawned: false })).toBe("wait");
    expect(paneActionFor("wait", { herdr: false, spawned: true })).toBe("wait");
    expect(paneActionFor("wait", { herdr: false, spawned: false })).toBe("form");
  });
});

describe("dropContextsToFit", () => {
  test("drops the largest question context first and reports ids in order", () => {
    const open = {
      context: "g".repeat(10),
      questions: [q("a", { context: "a".repeat(100) }), q("b", { context: "b".repeat(300) }), q("c", { context: "c".repeat(200) })],
    };
    const r = dropContextsToFit(open, 400);
    expect(r.dropped).toEqual(["b"]);
    expect(r.open.questions.map((x) => x.context?.length)).toEqual([100, undefined, 200]);
    expect(r.open.context).toBe("g".repeat(10));
    const r2 = dropContextsToFit(open, 150);
    expect(r2.dropped).toEqual(["b", "c"]);
    expect(open.questions[1]!.context).toHaveLength(300);
  });

  test("breaks size ties by position", () => {
    const open = { questions: [q("a", { context: "x".repeat(50) }), q("b", { context: "y".repeat(50) })] };
    expect(dropContextsToFit(open, 80).dropped).toEqual(["a"]);
  });

  test("an oversized gate context drops every question context, then itself", () => {
    const open = { context: "g".repeat(500), questions: [q("a", { context: "a".repeat(10) }), q("b")] };
    const r = dropContextsToFit(open, 100);
    expect(r.dropped).toEqual(["a"]);
    expect(r.open.context).toBeUndefined();
    expect(r.open.questions.every((x) => x.context === undefined)).toBe(true);
  });

  test("changes nothing when the total already fits", () => {
    const open = { context: "g", questions: [q("a", { context: "a" })] };
    const r = dropContextsToFit(open, 100);
    expect(r.dropped).toEqual([]);
    expect(r.open).toEqual(open);
  });
});
