import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlockError } from "../diagnostics.ts";
import { loadBlockTree } from "../tree.ts";

const DIR = join(import.meta.dir, "..", "..", "__tests__", "fixtures", "blocks", "plugins", "mattstack", "attachments", "pipeline", "mini");
const a = { idPrefix: "a", relRoot: "a" };
const made: string[] = [];

afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmpTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "blocks-order-"));
  made.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

const GRAPH = "# a\n\n```mermaid\nflowchart TB\n  one\n  two\n  one --> two\n```\n";
const plain = (extra: string) => `---\n${extra}---\n\n# T\n`;

function diagnose(files: Record<string, string>) {
  try {
    loadBlockTree(tmpTree(files), a);
  } catch (e) {
    if (e instanceof BlockError) return e.diagnostics;
    throw e;
  }
  throw new Error("expected a BlockError");
}

test("graph children follow the graph, then order, then filename", () => {
  const tree = loadBlockTree(DIR, { idPrefix: "mini", relRoot: "attachments/pipeline/mini" });
  expect(tree.root.children.map((b) => b.id)).toEqual(["mini/run", "mini/gate", "mini/notes", "mini/guard"]);
});

test("graph order wins over filename and a graph-only node is fine", () => {
  const dir = tmpTree({
    "index.block.md": "---\n---\n\n# a\n\n```mermaid\nflowchart TB\n  one\n  two\n  three\n  one --> two --> three\n```\n",
    "aaa.block.md": plain("node: two\n"),
    "zzz.block.md": plain("node: one\n"),
  });
  expect(loadBlockTree(dir, a).root.children.map((b) => b.id)).toEqual(["a/zzz", "a/aaa"]);
});

test("order sorts ascending before blocks without order", () => {
  const dir = tmpTree({
    "index.block.md": "---\n---\n\n# a\n",
    "a1.block.md": plain(""),
    "b2.block.md": plain("order: 5\n"),
    "c3.block.md": plain("order: 1\n"),
  });
  expect(loadBlockTree(dir, a).root.children.map((b) => b.id)).toEqual(["a/c3", "a/b2", "a/a1"]);
});

test("two siblings with the same order name both files", () => {
  const d = diagnose({
    "index.block.md": "---\n---\n\n# a\n",
    "x.block.md": plain("order: 1\n"),
    "y.block.md": plain("\norder: 1\n"),
  });
  expect(d).toHaveLength(1);
  expect(d[0]).toMatchObject({ code: "duplicate-order", file: "a/y.block.md", line: 3, col: 1 });
  expect(d[0]!.message).toContain("a/x.block.md");
});

test("order on a graph child is refused at its order key", () => {
  const d = diagnose({
    "index.block.md": `---\n---\n\n${GRAPH}`,
    "x.block.md": plain("node: one\norder: 3\n"),
  });
  expect(d).toHaveLength(1);
  expect(d[0]).toMatchObject({ code: "order-on-graph-child", file: "a/x.block.md", line: 3, col: 1 });
});

test("a node absent from the graph is missing-node at its node key", () => {
  const d = diagnose({
    "index.block.md": `---\n---\n\n${GRAPH}`,
    "x.block.md": plain("order: 1\nnode: nowhere\n"),
  });
  expect(d.map((x) => x.code)).toEqual(["missing-node", "order-on-graph-child"]);
  expect(d[0]).toMatchObject({ file: "a/x.block.md", line: 3, col: 1 });
  expect(d[0]!.message).toContain("a/index.block.md:6");
  expect(d[1]).toMatchObject({ file: "a/x.block.md", line: 2, col: 1 });
});

test("a node under a parent with no graph is missing-node", () => {
  const d = diagnose({
    "index.block.md": "---\n---\n\n# a\n",
    "x.block.md": plain("node: one\n"),
  });
  expect(d.map((x) => x.code)).toEqual(["missing-node"]);
});

test("a headless block with a node is node-unbound", () => {
  const d = diagnose({
    "index.block.md": `---\n---\n\n${GRAPH}`,
    "x.block.md": "---\nnode: one\n---\nno title\n",
  });
  expect(d.map((x) => x.code)).toEqual(["node-unbound"]);
  expect(d[0]).toMatchObject({ file: "a/x.block.md", line: 2 });
});

test("two siblings on one node is duplicate-node naming both files", () => {
  const d = diagnose({
    "index.block.md": `---\n---\n\n${GRAPH}`,
    "x.block.md": plain("node: one\n"),
    "y.block.md": plain("node: one\n"),
  });
  expect(d).toHaveLength(1);
  expect(d[0]).toMatchObject({ code: "duplicate-node", file: "a/y.block.md" });
  expect(d[0]!.message).toContain("a/x.block.md");
});

test("every ordering diagnostic is collected into one error", () => {
  const d = diagnose({
    "index.block.md": `---\n---\n\n${GRAPH}`,
    "x.block.md": plain("node: one\norder: 1\n"),
    "y.block.md": plain("node: nowhere\n"),
  });
  expect(d.map((x) => x.code).sort()).toEqual(["missing-node", "order-on-graph-child"]);
});
