import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VALUE_FILE_RE } from "../sources.ts";
import { FragmentError, isBlankOverridesText, layeredFromManifest, mergeLayers, parseFragment, readManifestDropped, readManifestProvenance, readManifestZone, renderManifest } from "../manifest-merge.ts";

const defaults = { label: "default", fragment: { bindings: { "mattstack:stage-gates": { domain: "mattstack:generic-gates" } }, pipelines: { feature: ["stage-plan", "stage-gates"] } } };
const base = { label: "base:acme-base", fragment: { skills: { enabled: ["acme-base:shared"] }, bindings: { "mattstack:stage-gates": { domain: "acme-base:gates" }, "mattstack:watch-ci": { forge: "mattstack:gitlab-forge" } } } };
const pack = { label: "pack", fragment: { skills: { enabled: ["widgets:work"] }, bindings: { "mattstack:stage-gates": { domain: "widgets:gates" } } } };
const override = { label: "override", fragment: { bindings: { "mattstack:watch-ci": { forge: "me:forge" } } } };

describe("mergeLayers", () => {
  test("later layers win per slot and provenance names the winning layer", () => {
    const merged = mergeLayers([defaults, base, pack, override]);
    expect(merged.bindings["mattstack:stage-gates"]).toEqual({ domain: "widgets:gates" });
    expect(merged.bindings["mattstack:watch-ci"]).toEqual({ forge: "me:forge" });
    expect(merged.provenance["mattstack:stage-gates domain"]).toBe("pack");
    expect(merged.provenance["mattstack:watch-ci forge"]).toBe("override");
  });

  test("a slot only the base fills keeps the base label", () => {
    const merged = mergeLayers([defaults, base, pack]);
    expect(merged.bindings["mattstack:watch-ci"]).toEqual({ forge: "mattstack:gitlab-forge" });
    expect(merged.provenance["mattstack:watch-ci forge"]).toBe("base:acme-base");
  });

  test("pipelines replace per work type and are attributed", () => {
    const merged = mergeLayers([defaults, { label: "pack", fragment: { pipelines: { feature: ["stage-plan"] } } }]);
    expect(merged.pipelines.feature).toEqual(["stage-plan"]);
    expect(merged.provenance["pipeline feature"]).toBe("pack");
  });

  test("skills.enabled is a stable union", () => {
    const merged = mergeLayers([base, pack, { label: "override", fragment: { skills: { enabled: ["widgets:work"] } } }]);
    expect(merged.enabled).toEqual(["acme-base:shared", "widgets:work"]);
  });

  test("the same slot in two separate merges never interferes", () => {
    const a = mergeLayers([defaults, { label: "pack", fragment: { bindings: { "mattstack:stage-gates": { domain: "widgets:gates" } } } }]);
    const b = mergeLayers([defaults, { label: "pack", fragment: { bindings: { "mattstack:stage-gates": { domain: "gadgets:gates" } } } }]);
    expect(a.bindings["mattstack:stage-gates"]!.domain).toBe("widgets:gates");
    expect(b.bindings["mattstack:stage-gates"]!.domain).toBe("gadgets:gates");
  });

  test("a __proto__ engine ref, slot or work type never reaches Object.prototype", () => {
    const text = '{ "bindings": { "__proto__": { "polluted": "widgets:gates" }, "mattstack:stage-gates": { "__proto__": "widgets:x" } }, "pipelines": { "__proto__": ["stage-plan"] } }';
    const merged = mergeLayers([{ label: "pack", fragment: parseFragment(text, "/p/skills.jsonc") }]);
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
    expect(Array.isArray(Object.getPrototypeOf(merged.pipelines))).toBe(false);
    expect(Object.keys(merged.bindings)).toContain("__proto__");
    expect(Object.keys(merged.bindings["mattstack:stage-gates"]!)).toEqual(["__proto__"]);
    expect(Object.keys(merged.pipelines)).toEqual(["__proto__"]);
  });

  test("a __proto__ pipeline override ref or slot never reaches Object.prototype", () => {
    const text = '{ "pipelines": { "a": { "stages": ["r", "__proto__"], "bindings": { "r": { "__proto__": "acme:x" }, "__proto__": { "polluted": "acme:y" } } } } }';
    const merged = mergeLayers([{ label: "pack", fragment: parseFragment(text, "/p/skills.jsonc") }]);
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
    expect(Object.keys(merged.pipelineBindings.a!.r!)).toEqual(["__proto__"]);
  });

  test("stages replace whole, pipeline bindings merge per slot", () => {
    const merged = mergeLayers([
      { label: "default", fragment: { pipelines: { a: { stages: ["s1", "s2"], bindings: { r: { x: "f1" } } } } } },
      { label: "pack", fragment: { pipelines: { a: { bindings: { r: { y: "f2" } } } } } },
      { label: "override", fragment: { pipelines: { a: { stages: ["r"] } } } },
    ]);
    expect(merged.pipelines.a).toEqual(["r"]);
    expect(merged.pipelineBindings.a!.r).toEqual({ x: "f1", y: "f2" });
    expect(merged.provenance["pipeline a"]).toBe("override");
    expect(merged.provenance["a/r x"]).toBe("default");
    expect(merged.provenance["a/r y"]).toBe("pack");
    expect(merged.dropped).toEqual([]);
  });

  test("an empty pipeline fill is kept so it can unbind a default slot", () => {
    const merged = mergeLayers([
      { label: "default", fragment: { pipelines: { a: { stages: ["r"], bindings: { r: { x: "f1" } } } } } },
      { label: "pack", fragment: { pipelines: { a: { bindings: { r: { x: "" } } } } } },
    ]);
    expect(merged.pipelineBindings.a!.r).toEqual({ x: "" });
  });

  test("a plain-list pipeline has no pipeline bindings", () => {
    const merged = mergeLayers([defaults]);
    expect(merged.pipelines.feature).toEqual(["stage-plan", "stage-gates"]);
    expect(Object.keys(merged.pipelineBindings)).toEqual([]);
  });

  test("bindings-only pipeline with no stages anywhere", () => {
    const layers = [{ label: "pack", fragment: { pipelines: { a: { bindings: { r: { x: "f1" } } } } } }];
    expect(() => mergeLayers(layers)).toThrow(FragmentError);
    expect(() => mergeLayers(layers)).toThrow('pipeline "a" has bindings but no layer gives it stages');
  });

  test("override for a stage a higher layer dropped", () => {
    const merged = mergeLayers([
      { label: "default", fragment: { pipelines: { a: { stages: ["mattstack:stage-gates", "s2"] } } } },
      { label: "base:acme-base", fragment: { pipelines: { a: { bindings: { "mattstack:stage-gates": { slot: "acme:x" } } } } } },
      { label: "pack", fragment: { pipelines: { a: { stages: ["s2"] } } } },
    ]);
    expect(merged.pipelineBindings.a?.["mattstack:stage-gates"]).toBeUndefined();
    expect(merged.dropped).toEqual([{ key: "a/mattstack:stage-gates slot", layer: "base:acme-base", reason: "removed" }]);
    expect(merged.provenance["a/mattstack:stage-gates slot"]).toBeUndefined();
  });

  test("override for a stage no layer's list for that pipeline ever had", () => {
    const merged = mergeLayers([
      { label: "default", fragment: { pipelines: { a: { stages: ["s2"] }, b: { stages: ["mattstack:stage-gates"] } } } },
      { label: "pack", fragment: { pipelines: { a: { bindings: { "mattstack:stage-gtaes": { slot: "acme:x" } } } } } },
    ]);
    expect(merged.dropped).toEqual([{ key: "a/mattstack:stage-gtaes slot", layer: "pack", reason: "unlisted" }]);
  });

  test("override for a stage missing from its own layer's list", () => {
    const layers = [{ label: "pack", fragment: { pipelines: { a: { stages: ["s1"], bindings: { s2: { x: "f1" } } } } } }];
    expect(() => mergeLayers(layers)).toThrow(FragmentError);
    expect(() => mergeLayers(layers)).toThrow('pipeline "a" binds s2 but does not list it');
  });

  test("a block-path key belongs to the engine the pipeline lists", () => {
    const merged = mergeLayers([
      { label: "default", fragment: { pipelines: { a: { stages: ["mattstack:mini"] } } } },
      { label: "pack", fragment: { pipelines: { a: { bindings: { "mattstack:mini/gate": { tiering: "" } } } } } },
    ]);
    expect(merged.pipelineBindings.a?.["mattstack:mini/gate"]).toEqual({ tiering: "" });
    expect(merged.dropped).toEqual([]);
    expect(() => mergeLayers([{ label: "pack", fragment: { pipelines: { a: { stages: ["mattstack:mini"], bindings: { "mattstack:mini/gate": { tiering: "" } } } } } }])).not.toThrow();
  });
});

describe("mergeLayers layered bindings", () => {
  const KEY = "mattstack:ship/flow/fast-checks";
  const opts = { repo: "gitlab.example.com/acme/widgets", pack: "widgets", zone: "acme-w" };
  const body = (text: string) => JSON.parse(text.split("\n").filter((l) => !l.startsWith("//")).join("\n"));
  const twoLayers = [
    { label: "base:acme-base", fragment: { bindings: { [KEY]: { rules: "acme-base:fast-rules" } } } },
    { label: "pack", fragment: { bindings: { [KEY]: { rules: "widgets:fast-rules" } } } },
  ];

  test("every layer's value per prop is kept in layer order", () => {
    const merged = mergeLayers(twoLayers);
    expect(merged.layered[KEY]!.rules).toEqual([
      { layer: "base:acme-base", value: "acme-base:fast-rules" },
      { layer: "pack", value: "widgets:fast-rules" },
    ]);
    expect(merged.bindings[KEY]).toEqual({ rules: "widgets:fast-rules" });
  });

  test("a pack layer's empty value is kept so compile can see who cleared", () => {
    const merged = mergeLayers([twoLayers[0]!, { label: "pack", fragment: { bindings: { [KEY]: { rules: "" } } } }]);
    expect(merged.layered[KEY]!.rules).toEqual([
      { layer: "base:acme-base", value: "acme-base:fast-rules" },
      { layer: "pack", value: "" },
    ]);
    expect(merged.bindings[KEY]).toEqual({ rules: "" });
  });

  test("pipeline bindings keep every layer's value, and a dropped stage leaves none behind", () => {
    const merged = mergeLayers([
      { label: "default", fragment: { pipelines: { a: { stages: ["r", "q"], bindings: { r: { x: "acme:one" }, q: { y: "acme:q" } } } } } },
      { label: "pack", fragment: { pipelines: { a: { stages: ["r"], bindings: { r: { x: "widgets:two" } } } } } },
    ]);
    expect(merged.pipelineLayered.a!.r!.x).toEqual([{ layer: "default", value: "acme:one" }, { layer: "pack", value: "widgets:two" }]);
    expect(merged.pipelineLayered.a!.q).toBeUndefined();
  });

  test("renderManifest round-trips to the same layered bindings", () => {
    const merged = mergeLayers([
      { label: "default", fragment: { bindings: { "mattstack:ship": { domain: "mattstack:generic" } }, pipelines: { a: { stages: ["r"], bindings: { r: { x: "acme:one" } } } } } },
      ...twoLayers,
      { label: "override", fragment: { bindings: { [KEY]: { rules: "" } }, pipelines: { a: { bindings: { r: { x: "me:two" } } } } } },
    ]);
    const text = renderManifest(merged, opts);
    expect(layeredFromManifest(text)).toEqual({ layered: merged.layered, pipelineLayered: merged.pipelineLayered });
  });

  test("only a prop several layers bound appears in the layered section; bindings stay last-wins strings", () => {
    const merged = mergeLayers([{ label: "default", fragment: { bindings: { "mattstack:ship": { domain: "mattstack:generic" } } } }, ...twoLayers]);
    const doc = body(renderManifest(merged, opts));
    expect(doc.version).toBe(2);
    expect(doc.bindings).toEqual({ "mattstack:ship": { domain: "mattstack:generic" }, [KEY]: { rules: "widgets:fast-rules" } });
    expect(doc.layered).toEqual({ [KEY]: { rules: [{ layer: "base:acme-base", value: "acme-base:fast-rules" }, { layer: "pack", value: "widgets:fast-rules" }] } });
  });

  test("a pipeline's several-layer props sit in its own layered section", () => {
    const merged = mergeLayers([
      { label: "default", fragment: { pipelines: { a: { stages: ["r"], bindings: { r: { x: "acme:one", y: "acme:y" } } } } } },
      { label: "pack", fragment: { pipelines: { a: { bindings: { r: { x: "widgets:two" } } } } } },
    ]);
    const doc = body(renderManifest(merged, opts));
    expect(doc.pipelines.a).toEqual({
      stages: ["r"],
      bindings: { r: { x: "widgets:two", y: "acme:y" } },
      layered: { r: { x: [{ layer: "default", value: "acme:one" }, { layer: "pack", value: "widgets:two" }] } },
    });
    expect(doc.layered).toBeUndefined();
    expect(doc.version).toBe(2);
  });

  test("version 2 for a block-path key or a per-file value even with one layer", () => {
    expect(body(renderManifest(mergeLayers([{ label: "pack", fragment: { bindings: { [KEY]: { rules: "widgets:fast-rules" } } } }]), opts)).version).toBe(2);
    expect(body(renderManifest(mergeLayers([{ label: "pack", fragment: { bindings: { "mattstack:ship": { rules: "widgets:rules/fast" } } } }]), opts)).version).toBe(2);
    expect(body(renderManifest(mergeLayers([{ label: "pack", fragment: { bindings: { "mattstack:ship": { rules: "widgets:rules" } } } }]), opts)).version).toBe(1);
  });

  test("layeredFromManifest reads a string binding as the pack layer when the file has no provenance lines", () => {
    const text = '// a fragment\n{ "version": 1, "bindings": { "mattstack:ship": { "domain": "widgets:d" } }, "pipelines": { "a": { "stages": ["r"], "bindings": { "r": { "x": "" } } } } }';
    expect(layeredFromManifest(text)).toEqual({
      layered: { "mattstack:ship": { domain: [{ layer: "pack", value: "widgets:d" }] } },
      pipelineLayered: { a: { r: { x: [{ layer: "pack", value: "" }] } } },
    });
  });
});

describe("parseFragment", () => {
  test("strips full-line comments and returns the object", () => {
    expect(parseFragment('// note\n{ "bindings": { "a:b": { "s": "x:y" } } }', "/f.jsonc").bindings).toEqual({ "a:b": { s: "x:y" } });
  });
  test("throws FragmentError naming the path on invalid JSONC", () => {
    expect(() => parseFragment("{ nope", "/zone/packs/widgets/pack/skills.jsonc")).toThrow(FragmentError);
    expect(() => parseFragment("{ nope", "/zone/packs/widgets/pack/skills.jsonc")).toThrow(/widgets\/pack\/skills\.jsonc/);
  });
  test("throws FragmentError when the document is not an object", () => {
    expect(() => parseFragment("[]", "/f.jsonc")).toThrow(FragmentError);
  });
  test.each([
    ["{ nope", "fragment is not valid JSONC: /f.jsonc", "is not valid JSONC"],
    ["// only a comment\n", "fragment is not valid JSONC: /f.jsonc", "is not valid JSONC"],
    ["[]", "fragment is not a JSON object: /f.jsonc", "is not a JSON object"],
    ['{ "bindings": { "a:b": "x" } }', "fragment bindings.a:b is not an object: /f.jsonc", "bindings.a:b is not an object"],
  ])("a FragmentError for %j carries the problem as reason and keeps its message", (text, message, reason) => {
    let caught: unknown;
    try {
      parseFragment(text, "/f.jsonc");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FragmentError);
    expect((caught as FragmentError).message).toBe(message);
    expect((caught as FragmentError).reason).toBe(reason);
  });
  test("only the overrides file reads comment-only text as blank", () => {
    expect(isBlankOverridesText("// off\n/* { } */\n")).toBe(true);
    expect(isBlankOverridesText("{}")).toBe(false);
    expect(() => parseFragment("// off\n", "/zone/packs/widgets/pack/skills.jsonc")).toThrow(FragmentError);
  });
  test.each([
    ["a null binding value", '{ "bindings": { "mattstack:stage-gates": null } }'],
    ["a non-string binding fill", '{ "bindings": { "mattstack:stage-gates": { "domain": 1 } } }'],
    ["a string skills.enabled", '{ "skills": { "enabled": "widgets:work" } }'],
    ["a non-array pipeline", '{ "pipelines": { "feature": "stage-plan" } }'],
    ["a non-array pipeline stages", '{ "pipelines": { "a": { "stages": "x" } } }'],
    ["a non-object pipeline bindings", '{ "pipelines": { "a": { "bindings": [] } } }'],
    ["a non-object pipeline engine bindings", '{ "pipelines": { "a": { "bindings": { "r": null } } } }'],
    ["a non-string pipeline fill", '{ "pipelines": { "a": { "bindings": { "r": { "s": 1 } } } } }'],
    ["a non-string extends", '{ "extends": 1 }'],
    ["a non-boolean base", '{ "base": "yes" }'],
  ])("throws FragmentError naming the path on %s", (_label, text) => {
    const path = "/zone/packs/gadgets/pack/skills.jsonc";
    expect(() => parseFragment(text, path)).toThrow(FragmentError);
    expect(() => parseFragment(text, path)).toThrow(/gadgets\/pack\/skills\.jsonc/);
  });
  test("object pipeline parses", () => {
    const text = '{"pipelines":{"accessibility":{"stages":["mattstack:stage-plan"],"bindings":{"mattstack:stage-plan":{"x":"acme:y"}}}}}';
    expect(parseFragment(text, "/f.jsonc").pipelines).toEqual({ accessibility: { stages: ["mattstack:stage-plan"], bindings: { "mattstack:stage-plan": { x: "acme:y" } } } });
  });
  test("an object pipeline names the bad field in the error", () => {
    expect(() => parseFragment('{"pipelines":{"a":{"stages":"x"}}}', "/f.jsonc")).toThrow("fragment pipelines.a.stages is not an array of strings: /f.jsonc");
    expect(() => parseFragment('{"pipelines":{"a":{"bindings":{"r":{"s":1}}}}}', "/f.jsonc")).toThrow("fragment pipelines.a.bindings.r.s is not a string: /f.jsonc");
  });
  test("an object pipeline refuses an unknown key", () => {
    const text = '{"pipelines":{"accessibility":{"stages":["s"],"binding":{"s":{"x":"acme:y"}}}}}';
    expect(() => parseFragment(text, "/f.jsonc")).toThrow(FragmentError);
    expect(() => parseFragment(text, "/f.jsonc")).toThrow('fragment pipelines.accessibility.binding is not a known key (stages, bindings): /f.jsonc');
  });
  test("bad pipeline name", () => {
    const text = '{"pipelines":{"Access_ibility":{"stages":["s"],"bindings":{"s":{"x":"acme:y"}}}}}';
    expect(() => parseFragment(text, "/f.jsonc")).toThrow(FragmentError);
    expect(() => parseFragment(text, "/f.jsonc")).toThrow('fragment pipeline "Access_ibility" must match [a-z][a-z0-9-]*: /f.jsonc');
  });
  test("-- in an override-carrying pipeline is refused", () => {
    const text = '{"pipelines":{"a--b":{"stages":["s"],"bindings":{"s":{"x":"acme:y"}}}}}';
    expect(() => parseFragment(text, "/f.jsonc")).toThrow(FragmentError);
    expect(() => parseFragment(text, "/f.jsonc")).toThrow('fragment pipeline "a--b" must not contain "--": /f.jsonc');
  });
  test("plain-list pipeline with -- still parses", () => {
    expect(parseFragment('{"pipelines":{"a--b":["s"]}}', "/f.jsonc").pipelines).toEqual({ "a--b": ["s"] });
  });
  test("a plain-list pipeline is never name-checked", () => {
    expect(parseFragment('{"pipelines":{"Feature":["s"]}}', "/f.jsonc").pipelines).toEqual({ Feature: ["s"] });
  });
  test("an empty binding fill parses, since it unbinds the slot", () => {
    expect(parseFragment('{ "bindings": { "mattstack:stage-gates": { "domain": "" } } }', "/f.jsonc").bindings).toEqual({ "mattstack:stage-gates": { domain: "" } });
  });
});

describe("renderManifest + readManifestProvenance", () => {
  test("round-trips the provenance header; a slot two layers bound makes it version 2", () => {
    const merged = mergeLayers([defaults, base, pack]);
    const text = renderManifest(merged, { repo: "gitlab.example.com/acme/widgets", pack: "widgets", zone: "acme-w" });
    expect(text).toContain("// repo: gitlab.example.com/acme/widgets");
    expect(text).toContain("// pack: widgets\n// zone: acme-w\n");
    expect(readManifestZone(text)).toBe("acme-w");
    expect(readManifestProvenance(text)).toEqual(merged.provenance);
    const body = JSON.parse(text.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n"));
    expect(body.version).toBe(2);
    expect(body.bindings["mattstack:stage-gates"].domain).toBe("widgets:gates");
    expect(body.layered["mattstack:stage-gates"].domain.map((v: { layer: string }) => v.layer)).toEqual(["default", "base:acme-base", "pack"]);
    expect(body.skills.enabled).toEqual(["acme-base:shared", "widgets:work"]);
  });
  test("readManifestProvenance ignores non-provenance comment lines", () => {
    expect(readManifestProvenance("// GENERATED\n// repo: x\n// zone: acme-w\n//   a:b s <- pack\n{}")).toEqual({ "a:b s": "pack" });
  });
  test("readManifestZone is null for a file written before the zone line, and never reads past the header", () => {
    expect(readManifestZone("// GENERATED\n// repo: x\n// pack: widgets\n{}")).toBeNull();
    expect(readManifestZone('{ "note": "x" }\n// zone: acme-w\n')).toBeNull();
  });
});

const PINNED_PLAIN_RENDER =
  '// GENERATED by rt skills materialize -- do not hand-edit for keeps;\n// the next pack install or materialize run rewrites this file.\n// repo: gitlab.example.com/acme/widgets\n// pack: widgets\n// zone: acme-w\n// provenance (binding <- layer):\n//   pipeline feature <- default\n//   mattstack:stage-gates domain <- pack\n{\n  "version": 1,\n  "skills": {\n    "enabled": [\n      "widgets:work"\n    ]\n  },\n  "pipelines": {\n    "feature": [\n      "stage-plan",\n      "stage-gates"\n    ]\n  },\n  "bindings": {\n    "mattstack:stage-gates": {\n      "domain": "widgets:gates"\n    }\n  }\n}\n';

describe("renderManifest with pipeline overrides", () => {
  const opts = { repo: "gitlab.example.com/acme/widgets", pack: "widgets", zone: "acme-w" };
  const body = (text: string) => JSON.parse(text.split("\n").filter((l) => !l.startsWith("//")).join("\n"));

  test("render: no overrides and no slot two layers bind stays a plain list and version 1", () => {
    const stagesOnly = { label: "default", fragment: { pipelines: defaults.fragment.pipelines } };
    expect(renderManifest(mergeLayers([stagesOnly, pack]), opts)).toBe(PINNED_PLAIN_RENDER);
  });

  test("render: overrides use the object form", () => {
    const merged = mergeLayers([
      defaults,
      { label: "pack", fragment: { pipelines: { a: { stages: ["mattstack:stage-gates"], bindings: { "mattstack:stage-gates": { domain: "acme:a11y" } } } } } },
    ]);
    const text = renderManifest(merged, opts);
    expect(body(text).pipelines).toEqual({
      feature: ["stage-plan", "stage-gates"],
      a: { stages: ["mattstack:stage-gates"], bindings: { "mattstack:stage-gates": { domain: "acme:a11y" } } },
    });
    expect(readManifestProvenance(text)["a/mattstack:stage-gates domain"]).toBe("pack");
  });

  test("readManifestDropped round-trips dropped header lines", () => {
    const merged = mergeLayers([
      { label: "default", fragment: { pipelines: { a: { stages: ["r", "s2"] } } } },
      { label: "base:acme-base", fragment: { pipelines: { a: { bindings: { r: { slot: "acme:x" } } } } } },
      { label: "pack", fragment: { pipelines: { a: { stages: ["s2"] } } } },
    ]);
    const text = renderManifest(merged, opts);
    expect(text).toContain("// dropped: a/r slot <- base:acme-base\n");
    expect(readManifestDropped(text)).toEqual([{ key: "a/r slot", layer: "base:acme-base" }]);
    expect(readManifestProvenance(text)).toEqual(merged.provenance);
  });

  test("readManifestDropped is empty without dropped lines and never reads past the header", () => {
    expect(readManifestDropped(PINNED_PLAIN_RENDER)).toEqual([]);
    expect(readManifestDropped('{ "note": "x" }\n// dropped: a/r s <- pack\n')).toEqual([]);
  });
});

type Schema = Record<string, any>;

/** Just enough draft-07 to check a manifest against skills-manifest.schema.json; the repo carries no JSON Schema validator. */
function validates(root: Schema, schema: Schema, value: unknown): boolean {
  if (schema.$ref) return validates(root, root.definitions[schema.$ref.replace("#/definitions/", "")], value);
  if (schema.const !== undefined && value !== schema.const) return false;
  if (schema.anyOf && !schema.anyOf.some((s: Schema) => validates(root, s, value))) return false;
  if (schema.oneOf && schema.oneOf.filter((s: Schema) => validates(root, s, value)).length !== 1) return false;
  if (schema.type === "string" && typeof value !== "string") return false;
  if (schema.type === "boolean" && typeof value !== "boolean") return false;
  if (schema.pattern && !(typeof value === "string" && new RegExp(schema.pattern).test(value))) return false;
  if (schema.type === "array") {
    if (!Array.isArray(value)) return false;
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.items && !value.every((v) => validates(root, schema.items, v))) return false;
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const obj = value as Record<string, unknown>;
    if ((schema.required ?? []).some((k: string) => !(k in obj))) return false;
    for (const [key, v] of Object.entries(obj)) {
      if (schema.propertyNames && !validates(root, schema.propertyNames, key)) return false;
      const own = schema.properties?.[key];
      const patterns = Object.entries(schema.patternProperties ?? {}).filter(([p]) => new RegExp(p).test(key));
      if (own && !validates(root, own, v)) return false;
      if (patterns.some(([, s]) => !validates(root, s as Schema, v))) return false;
      if (own || patterns.length) continue;
      if (schema.additionalProperties === false) {
        return false;
      } else if (schema.additionalProperties && !validates(root, schema.additionalProperties, v)) {
        return false;
      }
    }
  }
  return true;
}

describe("skills-manifest.schema.json", () => {
  const schema = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "plugins", "mattstack", "plugin", "schemas", "skills-manifest.schema.json"), "utf8"));
  const accepts = (doc: object) => validates(schema, schema, { version: 1, ...doc });

  test("schema accepts empty pipeline binding", () => {
    expect(accepts({ pipelines: { a: { stages: ["mattstack:stage-plan"], bindings: { "mattstack:stage-plan": { x: "acme:y" } } } } })).toBe(true);
    expect(accepts({ pipelines: { a: { stages: ["mattstack:stage-plan"], bindings: { "mattstack:stage-plan": { x: "" } } } } })).toBe(true);
  });

  test("a pipeline name with -- takes only the plain list form", () => {
    expect(accepts({ pipelines: { "a--b": { stages: ["mattstack:stage-plan"] } } })).toBe(false);
    expect(accepts({ pipelines: { "a--b": ["mattstack:stage-plan"] } })).toBe(true);
    expect(accepts({ pipelines: { accessibility: { stages: ["mattstack:stage-plan"] } } })).toBe(true);
  });

  test("an empty top-level binding still fails the schema", () => {
    expect(accepts({ bindings: { "mattstack:stage-plan": { x: "acme:y" } } })).toBe(true);
    expect(accepts({ bindings: { "mattstack:stage-plan": { x: "" } } })).toBe(false);
  });

  test("version 1 refuses the version 2 forms", () => {
    expect(accepts({ bindings: { "mattstack:ship/flow/fast-checks": { rules: "acme:r" } } })).toBe(false);
    expect(accepts({ bindings: { "mattstack:ship": { rules: "acme:r/fast" } } })).toBe(false);
    expect(accepts({ layered: { "mattstack:ship": { rules: [{ layer: "pack", value: "acme:r" }, { layer: "override", value: "" }] } } })).toBe(false);
  });

  describe("version 2", () => {
    const accepts2 = (doc: object) => validates(schema, schema, { version: 2, ...doc });
    const layers = [{ layer: "base:acme-base", value: "acme-base:fast-rules" }, { layer: "pack", value: "" }];

    test("string form: block-path keys, per-file values and empty values", () => {
      expect(accepts2({ bindings: { "mattstack:ship/flow/fast-checks": { rules: "acme:rules/fast" }, "mattstack:ship": { domain: "" } } })).toBe(true);
      expect(accepts2({ bindings: { "mattstack:ship": { rules: "acme:rules/a/b" } } })).toBe(false);
      expect(accepts2({ bindings: { "mattstack:ship": { rules: "acme:rules/fast.md" } } })).toBe(false);
    });

    test("the value's file tail accepts exactly what the loader's file name check accepts", () => {
      const samples = ["fast", "fast-checks", "a1", "0x", "fast.md", "fast_checks", "Fast", "-fast", "", "fast checks"];
      const valuePattern = new RegExp(schema.definitions.bindingValueV2.anyOf[0].pattern);
      for (const name of samples) expect([name, valuePattern.test(`acme:rules/${name}`)]).toEqual([name, VALUE_FILE_RE.test(name)]);
      expect(accepts2({ bindings: { "ship/flow": { rules: "acme:r" } } })).toBe(false);
    });

    test("array form in the layered sections", () => {
      expect(accepts2({ layered: { "mattstack:ship/flow/fast-checks": { rules: layers } } })).toBe(true);
      expect(accepts2({ pipelines: { a: { stages: ["mattstack:ship"], bindings: { "mattstack:ship": { x: "" } }, layered: { "mattstack:ship": { x: layers } } } } })).toBe(true);
      expect(accepts2({ layered: { "mattstack:ship": { rules: [{ layer: "pack" }] } } })).toBe(false);
      expect(accepts2({ bindings: { "mattstack:ship": { rules: layers } } })).toBe(false);
    });

    test("a version 1 manifest's key form is still a valid version 2 key", () => {
      expect(accepts2({ bindings: { "mattstack:ship": { domain: "x" } } })).toBe(true);
    });
  });
});
