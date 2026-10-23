import { join } from "node:path";
import type { PropValue } from "./props.ts";
import { FENCE_RE } from "./tree.ts";
import type { Block, BlockTree, GraphEdge, GraphNode } from "./types.ts";

export type LayerColor = "mattstack" | "org" | "team";

export type PayloadBlock = {
  id: string;
  parentId: string | null;
  depth: number;
  title: string | null;
  label: string;
  kind: "step" | "question" | "gate" | "note" | "shared";
  path: string;
  relPath: string;
  lines: [number, number];
  summary: string;
  text: string;
  props: {
    name: string;
    merge: "add" | "replace";
    default: string | null;
    contract: string | null;
    marker: { line: number; col: number } | null;
    values: { layer: string; binding: string; path: string; lines: number }[];
    fromDefault: boolean;
  }[];
  node: string | null;
  order: number | null;
  headless: boolean;
  renderedLines: [number, number] | null;
};

export type BlocksPayload = {
  pack: string;
  skill: string;
  kind: "verb" | "stage";
  engineRef: string;
  dir: string;
  layers: { name: string; label: string; color: LayerColor }[];
  blocks: PayloadBlock[];
  graphs: { blockId: string; nodes: (GraphNode & { blockId: string | null })[]; edges: GraphEdge[] }[];
  includes: { name: string; blockId: string }[];
  lines: { layer: string; count: number }[];
};

export type BlocksPayloadInput = {
  pack: string;
  skill: string;
  kind: "verb" | "stage";
  plugin: string;
  tree: BlockTree;
  /** The block-tree includes by name; a flat include renders inside its block's text. */
  includes: Record<string, BlockTree>;
  values: Map<string /* block id */, Map<string /* prop */, PropValue>>;
  /** The compiled SKILL.md, whose `block:` and `prop:` seams place every rendered line. */
  compiled: string;
  base: string | null;
};

const SEAM_START = "<!-- part: ";
const BLOCK_SEAM_RE = /^<!-- part: block:(\S+) /;
const PROP_SEAM_RE = /^<!-- part: prop:(\S+)\.([a-z][a-z0-9-]*) /;
const INCLUDE_LINE_RE = /^\{\{include:([^}\s]+)\}\}$/;
const SUMMARY_MAX = 160;

/** The default layer is mattstack's own fragment and every prop default; `base:<name>` is the org's base; the pack and a repo override are the team's. */
export function layerColor(label: string): LayerColor {
  if (label === "default") return "mattstack";
  if (label.startsWith("base:")) return "org";
  return "team";
}

type Placed = { block: Block; parentId: string | null; depth: number; shared: boolean; parentGraph: Block["graph"] };

function place(input: BlocksPayloadInput): { placed: Placed[]; includes: BlocksPayload["includes"] } {
  const placed: Placed[] = [];
  const includes: BlocksPayload["includes"] = [];
  const visit = (b: Block, parent: Block | null, depth: number, shared: boolean) => {
    placed.push({ block: b, parentId: parent?.id ?? null, depth, shared, parentGraph: parent?.graph ?? null });
    for (const line of b.text.split("\n")) {
      const name = INCLUDE_LINE_RE.exec(line.trim())?.[1];
      const inc = name !== undefined && Object.hasOwn(input.includes, name) ? input.includes[name]! : null;
      if (!inc) continue;
      includes.push({ name: name!, blockId: inc.root.id });
      visit(inc.root, b, depth + 1, true);
    }
    for (const child of b.children) visit(child, b, depth + 1, shared);
  };
  visit(input.tree.root, null, 0, false);
  return { placed, includes };
}

/** A rendered line and whose words it is: null for the engine's own text, else the prop source that put it there. */
type Owned = { text: string; seam: boolean; source: { key: string; index: number; layer: string } | null };

type Region = { firstSeam: number; owned: Owned[] };

/** Walks the compiled file once, giving each line to the block whose seam last opened. */
function regions(compiled: string, values: BlocksPayloadInput["values"]): { byId: Map<string, Region>; order: string[]; lineCount: number } {
  const lines = compiled.split("\n");
  const lineCount = compiled.endsWith("\n") ? lines.length - 1 : lines.length;
  const byId = new Map<string, Region>();
  const order: string[] = [];
  const seen = new Map<string, number>();
  let current: Region | null = null;
  let source: Owned["source"] = null;
  for (let i = 0; i < lineCount; i++) {
    const line = lines[i]!;
    const block = BLOCK_SEAM_RE.exec(line);
    if (block) {
      const id = block[1]!;
      if (!byId.has(id)) {
        byId.set(id, { firstSeam: i + 1, owned: [] });
        order.push(id);
      }
      current = byId.get(id)!;
      source = null;
      continue;
    }
    if (current === null) continue;
    const prop = PROP_SEAM_RE.exec(line);
    if (prop) {
      const key = `${prop[1]}.${prop[2]}`;
      const index = seen.get(key) ?? 0;
      seen.set(key, index + 1);
      const layer = values.get(prop[1]!)?.get(prop[2]!)?.sources[index]?.layer ?? "default";
      source = { key, index, layer };
      current.owned.push({ text: line, seam: true, source });
      continue;
    }
    current.owned.push({ text: line, seam: line.startsWith(SEAM_START), source });
  }
  return { byId, order, lineCount };
}

function mermaidFence(b: Block): string[] {
  const lines = b.text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_RE.exec(lines[i]!);
    if (!m) continue;
    if (start < 0) {
      if (m[2] === "mermaid") start = i;
    } else if (m[2] === "") return lines.slice(start, i + 1);
  }
  return [];
}

/** The block's own lines with its graph shown as the Mermaid it was written in, not the dot compile made of it. */
function ownLines(b: Block, region: Region | undefined): Owned[] {
  if (!region) return [];
  const out: Owned[] = [];
  let swapped = b.graph === null;
  let inDot = false;
  for (const o of region.owned) {
    if (inDot) {
      if (o.text.trim() === "```") inDot = false;
      continue;
    }
    if (!swapped && o.source === null && o.text.trim() === "```dot") {
      swapped = true;
      inDot = true;
      out.push(...mermaidFence(b).map((text) => ({ text, seam: false, source: null })));
      continue;
    }
    if (o.seam && o.source === null && BLOCK_SEAM_RE.test(o.text)) continue;
    out.push(o);
  }
  while (out.length > 0 && out[out.length - 1]!.text.trim() === "") out.pop();
  while (out.length > 0 && out[0]!.text.trim() === "") out.shift();
  return out;
}

function counted(o: Owned): boolean {
  return !o.seam && o.text.trim() !== "";
}

function plain(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_]+)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "")
    .replace(/^>\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first sentence of the first paragraph below the title, as plain text. */
export function summaryOf(text: string, titled: boolean): string {
  const lines = text.split("\n");
  let i = titled && /^#{1,6}\s/.test(lines[0] ?? "") ? 1 : 0;
  let fence: string | null = null;
  const para: string[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const m = FENCE_RE.exec(line);
    if (fence !== null) {
      if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length && m[2] === "") fence = null;
      continue;
    }
    if (m) {
      if (para.length > 0) break;
      fence = m[1]!;
      continue;
    }
    const t = line.trim();
    if (t.startsWith("<!--") || /^#{1,6}\s/.test(t)) {
      if (para.length > 0) break;
      continue;
    }
    if (t === "") {
      if (para.length > 0) break;
      continue;
    }
    para.push(t);
  }
  const flat = plain(para.join(" "));
  const sentence = /^(.+?[.!?])(?=\s|$)/.exec(flat)?.[1] ?? flat;
  if (sentence.length <= SUMMARY_MAX) return sentence;
  const cut = sentence.slice(0, SUMMARY_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function kindOf(p: Placed): PayloadBlock["kind"] {
  const b = p.block;
  if (b.kind === "gate") return "gate";
  if (b.node !== null && p.parentGraph?.nodes.find((n) => n.id === b.node)?.shape === "diamond") return "question";
  if (p.shared) return "shared";
  if (b.node === null && p.parentId !== null && p.parentGraph === null) return "note";
  return "step";
}

function textEnd(b: Block): number {
  return b.textStartLine + (b.text === "" ? 0 : b.text.split("\n").length) - 1;
}

export function buildBlocksPayload(input: BlocksPayloadInput): BlocksPayload {
  const { placed, includes } = place(input);
  const { byId: regionOf, order, lineCount } = regions(input.compiled, input.values);
  const layers: BlocksPayload["layers"] = [
    { name: "mattstack", label: "default", color: "mattstack" },
    ...(input.base !== null ? [{ name: input.base, label: `base:${input.base}`, color: "org" as const }] : []),
    { name: input.pack, label: "pack", color: "team" },
  ];
  const totals = new Map<LayerColor, number>();

  const blocks = placed.map((p): PayloadBlock => {
    const b = p.block;
    const own = ownLines(b, regionOf.get(b.id));
    const perSource = new Map<string, number>();
    for (const o of own) {
      if (!counted(o)) continue;
      const color = o.source ? layerColor(o.source.layer) : "mattstack";
      totals.set(color, (totals.get(color) ?? 0) + 1);
      if (o.source) perSource.set(`${o.source.key}#${o.source.index}`, (perSource.get(`${o.source.key}#${o.source.index}`) ?? 0) + 1);
    }
    const text = own.map((o) => o.text).join("\n");

    const at = order.indexOf(b.id);
    const region = regionOf.get(b.id);
    const next = at >= 0 && at + 1 < order.length ? regionOf.get(order[at + 1]!)!.firstSeam - 1 : lineCount;
    const values = input.values.get(b.id);

    return {
      id: b.id,
      parentId: p.parentId,
      depth: p.depth,
      title: b.title,
      label: b.label,
      kind: kindOf(p),
      path: b.path,
      relPath: b.relPath,
      lines: [b.bodyStartLine, Math.max(b.bodyStartLine, textEnd(b))],
      summary: summaryOf(text, b.title !== null),
      text,
      props: b.props.map((spec) => {
        const value = values?.get(spec.name);
        const marker = b.markers.find((m) => m.prop === spec.name);
        return {
          name: spec.name,
          merge: spec.merge,
          default: spec.default,
          contract: spec.contract,
          marker: marker ? { line: marker.line, col: marker.col } : null,
          values: (value?.sources ?? []).map(({ layer, fill }, index) => ({
            layer,
            binding: fill.binding,
            path: join(fill.dir, fill.file ?? "SKILL.md"),
            lines: perSource.get(`${b.id}.${spec.name}#${index}`) ?? 0,
          })),
          fromDefault: value?.fromDefault ?? false,
        };
      }),
      node: b.node,
      order: b.order,
      headless: b.title === null,
      renderedLines: region ? [region.firstSeam, Math.max(region.firstSeam, next)] : null,
    };
  });

  const graphs = placed.flatMap(({ block: b }) => {
    if (!b.graph) return [];
    const boundTo = new Map(b.children.flatMap((c) => (c.node !== null ? [[c.node, c.id] as const] : [])));
    return [{ blockId: b.id, nodes: b.graph.nodes.map((n) => ({ ...n, blockId: boundTo.get(n.id) ?? null })), edges: b.graph.edges }];
  });

  return {
    pack: input.pack,
    skill: input.skill,
    kind: input.kind,
    engineRef: `${input.plugin}:${input.tree.root.id}`,
    dir: input.tree.dir,
    layers,
    blocks,
    graphs,
    includes,
    lines: layers.map((l) => ({ layer: l.label, count: totals.get(l.color) ?? 0 })),
  };
}
