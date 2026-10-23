import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childEnv } from "../../../subprocess.ts";
import { parseDot, toDot } from "../dot.ts";
import { parseMermaid } from "../mermaid.ts";

const src = `flowchart TB\n  run_open([Trigger: a ship run is open])\n  checks_pass{Checks pass?}\n  git_push[/git_push {tree: <root>}/]\n  stop_it[STOP: no]:::stop\n  done(((Shipped))):::done\n  run_open --> checks_pass\n  checks_pass -->|yes| git_push --> done\n  checks_pass -->|no| stop_it\n`;
const hasDot = Bun.which("dot") !== null || existsSync("/opt/homebrew/bin/dot");

test.skipIf(!hasDot)("the dot passes check-dot --short-ids", () => {
  const dir = mkdtempSync(join(tmpdir(), "blocks-dot-"));
  const file = join(dir, "g.dot");
  writeFileSync(file, toDot(parseMermaid(src, "f", 1), new Map()));
  const env = { ...childEnv(), PATH: `/opt/homebrew/bin:${process.env.PATH ?? ""}` } as Record<string, string>;
  const r = Bun.spawnSync(
    ["python3", "plugins/mattstack/plugin/skills/process-digraphs/check-dot.py", "--short-ids", file],
    { env },
  );
  rmSync(dir, { recursive: true, force: true });
  expect(r.stdout.toString()).toContain("1 graph(s) checked, ok");
  expect(r.exitCode).toBe(0);
});

test("parseDot reads quoted ids, mixed separators, extra attributes and escapes", () => {
  const g = parseDot(
    `digraph x {\n  rankdir=TB;\n  node [shape=box];\n  "Some node" [shape=box];\n  a [label="say \\"hi\\"", shape=diamond style=dashed fontcolor=white];\n  a -> "Some node" [label="yes"];\n  "Some node" -> a;\n}\n`,
  );
  expect(g.nodes).toEqual([
    { id: "Some node", label: "Some node", shape: "box" },
    { id: "a", label: 'say "hi"', shape: "diamond", style: "dashed", fontcolor: "white" },
  ]);
  expect(g.edges).toEqual([
    { from: "a", to: "Some node", label: "yes" },
    { from: "Some node", to: "a", label: null },
  ]);
});

test("parseDot reads the whole ship graph", () => {
  // ship's flow graph as the slot engine wrote it in dot, before it became a block tree.
  const g = parseDot(readFileSync(join(import.meta.dir, "..", "..", "__tests__", "fixtures", "blocks", "ship-flow.dot"), "utf8"));
  expect(g.edges.length).toBe(174);
  expect(g.nodes.length).toBe(112);
  expect(g.nodes.every((n) => n.label !== n.id)).toBe(true);
  expect(g.nodes.find((n) => n.id === "run_open")).toEqual({
    id: "run_open",
    label: "Trigger: a ship run is open (own or inherited)",
    shape: "ellipse",
  });
  expect(g.nodes.find((n) => n.id === "stop_ship_default_branch")).toMatchObject({ shape: "octagon", style: "filled", fillcolor: "red" });
  expect(g.edges).toContainEqual({ from: "reopened_recapture", to: "git_branch_current", label: "no" });
});

test("parseDot expands brace groups, keeps edge style and node fontcolor, and skips tabs", () => {
  const g = parseDot(
    'digraph x {\n  subgraph s { a }\n  {a b} -> {c d} [label="hold"];\n  e\t-> f [style=dashed];\n  n [shape=box fontcolor=white];\n}\n',
  );
  expect(g.edges).toEqual([
    { from: "a", to: "c", label: "hold" },
    { from: "a", to: "d", label: "hold" },
    { from: "b", to: "c", label: "hold" },
    { from: "b", to: "d", label: "hold" },
    { from: "e", to: "f", label: null, style: "dashed" },
  ]);
  expect(g.nodes.find((n) => n.id === "n")).toMatchObject({ fontcolor: "white" });
});

test("parseDot reads stage-evidence's brace-group edges", () => {
  const text = readFileSync("plugins/mattstack/attachments/pipeline/stage-evidence/SKILL.md", "utf8");
  const start = text.indexOf("digraph evidence {");
  const g = parseDot(text.slice(start, text.indexOf("\n}\n", start) + 3));
  expect(g.edges.length).toBe(91);
  for (const from of ["record_outcome", "attach_outcome"]) {
    expect(g.edges).toContainEqual({ from, to: "run_hold", label: "Record held, or Attach held" });
  }
});
