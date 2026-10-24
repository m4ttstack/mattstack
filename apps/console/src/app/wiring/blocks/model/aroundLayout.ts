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
  /** The label as the graph writes it, where the node shows less of it. */
  title?: string;
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
  /** Where the edge leaves its source's bottom, from the source's centre. */
  leave?: number;
  /** The x of the channel an upward edge climbs, right of the rows between. */
  back?: number | null;
  /** The drawn route, from the source's bottom to the target's top. */
  points?: Point[];
  /** The label's box: `x` is the edge of it nearest the drop. */
  labelAt?: LabelAt;
};
export type Point = readonly [number, number];
export type LabelAt = {
  x: number;
  y: number;
  width: number;
  height: number;
  side: 'left' | 'right';
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

/** How close a drop from the row above may pass a lower node's edge. */
export const DROP_CLEAR = 10;

/** Whether no drop at `drops` passes within DROP_CLEAR of these nodes. */
function clearOfDrops(
  centres: number[],
  widths: number[],
  drops: number[]
): boolean {
  return centres.every((centre, i) =>
    drops.every(drop => Math.abs(drop - centre) >= widths[i] / 2 + DROP_CLEAR)
  );
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
  const capped = new Set<string>();
  const widthOf = new Map(
    sub.nodes.map(node => {
      const text = measure(labelOf.get(node.id) ?? node.id);
      const w = Math.ceil((text + LABEL_CHROME) / 10) * 10;
      if (w > AROUND.maxNodeW) capped.add(node.id);
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
      const inGaps = wrap % 2 === 1 && gaps.length > 0;
      const slots = inGaps ? gaps : grid;
      let chunk = ids.slice(start, start + slots.length);
      const widths = chunk.map(w);
      const from = Math.floor((slots.length - chunk.length) / 2);
      // A row in the gaps seats its nodes in neighbouring gaps, or failing
      // that spread across them, wherever every drop above passes clear.
      const seatings = [chunk.map((_, index) => slots[from + index])];
      if (inGaps && chunk.length > 1 && chunk.length < slots.length) {
        const last = slots.length - 1;
        seatings.push(
          chunk.map(
            (_, index) => slots[Math.round((index * last) / (chunk.length - 1))]
          )
        );
      }
      const drops = inGaps ? grid : [];
      let centres = seatings.find(
        seating =>
          clear(seating, widths, room) && clearOfDrops(seating, widths, drops)
      );
      if (!centres) {
        chunk = chunk.slice(0, fitting(widths, room));
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
        ...(labelOf.get(node.id) !== (node.label ?? node.id) ||
        capped.has(node.id)
          ? { title: node.label ?? node.id }
          : {}),
        shape: node.shape,
        blockId: node.blockId,
        focus: node.id === focus,
      },
    };
  });

  // An edge between two nodes of one layer, a self-loop among them, would
  // run along its own row; the layout draws none.
  const edges = sub.edges
    .map((edge, index): AroundEdge => ({
      id: `${edge.from}->${edge.to}#${index}`,
      source: edge.from,
      target: edge.to,
      type: 'around',
      ...(edge.label === null ? {} : { label: edge.label }),
      data: {
        dashed: edge.style === 'dashed',
        back: backChannelOf(nodes, edge.from, edge.to),
      },
    }))
    .filter(edge => layers.get(edge.source) !== layers.get(edge.target));

  // A drop is checked for nodes in its way where it actually leaves its
  // source, so the leaving points come first.
  const fan = (list: AroundEdge[]) =>
    landPoints(
      nodes,
      fanBackChannels(
        nodes,
        fanChannels(
          nodes,
          list.map(edge =>
            edge.data
              ? {
                  ...edge,
                  data: {
                    ...edge.data,
                    channel: channelOf(
                      nodes,
                      edge.source,
                      edge.target,
                      edge.data.leave ?? 0
                    ),
                  },
                }
              : edge
          )
        )
      )
    );
  const leaving = leavePoints(nodes, edges, label =>
    labelWidth(label, measure)
  );
  const first = fan(leaving);
  const moved = roomForLabels(
    nodes,
    first.map(edge => withRoute(nodes, edge, () => 1)),
    measure
  );
  const fanned =
    moved.size === 0
      ? first
      : fan(
          leaving.map(edge =>
            moved.has(edge.id) && edge.data
              ? { ...edge, data: { ...edge.data, leave: moved.get(edge.id) } }
              : edge
          )
        );
  // Labels are placed on a first routing; a row whose labels stack pushes
  // the rows below it down, and the routes are drawn again on the result.
  const labels = placeLabels(
    nodes,
    fanned.map(edge => withRoute(nodes, edge, () => 1)),
    measure
  );
  const shifted = shiftRows(nodes, labels.levels);
  const levelsUnder = (source: AroundNode) =>
    labels.levels.get(rowKey(nodes, source.id)) ?? 1;
  const routed = fanned.map(edge => withRoute(shifted, edge, levelsUnder));
  const placed = resolveLabels(shifted, routed, labels.placed);
  return {
    nodes: shifted,
    edges: routed.map(edge => withLabel(edge, placed)),
    rows,
  };
}

/** An edge's corners in canvas px. A drop from a row bends either just
    above its target or, past a node between, down a side channel; an
    upward edge climbs a channel right of the rows it passes. Every
    horizontal run sits in a gap between rows, so no route crosses a node. */
function withRoute(
  nodes: AroundNode[],
  edge: AroundEdge,
  levelsUnder: (source: AroundNode) => number
): AroundEdge {
  const source = nodes.find(node => node.id === edge.source);
  const target = nodes.find(node => node.id === edge.target);
  if (!source || !target || !edge.data) return edge;
  const data = edge.data;
  const sx =
    source.position.x + (source.width ?? AROUND.nodeW) / 2 + (data.leave ?? 0);
  const sy = source.position.y + AROUND.nodeH;
  const tx =
    target.position.x + (target.width ?? AROUND.nodeW) / 2 + (data.land ?? 0);
  const ty = target.position.y;
  const channel = data.back ?? data.channel ?? null;
  let points: Point[];
  if (channel !== null) {
    // Each lane bends at its own height, below the drop labels that sit
    // just under the row.
    const step = ((data.lane ?? 0) % LANES) * 6;
    const busY = sy + BUS_DROP + (levelsUnder(source) - 1) * LABEL_STEP + step;
    const landY = ty - 12 - step;
    points = [
      [sx, sy],
      [sx, busY],
      [channel, busY],
      [channel, landY],
      [tx, landY],
      [tx, ty],
    ];
  } else {
    const bendY = ty - AROUND.rowGap / 2;
    points =
      sx === tx
        ? [
            [sx, sy],
            [tx, ty],
          ]
        : [
            [sx, sy],
            [sx, bendY],
            [tx, bendY],
            [tx, ty],
          ];
  }
  return { ...edge, data: { ...data, points } };
}

/** How far under its source a channelled edge's drop turns. */
const BUS_DROP = 22;
/** A label's gap from its drop, and from the row above it. */
const LABEL_GAP = 4;
const LABEL_H = 15;
/** The label's 12px against the 13px `measure` reads, plus its padding. */
const labelWidth = (label: string, measure: (label: string) => number) =>
  Math.ceil((measure(label) * 12) / 13) + 8;

/** A stacked label sits this far under the one above it. */
const LABEL_STEP = LABEL_H + 1;

type PlacedLabel = {
  side: LabelAt['side'];
  level: number;
  width: number;
  /** Under a horizontal run of the edge's own route, instead of beside the
      drop: next to the bend at the run's start, or at its `end`, and
      `offset` px along the run away from that bend. */
  run?: { segment: number; offset: number; end?: boolean };
};
type Span = { left: number; right: number; top: number; bottom: number };
type Line = { id: string; from: Point; to: Point };

/** The rows by their top, so a label's row and a node's row share a key. */
const rowKey = (nodes: AroundNode[], id: string) =>
  nodes.find(node => node.id === id)?.position.y ?? 0;

function spanOf(points: Point[], label: PlacedLabel): Span {
  const bend = label.run
    ? points[label.run.segment + (label.run.end ? 1 : 0)]!
    : points[0]!;
  const x =
    bend[0] + (label.side === 'right' ? 1 : -1) * (label.run?.offset ?? 0);
  const top = bend[1] + LABEL_GAP + label.level * LABEL_STEP;
  return label.side === 'right'
    ? {
        left: x + LABEL_GAP,
        right: x + LABEL_GAP + label.width,
        top,
        bottom: top + LABEL_H,
      }
    : {
        left: x - LABEL_GAP - label.width,
        right: x - LABEL_GAP,
        top,
        bottom: top + LABEL_H,
      };
}

const linesOf = (edges: AroundEdge[]): Line[] =>
  edges.flatMap(edge => {
    const points = edge.data?.points ?? [];
    return points
      .slice(1)
      .map((to, i) => ({ id: edge.id, from: points[i]!, to }));
  });

/** Whether a label's box, with a gap either side, touches a line other than
    `id`'s: the canvas measures labels in its own font, a few px off. */
function crossesLine(lines: Line[], id: string | null, span: Span): boolean {
  return lines.some(
    ({ id: other, from: [x1, y1], to: [x2, y2] }) =>
      other !== id &&
      Math.max(x1, x2) > span.left - LABEL_GAP &&
      Math.min(x1, x2) < span.right + LABEL_GAP &&
      Math.max(y1, y2) > span.top &&
      Math.min(y1, y2) < span.bottom
  );
}

/** The canvas's left and right edges: the nodes and every route. */
function boundsOf(nodes: AroundNode[], edges: AroundEdge[]) {
  const xs = edges.flatMap(edge => (edge.data?.points ?? []).map(([x]) => x));
  return {
    left: Math.min(...nodes.map(node => node.position.x), ...xs),
    right: Math.max(
      ...nodes.map(node => node.position.x + (node.width ?? AROUND.nodeW)),
      ...xs
    ),
  };
}

const dropOf = (edge: AroundEdge) => edge.data!.points![0]!;

/** Labelled edges top to bottom, then left to right by their drops. */
const labelledOf = (edges: AroundEdge[]) =>
  edges
    .filter(edge => edge.label && edge.data?.points?.length)
    .sort((a, b) => dropOf(a)[1] - dropOf(b)[1] || dropOf(a)[0] - dropOf(b)[0]);

/**
 * Each label sits beside its drop, just under its source: the leftmost of a
 * node's labelled drops takes the left side, the rest the right, or the
 * other side where that one is clear of the lines passing it. A label that
 * would cover another label in its row stacks under it; `levels` counts
 * each row's stack, which the rows below make room for.
 */
function placeLabels(
  nodes: AroundNode[],
  edges: AroundEdge[],
  measure: (label: string) => number
): { placed: Map<string, PlacedLabel>; levels: Map<number, number> } {
  const placed = new Map<string, PlacedLabel>();
  const levels = new Map<number, number>();
  if (nodes.length === 0) return { placed, levels };
  const { left, right } = boundsOf(nodes, edges);
  // A drop's label band holds only the lines passing down through it.
  const lines = linesOf(edges).filter(({ from, to }) => from[0] === to[0]);
  const fits = (span: Span) => span.left >= left && span.right <= right;
  const labelled = labelledOf(edges);
  const count = new Map<string, number>();
  for (const edge of labelled)
    count.set(edge.source, (count.get(edge.source) ?? 0) + 1);
  const seen = new Set<string>();
  const inRow = new Map<number, { span: Span; level: number }[]>();
  for (const edge of labelled) {
    const points = edge.data!.points!;
    const width = labelWidth(String(edge.label), measure);
    const first = !seen.has(edge.source);
    seen.add(edge.source);
    let side: LabelAt['side'] =
      first && (count.get(edge.source) ?? 0) > 1 ? 'left' : 'right';
    // Clear of lines and on the canvas, else clear of lines and widening
    // the canvas, else where it was meant to go.
    const score = (s: LabelAt['side']) => {
      const span = spanOf(points, { side: s, level: 0, width });
      if (crossesLine(lines, edge.id, span)) return 0;
      return fits(span) ? 2 : 1;
    };
    const other = side === 'left' ? 'right' : 'left';
    if (score(other) > score(side)) side = other;
    const row = rowKey(nodes, edge.source);
    const taken = inRow.get(row) ?? [];
    let level = 0;
    const covers = (at: number) => {
      const span = spanOf(points, { side, level: at, width });
      return taken.some(
        box =>
          box.level === at &&
          span.left < box.span.right + LABEL_GAP &&
          box.span.left < span.right + LABEL_GAP
      );
    };
    while (covers(level)) level += 1;
    taken.push({ span: spanOf(points, { side, level, width }), level });
    inRow.set(row, taken);
    levels.set(row, Math.max(levels.get(row) ?? 1, level + 1));
    placed.set(edge.id, { side, level, width });
  }
  return { placed, levels };
}

/** How far along a run, away from its bend, a label may slide. */
const BEND_SLIDE = 32;

/** The places just under the route's bend nearest its source and its bend
    nearest its target: under the run each one turns into, every 8px up to
    BEND_SLIDE away from the bend. A run's far end is no place for it. */
function bendPlaces(points: Point[], width: number): PlacedLabel[] {
  const runs = points
    .slice(1, -1)
    .map((from, i) => [i + 1, from, points[i + 2]!] as const)
    .filter(([, [x0, y0], [x1, y1]]) => y0 === y1 && x0 !== x1);
  const places: PlacedLabel[] = [];
  const along = (
    [segment, [x0], [x1]]: (typeof runs)[number],
    end: boolean
  ) => {
    const heads = x1 > x0 ? 'right' : 'left';
    const side = end ? (heads === 'right' ? 'left' : 'right') : heads;
    const slide = Math.min(BEND_SLIDE, Math.abs(x1 - x0));
    for (let offset = 0; offset <= slide; offset += 8)
      places.push({ side, level: 0, width, run: { segment, offset, end } });
  };
  if (runs.length > 0) {
    along(runs[0]!, false);
    along(runs[runs.length - 1]!, true);
  }
  return places;
}

const boxesOf = (nodes: AroundNode[]): Span[] =>
  nodes.map(node => ({
    left: node.position.x,
    right: node.position.x + (node.width ?? AROUND.nodeW),
    top: node.position.y,
    bottom: node.position.y + AROUND.nodeH,
  }));

const meets = (a: Span, b: Span, gap: number) =>
  a.left < b.right + gap &&
  b.left < a.right + gap &&
  a.top < b.bottom &&
  b.top < a.bottom;

/**
 * On the final routes, a label that sits on a line, its own included,
 * another label or a node moves: to the drop's other side, else just under
 * the bend nearest its source or its target, as the board sets "clean or
 * finished". The first place clear of everything and on the canvas wins,
 * then one clear past the canvas; a label with neither stays beside its
 * own drop.
 */
function resolveLabels(
  nodes: AroundNode[],
  edges: AroundEdge[],
  placed: Map<string, PlacedLabel>
): Map<string, PlacedLabel> {
  const resolved = new Map<string, PlacedLabel>();
  if (nodes.length === 0) return resolved;
  const lines = linesOf(edges);
  const { left, right } = boundsOf(nodes, edges);
  const boxes = boxesOf(nodes);
  const done: Span[] = [];
  for (const edge of labelledOf(edges)) {
    const base = placed.get(edge.id);
    if (!base) continue;
    const points = edge.data!.points!;
    const places = [
      base,
      { ...base, side: base.side === 'left' ? 'right' : 'left' },
      ...bendPlaces(points, base.width),
    ] satisfies PlacedLabel[];
    const clear = (place: PlacedLabel, onCanvas: boolean) => {
      const span = spanOf(points, place);
      return (
        !crossesLine(lines, null, span) &&
        !done.some(box => meets(span, box, LABEL_GAP)) &&
        !boxes.some(box => meets(span, box, 0)) &&
        (!onCanvas || (span.left >= left && span.right <= right))
      );
    };
    const pick =
      places.find(place => clear(place, true)) ??
      places.find(place => clear(place, false)) ??
      base;
    done.push(spanOf(points, pick));
    resolved.set(edge.id, pick);
  }
  return resolved;
}

/**
 * A source's only edge, whose label fits on neither side of its drop nor
 * under either bend, leaves from further along the source's bottom: from
 * where the drop and its label sit mid-way between the lines either side,
 * so the label goes beside its drop. Returns each moved edge's `leave`.
 */
function roomForLabels(
  nodes: AroundNode[],
  edges: AroundEdge[],
  measure: (label: string) => number
): Map<string, number> {
  const moved = new Map<string, number>();
  const lines = linesOf(edges);
  const boxes = boxesOf(nodes);
  const outs = new Map<string, number>();
  for (const edge of edges)
    outs.set(edge.source, (outs.get(edge.source) ?? 0) + 1);
  for (const edge of labelledOf(edges)) {
    const data = edge.data!;
    const source = nodes.find(node => node.id === edge.source);
    if (
      !source ||
      outs.get(edge.source) !== 1 ||
      data.channel != null ||
      data.back != null
    )
      continue;
    const points = data.points!;
    const width = labelWidth(String(edge.label), measure);
    const free = (place: PlacedLabel) => {
      const span = spanOf(points, place);
      return (
        !crossesLine(lines, null, span) &&
        !boxes.some(box => meets(span, box, 0))
      );
    };
    const places: PlacedLabel[] = [
      { side: 'right', level: 0, width },
      { side: 'left', level: 0, width },
      ...bendPlaces(points, width),
    ];
    if (places.some(free)) continue;
    const [dropX, sourceY] = points[0]!;
    const top = sourceY + LABEL_GAP;
    const passing = lines
      .filter(
        ({ id, from, to }) =>
          id !== edge.id &&
          from[0] === to[0] &&
          Math.max(from[1], to[1]) > top &&
          Math.min(from[1], to[1]) < top + LABEL_H
      )
      .map(({ from }) => from[0]);
    const before = Math.max(...passing.filter(x => x < dropX));
    const after = Math.min(...passing.filter(x => x > dropX));
    const block = LABEL_GAP + width;
    // Each side keeps twice the gap a label keeps from a line.
    if (after - before - block < 4 * LABEL_GAP) continue;
    const half = (source.width ?? AROUND.nodeW) / 2;
    const centre = source.position.x + half;
    const pick = [(before + after - block) / 2, (before + after + block) / 2]
      .map(Math.round)
      .filter(
        x =>
          Math.abs(x - centre) <= half - LEAVE_STEP &&
          channelOf(nodes, edge.source, edge.target, x - centre) === null
      )
      .sort((a, b) => Math.abs(a - dropX) - Math.abs(b - dropX))[0];
    if (pick !== undefined) moved.set(edge.id, pick - centre);
  }
  return moved;
}

/** Each row moves down by the stacked labels of the rows above it. */
function shiftRows(
  nodes: AroundNode[],
  levels: Map<number, number>
): AroundNode[] {
  const tops = [...new Set(nodes.map(node => node.position.y))].sort(
    (a, b) => a - b
  );
  const shift = new Map<number, number>();
  let by = 0;
  for (const top of tops) {
    shift.set(top, by);
    by += ((levels.get(top) ?? 1) - 1) * LABEL_STEP;
  }
  return nodes.map(node => ({
    ...node,
    position: {
      ...node.position,
      y: node.position.y + (shift.get(node.position.y) ?? 0),
    },
  }));
}

function withLabel(
  edge: AroundEdge,
  placed: Map<string, PlacedLabel>
): AroundEdge {
  const label = placed.get(edge.id);
  const points = edge.data?.points;
  if (!label || !points || !edge.data) return edge;
  const span = spanOf(points, label);
  const labelAt: LabelAt = {
    x: label.side === 'right' ? span.left : span.right,
    y: span.top,
    width: label.width,
    height: LABEL_H,
    side: label.side,
  };
  return { ...edge, data: { ...edge.data, labelAt } };
}

/** The least room between two leaving points on one source. */
const LEAVE_STEP = 20;

/** Edges out of one source leave side by side across its bottom, in the
    order their targets sit and an upward edge last, so each drop and its
    label read as its own. */
function leavePoints(
  nodes: AroundNode[],
  edges: AroundEdge[],
  widthOf: (label: string) => number
): AroundEdge[] {
  const at = (id: string) => nodes.find(node => node.id === id);
  const heading = (edge: AroundEdge) => {
    if (edge.data?.back != null) return Number.POSITIVE_INFINITY;
    const target = at(edge.target);
    return (target?.position.x ?? 0) + (target?.width ?? AROUND.nodeW) / 2;
  };
  const leave = new Map<string, number>();
  for (const source of new Set(edges.map(edge => edge.source))) {
    const out = edges
      .filter(edge => edge.source === source)
      .sort((a, b) => heading(a) - heading(b));
    if (out.length < 2) continue;
    const wide = at(source)?.width ?? AROUND.nodeW;
    // A label beside a drop wants the room up to the next drop.
    const labels = out
      .slice(1, -1)
      .filter(edge => edge.label)
      .map(edge => widthOf(String(edge.label)) + 2 * LABEL_GAP);
    const step = Math.min(
      Math.max(LEAVE_STEP, ...labels),
      (wide - 2 * LEAVE_STEP) / (out.length - 1)
    );
    out.forEach((edge, index) =>
      leave.set(edge.id, (index - (out.length - 1) / 2) * step)
    );
  }
  return edges.map(edge =>
    leave.has(edge.id) && edge.data
      ? { ...edge, data: { ...edge.data, leave: leave.get(edge.id) } }
      : edge
  );
}

/** Upward edges each climb their own lane right of the rows: further out
    for each, the highest source nearest the rows. */
function fanBackChannels(
  nodes: AroundNode[],
  edges: AroundEdge[]
): AroundEdge[] {
  const y = (id: string) => nodes.find(node => node.id === id)?.position.y ?? 0;
  const climbing = edges
    .filter(edge => edge.data?.back != null)
    .sort((a, b) => y(a.source) - y(b.source));
  const lane = new Map(climbing.map((edge, index) => [edge.id, index]));
  return edges.map(edge => {
    const at = lane.get(edge.id);
    if (at === undefined || !edge.data) return edge;
    return {
      ...edge,
      data: {
        ...edge.data,
        back: (edge.data.back ?? 0) + (at % LANES) * LANE,
        lane: at,
      },
    };
  });
}

/** An edge to a node on its own row or above climbs past the right of every
    row it spans, since a straight climb would cross the nodes between. */
function backChannelOf(
  nodes: AroundNode[],
  from: string,
  to: string
): number | null {
  const source = nodes.find(node => node.id === from);
  const target = nodes.find(node => node.id === to);
  if (!source || !target || target.position.y > source.position.y) return null;
  const span = nodes.filter(
    node =>
      node.position.y >= target.position.y &&
      node.position.y <= source.position.y
  );
  return (
    Math.max(
      ...span.map(node => node.position.x + (node.width ?? AROUND.nodeW))
    ) +
    AROUND.columnGap / 2
  );
}

/** How far the routes and labels reach past the nodes on each side, so the
    canvas leaves room for them. */
export function reachOf(layout: { nodes: AroundNode[]; edges: AroundEdge[] }): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const none = { left: 0, right: 0, top: 0, bottom: 0 };
  if (layout.nodes.length === 0) return none;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const edge of layout.edges) {
    for (const [x, y] of edge.data?.points ?? []) {
      xs.push(x);
      ys.push(y);
    }
    const at = edge.data?.labelAt;
    if (at) {
      xs.push(at.side === 'right' ? at.x + at.width : at.x - at.width);
      ys.push(at.y + at.height);
    }
  }
  const left = Math.min(...layout.nodes.map(node => node.position.x));
  const right = Math.max(
    ...layout.nodes.map(node => node.position.x + (node.width ?? AROUND.nodeW))
  );
  const top = Math.min(...layout.nodes.map(node => node.position.y));
  const bottom = Math.max(
    ...layout.nodes.map(node => node.position.y + AROUND.nodeH)
  );
  return {
    left: Math.max(0, left - Math.min(left, ...xs)),
    right: Math.max(0, Math.max(right, ...xs) - right),
    top: Math.max(0, top - Math.min(top, ...ys)),
    bottom: Math.max(0, Math.max(bottom, ...ys) - bottom),
  };
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
  to: string,
  leave: number
): number | null {
  const source = nodes.find(node => node.id === from);
  const target = nodes.find(node => node.id === to);
  if (!source || !target || target.position.y <= source.position.y) {
    return null;
  }
  const half = (node: AroundNode) => (node.width ?? AROUND.nodeW) / 2;
  const dropX = source.position.x + half(source) + leave;
  const between = nodes.filter(
    node =>
      node.position.y > source.position.y && node.position.y < target.position.y
  );
  const blocked = between.some(
    node =>
      Math.abs(node.position.x + half(node) - dropX) < half(node) + DROP_CLEAR
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
