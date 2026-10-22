import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("walk is preorder with children by name", () => {
  expect(walk(loadBlockTree(DIR, opts)).map((b) => b.id)).toEqual([
    "mini",
    "mini/gate",
    "mini/guard",
    "mini/notes",
    "mini/run",
    "mini/run/check",
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
  try {
    loadBlockTree(tmp, a);
    throw new Error("expected BlockError");
  } catch (err) {
    expect((err as { diagnostics: unknown[] }).diagnostics).toHaveLength(2);
  }
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
