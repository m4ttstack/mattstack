import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childEnv } from "../../../subprocess.ts";
import { parseDot, toDot } from "../dot.ts";
import { parseMermaid } from "../mermaid.ts";

const src = `flowchart TB\n  run_open([Trigger: a ship run is open])\n  checks_pass{Checks pass?}\n  git_push[/git_push {tree: <root>}/]\n  stop_it[STOP: no]:::stop\n  done(((Shipped))):::done\n  run_open --> checks_pass\n  checks_pass -->|yes| git_push --> done\n  checks_pass -->|no| stop_it\n`;
const hasDot = Bun.which("dot") !== null || Bun.spawnSync(["test", "-x", "/opt/homebrew/bin/dot"]).exitCode === 0;

test.skipIf(!hasDot)("the dot passes check-dot --short-ids", () => {
  const dir = mkdtempSync(join(tmpdir(), "blocks-dot-"));
  const file = join(dir, "g.dot");
  writeFileSync(file, toDot(parseMermaid(src, "f", 1), new Map()));
  const env = { ...childEnv(), PATH: `/opt/homebrew/bin:${process.env.PATH ?? ""}` } as Record<string, string>;
  const r = Bun.spawnSync(
    ["python3", "plugins/mattstack/plugin/skills/process-digraphs/check-dot.py", "--short-ids", file],
    { env },
  );
  expect(r.stdout.toString()).toContain("1 graph(s) checked, ok");
  expect(r.exitCode).toBe(0);
});

test("parseDot reads quoted ids, mixed separators, extra attributes and escapes", () => {
  const g = parseDot(
    `digraph x {\n  rankdir=TB;\n  node [shape=box];\n  "Some node" [shape=box];\n  a [label="say \\"hi\\"", shape=diamond style=dashed fontcolor=white];\n  a -> "Some node" [label="yes"];\n  "Some node" -> a;\n}\n`,
  );
  expect(g.nodes).toEqual([
    { id: "Some node", label: "Some node", shape: "box" },
    { id: "a", label: 'say "hi"', shape: "diamond", style: "dashed" },
  ]);
  expect(g.edges).toEqual([
    { from: "a", to: "Some node", label: "yes" },
    { from: "Some node", to: "a", label: null },
  ]);
});

test("parseDot reads the whole ship graph", () => {
  const text = readFileSync("plugins/mattstack/attachments/pipeline/ship/SKILL.md", "utf8");
  const start = text.indexOf("digraph ship {");
  const body = text.slice(start, text.indexOf("\n}\n", start) + 3);
  const g = parseDot(body);
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
