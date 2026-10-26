import type {
  BlocksPayload,
  LayerColor,
  PayloadBlock,
} from '../../../../server/blocksPayload';
import {
  childrenOf,
  insideSharedTop,
  isIncludedTree,
  labelOf,
  layerName,
  rootOf,
  sharedTopIds,
} from './blockFacts';
import { sectionsAt } from './sections';

export type Fill = LayerColor | 'both';

export type Square = {
  id: string;
  label: string;
  section: string;
  fill: Fill;
};

export type LineTotal = { layer: LayerColor; label: string; count: number };

export type StripEntry = { layer: LayerColor; lines: number; label: string };

const ROLE_ORDER: LayerColor[] = ['mattstack', 'org', 'team'];
const FILL_ORDER: Fill[] = ['mattstack', 'org', 'team', 'both'];

/** The one line count the bar, the strip and the map share, so their numbers agree. */
export function linesOf(text: string): number {
  if (text === '') return 0;
  return text.replace(/\n$/, '').split('\n').length;
}

/** By `parentId`, never by id prefix: a shared block keeps its own id under
    whichever block includes it. */
function inScope(payload: BlocksPayload, scope: PayloadBlock | null) {
  if (scope === null) return payload.blocks;
  const ids = new Set([scope.id]);
  const queue = [scope.id];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const child of childrenOf(payload, id)) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      queue.push(child.id);
    }
  }
  return payload.blocks.filter(block => ids.has(block.id));
}

export function layerLabel(payload: BlocksPayload, role: LayerColor): string {
  return payload.layers.find(layer => layer.color === role)?.name ?? role;
}

function fillOf(block: PayloadBlock): Fill {
  const roles = new Set(
    block.props.flatMap(prop => prop.values.map(value => value.color))
  );
  if (roles.has('org') && roles.has('team')) return 'both';
  if (roles.has('org')) return 'org';
  if (roles.has('team')) return 'team';
  return 'mattstack';
}

/** At the skill, a block sits in the band of its top-level ancestor (up the
    `parentId` chain), a top-level leaf in Notes, and the root under the
    skill's name. */
function skillSectionOf(payload: BlocksPayload): (id: string) => string {
  const root = rootOf(payload);
  const bandOf = new Map<string, string>();
  for (const band of sectionsAt(payload, { level: 'skill' })) {
    if (band.id !== 'notes') bandOf.set(band.id, band.title);
  }
  const parentOf = new Map(
    payload.blocks.map(block => [block.id, block.parentId])
  );
  const sharedTops = sharedTopIds(payload);
  return id => {
    if (root && id === root.id) return payload.skill;
    const seen = new Set<string>();
    for (let at: string | null | undefined = id; at; at = parentOf.get(at)) {
      if (seen.has(at)) break;
      seen.add(at);
      if (parentOf.get(at) === root?.id) {
        if (sharedTops.has(at)) return 'Shared';
        return bandOf.get(at) ?? 'Notes';
      }
    }
    return 'Notes';
  };
}

export function blockMap(
  payload: BlocksPayload,
  scope: PayloadBlock | null
): { squares: Square[]; legend: { fill: Fill; count: number }[] } {
  const sectionOf =
    scope === null ? skillSectionOf(payload) : () => labelOf(scope);
  const hidden = scope === null ? insideSharedTop(payload) : () => false;
  const top = scope ?? rootOf(payload);
  const squares = inScope(payload, scope)
    .filter(block => !hidden(block))
    .filter(block => block !== top || block.props.length > 0)
    .filter(block => !isIncludedTree(payload, block))
    .map(block => ({
      id: block.id,
      label: labelOf(block),
      section: sectionOf(block.id),
      fill: fillOf(block),
    }));
  const legend = FILL_ORDER.map(fill => ({
    fill,
    count: squares.filter(square => square.fill === fill).length,
  })).filter(entry => entry.count > 0);
  return { squares, legend };
}

export type LegendRow = { fill: LayerColor; name: string; count: number };

/** One row per layer the payload names, mattstack's for the blocks no layer
    adds to; a block both layers add to counts under each. */
export function layerLegend(
  payload: BlocksPayload,
  squares: Square[]
): LegendRow[] {
  const count = (fills: Fill[]) =>
    squares.filter(square => fills.includes(square.fill)).length;
  const rows: LegendRow[] = [
    {
      fill: 'mattstack',
      name: `${layerLabel(payload, 'mattstack')} only`,
      count: count(['mattstack']),
    },
  ];
  for (const role of ['org', 'team'] as const) {
    if (!payload.layers.some(layer => layer.color === role)) continue;
    rows.push({
      fill: role,
      name: layerLabel(payload, role),
      count: count([role, 'both']),
    });
  }
  return rows;
}

/** The layers' values as a whole percent of the text, at least 1 when there
    are any; null when mattstack wrote it all. */
export function propShare(
  payload: BlocksPayload,
  scope: PayloadBlock | null
): number | null {
  const totals = lineTotals(payload, scope);
  const all = totals.reduce((sum, entry) => sum + entry.count, 0);
  const theirs = totals
    .filter(entry => entry.layer !== 'mattstack')
    .reduce((sum, entry) => sum + entry.count, 0);
  if (all === 0 || theirs === 0) return null;
  return Math.max(1, Math.round((theirs / all) * 100));
}

/** Keyed by the segment's role colour, which is the winning value's role,
    so a replaced default counts for the layer that replaced it. */
export function lineTotals(
  payload: BlocksPayload,
  scope: PayloadBlock | null
): LineTotal[] {
  const counts = new Map<LayerColor, number>();
  const hidden = scope === null ? insideSharedTop(payload) : () => false;
  for (const block of inScope(payload, scope).filter(b => !hidden(b))) {
    for (const segment of block.segments) {
      counts.set(
        segment.color,
        (counts.get(segment.color) ?? 0) + linesOf(segment.text)
      );
    }
  }
  return ROLE_ORDER.filter(role => (counts.get(role) ?? 0) > 0).map(role => ({
    layer: role,
    label: layerLabel(payload, role),
    count: counts.get(role) ?? 0,
  }));
}

export function blockStrip(
  block: PayloadBlock,
  payload?: BlocksPayload
): StripEntry[] {
  return block.segments.map(segment => ({
    layer: segment.color,
    lines: linesOf(segment.text),
    label:
      segment.prop === null
        ? 'engine text'
        : `${segment.prop} · ${payload ? layerName(payload, segment.layer) : segment.layer}`,
  }));
}
