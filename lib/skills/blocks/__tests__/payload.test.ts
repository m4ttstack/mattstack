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

function tmpTree(id: string, files: Record<string, string>): BlockTree {
  const dir = mkdtempSync(join(tmpdir(), "blocks-payload-"));
  made.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return loadBlockTree(dir, { idPrefix: id, relRoot: `attachments/${id}` });
}

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

test("kinds come from the gate field, an include, a diamond node, any node, or no node", () => {
  const { payload } = mini();
  expect(Object.fromEntries(payload.blocks.map((b) => [b.id, b.kind]))).toEqual({
    mini: "note",
    "mini/run": "step",
    "mini/run/check": "note",
    "mini/gate": "gate",
    "mini/notes": "note",
    "mini/guard": "note",
  });
  const tree = tmpTree("q", {
    "index.block.md": "---\n---\n\n# q\n\n```mermaid\nflowchart TB\n  pick{Which way}\n```\n",
    "pick.block.md": "---\nnode: pick\n---\n\n# Which way\n\nChoose one.\n",
  });
  expect(payloadOf(tree).payload.blocks.map((b) => b.kind)).toEqual(["note", "question"]);
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

/** The compiled body's non-blank, non-seam lines, from the first block seam on. */
function bodyLineCount(compiled: string): number {
  const lines = compiled.split("\n");
  const start = lines.findIndex((l) => l.startsWith("<!-- part: block:"));
  return lines.slice(start).filter((l) => l.trim() !== "" && !l.startsWith("<!-- part: ")).length;
}

test("lines add up to the compiled body, each value counted for its layer", () => {
  const { payload, compiled } = mini();
  // The rules value is the pack's two lines; everything else, the defaulted tiering and style values included, is mattstack's.
  expect(payload.lines).toEqual([
    { layer: "default", count: bodyLineCount(compiled) - 2 },
    { layer: "pack", count: 2 },
  ]);
  const root = payload.blocks[0]!;
  expect(root.text).toContain("flowchart TB");
  expect(root.text).not.toContain("digraph");
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
    values: [{ layer: "pack", color: "team", binding: "widgets:mini-rules/fast", path: join(FIX, "pack", "attachments", "mini-rules", "fast.md"), lines: 2 }],
    fromDefault: false,
  }]);
  const tiering = payload.blocks.find((b) => b.id === "mini/gate")!.props[0]!;
  expect(tiering.fromDefault).toBe(true);
  expect(tiering.values.map((v) => [v.layer, v.color, v.binding, v.lines])).toEqual([["default", "mattstack", "mattstack:model-tiering", 1]]);
});

test("a repo override value is the team's color", () => {
  const tree = loadStepSource("mini", ROOTS).tree!;
  const { payload } = payloadOf(tree, { layers: { ...MINI_LAYERS, mini: { rules: [{ layer: "override", value: "widgets:mini-rules/fast" }] } } });
  expect(payload.blocks[0]!.props[0]!.values.map((v) => [v.layer, v.color])).toEqual([["override", "team"]]);
  expect(payload.lines.find((l) => l.layer === "pack")!.count).toBe(2);
});

test("segments split a block into its text, each value, and the text after it", () => {
  const tree = tmpTree("seg", {
    "index.block.md": [
      "---",
      "props:",
      "  rules:",
      "    merge: add",
      "---",
      "",
      "# seg",
      "",
      "Before the rules.",
      "",
      "{{props.rules}}",
      "",
      "After the rules.",
      "",
    ].join("\n"),
  });
  const { payload, compiled } = payloadOf(tree, {
    layers: { seg: { rules: [{ layer: "base:acme-base", value: "mattstack:style-floor" }, { layer: "pack", value: "widgets:mini-rules/fast" }] } },
    base: "acme-base",
  });
  const root = payload.blocks[0]!;
  expect(root.segments).toEqual([
    { layer: "default", color: "mattstack", prop: null, text: "# seg\n\nBefore the rules." },
    { layer: "base:acme-base", color: "org", prop: "rules", text: "Write short sentences." },
    { layer: "pack", color: "team", prop: "rules", text: "Follow the fast widget rules.\nRun ${CLAUDE_SKILL_DIR}/parts/rules/lint.sh first." },
    { layer: "default", color: "mattstack", prop: null, text: "After the rules." },
  ]);
  expect(root.props[0]!.values.map((v) => v.lines)).toEqual([1, 2]);
  expect(payload.lines).toEqual([
    { layer: "default", count: bodyLineCount(compiled) - 3 },
    { layer: "base:acme-base", count: 1 },
    { layer: "pack", count: 2 },
  ]);
});

test("a block that renders nothing but its seam has no renderedLines", () => {
  const tree = tmpTree("e", {
    "index.block.md": "---\n---\n\n# e\n\nIntro.\n",
    "empty.block.md": "---\n---\n\n# Empty\n",
  });
  const empty = payloadOf(tree).payload.blocks.find((b) => b.id === "e/empty")!;
  expect(empty.text).toBe("");
  expect(empty.renderedLines).toBeNull();
});

test("summary is the first sentence after the title", () => {
  const { payload } = mini();
  expect(Object.fromEntries(payload.blocks.map((b) => [b.id, b.summary]))).toEqual({
    mini: "Runs the step, then asks for a decision.",
    "mini/run": "Do the work for the widget.",
    "mini/run/check": "Confirm the widget works.",
    "mini/gate": "Ask the human whether to continue, using the tiering rules.",
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

const noteInclude = () => ({ tree: tmpTree("note", { "index.block.md": "---\n---\nJust a note.\n" }), plugin: "mattstack", version: "1.0.0" });

test("an included tree's blocks are shared, under the block that includes them", () => {
  const host = tmpTree("host", {
    "index.block.md": "---\n---\n\n# host\n\nIntro.\n",
    "uses.block.md": "---\n---\n\n# Uses\n\n{{include:note}}\n\nAfter text.\n",
  });
  const { payload } = payloadOf(host, { includes: { note: noteInclude() } });
  expect(payload.blocks.map((b) => [b.id, b.parentId, b.kind])).toEqual([["host", null, "note"], ["host/uses", "host", "note"], ["note", "host/uses", "shared"]]);
  expect(payload.includes).toEqual([{ name: "note", blockId: "host/uses" }]);
  expect(payload.blocks[1]!.text).toBe("## Uses\n\nAfter text.");
  expect(payload.blocks[2]!.text).toBe("Just a note.");
});

test("an include used twice lists its blocks once, from the first use, and every use in includes", () => {
  const host = tmpTree("host", {
    "index.block.md": "---\n---\n\n# host\n\nIntro.\n",
    "a.block.md": "---\n---\n\n# A\n\n{{include:note}}\n\nAfter A.\n",
    "b.block.md": "---\n---\n\n# B\n\n{{include:note}}\n",
  });
  const { payload, compiled } = payloadOf(host, { includes: { note: noteInclude() } });
  expect(payload.blocks.map((b) => [b.id, b.parentId])).toEqual([["host", null], ["host/a", "host"], ["note", "host/a"], ["host/b", "host"]]);
  expect(payload.includes).toEqual([{ name: "note", blockId: "host/a" }, { name: "note", blockId: "host/b" }]);
  const note = payload.blocks.find((b) => b.id === "note")!;
  expect(note.text).toBe("Just a note.");
  expect(compiled.split("\n")[note.renderedLines![0] - 1]).toStartWith("<!-- part: block:note ");
  expect(compiled.split("\n")[note.renderedLines![1]]).toStartWith("<!-- part: block:host/b ");
  expect(payload.blocks.find((b) => b.id === "host/a")!.text).toBe("## A\n\nAfter A.");
  expect(payload.lines).toEqual([{ layer: "default", count: bodyLineCount(compiled) }, { layer: "pack", count: 0 }]);
  expect(bodyLineCount(compiled)).toBe(7);
});
