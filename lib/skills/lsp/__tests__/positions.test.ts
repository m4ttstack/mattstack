import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rangeOf, tokenAt, tokensIn } from "../positions.ts";

const FIXTURES = join(import.meta.dir, "../../__tests__/fixtures/blocks");
const MINI = join(FIXTURES, "plugins/mattstack/attachments/pipeline/mini");
const INDEX = readFileSync(join(MINI, "index.block.md"), "utf8");
const GATE = readFileSync(join(MINI, "gate.block.md"), "utf8");
const MANIFEST = readFileSync(join(FIXTURES, "pack/pack/skills.jsonc"), "utf8");

const at = (text: string, needle: string, offset = 0) => {
  const lines = text.split("\n");
  const line = lines.findIndex((l) => l.includes(needle));
  return { line, character: lines[line]!.indexOf(needle) + offset };
};

describe("rangeOf", () => {
  test("a diagnostic at a marker's {{ spans the whole marker", () => {
    const start = at(INDEX, "{{props.rules}}");
    const d = { file: "index.block.md", line: start.line + 1, col: start.character + 1, message: "m", code: "unknown-prop" };
    expect(rangeOf(d, INDEX)).toEqual({ start, end: { line: start.line, character: start.character + "{{props.rules}}".length } });
  });

  test("a diagnostic at a YAML key spans the key", () => {
    const start = at(GATE, "tiering:");
    const d = { file: "gate.block.md", line: start.line + 1, col: start.character + 1, message: "m", code: "unknown-prop" };
    expect(rangeOf(d, GATE).end).toEqual({ line: start.line, character: start.character + "tiering".length });
  });

  test("a diagnostic at a JSON string spans the quoted string", () => {
    const start = at(MANIFEST, '"mattstack:mini/gate"');
    const d = { file: "skills.jsonc", line: start.line + 1, col: start.character + 1, message: "m", code: "missing-block" };
    expect(rangeOf(d, MANIFEST).end).toEqual({ line: start.line, character: start.character + '"mattstack:mini/gate"'.length });
  });

  test("a diagnostic with no token starting there spans to the end of its line", () => {
    const d = { file: "index.block.md", line: 1, col: 1, message: "m", code: "bad-frontmatter" };
    expect(rangeOf(d, INDEX)).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 3 } });
  });
});

describe("tokenAt in a block file", () => {
  test("inside {{props.rules}} gives a marker", () => {
    const tok = tokenAt(INDEX, "mini/index.block.md", at(INDEX, "{{props.rules}}", 5));
    expect(tok).toEqual({ kind: "marker", prop: "rules", range: { start: at(INDEX, "{{props.rules}}"), end: at(INDEX, "{{props.rules}}", 15) } });
  });

  test("on rules: under props: gives a prop-decl", () => {
    const tok = tokenAt(INDEX, "mini/index.block.md", at(INDEX, "rules:", 2));
    expect(tok).toEqual({ kind: "prop-decl", prop: "rules", range: { start: at(INDEX, "rules:"), end: at(INDEX, "rules:", 5) } });
  });

  test("a key nested inside a prop is not a prop-decl", () => {
    expect(tokenAt(INDEX, "mini/index.block.md", at(INDEX, "merge:", 1))).toBeNull();
  });

  test("on the node: value gives a node-decl", () => {
    expect(tokenAt(GATE, "mini/gate.block.md", at(GATE, "ask_gate", 3))).toMatchObject({ kind: "node-decl", node: "ask_gate" });
  });

  test("a node id inside a mermaid fence gives a node-decl", () => {
    const line = INDEX.split("\n").findIndex((l) => l.includes("start -->"));
    const character = INDEX.split("\n")[line]!.indexOf("ask_gate") + 2;
    expect(tokenAt(INDEX, "mini/index.block.md", { line, character })).toMatchObject({ kind: "node-decl", node: "ask_gate" });
  });

  test("a mermaid label and class are not node ids", () => {
    const line = INDEX.split("\n").findIndex((l) => l.includes("finish(((Finished)))"));
    const row = INDEX.split("\n")[line]!;
    expect(tokenAt(INDEX, "mini/index.block.md", { line, character: row.indexOf("Finished") + 1 })).toBeNull();
    expect(tokenAt(INDEX, "mini/index.block.md", { line, character: row.indexOf("done") + 1 })).toBeNull();
    expect(tokenAt(INDEX, "mini/index.block.md", { line, character: row.indexOf("finish") + 1 })).toMatchObject({ kind: "node-decl", node: "finish" });
  });

  test("an include marker gives an include", () => {
    const text = "# a\n\n{{include:widgets:mini-rules}}\n";
    expect(tokenAt(text, "a.block.md", { line: 2, character: 4 })).toEqual({
      kind: "include",
      name: "widgets:mini-rules",
      range: { start: { line: 2, character: 0 }, end: { line: 2, character: 30 } },
    });
  });

  test("inside a bash fence gives null", () => {
    const text = "# a\n\n```bash\necho {{props.rules}}\n```\n";
    expect(tokenAt(text, "a.block.md", { line: 3, character: 8 })).toBeNull();
  });

  test("malformed lines never throw", () => {
    const text = "---\nprops:\n  rul\n# a\n{{props.ru\n{{include:\n```mermaid\nflowchart TB\n  a[\"x\n";
    for (let line = 0; line < 10; line++) for (let character = 0; character < 12; character++) expect(() => tokenAt(text, "a.block.md", { line, character })).not.toThrow();
    expect(tokenAt(text, "a.block.md", { line: 4, character: 4 })).toBeNull();
  });
});

describe("tokenAt in a manifest", () => {
  test('on "mattstack:mini/gate" gives a binding-key with its block path', () => {
    expect(tokenAt(MANIFEST, "pack/skills.jsonc", at(MANIFEST, '"mattstack:mini/gate"', 4))).toEqual({
      kind: "binding-key",
      engineRef: "mattstack:mini",
      blockPath: "gate",
      range: { start: at(MANIFEST, '"mattstack:mini/gate"'), end: at(MANIFEST, '"mattstack:mini/gate"', 21) },
    });
  });

  test('"mattstack:mini" has a null block path', () => {
    expect(tokenAt(MANIFEST, "pack/skills.jsonc", at(MANIFEST, '"mattstack:mini"', 3))).toMatchObject({ kind: "binding-key", engineRef: "mattstack:mini", blockPath: null });
  });

  test('on its "tiering" key gives a binding-prop', () => {
    expect(tokenAt(MANIFEST, "pack/skills.jsonc", at(MANIFEST, '"tiering"', 2))).toMatchObject({ kind: "binding-prop", key: "mattstack:mini/gate", prop: "tiering" });
  });

  test("a string value gives a binding-value", () => {
    expect(tokenAt(MANIFEST, "pack/skills.jsonc", at(MANIFEST, '"widgets:mini-rules/fast"', 3))).toMatchObject({
      kind: "binding-value",
      key: "mattstack:mini",
      prop: "rules",
      value: "widgets:mini-rules/fast",
    });
  });

  test("each value in the layered array form is a binding-value", () => {
    const text = '{\n  "bindings": {\n    "mattstack:mini": {\n      "rules": [{ "layer": "pack", "value": "widgets:a" }, { "layer": "override", "value": "gadgets:b" }]\n    }\n  }\n}\n';
    const values = tokensIn(text, "skills.jsonc").filter((t) => t.kind === "binding-value");
    expect(values.map((t) => t.kind === "binding-value" && t.value)).toEqual(["widgets:a", "gadgets:b"]);
    expect(tokenAt(text, "skills.jsonc", at(text, '"pack"', 1))).toBeNull();
  });

  test("a key under pipelines.<type>.bindings is a binding-key", () => {
    const text = '{\n  "pipelines": {\n    "bugfix": {\n      "bindings": { "mattstack:mini/gate": { "tiering": "" } }\n    }\n  }\n}\n';
    expect(tokenAt(text, "skills.jsonc", at(text, '"mattstack:mini/gate"', 2))).toMatchObject({ kind: "binding-key", engineRef: "mattstack:mini", blockPath: "gate" });
    expect(tokenAt(text, "skills.jsonc", at(text, '"tiering"', 2))).toMatchObject({ kind: "binding-prop", key: "mattstack:mini/gate", prop: "tiering" });
  });

  test("a half-typed manifest never throws", () => {
    const text = '{\n  "bindings": {\n    "mattstack:mini": { "rul';
    expect(() => tokensIn(text, "skills.jsonc")).not.toThrow();
    expect(tokenAt(text, "skills.jsonc", at(text, '"mattstack:mini"', 2))).toMatchObject({ kind: "binding-key" });
  });

  test("other files give no tokens", () => {
    expect(tokensIn(MANIFEST, "pack/other.jsonc")).toEqual([]);
    expect(tokenAt(INDEX, "notes.md", at(INDEX, "{{props.rules}}", 3))).toBeNull();
  });
});
