import type { BlocksPayload } from '../../../../server/blocksPayload';
import type { Dot } from './blockFacts';
import type { BlockMap, MapLink, MapNode } from './blockMap';
import type { LayoutEdge, LayoutInput, LayoutNode } from './elkGraph';
import { exitLabel, shortLabel } from './labels';

type Graph = BlocksPayload['graphs'][number];

/** A text's drawn width in px at this font size and weight. */
export type Measure = (text: string, size: number, weight: number) => number;

export const CARD = {
  height: 40,
  border: 1,
  padLeft: 10,
  badge: 20,
  badgeGap: 9,
  padRight: 14,
  /** The › a card that opens a block ends with, a flex gap after the
      label. */
  goGap: 9,
  go: 12,
  dotsGap: 9,
  dot: 6,
  dotGap: 4,
  pillsGap: 8,
} as const;

export const PILL = { padX: 10, gap: 6, icon: 12 } as const;

export const SPLIT = { size: 10, pillsGap: 9 } as const;

export const CHIP = { height: 16, padX: 7 } as const;

const MAIN_PRIORITY = 20;

/** The map is never drawn smaller than this; past it the canvas scrolls. */
export const MIN_MAP_ZOOM = 0.85;

/** The zoom that fits a map `mapWidth` wide into `available` px, between
    MIN_MAP_ZOOM and full size; full size until the canvas is measured. */
export function fitZoom(available: number, mapWidth: number): number {
  if (available <= 0 || mapWidth <= 0) return 1;
  return Math.min(1, Math.max(MIN_MAP_ZOOM, available / mapWidth));
}

/** The zoom, the plane's width and the map's offset in from the plane's
    left for a map `mapWidth` wide in a canvas `available` px wide. A
    measured width can be fractional, and a plane even a fraction wider
    than its canvas scrolls. */
export function canvasPlane(
  available: number,
  mapWidth: number
): { zoom: number; plane: number; offset: number } {
  const room = Math.floor(available);
  const zoom = fitZoom(room, mapWidth);
  const drawn = mapWidth * zoom;
  const plane = drawn <= room + 0.5 ? room : Math.ceil(drawn);
  return { zoom, plane, offset: Math.max(0, (plane - drawn) / 2) };
}

export type Pill = {
  id: string;
  label: string | null;
  target: string;
  targets: string[];
  direction: 'back' | 'forward';
};

export type MapBox = {
  node: MapNode;
  dots: Dot[];
  /** The card's width, or the dot's for a split. */
  width: number;
  pills: Pill[];
  main: boolean;
};

export type MapEdge = {
  id: string;
  from: string;
  to: string;
  folded: boolean;
  arrow: boolean;
  label: string | null;
};

export type MapLayout = {
  boxes: Map<string, MapBox>;
  edges: MapEdge[];
  junctions: string[];
  input: LayoutInput;
};

/** The skill a graph belongs to: its block id's first segment. */
export const skillOf = (graph: Graph) => graph.blockId.split('/')[0]!;

/** A jump pill's target: one target's label, else the targets' shared
    leading word, else the fork question's short label. A split drops its
    question's trailing parenthetical: a long one widens the source's box
    and with it the whole map. */
export function pillTarget(link: MapLink, map: BlockMap, graph: Graph): string {
  const labelOf = (id: string) => {
    const node = map.nodes.find(each => each.id === id);
    if (!node) return id;
    return node.kind === 'split'
      ? shortLabel(node.label, skillOf(graph)).replace(
          /\s*\([^()]*\)(\??)$/,
          '$1'
        )
      : node.label;
  };
  if (link.to.length === 1) return labelOf(link.to[0]!);
  const words = link.to.map(id => labelOf(id).split(' ')[0]!);
  if (words.every(word => word === words[0])) return words[0]!;
  const fork = link.fork ?? link.folded.at(-1);
  const question = graph.nodes.find(node => node.id === fork)?.label ?? '';
  return shortLabel(question, skillOf(graph));
}

/** The happy path down the map: each block's trunk main, else its
    only line; from a split, the line its first-declared exit takes. */
export function mainColumn(
  map: BlockMap,
  graph: Graph
): { nodes: string[]; links: Set<string> } {
  const kindOf = new Map(map.nodes.map(node => [node.id, node.kind]));
  const lines = map.links.filter(link => link.kind === 'line');
  const byExit = (at: string, outs: MapLink[]) => {
    for (const edge of graph.edges) {
      if (edge.from !== at) continue;
      const via = outs.filter(
        link => link.to[0] === edge.to || link.folded.includes(edge.to)
      );
      if (via.length > 0) return via.find(link => link.trunk?.main) ?? via[0]!;
    }
    return outs[0]!;
  };
  const next = (at: string): MapLink | null => {
    const outs = lines.filter(link => link.from === at);
    if (outs.length === 0) return null;
    if (kindOf.get(at) !== 'split') {
      const main = outs.find(link => link.trunk?.main);
      if (main) return main;
      if (outs.length === 1) return outs[0]!;
    }
    return byExit(at, outs);
  };

  const nodes: string[] = [];
  const links = new Set<string>();
  let at = map.order.find(id => kindOf.has(id) && kindOf.get(id) !== 'split');
  while (at !== undefined && !nodes.includes(at)) {
    nodes.push(at);
    const step = next(at);
    if (!step) break;
    links.add(step.id);
    at = step.to[0];
  }
  return { nodes, links };
}

export function cardWidth(
  label: string,
  dots: number,
  measure: Measure
): number {
  const dotsWidth =
    dots > 0 ? CARD.dotsGap + dots * CARD.dot + (dots - 1) * CARD.dotGap : 0;
  return Math.ceil(
    2 * CARD.border +
      CARD.padLeft +
      CARD.badge +
      CARD.badgeGap +
      measure(label, 13, 500) +
      dotsWidth +
      CARD.goGap +
      CARD.go +
      CARD.padRight
  );
}

/** What a card's chip says when it jumps more than once: the count, and
    which way when every jump goes the same way. */
export function jumpsLabel(pills: Pick<Pill, 'direction'>[]): string {
  const way = pills.every(pill => pill.direction === 'back')
    ? ' back'
    : pills.every(pill => pill.direction === 'forward')
      ? ' ahead'
      : '';
  return `${pills.length} jumps${way}`;
}

/** One jump is a pill naming its target; several are one chip that lists
    them when opened. */
export function pillsWidth(pills: Pill[], measure: Measure): number {
  if (pills.length === 0) return 0;
  const text =
    pills.length === 1 ? pills[0]!.target : jumpsLabel(pills);
  const caret = pills.length === 1 ? 0 : PILL.gap + PILL.icon;
  return Math.ceil(
    2 * PILL.padX + PILL.icon + PILL.gap + measure(text, 12, 500) + caret
  );
}

/** Cards, pills, junctions and edges for the map, and the ELK input that
    places them: a node's box holds its card and its pills, and its ports
    sit at the card's centre. Jumps are pills, never ELK edges. */
export function mapLayout(
  map: BlockMap,
  graph: Graph,
  { dotsOf, measure }: { dotsOf: (blockId: string) => Dot[]; measure: Measure }
): MapLayout {
  const rank = new Map(map.order.map((id, index) => [id, index]));
  const kindOf = new Map(map.nodes.map(node => [node.id, node.kind]));
  const main = mainColumn(map, graph);
  const onMain = new Set(main.nodes);

  const pillsOf = new Map<string, Pill[]>();
  for (const link of map.links) {
    if (link.kind === 'line') continue;
    // A jump back onto its own card goes nowhere a reader can follow.
    if (link.to.length === 1 && link.to[0] === link.from) continue;
    pillsOf.set(link.from, [
      ...(pillsOf.get(link.from) ?? []),
      {
        id: link.id,
        label: link.label,
        target: pillTarget(link, map, graph),
        targets: link.to,
        direction: link.kind === 'jump-back' ? 'back' : 'forward',
      },
    ]);
  }

  const natural = new Map(
    map.nodes.map(node => {
      const dots = node.blockId ? dotsOf(node.blockId) : [];
      return [
        node.id,
        { dots, width: cardWidth(node.label, dots.length, measure) },
      ];
    })
  );
  const mainWidth = Math.max(
    0,
    ...map.nodes
      .filter(node => onMain.has(node.id) && node.kind !== 'split')
      .map(node => natural.get(node.id)!.width)
  );

  const boxes = new Map<string, MapBox>();
  const nodes: LayoutNode[] = [];
  for (const node of map.nodes) {
    const split = node.kind === 'split';
    const { dots, width: own } = natural.get(node.id)!;
    const width = split ? SPLIT.size : onMain.has(node.id) ? mainWidth : own;
    const pills = pillsOf.get(node.id) ?? [];
    const jumpsWidth =
      pills.length === 0
        ? 0
        : (split ? SPLIT.pillsGap : CARD.pillsGap) +
          pillsWidth(pills, measure);
    boxes.set(node.id, { node, dots, width, pills, main: onMain.has(node.id) });
    nodes.push({
      id: node.id,
      width: width + jumpsWidth,
      height: split ? SPLIT.size : CARD.height,
      anchorX: width / 2,
    });
  }

  const edges: MapEdge[] = [];
  const priority = new Set<string>();
  const junctions: string[] = [];
  const arrowInto = (id: string) =>
    kindOf.has(id) && kindOf.get(id) !== 'split';
  const lineEdge = (id: string, from: string, link: MapLink) => {
    edges.push({
      id,
      from,
      to: link.to[0]!,
      folded: link.folded.length > 0,
      arrow: arrowInto(link.to[0]!),
      label: link.label,
    });
  };

  const trunks = new Map<string, MapLink[]>();
  for (const link of map.links) {
    if (link.kind !== 'line') continue;
    if (link.trunk === null) {
      lineEdge(link.id, link.from, link);
      if (main.links.has(link.id)) priority.add(link.id);
      continue;
    }
    trunks.set(link.trunk.group, [
      ...(trunks.get(link.trunk.group) ?? []),
      link,
    ]);
  }

  for (const [group, links] of trunks) {
    const trunkMain = links.find(link => link.trunk!.main)!;
    const branches = links.filter(link => !link.trunk!.main);
    const splitsAt = [
      ...new Set(branches.map(link => link.trunk!.splitAt)),
    ].sort((a, b) => rank.get(a)! - rank.get(b)!);
    const junction = (splitAt: string) => `${group}@${splitAt}`;
    const straight = main.links.has(trunkMain.id);
    // A split's exit label sits under the dot, on the trunk's first drop,
    // not down at the junction beside the branches' labels.
    const exitAtTop =
      kindOf.get(trunkMain.from) === 'split' && splitsAt.length > 0;
    let previous = trunkMain.from;
    for (const splitAt of splitsAt) {
      const id = `${group}>${splitAt}`;
      junctions.push(junction(splitAt));
      rank.set(junction(splitAt), rank.get(splitAt)!);
      edges.push({
        id,
        from: previous,
        to: junction(splitAt),
        folded: links.some(link => link.folded.length > 0),
        arrow: false,
        label:
          exitAtTop && previous === trunkMain.from ? trunkMain.label : null,
      });
      if (straight) priority.add(id);
      previous = junction(splitAt);
    }
    lineEdge(trunkMain.id, previous, trunkMain);
    if (exitAtTop) edges.at(-1)!.label = null;
    if (straight) priority.add(trunkMain.id);
    for (const branch of branches) {
      lineEdge(branch.id, junction(branch.trunk!.splitAt), branch);
    }
  }

  const flowRank = (id: string) => rank.get(id) ?? Infinity;
  const input: LayoutInput = {
    nodes: [
      ...nodes,
      ...junctions.map(id => ({ id, width: 1, height: 1 })),
    ].sort((a, b) => flowRank(a.id) - flowRank(b.id)),
    edges: [...edges]
      .sort((a, b) => flowRank(a.from) - flowRank(b.from))
      .map((edge): LayoutEdge => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        ...(edge.label
          ? {
              label: {
                text: exitLabel(edge.label),
                width: Math.ceil(
                  measure(exitLabel(edge.label), 11, 400) + 2 * CHIP.padX
                ),
                height: CHIP.height,
              },
            }
          : {}),
        ...(priority.has(edge.id) ? { priority: MAIN_PRIORITY } : {}),
      })),
  };
  return { boxes, edges, junctions, input };
}
