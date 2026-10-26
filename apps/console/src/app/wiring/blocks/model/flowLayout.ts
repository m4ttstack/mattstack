import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../../server/blocksPayload';
import type { AroundGraphData } from './around';
import { dotsOf, glyphOf, type Dot } from './blockFacts';
import { flowOrder, type MapKind } from './blockMap';
import type { Box, LaidOut, LayoutInput } from './elkGraph';
import { cutLabel, exitLabel, shortLabel } from './labels';
import { CARD, cardWidth, CHIP, type Measure } from './mapLayout';

type Graph = BlocksPayload['graphs'][number];
type GraphNode = Graph['nodes'][number];

export const STEP = {
  height: 36,
  border: 1,
  padLeft: 8,
  badge: 18,
  badgeGap: 8,
  padRight: 12,
  /** A longer label ends in an ellipsis, its whole text in the title. */
  maxLabel: 240,
} as const;

export type BlockFacts = { kind: MapKind; dots: Dot[] };

export type FlowCard = {
  id: string;
  /** A block opens on click; a step is a graph-only node. */
  kind: 'block' | 'step';
  blockId: string | null;
  label: string;
  /** The whole label, when the card shows less of it. */
  title: string | null;
  badge: MapKind;
  dots: Dot[];
  width: number;
  height: number;
};

export type FlowEdge = {
  id: string;
  from: string;
  to: string;
  label: string | null;
};

export type FlowLayout = {
  cards: Map<string, FlowCard>;
  edges: FlowEdge[];
  /** The node ids in flow order. */
  order: string[];
  input: LayoutInput;
};

const noFacts = (): BlockFacts => ({ kind: 'step', dots: [] });

/** A block's kind badge and layer dots, read from the payload. */
export function blockFactsOf(
  payload: BlocksPayload | undefined
): (blockId: string) => BlockFacts {
  const byId = new Map<string, PayloadBlock>(
    payload?.blocks.map(block => [block.id, block])
  );
  return blockId => {
    const block = byId.get(blockId);
    const kind = block && payload ? glyphOf(payload, block) : null;
    return {
      kind: kind === 'question' || kind === 'gate' ? kind : 'step',
      dots: block ? dotsOf(block) : [],
    };
  };
}

export function stepBadge(node: Pick<GraphNode, 'cls' | 'shape'>): MapKind {
  if (node.cls === 'done') return 'end';
  return node.shape === 'diamond' ? 'question' : 'step';
}

function stepWidth(label: string, measure: Measure): number {
  return Math.ceil(
    2 * STEP.border +
      STEP.padLeft +
      STEP.badge +
      STEP.badgeGap +
      Math.min(STEP.maxLabel, measure(label, 12, 500)) +
      STEP.padRight
  );
}

/** Every node of a graph as a card and every edge as an ELK edge with its
    exit label, cut at its first colon, placed by ELK as a tail label. Nodes
    and edges go to ELK in flow order: `order` when given (the whole
    graph's, for a part of it), else the graph's own. */
export function flowLayout(
  graph: Graph | AroundGraphData,
  {
    skill,
    factsOf = noFacts,
    measure,
    order: wholeOrder,
  }: {
    skill?: string;
    factsOf?: (blockId: string) => BlockFacts;
    measure: Measure;
    order?: string[];
  }
): FlowLayout {
  const cards = new Map<string, FlowCard>();
  for (const node of graph.nodes) {
    const whole = node.label ?? node.id;
    if (node.blockId) {
      const { kind, dots } = factsOf(node.blockId);
      cards.set(node.id, {
        id: node.id,
        kind: 'block',
        blockId: node.blockId,
        label: whole,
        title: null,
        badge: kind,
        dots,
        width: cardWidth(whole, dots.length, measure),
        height: CARD.height,
      });
      continue;
    }
    const label = shortLabel(whole, skill);
    const cut = measure(label, 12, 500) > STEP.maxLabel;
    cards.set(node.id, {
      id: node.id,
      kind: 'step',
      blockId: null,
      label,
      title: label !== whole || cut ? whole : null,
      badge: stepBadge(node),
      dots: [],
      width: stepWidth(label, measure),
      height: STEP.height,
    });
  }

  const edges = graph.edges
    .filter(edge => cards.has(edge.from) && cards.has(edge.to))
    .map((edge, index): FlowEdge => ({
      id: `${edge.from}->${edge.to}#${index}`,
      from: edge.from,
      to: edge.to,
      label: edge.label ? cutLabel(edge.label) || null : null,
    }));

  const order = (wholeOrder ?? flowOrder(graph)).filter(id => cards.has(id));
  const rank = new Map(order.map((id, index) => [id, index]));
  const flowRank = (id: string) => rank.get(id) ?? Infinity;
  const input: LayoutInput = {
    nodes: [...cards.values()]
      .sort((a, b) => flowRank(a.id) - flowRank(b.id))
      .map(card => ({
        id: card.id,
        width: card.width,
        height: card.height,
        anchorX: card.width / 2,
      })),
    edges: [...edges]
      .sort((a, b) => flowRank(a.from) - flowRank(b.from))
      .map(edge => ({
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
      })),
  };
  return { cards, edges, order, input };
}

/** How far a label may sit from its edge's start or first bend. */
export const LABEL_REACH = 40;

type Point = [number, number];

const SPOT_STEP = 4;
/** The air a moved label keeps from lines, cards and other labels where it
    can; where it cannot, touching is the fallback. */
const CLEARANCE = 3;

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

function crosses(a: Point, b: Point, box: Box): boolean {
  return overlaps(
    {
      x: Math.min(a[0], b[0]),
      y: Math.min(a[1], b[1]),
      width: Math.abs(a[0] - b[0]),
      height: Math.abs(a[1] - b[1]),
    },
    box
  );
}

const crossesLine = (line: Point[], box: Box) =>
  line.slice(1).some((point, i) => crosses(line[i]!, point, box));

const grown = (box: Box, air: number): Box => ({
  x: box.x - air,
  y: box.y - air,
  width: box.width + 2 * air,
  height: box.height + 2 * air,
});

const reach = (box: Box, [x, y]: Point) =>
  Math.hypot(
    Math.max(box.x - x, 0, x - (box.x + box.width)),
    Math.max(box.y - y, 0, y - (box.y + box.height))
  );

/** The side an edge turns to at its first bend: 1 right, -1 left; a
    straight edge counts as turning right. */
function turnOf(points: Point[]): 1 | -1 {
  if (points.length < 3) return 1;
  return points[2]![0] < points[1]![0] ? -1 : 1;
}

/** Spots within LABEL_REACH of the edge's start and first bend, on a
    SPOT_STEP grid, nearest first, and among equally near spots those on
    the side the edge turns to first. */
function spotsNear(points: Point[], width: number, height: number): Box[] {
  const turn = turnOf(points);
  const spots: { box: Box; distance: number; away: number }[] = [];
  for (const anchor of points.slice(0, points.length > 2 ? 2 : 1)) {
    const [x, y] = anchor;
    for (let dy = -LABEL_REACH - height; dy <= LABEL_REACH; dy += SPOT_STEP) {
      for (let dx = -LABEL_REACH - width; dx <= LABEL_REACH; dx += SPOT_STEP) {
        const box = { x: x + dx, y: y + dy, width, height };
        const distance = reach(box, anchor);
        const centre = box.x + width / 2;
        const away = Math.sign(centre - x) === turn ? 0 : 1;
        if (distance <= LABEL_REACH) spots.push({ box, distance, away });
      }
    }
  }
  return spots
    .sort((a, b) => a.distance - b.distance || a.away - b.away)
    .map(spot => spot.box);
}

/** ELK sets a tail label in the first layer gap its edge crosses, which on
    an edge that runs sideways first can be far down its drop. ELK's spot
    stands when it meets the label rules: within LABEL_REACH of the start or
    first bend, and off every line, card and label. Otherwise the label
    moves to the nearest spot that meets them with CLEARANCE to spare, then
    to the nearest that meets them at all; with none it stays put. */
export function placeLabels(laidOut: LaidOut): LaidOut {
  const cards = Object.values(laidOut.nodes);
  const lines = Object.values(laidOut.edges).map(edge => edge.points);
  const placed: Box[] = [];
  const near = (box: Box, points: Point[]) =>
    reach(box, points[0]!) <= LABEL_REACH ||
    (points.length > 2 && reach(box, points[1]!) <= LABEL_REACH);
  const inside = (box: Box) =>
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= laidOut.width &&
    box.y + box.height <= laidOut.height;
  const clear = (box: Box, points: Point[], air: number) => {
    const room = grown(box, air);
    return (
      near(box, points) &&
      !cards.some(card => overlaps(room, card)) &&
      !placed.some(other => overlaps(room, other)) &&
      !lines.some(line => crossesLine(line, room))
    );
  };

  const edges: LaidOut['edges'] = {};
  for (const [id, edge] of Object.entries(laidOut.edges)) {
    const { label, points } = edge;
    if (!label || points.length < 2) {
      edges[id] = edge;
      continue;
    }
    let spot = label;
    if (!clear(label, points, 0)) {
      const spots = spotsNear(points, label.width, label.height).filter(inside);
      spot =
        spots.find(box => clear(box, points, CLEARANCE)) ??
        spots.find(box => clear(box, points, 0)) ??
        label;
    }
    placed.push(spot);
    edges[id] = { points, label: spot };
  }
  return { ...laidOut, edges };
}

/** The scroll offset that centres a box `x`..`x + width` (drawn at `zoom`,
    with the map `offset` px in from the plane's left) in a canvas
    `visible` px wide, kept within the plane. */
export function scrollToShow(
  { x, width }: Pick<Box, 'x' | 'width'>,
  {
    zoom,
    offset,
    visible,
    plane,
  }: {
    zoom: number;
    offset: number;
    visible: number;
    plane: number;
  }
): number {
  const centre = offset + (x + width / 2) * zoom;
  return Math.max(0, Math.min(plane - visible, centre - visible / 2));
}
