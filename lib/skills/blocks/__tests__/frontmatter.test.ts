import { expect, test } from "bun:test";
import { BlockError } from "../diagnostics.ts";
import { labelFromId, parseBlockFile } from "../frontmatter.ts";

test("parses props, title, label, markers and positions", () => {
  const raw = `---\nnode: domain_fast_checks\nlabel: Fast checks\nprops:\n  rules: { merge: add, default: "" }\n---\n# Run the domain's fast checks\n\nOnly the checks.\n\n{{props.rules}}\n`;
  const b = parseBlockFile(raw, "flow/fast-checks.block.md", "fast-checks");
  expect(b.title).toBe("Run the domain's fast checks");
  expect(b.label).toBe("Fast checks");
  expect(b.node).toBe("domain_fast_checks");
  expect(b.props).toEqual([{ name: "rules", merge: "add", default: "", contract: null, declaredAt: { line: 5, col: 3 } }]);
  expect(b.markers).toEqual([{ prop: "rules", line: 11, col: 1 }]);
  expect(b.text).toBe("Only the checks.\n\n{{props.rules}}");
});
test("a headless block has title null and label from its id", () => {
  const b = parseBlockFile("---\n---\nJust text.\n", "x/guard.block.md", "guard");
  expect(b.title).toBeNull();
  expect(b.label).toBe("Guard");
  expect(b.text).toBe("Just text.");
  expect(b.bodyStartLine).toBe(3);
});
test("a marker for an undeclared prop is unknown-prop at the marker", () => {
  expect(() => parseBlockFile("# T\n\n{{props.nope}}\n", "t.block.md", "t")).toThrow(/t\.block\.md:3:1: .*"nope"/);
  try {
    parseBlockFile("# T\n\n{{props.nope}}\n", "t.block.md", "t");
  } catch (e) {
    expect((e as BlockError).diagnostics[0]!.code).toBe("unknown-prop");
  }
});
test("merge must be add or replace", () => {
  expect(() => parseBlockFile("---\nprops:\n  x: { merge: both }\n---\n# T\n", "t.block.md", "t")).toThrow(/t\.block\.md:3:3: .*merge/);
});
test("bad scalar fields report bad-value at the field", () => {
  expect(() => parseBlockFile("---\norder: first\n---\n# T\n", "t.block.md", "t")).toThrow(/t\.block\.md:2:8: .*order/);
  expect(() => parseBlockFile("---\nkind: step\n---\n# T\n", "t.block.md", "t")).toThrow(/t\.block\.md:2:7: .*kind/);
  expect(() => parseBlockFile("---\nprops:\n  x: { merge: add, default: 3 }\n---\n# T\n", "t.block.md", "t")).toThrow(/t\.block\.md:3:29:.*default/);
});
test("a frontmatter that is present but not a map is bad-frontmatter at line 2", () => {
  for (const raw of ["---\nnode domain_fast_checks\n---\n# T\n", "---\n- node\n---\n# T\n"]) {
    try {
      parseBlockFile(raw, "t.block.md", "t");
      throw new Error("expected a BlockError");
    } catch (e) {
      expect((e as BlockError).diagnostics).toEqual([expect.objectContaining({ file: "t.block.md", line: 2, col: 1, code: "bad-frontmatter" })]);
    }
  }
});
test("a placeholder in a title is bad-value at the title's {{", () => {
  try {
    parseBlockFile("---\n---\n\n# Eng for {{team.name}}\n\nBody.\n", "t.block.md", "t");
    throw new Error("expected a BlockError");
  } catch (e) {
    expect((e as BlockError).diagnostics).toEqual([expect.objectContaining({ file: "t.block.md", line: 4, col: 11, code: "bad-value" })]);
  }
});
test("other frontmatter keys pass through and kind gate parses", () => {
  const b = parseBlockFile("---\nkind: gate\norder: 2\nreplaced-slots: [a]\n---\n# T\n", "t.block.md", "t");
  expect(b.kind).toBe("gate");
  expect(b.order).toBe(2);
  expect(b.frontmatter["replaced-slots"]).toEqual(["a"]);
});
test("textStartLine points at the first text line in the file", () => {
  const raw = `---\nnode: domain_fast_checks\nlabel: Fast checks\nprops:\n  rules: { merge: add, default: "" }\n---\n# Run the domain's fast checks\n\nOnly the checks.\n\n{{props.rules}}\n`;
  expect(parseBlockFile(raw, "f.block.md", "f").textStartLine).toBe(9);
  expect(parseBlockFile("---\n---\nJust text.\n", "g.block.md", "g").textStartLine).toBe(3);
  expect(parseBlockFile("# T\n", "h.block.md", "h").textStartLine).toBe(2);
});
test("malformed props markers are bad-marker at their position", () => {
  for (const m of ["{{props.a.b}}", "{{props.x:arg}}", "{{props.}}", "{{props.Up}}", "{{props.a_b}}"]) {
    try {
      parseBlockFile(`# T\n\nsee ${m}\n`, "t.block.md", "t");
      throw new Error("no throw");
    } catch (e) {
      const d = (e as BlockError).diagnostics[0]!;
      expect(d.code).toBe("bad-marker");
      expect([d.line, d.col]).toEqual([3, 5]);
    }
  }
});
test("a declared prop name outside the grammar is bad-value", () => {
  expect(() => parseBlockFile("---\nprops:\n  Bad_Name: { merge: add }\n---\n# T\n", "t.block.md", "t")).toThrow(/t\.block\.md:3:3: .*Bad_Name/);
});
test("marker col counts leading spaces on an indented first body line", () => {
  const raw = "---\nprops:\n  x: { merge: add }\n---\n\n    {{props.x}}\n";
  expect(parseBlockFile(raw, "t.block.md", "t").markers).toEqual([{ prop: "x", line: 6, col: 5 }]);
  expect(() => parseBlockFile("\n    {{props.nope}}\n", "t.block.md", "t")).toThrow(/t\.block\.md:2:5:/);
});
test("labelFromId",() => { expect(labelFromId("resume-offer")).toBe("Resume offer"); });
