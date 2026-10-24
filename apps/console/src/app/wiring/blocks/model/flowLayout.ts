import type { BlocksPayload } from '../../../../server/blocksPayload';
import type { AroundGraphData } from './around';
import type { Dot } from './blockFacts';
import type { MapKind } from './blockMap';
import type { Box, LaidOut, LayoutInput } from './elkGraph';
import { cutLabel, shortLabel } from './labels';
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
  focus: boolean;
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
  input: LayoutInput;
};

const noFacts = (): BlockFacts => ({ kind: 'step', dots: [] });

function stepBadge(node: GraphNode): MapKind {
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
    exit label, cut at its first colon, placed by ELK as a tail label. */
export function flowLayout(
  graph: Graph | AroundGraphData,
  {
    skill,
    focus,
    factsOf = noFacts,
    measure,
  }: {
    skill?: string;
    focus: string | null;
    factsOf?: (blockId: string) => BlockFacts;
    measure: Measure;
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
        focus: node.id === focus,
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
      focus: node.id === focus,
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

  const input: LayoutInput = {
    nodes: [...cards.values()].map(card => ({
      id: card.id,
      width: card.width,
      height: card.height,
      anchorX: card.width / 2,
    })),
    edges: edges.map(edge => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      ...(edge.label
        ? {
            label: {
              text: edge.label,
              width: Math.ceil(measure(edge.label, 11, 400) + 2 * CHIP.padX),
              height: CHIP.height,
            },
          }
        : {}),
    })),
  };
  return { cards, edges, input };
}

/** How far a label may sit from its edge's start or first bend. */
export const LABEL_REACH = 40;

type Point = [number, number];

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

const reach = (box: Box, [x, y]: Point) =>
  Math.hypot(
    Math.max(box.x - x, 0, x - (box.x + box.width)),
    Math.max(box.y - y, 0, y - (box.y + box.height))
  );

const SPOT_STEP = 4;
/** The air a label keeps from lines, cards and other labels where it can;
    where it cannot, touching is the fallback. */
const CLEARANCE = 3;

/** Spots within LABEL_REACH of the edge's start and first bend, on a
    SPOT_STEP grid, nearest first: beside the drop and under the bend come
    before anywhere further out. */
function spotsNear(points: Point[], width: number, height: number): Box[] {
  const spots: { box: Box; distance: number }[] = [];
  for (const anchor of points.slice(0, points.length > 2 ? 2 : 1)) {
    const [x, y] = anchor;
    for (let dy = -LABEL_REACH - height; dy <= LABEL_REACH; dy += SPOT_STEP) {
      for (let dx = -LABEL_REACH - width; dx <= LABEL_REACH; dx += SPOT_STEP) {
        const box = { x: x + dx, y: y + dy, width, height };
        const distance = reach(box, anchor);
        if (distance <= LABEL_REACH) spots.push({ box, distance });
      }
    }
  }
  return spots.sort((a, b) => a.distance - b.distance).map(spot => spot.box);
}

/** ELK sets a tail label in the first layer gap its edge crosses, which on
    an edge that runs sideways first can be far down its drop. A label that
    lands further than LABEL_REACH from its start and first bend, or over
    a line, a card or a label, moves to the nearest clear spot; with none
    clear it stays where ELK set it. */
export function placeLabels(laidOut: LaidOut): LaidOut {
  const cards = Object.values(laidOut.nodes);
  const lines = Object.values(laidOut.edges).map(edge => edge.points);
  const placed: Box[] = [];
  const clear = (box: Box, points: Point[], air: number) => {
    const room = {
      x: box.x - air,
      y: box.y - air,
      width: box.width + 2 * air,
      height: box.height + 2 * air,
    };
    return (
      (reach(box, points[0]!) <= LABEL_REACH ||
        (points.length > 2 && reach(box, points[1]!) <= LABEL_REACH)) &&
      !cards.some(card => overlaps(room, card)) &&
      !placed.some(other => overlaps(room, other)) &&
      !lines.some(line =>
        line.slice(1).some((point, i) => crosses(line[i]!, point, room))
      )
    );
  };

  const edges: LaidOut['edges'] = {};
  for (const [id, edge] of Object.entries(laidOut.edges)) {
    const { label, points } = edge;
    if (!label || points.length < 2) {
      edges[id] = edge;
      continue;
    }
    const spots = [label, ...spotsNear(points, label.width, label.height)];
    const spot =
      spots.find(box => clear(box, points, CLEARANCE)) ??
      spots.find(box => clear(box, points, 0)) ??
      label;
    placed.push(spot);
    edges[id] = { points, label: spot };
  }
  return { ...laidOut, edges };
}
