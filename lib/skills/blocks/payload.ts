import { join } from "node:path";
import type { PropValue } from "./props.ts";
import { FENCE_RE } from "./tree.ts";
import type { Block, BlockTree, GraphEdge, GraphNode } from "./types.ts";

export type LayerColor = "mattstack" | "org" | "team";

/** One run of a block's own rendered text: the engine's words (`prop: null`) or one prop value. */
export type PayloadSegment = { layer: string; color: LayerColor; prop: string | null; text: string };

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
  segments: PayloadSegment[];
  props: {
    name: string;
    merge: "add" | "replace";
    default: string | null;
    contract: string | null;
    marker: { line: number; col: number } | null;
    values: { layer: string; color: LayerColor; binding: string; path: string; lines: number }[];
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
  /** Every use of a block-tree include: its name and the block whose text includes it. */
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
const BLOCK_SEAM_RE = /^<!-- part: block:(\S+) .*?\blines=(\d+)-/;
const PROP_SEAM_RE = /^<!-- part: prop:(\S+)\.([a-z][a-z0-9-]*) /;
const INCLUDE_LINE_RE = /^\{\{include:([^}\s]+)\}\}$/;
const SUMMARY_MAX = 160;

/** The default layer is mattstack's own fragment and every prop default; `base:<name>` is the org's base; the pack and a repo override are the team's. */
export function layerColor(label: string): LayerColor {
  if (label === "default") return "mattstack";
  if (label.startsWith("base:")) return "org";
  return "team";
}

/** One rendering of a block. An include used twice renders its blocks twice, so a block id can have several. */
type Instance = {
  block: Block;
  parentId: string | null;
  depth: number;
  shared: boolean;
  firstSeam: number | null;
  owned: Owned[];
  propSeen: Map<string, number>;
};

/** A rendered line and whose words it is: null for the engine's own text, else the prop source that put it there. */
type Owned = { text: string; seam: boolean; source: { prop: string; index: number; layer: string } | null };

function includedTrees(b: Block, includes: BlocksPayloadInput["includes"]): { name: string; tree: BlockTree }[] {
  return b.text.split("\n").flatMap((line) => {
    const name = INCLUDE_LINE_RE.exec(line.trim())?.[1];
    return name !== undefined && Object.hasOwn(includes, name) ? [{ name, tree: includes[name]! }] : [];
  });
}

/** Every rendering in the order render draws them: a block, the trees its text includes, then its children. */
function expand(input: BlocksPayloadInput): Instance[] {
  const out: Instance[] = [];
  const visit = (b: Block, parentId: string | null, depth: number, shared: boolean) => {
    out.push({ block: b, parentId, depth, shared, firstSeam: null, owned: [], propSeen: new Map() });
    for (const inc of includedTrees(b, input.includes)) visit(inc.tree.root, b.id, depth + 1, true);
    for (const child of b.children) visit(child, b.id, depth + 1, shared);
  };
  visit(input.tree.root, null, 0, false);
  return out;
}

/**
 * Walks the compiled file once, giving each line to the rendering whose seam
 * last opened. A block's first seam names a line at or before its text's
 * first line; a repeated seam naming a later line resumes the open rendering
 * after a multi-line substitution, never starts a new one.
 */
function walkSeams(compiled: string, instances: Instance[], values: BlocksPayloadInput["values"]): { lineCount: number; bodyLines: Owned[] } {
  const lines = compiled.split("\n");
  const lineCount = compiled.endsWith("\n") ? lines.length - 1 : lines.length;
  const open = new Map<string, Instance>();
  const bodyLines: Owned[] = [];
  let next = 0;
  let current: Instance | null = null;
  let source: Owned["source"] = null;
  for (let i = 0; i < lineCount; i++) {
    const line = lines[i]!;
    const block = BLOCK_SEAM_RE.exec(line);
    if (block) {
      const id = block[1]!;
      const resumed = open.get(id);
      const isEntry = !resumed || (Number(block[2]) <= resumed.block.textStartLine && instances[next]?.block.id === id);
      if (isEntry) {
        while (next < instances.length && instances[next]!.block.id !== id) next++;
        const inst = instances[next];
        if (!inst) continue;
        next++;
        inst.firstSeam = i + 1;
        open.set(id, inst);
        current = inst;
      } else current = resumed;
      source = null;
      continue;
    }
    if (current === null) continue;
    const prop = PROP_SEAM_RE.exec(line);
    let owned: Owned;
    if (prop && prop[1] === current.block.id) {
      const name = prop[2]!;
      const index = current.propSeen.get(name) ?? 0;
      current.propSeen.set(name, index + 1);
      source = { prop: name, index, layer: values.get(current.block.id)?.get(name)?.sources[index]?.layer ?? "default" };
      owned = { text: line, seam: true, source };
    } else owned = { text: line, seam: line.startsWith(SEAM_START), source };
    current.owned.push(owned);
    bodyLines.push(owned);
  }
  return { lineCount, bodyLines };
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
function ownLines(b: Block, owned: Owned[]): Owned[] {
  const out: Owned[] = [];
  let swapped = b.graph === null;
  let inDot = false;
  for (const o of owned) {
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
    out.push(o);
  }
  return trimBlank(out);
}

function trimBlank<T extends { text: string }>(lines: T[]): T[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.text.trim() === "") start++;
  while (end > start && lines[end - 1]!.text.trim() === "") end--;
  return lines.slice(start, end);
}

function counted(o: Owned): boolean {
  return !o.seam && o.text.trim() !== "";
}

/** Runs of engine text and prop values in render order; seam comments are dropped and blank edges trimmed. */
function segmentsOf(own: Owned[]): PayloadSegment[] {
  const out: PayloadSegment[] = [];
  let run: Owned[] = [];
  let runSource: Owned["source"] = null;
  const flush = () => {
    const text = trimBlank(run.filter((o) => !o.seam)).map((o) => o.text).join("\n");
    if (runSource !== null) out.push({ layer: runSource.layer, color: layerColor(runSource.layer), prop: runSource.prop, text });
    else if (text !== "") out.push({ layer: "default", color: "mattstack", prop: null, text });
    run = [];
  };
  for (const o of own) {
    if (o.source !== runSource) {
      if (run.length > 0 || runSource !== null) flush();
      runSource = o.source;
    }
    run.push(o);
  }
  if (run.length > 0) flush();
  return out;
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

function kindOf(inst: Instance, parent: Block | null): PayloadBlock["kind"] {
  const b = inst.block;
  if (b.kind === "gate") return "gate";
  if (inst.shared) return "shared";
  if (b.node === null) return "note";
  if (parent?.graph?.nodes.find((n) => n.id === b.node)?.shape === "diamond") return "question";
  return "step";
}

function textEnd(b: Block): number {
  return b.textStartLine + (b.text === "" ? 0 : b.text.split("\n").length) - 1;
}

export function buildBlocksPayload(input: BlocksPayloadInput): BlocksPayload {
  const instances = expand(input);
  const { lineCount, bodyLines } = walkSeams(input.compiled, instances, input.values);
  const layers: BlocksPayload["layers"] = [
    { name: "mattstack", label: "default", color: "mattstack" },
    ...(input.base !== null ? [{ name: input.base, label: `base:${input.base}`, color: "org" as const }] : []),
    { name: input.pack, label: "pack", color: "team" },
  ];

  const totals = new Map<LayerColor, number>();
  for (const o of bodyLines) {
    if (!counted(o)) continue;
    const color = o.source ? layerColor(o.source.layer) : "mattstack";
    totals.set(color, (totals.get(color) ?? 0) + 1);
  }

  const parentOf = new Map<string, Block>();
  for (const inst of instances) for (const c of inst.block.children) parentOf.set(c.id, inst.block);

  const firstOf = new Map<string, number>();
  instances.forEach((inst, i) => {
    if (!firstOf.has(inst.block.id)) firstOf.set(inst.block.id, i);
  });
  const includes = instances.flatMap((inst) => includedTrees(inst.block, input.includes).map(({ name }) => ({ name, blockId: inst.block.id })));

  // An include used twice draws its blocks twice; the payload lists each block once, from its first use.
  const blocks = [...firstOf.values()].map((at): PayloadBlock => {
    const inst = instances[at]!;
    const b = inst.block;
    const own = ownLines(b, inst.owned);
    const perSource = new Map<string, number>();
    for (const o of own) {
      if (!counted(o) || !o.source) continue;
      const key = `${o.source.prop}#${o.source.index}`;
      perSource.set(key, (perSource.get(key) ?? 0) + 1);
    }
    const text = own.map((o) => o.text).join("\n");
    const following = instances.slice(at + 1).find((i) => i.firstSeam !== null);
    const end = following ? following.firstSeam! - 1 : lineCount;
    const values = input.values.get(b.id);

    return {
      id: b.id,
      parentId: inst.parentId,
      depth: inst.depth,
      title: b.title,
      label: b.label,
      kind: kindOf(inst, parentOf.get(b.id) ?? null),
      path: b.path,
      relPath: b.relPath,
      lines: [b.bodyStartLine, Math.max(b.bodyStartLine, textEnd(b))],
      summary: summaryOf(text, b.title !== null),
      text,
      segments: segmentsOf(own),
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
            color: layerColor(layer),
            binding: fill.binding,
            path: join(fill.dir, fill.file ?? "SKILL.md"),
            lines: perSource.get(`${spec.name}#${index}`) ?? 0,
          })),
          fromDefault: value?.fromDefault ?? false,
        };
      }),
      node: b.node,
      order: b.order,
      headless: b.title === null,
      renderedLines: inst.firstSeam !== null && own.some(counted) ? [inst.firstSeam, Math.max(inst.firstSeam, end)] : null,
    };
  });

  const graphs = blocks.flatMap((pb) => {
    const b = instances[firstOf.get(pb.id)!]!.block;
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
