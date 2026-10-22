import { expect, test } from "bun:test";
import { graphOrder, parseMermaid } from "../mermaid.ts";
import { toDot } from "../dot.ts";

const src = `flowchart TB\n  run_open([Trigger: a ship run is open])\n  checks_pass{Checks pass (ship)?}\n  domain_fast_checks\n  git_push_upstream[/git_push {tree: <root>, setUpstream: true}/]\n  stop_shell_push[STOP: push only with git_push]:::stop\n  done(((Shipped))):::done\n  run_open --> domain_fast_checks --> checks_pass\n  checks_pass -->|yes| git_push_upstream\n  checks_pass -->|no| stop_shell_push\n  git_push_upstream --> done\n`;

test("parses shapes, classes, labels and chains", () => {
  const g = parseMermaid(src, "flow/index.block.md", 10);
  expect(g.nodes.find((n) => n.id === "run_open")).toMatchObject({ shape: "ellipse", label: "Trigger: a ship run is open" });
  expect(g.nodes.find((n) => n.id === "domain_fast_checks")!.label).toBeNull();
  expect(g.nodes.find((n) => n.id === "domain_fast_checks")!.shape).toBe("box");
  expect(g.nodes.find((n) => n.id === "stop_shell_push")!.cls).toBe("stop");
  expect(g.nodes.find((n) => n.id === "git_push_upstream")).toMatchObject({
    shape: "plaintext",
    label: "git_push {tree: <root>, setUpstream: true}",
  });
  expect(g.nodes.find((n) => n.id === "checks_pass")).toMatchObject({ shape: "diamond", label: "Checks pass (ship)?" });
  expect(g.nodes.find((n) => n.id === "done")).toMatchObject({ shape: "doublecircle", label: "Shipped", cls: "done" });
  expect(g.edges).toContainEqual({ from: "run_open", to: "domain_fast_checks", label: null, line: 18 });
  expect(g.edges).toContainEqual({ from: "checks_pass", to: "git_push_upstream", label: "yes", line: 19 });
  expect(graphOrder(g)).toEqual(["run_open", "checks_pass", "domain_fast_checks", "git_push_upstream", "stop_shell_push", "done"]);
});

test("an unknown line is a diagnostic at its line", () => {
  expect(() => parseMermaid("flowchart TB\n  a ==> b\n", "f.block.md", 3)).toThrow(/f\.block\.md:5:3: /);
});

test("a missing header, a conflicting shape and a text edge are handled", () => {
  expect(() => parseMermaid("a --> b\n", "f", 3)).toThrow(/f:4:1: /);
  expect(() => parseMermaid("graph TB\n a[x]\n a{y}\n", "f", 0)).toThrow(/f:3:2: /);
  const g = parseMermaid('graph TB\n %% name: ship\n a["Quoted one"] -- maybe --> b\n', "f", 0);
  expect(g.name).toBe("ship");
  expect(g.nodes[0]!.label).toBe("Quoted one");
  expect(g.edges[0]!.label).toBe("maybe");
});

test("toDot fills a block node's label from its title and refuses a disagreeing one", () => {
  const g = parseMermaid(src, "f", 1);
  const dot = toDot(g, new Map([["domain_fast_checks", "Run the domain's fast checks"]]));
  expect(dot).toContain(`domain_fast_checks [label="Run the domain's fast checks" shape=box];`);
  expect(dot).toContain(`stop_shell_push [label="STOP: push only with git_push" shape=octagon style=filled fillcolor=red fontcolor=white];`);
  expect(dot).toContain(`checks_pass -> git_push_upstream [label="yes"];`);
  expect(() => toDot(g, new Map([["run_open", "Other"]]))).toThrow(/label-disagrees|disagrees/);
});
