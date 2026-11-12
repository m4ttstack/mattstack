import { describe, expect, test } from "bun:test";
import { builtVersionOf, builtVersionsOf, linksIn, partsFromMarkers } from "../anatomy.ts";
import { readLock } from "../compiled-lock.ts";

describe("partsFromMarkers", () => {
  test("a block engine yields a part per seam: its blocks, then each prop value inside them", () => {
    const md = [
      "---", "name: x", "---", "",
      "<!-- part: block:x source=mattstack:x version=1 path=a/index.block.md lines=5-6 -->", "# x", "", "body",
      "<!-- part: prop:x.domain binding=acme:p version=2 path=b lines=1-1 -->", "fill",
    ].join("\n");
    const parts = partsFromMarkers(md, {}, new Set(["prop:x.domain"]));
    expect(parts.map((p) => [p.kind, p.name, p.templateLines, p.renderedLines, p.mode, p.changed])).toEqual([
      ["block", "x", null, [5, 10], null, false],
      ["prop", "x.domain", null, [9, 10], "inline", true],
    ]);
  });

  test("a prop bound by reference is its one reference line, in reference mode", () => {
    const md = [
      "<!-- part: block:x source=mattstack:x version=1 path=a/index.block.md lines=5-6 -->", "body",
      "<!-- part: prop:x.tiering binding=mattstack:model-tiering version=1 path=skills/model-tiering/SKILL.md lines=8-30 -->",
      "For tiering, invoke the `mattstack:model-tiering` skill (mattstack:model-tiering@1) when this flow needs it.",
    ].join("\n");
    expect(partsFromMarkers(md, {}, new Set()).at(-1)).toMatchObject({ kind: "prop", name: "x.tiering", renderedLines: [3, 4], mode: "reference" });
  });

  test("a nested include keeps its own part and the prop value still covers the trailing prose", () => {
    const md = [
      "<!-- part: block:x source=mattstack:x version=1 path=a lines=1-1 -->", "b", "",
      "<!-- part: prop:x.d binding=acme:p version=1 path=b lines=1-3 -->",
      "intro",
      "<!-- part: include:n source=m:n version=1 path=c lines=1-2 -->", "n1", "n2",
      "trailing",
    ].join("\n");
    expect(partsFromMarkers(md, {}, new Set()).map((p) => [p.kind, p.name, p.renderedLines])).toEqual([
      ["block", "x", [1, 9]],
      ["prop", "x.d", [4, 9]],
      ["include", "n", [6, 8]],
    ]);
  });
});

describe("partsFromMarkers with a section", () => {
  const md = [
    "<!-- part: block:x source=mattstack:x version=1 path=a lines=1-1 -->", "step", "",
    "<!-- part: prop:x.ci binding=acme-base:ci version=1 path=b lines=1-3 -->",
    "intro",
    "<!-- part: section:ci-extra source=widgets:pack/sections/ci-extra.md version=0.4.0 path=pack/sections/ci-extra.md lines=1-2 -->", "s1", "s2",
    "outro", "",
  ].join("\n");

  test("the prop's rendered lines include the section body, and the section is its own part", () => {
    const source = { ref: "widgets:pack/sections/ci-extra.md", path: "/p/pack/sections/ci-extra.md", version: "0.4.0", builtVersion: "0.4.0", lines: 2 };
    expect(partsFromMarkers(md, { "section:ci-extra": source }, new Set(["section:ci-extra"])).slice(1).map((p) => [p.kind, p.name, p.renderedLines, p.changed, p.source?.ref ?? null])).toEqual([
      ["prop", "x.ci", [4, 9], false, null],
      ["section", "ci-extra", [6, 8], true, "widgets:pack/sections/ci-extra.md"],
    ]);
  });
});

describe("linksIn", () => {
  test("a word ending in parts is not a vendored part path, but a skill-dir prefix is", () => {
    const md = "see counterparts/x.md\nand ${CLAUDE_SKILL_DIR}/parts/include-x/references/r.md";
    expect(linksIn(md)).toEqual([{ path: "parts/include-x/references/r.md", line: 2 }]);
  });

  test("finds relative skill paths and vendored parts once each, with their first line", () => {
    const md = "a\nsee ../../attachments/gates/SKILL.md\nand ../../attachments/gates/SKILL.md\nparts/include-x/references/strategies.md";
    expect(linksIn(md)).toEqual([
      { path: "../../attachments/gates/SKILL.md", line: 2 },
      { path: "parts/include-x/references/strategies.md", line: 4 },
    ]);
  });
});

describe("built versions", () => {
  test("builtVersion falls back to the lock", () => {
    expect(builtVersionOf(null, "acme", { acme: "0.4.12" })).toBe("0.4.12");
    expect(builtVersionOf("0.4.11", "acme", { acme: "0.4.12" })).toBe("0.4.11");
    expect(builtVersionOf(null, "acme", undefined)).toBeNull();
    expect(builtVersionOf(null, null, { acme: "0.4.12" })).toBeNull();
  });

  test("a pack compiled half old, half new reads a built version for both targets", () => {
    const rendered = (v: (n: string) => string) => [
      "---", "name: x", "---", "",
      `<!-- part: block:x source=mattstack:x${v("0.32.55")} path=a/index.block.md lines=5-6 -->`, "# x", "", "body",
      `<!-- part: prop:x.domain binding=acme:p${v("0.4.11")} path=b lines=1-1 -->`, "fill",
      `<!-- part: include:n source=mattstack:n${v("0.32.55")} path=c lines=1-1 -->`, "n1",
    ].join("\n");
    const old = rendered((n) => ` version=${n}`);
    const fresh = rendered(() => "");
    const lock = readLock("/pack", () => JSON.stringify({ targets: { "skills/fresh": { mattstack: "0.32.56", acme: "0.4.12" } } }));

    const fromSeams = builtVersionsOf(old, lock.targets["skills/old"]);
    expect(fromSeams.root).toBe("0.32.55");
    expect(Object.fromEntries(fromSeams.parts)).toEqual({ "block:x": ["0.32.55"], "prop:x.domain": ["0.4.11"], "include:n": ["0.32.55"] });

    const fromLock = builtVersionsOf(fresh, lock.targets["skills/fresh"]);
    expect(fromLock.root).toBe("0.32.56");
    expect(Object.fromEntries(fromLock.parts)).toEqual({ "block:x": ["0.32.56"], "prop:x.domain": ["0.4.12"], "include:n": ["0.32.56"] });
  });

  test("a versionless file with no lock entry reads no built version rather than throwing", () => {
    const fresh = "<!-- part: block:x source=mattstack:x path=a lines=1-1 -->\nbody";
    expect(builtVersionsOf(fresh, undefined)).toEqual({ root: null, parts: new Map([["block:x", [null]]]) });
  });
});
