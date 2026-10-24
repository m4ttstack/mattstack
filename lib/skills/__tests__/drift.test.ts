import { describe, expect, test } from "bun:test";
import { changedPartKeys, partExtents, skillMdDriftCauses } from "../drift.ts";

const compiled = [
  "---\nname: x\n---",
  "<!-- part: block:x source=mattstack:x version=1 path=a lines=1-2 -->\nstep body",
  "<!-- part: prop:x.domain binding=acme:d version=1 path=b lines=1-1 -->\nfill body",
  "<!-- part: include:note source=mattstack:note version=1 path=c lines=1-1 -->\nnote body",
].join("\n\n");

describe("skillMdDriftCauses", () => {
  test("identical artifacts have no cause", () => {
    expect(skillMdDriftCauses(compiled, compiled)).toEqual([]);
  });
  test("names each part whose text moved, once, in artifact order", () => {
    const moved = compiled.replace("step body", "step body v2").replace("note body", "note v2");
    expect(skillMdDriftCauses(compiled, moved)).toEqual(["source", "include"]);
  });
  test("a fill edit is a fill cause; its include sits in its own part", () => {
    expect(skillMdDriftCauses(compiled, compiled.replace("fill body", "fill v2"))).toEqual(["fill"]);
  });
  test("text before the first marker is frontmatter", () => {
    expect(skillMdDriftCauses(compiled, compiled.replace("name: x", "name: x\ndescription: d"))).toEqual(["frontmatter"]);
  });
  test("a rebound prop keeps its key and reads as a fill change", () => {
    const rebound = compiled.replace("prop:x.domain binding=acme:d", "prop:x.domain binding=acme:e");
    expect(skillMdDriftCauses(compiled, rebound)).toEqual(["fill"]);
  });
  test("a different part list is structure, whatever else differs", () => {
    const dropped = compiled.replace(/\n\n<!-- part: include:note[\s\S]*$/, "");
    expect(skillMdDriftCauses(compiled, dropped)).toEqual(["structure"]);
  });

  const blocks = [
    "---\nname: mini\n---",
    "<!-- part: block:mini source=mattstack:mini version=1 path=a/index.block.md lines=11-13 -->\n# mini\n\nroot text",
    "<!-- part: block:mini/gate source=mattstack:mini version=1 path=a/gate.block.md lines=4-6 -->\n## Gate\n\ngate text",
    "<!-- part: prop:mini/gate.tiering binding=acme:t version=1 path=b lines=1-1 -->\nprop body",
  ].join("\n\n");
  test("a block's text is a source cause and a prop's body a fill cause", () => {
    expect(skillMdDriftCauses(blocks, blocks.replace("gate text", "gate v2"))).toEqual(["source"]);
    expect(skillMdDriftCauses(blocks, blocks.replace("prop body", "prop v2"))).toEqual(["fill"]);
  });
  test("a dropped block seam is structure", () => {
    expect(skillMdDriftCauses(blocks, blocks.replace(/<!-- part: block:mini\/gate [^\n]*\n/, ""))).toEqual(["structure"]);
  });
});

describe("partExtents", () => {
  test("bounds each include part by its marker's line count", () => {
    const md = ["step", "<!-- part: include:g source=m:g version=0.28.10 path=a lines=7-8 -->", "g1", "g2", "step after"].join("\n");
    expect(partExtents(md)).toEqual([{ key: "include:g", version: "0.28.10", start: 1, end: 3, text: "g1\ng2" }]);
  });
});

describe("changedPartKeys", () => {
  test("ignores version bumps and reports only parts whose text changed", () => {
    const before = "<!-- part: include:g source=m:g version=1 path=a lines=1-1 -->\nsame\n<!-- part: prop:x.d binding=x version=1 path=b lines=1-1 -->\nold";
    const after = "<!-- part: include:g source=m:g version=2 path=a lines=1-1 -->\nsame\n<!-- part: prop:x.d binding=x version=1 path=b lines=1-1 -->\nnew";
    expect([...changedPartKeys(before, after)]).toEqual(["prop:x.d"]);
  });
});

describe("partExtents on compiled shapes", () => {
  const legacy = [
    "step", "",
    "<!-- part: prop:x.d binding=x version=1 path=b lines=1-3 -->", "",
    "f1", "f2", "f3", "",
    "<!-- part: include:n source=m:n version=1 path=c lines=1-2 -->", "n1", "n2", "",
  ].join("\n");

  test("an inlined value skips a blank line under its marker and covers every fill line", () => {
    expect(partExtents(legacy)).toEqual([
      { key: "prop:x.d", version: "1", start: 2, end: 6, text: "f1\nf2\nf3" },
      { key: "include:n", version: "1", start: 8, end: 10, text: "n1\nn2" },
    ]);
  });

  test("an edit to the last fill line is detected", () => {
    expect([...changedPartKeys(legacy, legacy.replace("f3", "f3 edited"))]).toEqual(["prop:x.d"]);
  });

  const nested = [
    "<!-- part: prop:x.d binding=x version=1 path=b lines=1-3 -->", "",
    "intro",
    "<!-- part: include:x source=m:x version=1 path=c lines=1-2 -->", "x1", "x2",
    "trailing",
    "", "after",
  ].join("\n");

  test("a fill with a nested include is bounded by its source lines, and the include keeps its own extent", () => {
    const extents = partExtents(nested);
    expect(extents.map((e) => [e.key, e.start, e.end])).toEqual([["prop:x.d", 0, 6], ["include:x", 3, 5]]);
    expect(extents[1]!.text).toBe("x1\nx2");
  });

  test("trailing prose after a nested include marks the prop changed, not the include", () => {
    expect([...changedPartKeys(nested, nested.replace("trailing", "trailing v2"))]).toEqual(["prop:x.d"]);
  });

  test("a nested include's body change marks the include and the prop that contains it", () => {
    expect([...changedPartKeys(nested, nested.replace("x1", "x1 v2"))].sort()).toEqual(["include:x", "prop:x.d"]);
  });

  test("a nested include's version bump alone changes nothing", () => {
    expect([...changedPartKeys(nested, nested.replace("include:x source=m:x version=1", "include:x source=m:x version=2"))]).toEqual([]);
  });

  test("a trailing newline adds no phantom line to the last part", () => {
    expect(partExtents("<!-- part: include:g source=m:g version=1 path=a lines=1-5 -->\ng1\n")).toEqual([
      { key: "include:g", version: "1", start: 0, end: 1, text: "g1" },
    ]);
  });
});

describe("partExtents on a block-compiled body", () => {
  const seam = (id: string, path: string, lines: string) => `<!-- part: block:${id} source=mattstack:mini version=1.0.0 path=${path} lines=${lines} -->`;
  const md = (rules = ["Follow the rules.", "Run lint first."], gate = "Ask the human.") => [
    "---", "name: mini", "---", "",
    seam("mini", "a/index.block.md", "11-24"), "# mini", "", "Runs the step.", "",
    "<!-- part: prop:mini.rules binding=widgets:mini-rules/fast version=0.1.0 path=attachments/mini-rules/fast.md lines=1-2 -->",
    ...rules,
    seam("mini", "a/index.block.md", "24-24"), "Root text after the prop.",
    "",
    seam("mini/gate", "a/gate.block.md", "11-15"), "## Ask the gate", "", gate, "",
    "<!-- part: prop:mini/gate.tiering binding=mattstack:model-tiering version=1.0.0 path=skills/model-tiering/SKILL.md lines=8-30 -->",
    "For tiering, invoke the `mattstack:model-tiering` skill (mattstack:model-tiering@1.0.0) when this flow needs it.",
    "",
    "<!-- part: include:note source=mattstack:note version=1.0.0 path=attachments/note/SKILL.md lines=7-7 -->", "note body",
  ].join("\n") + "\n";

  test("a block's repeated seams are one part holding only its own text; props and includes are their own parts", () => {
    const extents = partExtents(md());
    expect(extents.map((e) => [e.key, e.version, e.start, e.end])).toEqual([
      ["block:mini", "1.0.0", 4, 13],
      ["prop:mini.rules", "0.1.0", 9, 11],
      ["block:mini/gate", "1.0.0", 15, 24],
      ["prop:mini/gate.tiering", "1.0.0", 20, 21],
      ["include:note", "1.0.0", 23, 24],
    ]);
    expect(extents[0]!.text).toBe("# mini\n\nRuns the step.\n\nRoot text after the prop.");
    expect(extents[1]!.text).toBe("Follow the rules.\nRun lint first.");
    expect(extents[2]!.text).toBe("## Ask the gate\n\nAsk the human.");
    expect(extents[3]!.text).toBe("For tiering, invoke the `mattstack:model-tiering` skill (mattstack:model-tiering@1.0.0) when this flow needs it.");
  });

  test("a reference line an older compile wrote is still one line", () => {
    const old = md().replace(
      "For tiering, invoke the `mattstack:model-tiering` skill (mattstack:model-tiering@1.0.0) when this flow needs it.",
      "Prop tiering is bound to `mattstack:model-tiering` (mattstack:model-tiering@1.0.0) -- invoke that skill when this flow needs it.",
    );
    const tiering = partExtents(old).find((e) => e.key === "prop:mini/gate.tiering")!;
    expect([tiering.start, tiering.end]).toEqual([20, 21]);
  });

  test("a value edit changes only its prop; a block edit only its block", () => {
    expect([...changedPartKeys(md(), md(["Follow the rules.", "Run lint twice."]))]).toEqual(["prop:mini.rules"]);
    expect([...changedPartKeys(md(), md(undefined, "Ask the human twice."))]).toEqual(["block:mini/gate"]);
  });

  test("two values of one add prop compare as one part", () => {
    const two = (second: string) => [
      "<!-- part: prop:mini.rules binding=acme:base-rules version=1 path=a.md lines=1-1 -->", "base rules", "",
      "<!-- part: prop:mini.rules binding=widgets:rules version=1 path=b.md lines=1-1 -->", second,
    ].join("\n");
    expect([...changedPartKeys(two("team rules"), two("team rules"))]).toEqual([]);
    expect([...changedPartKeys(two("team rules"), two("team rules v2"))]).toEqual(["prop:mini.rules"]);
  });
});

describe("partExtents with a section nested in a prop value", () => {
  const withSection = (body: string[]) => [
    "<!-- part: prop:x.ci binding=acme-base:ci version=1 path=b lines=1-3 -->",
    "intro",
    "<!-- part: section:ci-extra source=widgets:pack/sections/ci-extra.md version=0.4.0 path=pack/sections/ci-extra.md lines=1-3 -->",
    ...body,
    "outro",
    "",
    "<!-- part: include:after source=m:after version=1 path=c lines=1-1 -->",
    "after body",
  ].join("\n");
  const md = withSection(["s1", "s2", "s3"]);

  test("a value holding a 3-line section ends after the section body, and the next part starts after it", () => {
    const extents = partExtents(md);
    expect(extents.map((e) => [e.key, e.start, e.end])).toEqual([["prop:x.ci", 0, 6], ["section:ci-extra", 2, 5], ["include:after", 8, 9]]);
    expect(extents[1]!.text).toBe("s1\ns2\ns3");
  });

  test("a section edit is a team cause, not a fill or structure change", () => {
    expect(skillMdDriftCauses(md, withSection(["s1", "s2 edited", "s3"]))).toEqual(["team"]);
  });

  test("a section edit marks the section and the prop that contains it", () => {
    expect([...changedPartKeys(md, withSection(["s1", "s2 edited", "s3"]))].sort()).toEqual(["prop:x.ci", "section:ci-extra"]);
  });

  test("a section's version bump alone changes nothing", () => {
    expect([...changedPartKeys(md, md.replace("version=0.4.0", "version=0.5.0"))]).toEqual([]);
  });
});
