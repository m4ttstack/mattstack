import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAttachment, loadStepSource, type PluginRoots } from "../../sources.ts";
import type { PlaceholderContext } from "../../types.ts";
import { buildBlocksPayload, summaryOf, type BlocksPayloadInput } from "../payload.ts";
import { resolveProp, type LayerValue, type PropValue } from "../props.ts";
import { renderTree, type SourcedTree } from "../render.ts";
import { loadBlockTree, walk } from "../tree.ts";
import type { BlockTree } from "../types.ts";

const FIX = join(import.meta.dir, "..", "..", "__tests__", "fixtures", "blocks");
const ROOTS: PluginRoots = {
  byName: { mattstack: { dir: join(FIX, "plugins", "mattstack"), version: "1.0.0" }, widgets: { dir: join(FIX, "pack"), version: "0.1.0" } },
  list: [],
};
const made: string[] = [];

afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function ctx(): PlaceholderContext {
  return {
    fills: {}, slotMode: {}, partsPrefix: "${CLAUDE_SKILL_DIR}/parts", includes: {}, pipelines: {},
    repoKey: "my-repo", mattstackSha: "", mattstackDirty: 0, packSha: "", stageDir: null, stageMeta: null,
    compiledFrom: "mattstack@1.0.0", verbSides: {}, side: "skills", packRoot: null, pipeline: null,
  };
}

function valuesFor(trees: BlockTree[], layers: Record<string, Record<string, LayerValue[]>>): Map<string, Map<string, PropValue>> {
  const out = new Map<string, Map<string, PropValue>>();
  for (const tree of trees) {
    for (const b of walk(tree)) {
      const props = new Map<string, PropValue>();
      for (const spec of b.props) {
        const load = (v: string) => loadAttachment(v, spec.name, ROOTS);
        props.set(spec.name, resolveProp(spec, layers[b.id]?.[spec.name] ?? [], load, { file: b.relPath, internalRoster: new Set() }));
      }
      out.set(b.id, props);
    }
  }
  return out;
}

const MINI_LAYERS = {
  mini: { rules: [{ layer: "pack", value: "widgets:mini-rules/fast" }] },
  "mini/gate": { tiering: [{ layer: "pack", value: "" }] },
};

function payloadOf(tree: BlockTree, opts: { layers?: Record<string, Record<string, LayerValue[]>>; includes?: Record<string, SourcedTree>; base?: string | null } = {}) {
  const includes = opts.includes ?? {};
  const values = valuesFor([tree, ...Object.values(includes).map((s) => s.tree)], opts.layers ?? {});
  const { body } = renderTree({ tree, source: { plugin: "mattstack", version: "1.0.0" }, values, includes: (name) => includes[name] ?? null, ctx: ctx() });
  const compiled = `---\nname: x\n---\n\n<!-- header -->\n\n${body}\n`;
  const input: BlocksPayloadInput = {
    pack: "widgets", skill: "mini", kind: "verb", plugin: "mattstack", tree,
    includes: Object.fromEntries(Object.entries(includes).map(([n, s]) => [n, s.tree])),
    values, compiled, base: opts.base ?? null,
  };
  return { payload: buildBlocksPayload(input), compiled };
}

function mini() {
  return payloadOf(loadStepSource("mini", ROOTS).tree!, { layers: MINI_LAYERS });
}

test("the mini payload lists every block in preorder with its parent and depth", () => {
  const { payload } = mini();
  expect(payload.blocks.map((b) => [b.id, b.parentId, b.depth])).toEqual([
    ["mini", null, 0],
    ["mini/run", "mini", 1],
    ["mini/run/check", "mini/run", 2],
    ["mini/gate", "mini", 1],
    ["mini/notes", "mini", 1],
    ["mini/guard", "mini", 1],
  ]);
  expect(payload.engineRef).toBe("mattstack:mini");
  expect(payload.includes).toEqual([]);
});

test("kinds come from the gate field, the parent's graph and its absence", () => {
  const { payload } = mini();
  expect(Object.fromEntries(payload.blocks.map((b) => [b.id, b.kind]))).toEqual({
    mini: "step",
    "mini/run": "step",
    "mini/run/check": "note",
    "mini/gate": "gate",
    "mini/notes": "step",
    "mini/guard": "step",
  });
  expect(payload.blocks.find((b) => b.id === "mini/guard")!.headless).toBe(true);
});

test("layers list mattstack, the base when there is one, then the pack", () => {
  expect(mini().payload.layers).toEqual([
    { name: "mattstack", label: "default", color: "mattstack" },
    { name: "widgets", label: "pack", color: "team" },
  ]);
  const withBase = payloadOf(loadStepSource("mini", ROOTS).tree!, { layers: MINI_LAYERS, base: "acme-base" }).payload;
  expect(withBase.layers.map((l) => [l.label, l.color])).toEqual([["default", "mattstack"], ["base:acme-base", "org"], ["pack", "team"]]);
  expect(withBase.lines.map((l) => l.layer)).toEqual(["default", "base:acme-base", "pack"]);
});

test("lines count the engine text with its Mermaid source as mattstack and each value as its layer", () => {
  const { payload } = mini();
  const textLines = payload.blocks.flatMap((b) => b.text.split("\n")).filter((l) => l.trim() !== "" && !l.startsWith("<!-- part: "));
  // The rules value is the pack's two lines; everything else, the defaulted tiering and style values included, is mattstack's.
  expect(payload.lines).toEqual([
    { layer: "default", count: textLines.length - 2 },
    { layer: "pack", count: 2 },
  ]);
  expect(textLines).toContain("flowchart TB");
  expect(textLines.some((l) => l.includes("digraph"))).toBe(false);
});

test("text is the block's own rendered markdown with values inlined and its graph as mermaid", () => {
  const { payload } = mini();
  const root = payload.blocks[0]!;
  expect(root.text.split("\n").slice(0, 4)).toEqual(["# mini", "", "Runs the step, then asks for a decision.", ""]);
  expect(root.text).toContain("```mermaid\nflowchart TB\n");
  expect(root.text).toContain("Follow the fast widget rules.");
  expect(root.text).not.toContain("## Run the step");
  expect(root.text).not.toContain("part: block:");
  const gate = payload.blocks.find((b) => b.id === "mini/gate")!;
  expect(gate.text).toContain("Prop tiering is bound to `mattstack:model-tiering`");
});

test("props carry their spec, marker and each value with its layer and line count", () => {
  const { payload } = mini();
  const root = payload.blocks[0]!;
  expect(root.props).toEqual([{
    name: "rules", merge: "add", default: "", contract: null, marker: { line: 24, col: 1 },
    values: [{ layer: "pack", binding: "widgets:mini-rules/fast", path: join(FIX, "pack", "attachments", "mini-rules", "fast.md"), lines: 2 }],
    fromDefault: false,
  }]);
  const tiering = payload.blocks.find((b) => b.id === "mini/gate")!.props[0]!;
  expect(tiering.fromDefault).toBe(true);
  expect(tiering.values.map((v) => [v.layer, v.binding, v.lines])).toEqual([["default", "mattstack:model-tiering", 1]]);
});

test("summary is the first sentence after the title", () => {
  const { payload } = mini();
  expect(Object.fromEntries(payload.blocks.map((b) => [b.id, b.summary]))).toEqual({
    mini: "Runs the step, then asks for a decision.",
    "mini/run": "Do the work for the widget.",
    "mini/run/check": "Confirm the widget works.",
    "mini/gate": "Ask Matt whether to continue, using the tiering rules.",
    "mini/notes": "Keep notes short.",
    "mini/guard": "Guard text with no title line.",
  });
  expect(summaryOf("# T\n\nUse `rt skills` and **bold** [docs](x). Then more.", true)).toBe("Use rt skills and bold docs.");
  expect(summaryOf(`# T\n\n${"word ".repeat(60)}`, true).length).toBeLessThanOrEqual(160);
});

test("renderedLines run from the block's first seam to the line before the next block's", () => {
  const { payload, compiled } = mini();
  const lines = compiled.split("\n");
  const run = payload.blocks.find((b) => b.id === "mini/run")!;
  const check = payload.blocks.find((b) => b.id === "mini/run/check")!;
  expect(lines[run.renderedLines![0] - 1]).toStartWith("<!-- part: block:mini/run ");
  expect(lines[run.renderedLines![1]]).toStartWith("<!-- part: block:mini/run/check ");
  expect(check.renderedLines![0]).toBe(run.renderedLines![1] + 1);
  expect(payload.blocks[0]!.lines).toEqual([11, 24]);
});

test("graphs name the block each node is bound to", () => {
  const { payload } = mini();
  expect(payload.graphs).toHaveLength(1);
  expect(payload.graphs[0]!.blockId).toBe("mini");
  expect(payload.graphs[0]!.nodes.map((n) => [n.id, n.blockId])).toEqual([["start", null], ["run_step", "mini/run"], ["ask_gate", "mini/gate"], ["finish", null]]);
});

test("an included tree's blocks are shared, under the block that includes them", () => {
  const dir = mkdtempSync(join(tmpdir(), "blocks-payload-"));
  made.push(dir);
  const write = (root: string, files: Record<string, string>) => {
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), body);
    }
  };
  write(join(dir, "host"), {
    "index.block.md": "---\n---\n\n# host\n\nIntro.\n",
    "uses.block.md": "---\n---\n\n# Uses\n\n{{include:note}}\n\nAfter text.\n",
  });
  write(join(dir, "note"), { "index.block.md": "---\n---\nJust a note.\n" });
  const host = loadBlockTree(join(dir, "host"), { idPrefix: "host", relRoot: "attachments/host" });
  const note = loadBlockTree(join(dir, "note"), { idPrefix: "note", relRoot: "attachments/note" });
  const { payload } = payloadOf(host, { includes: { note: { tree: note, plugin: "mattstack", version: "1.0.0" } } });
  expect(payload.blocks.map((b) => [b.id, b.parentId, b.kind])).toEqual([["host", null, "step"], ["host/uses", "host", "note"], ["note", "host/uses", "shared"]]);
  expect(payload.includes).toEqual([{ name: "note", blockId: "note" }]);
  expect(payload.blocks[1]!.text).toBe("## Uses\n\nAfter text.");
  expect(payload.blocks[2]!.text).toBe("Just a note.");
});
