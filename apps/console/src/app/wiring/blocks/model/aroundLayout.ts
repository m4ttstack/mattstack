import type { Edge, Node } from '@xyflow/react';

import type { GraphNode } from '../../../../server/blocksPayload';
import type { AroundGraphData } from './around';

export const AROUND = {
  nodeW: 180,
  nodeH: 32,
  columnGap: 30,
  rowGap: 64,
} as const;

export type AroundNodeData = {
  label: string;
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

/** React Flow nodes and edges for the subgraph: one row per layer, each
    row centred on the focus's column, in the graph's own node order. A
    layer wider than `maxPerRow` wraps onto more rows. */
export function aroundLayout(
  sub: AroundGraphData,
  focus: string,
  maxPerRow = Number.POSITIVE_INFINITY
): { nodes: AroundNode[]; edges: AroundEdge[]; rows: number } {
  const layers = layerNodes(sub, focus);
  const byLayer = new Map<number, GraphNode['id'][]>();
  for (const node of sub.nodes) {
    const layer = layers.get(node.id) ?? 0;
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), node.id]);
  }

  const cap = Math.max(1, Math.floor(maxPerRow));
  const place = new Map<string, { row: number; column: number }>();
  let rows = 0;
  for (const layer of [...byLayer.keys()].sort((a, b) => a - b)) {
    const ids = byLayer.get(layer) ?? [];
    // Rows of `cap` alternate with rows set in their gaps, so a drop from
    // one row passes the next one between its nodes.
    const full = Math.min(cap, ids.length);
    const grid = Array.from({ length: full }, (_, i) => i - (full - 1) / 2);
    const gaps = grid.slice(1).map(column => column - 0.5);
    for (let start = 0, wrap = 0; start < ids.length; wrap += 1) {
      const slots = wrap % 2 === 0 || gaps.length === 0 ? grid : gaps;
      const chunk = ids.slice(start, start + slots.length);
      const from = Math.floor((slots.length - chunk.length) / 2);
      chunk.forEach((id, index) =>
        place.set(id, { row: rows, column: slots[from + index] })
      );
      start += chunk.length;
      rows += 1;
    }
  }

  const stepX = AROUND.nodeW + AROUND.columnGap;
  const stepY = AROUND.nodeH + AROUND.rowGap;
  const nodes = sub.nodes.map((node): AroundNode => {
    const { row, column } = place.get(node.id) ?? { row: 0, column: 0 };
    return {
      id: node.id,
      type: node.blockId === null ? 'graphOnly' : 'block',
      position: { x: column * stepX - AROUND.nodeW / 2, y: row * stepY },
      width: AROUND.nodeW,
      height: AROUND.nodeH,
      data: {
        label: node.label ?? node.id,
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
    const step = Math.min(
      LAND_STEP,
      (AROUND.nodeW - 2 * LAND_STEP) / (into.length - 1)
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
  const dropX = source.position.x + AROUND.nodeW / 2;
  const between = nodes.filter(
    node =>
      node.position.y > source.position.y && node.position.y < target.position.y
  );
  const blocked = between.some(
    node =>
      Math.abs(node.position.x + AROUND.nodeW / 2 - dropX) <
      AROUND.nodeW / 2 + AROUND.columnGap / 2
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
  maxPerRow = Number.POSITIVE_INFINITY
): { nodes: AroundNode[]; edges: AroundEdge[]; rows: number } {
  const pointedAt = new Set(graph.edges.map(edge => edge.to));
  const entry =
    graph.nodes.find(node => !pointedAt.has(node.id)) ?? graph.nodes[0];
  if (!entry) return { nodes: [], edges: [], rows: 0 };
  const layout = aroundLayout(graph, entry.id, maxPerRow);
  return {
    ...layout,
    nodes: layout.nodes.map(node => ({
      ...node,
      data: { ...node.data, focus: node.id === highlight },
    })),
  };
}
