import type { Edge, Node } from '@xyflow/react';

import type { GraphNode } from '../../../../server/blocksPayload';
import type { AroundGraphData } from './around';

export const AROUND = {
  nodeW: 150,
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
export type AroundEdgeData = { dashed: boolean };
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
    row centred on the focus's column, in the graph's own node order. */
export function aroundLayout(
  sub: AroundGraphData,
  focus: string
): { nodes: AroundNode[]; edges: AroundEdge[] } {
  const layers = layerNodes(sub, focus);
  const rows = new Map<number, GraphNode['id'][]>();
  for (const node of sub.nodes) {
    const layer = layers.get(node.id) ?? 0;
    rows.set(layer, [...(rows.get(layer) ?? []), node.id]);
  }

  const stepX = AROUND.nodeW + AROUND.columnGap;
  const stepY = AROUND.nodeH + AROUND.rowGap;
  const nodes = sub.nodes.map((node): AroundNode => {
    const layer = layers.get(node.id) ?? 0;
    const row = rows.get(layer) ?? [];
    const column = row.indexOf(node.id) - (row.length - 1) / 2;
    return {
      id: node.id,
      type: node.blockId === null ? 'graphOnly' : 'block',
      position: { x: column * stepX - AROUND.nodeW / 2, y: layer * stepY },
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
      data: { dashed: edge.style === 'dashed' },
    }))
    .filter(edge => layers.get(edge.source) !== layers.get(edge.target));

  return { nodes, edges };
}
