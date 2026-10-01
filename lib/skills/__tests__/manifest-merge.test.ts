import { describe, expect, test } from "bun:test";
import { FragmentError, mergeLayers, parseFragment, readManifestProvenance, renderManifest } from "../manifest-merge.ts";

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
    ["a null binding value", '{ "bindings": { "mattstack:stage-gates": null } }'],
    ["a non-string binding fill", '{ "bindings": { "mattstack:stage-gates": { "domain": 1 } } }'],
    ["a string skills.enabled", '{ "skills": { "enabled": "widgets:work" } }'],
    ["a non-array pipeline", '{ "pipelines": { "feature": "stage-plan" } }'],
    ["a non-string extends", '{ "extends": 1 }'],
    ["a non-boolean base", '{ "base": "yes" }'],
  ])("throws FragmentError naming the path on %s", (_label, text) => {
    const path = "/zone/packs/gadgets/pack/skills.jsonc";
    expect(() => parseFragment(text, path)).toThrow(FragmentError);
    expect(() => parseFragment(text, path)).toThrow(/gadgets\/pack\/skills\.jsonc/);
  });
  test("an empty binding fill parses, since it unbinds the slot", () => {
    expect(parseFragment('{ "bindings": { "mattstack:stage-gates": { "domain": "" } } }', "/f.jsonc").bindings).toEqual({ "mattstack:stage-gates": { domain: "" } });
  });
});

describe("renderManifest + readManifestProvenance", () => {
  test("round-trips the provenance header and emits version 1", () => {
    const merged = mergeLayers([defaults, base, pack]);
    const text = renderManifest(merged, { repo: "gitlab.example.com/acme/widgets", pack: "widgets" });
    expect(text).toContain("// repo: gitlab.example.com/acme/widgets");
    expect(text).toContain("// pack: widgets");
    expect(readManifestProvenance(text)).toEqual(merged.provenance);
    const body = JSON.parse(text.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n"));
    expect(body.version).toBe(1);
    expect(body.bindings["mattstack:stage-gates"].domain).toBe("widgets:gates");
    expect(body.skills.enabled).toEqual(["acme-base:shared", "widgets:work"]);
  });
  test("readManifestProvenance ignores non-provenance comment lines", () => {
    expect(readManifestProvenance("// GENERATED\n// repo: x\n//   a:b s <- pack\n{}")).toEqual({ "a:b s": "pack" });
  });
});
