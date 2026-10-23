import { describe, expect, test } from "bun:test";
import { defaultPipeline, effectiveBindings, effectiveSlotBindings, fillsDiffer, normalizePipelines, PIPELINE_NAME_RE, pipelineBindingKey, pipelineNameError, stageCopyName } from "../pipelines.ts";

describe("normalizePipelines", () => {
  test("a plain list gives stages and no bindings", () => {
    const out = normalizePipelines({ feature: ["s1", "s2"] });
    expect(out.stages.feature).toEqual(["s1", "s2"]);
    expect(out.bindings.feature).toBeUndefined();
  });
  test("an object gives what it has", () => {
    const out = normalizePipelines({
      a: { stages: ["s1"], bindings: { s1: { x: "acme:y" } } },
      b: { bindings: { s1: { x: "acme:z" } } },
      c: { stages: ["s1"] },
    });
    expect(out.stages.a).toEqual(["s1"]);
    expect(out.bindings.a).toEqual({ s1: { x: "acme:y" } });
    expect(out.stages.b).toBeUndefined();
    expect(out.bindings.b).toEqual({ s1: { x: "acme:z" } });
    expect(out.stages.c).toEqual(["s1"]);
    expect(out.bindings.c).toBeUndefined();
  });
  test("a pipeline with neither is omitted from both", () => {
    const out = normalizePipelines({ a: {}, b: { bindings: {} } });
    expect(Object.keys(out.stages)).toEqual([]);
    expect(Object.keys(out.bindings)).toEqual([]);
  });
  test("a missing value gives empty maps", () => {
    expect(normalizePipelines(undefined)).toEqual({ stages: {}, bindings: {} });
  });
  test("a __proto__ pipeline key never reaches Object.prototype", () => {
    const raw = JSON.parse('{ "__proto__": { "stages": ["s1"], "bindings": { "s1": { "x": "acme:y" } } } }');
    const out = normalizePipelines(raw);
    expect(Array.isArray(Object.getPrototypeOf(out.stages))).toBe(false);
    expect(Object.keys(out.stages)).toEqual(["__proto__"]);
  });
});

describe("naming helpers", () => {
  test("pipelineBindingKey", () => {
    expect(pipelineBindingKey("accessibility", "mattstack:stage-evidence", "evidence-domain")).toBe("accessibility/mattstack:stage-evidence evidence-domain");
  });
  test("stageCopyName", () => {
    expect(stageCopyName("stage-evidence", "accessibility")).toBe("stage-evidence--accessibility");
  });
  test("PIPELINE_NAME_RE", () => {
    expect(PIPELINE_NAME_RE.test("accessibility")).toBe(true);
    expect(PIPELINE_NAME_RE.test("a11y-2")).toBe(true);
    expect(PIPELINE_NAME_RE.test("Access_ibility")).toBe(false);
    expect(PIPELINE_NAME_RE.test("1a")).toBe(false);
  });
  test("pipelineNameError", () => {
    expect(pipelineNameError("a11y-2")).toBeNull();
    expect(pipelineNameError("Access_ibility")).toBe('pipeline "Access_ibility" must match [a-z][a-z0-9-]*');
    expect(pipelineNameError("a--b")).toBe('pipeline "a--b" must not contain "--"');
  });
});

describe("effectiveSlotBindings", () => {
  const defaults = { "acme:r": { a: "acme:a", b: "acme:b" } };
  test("override slots sit on top of the default slots", () => {
    expect(effectiveSlotBindings(defaults, { "acme:r": { b: "acme:b2", c: "acme:c" } }, "acme:r")).toEqual({ a: "acme:a", b: "acme:b2", c: "acme:c" });
  });
  test("no override gives the defaults", () => {
    expect(effectiveSlotBindings(defaults, undefined, "acme:r")).toEqual({ a: "acme:a", b: "acme:b" });
  });
  test("an engine with no default and no override gives an empty map", () => {
    expect(effectiveSlotBindings(defaults, undefined, "acme:other")).toEqual({});
  });
  test("an empty override fill stays in the map", () => {
    expect(effectiveSlotBindings(defaults, { "acme:r": { a: "" } }, "acme:r")).toEqual({ a: "", b: "acme:b" });
  });
});

describe("fillsDiffer", () => {
  test("a different fill differs", () => {
    expect(fillsDiffer({ r: { s: "acme:a" } }, { r: { s: "acme:b" } }, "r")).toBe(true);
  });
  test("the same fill does not differ", () => {
    expect(fillsDiffer({ r: { s: "acme:a" } }, { r: { s: "acme:a" } }, "r")).toBe(false);
  });
  test("an empty fill over an absent slot does not differ", () => {
    expect(fillsDiffer({}, { r: { s: "" } }, "r")).toBe(false);
  });
  test("an empty fill over a filled slot differs", () => {
    expect(fillsDiffer({ r: { s: "acme:a" } }, { r: { s: "" } }, "r")).toBe(true);
  });
  test("no override does not differ", () => {
    expect(fillsDiffer({ r: { s: "acme:a" } }, undefined, "r")).toBe(false);
  });
  test("a fill over an absent default slot differs", () => {
    expect(fillsDiffer({}, { r: { s: "acme:a" } }, "r")).toBe(true);
  });
  test("a block path under the engine ref is compared too; another engine's keys are not", () => {
    expect(fillsDiffer({ "r/gate": { p: "acme:a" } }, { "r/gate": { p: "" } }, "r")).toBe(true);
    expect(fillsDiffer({ "r/gate": { p: "acme:a" } }, { "r/gate": { p: "acme:a" } }, "r")).toBe(false);
    expect(fillsDiffer({}, { "rx/gate": { p: "acme:a" } }, "r")).toBe(false);
  });
});

describe("defaultPipeline", () => {
  test("the only key when there is one", () => {
    expect(defaultPipeline({ accessibility: ["s1"] })).toBe("accessibility");
  });
  test("feature when several and feature is present", () => {
    expect(defaultPipeline({ accessibility: ["s1"], feature: ["s1"] })).toBe("feature");
  });
  test("null when several and no feature", () => {
    expect(defaultPipeline({ a: ["s1"], b: ["s1"] })).toBeNull();
  });
  test("null when empty", () => {
    expect(defaultPipeline({})).toBeNull();
  });
});

describe("effectiveBindings", () => {
  const KEY = "mattstack:ship/flow/fast-checks";
  const defaults = { [KEY]: { rules: [{ layer: "base:acme-base", value: "acme-base:r" }, { layer: "pack", value: "widgets:r" }], domain: [{ layer: "pack", value: "widgets:d" }] } };

  test("a pipeline's layered values follow the top-level ones per prop", () => {
    const overrides = { [KEY]: { rules: [{ layer: "pack", value: "" }, { layer: "override", value: "me:r" }] } };
    expect(effectiveBindings(defaults, overrides, KEY)).toEqual({
      rules: [
        { layer: "base:acme-base", value: "acme-base:r" },
        { layer: "pack", value: "widgets:r" },
        { layer: "pack", value: "" },
        { layer: "override", value: "me:r" },
      ],
      domain: [{ layer: "pack", value: "widgets:d" }],
    });
  });

  test("no overrides, or an unknown key, gives the top level or nothing", () => {
    expect(effectiveBindings(defaults, undefined, KEY)).toEqual(defaults[KEY]);
    expect(effectiveBindings(defaults, undefined, "__proto__")).toEqual({});
  });
});
