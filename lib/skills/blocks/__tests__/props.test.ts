import { expect, test } from "bun:test";
import type { AttachmentSource } from "../../types.ts";
import { BlockError } from "../diagnostics.ts";
import { resolveProp } from "../props.ts";
import type { PropSpec } from "../types.ts";

const spec = (p: Partial<PropSpec>): PropSpec => ({ name: "rules", merge: "add", default: null, contract: null, declaredAt: { line: 4, col: 3 }, ...p });
const fill = (binding: string, provides = ""): AttachmentSource => ({ binding, plugin: binding.split(":")[0]!, version: "1", dir: "/x", srcPath: "x.md", bodyStartLine: 1, body: `body of ${binding}`, provides, allowedTools: [], extraFiles: [], registered: false, file: null });
const load = (b: string) => fill(b, "ship-domain@1");
const at = (file: string) => ({ file, internalRoster: new Set<string>() });

test("add stacks org then team", () => {
  const v = resolveProp(spec({}), [{ layer: "base:acme-base", value: "acme-base:rules/fast" }, { layer: "pack", value: "widgets:lint/fast" }], load, at("f"));
  expect(v.sources.map((s) => s.fill.binding)).toEqual(["acme-base:rules/fast", "widgets:lint/fast"]);
  expect(v.sources.map((s) => s.layer)).toEqual(["base:acme-base", "pack"]);
  expect(v.fromDefault).toBe(false);
});

test("replace keeps the last layer", () => {
  const v = resolveProp(spec({ merge: "replace" }), [{ layer: "base:b", value: "b:one" }, { layer: "pack", value: "w:two" }], load, at("f"));
  expect(v.sources.map((s) => s.fill.binding)).toEqual(["w:two"]);
});

test("an empty binding clears lower layers and falls back to the default", () => {
  const v = resolveProp(spec({ default: "" }), [{ layer: "base:b", value: "b:one" }, { layer: "pack", value: "" }], load, at("f"));
  expect(v.sources).toEqual([]);
  expect(v.fromDefault).toBe(true);
});

test("a value after a clear stacks on nothing", () => {
  const v = resolveProp(spec({}), [{ layer: "base:b", value: "b:one" }, { layer: "base:c", value: "" }, { layer: "pack", value: "w:two" }], load, at("f"));
  expect(v.sources.map((s) => s.fill.binding)).toEqual(["w:two"]);
});

test("clearing a required prop names the clearing layer", () => {
  expect(() => resolveProp(spec({}), [{ layer: "base:b", value: "b:one" }, { layer: "pack", value: "" }], load, at("f.block.md")))
    .toThrow(/f\.block\.md:4:3: prop "rules" is required .* cleared by pack/);
});

test("no layer and no default is required-prop", () => {
  let thrown: unknown;
  try {
    resolveProp(spec({}), [], load, at("f.block.md"));
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(BlockError);
  expect((thrown as BlockError).message).toMatch(/required/);
  expect((thrown as BlockError).diagnostics[0]).toMatchObject({ file: "f.block.md", line: 4, col: 3, code: "required-prop" });
});

test("a contract mismatch names the binding", () => {
  expect(() => resolveProp(spec({ contract: "model-tiering@1" }), [{ layer: "pack", value: "w:x" }], load, at("f.block.md"))).toThrow(/w:x .*provides "ship-domain@1".*"model-tiering@1"/);
});

test("a plugin:skill default loads like a value and is contract-checked", () => {
  const v = resolveProp(spec({ default: "mattstack:rules", contract: "ship-domain@1" }), [], load, at("f"));
  expect(v.fromDefault).toBe(true);
  expect(v.sources.map((s) => [s.layer, s.fill.binding])).toEqual([["default", "mattstack:rules"]]);
  expect(() => resolveProp(spec({ default: "mattstack:rules", contract: "other@1" }), [], load, at("f.block.md"))).toThrow(/mattstack:rules .*provides "ship-domain@1".*"other@1"/);
});

test("a registered public whole-skill value is a reference; a per-file value is inlined", () => {
  const pub = (b: string) => ({ ...fill(b, "model-tiering@1"), registered: true });
  const v = resolveProp(spec({ merge: "replace", default: "mattstack:model-tiering", contract: "model-tiering@1" }), [], pub, at("f"));
  expect(v.sources[0]!.mode).toBe("reference");
  const perFile = (b: string) => ({ ...fill(b, "model-tiering@1"), registered: true, file: "tiers.md" });
  expect(resolveProp(spec({ contract: "model-tiering@1" }), [{ layer: "pack", value: "w:t/tiers" }], perFile, at("f")).sources[0]!.mode).toBe("inline");
});

test("load is told which layer passed each value, the default included", () => {
  const seen: string[] = [];
  const spy = (b: string, layer: string) => {
    seen.push(`${layer}=${b}`);
    return load(b);
  };
  resolveProp(spec({}), [{ layer: "base:b", value: "b:one" }, { layer: "pack", value: "w:two" }], spy, at("f"));
  resolveProp(spec({ default: "mattstack:rules" }), [], spy, at("f"));
  expect(seen).toEqual(["base:b=b:one", "pack=w:two", "default=mattstack:rules"]);
});

test("a registered skill on the internal roster is inlined", () => {
  const pub = (b: string) => ({ ...fill(b), registered: true });
  const v = resolveProp(spec({}), [{ layer: "pack", value: "w:x" }], pub, { file: "f", internalRoster: new Set(["w:x"]) });
  expect(v.sources[0]!.mode).toBe("inline");
});
