const BASE_PREFIX = 'base:';

/** The words a prop value's layer badge shows. Display only: the layer rt
    reports (`PropValueNode.layer`) keeps its wire value. */
export function layerLabel(layer: string): string {
  if (layer === 'pack') return 'this pack';
  if (layer === 'override') return 'your override';
  if (layer.startsWith(BASE_PREFIX))
    return `base: ${layer.slice(BASE_PREFIX.length)}`;
  return layer;
}
