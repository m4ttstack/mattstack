import { describe, expect, test } from "bun:test";
import { graphRoots, uncompiledRoots } from "../block-graphs-compiled.ts";

const GRAPH = "text\n\n```mermaid\nflowchart TD\n```\n";

describe("graphRoots", () => {
  test("a graph in a child block belongs to the topmost folder with an index", () => {
    const files = {
      "forge/checkout/index.block.md": "root",
      "forge/checkout/gates/index.block.md": "child index",
      "forge/checkout/gates/step.block.md": GRAPH,
    };
    expect(graphRoots(files)).toEqual(["attachments/forge/checkout/"]);
  });

  test("a tree without a mermaid fence is not a root", () => {
    expect(graphRoots({ "forge/map/index.block.md": "no graph here" })).toEqual([]);
  });

  test("a single-level engine is its own root", () => {
    expect(graphRoots({ "gate-protocol/index.block.md": GRAPH })).toEqual(["attachments/gate-protocol/"]);
  });
});

describe("uncompiledRoots", () => {
  const part = (path: string) => `<!-- part: block:x source=mattstack:x version=1 path=${path} lines=1-2 -->`;

  test("a root named by a part marker is compiled", () => {
    expect(uncompiledRoots(["attachments/forge/checkout/"], [part("attachments/forge/checkout/gates/index.block.md")])).toEqual([]);
  });

  test("a root no marker names is reported", () => {
    expect(uncompiledRoots(["attachments/pipeline/ship/", "attachments/forge/checkout/"], [part("attachments/forge/checkout/index.block.md")])).toEqual(["attachments/pipeline/ship/"]);
  });

  test("a sibling sharing a name prefix does not count", () => {
    expect(uncompiledRoots(["attachments/pipeline/ship/"], [part("attachments/pipeline/ship-it/index.block.md")])).toEqual(["attachments/pipeline/ship/"]);
  });
});
