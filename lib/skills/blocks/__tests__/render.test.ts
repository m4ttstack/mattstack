import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAttachment, type PluginRoots } from "../../sources.ts";
import type { AttachmentSource, PlaceholderContext } from "../../types.ts";
import { BlockError } from "../diagnostics.ts";
import { resolveProp, type LayerValue, type PropValue } from "../props.ts";
import { headingLevel, renderInclude, renderTree, type IncludeResolver, type SourcedTree } from "../render.ts";
import { loadBlockTree, walk } from "../tree.ts";
import type { BlockTree } from "../types.ts";

const MATTSTACK = join(import.meta.dir, "..", "..", "__tests__", "fixtures", "blocks", "plugins", "mattstack");
const MINI = join(MATTSTACK, "attachments", "pipeline", "mini");
const made: string[] = [];

afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmpDir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "blocks-render-"));
  made.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

const RULES_SKILL = [
  "---",
  "name: mini-rules",
  'description: "Rules for the widget step"',
  "metadata:",
  '  provides: "mini-rules@1"',
  "---",
  "",
  "Follow the widget rules.",
  "Run ${CLAUDE_SKILL_DIR}/lint.sh first.",
  "",
].join("\n");

function rootsWithWidgets(): PluginRoots {
  const widgets = tmpDir({ "attachments/mini-rules/SKILL.md": RULES_SKILL, "attachments/mini-rules/lint.sh": "echo lint\n" });
  return { byName: { mattstack: { dir: MATTSTACK, version: "1.0.0" }, widgets: { dir: widgets, version: "0.1.0" } }, list: [] };
}

const NO_ROOTS: PluginRoots = { byName: { mattstack: { dir: MATTSTACK, version: "1.0.0" } }, list: [] };

function valuesFor(tree: BlockTree, roots: PluginRoots, layers: Record<string, Record<string, LayerValue[]>> = {}): Map<string, Map<string, PropValue>> {
  const out = new Map<string, Map<string, PropValue>>();
  for (const b of walk(tree)) {
    const props = new Map<string, PropValue>();
    for (const spec of b.props) {
      const load = (v: string) => loadAttachment(v, spec.name, roots);
      props.set(spec.name, resolveProp(spec, layers[b.id]?.[spec.name] ?? [], load, { file: b.relPath, internalRoster: new Set() }));
    }
    out.set(b.id, props);
  }
  return out;
}

function ctx(over: Partial<PlaceholderContext> = {}): PlaceholderContext {
  return {
    fills: {}, slotMode: {}, partsPrefix: "${CLAUDE_SKILL_DIR}/parts", includes: {}, pipelines: {},
    repoKey: "my-repo", mattstackSha: "", mattstackDirty: 0, packSha: "", stageDir: null, stageMeta: null,
    compiledFrom: "mattstack@1.0.0", verbSides: {}, side: "skills", packRoot: null, pipeline: null,
    ...over,
  };
}

const SOURCE = { plugin: "mattstack", version: "1.0.0" };
const noIncludes: IncludeResolver = () => null;

function render(tree: BlockTree, opts: { includes?: IncludeResolver; roots?: PluginRoots; ctx?: PlaceholderContext } = {}) {
  return renderTree({
    tree,
    source: SOURCE,
    values: valuesFor(tree, opts.roots ?? NO_ROOTS),
    includes: opts.includes ?? noIncludes,
    ctx: opts.ctx ?? ctx(),
  });
}

/** Mirrors compile.ts's sourceCoordinate: the nearest seam above a line maps it back to a file line. */
const SEAM_RE = /^<!-- part: .*\bpath=(\S+) lines=(\d+)-\d+ -->$/;
function sourceOf(body: string, text: string): string | null {
  const lines = body.split("\n");
  const line = lines.indexOf(text) + 1;
  if (line === 0) throw new Error(`no line ${text}`);
  for (let i = line - 2; i >= 0; i--) {
    const seam = lines[i]!.trim().match(SEAM_RE);
    if (!seam) continue;
    const seamLine = i + 1;
    const firstBodyLine = seamLine + (lines[seamLine]?.trim() === "" ? 2 : 1);
    return `${seam[1]}:${Number(seam[2]) + (line - firstBodyLine)}`;
  }
  return null;
}

function diagnosticsOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    if (e instanceof BlockError) return e.diagnostics;
    throw e;
  }
  throw new Error("expected a BlockError");
}

const plainTree = (files: Record<string, string>, prefix = "a") =>
  loadBlockTree(tmpDir(files), { idPrefix: prefix, relRoot: prefix === "a" ? "a" : `attachments/${prefix}` });

test("headingLevel is depth + 1, capped at 6", () => {
  expect([0, 1, 5, 9].map(headingLevel)).toEqual([1, 2, 6, 6]);
});

test("the mini tree renders one body with a seam per block and prop", () => {
  const tree = loadBlockTree(MINI, { idPrefix: "mini", relRoot: "attachments/pipeline/mini" });
  const roots = rootsWithWidgets();
  const { body, used, packPaths } = renderTree({
    tree,
    source: SOURCE,
    values: valuesFor(tree, roots, { mini: { rules: [{ layer: "pack", value: "widgets:mini-rules" }] } }),
    includes: noIncludes,
    ctx: ctx(),
  });

  expect(body.startsWith(
    "<!-- part: block:mini source=mattstack:mini version=1.0.0 path=attachments/pipeline/mini/index.block.md lines=11-24 -->\n# mini\n\nRuns the step",
  )).toBe(true);
  expect(body).toContain("<!-- part: block:mini/run source=mattstack:mini version=1.0.0 path=attachments/pipeline/mini/run/index.block.md lines=5-7 -->\n## Run the step\n");
  expect(body).toContain("\n### Check the result\n");
  expect(body).toContain(
    "<!-- part: prop:mini/gate.tiering binding=mattstack:model-tiering version=1.0.0 path=skills/model-tiering/SKILL.md lines=8-8 -->\n" +
      "Prop tiering is bound to `mattstack:model-tiering` (mattstack:model-tiering@1.0.0) -- invoke that skill when this flow needs it.",
  );
  expect(body).toContain("<!-- part: prop:mini/notes.style binding=mattstack:style-floor version=1.0.0 path=attachments/style-floor/SKILL.md lines=8-8 -->\nWrite short sentences.");
  expect(body).toContain(
    "<!-- part: prop:mini.rules binding=widgets:mini-rules version=0.1.0 path=attachments/mini-rules/SKILL.md lines=8-9 -->\n" +
      "Follow the widget rules.\nRun ${CLAUDE_SKILL_DIR}/parts/rules/lint.sh first.",
  );
  expect(body).toContain("<!-- part: block:mini/guard source=mattstack:mini version=1.0.0 path=attachments/pipeline/mini/guard.block.md lines=3-3 -->\nGuard text with no title line.");
  expect(body).toContain("```dot\ndigraph flow {\n");
  expect(body).toContain('run_step [label="Run the step"');
  expect(body).not.toContain("mermaid");
  expect(body.match(/part: block:mini /g)).toHaveLength(1);
  expect(body).not.toContain("{{");

  const order = ["## Run the step", "### Check the result", "## Ask the gate", "## Notes", "Guard text with no title line."].map((s) => body.indexOf(s));
  expect(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1]!))).toBe(true);
  expect(body.split("\n").filter((l) => l.startsWith("#"))).toEqual(["# mini", "## Run the step", "### Check the result", "## Ask the gate", "## Notes"]);

  expect(used.includes).toEqual([]);
  expect(packPaths).toEqual([]);
});

test("every compiled line maps back to the file line it came from", () => {
  const tree = loadBlockTree(MINI, { idPrefix: "mini", relRoot: "attachments/pipeline/mini" });
  const { body } = render(tree);
  const at = (rel: string, line: number) => `attachments/pipeline/mini/${rel}:${line}`;
  expect(sourceOf(body, "# mini")).toBe(at("index.block.md", 11));
  expect(sourceOf(body, "Runs the step, then asks for a decision.")).toBe(at("index.block.md", 13));
  expect(sourceOf(body, "Do the work for the widget.")).toBe(at("run/index.block.md", 7));
  expect(sourceOf(body, "Confirm the widget works.")).toBe(at("run/check.block.md", 6));
  expect(sourceOf(body, "## Ask the gate")).toBe(at("gate.block.md", 11));
  expect(sourceOf(body, "Ask Matt whether to continue, using the tiering rules.")).toBe(at("gate.block.md", 13));
  expect(sourceOf(body, "Keep notes short.")).toBe(at("notes.block.md", 11));
  expect(sourceOf(body, "Guard text with no title line.")).toBe(at("guard.block.md", 3));
});

test("text after a converted graph or an inlined prop maps back to its own block", () => {
  const tree = plainTree({
    "index.block.md": "---\nprops:\n  style:\n    merge: replace\n    default: \"mattstack:style-floor\"\n---\n\n# g\n\n```mermaid\nflowchart TB\n  one[One]\n  two[Two]\n  one --> two\n```\n\nAfter the graph.\n\n{{props.style}}\n\nAfter the prop.\n",
  });
  const { body } = render(tree);
  expect(sourceOf(body, "After the graph.")).toBe("a/index.block.md:17");
  expect(sourceOf(body, "Write short sentences.")).toBe("attachments/style-floor/SKILL.md:8");
  expect(sourceOf(body, "After the prop.")).toBe("a/index.block.md:21");
});

test("a titled block whose only text is an empty add prop keeps its seam and drops its heading", () => {
  const tree = plainTree({
    "index.block.md": "---\n---\n\n# a\n\nIntro.\n",
    "empty.block.md": "---\nprops:\n  extra:\n    merge: add\n    default: \"\"\n---\n\n# Empty\n\n{{props.extra}}\n",
  });
  const { body } = render(tree);
  expect(body).toContain("<!-- part: block:a/empty source=mattstack:a version=1.0.0 path=a/empty.block.md ");
  expect(body).not.toContain("Empty");
  expect(body).not.toContain("prop:a/empty.extra");
});

test("sub-headings re-level from the block's own level, or its parent's when headless", () => {
  const tree = plainTree({
    "index.block.md": "---\n---\n\n# a\n\nIntro.\n\n## root sub\n",
    "sub.block.md": "---\n---\n\n# Sub host\n\nLead.\n\n## sub\n\n```md\n## not a heading\n```\n",
    "z-loose.block.md": "---\n---\nLoose.\n\n## loose sub\n",
  });
  const lines = render(tree).body.split("\n");
  expect(lines).toContain("## root sub");
  expect(lines).toContain("### sub");
  expect(lines).toContain("## not a heading");
  expect(lines).toContain("## loose sub");
  expect(lines).toContain("## Sub host");
});

test("a props marker that shares its line is bad-marker at the marker", () => {
  const tree = plainTree({
    "index.block.md": "---\nprops:\n  x:\n    merge: add\n    default: \"\"\n---\n\n# T\n\nSee {{props.x}} here.\n",
  });
  expect(diagnosticsOf(() => render(tree))).toEqual([
    expect.objectContaining({ file: "a/index.block.md", line: 10, col: 5, code: "bad-marker" }),
  ]);
});

function gpInclude(): SourcedTree {
  const tree = plainTree({
    "index.block.md": "---\n---\n\n# Gate protocol\n\nGate intro.\n",
    "ask.block.md": "---\n---\n\n# Ask\n\nAsk it.\n",
  }, "gp");
  return { tree, plugin: "mattstack", version: "2.0.0" };
}

function noteInclude(): SourcedTree {
  return { tree: plainTree({ "index.block.md": "---\n---\nJust a note.\n" }, "note"), plugin: "mattstack", version: "2.0.0" };
}

const resolver = (byName: Record<string, SourcedTree>): IncludeResolver => (name) => byName[name] ?? null;

test("an include whose root repeats the including title renders that title once", () => {
  const host = plainTree({
    "index.block.md": "---\n---\n\n# host\n\nIntro.\n",
    "gates.block.md": "---\n---\n\n# Gate protocol\n\n{{include:gp}}\n",
  });
  const { body, used } = render(host, { includes: resolver({ gp: gpInclude() }) });
  expect(body.split("\n").filter((l) => /^#+ /.test(l))).toEqual(["# host", "## Gate protocol", "### Ask"]);
  expect(body).toContain("<!-- part: block:gp source=mattstack:gp version=2.0.0 path=attachments/gp/index.block.md lines=6-6 -->\nGate intro.");
  expect(used.includes).toEqual(["gp"]);
});

test("an include under a different title keeps its root heading one level down", () => {
  const host = plainTree({
    "index.block.md": "---\n---\n\n# host\n\nIntro.\n",
    "gates.block.md": "---\n---\n\n# Gates\n\n{{include:gp}}\n",
  });
  const { body } = render(host, { includes: resolver({ gp: gpInclude() }) });
  expect(body.split("\n").filter((l) => /^#+ /.test(l))).toEqual(["# host", "## Gates", "### Gate protocol", "#### Ask"]);
});

test("renderInclude applies the same rule at a given depth", () => {
  const input = { values: new Map(), includes: noIncludes, ctx: ctx() };
  const same = renderInclude(gpInclude(), { depth: 2, includingTitle: "Gate protocol" }, input).body;
  expect(same.split("\n").filter((l) => /^#+ /.test(l))).toEqual(["### Ask"]);
  const other = renderInclude(gpInclude(), { depth: 2, includingTitle: "Gates" }, input).body;
  expect(other.split("\n").filter((l) => /^#+ /.test(l))).toEqual(["### Gate protocol", "#### Ask"]);
});

test("an include with headings followed by text is text-after-include at that text", () => {
  const host = plainTree({
    "index.block.md": "---\n---\n\n# host\n",
    "uses.block.md": "---\n---\n\n# Uses\n\n{{include:gp}}\n\nAfter text.\n",
  });
  expect(diagnosticsOf(() => render(host, { includes: resolver({ gp: gpInclude() }) }))).toEqual([
    expect.objectContaining({ file: "a/uses.block.md", line: 8, col: 1, code: "text-after-include" }),
  ]);
});

test("a headless include whose text carries sub-headings, followed by text, is text-after-include", () => {
  const setUp: SourcedTree = { tree: plainTree({ "index.block.md": "---\n---\nIntro prose.\n\n## Set up\n\nSetup text.\n" }, "setup"), plugin: "mattstack", version: "2.0.0" };
  const host = plainTree({
    "index.block.md": "---\n---\n\n# host\n",
    "uses.block.md": "---\n---\n\n# Uses\n\n{{include:setup}}\n\nAfter text.\n",
  });
  expect(diagnosticsOf(() => render(host, { includes: resolver({ setup: setUp }) }))).toEqual([
    expect.objectContaining({ file: "a/uses.block.md", line: 8, col: 1, code: "text-after-include" }),
  ]);
});

test("an include whose repeated title drops and that renders no headings may sit before more text", () => {
  const gp: SourcedTree = { tree: plainTree({ "index.block.md": "---\n---\n\n# Gate protocol\n\nGate intro.\n" }, "gp"), plugin: "mattstack", version: "2.0.0" };
  const host = plainTree({
    "index.block.md": "---\n---\n\n# host\n",
    "uses.block.md": "---\n---\n\n# Gate protocol\n\n{{include:gp}}\n\nAfter text.\n",
  });
  const { body } = render(host, { includes: resolver({ gp }) });
  expect(body).toContain("Gate intro.");
  expect(body).toContain("After text.");
});

test("a headless child after its parent's heading-carrying include is text-after-include at the child, naming the heading", () => {
  const host = plainTree({
    "index.block.md": "---\n---\n\n# host\n",
    "gates/index.block.md": "---\n---\n\n# Gates\n\n{{include:gp}}\n",
    "gates/note.block.md": "---\n---\nA note about Gates as a whole.\n",
  });
  const [d, ...rest] = diagnosticsOf(() => render(host, { includes: resolver({ gp: gpInclude() }) }));
  expect(rest).toEqual([]);
  expect(d).toEqual(expect.objectContaining({ file: "a/gates/note.block.md", line: 1, col: 1, code: "text-after-include" }));
  expect(d!.message).toContain('"#### Ask"');
});

test("a headless child after its parent's own sub-heading is text-after-include at the child", () => {
  const host = plainTree({
    "index.block.md": "---\n---\n\n# host\n\nIntro.\n\n## Detail\n\nDetail text.\n",
    "note.block.md": "---\n---\nA note about host as a whole.\n",
  });
  const [d, ...rest] = diagnosticsOf(() => render(host));
  expect(rest).toEqual([]);
  expect(d).toEqual(expect.objectContaining({ file: "a/note.block.md", line: 1, col: 1, code: "text-after-include" }));
  expect(d!.message).toContain('"## Detail"');
});

test("a leftover slot or an unknown placeholder in a block is bad-value at its {{, keeping the message", () => {
  const tree = plainTree({ "index.block.md": "---\n---\n\n# host\n\n{{slot:rules}}\n" });
  expect(diagnosticsOf(() => render(tree))).toEqual([
    { file: "a/index.block.md", line: 6, col: 1, code: "bad-value", message: 'slot "rules" is not declared by this engine' },
  ]);
  const other = plainTree({ "index.block.md": "---\n---\n\n# Other\n\nSee {{bogus}} here.\n" });
  expect(diagnosticsOf(() => render(other))).toEqual([
    { file: "a/index.block.md", line: 6, col: 5, code: "bad-value", message: "unknown placeholder {{bogus}} at line 6" },
  ]);
});

test("a heading-less include may sit before more text", () => {
  const host = plainTree({
    "index.block.md": "---\n---\n\n# host\n",
    "uses.block.md": "---\n---\n\n# Uses\n\n{{include:note}}\n\nAfter text.\n",
  });
  const { body } = render(host, { includes: resolver({ note: noteInclude() }) });
  expect(body).toContain("Just a note.");
  expect(sourceOf(body, "Just a note.")).toBe("attachments/note/index.block.md:3");
  expect(sourceOf(body, "After text.")).toBe("a/uses.block.md:8");
});

test("stacked add values render in layer order with a blank line between", () => {
  const tree = plainTree({ "index.block.md": "---\nprops:\n  rules:\n    merge: add\n---\n\n# a\n\n{{props.rules}}\n" });
  const layers = { a: { rules: [{ layer: "base:acme-base", value: "mattstack:style-floor" }, { layer: "pack", value: "widgets:mini-rules" }] } };
  const { body } = renderTree({ tree, source: SOURCE, values: valuesFor(tree, rootsWithWidgets(), layers), includes: noIncludes, ctx: ctx() });
  expect(body).toContain("Write short sentences.\n\n<!-- part: prop:a.rules binding=widgets:mini-rules ");
  expect(body.indexOf("binding=mattstack:style-floor")).toBeLessThan(body.indexOf("binding=widgets:mini-rules"));
});

test("an include that reaches itself is bad-value at the include line", () => {
  const loop: SourcedTree = { tree: plainTree({ "index.block.md": "---\n---\n\n# Loop\n\nLoop text.\n\n  {{include:loop}}\n" }, "loop"), plugin: "mattstack", version: "1.0.0" };
  const host = plainTree({ "index.block.md": "---\n---\n\n# host\n\n{{include:loop}}\n" });
  expect(diagnosticsOf(() => render(host, { includes: resolver({ loop }) }))).toEqual([
    { file: "attachments/loop/index.block.md", line: 8, col: 3, code: "bad-value", message: "{{include:loop}} would include itself: loop -> loop" },
  ]);
});

test("a two-step include cycle names the chain", () => {
  const one: SourcedTree = { tree: plainTree({ "index.block.md": "---\n---\n\n# One\n\n{{include:two}}\n" }, "one"), plugin: "mattstack", version: "1.0.0" };
  const two: SourcedTree = { tree: plainTree({ "index.block.md": "---\n---\n\n# Two\n\n{{include:one}}\n" }, "two"), plugin: "mattstack", version: "1.0.0" };
  const host = plainTree({ "index.block.md": "---\n---\n\n# host\n\n{{include:one}}\n" });
  expect(diagnosticsOf(() => render(host, { includes: resolver({ one, two }) }))).toEqual([
    { file: "attachments/two/index.block.md", line: 6, col: 1, code: "bad-value", message: "{{include:one}} would include itself: one -> two -> one" },
  ]);
});

test("text after a headless block's blank-rendered first line maps to its own line", () => {
  const tree = plainTree({
    "index.block.md": "---\n---\n\n# a\n\nIntro.\n",
    "loose.block.md": "---\nprops:\n  extra:\n    merge: add\n    default: \"\"\n---\n{{props.extra}}\n\nMore text.\n",
  });
  expect(sourceOf(render(tree).body, "More text.")).toBe("a/loose.block.md:9");
});

test("text after a dropped-title include root's blank-rendered first line maps to its own line", () => {
  const gp: SourcedTree = {
    tree: plainTree({ "index.block.md": "---\nprops:\n  extra:\n    merge: add\n    default: \"\"\n---\n\n# Gate protocol\n\n{{props.extra}}\n\nGate intro.\n" }, "gp"),
    plugin: "mattstack",
    version: "2.0.0",
  };
  const host = plainTree({ "index.block.md": "---\n---\n\n# host\n", "gates.block.md": "---\n---\n\n# Gate protocol\n\n{{include:gp}}\n" });
  const values = new Map([...valuesFor(host, NO_ROOTS), ...valuesFor(gp.tree, NO_ROOTS)]);
  const { body } = renderTree({ tree: host, source: SOURCE, values, includes: resolver({ gp }), ctx: ctx() });
  expect(sourceOf(body, "Gate intro.")).toBe("attachments/gp/index.block.md:12");
});

test("an engine block and the include it holds vendor a same-named prop to distinct parts dirs", () => {
  const rules = "---\nprops:\n  rules:\n    merge: add\n---\n\n";
  const gp: SourcedTree = {
    tree: plainTree({ "index.block.md": `${rules}# Gate protocol\n\n{{props.rules}}\n`, "ask.block.md": `${rules}# Ask\n\n{{props.rules}}\n` }, "gp"),
    plugin: "mattstack",
    version: "2.0.0",
  };
  const host = plainTree({ "index.block.md": "---\n---\n\n# a\n", "gp.block.md": `${rules}# Gates\n\n{{props.rules}}\n\n{{include:gp}}\n` });
  const bound = [{ layer: "pack", value: "widgets:mini-rules" }];
  const roots = rootsWithWidgets();
  const values = new Map([
    ...valuesFor(host, roots, { "a/gp": { rules: bound } }),
    ...valuesFor(gp.tree, roots, { gp: { rules: bound }, "gp/ask": { rules: bound } }),
  ]);
  const { body } = renderTree({ tree: host, source: SOURCE, values, includes: resolver({ gp }), ctx: ctx() });
  const dirs = [...body.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/parts\/(\S+)\/lint\.sh/g)].map((m) => m[1]);
  expect(dirs).toEqual(["gp/rules", "+gp/rules", "+gp/ask/rules"]);
});

test("a non-root block's prop vendors under parts/<block path>/<prop>", () => {
  const tree = plainTree({
    "index.block.md": "---\n---\n\n# a\n",
    "flow/index.block.md": "---\n---\n\n# Flow\n",
    "flow/fast-checks.block.md": "---\nprops:\n  rules:\n    merge: add\n---\n\n# Fast checks\n\n{{props.rules}}\n",
  });
  const layers = { "a/flow/fast-checks": { rules: [{ layer: "pack", value: "widgets:mini-rules" }] } };
  const { body } = renderTree({ tree, source: SOURCE, values: valuesFor(tree, rootsWithWidgets(), layers), includes: noIncludes, ctx: ctx() });
  expect(body).toContain("Run ${CLAUDE_SKILL_DIR}/parts/flow/fast-checks/rules/lint.sh first.");
});

test("an include that is not a block tree renders as today's flat include", () => {
  const flat: AttachmentSource = {
    binding: "mattstack:flat", plugin: "mattstack", version: "1.0.0", dir: "/p/flat", srcPath: "attachments/flat/SKILL.md",
    bodyStartLine: 5, body: "flat A\nflat B", provides: "", allowedTools: [], extraFiles: [], registered: false, file: null,
  };
  const host = plainTree({ "index.block.md": "---\n---\n\n# host\n\n{{include:flat}}\n" });
  const { body, used } = render(host, { ctx: ctx({ includes: { flat } }) });
  expect(body).toContain("<!-- part: include:flat source=mattstack:flat version=1.0.0 path=attachments/flat/SKILL.md lines=5-6 -->\nflat A\nflat B");
  expect(used.includes).toEqual(["flat"]);
});
