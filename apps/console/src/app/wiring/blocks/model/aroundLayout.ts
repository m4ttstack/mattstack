import type { Edge, Node } from '@xyflow/react';

import type { GraphNode } from '../../../../server/blocksPayload';
import type { AroundGraphData } from './around';

export const AROUND = {
  /** A node is at least this wide, and grows to fit its label. */
  nodeW: 150,
  /** Past this a label ellipsizes, its whole text in the node's title. */
  maxNodeW: 240,
  nodeH: 32,
  columnGap: 30,
  rowGap: 64,
} as const;

/** What a node takes beside its label: the padding, the glyph and the room
    the boards leave after the text. */
const LABEL_CHROME = 60;

/** A label's width at 13px when nothing measures it: about 7px a letter. */
const estimate = (label: string) => label.length * 7;

export type LayoutOptions = {
  /** The row's room in px; a layer wider than it wraps. */
  room?: number;
  /** A label's drawn width in px. */
  measure?: (label: string) => number;
  /** The skill in view, whose name a graph-only label need not repeat. */
  skill?: string;
};

export type AroundNodeData = {
  label: string;
  /** The label as the graph writes it. */
  title: string;
  shape: GraphNode['shape'];
  blockId: string | null;
  focus: boolean;
};

export type AroundNode = Node<AroundNodeData, 'block' | 'graphOnly'>;
export type AroundEdgeData = {
  dashed: boolean;
  /** The x of the side channel a drop takes past a lower row's node. */
  channel?: number | null;
  /** Which of the side-channelled drops this is, from 0. */
  lane?: number;
  /** Where the edge lands on its target's top, from the target's centre. */
  land?: number;
};
export type AroundEdge = Edge<AroundEdgeData, 'around'>;

const FOCUS_LAYER = 1;

/** Nodes the focus reaches sit below it at 1 + their longest path from it,
    over the subgraph with its back edges dropped so every loop is cut once.
    The rest reach the focus without being reached: they share the row
    above it. */
export function layerNodes(
  sub: AroundGraphData,
  focus: string
): Map<string, number> {
  const next = new Map<string, string[]>();
  for (const edge of sub.edges) {
    next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
  }

  const onStack = new Set<string>();
  const done = new Set<string>();
  const finished: string[] = [];
  const forward: [string, string][] = [];
  const visit = (id: string) => {
    onStack.add(id);
    for (const to of next.get(id) ?? []) {
      if (onStack.has(to)) continue;
      forward.push([id, to]);
      if (!done.has(to)) visit(to);
    }
    onStack.delete(id);
    done.add(id);
    finished.push(id);
  };
  if (sub.nodes.some(node => node.id === focus)) visit(focus);

  const depth = new Map([[focus, 0]]);
  for (const id of finished.reverse()) {
    const from = depth.get(id);
    if (from === undefined) continue;
    for (const [source, to] of forward) {
      if (source !== id) continue;
      depth.set(to, Math.max(depth.get(to) ?? 0, from + 1));
    }
  }

  const layers = new Map<string, number>();
  for (const node of sub.nodes) {
    const below = depth.get(node.id);
    layers.set(node.id, below === undefined ? 0 : FOCUS_LAYER + below);
  }
  return layers;
}

/** A graph-only label drops a trailing parenthetical that only names the
    skill in view: `Checks pass (ship)?` reads `Checks pass?` on ship. */
export function shortLabel(label: string, skill: string | undefined): string {
  if (!skill) return label;
  const named = new RegExp(
    `\\s*\\(${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)(\\??)$`
  );
  return label.replace(named, '$1');
}

/** Centres for nodes of these widths packed side by side about 0. */
function packed(widths: number[]): number[] {
  const total =
    widths.reduce((sum, w) => sum + w, 0) +
    AROUND.columnGap * (widths.length - 1);
  let left = -total / 2;
  return widths.map(w => {
    const centre = left + w / 2;
    left += w + AROUND.columnGap;
    return centre;
  });
}

/** How many of these widths, from the first, fit side by side in `room`;
    at least one. */
function fitting(widths: number[], room: number): number {
  let used = -AROUND.columnGap;
  let count = 0;
  for (const w of widths) {
    if (count > 0 && used + AROUND.columnGap + w > room) break;
    used += AROUND.columnGap + w;
    count += 1;
  }
  return count;
}

/** Whether nodes at these centres keep a column gap apart and inside room. */
function clear(centres: number[], widths: number[], room: number): boolean {
  for (let i = 1; i < centres.length; i++) {
    const apart = centres[i] - centres[i - 1];
    if (apart < (widths[i - 1] + widths[i]) / 2 + AROUND.columnGap)
      return false;
  }
  const left = centres[0] - widths[0] / 2;
  const right = centres[centres.length - 1] + widths[widths.length - 1] / 2;
  return right - left <= room;
}

/** React Flow nodes and edges for the subgraph: one row per layer, each
    row centred on the focus's column, in the graph's own node order. Each
    node is as wide as its label needs, from `nodeW` to `maxNodeW`. A layer
    wider than `maxPerRow` nodes, or than the room, wraps onto more rows. */
export function aroundLayout(
  sub: AroundGraphData,
  focus: string,
  maxPerRow = Number.POSITIVE_INFINITY,
  options: LayoutOptions = {}
): { nodes: AroundNode[]; edges: AroundEdge[]; rows: number } {
  const room = options.room ?? Number.POSITIVE_INFINITY;
  const measure = options.measure ?? estimate;
  const layers = layerNodes(sub, focus);
  const byLayer = new Map<number, GraphNode['id'][]>();
  for (const node of sub.nodes) {
    const layer = layers.get(node.id) ?? 0;
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), node.id]);
  }

  const labelOf = new Map(
    sub.nodes.map(node => {
      const full = node.label ?? node.id;
      return [
        node.id,
        node.blockId === null ? shortLabel(full, options.skill) : full,
      ];
    })
  );
  const widthOf = new Map(
    sub.nodes.map(node => {
      const text = measure(labelOf.get(node.id) ?? node.id);
      const w = Math.ceil((text + LABEL_CHROME) / 10) * 10;
      return [node.id, Math.min(AROUND.maxNodeW, Math.max(AROUND.nodeW, w))];
    })
  );
  const w = (id: string) => widthOf.get(id) ?? AROUND.nodeW;

  const cap = Math.max(1, Math.floor(maxPerRow));
  const place = new Map<string, { row: number; centre: number }>();
  let rows = 0;
  for (const layer of [...byLayer.keys()].sort((a, b) => a - b)) {
    const ids = byLayer.get(layer) ?? [];
    // Full rows alternate with rows set in their gaps, so a drop from one
    // row passes the next one between its nodes. A row whose nodes would
    // crowd those places packs side by side instead.
    const full = Math.min(cap, fitting(ids.map(w), room));
    const grid = packed(ids.slice(0, full).map(w));
    const gaps = grid.slice(1).map((c, i) => (grid[i] + c) / 2);
    for (let start = 0, wrap = 0; start < ids.length; wrap += 1) {
      const slots = wrap % 2 === 0 || gaps.length === 0 ? grid : gaps;
      let chunk = ids.slice(start, start + slots.length);
      const from = Math.floor((slots.length - chunk.length) / 2);
      let centres = chunk.map((_, index) => slots[from + index]);
      if (!clear(centres, chunk.map(w), room)) {
        chunk = chunk.slice(0, fitting(chunk.map(w), room));
        centres = packed(chunk.map(w));
      }
      chunk.forEach((id, index) =>
        place.set(id, { row: rows, centre: centres[index] })
      );
      start += chunk.length;
      rows += 1;
    }
  }

  const stepY = AROUND.nodeH + AROUND.rowGap;
  const nodes = sub.nodes.map((node): AroundNode => {
    const { row, centre } = place.get(node.id) ?? { row: 0, centre: 0 };
    return {
      id: node.id,
      type: node.blockId === null ? 'graphOnly' : 'block',
      position: { x: centre - w(node.id) / 2, y: row * stepY },
      width: w(node.id),
      height: AROUND.nodeH,
      data: {
        label: labelOf.get(node.id) ?? node.id,
        title: node.label ?? node.id,
        shape: node.shape,
        blockId: node.blockId,
        focus: node.id === focus,
      },
    };
  });

  // Only the in-neighbours' row can hold both ends of an edge, and a
  // bottom-to-top handle pair cannot draw it without looping over the row.
  const edges = sub.edges
    .map((edge, index): AroundEdge => ({
      id: `${edge.from}->${edge.to}#${index}`,
      source: edge.from,
      target: edge.to,
      type: 'around',
      ...(edge.label === null ? {} : { label: edge.label }),
      data: {
        dashed: edge.style === 'dashed',
        channel: channelOf(nodes, edge.from, edge.to),
      },
    }))
    .filter(edge => layers.get(edge.source) !== layers.get(edge.target));

  return { nodes, edges: landPoints(nodes, fanChannels(nodes, edges)), rows };
}

/** Most room between two landing points on one target. */
const LAND_STEP = 20;

/** Edges into one target land side by side across its top, each with its
    own arrow, in the order their sources sit left to right; a drop down a
    side channel arrives from the far left. */
function landPoints(nodes: AroundNode[], edges: AroundEdge[]): AroundEdge[] {
  const x = (id: string) => nodes.find(node => node.id === id)?.position.x ?? 0;
  const from = (edge: AroundEdge) =>
    edge.data?.channel != null
      ? edge.data.channel - AROUND.nodeW
      : x(edge.source);
  const land = new Map<string, number>();
  const targets = new Set(edges.map(edge => edge.target));
  for (const target of targets) {
    const into = edges
      .filter(edge => edge.target === target)
      .sort((a, b) => from(a) - from(b));
    if (into.length < 2) continue;
    const wide = nodes.find(node => node.id === target)?.width ?? AROUND.nodeW;
    const step = Math.min(
      LAND_STEP,
      (wide - 2 * LAND_STEP) / (into.length - 1)
    );
    into.forEach((edge, index) =>
      land.set(edge.id, (index - (into.length - 1) / 2) * step)
    );
  }
  return edges.map(edge =>
    land.has(edge.id) && edge.data
      ? { ...edge, data: { ...edge.data, land: land.get(edge.id) } }
      : edge
  );
}

/** Space between side-channelled drops, so each reads as its own line. */
const LANE = 8;
/** Lanes before they repeat, so the channels stay near the nodes. */
export const LANES = 5;

/** Drops that share a side channel each take their own lane: a channel
    further out and a bend lower under the source row, the lowest source
    nearest the rows. */
function fanChannels(nodes: AroundNode[], edges: AroundEdge[]): AroundEdge[] {
  const y = (id: string) => nodes.find(node => node.id === id)?.position.y ?? 0;
  const x = (id: string) => nodes.find(node => node.id === id)?.position.x ?? 0;
  const routed = edges
    .filter(edge => edge.data?.channel != null)
    .sort((a, b) => y(b.source) - y(a.source) || x(a.source) - x(b.source));
  const lane = new Map(routed.map((edge, index) => [edge.id, index]));
  return edges.map(edge => {
    const at = lane.get(edge.id);
    if (at === undefined || !edge.data) return edge;
    return {
      ...edge,
      data: {
        ...edge.data,
        channel: (edge.data.channel ?? 0) - (at % LANES) * LANE,
        lane: at,
      },
    };
  });
}

/** A downward edge whose straight drop would pass behind a node on a row
    between its ends goes down the left side of those rows instead. */
function channelOf(
  nodes: AroundNode[],
  from: string,
  to: string
): number | null {
  const source = nodes.find(node => node.id === from);
  const target = nodes.find(node => node.id === to);
  if (!source || !target || target.position.y <= source.position.y) {
    return null;
  }
  const half = (node: AroundNode) => (node.width ?? AROUND.nodeW) / 2;
  const dropX = source.position.x + half(source);
  const between = nodes.filter(
    node =>
      node.position.y > source.position.y && node.position.y < target.position.y
  );
  const blocked = between.some(
    node =>
      Math.abs(node.position.x + half(node) - dropX) <
      half(node) + AROUND.columnGap / 2
  );
  if (!blocked) return null;
  const span = nodes.filter(
    node =>
      node.position.y >= source.position.y &&
      node.position.y <= target.position.y
  );
  return Math.min(...span.map(node => node.position.x)) - AROUND.columnGap / 2;
}

/** A whole graph laid out from its entry (the first node nothing points at)
    the way `aroundLayout` lays out from a focus, with `highlight` marked as
    the focus instead. */
export function wholeLayout(
  graph: AroundGraphData,
  highlight: string | null,
  maxPerRow = Number.POSITIVE_INFINITY,
  options: LayoutOptions = {}
): { nodes: AroundNode[]; edges: AroundEdge[]; rows: number } {
  const pointedAt = new Set(graph.edges.map(edge => edge.to));
  const entry =
    graph.nodes.find(node => !pointedAt.has(node.id)) ?? graph.nodes[0];
  if (!entry) return { nodes: [], edges: [], rows: 0 };
  const layout = aroundLayout(graph, entry.id, maxPerRow, options);
  return {
    ...layout,
    nodes: layout.nodes.map(node => ({
      ...node,
      data: { ...node.data, focus: node.id === highlight },
    })),
  };
}
