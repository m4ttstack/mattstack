import type { BandedLayout } from './bandLayout';
import type { BlockMap } from './blockMap';

export type MapHover = { kind: 'node' | 'link'; id: string } | null;

/** The links each drawn edge belongs to: a trunk segment belongs to every
    link of its trunk, and a band's edges to the open link, except an edge
    out to another trunk link's target, which belongs to that link. */
export function edgeOwners(
  layout: BandedLayout,
  map: BlockMap
): Map<string, string[]> {
  const byId = new Map(map.links.map(link => [link.id, link]));
  const groups = new Map<string, string[]>();
  for (const link of map.links) {
    if (!link.trunk) continue;
    const group = link.trunk.group;
    groups.set(group, [...(groups.get(group) ?? []), link.id]);
  }
  const band = layout.band;
  const bandLinks = band
    ? band.link.trunk
      ? groups.get(band.link.trunk.group)!
      : [band.link.id]
    : [];

  const owners = new Map<string, string[]>();
  for (const edge of layout.edges) {
    if (byId.has(edge.id)) {
      owners.set(edge.id, [edge.id]);
    } else if (band && edge.id.startsWith(`${band.id}:`)) {
      const reached = edge.id.includes(':out:')
        ? bandLinks.filter(id => byId.get(id)!.to[0] === edge.to)
        : [];
      owners.set(edge.id, reached.length > 0 ? reached : [band.link.id]);
    } else {
      const cut = edge.id.lastIndexOf('>');
      const group = cut > 0 ? groups.get(edge.id.slice(0, cut)) : undefined;
      if (group) owners.set(edge.id, group);
    }
  }
  return owners;
}

export type MapFocus = {
  hotEdges: Set<string>;
  /** Null when nothing fades. */
  litNodes: Set<string> | null;
  /** The folded link each dotted edge opens, and the edge that carries
      that link's button. */
  opens: Map<string, string>;
  buttons: Map<string, string>;
};

/** What lights, what fades and what opens, for a hover on a block or on a
    folded link. */
export function mapFocus(
  layout: BandedLayout,
  map: BlockMap,
  hover: MapHover
): MapFocus {
  const owners = edgeOwners(layout, map);
  const byId = new Map(map.links.map(link => [link.id, link]));

  const opens = new Map<string, string>();
  const buttons = new Map<string, string>();
  for (const edge of layout.edges) {
    if (!edge.folded) continue;
    const own = owners.get(edge.id) ?? [];
    const link =
      own.length === 1
        ? own[0]!
        : (own.find(id => byId.get(id)!.trunk?.main) ?? null);
    if (link === null) continue;
    opens.set(edge.id, link);
    if (edge.id === link || !buttons.has(link)) buttons.set(link, edge.id);
  }

  const hotEdges = new Set<string>();
  if (hover?.kind === 'link') {
    for (const [edge, own] of owners) {
      if (own.includes(hover.id)) hotEdges.add(edge);
    }
    return { hotEdges, litNodes: null, opens, buttons };
  }
  if (hover?.kind !== 'node') {
    return { hotEdges, litNodes: null, opens, buttons };
  }

  const node = hover.id;
  const touching = map.links.filter(
    link =>
      link.from === node ||
      link.alsoFrom.includes(node) ||
      link.to.includes(node)
  );
  const hotLinks = new Set(touching.map(link => link.id));
  const litNodes = new Set([node]);
  for (const link of touching) {
    for (const id of [link.from, ...link.alsoFrom, ...link.to]) {
      litNodes.add(id);
    }
  }
  for (const edge of layout.edges) {
    const own = owners.get(edge.id) ?? [];
    if (
      edge.from === node ||
      edge.to === node ||
      own.some(id => hotLinks.has(id))
    ) {
      hotEdges.add(edge.id);
    }
  }
  return { hotEdges, litNodes, opens, buttons };
}
