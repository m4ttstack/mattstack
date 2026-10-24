import type { BlocksPayload } from '../../../../server/blocksPayload';
import { adjacency, exitNodes, type BlockMap, type MapLink } from './blockMap';
import { cutLabel } from './labels';

type Graph = BlocksPayload['graphs'][number];

export type BandJump = {
  label: string;
  target: string;
  direction: 'back' | 'forward';
};

export type BandNode =
  | { id: string; kind: 'command'; text: string }
  | {
      id: string;
      kind: 'question' | 'step' | 'budget';
      label: string;
      jumps: BandJump[];
      pills: string[];
    };

export type Band = {
  nodes: BandNode[];
  edges: { id: string; source: string; target: string }[];
};

const BUDGET = /^run_budget \{key: ([^,]+), limit: (\d+)/;
const SPENT = /spent( \(.*\))?\?$/;

/** A `run_budget` key's name as a question, with its limit. A key is
    `<skill>:<name>` with an optional trailing `:<case id>`. */
export function budgetLabel(key: string, limit: number): string {
  const parts = key.split(':');
  const name = (parts.length > 1 ? parts[1] : parts[0]).replaceAll('-', ' ');
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} left? · ${limit}`;
}

/** A graph-only label drops a trailing parenthetical that only names the
    skill: `Rebase status (ship)?` reads `Rebase status?` on ship. */
function stepLabel(label: string, skill: string): string {
  const named = new RegExp(
    `\\s*\\(${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)(\\??)$`
  );
  return label.replace(named, '$1');
}

/** The card asks "left?", the opposite of the "spent?" question it replaces. */
function flipped(label: string): string {
  if (label === 'yes') return 'no';
  if (label === 'no') return 'yes';
  return label;
}

/** A link's folded steps as a small graph of their own. */
export function foldBand(graph: Graph, link: MapLink, map: BlockMap): Band {
  const outs = adjacency(graph, true);
  const exits = exitNodes(graph, outs, adjacency(graph, false));
  const nodeOf = new Map(graph.nodes.map(node => [node.id, node]));
  const rank = new Map(map.order.map((id, index) => [id, index]));
  const skill = graph.blockId.split('/')[0]!;
  const folded = new Set(link.folded);
  const isBlock = (id: string) => (nodeOf.get(id)?.blockId ?? null) !== null;

  const budgets = new Map<string, { question: string; label: string }>();
  const mergedInto = new Map<string, string>();
  for (const id of link.folded) {
    const node = nodeOf.get(id)!;
    const budget = node.shape === 'plaintext' && node.label?.match(BUDGET);
    const out = outs.get(id)!;
    if (!budget || out.length !== 1) continue;
    const question = nodeOf.get(out[0]!.to)!;
    if (
      question.shape !== 'diamond' ||
      !folded.has(question.id) ||
      !SPENT.test(question.label ?? '')
    ) {
      continue;
    }
    budgets.set(id, {
      question: question.id,
      label: budgetLabel(budget[1]!, Number(budget[2])),
    });
    mergedInto.set(question.id, id);
  }
  const bandId = (id: string) => mergedInto.get(id) ?? id;

  const jumpTarget = (start: string): string => {
    const seen = new Set([start]);
    const queue = [start];
    let firstExit: string | null = null;
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (isBlock(id)) return id;
      if (exits.has(id)) {
        firstExit ??= id;
        continue;
      }
      for (const edge of outs.get(id)!) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
    return firstExit ?? start;
  };

  const exitsOf = (id: string, flip: boolean) => {
    const jumps: BandJump[] = [];
    const pills: string[] = [];
    for (const edge of outs.get(id)!) {
      const cut = edge.label ? cutLabel(edge.label) : '';
      const label = flip ? flipped(cut) : cut;
      if (folded.has(edge.to) || link.to.includes(edge.to)) {
        if (label) pills.push(label);
        continue;
      }
      const target = jumpTarget(edge.to);
      const back = rank.get(target)! <= rank.get(link.from)!;
      jumps.push({ label, target, direction: back ? 'back' : 'forward' });
    }
    return { jumps, pills };
  };

  const nodes: BandNode[] = [];
  for (const id of link.folded) {
    if (mergedInto.has(id)) continue;
    const node = nodeOf.get(id)!;
    const budget = budgets.get(id);
    if (budget) {
      nodes.push({
        id,
        kind: 'budget',
        label: budget.label,
        ...exitsOf(budget.question, true),
      });
    } else if (node.shape === 'plaintext') {
      nodes.push({ id, kind: 'command', text: node.label ?? id });
    } else {
      nodes.push({
        id,
        kind: node.shape === 'diamond' ? 'question' : 'step',
        label: stepLabel(node.label ?? id, skill),
        ...exitsOf(id, false),
      });
    }
  }

  const edges = new Map<string, Band['edges'][number]>();
  for (const edge of graph.edges) {
    if (!folded.has(edge.from) || !folded.has(edge.to)) continue;
    const source = bandId(edge.from);
    const target = bandId(edge.to);
    const id = `${source}->${target}`;
    if (source !== target && !edges.has(id)) {
      edges.set(id, { id, source, target });
    }
  }

  return { nodes, edges: [...edges.values()] };
}
