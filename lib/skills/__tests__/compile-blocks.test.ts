import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { BlockError } from "../blocks/diagnostics.ts";
import { blockPropValues, compileBlockSkill, includeNamesIn, type BlockValues, type PropBindings } from "../compile-blocks.ts";
import { layeredFromManifest } from "../manifest-merge.ts";
import { loadAttachment, loadInclude, loadStepSource, type PluginRoots } from "../sources.ts";
import type { StepSource } from "../types.ts";
import type { BlockTree } from "../blocks/types.ts";

const FIX = join(import.meta.dir, "fixtures", "blocks");
const MANIFEST = join(FIX, "mattstack-home", "repos", "my-repo", "skills.jsonc");
const VERB = { name: "mini", engine: "mini", description: "Run the mini widget step" };
const made: string[] = [];

afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "rt-compile-blocks-"));
  made.push(dir);
  return dir;
}

function setup(): { roots: PluginRoots; mattstack: string; widgets: string } {
  const root = tmp();
  cpSync(FIX, root, { recursive: true });
  const mattstack = join(root, "plugins", "mattstack");
  const widgets = join(root, "pack");
  return { roots: { byName: { mattstack: { dir: mattstack, version: "1.0.0" }, widgets: { dir: widgets, version: "0.1.0" } }, list: [] }, mattstack, widgets };
}

function bindingsOf(text: string, path = MANIFEST): PropBindings {
  return { layered: layeredFromManifest(text).layered, manifest: { path, text } };
}

function valuesFor(step: StepSource, roots: PluginRoots, b: PropBindings, extra: { tree: BlockTree; plugin: string; version: string }[] = []): BlockValues {
  const trees = [{ tree: step.tree!, plugin: step.plugin, version: step.version }, ...extra];
  return blockPropValues(trees, b, (binding, prop) => loadAttachment(binding, prop, roots), new Set());
}

function compileMini(opts: { manifest?: string; stageDir?: string | null; prep?: (s: ReturnType<typeof setup>) => void } = {}) {
  const s = setup();
  opts.prep?.(s);
  const step = loadStepSource("mini", s.roots) as StepSource & { tree: BlockTree };
  const values = valuesFor(step, s.roots, bindingsOf(opts.manifest ?? readFileSync(MANIFEST, "utf8")));
  const result = compileBlockSkill(VERB, step, values, new Set(["mattstack:model-tiering"]), { stageDir: opts.stageDir ?? null });
  const skillMd = result.files.find((f) => f.path === "SKILL.md");
  return { ...s, result, skillMd: skillMd && "content" in skillMd ? skillMd.content : "" };
}

function diagnosticsOf(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    if (err instanceof BlockError) return err.diagnostics;
    throw err;
  }
  throw new Error("expected a BlockError");
}

describe("compileBlockSkill", () => {
  test("the mini tree compiles to one SKILL.md with depth-set headings and no placeholders", () => {
    const { result, skillMd } = compileMini();

    expect(result.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(skillMd.startsWith('---\nname: "mini"\ndescription: "Run the mini widget step"\nallowed-tools:\n')).toBe(true);
    expect(skillMd).toContain('  - "Bash(${CLAUDE_SKILL_DIR}/parts/rules/lint.sh)"\n');
    expect(skillMd).toContain(
      '  compiled: "mattstack@1.0.0 + widgets:mini-rules/fast@0.1.0 + mattstack:model-tiering@1.0.0 + mattstack:style-floor@1.0.0"\n',
    );
    expect(skillMd).toContain("<!-- compiled by rt skills compile");
    expect(skillMd.split("\n").filter((l) => l.startsWith("#"))).toEqual(["# mini", "## Run the step", "### Check the result", "## Ask the gate", "## Notes"]);
    expect(skillMd).not.toContain("{{");
    expect(skillMd).toContain("<!-- part: prop:mini.rules binding=widgets:mini-rules/fast version=0.1.0 path=attachments/mini-rules/fast.md lines=1-2 -->\nFollow the fast widget rules.\nRun ${CLAUDE_SKILL_DIR}/parts/rules/lint.sh first.");
  });

  test("the pack's empty tiering falls back to its default, a public skill bound by reference", () => {
    const { skillMd } = compileMini();
    expect(skillMd).toContain("Prop tiering is bound to `mattstack:model-tiering` (mattstack:model-tiering@1.0.0) -- invoke that skill when this flow needs it.");
  });

  test("a per-file value's sibling files vendor under parts/<prop>; no block file is vendored", () => {
    const { result } = compileMini({
      prep: ({ mattstack }) => {
        mkdirSync(join(mattstack, "attachments", "pipeline", "mini", "scripts"), { recursive: true });
        writeFileSync(join(mattstack, "attachments", "pipeline", "mini", "scripts", "go.sh"), "echo go\n");
      },
    });
    expect(result.files.map((f) => f.path)).toEqual(["SKILL.md", "scripts/go.sh", "parts/rules/lint.sh"]);
  });

  test("a block's own ${CLAUDE_SKILL_DIR} paths move to the stage dir; prop values keep their parts path", () => {
    const { skillMd } = compileMini({
      stageDir: "${CLAUDE_SKILL_DIR}/../../attachments/mini",
      prep: ({ mattstack }) => {
        const run = join(mattstack, "attachments", "pipeline", "mini", "run", "index.block.md");
        writeFileSync(run, readFileSync(run, "utf8").replace("Do the work for the widget.", "Run ${CLAUDE_SKILL_DIR}/scripts/go.sh for the widget."));
      },
    });
    expect(skillMd).toContain("Run ${CLAUDE_SKILL_DIR}/../../attachments/mini/scripts/go.sh for the widget.");
    expect(skillMd).toContain("Run ${CLAUDE_SKILL_DIR}/../../attachments/mini/parts/rules/lint.sh first.");
  });

  test("two values vendoring the same file to one place are refused, naming both sources", () => {
    const manifest = '{ "bindings": { "mattstack:mini": { "rules": "widgets:mini-rules/fast" } }, "layered": { "mattstack:mini": { "rules": [{ "layer": "base:acme", "value": "widgets:more-rules" }, { "layer": "pack", "value": "widgets:mini-rules/fast" }] } } }';
    const { result } = compileMini({
      manifest,
      prep: ({ widgets }) => {
        mkdirSync(join(widgets, "attachments", "more-rules"), { recursive: true });
        writeFileSync(join(widgets, "attachments", "more-rules", "SKILL.md"), '---\nname: more-rules\nmetadata:\n  provides: "mini-rules@1"\n---\n\nMore rules.\n');
        writeFileSync(join(widgets, "attachments", "more-rules", "lint.sh"), "echo other\n");
      },
    });
    expect(result.files).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ file: "attachments/pipeline/mini/index.block.md", code: "vendor-collision" });
    expect(result.diagnostics[0]!.message).toMatch(/more-rules\/lint\.sh and .*mini-rules\/lint\.sh would both vendor to parts\/rules\/lint\.sh/);
  });

  test("a render problem comes back as structured diagnostics with no files", () => {
    const { result } = compileMini({
      prep: ({ mattstack }) => {
        const gate = join(mattstack, "attachments", "pipeline", "mini", "gate.block.md");
        writeFileSync(gate, readFileSync(gate, "utf8").replace("{{props.tiering}}", "See {{props.tiering}} here."));
      },
    });
    expect(result.files).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["bad-marker"]);
  });
});

describe("blockPropValues", () => {
  test("a binding to a block the tree does not have is missing-block at the manifest key", () => {
    const { roots } = setup();
    const step = loadStepSource("mini", roots);
    const text = '{\n  "bindings": {\n    "mattstack:mini/nope": { "rules": "x:y" }\n  }\n}\n';
    expect(() => valuesFor(step, roots, bindingsOf(text))).toThrow(/skills\.jsonc:\d+:\d+: .*block "mini\/nope"/);
    expect(diagnosticsOf(() => valuesFor(step, roots, bindingsOf(text)))).toEqual([
      { file: MANIFEST, line: 3, col: 5, code: "missing-block", message: 'binding "mattstack:mini/nope": mattstack:mini has no block "mini/nope"' },
    ]);
  });

  test("a prop the block does not declare is unknown-prop at the prop key", () => {
    const { roots } = setup();
    const step = loadStepSource("mini", roots);
    const text = '{\n  "bindings": {\n    "mattstack:mini/gate": {\n      "style": "mattstack:style-floor"\n    }\n  }\n}\n';
    expect(diagnosticsOf(() => valuesFor(step, roots, bindingsOf(text)))).toEqual([
      { file: MANIFEST, line: 4, col: 7, code: "unknown-prop", message: 'binding "mattstack:mini/gate": block "mini/gate" declares no prop "style"' },
    ]);
  });

  test("a value that loads nothing is fill-missing at that layer's value, naming the binding key", () => {
    const { roots } = setup();
    const step = loadStepSource("mini", roots);
    const text = '{\n  "bindings": { "mattstack:mini": { "rules": "widgets:mini-rules/slow" } },\n  "layered": { "mattstack:mini": { "rules": [\n    { "layer": "base:acme", "value": "widgets:mini-rules/fast" },\n    { "layer": "pack", "value": "widgets:mini-rules/slow" }\n  ] } }\n}\n';
    const [d, ...rest] = diagnosticsOf(() => valuesFor(step, roots, bindingsOf(text)));
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ file: MANIFEST, line: 5, col: 33, code: "fill-missing" });
    expect(d!.message).toStartWith('binding "mattstack:mini" rules (from pack): loadAttachment: slot "rules": binding "widgets:mini-rules/slow": no file at ');
  });

  test("a bad value from a pipeline's own section is placed in that section", () => {
    const { roots } = setup();
    const step = loadStepSource("mini", roots);
    const text = '{\n  "pipelines": { "feature": {\n    "bindings": { "mattstack:mini": { "rules": "widgets:mini-rules/a/b" } }\n  } }\n}\n';
    const b: PropBindings = { layered: {}, pipelineLayered: layeredFromManifest(text).pipelineLayered.feature, pipeline: "feature", manifest: { path: MANIFEST, text } };
    expect(diagnosticsOf(() => valuesFor(step, roots, b))[0]).toMatchObject({ line: 3, col: 48, code: "bad-value" });
  });

  test("a pipeline section's key naming a missing block is missing-block at its own line", () => {
    const { roots } = setup();
    const step = loadStepSource("mini", roots);
    const text = '{\n  "bindings": { "mattstack:mini": { "rules": "widgets:mini-rules/fast" } },\n  "pipelines": { "feature": {\n    "stages": ["mattstack:mini"],\n    "bindings": {\n      "mattstack:mini/nope": { "rules": "widgets:mini-rules/fast" }\n    }\n  } }\n}\n';
    const { layered, pipelineLayered } = layeredFromManifest(text);
    const b: PropBindings = { layered, pipelineLayered: pipelineLayered.feature, pipeline: "feature", manifest: { path: MANIFEST, text } };
    expect(diagnosticsOf(() => valuesFor(step, roots, b))).toEqual([
      { file: MANIFEST, line: 6, col: 7, code: "missing-block", message: 'binding "mattstack:mini/nope": mattstack:mini has no block "mini/nope"' },
    ]);
  });

  test("a typo key in a pipeline section is checked even when no stage copy compiles that section", () => {
    const { roots } = setup();
    const step = loadStepSource("mini", roots);
    const text = '{\n  "bindings": {},\n  "pipelines": { "feature": {\n    "stages": ["mattstack:mini"],\n    "bindings": {\n      "mattstack:mini/gaet": { "tiering": "" },\n      "mattstack:mini/gate": { "tiring": "" }\n    }\n  } }\n}\n';
    const b: PropBindings = { layered: {}, pipelineSections: layeredFromManifest(text).pipelineLayered, manifest: { path: MANIFEST, text } };
    expect(diagnosticsOf(() => valuesFor(step, roots, b))).toEqual([
      { file: MANIFEST, line: 6, col: 7, code: "missing-block", message: 'binding "mattstack:mini/gaet": mattstack:mini has no block "mini/gaet"' },
      { file: MANIFEST, line: 7, col: 32, code: "unknown-prop", message: 'binding "mattstack:mini/gate": block "mini/gate" declares no prop "tiring"' },
    ]);
  });

  test("every block gets its values, defaults included", () => {
    const { roots } = setup();
    const step = loadStepSource("mini", roots);
    const values = valuesFor(step, roots, bindingsOf(readFileSync(MANIFEST, "utf8")));
    expect([...values.keys()]).toEqual(["mini", "mini/run", "mini/run/check", "mini/gate", "mini/notes", "mini/guard"]);
    expect(values.get("mini/gate")!.get("tiering")).toMatchObject({ fromDefault: true });
    expect(values.get("mini")!.get("rules")!.sources.map((s) => s.fill.binding)).toEqual(["widgets:mini-rules/fast"]);
  });
});

describe("tree includes", () => {
  test("an included tree renders in place and its props vendor under parts/+<id>/<prop>", () => {
    const s = setup();
    const inc = join(s.mattstack, "attachments", "gate-protocol");
    mkdirSync(inc, { recursive: true });
    writeFileSync(join(inc, "index.block.md"), '---\nprops:\n  rules:\n    merge: add\n    default: ""\n---\n\n# Gate protocol\n\nAsk once. See ${CLAUDE_SKILL_DIR}/gate.sh.\n\n{{props.rules}}\n');
    writeFileSync(join(inc, "gate.sh"), "echo gate\n");
    const notes = join(s.mattstack, "attachments", "pipeline", "mini", "notes.block.md");
    writeFileSync(notes, `${readFileSync(notes, "utf8")}\n{{include:gate-protocol}}\n`);

    const step = loadStepSource("mini", s.roots) as StepSource & { tree: BlockTree };
    expect(includeNamesIn(step.tree)).toEqual(["gate-protocol"]);
    const gp = loadInclude("gate-protocol", s.roots);
    const text = '{ "bindings": { "mattstack:gate-protocol": { "rules": "widgets:mini-rules/fast" } } }';
    const values = valuesFor(step, s.roots, bindingsOf(text), [{ tree: gp.tree!, plugin: gp.plugin, version: gp.version }]);
    const result = compileBlockSkill(VERB, step, values, new Set(["mattstack:model-tiering"]), { includes: { "gate-protocol": gp } });
    const md = (result.files[0] as { content: string }).content;

    expect(result.diagnostics).toEqual([]);
    expect(md).toContain("### Gate protocol\n\nAsk once. See ${CLAUDE_SKILL_DIR}/parts/include-gate-protocol/gate.sh.");
    expect(md).toContain("Run ${CLAUDE_SKILL_DIR}/parts/+gate-protocol/rules/lint.sh first.");
    expect(result.files.map((f) => f.path)).toEqual(["SKILL.md", "parts/+gate-protocol/rules/lint.sh", "parts/include-gate-protocol/gate.sh"]);
  });
});
