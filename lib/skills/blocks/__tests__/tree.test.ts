import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlockError } from "../diagnostics.ts";
import { isBlockTree, loadBlockTree, walk } from "../tree.ts";

const DIR = join(import.meta.dir, "..", "..", "__tests__", "fixtures", "blocks", "plugins", "mattstack", "attachments", "pipeline", "mini");
const opts = { idPrefix: "mini", relRoot: "attachments/pipeline/mini" };
const a = { idPrefix: "a", relRoot: "a" };

function tmpTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "blocks-tree-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

test("loads ids, depth and the root's engine frontmatter", () => {
  const tree = loadBlockTree(DIR, opts);
  expect(tree.root.id).toBe("mini");
  expect(tree.root.frontmatter.type).toBe("pipeline-step");
  expect([...tree.byId.keys()].sort()).toEqual(["mini", "mini/gate", "mini/guard", "mini/notes", "mini/run", "mini/run/check"]);
  expect(tree.byId.get("mini/gate")!.depth).toBe(1);
  expect(tree.byId.get("mini/gate")!.relPath).toBe("attachments/pipeline/mini/gate.block.md");
  expect(tree.byId.get("mini/run/check")!.relPath).toBe("attachments/pipeline/mini/run/check.block.md");
  expect(tree.byId.get("mini/run/check")!.depth).toBe(2);
});

test("walk is preorder with children in graph, then order, then name", () => {
  expect(walk(loadBlockTree(DIR, opts)).map((b) => b.id)).toEqual([
    "mini",
    "mini/run",
    "mini/run/check",
    "mini/gate",
    "mini/notes",
    "mini/guard",
  ]);
});

test("the root's mermaid fence becomes its graph", () => {
  const g = loadBlockTree(DIR, opts).root.graph!;
  expect(g.file).toBe("attachments/pipeline/mini/index.block.md");
  expect(g.nodes.map((n) => n.id)).toEqual(["start", "run_step", "ask_gate", "finish"]);
  expect(g.fenceLine).toBe(15);
});

test("isBlockTree", () => {
  expect(isBlockTree(DIR)).toBe(true);
  expect(isBlockTree(join(DIR, ".."))).toBe(false);
});

test("a headless block with children is refused", () => {
  const tmp = tmpTree({ "index.block.md": "---\n---\nno title\n", "x.block.md": "---\n---\n# X\n" });
  expect(() => loadBlockTree(tmp, a)).toThrow(/index\.block\.md:1:1: .*headless/);
});

test("a marker for an undeclared prop is refused with its position", () => {
  const tmp = tmpTree({ "index.block.md": "---\n---\n# A\n\n{{props.nope}}\n" });
  expect(() => loadBlockTree(tmp, a)).toThrow(/a\/index\.block\.md:5:1: /);
});

test("diagnostics from several files are collected", () => {
  const tmp = tmpTree({
    "index.block.md": "---\n---\n# A\n",
    "x.block.md": "---\n---\n# X\n\n{{props.one}}\n",
    "y.block.md": "---\n---\n# Y\n\n{{props.two}}\n",
  });
  let caught: unknown;
  try {
    loadBlockTree(tmp, a);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(BlockError);
  expect((caught as BlockError).diagnostics).toHaveLength(2);
});

test("a second mermaid fence is bad-graph at the second fence; a nested one is ignored", () => {
  const fence = "```mermaid\nflowchart TB\n  a --> b\n```\n";
  const tmp = tmpTree({ "index.block.md": `---\n---\n# A\n\n${fence}\n${fence}` });
  expect(() => loadBlockTree(tmp, a)).toThrow(/a\/index\.block\.md:10:1: /);
  const nested = tmpTree({ "index.block.md": "---\n---\n# A\n\n````md\n```mermaid\nnot a graph\n```\n````\n" });
  expect(loadBlockTree(nested, a).root.graph).toBeNull();
});

test("a sub-folder without index and other files are not blocks", () => {
  const tmp = tmpTree({ "index.block.md": "---\n---\n# A\n", "sub/step.md": "x", "notes.txt": "y" });
  expect(walk(loadBlockTree(tmp, a)).map((b) => b.id)).toEqual(["a"]);
});

test("a file and a folder with the same stem are a duplicate block naming both files", () => {
  const tmp = tmpTree({
    "index.block.md": "---\n---\n# A\n",
    "run.block.md": "---\n---\n# R\n",
    "run/index.block.md": "---\n---\n# R2\n",
  });
  expect(() => loadBlockTree(tmp, a)).toThrow(/a\/run\/index\.block\.md:1:1: .*a\/run\.block\.md/);
});

test("dot-files and symlinks are skipped", () => {
  const tmp = tmpTree({ "index.block.md": "---\n---\n# A\n", ".draft.block.md": "---\n---\n# D\n" });
  symlinkSync(tmp, join(tmp, "loop"));
  symlinkSync(join(tmp, "missing.block.md"), join(tmp, ".#gate.block.md"));
  symlinkSync(join(tmp, "nowhere.block.md"), join(tmp, "dangling.block.md"));
  expect(walk(loadBlockTree(tmp, a)).map((b) => b.id)).toEqual(["a"]);
});

test("a block file in a folder without an index is an orphan", () => {
  const tmp = tmpTree({ "index.block.md": "---\n---\n# A\n", "sub/step.block.md": "---\n---\n# S\n" });
  expect(() => loadBlockTree(tmp, a)).toThrow(/a\/sub\/step\.block\.md:1:1: .*index\.block\.md/);
});

test("a failing folder block still reports its children's diagnostics", () => {
  const tmp = tmpTree({
    "index.block.md": "---\n---\n# A\n\n{{props.one}}\n",
    "x.block.md": "---\n---\n# X\n\n{{props.two}}\n",
  });
  let caught: unknown;
  try {
    loadBlockTree(tmp, a);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(BlockError);
  expect((caught as BlockError).diagnostics.map((d) => d.file).sort()).toEqual(["a/index.block.md", "a/x.block.md"]);
});
