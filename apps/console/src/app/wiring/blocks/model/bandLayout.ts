import type { BlocksPayload } from '../../../../server/blocksPayload';
import type { BlockMap, MapLink } from './blockMap';
import type { LayoutEdge, LayoutNode } from './elkGraph';
import { foldBand, type BandNode } from './foldBand';
import { cutLabel, shortLabel } from './labels';
import {
  CHIP,
  skillOf,
  type MapEdge,
  type MapLayout,
  type Measure,
} from './mapLayout';

type Graph = BlocksPayload['graphs'][number];

export const BAND = {
  padding: { top: 44, right: 16, bottom: 16, left: 16 },
} as const;

export const BAND_CARD = {
  padX: 12,
  padY: 10,
  title: 20,
  badge: 20,
  badgeGap: 8,
  row: 20,
  rowGap: 6,
  icon: 11,
  pills: 20,
  pillsGap: 6,
  pillPadX: 8,
  between: 6,
  minWidth: 200,
} as const;

/** 12px mono, one line, ellipsed past `maxWidth`. */
export const BAND_COMMAND = { height: 20, charWidth: 7.2, maxWidth: 360 };

export type BandRow = {
  label: string;
  /** The target as the map names it. */
  target: string;
  /** The map node to scroll to; null for an exit that is not on the map. */
  to: string | null;
  direction: 'back' | 'forward';
};

export type BandBox = {
  node: BandNode;
  width: number;
  height: number;
  rows: BandRow[];
};

export type OpenBand = { id: string; link: MapLink; boxes: BandBox[] };

export type BandedLayout = MapLayout & { band: OpenBand | null };

export const bandIdOf = (link: MapLink) => `band:${link.id}`;

function boxSize(
  node: BandNode,
  rows: BandRow[],
  measure: Measure
): { width: number; height: number } {
  if (node.kind === 'command') {
    return {
      width: Math.min(
        BAND_COMMAND.maxWidth,
        Math.ceil(node.text.length * BAND_COMMAND.charWidth)
      ),
      height: BAND_COMMAND.height,
    };
  }
  const C = BAND_CARD;
  const title = C.badge + C.badgeGap + measure(node.label, 13, 500);
  const rowWidths = rows.map(
    row =>
      measure(row.label, 12, 400) +
      C.rowGap +
      (row.to === null ? 0 : C.icon + C.rowGap) +
      measure(row.target, 12, 500)
  );
  const pills =
    node.pills.length === 0
      ? 0
      : node.pills.reduce(
          (sum, pill) => sum + measure(pill, 11, 400) + 2 * C.pillPadX,
          0
        ) +
        C.between * (node.pills.length - 1);
  return {
    width: Math.max(
      C.minWidth,
      Math.ceil(Math.max(title, pills, ...rowWidths) + 2 * C.padX)
    ),
    height:
      2 * C.padY +
      C.title +
      rows.length * C.row +
      (node.pills.length > 0 ? C.pillsGap + C.pills : 0),
  };
}

/** The layout with one link's folded steps opened in place: a compound
    node of its band replaces the link's edge, or its whole trunk, and the
    trunk's other links leave from the band step their path parts at. */
export function openBand(
  layout: MapLayout,
  map: BlockMap,
  graph: Graph,
  link: MapLink,
  measure: Measure
): BandedLayout {
  const band = foldBand(graph, link, map);
  const id = bandIdOf(link);
  const skill = skillOf(graph);
  const mapNodes = new Map(map.nodes.map(node => [node.id, node]));
  const graphLabels = new Map(
    graph.nodes.map(node => [node.id, node.label ?? node.id])
  );
  const nameOf = (nodeId: string) => {
    const node = mapNodes.get(nodeId);
    return node && node.kind !== 'split'
      ? node.label
      : shortLabel(graphLabels.get(nodeId) ?? nodeId, skill);
  };
  const arrowInto = (nodeId: string) => {
    const node = mapNodes.get(nodeId);
    return node !== undefined && node.kind !== 'split';
  };

  const inBand = new Map<string, string>();
  for (const node of band.nodes) {
    inBand.set(node.id, node.id);
    if (node.kind !== 'budget') continue;
    for (const edge of graph.edges) {
      if (edge.from === node.id) inBand.set(edge.to, node.id);
    }
  }

  const group = link.trunk?.group ?? null;
  const groupLinks = group
    ? map.links.filter(each => each.trunk?.group === group)
    : [link];
  const dropped = new Set(groupLinks.map(each => each.id));
  const isDropped = (edgeId: string) =>
    dropped.has(edgeId) || (group !== null && edgeId.startsWith(`${group}>`));
  const priorityOf = new Map(
    layout.input.edges.map(edge => [edge.id, edge.priority])
  );

  const added: { edge: MapEdge; priority?: number }[] = [];
  const add = (edge: MapEdge, priority?: number) => {
    if (added.some(each => each.edge.id === edge.id)) return;
    added.push({ edge, priority });
  };

  for (const edge of graph.edges) {
    const to = inBand.get(edge.to);
    if (edge.from !== link.from || to === undefined) continue;
    add(
      {
        id: `${id}:in:${to}`,
        from: link.from,
        to,
        folded: false,
        arrow: true,
        label: edge.label ? cutLabel(edge.label) : null,
      },
      priorityOf.get(link.id)
    );
  }
  for (const edge of band.edges) {
    add({
      id: `${id}:${edge.id}`,
      from: edge.source,
      to: edge.target,
      folded: false,
      arrow: true,
      label: null,
    });
  }

  const drawn = new Set<string>();
  for (const each of groupLinks) {
    const target = each.to[0]!;
    const beyond = each.folded.filter(step => !inBand.has(step));
    const onPath = new Set([...beyond, target]);
    const anchors = new Set<string>();
    for (const edge of graph.edges) {
      const from = inBand.get(edge.from);
      if (from !== undefined && onPath.has(edge.to)) anchors.add(from);
    }
    if (anchors.size === 0 && each === link && band.nodes.length > 0) {
      anchors.add(band.nodes.at(-1)!.id);
    }
    for (const from of anchors) {
      add(
        {
          id: `${id}:out:${from}>${target}`,
          from,
          to: target,
          folded: beyond.length > 0,
          arrow: arrowInto(target),
          label: each === link ? null : each.label,
        },
        priorityOf.get(each.id)
      );
      if (each !== link) drawn.add(`${from}\u0000${target}`);
    }
  }

  const boxes = band.nodes.map((node): BandBox => {
    const rows =
      node.kind === 'command'
        ? []
        : node.jumps
            .filter(jump => !drawn.has(`${node.id}\u0000${jump.target}`))
            .map(jump => ({
              label: jump.label,
              target: nameOf(jump.target),
              to: mapNodes.has(jump.target) ? jump.target : null,
              direction: jump.direction,
            }));
    return { node, rows, ...boxSize(node, rows, measure) };
  });

  const junctions = layout.junctions.filter(
    junction => group === null || !junction.startsWith(`${group}@`)
  );
  const keptJunctions = new Set(junctions);
  const nodes: LayoutNode[] = [
    ...layout.input.nodes.filter(
      node => !layout.junctions.includes(node.id) || keptJunctions.has(node.id)
    ),
    { id, width: 0, height: 0, padding: { ...BAND.padding } },
    ...boxes.map(box => ({
      id: box.node.id,
      width: box.width,
      height: box.height,
      parent: id,
      anchorX: box.width / 2,
    })),
  ];
  const keptEdges = layout.edges.filter(edge => !isDropped(edge.id));
  const keptInput = layout.input.edges.filter(edge => !isDropped(edge.id));
  const addedInput = added.map(({ edge, priority }): LayoutEdge => ({
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
    ...(priority === undefined ? {} : { priority }),
  }));

  return {
    ...layout,
    edges: [...keptEdges, ...added.map(each => each.edge)],
    junctions,
    input: { nodes, edges: [...keptInput, ...addedInput] },
    band: { id, link, boxes },
  };
}
