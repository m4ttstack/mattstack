import { partExtents, type DriftCause } from "./drift.ts";
import type { TraceEntry } from "./placeholders.ts";

export type AnatomyPartKind = "text" | "include" | "slot" | "verb.path" | "variable";
export type AnatomySource = { ref: string; path: string; version: string; builtVersion: string | null; lines: number };
export type AnatomyTarget = { skill: string; path: string; lines: number | null };
export type AnatomyPart = {
  kind: AnatomyPartKind;
  name: string | null;
  templateLines: [number, number] | null;
  renderedLines: [number, number] | null;
  mode: "inline" | "reference" | null;
  source: AnatomySource | null;
  target: AnatomyTarget | null;
  changed: boolean;
};
export type AnatomyLink = { path: string; line: number };
export type AnatomyPayload = {
  pack: string;
  skill: string;
  kind: "verb" | "stage";
  public: boolean;
  description: string | null;
  template: AnatomySource;
  rendered: { path: string; exists: boolean; lines: number };
  status: "in-sync" | "stale" | "never-compiled";
  staleBecause: DriftCause[];
  parts: AnatomyPart[];
  links: AnatomyLink[];
};
export type BuildPartsInput = {
  bodyStartLine: number;
  bodyOffset: number;
  trace: TraceEntry[];
  sources: Record<string, AnatomySource>;
  targets: Record<string, AnatomyTarget>;
  slotModes: Record<string, "inline" | "reference">;
  changedKeys: Set<string>;
};

const NAMED = new Set(["slot", "include", "verb.path"]);

function placeholderPart(kind: string, arg: string | null, line: number, rendered: [number, number] | null, input: BuildPartsInput): AnatomyPart {
  const key = kind === "slot" || kind === "include" ? `${kind}:${arg}` : null;
  return {
    kind: NAMED.has(kind) ? (kind as AnatomyPartKind) : "variable",
    name: NAMED.has(kind) ? arg : arg ? `${kind}:${arg}` : kind,
    templateLines: [line, line],
    renderedLines: rendered,
    mode: kind === "slot" ? input.slotModes[arg ?? ""] ?? null : null,
    source: key ? input.sources[key] ?? null : null,
    target: kind === "verb.path" && arg ? input.targets[arg] ?? null : null,
    changed: key ? input.changedKeys.has(key) : false,
  };
}

export function buildParts(input: BuildPartsInput): AnatomyPart[] {
  const parts: AnatomyPart[] = [];
  let run: { first: TraceEntry; last: TraceEntry; out: number } | null = null;
  const flush = () => {
    if (!run) return;
    parts.push({
      kind: "text", name: null,
      templateLines: [input.bodyStartLine + run.first.templateIndex, input.bodyStartLine + run.last.templateIndex],
      renderedLines: run.out === 0 ? null : [input.bodyOffset + run.first.outStart + 1, input.bodyOffset + run.first.outStart + run.out],
      mode: null, source: null, target: null, changed: false,
    });
    run = null;
  };
  for (const e of input.trace) {
    if (e.placeholders.length === 0) {
      if (run) { run.last = e; run.out += e.outCount; } else run = { first: e, last: e, out: e.outCount };
      continue;
    }
    flush();
    const rendered: [number, number] | null = e.outCount === 0 ? null : [input.bodyOffset + e.outStart + 1, input.bodyOffset + e.outStart + e.outCount];
    for (const p of e.placeholders) parts.push(placeholderPart(p.kind, p.arg, input.bodyStartLine + e.templateIndex, rendered, input));
  }
  flush();
  return parts;
}

const STEP_MARKER_RE = /^<!-- part: step /;

export function partsFromMarkers(rendered: string, sources: Record<string, AnatomySource>, changedKeys: Set<string>): AnatomyPart[] {
  const lines = rendered.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const stepAt = lines.findIndex((l) => STEP_MARKER_RE.test(l));
  const extents = partExtents(rendered);
  const firstPart = extents[0]?.start ?? lines.length;
  const parts: AnatomyPart[] = [];
  if (stepAt >= 0) {
    const bodyStart = stepAt + (lines[stepAt + 1]?.trim() === "" ? 3 : 2);
    parts.push({
      kind: "text", name: null, templateLines: null,
      renderedLines: bodyStart <= firstPart ? [bodyStart, firstPart] : null,
      mode: null, source: null, target: null, changed: false,
    });
  }
  for (const x of extents) {
    const colon = x.key.indexOf(":");
    const kind = x.key.slice(0, colon) as "slot" | "include";
    parts.push({ kind, name: x.key.slice(colon + 1), templateLines: null, renderedLines: [x.start + 1, x.end + 1], mode: kind === "slot" ? "inline" : null, source: sources[x.key] ?? null, target: null, changed: changedKeys.has(x.key) });
  }
  return parts;
}

const LINK_RE = /(?:\.\.\/)+(?:attachments|skills)\/[a-z0-9][a-z0-9-]*\/[A-Za-z0-9_./-]+\.md|(?<![A-Za-z0-9_.-])parts\/[A-Za-z0-9_./-]+\.md/g;

export function linksIn(rendered: string): AnatomyLink[] {
  const seen = new Map<string, number>();
  rendered.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(LINK_RE)) if (!seen.has(m[0])) seen.set(m[0], i + 1);
  });
  return [...seen].map(([path, line]) => ({ path, line }));
}
