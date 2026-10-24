import type { BlocksPayload } from '../../../../server/blocksPayload';

type Graph = BlocksPayload['graphs'][number];
type Edge = Graph['edges'][number];

/** One block reaching one target, before kinds, trunks and grouping. */
export type Reach = {
  from: string;
  to: string;
  folded: string[];
  firstEdge: Edge | null;
  fork: string | null;
};

export type ByRank = (a: string, b: string) => number;

export type Walk = {
  outs: Map<string, Edge[]>;
  ins: Map<string, Edge[]>;
  byRank: ByRank;
};

/** A shared split: the block reaches each source routes through it. */
export type Split = { id: string; through: Map<string, Reach[]> };

/** Steps of a reach's folded set on its way into `at`, and on from it. */
function aroundStep(
  reach: Reach,
  at: string,
  { outs, ins }: Walk
): { before: Set<string>; after: Set<string> } {
  const inner = new Set(reach.folded);
  const walk = (next: Map<string, Edge[]>, forward: boolean) => {
    const seen = new Set<string>();
    const stack = [at];
    while (stack.length > 0) {
      for (const edge of next.get(stack.pop()!)!) {
        const id = forward ? edge.to : edge.from;
        if (id === at || !inner.has(id) || seen.has(id)) continue;
        seen.add(id);
        stack.push(id);
      }
    }
    return seen;
  };
  return { before: walk(ins, false), after: walk(outs, true) };
}

/** The latest of `target`'s predecessors among `steps`, by flow order. */
export function forkOf(
  target: string,
  steps: Set<string>,
  ins: Map<string, Edge[]>,
  byRank: ByRank
): string | null {
  return (
    ins
      .get(target)!
      .map(edge => edge.from)
      .filter(id => steps.has(id))
      .sort(byRank)
      .at(-1) ?? null
  );
}

/** A budget's "spent?" question sits right after its `run_budget` command. */
function isBudgetQuestion(
  id: string,
  ins: Map<string, Edge[]>,
  nodeOf: Map<string, Graph['nodes'][number]>
): boolean {
  const into = ins.get(id)!;
  if (into.length !== 1) return false;
  const before = nodeOf.get(into[0]!.from)!;
  return (
    before.shape === 'plaintext' &&
    (before.label ?? '').startsWith('run_budget ')
  );
}

/** Two or more sources, two or more targets, and two or more of the
    question's exits taken. */
function qualifies(at: string, through: Reach[], walk: Walk): boolean {
  const exits = new Set(
    through.map(reach => {
      const { after } = aroundStep(reach, at, walk);
      return walk.outs
        .get(at)!
        .findIndex(edge => edge.to === reach.to || after.has(edge.to));
    })
  );
  const sources = new Set(through.map(reach => reach.from));
  const targets = new Set(through.map(reach => reach.to));
  return sources.size >= 2 && targets.size >= 2 && exits.size >= 2;
}

/** The links a split stands for: one per source into it, one per target
    out of it. */
function splitReaches(split: Split, walk: Walk): Reach[] {
  const { outs, ins, byRank } = walk;
  const into: Reach[] = [];
  const onward = new Map<string, Set<string>>();
  for (const [source, through] of split.through) {
    const before = new Set<string>();
    for (const reach of through) {
      const steps = aroundStep(reach, split.id, walk);
      for (const id of steps.before) before.add(id);
      const after = onward.get(reach.to) ?? new Set<string>();
      for (const id of steps.after) after.add(id);
      onward.set(reach.to, after);
    }
    into.push({
      from: source,
      to: split.id,
      folded: [...before].sort(byRank),
      firstEdge:
        outs
          .get(source)!
          .find(edge => edge.to === split.id || before.has(edge.to)) ?? null,
      fork: forkOf(split.id, before, ins, byRank),
    });
  }
  const out = [...onward].map(([to, after]) => ({
    from: split.id,
    to,
    folded: [...after].sort(byRank),
    firstEdge:
      outs.get(split.id)!.find(edge => edge.to === to || after.has(edge.to)) ??
      null,
    fork: forkOf(to, new Set([split.id, ...after]), ins, byRank),
  }));
  return [...into, ...out];
}

/** Shared splits, in flow order: a graph-only question, never a budget's,
    that block reaches from two or more sources pass on their way to two or
    more targets, leaving it by two or more of its exits. A reach routed
    through one split never feeds a later one. */
export function findSplits(
  graph: Graph,
  order: string[],
  base: Reach[],
  isBlock: (id: string) => boolean,
  walk: Walk
): Split[] {
  const { byRank } = walk;
  const nodeOf = new Map(graph.nodes.map(node => [node.id, node]));
  const splits: Split[] = [];
  let free = base;
  for (const at of order) {
    const node = nodeOf.get(at)!;
    if (
      node.blockId !== null ||
      node.shape !== 'diamond' ||
      isBudgetQuestion(at, walk.ins, nodeOf)
    ) {
      continue;
    }
    const through = free.filter(
      reach =>
        isBlock(reach.from) &&
        byRank(reach.to, reach.from) > 0 &&
        byRank(at, reach.from) > 0 &&
        reach.folded.includes(at)
    );
    if (!qualifies(at, through, walk)) continue;
    const bySource = new Map<string, Reach[]>();
    for (const reach of through) {
      bySource.set(reach.from, [...(bySource.get(reach.from) ?? []), reach]);
    }
    splits.push({ id: at, through: bySource });
    free = free.filter(reach => !through.includes(reach));
  }
  return splits;
}

/** Longest-path layers over the forward reaches, in flow order. */
function layersOf(
  ids: string[],
  reaches: Reach[],
  byRank: ByRank
): Record<string, number> {
  const layers: Record<string, number> = {};
  for (const id of ids) layers[id] = 0;
  for (const id of ids) {
    for (const reach of reaches) {
      if (reach.from !== id || byRank(reach.to, reach.from) <= 0) continue;
      layers[reach.to] = Math.max(layers[reach.to]!, layers[id]! + 1);
    }
  }
  return layers;
}

/** Route reaches through the splits, then undo a source's long route into a
    split unless it carries the source's main line, and dissolve a split
    that no longer qualifies, until nothing changes. */
export function settleSplits(
  found: Split[],
  base: Reach[],
  mains: Set<Reach>,
  nodeIds: string[],
  walk: Walk,
  jumpLayers: number
): {
  splits: string[];
  reaches: Reach[];
  layers: Record<string, number>;
} {
  const splits = [...found];
  const routed = () => {
    const taken = new Set(
      splits.flatMap(split => [...split.through.values()].flat())
    );
    return [
      ...base.filter(reach => !taken.has(reach)),
      ...splits.flatMap(split => splitReaches(split, walk)),
    ];
  };
  const layersNow = (reaches: Reach[]) =>
    layersOf(
      [...nodeIds, ...splits.map(split => split.id)].sort(walk.byRank),
      reaches,
      walk.byRank
    );

  let reaches = routed();
  let layers = layersNow(reaches);
  for (let settled = false; !settled;) {
    settled = true;
    for (const split of [...splits]) {
      for (const [source, through] of split.through) {
        const span = layers[split.id]! - layers[source]!;
        if (span >= jumpLayers && !through.some(reach => mains.has(reach))) {
          split.through.delete(source);
          settled = false;
        }
      }
      if (!qualifies(split.id, [...split.through.values()].flat(), walk)) {
        splits.splice(splits.indexOf(split), 1);
        settled = false;
      }
    }
    reaches = routed();
    layers = layersNow(reaches);
  }
  return { splits: splits.map(split => split.id), reaches, layers };
}
