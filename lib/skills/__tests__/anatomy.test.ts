import { describe, expect, test } from "bun:test";
import { buildParts, linksIn, partsFromMarkers, type AnatomySource } from "../anatomy.ts";
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

describe("partsFromMarkers", () => {
  test("a legacy engine yields one text part plus a part per marker", () => {
    const md = ["---", "name: x", "---", "<!-- part: step source=mattstack:x version=1 path=a lines=5-6 -->", "", "body", "<!-- part: slot:domain binding=acme:p version=2 path=b lines=1-1 -->", "fill"].join("\n");
    const parts = partsFromMarkers(md, {}, new Set());
    expect(parts.map((p) => [p.kind, p.name, p.templateLines, p.renderedLines])).toEqual([
      ["text", null, null, [5, 6]],
      ["slot", "domain", null, [7, 8]],
    ]);
  });
});

describe("linksIn", () => {
  test("finds relative skill paths and vendored parts once each, with their first line", () => {
    const md = "a\nsee ../../attachments/gates/SKILL.md\nand ../../attachments/gates/SKILL.md\nparts/include-x/references/strategies.md";
    expect(linksIn(md)).toEqual([
      { path: "../../attachments/gates/SKILL.md", line: 2 },
      { path: "parts/include-x/references/strategies.md", line: 4 },
    ]);
  });
});
