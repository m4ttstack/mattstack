import { isPropReference, partExtents, pluginOfSeam, type DriftCause, type PartExtent } from "./drift.ts";

export type AnatomyPartKind = "text" | "block" | "include" | "prop" | "section";
export type AnatomySource = { ref: string; path: string; version: string; builtVersion: string | null; lines: number; origin?: "base"; base?: string; baseVersion?: string | null };
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

/** A seam an older compile wrote carries its own version; a current one's comes from the target's lock entry, by the plugin it names. */
export function builtVersionOf(extentVersion: string | null, plugin: string | null, lockEntry: Record<string, string> | undefined): string | null {
  if (extentVersion !== null) return extentVersion;
  if (plugin === null) return null;
  const version = lockEntry?.[plugin];
  return typeof version === "string" ? version : null;
}

/**
 * The built version of each part of a rendered file, in file order under each key (an add prop's values share
 * one key), and of its engine root, the file's first block seam.
 */
export function builtVersionsOf(rendered: string, lockEntry: Record<string, string> | undefined): { root: string | null; parts: Map<string, (string | null)[]> } {
  const lines = rendered.split("\n");
  const parts = new Map<string, (string | null)[]>();
  let root: string | null | undefined;
  for (const x of partExtents(rendered)) {
    const version = builtVersionOf(x.version, pluginOfSeam(lines[x.start]!), lockEntry);
    parts.set(x.key, [...(parts.get(x.key) ?? []), version]);
    if (root === undefined && x.key.startsWith("block:")) root = version;
  }
  return { root: root ?? null, parts };
}

/** One part per seam in the rendered file, in file order: each block, include, prop value and section. */
export function partsFromMarkers(rendered: string, sources: Record<string, AnatomySource>, changedKeys: Set<string>): AnatomyPart[] {
  return partExtents(rendered).map((x) => markerPart(x, sources, changedKeys));
}

function markerPart(x: PartExtent, sources: Record<string, AnatomySource>, changedKeys: Set<string>): AnatomyPart {
  const colon = x.key.indexOf(":");
  const kind = x.key.slice(0, colon) as "block" | "include" | "prop" | "section";
  const mode = kind === "prop" ? (isPropReference(x.text) ? "reference" : "inline") : null;
  return { kind, name: x.key.slice(colon + 1), templateLines: null, renderedLines: [x.start + 1, x.end + 1], mode, source: sources[x.key] ?? null, target: null, changed: changedKeys.has(x.key) };
}

const LINK_RE = /(?:\.\.\/)+(?:attachments|skills)\/[a-z0-9][a-z0-9-]*\/[A-Za-z0-9_./-]+\.md|(?<![A-Za-z0-9_.-])(?:parts|references)\/[A-Za-z0-9_./-]+\.md/g;

export function linksIn(rendered: string): AnatomyLink[] {
  const seen = new Map<string, number>();
  rendered.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(LINK_RE)) if (!seen.has(m[0])) seen.set(m[0], i + 1);
  });
  return [...seen].map(([path, line]) => ({ path, line }));
}
