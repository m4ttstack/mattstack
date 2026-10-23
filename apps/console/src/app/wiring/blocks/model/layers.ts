import type {
  BlocksPayload,
  LayerColor,
  PayloadBlock,
} from '../../../../server/blocksPayload';
import { labelOf, rootOf } from './blockFacts';
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

function inScope(payload: BlocksPayload, scope: PayloadBlock | null) {
  if (scope === null) return payload.blocks;
  return payload.blocks.filter(
    block => block.id === scope.id || block.id.startsWith(`${scope.id}/`)
  );
}

export function layerLabel(payload: BlocksPayload, role: LayerColor): string {
  return payload.layers.find(layer => layer.color === role)?.label ?? role;
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

/** At the skill, a block sits in the band of its top-level ancestor, a
    top-level leaf in Notes, and the root under the skill's name. */
function skillSectionOf(payload: BlocksPayload): (id: string) => string {
  const root = rootOf(payload);
  const bandOf = new Map<string, string>();
  for (const band of sectionsAt(payload, { level: 'skill' })) {
    if (band.id !== 'notes') bandOf.set(band.id, band.title);
    for (const row of band.rows) bandOf.set(row.id, band.title);
  }
  return id => {
    if (root && id === root.id) return payload.skill;
    for (let at = id; at.includes('/'); at = at.slice(0, at.lastIndexOf('/'))) {
      const title = bandOf.get(at);
      if (title !== undefined) return title;
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
  const squares = inScope(payload, scope).map(block => ({
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

/** Keyed by the segment's role colour, which is the winning value's role,
    so a replaced default counts for the layer that replaced it. */
export function lineTotals(
  payload: BlocksPayload,
  scope: PayloadBlock | null
): LineTotal[] {
  const counts = new Map<LayerColor, number>();
  for (const block of inScope(payload, scope)) {
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

export function blockStrip(block: PayloadBlock): StripEntry[] {
  return block.segments.map(segment => ({
    layer: segment.color,
    lines: linesOf(segment.text),
    label:
      segment.prop === null
        ? 'engine text'
        : `${segment.prop} · ${segment.layer}`,
  }));
}
