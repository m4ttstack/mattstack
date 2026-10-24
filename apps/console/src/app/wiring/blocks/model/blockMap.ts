import type { BlocksPayload } from '../../../../server/blocksPayload';
import { cutLabel } from './labels';

type Graph = BlocksPayload['graphs'][number];
type Edge = Graph['edges'][number];

export type MapKind = 'step' | 'question' | 'gate' | 'end';

export type MapNode = {
  id: string;
  blockId: string | null;
  label: string;
  kind: MapKind;
};

export type MapLink = {
  id: string;
  from: string;
  /** Sibling sources sharing this jump. */
  alsoFrom: string[];
  /** One target, or several for a grouped jump. */
  to: string[];
  /** Graph-only node ids, in flow order. */
  folded: string[];
  kind: 'line' | 'jump-back' | 'jump-forward';
  /** Already cut at the first colon. */
  label: string | null;
  trunk: { group: string; splitAt: string; main: boolean } | null;
};

export type BlockMap = {
  nodes: MapNode[];
  links: MapLink[];
  /** Every graph node id, in flow order. */
  order: string[];
  layers: Record<string, number>;
  foldedSteps: number;
};

/** A forward link spanning this many layers or more is drawn as a jump. */
export const JUMP_LAYERS = 3;

/** One block reaching one target, before kinds, trunks and grouping. */
type Reach = {
  from: string;
  to: string;
  folded: string[];
  firstEdge: Edge | null;
};

function adjacency(graph: Graph, forward: boolean): Map<string, Edge[]> {
  const next = new Map<string, Edge[]>(graph.nodes.map(node => [node.id, []]));
  for (const edge of graph.edges) {
    next.get(forward ? edge.from : edge.to)?.push(edge);
  }
  return next;
}

/** Graph-only nodes from which every path reaches an end without passing a
    block: the least fixed point, so a graph-only cycle never qualifies. */
function exitNodes(
  graph: Graph,
  outs: Map<string, Edge[]>,
  ins: Map<string, Edge[]>
): Set<string> {
  const exits = new Set<string>();
  const unsettled = new Map<string, number>();
  const queue: string[] = [];
  for (const node of graph.nodes) {
    if (node.blockId !== null) continue;
    const out = outs.get(node.id)!.length;
    if (out === 0 || node.shape === 'doublecircle') {
      exits.add(node.id);
      queue.push(node.id);
    } else {
      unsettled.set(node.id, out);
    }
  }
  while (queue.length > 0) {
    for (const edge of ins.get(queue.pop()!)!) {
      const left = unsettled.get(edge.from);
      if (left === undefined) continue;
      if (left > 1) {
        unsettled.set(edge.from, left - 1);
        continue;
      }
      unsettled.delete(edge.from);
      exits.add(edge.from);
      queue.push(edge.from);
    }
  }
  return exits;
}

/** Reverse postorder of a depth-first walk from the trigger, edges in
    declaration order: an edge points backwards exactly when it is a back
    edge. */
function flowOrder(graph: Graph, outs: Map<string, Edge[]>): string[] {
  const trigger =
    graph.nodes.find(node => node.shape === 'ellipse') ?? graph.nodes[0];
  const finished: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    seen.add(id);
    for (const edge of outs.get(id)!) {
      if (!seen.has(edge.to)) visit(edge.to);
    }
    finished.push(id);
  };
  for (const node of trigger ? [trigger, ...graph.nodes] : []) {
    if (!seen.has(node.id)) visit(node.id);
  }
  return finished.reverse();
}

/** The blocks one block reaches through graph-only, non-exit nodes, each
    with the walked nodes that lie on a path to it. */
function reachesFrom(
  from: string,
  outs: Map<string, Edge[]>,
  ins: Map<string, Edge[]>,
  isBlock: (id: string) => boolean,
  exits: Set<string>
): Reach[] {
  const walked = new Set<string>();
  const targets: string[] = [];
  const stack = [from];
  while (stack.length > 0) {
    for (const edge of outs.get(stack.pop()!)!) {
      if (isBlock(edge.to)) {
        if (!targets.includes(edge.to)) targets.push(edge.to);
      } else if (!exits.has(edge.to) && !walked.has(edge.to)) {
        walked.add(edge.to);
        stack.push(edge.to);
      }
    }
  }
  return targets.map(to => {
    const onPath = new Set<string>();
    const back = [to];
    while (back.length > 0) {
      for (const edge of ins.get(back.pop()!)!) {
        if (walked.has(edge.from) && !onPath.has(edge.from)) {
          onPath.add(edge.from);
          back.push(edge.from);
        }
      }
    }
    const firstEdge =
      outs.get(from)!.find(edge => edge.to === to || onPath.has(edge.to)) ??
      null;
    return { from, to, folded: [...onPath], firstEdge };
  });
}

/** Forward reaches whose folded sets chain together by sharing a node. */
function trunkGroups(forward: Reach[]): Reach[][] {
  const groups: Reach[][] = [];
  for (const reach of forward) {
    const shares = (other: Reach) =>
      other.folded.some(id => reach.folded.includes(id));
    const joined = groups.filter(group => group.some(shares));
    const merged = [reach, ...joined.flat()];
    for (const group of joined) groups.splice(groups.indexOf(group), 1);
    groups.push(merged);
  }
  return groups.filter(group => group.length > 1);
}

export function blockMap(
  graph: Graph,
  blockOf: (blockId: string) => {
    label: string;
    kind: Exclude<MapKind, 'end'>;
  }
): BlockMap {
  const outs = adjacency(graph, true);
  const ins = adjacency(graph, false);
  const blockIdOf = new Map(graph.nodes.map(node => [node.id, node.blockId]));
  const isBlock = (id: string) => (blockIdOf.get(id) ?? null) !== null;
  const exits = exitNodes(graph, outs, ins);
  const order = flowOrder(graph, outs);
  const rank = new Map(order.map((id, index) => [id, index]));
  const byRank = (a: string, b: string) => rank.get(a)! - rank.get(b)!;
  const isForward = (reach: Reach) => byRank(reach.to, reach.from) > 0;

  const success =
    graph.nodes.find(node => node.cls === 'done' && node.blockId === null) ??
    null;
  const nodes: MapNode[] = [];
  for (const node of graph.nodes) {
    if (node.blockId !== null) {
      nodes.push({
        id: node.id,
        blockId: node.blockId,
        ...blockOf(node.blockId),
      });
    } else if (node === success) {
      nodes.push({
        id: node.id,
        blockId: null,
        label: node.label ?? node.id,
        kind: 'end',
      });
    }
  }
  nodes.sort((a, b) => byRank(a.id, b.id));

  const reaches: Reach[] = [];
  for (const node of nodes) {
    if (node.blockId === null) continue;
    const own = reachesFrom(node.id, outs, ins, isBlock, exits);
    for (const reach of own) reach.folded.sort(byRank);
    reaches.push(...own);
    if (success && own.every(reach => reach.to === node.id)) {
      reaches.push({
        from: node.id,
        to: success.id,
        folded: [],
        firstEdge: null,
      });
    }
  }

  const layers: Record<string, number> = {};
  for (const node of nodes) layers[node.id] = 0;
  for (const node of nodes) {
    for (const reach of reaches) {
      if (reach.from !== node.id || !isForward(reach)) continue;
      layers[reach.to] = Math.max(layers[reach.to]!, layers[node.id]! + 1);
    }
  }

  const links: MapLink[] = [];
  const jumps: MapLink[] = [];
  for (const node of nodes) {
    const own = reaches.filter(reach => reach.from === node.id);
    const span = (reach: Reach) => layers[reach.to]! - layers[reach.from]!;
    const inTrunk = new Set<Reach>();
    for (const group of trunkGroups(own.filter(isForward))) {
      const main = mainOf(node.id, group, outs, byRank);
      const kept = group.filter(
        reach =>
          reach === main ||
          span(reach) < JUMP_LAYERS ||
          span(reach) <= span(main)
      );
      if (kept.length < 2) continue;
      links.push(...trunkLinks(node.id, main, kept, outs, byRank));
      for (const reach of kept) inTrunk.add(reach);
    }
    const bySplit = new Map<string, MapLink>();
    for (const reach of own) {
      if (inTrunk.has(reach)) continue;
      const kind = !isForward(reach)
        ? 'jump-back'
        : span(reach) >= JUMP_LAYERS
          ? 'jump-forward'
          : 'line';
      const link = newLink(reach, kind);
      if (kind === 'line') {
        links.push(link);
        continue;
      }
      link.label = reach.firstEdge?.label
        ? cutLabel(reach.firstEdge.label)
        : null;
      const last = reach.folded.at(-1);
      const key = `${kind}\u0000${link.label}\u0000${last}`;
      const twin = last === undefined ? undefined : bySplit.get(key);
      if (twin) {
        twin.to = [...twin.to, reach.to].sort(byRank);
        twin.folded = union(twin.folded, reach.folded, byRank);
      } else {
        bySplit.set(key, link);
        jumps.push(link);
      }
    }
  }

  const siblings = new Map<string, MapLink>();
  for (const jump of jumps) {
    const key = `${jump.kind}\u0000${jump.label}\u0000${jump.to.join('\u0000')}`;
    const twin = siblings.get(key);
    if (!twin) {
      siblings.set(key, jump);
      continue;
    }
    const sources = [twin.from, ...twin.alsoFrom, jump.from].sort(byRank);
    twin.from = sources.at(-1)!;
    twin.alsoFrom = sources.slice(0, -1);
    twin.folded = union(twin.folded, jump.folded, byRank);
  }
  links.push(...siblings.values());

  for (const link of links) {
    if (link.trunk === null) link.id = linkId(link.from, link.to);
  }
  links.sort((a, b) => byRank(a.from, b.from) || byRank(a.to[0]!, b.to[0]!));

  return {
    nodes,
    links,
    order,
    layers,
    foldedSteps: graph.nodes.length - nodes.length,
  };
}

function linkId(from: string, to: string[]): string {
  return `${from}->${to.join('+')}`;
}

function newLink(reach: Reach, kind: MapLink['kind']): MapLink {
  return {
    id: '',
    from: reach.from,
    alsoFrom: [],
    to: [reach.to],
    folded: reach.folded,
    kind,
    label: null,
    trunk: null,
  };
}

function union(
  a: string[],
  b: string[],
  byRank: (a: string, b: string) => number
): string[] {
  return [...new Set([...a, ...b])].sort(byRank);
}

/** The trunk's main line follows each split's first-declared edge: the
    author's happy path. */
function mainOf(
  source: string,
  group: Reach[],
  outs: Map<string, Edge[]>,
  byRank: (a: string, b: string) => number
): Reach {
  const shared = new Set(group.flatMap(reach => reach.folded));
  const byTarget = new Map(group.map(reach => [reach.to, reach]));
  const seen = new Set<string>();
  for (let at = source; ;) {
    const step = outs
      .get(at)!
      .find(
        edge =>
          byTarget.has(edge.to) || (shared.has(edge.to) && !seen.has(edge.to))
      );
    if (!step) break;
    const main = byTarget.get(step.to);
    if (main) return main;
    seen.add(step.to);
    at = step.to;
  }
  return [...group].sort((a, b) => byRank(a.to, b.to))[0]!;
}

/** Every link but the main branches where its path leaves the main line's
    folded steps. */
function trunkLinks(
  source: string,
  main: Reach,
  group: Reach[],
  outs: Map<string, Edge[]>,
  byRank: (a: string, b: string) => number
): MapLink[] {
  const trunkId = linkId(source, [main.to]);
  const mainSteps = new Set(main.folded);
  const branches = group
    .filter(reach => reach !== main)
    .map(reach => {
      const own = new Set(reach.folded);
      const leaves = (edge: Edge) =>
        edge.to === reach.to || (own.has(edge.to) && !mainSteps.has(edge.to));
      // A shared step always exists: the last main-line step on any path
      // from a shared step to this target.
      const splitAt = main.folded
        .filter(id => outs.get(id)!.some(leaves))
        .sort(byRank)
        .at(-1)!;
      const exit = outs.get(splitAt)!.find(leaves)!;
      const link = newLink(reach, 'line');
      link.id = linkId(source, [reach.to]);
      link.label = exit.label ? cutLabel(exit.label) : null;
      link.trunk = { group: trunkId, splitAt, main: false };
      return link;
    });

  const first = branches.map(branch => branch.trunk!.splitAt).sort(byRank)[0]!;
  const mainLink = newLink(main, 'line');
  mainLink.id = trunkId;
  mainLink.trunk = { group: trunkId, splitAt: first, main: true };
  return [mainLink, ...branches];
}

/** One line per node, then one per link: the text a board is redrawn from. */
export function formatBlockMap(map: BlockMap): string {
  const lines = map.nodes.map(
    node =>
      `node ${node.id} · ${node.kind} · layer ${map.layers[node.id]} · ${node.label}`
  );
  const byId = new Map(map.links.map(link => [link.id, link]));
  for (const link of map.links) {
    const from = link.alsoFrom.length
      ? `${link.from} (also ${link.alsoFrom.join(', ')})`
      : link.from;
    const parts = [`link ${from} → ${link.to.join(', ')}`, link.kind];
    if (link.label !== null) parts.push(`"${link.label}"`);
    if (link.trunk?.main)
      parts.push(`trunk main, first split at ${link.trunk.splitAt}`);
    else if (link.trunk) {
      const main = byId.get(link.trunk.group)!;
      parts.push(`trunk branch off → ${main.to[0]} at ${link.trunk.splitAt}`);
    }
    parts.push(`folded ${link.folded.length}`);
    if (link.folded.length > 0) parts.push(link.folded.join(', '));
    lines.push(parts.join(' · '));
  }
  return `${lines.join('\n')}\n`;
}
