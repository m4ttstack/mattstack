import { describe, expect, test } from "bun:test";
import { parse } from "jsonc-parser";
import { dropProvenanceLine, removePipelineOverride } from "../pipeline-edit";

describe("removePipelineOverride", () => {
  test("removes one prop and keeps the rest", () => {
    const text = JSON.stringify({
      pipelines: {
        feature: {
          stages: ["mattstack:stage-plan"],
          bindings: { "mattstack:stage-plan": { x: "acme:y", z: "acme:w" } },
        },
      },
    });
    const out = parse(removePipelineOverride(text, "feature", "mattstack:stage-plan", "x"));
    expect(out).toEqual({
      pipelines: {
        feature: {
          stages: ["mattstack:stage-plan"],
          bindings: { "mattstack:stage-plan": { z: "acme:w" } },
        },
      },
    });
  });

  test("prunes empty maps and collapses to a plain list", () => {
    const text =
      '{"pipelines":{"accessibility":{"stages":["mattstack:stage-plan"],"bindings":{"mattstack:stage-plan":{"x":"acme:y"}}}}}';
    const out = parse(removePipelineOverride(text, "accessibility", "mattstack:stage-plan", "x"));
    expect(out).toEqual({ pipelines: { accessibility: ["mattstack:stage-plan"] } });
  });

  test("a pipeline with only bindings loses its key", () => {
    const text = '{"pipelines":{"accessibility":{"bindings":{"mattstack:stage-plan":{"x":"acme:y"}}}},"bindings":{}}';
    const out = parse(removePipelineOverride(text, "accessibility", "mattstack:stage-plan", "x"));
    expect(out).toEqual({ bindings: {} });
  });

  test("a bindings-only pipeline goes but its siblings stay", () => {
    const text =
      '{"pipelines":{"feature":["mattstack:stage-plan"],"accessibility":{"bindings":{"mattstack:stage-plan":{"x":"acme:y"}}}}}';
    const out = parse(removePipelineOverride(text, "accessibility", "mattstack:stage-plan", "x"));
    expect(out).toEqual({ pipelines: { feature: ["mattstack:stage-plan"] } });
  });

  test("collapse keeps comments outside the pipeline", () => {
    const text = `// top
{
  "pipelines": {
    "feature": ["mattstack:stage-plan"], // beside feature
    "accessibility": {
      "stages": ["mattstack:stage-plan"],
      "bindings": { "mattstack:stage-plan": { "x": "acme:y" } }
    }
  }
}
`;
    const out = removePipelineOverride(text, "accessibility", "mattstack:stage-plan", "x");
    expect(out).toContain("// top");
    expect(out).toContain("// beside feature");
    expect(parse(out).pipelines.accessibility).toEqual(["mattstack:stage-plan"]);
  });

  test("missing path is a no-op", () => {
    const text = '{"pipelines":{"feature":["mattstack:stage-plan"]}}';
    expect(removePipelineOverride(text, "feature", "mattstack:stage-plan", "x")).toBe(text);
    expect(removePipelineOverride(text, "nope", "mattstack:stage-plan", "x")).toBe(text);
  });
});

describe("dropProvenanceLine", () => {
  test("removes only its key", () => {
    const text = `// generated
//   accessibility/mattstack:stage-evidence domain <- acme
//   accessibility/mattstack:stage-plan x <- acme
{}
`;
    const out = dropProvenanceLine(text, "accessibility/mattstack:stage-evidence domain");
    expect(out).not.toContain("stage-evidence domain");
    expect(out).toContain("//   accessibility/mattstack:stage-plan x <- acme");
    expect(out).toContain("// generated");
  });
});
