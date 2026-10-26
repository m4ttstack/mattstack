import type { BlocksPayload } from '../../../../server/blocksPayload';

type Graph = BlocksPayload['graphs'][number];

export type AroundGraphData = {
  nodes: Graph['nodes'];
  edges: Graph['edges'];
};

/** The longest cycle back to the focus that stays in, counted in edges. */
export const CYCLE_HOPS = 3;

/** Hops from `start` along `next`, explored no further than `limit`. */
function hopsWithin(
  start: string,
  next: Map<string, string[]>,
  limit: number
): Map<string, number> {
  const hops = new Map([[start, 0]]);
  let frontier = [start];
  for (let depth = 1; depth <= limit && frontier.length > 0; depth++) {
    const reached: string[] = [];
    for (const id of frontier) {
      for (const to of next.get(id) ?? []) {
        if (hops.has(to)) continue;
        hops.set(to, depth);
        reached.push(to);
      }
    }
    frontier = reached;
  }
  return hops;
}

function adjacency(
  edges: Graph['edges'],
  forward: boolean
): Map<string, string[]> {
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const [from, to] = forward ? [edge.from, edge.to] : [edge.to, edge.from];
    next.set(from, [...(next.get(from) ?? []), to]);
  }
  return next;
}

/** The focus, one hop in and out, and every node on a cycle back to the
    focus of at most `CYCLE_HOPS` edges: a node whose shortest way out from
    the focus plus its shortest way back fits that budget. */
export function aroundBlock(graph: Graph, nodeId: string): AroundGraphData {
  if (!graph.nodes.some(node => node.id === nodeId)) {
    return { nodes: [], edges: [] };
  }
  const out = hopsWithin(nodeId, adjacency(graph.edges, true), CYCLE_HOPS);
  const back = hopsWithin(nodeId, adjacency(graph.edges, false), CYCLE_HOPS);
  const kept = new Set<string>();
  for (const [id, away] of out) {
    const home = back.get(id);
    if (away <= 1 || (home !== undefined && away + home <= CYCLE_HOPS)) {
      kept.add(id);
    }
  }
  for (const [id, home] of back) {
    if (home <= 1) kept.add(id);
  }
  return {
    nodes: graph.nodes.filter(node => kept.has(node.id)),
    edges: graph.edges.filter(edge => kept.has(edge.from) && kept.has(edge.to)),
  };
}

/** The order Around lays its nodes out in: the focus's in-neighbours, then
    the focus, then the rest, each in the whole graph's flow `order`, so a
    step that leads into the block sits above it even where the whole graph
    reaches it later, round a loop. */
export function aroundOrder(
  sub: AroundGraphData,
  focus: string,
  order: string[]
): string[] {
  const into = new Set(
    sub.edges.flatMap(edge =>
      edge.to === focus && edge.from !== focus ? [edge.from] : []
    )
  );
  const kept = order.filter(id => sub.nodes.some(node => node.id === id));
  return [
    ...kept.filter(id => into.has(id)),
    focus,
    ...kept.filter(id => id !== focus && !into.has(id)),
  ];
}
