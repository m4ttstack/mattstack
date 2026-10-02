import { describe, expect, test } from "bun:test";
import { buildParts, linksIn, partsFromMarkers, partsOnDisk, type AnatomyPart, type AnatomySource } from "../anatomy.ts";
import type { TraceEntry } from "../placeholders.ts";

const gate: AnatomySource = { ref: "mattstack:gate-protocol", path: "/m/attachments/gate-protocol/SKILL.md", version: "0.30.4", builtVersion: "0.28.10", lines: 446 };
const entry = (templateIndex: number, outStart: number, outCount: number, ph: [string, string | null][] = []): TraceEntry =>
  ({ templateIndex, outStart, outCount, placeholders: ph.map(([kind, arg]) => ({ kind, arg })) });

describe("buildParts", () => {
  test("merges plain lines into text parts and splits placeholders out", () => {
    const parts = buildParts({
      bodyStartLine: 14, bodyOffset: 9,
      trace: [entry(0, 0, 1), entry(1, 1, 1), entry(2, 2, 447, [["include", "gate-protocol"]]), entry(3, 449, 1), entry(4, 450, 1, [["stage.fields", null]])],
      sources: { "include:gate-protocol": gate }, targets: {}, slotModes: {}, changedKeys: new Set(),
    });
    expect(parts).toEqual([
      { kind: "text", name: null, templateLines: [14, 15], renderedLines: [10, 11], mode: null, source: null, target: null, changed: false },
      { kind: "include", name: "gate-protocol", templateLines: [16, 16], renderedLines: [12, 458], mode: null, source: gate, target: null, changed: false },
      { kind: "text", name: null, templateLines: [17, 17], renderedLines: [459, 459], mode: null, source: null, target: null, changed: false },
      { kind: "variable", name: "stage.fields", templateLines: [18, 18], renderedLines: [460, 460], mode: null, source: null, target: null, changed: false },
    ]);
  });

  test("an empty slot has no rendered lines and keeps its mode", () => {
    const [part] = buildParts({ bodyStartLine: 1, bodyOffset: 0, trace: [entry(0, 0, 0, [["slot", "domain"]])], sources: {}, targets: {}, slotModes: { domain: "inline" }, changedKeys: new Set() });
    expect(part).toMatchObject({ kind: "slot", name: "domain", renderedLines: null, mode: "inline" });
  });

  test("verb.path parts carry their target; changed keys mark includes and slots", () => {
    const parts = buildParts({
      bodyStartLine: 29, bodyOffset: 0,
      trace: [entry(0, 0, 1, [["verb.path", "stage-plan"]]), entry(1, 1, 3, [["slot", "domain"]])],
      sources: {}, targets: { "stage-plan": { skill: "stage-plan", path: "/p/attachments/stage-plan/SKILL.md", lines: 780 } },
      slotModes: { domain: "reference" }, changedKeys: new Set(["slot:domain"]),
    });
    expect(parts[0]).toMatchObject({ kind: "verb.path", name: "stage-plan", target: { lines: 780 } });
    expect(parts[1]).toMatchObject({ kind: "slot", mode: "reference", changed: true });
  });
});

describe("buildParts edge shapes", () => {
  test("a text run that renders nothing has no rendered lines", () => {
    const parts = buildParts({ bodyStartLine: 5, bodyOffset: 0, trace: [entry(0, 0, 0), entry(1, 0, 0), entry(2, 0, 1)], sources: {}, targets: {}, slotModes: {}, changedKeys: new Set() });
    expect(parts).toEqual([
      { kind: "text", name: null, templateLines: [5, 7], renderedLines: [1, 1], mode: null, source: null, target: null, changed: false },
    ]);
    const [dropped] = buildParts({ bodyStartLine: 5, bodyOffset: 0, trace: [entry(0, 0, 0), entry(1, 0, 0)], sources: {}, targets: {}, slotModes: {}, changedKeys: new Set() });
    expect(dropped).toMatchObject({ kind: "text", templateLines: [5, 6], renderedLines: null });
  });

  test("a line carrying two placeholders yields two parts on the same lines", () => {
    const parts = buildParts({
      bodyStartLine: 3, bodyOffset: 0,
      trace: [entry(0, 0, 2, [["stage.fields", null], ["verb.path", "stage-plan"]])],
      sources: {}, targets: { "stage-plan": { skill: "stage-plan", path: "/p/SKILL.md", lines: 10 } }, slotModes: {}, changedKeys: new Set(),
    });
    expect(parts.map((p) => [p.kind, p.name, p.templateLines, p.renderedLines])).toEqual([
      ["variable", "stage.fields", [3, 3], [1, 2]],
      ["verb.path", "stage-plan", [3, 3], [1, 2]],
    ]);
  });
});

describe("partsFromMarkers", () => {
  test("a legacy engine yields one text part plus a part per marker", () => {
    const md = ["---", "name: x", "---", "<!-- part: step source=mattstack:x version=1 path=a lines=5-6 -->", "", "body", "<!-- part: slot:domain binding=acme:p version=2 path=b lines=1-1 -->", "fill"].join("\n");
    const parts = partsFromMarkers(md, {}, new Set());
    expect(parts.map((p) => [p.kind, p.name, p.templateLines, p.renderedLines])).toEqual([
      ["text", null, null, [6, 6]],
      ["slot", "domain", null, [7, 8]],
    ]);
  });

  test("compiled shape: blank separators and a trailing newline add no phantom line", () => {
    const md = [
      "<!-- header -->", "",
      "<!-- part: step source=m:x version=1 path=a lines=1-2 -->", "",
      "body 1", "body 2", "",
      "<!-- part: slot:d binding=acme:p version=1 path=b lines=1-3 -->", "",
      "f1", "f2", "f3", "",
      "<!-- part: include:n source=m:n version=1 path=c lines=1-2 -->", "n1", "n2", "",
    ].join("\n");
    const parts = partsFromMarkers(md, {}, new Set());
    expect(parts.map((p) => [p.kind, p.name, p.renderedLines])).toEqual([
      ["text", null, [5, 7]],
      ["slot", "d", [8, 12]],
      ["include", "n", [14, 16]],
    ]);
  });

  test("a step with no parts after it ends at the last real line", () => {
    const md = ["<!-- part: step source=m:x version=1 path=a lines=1-2 -->", "", "body 1", "body 2", ""].join("\n");
    expect(partsFromMarkers(md, {}, new Set()).map((p) => p.renderedLines)).toEqual([[3, 4]]);
  });

  test("a slot name may contain a colon", () => {
    const md = ["<!-- part: step source=m:x version=1 path=a lines=1-1 -->", "", "b", "<!-- part: slot:a:b binding=acme:p version=1 path=b lines=1-1 -->", "fill"].join("\n");
    expect(partsFromMarkers(md, {}, new Set(["slot:a:b"])).at(-1)).toMatchObject({ kind: "slot", name: "a:b", changed: true });
  });

  test("a nested include keeps its own part and the slot still covers the trailing prose", () => {
    const md = [
      "<!-- part: step source=m:x version=1 path=a lines=1-1 -->", "", "b", "",
      "<!-- part: slot:d binding=acme:p version=1 path=b lines=1-3 -->", "",
      "intro",
      "<!-- part: include:x source=m:x version=1 path=c lines=1-2 -->", "x1", "x2",
      "trailing",
    ].join("\n");
    expect(partsFromMarkers(md, {}, new Set()).map((p) => [p.kind, p.name, p.renderedLines])).toEqual([
      ["text", null, [3, 4]],
      ["slot", "d", [5, 11]],
      ["include", "x", [8, 10]],
    ]);
  });
});

describe("partsOnDisk", () => {
  const part = (kind: AnatomyPart["kind"], name: string | null, renderedLines: [number, number]): AnatomyPart =>
    ({ kind, name, templateLines: [1, 1], renderedLines, mode: null, source: null, target: null, changed: false });

  test("named parts move to their on-disk marker, preferring a top-level one over a nested one; the rest lose their range", () => {
    const md = [
      "<!-- part: step source=m:s version=1 path=a lines=1-2 -->", "",
      "<!-- part: slot:d binding=acme:p version=1 path=b lines=1-2 -->",
      "intro",
      "<!-- part: include:x source=m:x version=1 path=c lines=1-1 -->", "x1",
      "<!-- part: include:x source=m:x version=1 path=c lines=1-1 -->", "x1",
      "",
    ].join("\n");
    const parts = [part("text", null, [1, 1]), part("slot", "d", [9, 9]), part("include", "x", [20, 21]), part("verb.path", "y", [30, 30])];
    expect(partsOnDisk(parts, md).map((p) => p.renderedLines)).toEqual([null, [3, 6], [7, 8], null]);
  });

  test("a part with no marker left on disk has no range", () => {
    const md = ["<!-- part: step source=m:s version=1 path=a lines=1-1 -->", "", "body"].join("\n");
    expect(partsOnDisk([part("include", "x", [3, 4])], md)[0]!.renderedLines).toBeNull();
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
