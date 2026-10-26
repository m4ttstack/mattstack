import type {
  BlocksPayload,
  LayerColor,
  PayloadBlock,
} from '../../../../server/blocksPayload';

const ROLE_ORDER: LayerColor[] = ['mattstack', 'org', 'team'];

/** One line count for every view that counts a segment's lines. */
export function linesOf(text: string): number {
  if (text === '') return 0;
  return text.replace(/\n$/, '').split('\n').length;
}

export function layerLabel(payload: BlocksPayload, role: LayerColor): string {
  return payload.layers.find(layer => layer.color === role)?.name ?? role;
}

export type DocLayer = {
  layer: LayerColor;
  name: string;
  lines: number;
  /** What the layer's lines are: null for mattstack's own text. */
  what: string | null;
};

/** The document's lines by layer, in the order layers stack, and the layers
    that could pass a value here but pass none. A segment counts for its
    colour, the winning value's role, so a replaced default counts for the
    layer that replaced it. */
export function documentLayers(
  payload: BlocksPayload,
  block: PayloadBlock
): { layers: DocLayer[]; quiet: string[] } {
  const merges = new Map(block.props.map(prop => [prop.name, prop.merge]));
  const layers = ROLE_ORDER.flatMap(role => {
    const segments = block.segments.filter(segment => segment.color === role);
    if (segments.length === 0) return [];
    const props = [
      ...new Set(segments.flatMap(segment => segment.prop ?? [])),
    ];
    const replaces = props.some(prop => merges.get(prop) === 'replace');
    const what =
      role === 'mattstack'
        ? null
        : replaces
          ? 'replaces the default'
          : `its ${props.join(', ')}`;
    return [
      {
        layer: role,
        name: layerLabel(payload, role),
        lines: segments.reduce(
          (sum, segment) => sum + linesOf(segment.text),
          0
        ),
        what,
      },
    ];
  });
  const present = new Set(layers.map(entry => entry.layer));
  // A layer can bind another pack's file, as a team binds its base's; that
  // pack wrote the text even though its own layer passed nothing.
  const owners = new Set(
    block.props.flatMap(prop =>
      prop.values.map(value => value.binding.split(':')[0])
    )
  );
  const quiet =
    block.props.length === 0
      ? []
      : payload.layers
          .filter(layer => layer.color !== 'mattstack')
          .filter(layer => !present.has(layer.color))
          .filter(layer => !owners.has(layer.name))
          .map(layer => layer.name);
  return { layers, quiet };
}
